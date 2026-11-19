#!/usr/bin/env node
// First-time setup of the Cloudflare side, for the "agent" path and for a lab that needs the EU jurisdiction. Safe to run twice.
// (The "Deploy to Cloudflare" button of the README does all of this without a terminal; its database has no jurisdiction.)
// It does everything that needs no secret:
//   1. checks Node and that site.config.js loads and no placeholder is left (it stops, exit code 1, and lists them), warns if
//      the privacy policy is not marked as reviewed (privacyReviewed), then checks wrangler;
//   2. runs the generic test suite against YOUR site.config.js;
//   3. checks that you are logged in to Cloudflare (and starts the browser login if not);
//   4. creates the D1 database in the EU jurisdiction (wrangler d1 create --jurisdiction eu) if it does not exist and writes its
//      id into wrangler.jsonc (the tables are created by the Worker itself on its first request: there is no migration step);
//   5. deploys the Worker (wrangler deploy) and reads its address from the output;
//   6. prints the secret commands you must type yourself, and what to do in Google Apps Script.
// No password, key or token ever passes through this script or is written to a file: the secrets are typed by you
// at the prompt of "wrangler secret put", which is the last thing this script tells you.
//
// Usage:  node scripts/setup.mjs [--project NAME] [--database NAME] [--no-tests] [--no-deploy]
//                                [--allow-placeholders] [--dry-run]
//   --project   name of the Worker (it becomes <name>.<your-subdomain>.workers.dev); default: the one in wrangler.jsonc
//   --database  name of the D1 database; default: the one in wrangler.jsonc
//   --dry-run   print every command instead of running it (nothing reaches the network, no file is changed)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = ["--yes", "wrangler@4"]; // always the same major version, whatever is installed globally
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag("--dry-run");
const KNOWN = ["--project", "--database", "--no-tests", "--no-deploy", "--allow-placeholders", "--dry-run", "--help", "-h"];
for (const a of args) if (a.startsWith("-") && !KNOWN.includes(a)) { console.error(`Unknown option ${a}. Try --help.`); process.exit(2); }
if (flag("--help") || flag("-h")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1); // after the #! line
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

const say = (m = "") => console.log(m);
const step = (n, m) => say(`\n[${n}] ${m}`);
const die = (m, code = 1) => { console.error(`\nSTOP: ${m}`); process.exit(code); };

// Runs a command in the project folder. capture=true returns { status, out }; otherwise the output goes to the screen.
function run(cmd, cmdArgs, { capture = false, mutates = false, input } = {}) {
  const shown = `${cmd} ${cmdArgs.join(" ")}`;
  if (DRY) { say(`  [dry-run] ${shown}`); return { status: 0, out: "", dry: true }; }
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"], input, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, out: capture ? (r.stdout || "") + (r.stderr || "") : "" };
}
const wr = (a, o) => run("npx", [...WRANGLER, ...a], o);
// Like run(), but the output is shown as it arrives (prompts stay visible) and also returned.
const runLive = (cmd, cmdArgs) => new Promise((done) => {
  const child = spawn(cmd, cmdArgs, { cwd: root, stdio: ["inherit", "pipe", "pipe"] });
  let out = "";
  for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on("data", (b) => { out += b; sink.write(b); });
  child.on("close", (code) => done({ status: code ?? 1, out }));
});

