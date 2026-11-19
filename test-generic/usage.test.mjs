// The anonymous usage count (src/usage.js): one tiny report a day, only from an authenticated admin page or the signed reminder call,
// only with a waitUntil, only when the count is on and the site is configured. Nothing here touches the network: the fetch is a recorder.
// The cases that depend on the configuration run in a scratch copy (usage.mjs) configured by the test, so they mean the same thing
// whichever configuration the suite runs against; the others follow C.usageCount.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import * as D from "../src/db.js";
import { handle } from "../src/app.js";
import { hmacHex, sha256Hex } from "../src/util.js";
import { PRODUCT_AUTHOR, PRODUCT_VERSION, PRODUCT_SITE, USAGE_URL } from "../src/product.js";
import { usageBody, installId, USAGE_INTERVAL_MS, USAGE_TIMEOUT_MS } from "../src/usage.js";
import { ADMIN_TEXT_SETS, AT } from "../src/admin_texts.js";
import { C, DAY, NOW, RELAY, setup, makeDB, req, text, adminSession, adminGet, withConfig } from "./helpers.mjs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const ON = C.usageCount !== false;
const onlyOn = { skip: ON ? false : "usageCount is false in this configuration" };
const H = 3600_000;
const at = (ms) => new Date(NOW.getTime() + ms);

// A collector that records every report; `answer` decides what it does.
function collector(answer = () => new Response(null, { status: 204 })) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init, json: JSON.parse(init.body) }); return answer(url, init); };
  return { fn, calls };
}
// An execution context that keeps what waitUntil is given, so a test can wait for it (or not).
function context(extra = {}) {
  const pending = [];
  return { waitUntil: (p) => { pending.push(p); }, pending, done: () => Promise.all(pending), ...extra };
}
const go = (env, request, now, ctx) => handle(request, env, { now, ignoreUnconfigured: true, ...ctx });
const sessionAt = async (env, now) => (await adminSession(env, now)).cookie;
// One admin page render with the report machinery switched on.
async function adminPage(env, now, fetchFn, ctx = context()) {
  const cookie = await sessionAt(env, now);
  const r = await go(env, req("/admin", { cookie }), now, { fetchFn, waitUntil: ctx.waitUntil });
  await ctx.done();
  return r;
}
const stamp = (DB) => D.getSetting(DB, "usage_ping_at");
const noCsrf = (html) => html.replace(/name="csrf" value="[^"]+"/g, 'name="csrf" value="-"');

test("an admin page sends one report, and no more than one in 20 hours", onlyOn, async () => {
  const { DB, env } = await setup();
  const col = collector();
  assert.equal((await adminPage(env, NOW, col.fn)).status, 200);
  assert.equal(col.calls.length, 1);
  assert.equal(await stamp(DB), NOW.toISOString());
  await adminPage(env, NOW, col.fn);
  await adminPage(env, at(10 * H), col.fn);
  await adminPage(env, at(USAGE_INTERVAL_MS - 60_000), col.fn);
  assert.equal(col.calls.length, 1, "still one 19 hours 59 minutes later");
  await adminPage(env, at(USAGE_INTERVAL_MS + 60_000), col.fn);
  assert.equal(col.calls.length, 2, "a second one after 20 hours");
  assert.equal(USAGE_INTERVAL_MS, 20 * H);
});

