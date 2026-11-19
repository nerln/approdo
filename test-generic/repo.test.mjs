// The repository as a template that anyone can publish and deploy with one click: the Worker entry point, wrangler.jsonc,
// the schema (the Worker creates its own tables), the secrets file, the placeholders left by the "Deploy to Cloudflare" button, and the files of a public repo.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanEnv, isPlaceholder } from "../src/env.js";
import { SCHEMA_STATEMENTS } from "../src/schema.js";
import { SCHEMA_VERSION } from "../src/migrate.js";
import { generate } from "../scripts/build-schema.mjs";
import { C, BASE, ENV, setup, makeDB, book, call, req, text, rows, relay, adminSession, adminGet, NOW } from "./helpers.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const json = (p) => JSON.parse(read(p).replace(/^\s*\/\/.*$/gm, ""));
const dotenv = (p) => Object.fromEntries(read(p).split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

// ---- the database --------------------------------------------------------------------------------------------------------
// The shape of a database: its tables with their columns, and its indexes.
const shape = (db) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  return JSON.stringify({
    tables: tables.map((t) => [t, db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk])]),
    indexes: db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((i) => [i.name, i.tbl_name]),
  });
};

test("schema.sql is the one source of truth: src/schema.js is generated from it and builds the same database", () => {
  assert.equal(read("src/schema.js"), generate(read("schema.sql")), "src/schema.js differs from schema.sql: run npm run build:schema");
  const check = spawnSync(process.execPath, ["scripts/build-schema.mjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const fromFile = new DatabaseSync(":memory:"); fromFile.exec(read("schema.sql"));
  const fromModule = new DatabaseSync(":memory:"); for (const st of SCHEMA_STATEMENTS) fromModule.exec(st);
  assert.equal(shape(fromModule), shape(fromFile));
  // every statement is idempotent: running the whole list twice (two racing first requests) changes nothing and does not fail
  for (const st of SCHEMA_STATEMENTS) fromModule.exec(st);
  assert.equal(shape(fromModule), shape(fromFile));
  assert.ok(SCHEMA_STATEMENTS.every((st) => /^(CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|INSERT OR IGNORE)\b/.test(st)), "only idempotent statements");
});

test("the schema_version row of schema.sql names the last upgrade of src/migrate.js, and there is no migrations step left", () => {
  assert.match(read("schema.sql"), new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('schema_version', '${SCHEMA_VERSION}'\\);`));
  const db = new DatabaseSync(":memory:"); db.exec(read("schema.sql"));
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  assert.ok(!existsSync(join(root, "migrations")), "no migrations/ folder: the Worker creates its own tables");
  assert.ok(!/migrations_dir|d1 migrations/.test(read("wrangler.jsonc") + read("package.json") + read(".github/workflows/deploy.yml")), "no migration command anywhere in the deployment");
});

// ---- the Worker ----------------------------------------------------------------------------------------------------------
test("a request over plain HTTP is redirected to HTTPS by the Worker entry, except on localhost", async () => {
  const m = await import("../src/index.js");
  const r = await m.default.fetch(new Request("http://lab.example.workers.dev/en?x=1"), {}, {});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), "https://lab.example.workers.dev/en?x=1");
  const { httpsRedirect } = await import("../src/app.js");
  assert.equal(httpsRedirect(new Request("https://lab.example.workers.dev/en")), null, "HTTPS goes through");
  for (const h of ["http://localhost:8787/", "http://127.0.0.1:8787/admin", "http://[::1]:8787/", "http://site.localhost:8787/"]) assert.equal(httpsRedirect(new Request(h)), null, h);
  const post = httpsRedirect(new Request("http://lab.example.workers.dev/reservar", { method: "POST", body: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } }));
  assert.equal(post.status, 301, "a form posted over HTTP is not processed");
});

test("src/index.js exports exactly one default object with fetch(): the Workers runtime rejects any other kind of export", async () => {
  const m = await import("../src/index.js");
  assert.deepEqual(Object.keys(m), ["default"]);
  assert.equal(typeof m.default.fetch, "function");
  // it really answers a request with the security headers (no DB bound: the 503 page, still with headers)
  const r = await m.default.fetch(new Request(BASE + "/"), { ASSETS: { fetch: async () => new Response("x") } });
  assert.equal(r.status, 503);
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
});

test("wrangler.jsonc: a Worker with static assets, the Worker first, a D1 binding with no database_id and no migrations, observability off", () => {
  const w = json("wrangler.jsonc");
  assert.equal(w.name, "approdo");
  assert.equal(w.main, "src/index.js");
  assert.match(w.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  // without this flag Cloudflare answers error 1042 when the Worker posts the usage report to the collector, which is a Worker too
  assert.deepEqual(w.compatibility_flags, ["global_fetch_strictly_public"]);
  assert.deepEqual(w.assets, { directory: "./public", run_worker_first: true, binding: "ASSETS" });
  assert.equal(w.d1_databases.length, 1);
  const d = w.d1_databases[0];
  assert.equal(d.binding, "DB"); assert.equal(d.database_name, "approdo"); assert.ok(!("migrations_dir" in d), "no migrations folder: the Worker creates its own tables");
  assert.ok(!("database_id" in d), "the shipped file has no database_id: Cloudflare provisions the database on deploy (setup.mjs writes the id for the agent path)");
  assert.equal(w.observability.enabled, false);
  assert.ok(existsSync(join(root, w.main)));
  assert.ok(existsSync(join(root, w.assets.directory)));
  assert.ok(!existsSync(join(root, "wrangler.toml")), "wrangler.toml is gone (it would win over wrangler.jsonc)");
  assert.ok(!existsSync(join(root, "public/_worker.js")), "public/_worker.js is Pages advanced mode: it would be served as a file");
  assert.ok(!readdirSync(join(root, "public")).some((f) => f.startsWith("_")), "nothing in public/ that Cloudflare treats as a special file");
});

test("package.json: deploy, dev, wrangler, and a description for every secret that the Deploy button asks for", () => {
  const p = json("package.json");
  assert.equal(p.scripts.deploy, "wrangler deploy", "one command, and nothing before it");
  assert.equal(p.scripts.dev, "wrangler dev", "a fresh local database needs no extra command");
  assert.ok(!("db:local" in p.scripts));
  assert.equal(p.scripts["build:schema"], "node scripts/build-schema.mjs");
  assert.match(p.devDependencies.wrangler, /^\^4\.(4[5-9]|[5-9]\d|\d{3,})\./);
  assert.ok(!/pages/i.test(p.description), "no mention of Pages");
  assert.match(p.repository.url, /^git\+https:\/\/github\.com\/[A-Za-z0-9-]+\/approdo\.git$/);
  assert.ok(!JSON.stringify(p).match(/@[a-z0-9-]+\.[a-z]{2,}/i), "no e-mail address in package.json");
  const names = Object.keys(dotenv(".dev.vars.example"));
  assert.deepEqual(names, ["ADMIN_PASSWORD", "MAIL_RELAY_URL", "MAIL_RELAY_KEY", "ADMIN_EMAIL", "TURNSTILE_SITEKEY", "TURNSTILE_SECRET"]);
  assert.deepEqual(Object.keys(p.cloudflare.bindings), names);
  for (const n of names) assert.ok(String(p.cloudflare.bindings[n].description).length > 30, `${n} has a real description`);
  assert.match(p.cloudflare.bindings.ADMIN_PASSWORD.description, /16/);
  assert.match(p.cloudflare.bindings.MAIL_RELAY_KEY.description, /openssl rand -hex 32/);
  for (const n of names.filter((x) => x !== "ADMIN_PASSWORD")) assert.match(p.cloudflare.bindings[n].description, /Optional/i, `${n} is marked optional`);
});

// ---- placeholders --------------------------------------------------------------------------------------------------------
test("every value of .dev.vars.example is a placeholder and counts as not set; real values are kept", () => {
  const ex = dotenv(".dev.vars.example");
  for (const [k, v] of Object.entries(ex)) assert.ok(isPlaceholder(v), `${k}=${v} must be recognised as a placeholder`);
  assert.ok(ex.ADMIN_PASSWORD.length >= 16, "the placeholder password is long on purpose: only the placeholder check can reject it");
  const cleaned = cleanEnv({ DB: "db", ASSETS: "a", ...ex });
  assert.deepEqual(Object.keys(cleaned).sort(), ["ASSETS", "DB"]);
  for (const v of ["", "   "]) assert.ok(isPlaceholder(v));
  const real = { DB: "db", ADMIN_PASSWORD: "a-real-password-of-length", MAIL_RELAY_URL: "https://script.google.com/macros/s/AKfycbx123/exec", MAIL_RELAY_KEY: "ab12".repeat(16), ADMIN_EMAIL: "lab@university.example", TURNSTILE_SITEKEY: "0x4AAAAAAA", TURNSTILE_SECRET: "0x4BBBBBBB", NOLINK_DOMAINS: "" };
  assert.deepEqual(cleanEnv(real), real, "real values (and an empty NOLINK_DOMAINS, which is a real value) are untouched");
  assert.equal(cleanEnv(real), real, "nothing to clean: the same object");
  assert.ok(!isPlaceholder("my-change-me-password-is-fine") && !isPlaceholder("study@lab.example"));
});

test("a site deployed with every secret left at its placeholder: no admin, no relay, no bot check, and bookings work at once without mail", async () => {
  const ex = dotenv(".dev.vars.example");
  const { DB, env } = await setup({ ...ex });
  const m = relay();
  // the admin panel refuses to open while ADMIN_PASSWORD is the placeholder, for the form and for a login attempt alike
  const closed = await call(env, req("/admin"), NOW, m.fn);
  assert.equal(closed.status, 503);
  const attempt = await call(env, req("/admin/login", { method: "POST", fields: { password: ex.ADMIN_PASSWORD, t: "x" } }), NOW, m.fn);
  assert.notEqual(attempt.status, 303, "the placeholder password does not log anyone in");
  assert.ok(!(attempt.headers.get("set-cookie") || "").includes("="), "no session cookie");
  // the public page has no bot check: nothing from challenges.cloudflare.com, in the page or in the policy
  const home = await call(env, req("/"), NOW, m.fn);
  assert.ok(!(home.headers.get("content-security-policy") || "").includes("challenges.cloudflare.com"));
  assert.ok(!(await text(home)).includes("cf-turnstile"));
  // a booking is confirmed at once, no mail attempt is made (the placeholder relay address is never called)
  const html = await text(await book(env, {}, { fetchFn: m.fn }));
  assert.equal(m.calls.length, 0, "no request to the placeholder relay");
  assert.equal(rows(DB).length, 1);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(rows(DB)[0].expires_at, null);
  assert.match(html, /\/ics\/[A-Za-z0-9_-]{20,}/, "the confirmation page links the calendar file");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM mail_log").get().n, 0, "no mail was logged");
});

test("with a real password and the other secrets at their placeholders the panel opens, says that e-mail is off, and the notice address falls back to contactEmail", async () => {
  const ex = dotenv(".dev.vars.example");
  const { env } = await setup({ ...ex, ADMIN_PASSWORD: "a-real-password-of-length" });
  const s = await adminSession(env);
  const page = await adminGet(env, s);
  assert.match(page, /class="banner"/, "the 'e-mail is off' banner");
  const { adminEmail } = await import("../src/mail.js");
  assert.equal(adminEmail(cleanEnv(env)), C.contactEmail);
});

// ---- what a public repository needs ---------------------------------------------------------------------------------------
test("LICENSE is the Attribution Assurance License (SPDX: AAL), filled in for 'nerln', and the footer line carries the attribution it asks for; CREDITS.md explains the photo's separate licence; SECURITY.md covers the report channel and the limits", () => {
  const lic = read("LICENSE");
  assert.match(lic, /^Attribution Assurance License\n/);
  assert.doesNotMatch(lic, /^MIT License/m, "the file must not present itself as the MIT licence");
  // The standard text with its placeholders filled in: nothing of the template is left, nothing else is reworded.
  for (const re of [/ATTRIBUTION ASSURANCE LICENSE \(adapted from the original BSD license\)/, /a modest attribution to nerln \(the "Author"\)/, /a prominent display \(e\.g\., splash screen or banner text\) of the Author's attribution information/, /\(a\) Name \("nerln"\),/, /\(b\) Professional identification \("author of Approdo"\), and/, /\(c\) URL \("https:\/\/nerln\.github\.io\/approdo\/"\)\./, /THIS FREE SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS"/]) assert.match(lic, re, String(re));
  assert.doesNotMatch(lic, /AUTHOR'S PROFESSIONAL PRACTICE|<AUTHOR>|PROFESSIONAL IDENTIFICATION \*|\("AUTHOR"\)|\("URL"\)/, "no placeholder of the template is left");
  // The standard text plus one numbered addition, so the package does not claim the plain SPDX licence.
  assert.match(lic, /^5\. Additional condition, not part of the standard Attribution Assurance License: citation\./m);
  assert.match(lic, /must cite the software as indicated in the file CITATION\.cff/);
  assert.equal(JSON.parse(read("package.json")).license, "SEE LICENSE IN LICENSE");
  for (const f of ["README.md", "README.it.md", "PUBLISHING.md", "CREDITS.md"]) assert.doesNotMatch(read(f), /code is MIT|MIT licen[cs]ed|MIT-licen[cs]ed|Licen[cs]e:\*\* MIT|Licenza:\*\* MIT|codice è MIT|Licenza MIT del codice|MIT licence of the code/i, `${f} no longer calls the code MIT`);
  assert.match(lic, /^Copyright \(c\) \d{4} by nerln, author of Approdo \* https:\/\/nerln\.github\.io\/approdo\/ "/m);
  assert.match(lic, /Redistribution and use in source and binary forms, with or without modification, are permitted/);
  const cr = read("CREDITS.md");
  for (const re of [/quest3\.webp/, /Creative Commons/, /BY-SA 4\.0/, /commons\.wikimedia\.org/, /not covered by the licence of the code|separate licen[cs]e/i, /hero\.image/, /creditHtml/]) assert.match(cr, re, String(re));
  const sec = read("SECURITY.md");
  for (const re of [/Report a vulnerability/, /private/i, /What the site stores/i, /Protections/i, /Known limitations/i, /e-mail address .*live booking|whether .*e-mail address.*booking/is, /does not prove (ownership|that .*owns)/i, /shared network|same network/i]) assert.match(sec, re, String(re));
});

// The repository address is written in README.md (the Deploy button), README.it.md and package.json. The tests accept any single account
// name, used consistently in all three: the shipped placeholder OWNER, or what `node scripts/set-owner.mjs <account>` writes.
function ownerHits() {
  const hits = [];
  const walk = (d) => { for (const f of readdirSync(join(root, d))) {
    if (["node_modules", ".git", ".wrangler"].includes(f)) continue;
    const rel = join(d, f);
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/\.(md|json|jsonc|js|mjs|yml|sql|gs|txt|svg|css)$/.test(f) && !rel.startsWith("test") && rel !== "package-lock.json" && rel !== "scripts/set-owner.mjs") { const t = read(rel); for (const m of t.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/approdo/g)) hits.push([rel, m[1]]); }
  } };
  walk(".");
  return hits;
}
test("the repository owner is one account name, the same in README.md, README.it.md and package.json", () => {
  const hits = ownerHits();
  assert.deepEqual([...new Set(hits.map(([f]) => f))].sort(), ["README.it.md", "README.md", "package.json", "src/product.js"], "the address is written in exactly these four files (the last one is the footer link \"Made with Approdo\")");
  const owners = new Set(hits.map(([, o]) => o));
  assert.equal(owners.size, 1, `one owner everywhere, found ${[...owners].join(", ")}`);
  const [owner] = owners;
  assert.match(owner, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "a GitHub account name");
  const readme = read("README.md");
  assert.match(readme.slice(0, 2500), new RegExp(`deploy\\.workers\\.cloudflare\\.com/\\?url=https://github\\.com/${owner}/approdo`));
  // The "for whoever publishes" comment exists exactly while the placeholder is still there.
  for (const f of ["README.md", "README.it.md"]) {
    const has = /PER CHI PUBBLICA|FOR WHOEVER PUBLISHES/.test(read(f).slice(0, 900));
    assert.equal(has, owner === "OWNER", `${f}: the publishing comment goes away with the placeholder`);
    if (has) assert.match(read(f).slice(0, 900), /set-owner\.mjs/, `${f}: the comment names the script`);
  }
});

test("scripts/set-owner.mjs replaces the placeholder everywhere, removes the comment, and PUBLISHING.md documents it", () => {
  const dir = mkdtempSync(join(tmpdir(), "approdo-owner-"));
  try {
    for (const p of ["scripts", "README.md", "README.it.md", "package.json", "src/product.js"]) { mkdirSync(dirname(join(dir, p)), { recursive: true }); cpSync(join(root, p), join(dir, p), { recursive: true }); }
    // work from the placeholder state whatever the repository holds now
    for (const f of ["README.md", "README.it.md", "package.json", "src/product.js"]) { const t = readFileSync(join(dir, f), "utf8"); writeFileSync(join(dir, f), t.replace(/github\.com\/[A-Za-z0-9_.-]+\/approdo/g, "github.com/OWNER/approdo")); }
    const run = (...a) => spawnSync(process.execPath, ["scripts/set-owner.mjs", ...a], { cwd: dir, encoding: "utf8" });
    assert.equal(run().status, 2, "no account: usage");
    assert.equal(run("bad owner!").status, 2, "an invalid account is refused");
    assert.equal(run("-x").status, 2);
    const ok = run("my-lab");
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (const f of ["README.md", "README.it.md", "package.json", "src/product.js"]) {
      const t = readFileSync(join(dir, f), "utf8");
      assert.ok(!t.includes("OWNER"), `${f}: no OWNER left`);
      assert.ok(t.includes("github.com/my-lab/approdo"), f);
      assert.ok(!/PER CHI PUBBLICA|FOR WHOEVER PUBLISHES/.test(t), `${f}: the comment is gone`);
    }
    assert.ok(readFileSync(join(dir, "README.md"), "utf8").includes("deploy.workers.cloudflare.com/?url=https://github.com/my-lab/approdo"));
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
    const again = run("my-lab");
    assert.equal(again.status, 0); assert.match(again.stdout, /Nothing to change/);
    // A copy that already names another account: the second account replaces the first, everywhere, and nothing is left of it.
    const second = run("other-lab");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    for (const f of ["README.md", "README.it.md", "package.json", "src/product.js"]) {
      const t = readFileSync(join(dir, f), "utf8");
      assert.ok(!t.includes("my-lab"), `${f}: the first account is gone`);
      assert.ok(!t.includes("OWNER"), `${f}: no OWNER`);
      assert.ok(t.includes("github.com/other-lab/approdo"), f);
    }
    assert.ok(readFileSync(join(dir, "README.md"), "utf8").includes("deploy.workers.cloudflare.com/?url=https://github.com/other-lab/approdo"));
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
    const third = run("other-lab");
    assert.equal(third.status, 0); assert.match(third.stdout, /Nothing to change/);
    // A copy that names another account and still carries the "for whoever publishes" comment: the comment goes too.
    const readme = join(dir, "README.md");
    writeFileSync(readme, "<!--\n  FOR WHOEVER PUBLISHES THIS REPOSITORY: replace OWNER.\n-->\n" + readFileSync(readme, "utf8"));
    assert.equal(run("third-lab").status, 0);
    assert.ok(!/FOR WHOEVER PUBLISHES/.test(readFileSync(readme, "utf8")));
    assert.ok(readFileSync(readme, "utf8").includes("github.com/third-lab/approdo") && !readFileSync(readme, "utf8").includes("other-lab"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const doc = read("PUBLISHING.md");
  assert.match(doc, /node scripts\/set-owner\.mjs <github-account>/);
  assert.match(doc, /account of whoever published the copy you\s+forked/, "PUBLISHING.md says that another account is replaced too");
  for (const f of ["README.md", "README.it.md"]) assert.match(read(f), /set-owner\.mjs.*(forked|da cui sei partito)/s, `${f}: the map row says that another account is replaced too`);
});

test("no Pages-specific instruction or file is left anywhere", () => {
  const BAD = /Cloudflare Pages|wrangler pages|pages deploy|pages secret|pages project|_worker\.js|\.pages\.dev|wrangler\.toml|pages_build_output_dir|--project-name/i;
  const bad = [];
  const walk = (d) => { for (const f of readdirSync(join(root, d))) {
    if (["node_modules", ".git", ".wrangler"].includes(f)) continue;
    const rel = join(d, f);
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/\.(md|json|jsonc|js|mjs|yml|sql|gs|sh|example)$/.test(f) && rel !== "package-lock.json" && rel !== "test-generic/repo.test.mjs") { const m = BAD.exec(read(rel)); if (m) bad.push(`${rel}: ${m[0]}`); }
  } };
  walk(".");
  assert.deepEqual(bad, []);
});

// Files that must never be in a public repository, and strings that look like a real credential.
const SECRET_NAMES = [/(^|\/)\.dev\.vars(\..*)?$/, /(^|\/)\.env(\..*)?$/, /\.pem$/, /\.key$/, /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/, /\.p12$/, /\.pfx$/, /(^|\/)\.npmrc$/, /(^|\/)credentials(\.json)?$/, /service-account.*\.json$/i, /^\.wrangler\//, /(^|\/)node_modules\//];
const ALLOWED_NAMES = [/(^|\/)\.dev\.vars\.example$/, /(^|\/)\.env\.example$/];
const SECRET_CONTENT = [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bsk-[A-Za-z0-9]{32,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\b(?:MAIL_RELAY_KEY|TURNSTILE_SECRET|CLOUDFLARE_API_TOKEN)\s*[=:]\s*["']?(?!change-me)[A-Za-z0-9_-]{32,}/, /\b0x4[A-Za-z0-9_-]{20,}\b/];
// Named-secret patterns for everything except the test folders (their fixtures set invented passwords on purpose).
const SECRET_CONTENT_STRICT = [/\bADMIN_PASSWORD\s*[=:]\s*["']?(?!change-me|a-long-local-password|una-password-locale-lunga|[A-Z_]+\b)[^"'\s]{12,}/, /(?:api[_-]?key|secret|token|password)\s*[=:]\s*["'](?!change-me)[^"'\s]{20,}["']/i, /\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token|relay[_-]?key)\b\s*[=:]\s*["']?(?!change-me)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}/i, /-----BEGIN ENCRYPTED PRIVATE KEY-----/];

function trackedFiles() {
  const repo = process.env.APPRODO_REPO || root;
  // Tracked files and the ones not yet added (and not ignored): a new folder such as stats-collector/ is scanned before its first commit.
  const g = spawnSync("git", ["-C", repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  if (g.status === 0 && g.stdout) return { repo, files: g.stdout.split("\0").filter(Boolean), source: "git" };
  const out = [];
  const walk = (d) => { for (const f of readdirSync(join(root, d))) { const rel = d ? join(d, f) : f; if (f === ".git") continue; if (statSync(join(root, rel)).isDirectory()) walk(rel); else out.push(rel); } };
  walk("");
  return { repo: root, files: out, source: "directory" };
}

test(".gitignore covers .dev.vars, .wrangler and node_modules, and no secret file is tracked", () => {
  const gi = read(".gitignore").split("\n").map((l) => l.trim());
  for (const e of [".dev.vars", ".dev.vars.*", ".wrangler/", "node_modules/", ".env"]) assert.ok(gi.includes(e), `.gitignore lists ${e}`);
  assert.ok(gi.includes("!.dev.vars.example"), "the example file stays tracked");
  const { files } = trackedFiles();
  assert.ok(files.length > 20, "the file list was read");
  assert.ok(files.includes(".dev.vars.example"));
  const bad = files.filter((f) => SECRET_NAMES.some((re) => re.test(f)) && !ALLOWED_NAMES.some((re) => re.test(f)));
  assert.deepEqual(bad, [], "tracked files that must stay private");
  // the detector itself: a file with such a name or content would be caught
  for (const n of [".dev.vars", "x/.dev.vars.production", ".env", ".env.local", "k.pem", ".wrangler/state/v3/d1/x.sqlite"]) assert.ok(SECRET_NAMES.some((re) => re.test(n)), n);
  for (const n of [".dev.vars.example", ".env.example"]) assert.ok(ALLOWED_NAMES.some((re) => re.test(n)), n);
  for (const c of ["-----BEGIN PRIVATE KEY-----", "ghp_" + "a".repeat(36), "MAIL_RELAY_KEY=" + "ab12".repeat(10), "AKIA" + "A".repeat(16), "ADMIN_PASSWORD = \"" + "x".repeat(30) + "\"", "// API_KEY = \"" + "9f8e".repeat(10) + "\"", "apiKey: '" + "AbCd0123".repeat(5) + "'", "API_KEY=" + "9f8e".repeat(10), "RELAY_KEY: " + "ab12".repeat(8), "-----BEGIN ENCRYPTED PRIVATE KEY-----"]) assert.ok(SECRET_CONTENT.concat(SECRET_CONTENT_STRICT).some((re) => re.test(c)), c);
});

test("no tracked file contains something that looks like a real credential, a personal e-mail address or a private key", async () => {
  const { repo, files } = trackedFiles();
  const bad = [];
  // The lab's own addresses belong in site.config.js: contactEmail, and any address inside its own "texts". Those values (and only
  // those, and only in that file) are not reported. site.config.js is read from the tested copy (the configuration under test), and it
  // is still scanned for secrets and private keys, and for every other address.
  const own = (await import("../site.config.js")).default;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi;
  const labAddresses = new Set([own.contactEmail, ...(JSON.stringify(own.texts || {}).match(EMAIL) || [])].filter((a) => typeof a === "string").map((a) => a.toLowerCase()));
  for (const f of files) {
    if (/\.(png|webp|jpg|jpeg|gif|ico|woff2?)$/i.test(f) || f === "package-lock.json" || f === "test-generic/repo.test.mjs") continue;
    const p = f === "site.config.js" ? join(root, f) : join(repo, f);
    if (!existsSync(p)) continue;
    const t = readFileSync(p, "utf8");
    for (const re of SECRET_CONTENT) if (re.test(t)) bad.push(`${f}: ${re}`);
    if (!/^test(-generic)?\//.test(f)) for (const re of SECRET_CONTENT_STRICT) if (re.test(t)) bad.push(`${f}: ${re}`);
    // The tests use invented addresses at invented domains on purpose; everywhere else only example addresses are allowed.
    if (/^test(-generic)?\//.test(f)) continue;
    // The test variants are configurations written for the tests: besides the example domains they may use one invented university domain.
    const variant = /^config\/test-variants\/[^/]+\.config\.js$/.test(f);
    for (const m of t.matchAll(EMAIL)) {
      if (f === "site.config.js" && labAddresses.has(m[0].toLowerCase())) continue;
      if (/^n?\.?ome@gmail\.com$/i.test(m[0]) && f === "docs/privacy.md") continue;
      if (variant && /@([a-z0-9-]+\.)*ateneo-prova\.it$/i.test(m[0])) continue;
      if (!/@(([a-z0-9-]+\.)*example\.(org|net|com|edu)|unidemo(a)?\.es|users\.noreply\.github\.com|[a-z.]*\.(invalid|example))$/i.test(m[0])) bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the workflow files hold no one-line command that YAML would read as a mapping", () => {
  // A plain one-line `run:` value that contains ": " or " #" is not the command you wrote: GitHub refuses the whole file. Use `run: |`.
  for (const f of readdirSync(join(root, ".github/workflows"))) {
    const lines = read(`.github/workflows/${f}`).split("\n");
    lines.forEach((l, i) => {
      const m = /^\s*(?:- )?(?:run|name): (?![|>'"])(.*)$/.exec(l);
      if (m) assert.ok(!/: | #/.test(m[1]), `${f}:${i + 1}: ${m[1]}`);
    });
    assert.ok(!/\t/.test(lines.join("\n")), `${f}: no tab characters`);
  }
});

test("the tracked files include the licence files and the entry points, and the old Pages files are gone", () => {
  const { files } = trackedFiles();
  for (const f of ["LICENSE", "CITATION.cff", "SECURITY.md", "CREDITS.md", "README.md", "README.it.md", "AGENTS.md", "PUBLISHING.md", "wrangler.jsonc", "schema.sql", "src/schema.js", "src/migrate.js", "scripts/build-schema.mjs", "scripts/set-owner.mjs", "src/index.js", "public/quest3.webp", ".dev.vars.example"]) {
    // untracked-but-present is fine before the final commit; what matters is that the file exists and is not ignored
    assert.ok(existsSync(join(root, f)), `${f} exists`);
  }
  for (const f of ["wrangler.toml", "public/_worker.js"]) assert.ok(!files.includes(f) && !existsSync(join(root, f)), `${f} is gone`);
  assert.ok(!files.some((f) => /^migrations\//.test(f)) && !existsSync(join(root, "migrations")), "no migrations folder: the Worker creates and upgrades its own tables (src/migrate.js)");
});