// ---------------------------------------------------------------- 1. prerequisites and configuration
step(1, "Prerequisites and site.config.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) die(`Node.js 22 or newer is needed (you have ${process.versions.node}). Install it from https://nodejs.org and run this script again.`);
say(`  Node.js ${process.versions.node}: ok`);

let C, AT, findPlaceholders;
try {
  C = (await import(pathToFileURL(join(root, "src/config.js")).href)).C;
  AT = (await import(pathToFileURL(join(root, "src/admin_texts.js")).href)).AT;
  findPlaceholders = (await import(pathToFileURL(join(root, "src/placeholders.js")).href)).findPlaceholders;
} catch (e) {
  die(`site.config.js is not valid:\n  ${e.message}\nFix the value it names and run this script again.`);
}
say(`  site.config.js: ok (brand "${C.brand}", languages ${C.languages.join(", ")}, ${C.sessionMinutes}-minute sessions)`);

// The values that the shipped example holds as placeholders: ONE list, src/placeholders.js, the same one the site uses to decide that
// it is "not configured yet". They are looked for in the VALUES of the loaded configuration, so a comment that mentions one never
// counts, and every hit names its key.
const left = findPlaceholders(C).map((p) => `${p.key}: ${JSON.stringify(p.value)}`);
if (left.length && !flag("--allow-placeholders")) {
  die(`site.config.js still contains placeholders. Replace each of these with your own value, then run this script again:\n${left.map((l) => `    ${l}`).join("\n")}\n(--allow-placeholders deploys a trial site anyway.)`);
}
if (left.length) say(`  warning: ${left.length} placeholder(s) left in site.config.js (allowed by --allow-placeholders):\n${left.map((l) => `    ${l}`).join("\n")}`);
const PRIVACY_WARNING = `WARNING: privacyReviewed is false in site.config.js. The privacy policy and the terms are a starting point written for another study:
  rewrite the study texts (docs/testi.md) and have the policy reviewed by your institution's data protection office BEFORE you
  open the site to participants. Then write privacyReviewed: true in site.config.js. Until then the admin panel keeps a to-do line.`;
if (!C.privacyReviewed) say(`\n  ${PRIVACY_WARNING.split("\n").join("\n  ")}\n`);

const v = run("npx", [...WRANGLER, "--version"], { capture: true });
if (v.status !== 0) die("npx wrangler@4 does not start. Check your Internet connection and that npm works (npm --version).");
say(`  wrangler ${DRY ? "(not checked in dry-run)" : v.out.trim().split("\n").pop()}: ok`);

// ---------------------------------------------------------------- 2. tests on the lab's own configuration
step(2, "Tests against your site.config.js");
if (flag("--no-tests")) say("  skipped (--no-tests)");
else {
  const t = run("node", ["scripts/test.mjs", "site.config.js", "--suite", "test-generic"], { capture: true });
  const sum = t.out.split("\n").filter((l) => /^(OK|FAILED):|^ℹ (tests|pass|fail)/.test(l)).join("\n  ");
  if (t.status !== 0) die(`the generic tests fail against your configuration:\n${t.out.split("\n").slice(-40).join("\n")}`);
  say(`  ${DRY ? "(dry-run)" : sum}`);
}

// ---------------------------------------------------------------- names
const confPath = join(root, "wrangler.jsonc");
let conf = readFileSync(confPath, "utf8");
const confGet = (re) => (conf.match(re) || [])[1];
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$/;
const DEFAULT_NAME = "approdo";
let project = opt("--project") || confGet(/^\s*"name":\s*"([^"]*)"/m);
if (!opt("--project") && (!project || project === DEFAULT_NAME) && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  say("\nChoose the name of your Worker. It becomes the address <name>.<your-subdomain>.workers.dev");
  say(`(lowercase letters, digits and hyphens, e.g. my-lab-study; press Enter to keep "${DEFAULT_NAME}").`);
  project = (await rl.question("Worker name: ")).trim() || DEFAULT_NAME;
  rl.close();
}
if (!project) die("choose a name: node scripts/setup.mjs --project your-name");
if (!NAME_RE.test(project)) die(`"${project}" is not a valid name (lowercase letters, digits, hyphens; at most 58 characters).`);
const confDb = confGet(/"database_name":\s*"([^"]*)"/);
const database = opt("--database") || (confDb && confDb !== DEFAULT_NAME ? confDb : project);
if (!NAME_RE.test(database)) die(`"${database}" is not a valid database name.`);
say(`\nWorker: ${project}   Database: ${database}`);

// ---------------------------------------------------------------- 3. Cloudflare login
step(3, "Cloudflare login");
let who = wr(["whoami", "--json"], { capture: true });
if (!DRY && who.status !== 0) {
  say("  You are not logged in. A browser window opens: log in to your Cloudflare account and click Allow.");
  const l = wr(["login"]);
  if (l.status !== 0) die("login did not complete. Run: npx --yes wrangler@4 login");
  who = wr(["whoami", "--json"], { capture: true });
  if (who.status !== 0) die("still not logged in after the login step.");
}
if (!DRY) {
  let accounts = [];
  try { accounts = JSON.parse(who.out.slice(who.out.indexOf("{"))).accounts || []; } catch { /* format changed: not essential */ }
  say(accounts.length ? `  logged in; account(s): ${accounts.map((a) => a.name).join(", ")}` : "  logged in");
  if (accounts.length > 1) say("  note: you have several accounts. If the next steps pick the wrong one, set CLOUDFLARE_ACCOUNT_ID=<id> and run again.");
}