test("the report: one POST to the collector, a JSON body of exactly id, v and sessions, nothing else in the request", onlyOn, async () => {
  const { DB, env } = await setup();
  const col = collector();
  await adminPage(env, NOW, col.fn);
  assert.equal(col.calls.length, 1);
  const { url, init, json } = col.calls[0];
  assert.equal(url, USAGE_URL);
  assert.equal(url, "https://approdo-stats.nerln.workers.dev/ping");
  assert.deepEqual(Object.keys(json).sort(), ["id", "sessions", "v"]);
  assert.match(json.id, /^[0-9a-f]{32}$/);
  assert.equal(typeof json.v, "string");
  assert.match(json.v, /^\d+\.\d+\.\d+$/);
  assert.equal(json.v, PRODUCT_VERSION);
  assert.ok(Number.isInteger(json.sessions) && json.sessions >= 0);
  assert.equal(init.body, JSON.stringify({ id: json.id, v: PRODUCT_VERSION, sessions: json.sessions }), "the body is these three fields and nothing more");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "content-type": "application/json" }, "no cookie, no authorization, no other header");
  // "manual", never "error": the Workers runtime throws on redirect: "error" before sending anything
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted, "a timeout signal is attached");
  assert.equal(USAGE_TIMEOUT_MS, 4000);
  assert.deepEqual(Object.keys(init).sort(), ["body", "headers", "method", "redirect", "signal"], "no credentials, no referrer, nothing else");
  // nothing of the site is in the body
  const lower = init.body.toLowerCase();
  for (const w of [C.brand, C.contactEmail, C.responsible, C.org.group, C.org.university, C.timeZone, C.baseUrl || "https://study.example.org"]) assert.ok(!lower.includes(String(w).toLowerCase()), `the body does not hold ${w}`);
  assert.equal(await D.getSetting(DB, "install_id"), json.id);
});

test("install_id is made once, from random bytes, and stays the same; two installations never share one", onlyOn, async () => {
  const a = await setup(), b = await setup();
  const col = collector();
  await adminPage(a.env, NOW, col.fn);
  await adminPage(a.env, at(21 * H), col.fn);
  await adminPage(a.env, at(50 * H), col.fn);
  assert.equal(col.calls.length, 3);
  assert.equal(new Set(col.calls.map((c) => c.json.id)).size, 1, "the same identifier every time");
  const id = col.calls[0].json.id;
  assert.equal(await D.getSetting(a.DB, "install_id"), id);
  assert.equal(await installId(a.DB), id);
  const colB = collector();
  await adminPage(b.env, NOW, colB.fn);
  assert.notEqual(colB.calls[0].json.id, id);
});

test("the identifier is not derived from the HMAC key, the site address or the lab name", async () => {
  const a = await setup(), b = await setup();
  // two installations that hold the very same HMAC key still get different identifiers
  const key = await D.getKey(a.DB);
  await D.setSetting(b.DB, "hmac_key", key);
  const idA = await installId(a.DB), idB = await installId(b.DB);
  assert.notEqual(idA, idB);
  for (const id of [idA, idB]) {
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.ok(!key.includes(id));
    for (const seed of [key, `pw:${key}`, C.brand, C.baseUrl || "", C.contactEmail]) {
      assert.notEqual(id, (await hmacHex(key, seed)).slice(0, 32), "not an HMAC of anything the site knows");
      assert.notEqual(id, (await sha256Hex(seed)).slice(0, 32), "not a hash of anything the site knows");
    }
  }
  // the source does not read the key at all
  const src = read("src/usage.js").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/getKey|hmac/i.test(src), "src/usage.js never touches the HMAC key");
  assert.match(src, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
});

test("sessions counts every attended booking, the purged ones (kept in the tallies) included, and nothing else", async () => {
  const { DB } = await setup({}, { openDay: false });
  const ins = (id, date, status) => DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)")
    .run(id, id.padEnd(30, "x"), "study1", date, id.length > 3 ? "10:30" : "09:30", "X", `${id}@example.org`, `${id}@example.org`, status, NOW.toISOString(), C.languages[0]);
  assert.equal(JSON.parse(await usageBody(DB)).sessions, 0);
  ins("a1", DAY, "attended"); ins("a2", "2026-11-19", "attended"); ins("n1", "2026-11-20", "noshow"); ins("c1", "2026-11-21", "confirmed"); ins("x1", "2026-11-22", "cancelled");
  assert.equal(JSON.parse(await usageBody(DB)).sessions, 2);
  DB.raw.prepare("INSERT INTO tallies (study, week, status, n) VALUES ('study1', '2026-01-05', 'attended', 7), ('study2', '2026-01-12', 'attended', 4), ('study1', '2026-01-05', 'noshow', 9), ('study1', '2026-01-05', 'cancelled', 3)").run();
  assert.equal(JSON.parse(await usageBody(DB)).sessions, 2 + 7 + 4, "the tallies of the attended count too");
  // a purge moves bookings into the tallies: the total does not change
  ins("old", "2026-01-26", "attended");
  assert.equal(await D.attendedTotal(DB), 14);
  assert.ok((await D.purgeOldBookings(DB, "2026-02-01")) >= 1);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM bookings WHERE id = 'old'").get().n, 0, "the personal row is gone");
  assert.equal(await D.attendedTotal(DB), 14, "its session survives in the weekly tally");
  const body = JSON.parse(await usageBody(DB));
  assert.equal(body.sessions, 14);
  assert.ok(Number.isInteger(body.sessions));
});