// ---------------------------------------------------------------- 4. D1 database
step(4, "D1 database (EU jurisdiction)");
const listDbs = () => {
  const r = wr(["d1", "list", "--json"], { capture: true });
  if (r.status !== 0) die(`could not list the databases:\n${r.out}`);
  try { return JSON.parse(r.out.slice(r.out.indexOf("["))); } catch { die(`unexpected output from "d1 list --json":\n${r.out.slice(0, 600)}`); }
};
let dbId = DRY ? "00000000-0000-0000-0000-000000000000" : (listDbs().find((d) => d.name === database) || {}).uuid;
if (dbId && !DRY) say(`  database "${database}" already exists (${dbId}): reused`);
else {
  const c = wr(["d1", "create", database, "--jurisdiction", "eu"], { capture: true });
  if (!DRY) {
    if (c.status !== 0) die(`d1 create failed:\n${c.out}`);
    dbId = (listDbs().find((d) => d.name === database) || {}).uuid || (c.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
    if (!dbId) die("the database was created but its id could not be read. Run: npx --yes wrangler@4 d1 list   and write the id into wrangler.jsonc by hand.");
    say(`  created "${database}" (${dbId})`);
  }
}
// wrangler.jsonc is edited with plain text replacements so that its comments survive.
let nextConf = conf
  .replace(/^(\s*"name":\s*)"[^"]*"/m, `$1"${project}"`)
  .replace(/("database_name":\s*)"[^"]*"/, `$1"${database}"`);
if (/"database_id":/.test(nextConf)) nextConf = nextConf.replace(/("database_id":\s*)"[^"]*"/, `$1"${dbId}"`);
else nextConf = nextConf.replace(/(\n(\s*)"database_name":\s*"[^"]*")/, `$1,\n$2"database_id": "${dbId}"`);
if (nextConf !== conf) {
  if (DRY) say("  [dry-run] would write name, database_name and database_id into wrangler.jsonc");
  else { writeFileSync(confPath, nextConf); conf = nextConf; say("  wrangler.jsonc updated (name, database_name, database_id)"); }
} else say("  wrangler.jsonc already up to date");

// ---------------------------------------------------------------- 5. deploy
step(5, "Deploying the Worker");
let liveUrl = "";
if (flag("--no-deploy")) say("  deployment skipped (--no-deploy)");
else {
  // Shown live (a first deployment may ask you to choose your workers.dev subdomain) and also collected, to read the address.
  // The Worker creates its tables on the first request, so there is nothing to apply before or after this.
  if (DRY) wr(["deploy"]);
  else {
    const d = await runLive("npx", [...WRANGLER, "deploy"]);
    if (d.status !== 0) die("the deployment failed (see the messages above).");
    liveUrl = (d.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0] || "";
    if (liveUrl) say(`\n  The site answers at ${liveUrl}`);
  }
}

// ---------------------------------------------------------------- 6. what the human does now
step(6, "Your turn: the secrets, typed by you");
const sl = wr(["secret", "list", "--name", project, "--format", "json"], { capture: true });
const has = (k) => (DRY || sl.status !== 0 ? null : sl.out.includes(`"${k}"`));
const mark = (k) => (has(k) === null ? "" : has(k) ? "   (already set)" : "   (missing)");
say(`
Run these in your own terminal, in this folder. Each one asks you to type the value (nothing is shown while you
type) and stores it in Cloudflare. Nothing is written to any file. A secret applies at once: no new deployment is needed.

  1. npx --yes wrangler@4 secret put ADMIN_PASSWORD --name ${project}${mark("ADMIN_PASSWORD")}
     choose a password of at least 16 characters (a long sentence is fine). It opens the admin panel at /admin.

Optional e-mail relay (docs/posta.md explains each screen of Google Apps Script). First make a random key:
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  Copy it, paste it in Apps Script as the script property RELAY_KEY, and keep it for the next command.
  2. npx --yes wrangler@4 secret put MAIL_RELAY_KEY --name ${project}${mark("MAIL_RELAY_KEY")}      (paste the same key)
  3. npx --yes wrangler@4 secret put MAIL_RELAY_URL --name ${project}${mark("MAIL_RELAY_URL")}      (paste the web app address ending in /exec)

Optional bot check (Cloudflare Turnstile): TURNSTILE_SITEKEY and TURNSTILE_SECRET, same command. See README.md.
Optional: ADMIN_EMAIL, to receive the "someone booked" notices at an address other than contactEmail.

Finally, in Apps Script, run the function installReminder once (daily reminders), then open
  ${C.baseUrl || liveUrl || "https://<your-site-address>"}/admin
and check ${AT.set.summary} > "${AT.set.setupTitle}": every line should say "${AT.set.ready}".
${C.privacyReviewed ? "" : "\n" + PRIVACY_WARNING + "\n"}`);
if (DRY) say("(dry-run: nothing was run or changed)");