test("a collector that fails, answers 500, refuses or hangs changes nothing the person sees", onlyOn, async () => {
  const modes = {
    throws: () => { throw new Error("offline"); },
    rejects: async () => Promise.reject(new TypeError("fetch failed")),
    http500: () => new Response("boom", { status: 500 }),
    redirect: () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
    notAResponse: () => undefined,
  };
  const baseline = await (async () => { const { env } = await setup(); return noCsrf(await text(await adminPage(env, NOW, collector().fn))); })();
  for (const [name, answer] of Object.entries(modes)) {
    const { DB, env } = await setup();
    const col = collector(answer);
    const cookie = await sessionAt(env, NOW);
    const ctx = context();
    const r = await go(env, req("/admin", { cookie }), NOW, { fetchFn: col.fn, waitUntil: ctx.waitUntil });
    assert.equal(r.status, 200, name);
    await assert.doesNotReject(ctx.done(), `${name}: the waitUntil promise never rejects`);
    assert.equal(col.calls.length, 1, name);
    // the page is the one a working collector gives (the "last sent" line is drawn before the report is taken, so it is the same)
    assert.equal(noCsrf(await text(r)), baseline, name);
    // a failed report is not hammered: the next try is a day later
    await adminPage(env, at(5 * H), col.fn);
    assert.equal(col.calls.length, 1, `${name}: not retried within the day`);
    await adminPage(env, at(21 * H), col.fn);
    assert.equal(col.calls.length, 2, `${name}: tried again the next day`);
    assert.equal(await stamp(DB), at(21 * H).toISOString());
  }
  // a collector that never answers: the page is served at once and the post is only pending
  const { env } = await setup();
  let seen = null;
  const hang = (url, init) => { seen = init.signal; return new Promise(() => {}); };
  const cookie = await sessionAt(env, NOW);
  const ctx = context();
  const winner = await Promise.race([go(env, req("/admin", { cookie }), NOW, { fetchFn: hang, waitUntil: ctx.waitUntil }).then((r) => r.status), new Promise((r) => setTimeout(() => r("late"), 3000))]);
  assert.equal(winner, 200, "the page does not wait for the collector");
  assert.equal(ctx.pending.length, 1);
  await new Promise((r) => setTimeout(r, 50)); // the post starts after the page has gone
  assert.ok(seen instanceof AbortSignal, "the post is cut off by a timeout signal");
});

test("a waitUntil that throws, or a database that fails while the report is taken, never breaks the page", onlyOn, async () => {
  const { env } = await setup();
  const col = collector();
  const cookie = await sessionAt(env, NOW);
  const r = await go(env, req("/admin", { cookie }), NOW, { fetchFn: col.fn, waitUntil: () => { throw new Error("no context"); } });
  assert.equal(r.status, 200);
  // the statement that takes the daily claim fails once: the page is served all the same
  const col2 = collector();
  const { DB, env: env2 } = await setup();
  const cookie2 = await sessionAt(env2, NOW);
  const realPrepare = DB.prepare.bind(DB);
  env2.DB = { ...DB, raw: DB.raw, batch: DB.batch.bind(DB), prepare: (sql) => { if (/usage_ping_at|INSERT INTO settings \(key, value\) VALUES \(\?1, \?2\) ON CONFLICT\(key\) DO UPDATE SET value = excluded.value\s+WHERE/.test(sql)) throw new Error("db down"); return realPrepare(sql); } };
  const r2 = await go(env2, req("/admin", { cookie: cookie2 }), NOW, { fetchFn: col2.fn, waitUntil: context().waitUntil });
  assert.equal(r2.status, 200);
  assert.equal(col2.calls.length, 0);
});

test("two admin pages at the same moment send one report", onlyOn, async () => {
  const { env } = await setup();
  const col = collector();
  const cookie = await sessionAt(env, NOW);
  const ctx = context();
  await Promise.all([1, 2, 3, 4].map(() => go(env, req("/admin", { cookie }), NOW, { fetchFn: col.fn, waitUntil: ctx.waitUntil })));
  await ctx.done();
  assert.equal(col.calls.length, 1);
});

test("a stored time that is not a time, or lies far in the future, does not block the reports for ever", onlyOn, async () => {
  for (const bad of ["garbage", "", "2999-01-01T00:00:00.000Z", String(NOW.getTime())]) {
    const { DB, env } = await setup();
    await D.setSetting(DB, "usage_ping_at", bad);
    const col = collector();
    await adminPage(env, NOW, col.fn);
    assert.equal(col.calls.length, 1, JSON.stringify(bad));
    assert.equal(await stamp(DB), NOW.toISOString());
  }
});

test("the signed reminder call of the mail relay is the other trigger; a refused call is not", onlyOn, async () => {
  const { DB, env } = await setup({ ...RELAY });
  const col = collector();
  const ctx = context();
  const cron = async (now, sigOverride, ts = now.getTime()) => {
    const body = JSON.stringify({ ts });
    const sig = sigOverride ?? (await hmacHex(RELAY.MAIL_RELAY_KEY, body));
    return go(env, new Request(`https://study.example.org/cron/remind?sig=${sig}`, { method: "POST", body }), now, { fetchFn: col.fn, waitUntil: ctx.waitUntil });
  };
  assert.equal((await cron(NOW, "0".repeat(64))).status, 403);
  assert.equal((await cron(NOW, undefined, NOW.getTime() - 10 * 60_000)).status, 403, "a stale call is refused too");
  await ctx.done();
  assert.equal(col.calls.length, 0, "nothing is sent for a refused call");
  assert.equal(await D.getSetting(DB, "usage_ping_at"), null);
  const ok = await cron(NOW);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  await ctx.done();
  assert.equal(col.calls.filter((c) => c.url === USAGE_URL).length, 1);
  await cron(at(1000));
  await ctx.done();
  assert.equal(col.calls.filter((c) => c.url === USAGE_URL).length, 1, "once in 20 hours here too");
});

// ---- the cases that must hold whatever the suite's own configuration says: run in a scratch copy ------------------------------
const REALISTIC = read("config/test-variants/realistic-edit.config.js");
const EXAMPLE = read("config/example-lab.config.js");
const script = readFileSync(new URL("./scripts/usage.mjs", import.meta.url), "utf8");
const scratch = (source) => { const r = withConfig(null, script, source); assert.equal(r.status, 0, r.err); return JSON.parse(r.out); };
const withKey = (source, line) => source.replace("export default {", `export default {\n${line}`);

test("a configured site with the count on: only the admin page with a waitUntil reports, never a participant's request", () => {
  const o = scratch(REALISTIC);
  assert.equal(o.usageCount, true);
  assert.equal(o.unconfigured, 0);
  for (const k of ["afterParticipants", "afterLoginPage", "afterNoWaitUntil"]) assert.deepEqual([o[k].calls, o[k].stamp, o[k].id], [0, null, null], `${k}: nothing sent, nothing written`);
  assert.equal(o.adminStatus, 200);
  assert.equal(o.afterAdmin.calls, 1);
  assert.match(o.afterAdmin.stamp, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(Object.keys(o.body).sort(), ["id", "sessions", "v"]);
});

test("usageCount: false sends nothing and writes nothing, whatever page is opened", () => {
  const o = scratch(withKey(REALISTIC, "  usageCount: false,"));
  assert.equal(o.usageCount, false);
  assert.equal(o.adminStatus, 200);
  for (const k of ["afterParticipants", "afterLoginPage", "afterNoWaitUntil", "afterAdmin"]) assert.deepEqual([o[k].calls, o[k].stamp, o[k].id], [0, null, null], k);
  assert.equal(o.body, null);
});

test("an installation still on the example values never reports", () => {
  const o = scratch(EXAMPLE);
  assert.ok(o.unconfigured > 0);
  assert.equal(o.adminStatus, 200, "the panel itself works");
  for (const k of ["afterParticipants", "afterLoginPage", "afterNoWaitUntil", "afterAdmin"]) assert.deepEqual([o[k].calls, o[k].stamp, o[k].id], [0, null, null], k);
});

test("without waitUntil nothing is sent, even from an admin page (the preview and the tests have none)", async () => {
  const { DB, env } = await setup();
  const col = collector();
  const cookie = await sessionAt(env, NOW);
  const r = await go(env, req("/admin", { cookie }), NOW, { fetchFn: col.fn });
  assert.equal(r.status, 200);
  assert.equal(col.calls.length, 0);
  assert.equal(await stamp(DB), null);
  // nor does it, with the usual helpers
  await adminGet(env, { cookie }, "");
  assert.equal(col.calls.length, 0);
});

test("the guard of the suites: the global fetch refuses to run, and the preview script gives handle() no waitUntil", () => {
  assert.throws(() => fetch("https://example.org/"), /network access is not allowed in tests/);
  const preview = read("scripts/preview.mjs").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/waitUntil/.test(preview), "scripts/preview.mjs never hands a waitUntil to the app");
  assert.match(preview, /makeDB\(\)/, "and it runs on an in-memory database");
  assert.ok(!/USAGE_URL|usage\.js/.test(preview));
});

// ---- the panel says it ------------------------------------------------------------------------------------------------------------
test("the Settings section states whether the count is on, what is sent, when it was last sent and how to switch it off", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const html = await adminGet(env, s, "?s=settings");
  const m = /<p class="note" id="usage-count">([^<]*)<\/p>/.exec(html);
  assert.ok(m, "the usage line is in the Settings section");
  const line = m[1].replace(/&#39;/g, "'");
  assert.equal(line, AT.set.usage(C.usageCount, null));
  assert.ok(line.includes("usageCount: false"), "it names the line to write");
  if (ON) {
    assert.match(line, /Approdo/);
    for (const re of [/identific/i, /versi[oó]n|versione/i, /sesion|session/i]) assert.match(line, re);
    // after a report it names the time
    const col = collector();
    const { DB, env: e2 } = await setup();
    await adminPage(e2, NOW, col.fn);
    const html2 = await adminGet(e2, await adminSession(e2, at(H)), "?s=settings", at(H));
    assert.ok(html2.includes(esc2(AT.set.usage(true, await stampOf(DB)))), "the last send is shown");
  }
});
const esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
async function stampOf(DB) {
  const { stampLocal } = await import("../src/slots.js");
  return stampLocal(await D.getSetting(DB, "usage_ping_at"));
}

test("the admin texts about the count exist in Spanish and in Italian, with the same facts and no dash used as a parenthesis", () => {
  for (const [lang, set] of Object.entries(ADMIN_TEXT_SETS)) {
    assert.equal(typeof set.set.usageTitle, "string", lang);
    const on = set.set.usage(true, "16/11 10:00"), off = set.set.usage(false, null), fresh = set.set.usage(true, null);
    for (const t of [on, off, fresh]) { assert.ok(t.includes("usageCount"), `${lang}: names the key`); assert.ok(!/[—–]| - /.test(t), `${lang}: no dash`); assert.ok(!/!/.test(t), lang); }
    assert.ok(on.includes("usageCount: false") && on.includes("16/11 10:00"), lang);
    assert.ok(off.includes("usageCount: false") && off.includes("usageCount: true"), lang);
    assert.notEqual(fresh, on);
  }
});

test("the public footer links to the product website, which set-owner.mjs leaves alone along with the collector address", async () => {
  const { env } = await setup();
  const html = await text(await go(env, req("/"), NOW, {}));
  assert.ok(html.includes(`href="${PRODUCT_SITE}"`), "Made with Approdo points to the product website");
  assert.equal(PRODUCT_SITE, "https://nerln.github.io/approdo/");
  const dir = mkdtempSync(join(tmpdir(), "approdo-usage-"));
  try {
    for (const p of ["scripts/set-owner.mjs", "README.md", "README.it.md", "package.json", "src/product.js"]) { mkdirSync(dirname(join(dir, p)), { recursive: true }); cpSync(new URL(p, root), join(dir, p)); }
    const r = spawnSync(process.execPath, ["scripts/set-owner.mjs", "my-lab"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const product = readFileSync(join(dir, "src/product.js"), "utf8");
    assert.ok(product.includes('PRODUCT_SITE = "https://nerln.github.io/approdo/"'));
    assert.ok(product.includes('USAGE_URL = "https://approdo-stats.nerln.workers.dev/ping"'));
    assert.ok(product.includes("github.com/my-lab/approdo"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(read("scripts/set-owner.mjs").slice(0, 900), /PRODUCT_SITE.*USAGE_URL|USAGE_URL.*PRODUCT_SITE/s, "the header of the script says that the two addresses are left alone");
  assert.match(read("src/product.js"), /NOT touch PRODUCT_SITE and USAGE_URL/);
});

// The licence (LICENSE, the Attribution Assurance License) asks for a display of the author's attribution: this line is it, on every public page.
test("every public page carries the credit line the licence asks for: the product name linked to its website and the author's name", async () => {
  const { env } = await setup();
  assert.equal(PRODUCT_AUTHOR, "nerln");
  const credit = /<p class="made">.*?<span>(Made with|Fatto con|Hecho con) <a href="https:\/\/nerln\.github\.io\/approdo\/" rel="noopener">Approdo<\/a> (by|di|de) nerln<\/span><\/p><\/footer>/s;
  const home = await text(await go(env, req("/"), NOW, {}));
  const paths = new Set(["/", "/this-page-does-not-exist"]);
  for (const m of home.matchAll(/<footer class="site-footer">.*?<\/footer>/gs)) for (const a of m[0].matchAll(/<a href="(\/[^"]*)"/g)) paths.add(a[1]);
  assert.ok(paths.size >= 5, "the footer links to the terms, the privacy text and the opt-out page: " + [...paths].join(" "));
  for (const p of paths) {
    const html = await text(await go(env, req(p), NOW, {}));
    assert.match(html, credit, `the credit line is on ${p}`);
  }
  const css = read("public/style.css");
  assert.doesNotMatch(css, /\.made\s*\{[^}]*(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]))/, "the shipped style sheet does not hide the credit");
  const example = read("site.config.js");
  assert.doesNotMatch(example, /madeWith|madeBy/, "the example configuration does not override the credit texts");
});

test("the version of package.json, of package-lock.json, of CITATION.cff and of src/product.js is one and the same", () => {
  assert.match(read("CITATION.cff"), new RegExp(`^version: "${PRODUCT_VERSION.replace(/\\./g, "\\\\.")}"$`, "m"));
  const pkg = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.version, PRODUCT_VERSION);
  assert.equal(lock.version, PRODUCT_VERSION);
  assert.equal(lock.packages[""].version, PRODUCT_VERSION);
  assert.match(PRODUCT_VERSION, /^\d+\.\d+\.\d+$/);
});

test("usageCount is a boolean key of the configuration, true by default", async () => {
  const { normalizeConfig } = await import("../src/config.js");
  const { rawConfig } = await import("./helpers.mjs");
  const c = rawConfig();
  delete c.usageCount;
  assert.equal(normalizeConfig(c).usageCount, true);
  assert.equal(normalizeConfig({ ...c, usageCount: false }).usageCount, false);
  assert.equal(normalizeConfig({ ...c, usageCount: true }).usageCount, true);
  for (const v of ["no", 0, null, "false", []]) assert.throws(() => normalizeConfig({ ...c, usageCount: v }), /usageCount must be true or false/);
  assert.match(read("config/example-lab.config.js"), /^  usageCount: true,$/m);
  assert.match(read("config/test-variants/no-usage-count.config.js"), /"usageCount": false/);
});
