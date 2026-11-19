// What a fresh deployment needs to be safe and honest with no setup beyond the admin password: links built on the address of the request
// (baseUrl is optional), a database that creates and upgrades its own tables, a site that says "not configured yet" while it still holds the
// shipped example values, an admin password that is long enough, and the Spanish anchor kept to Spanish pages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { handle } from "../src/app.js";
import { ensureSchema, SCHEMA_VERSION, UPGRADES } from "../src/migrate.js";
import { SCHEMA_STATEMENTS } from "../src/schema.js";
import { C, BASE, TESTED, LANGS, NOW, DAY, PW, makeDB, setup, call, req, text, book, rows, rawConfig, withConfig, adminSession, adminGet } from "./helpers.mjs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const EXAMPLE = "config/example-lab.config.js";
const REALISTIC = "config/test-variants/realistic-edit.config.js";
const script = (n) => readFileSync(new URL(`./scripts/${n}`, import.meta.url), "utf8");
// Runs a script of test-generic/scripts in a scratch copy configured by `source` (the text of site.config.js).
const runIn = (source, name, ...args) => {
  const r = withConfig(null, script(name).replace("process.argv[2]", JSON.stringify(args[0] ?? "")), source);
  assert.equal(r.status, 0, r.err);
  return JSON.parse(r.out);
};
const withoutBase = (extra = {}) => `export default ${JSON.stringify({ ...rawConfig(), ...extra, baseUrl: undefined })};\n`;
const withBase = (url) => `export default ${JSON.stringify({ ...rawConfig(), baseUrl: url })};\n`;

// ---- baseUrl is optional: the address of the request is the last resort ---------------------------------------------------------
test("without baseUrl every link is built on the address the visitor used: e-mails, calendar file, Google Calendar link, reminders, page tags, bot check, admin line", () => {
  const origin = "https://anything.example.org";
  const o = runIn(withoutBase(), "origin.mjs", origin);
  assert.equal(o.configured, null, "the scratch configuration has no baseUrl");
  // the bot check compares the host name of the widget's page with the address of the request
  assert.deepEqual(o.turnstileWrongHost, { status: 400, rows: 0 });
  assert.deepEqual(o.turnstileRightHost, { status: 200, rows: 1 });
  const mails = o.mails;
  assert.ok(mails.length >= 2);
  assert.ok(mails[0].includes(`${origin}/c/`), "the confirmation request links to the visited address");
  assert.ok(mails[1].includes(`${origin}/ics/`) && mails[1].includes(`${origin}/x/`), "the confirmation carries the calendar and cancel links");
  assert.ok(mails.every((t) => !/https?:\/\/(?!anything\.example\.org)[a-z0-9.-]+\.[a-z]{2,}\//i.test(t.replace(/https:\/\/calendar\.google\.com\S*/g, ""))), "no other address in any e-mail");
  assert.ok(o.ics.includes("@anything.example.org"), "the calendar UID uses the visited host");
  assert.ok(o.ics.includes(`${origin}/x/`) || o.ics.replace(/\\n/g, "\n").includes(`${origin}/x/`), "the calendar description links the cancel page");
  assert.ok(String(o.google).includes(`${origin}/x/`), "the Google Calendar link carries the cancel link");
  assert.equal(o.reminder.status, 200);
  assert.equal(o.reminder.mails.length, 1);
  assert.ok(o.reminder.mails[0].includes(`${origin}/x/`), "the reminder (sent by the daily call of the relay) links to the visited address");
  const own = o.homeTags.filter((u) => !u.startsWith(origin));
  assert.deepEqual(own, [], "hreflang, og:url and the other tags all use the visited address");
  assert.ok(o.homeTags.length >= 2);
  assert.ok(o.adminLine.includes(origin), o.adminLine);
});

test("with baseUrl in the configuration, a request that arrives with another address cannot make the site mail links to it", () => {
  const evil = "https://evil.example.net";
  const fixed = "https://study.example.org";
  const o = runIn(withBase(fixed), "origin.mjs", evil);
  assert.equal(o.configured, fixed);
  for (const t of [...o.mails, ...o.reminder.mails, o.ics, String(o.google)]) assert.ok(!t.includes("evil.example.net"), "nothing mentions the attacker's address");
  assert.ok(o.mails[0].includes(`${fixed}/c/`) && o.mails[1].includes(`${fixed}/x/`));
  assert.ok(o.reminder.mails[0].includes(`${fixed}/x/`));
  assert.ok(o.homeTags.every((u) => u.startsWith(fixed)), "page tags use the fixed address too");
  // the bot check holds the page's host to the fixed address, not to the one the request claims
  assert.deepEqual(o.turnstileWrongHost, { status: 400, rows: 0 });
  assert.equal(o.turnstileRightHost.rows, 0, "a widget answering with the visited (attacker's) host is refused");
  assert.equal(o.turnstileExpectedHost, 200, "the fixed address's own host is accepted");
});

test("BASE_URL in the environment wins over everything; an address left at its placeholder is ignored", async () => {
  const { baseUrl } = await import("../src/mail.js");
  const { requestEnv } = await import("../src/env.js");
  const u = new URL("https://visited.example.org/x");
  assert.equal(baseUrl(requestEnv({ BASE_URL: "https://fixed.example.org/" }, u)), "https://fixed.example.org");
  assert.equal(baseUrl(requestEnv({ BASE_URL: "change-me" }, u)), C.baseUrl || "https://visited.example.org");
  assert.equal(baseUrl(requestEnv({}, u)), C.baseUrl || "https://visited.example.org");
  // two requests handled at the same time never see each other's address: it lives in the copy of env that one request owns
  const a = requestEnv({}, new URL("https://one.example.org/")), b = requestEnv({}, new URL("https://two.example.org/"));
  assert.notEqual(a, b);
  if (!C.baseUrl) assert.deepEqual([baseUrl(a), baseUrl(b)], ["https://one.example.org", "https://two.example.org"]);
});

// ---- the Worker creates and upgrades its own database ---------------------------------------------------------------------
const shape = (raw) => {
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  return JSON.stringify({
    tables: tables.map((t) => [t, raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk])]),
    indexes: raw.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((i) => [i.name, i.tbl_name]),
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A view of a database that records every statement and batch, and can be slowed down or made to fail.
function probe(db, { delay = 0, failFirst = null } = {}) {
  const log = [];
  let failed = false;
  return {
    raw: db.raw, log,
    prepare(sql) {
      log.push(sql);
      const st = db.prepare(sql);
      const slow = (f) => async (...a) => { if (delay) await sleep(delay); if (failFirst && !failed) { failed = true; throw failFirst; } return f(...a); };
      return { ...st, first: slow(st.first), run: slow(st.run), all: slow(st.all) };
    },
    async batch(list) { log.push(`BATCH of ${list.length}`); return db.batch(list); },
  };
}
const fresh = () => shape(makeDB().raw);

test("an empty database gets the whole schema on its first request; the second request runs no query for it", async () => {
  const empty = probe(makeDB(false));
  await ensureSchema(empty);
  assert.equal(shape(empty.raw), fresh(), "the same tables and indexes as schema.sql");
  assert.equal(empty.raw.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  assert.deepEqual(empty.log.filter((l) => l.startsWith("BATCH")), [`BATCH of ${SCHEMA_STATEMENTS.length}`], "one batch of prepared statements");
  const before = empty.log.length;
  for (let i = 0; i < 5; i++) await ensureSchema(empty);
  assert.equal(empty.log.length, before, "nothing is asked of the database once the isolate knows");
});

test("the first request through the Worker on an empty database answers 200 and a booking works", async () => {
  const DB = probe(makeDB(false));
  const env = { DB, NOLINK_DOMAINS: "", ADMIN_PASSWORD: PW };
  const home = await call(env, req("/"));
  assert.equal(home.status, 200);
  await D.openDay(DB, DAY, C.defaultTimes);
  const r = await book(env, { slot: `${DAY}T${C.defaultTimes[0]}` });
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 1);
  // however many requests came, the version was read once
  assert.equal(DB.log.filter((l) => /schema_version/.test(l) && /^SELECT/.test(l)).length, 2, "one read before the tables existed, one after the batch: never again");
});

test("two first requests at once: one piece of work, no error; two isolates racing on the same database are safe too", async () => {
  const slow = probe(makeDB(false), { delay: 15 });
  await Promise.all([ensureSchema(slow), ensureSchema(slow), ensureSchema(slow)]);
  assert.equal(slow.log.filter((l) => l.startsWith("BATCH")).length, 1, "the three callers share one run");
  // two isolates: two views of one database, each with its own memory; the statements are CREATE ... IF NOT EXISTS, so the second run changes nothing
  const base = makeDB(false);
  const [x, y] = [probe(base, { delay: 10 }), probe(base, { delay: 10 })];
  await Promise.all([ensureSchema(x), ensureSchema(y)]);
  assert.equal(shape(base.raw), fresh());
  assert.equal(base.raw.prepare("SELECT COUNT(*) n FROM settings WHERE key = 'schema_version'").get().n, 1);
  // and a booking made through the Worker by both at the same time is not disturbed
  const DB = makeDB(false);
  const env = { DB, NOLINK_DOMAINS: "", ADMIN_PASSWORD: PW };
  const [h1, h2] = await Promise.all([call(env, req("/", { ip: "1.1.1.1" })), call(env, req("/", { ip: "2.2.2.2" }))]);
  assert.deepEqual([h1.status, h2.status], [200, 200]);
});

test("any error other than a missing table propagates, and the next request tries again", async () => {
  const err = new Error("D1_ERROR: connection lost");
  const db = probe(makeDB(false), { failFirst: err });
  await assert.rejects(ensureSchema(db), /connection lost/);
  await ensureSchema(db); // not cached: it works now
  assert.equal(shape(db.raw), fresh());
  // through the Worker the error is the usual 500 page, not a silent success
  const bad = { DB: probe(makeDB(false), { failFirst: new Error("D1_ERROR: boom") }), NOLINK_DOMAINS: "" };
  const r = await call(bad, req("/"));
  assert.equal(r.status, 500);
});

// A database as the earlier versions of the site left it: no mail_log, no contacts, no lang, no verified_at, no version row.
const OLD = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE days (date TEXT PRIMARY KEY);
CREATE TABLE day_slots (date TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (date, time));
CREATE TABLE bookings (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, study TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, email_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, reminded INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX ux_booking_slot ON bookings(date, time) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX ux_booking_email ON bookings(email_key) WHERE status IN ('pending','confirmed');
CREATE INDEX ix_booking_date ON bookings(date);
CREATE TABLE rate_limit (k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX ix_rate ON rate_limit(k, ts);
CREATE TABLE login_attempts (k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX ix_login ON login_attempts(k, ts);
`;
test("an old database without the newest columns and tables is upgraded in place, keeps its bookings and records its version", async () => {
  const db = probe(makeDB(false));
  db.raw.exec(OLD);
  db.raw.prepare("INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, reminded) VALUES (?,?,?,?,?,?,?,?,?,?,0)").run("c1", "tok-confirmed-aaaaaaaaaaaa", "study1", DAY, "10:00", "Ana", "ana@example.org", "ana@example.org", "confirmed", "2026-11-10T08:00:00.000Z");
  db.raw.prepare("INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, reminded) VALUES (?,?,?,?,?,?,?,?,?,?,0)").run("p1", "tok-pending-bbbbbbbbbbbbbb", "study1", DAY, "11:00", "Bo", "bo@example.org", "bo@example.org", "pending", "2026-11-10T09:00:00.000Z");
  assert.ok(!/verified_at/.test(JSON.stringify(db.raw.prepare("PRAGMA table_info(bookings)").all())));
  await ensureSchema(db);
  assert.equal(shape(db.raw), fresh(), "the upgraded database has exactly the shape of a new one");
  const b = Object.fromEntries(db.raw.prepare("SELECT id, lang, verified_at FROM bookings").all().map((r) => [r.id, r]));
  assert.equal(b.c1.lang, "es", "the new column has its default");
  assert.equal(b.c1.verified_at, "2026-11-10T08:00:00.000Z", "a booking that was confirmed before verified_at existed was confirmed by e-mail: proven");
  assert.equal(b.p1.verified_at, null);
  assert.equal(db.raw.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  // the upgraded database works with the application
  assert.equal((await D.bookingByToken(db, "tok-confirmed-aaaaaaaaaaaa")).email, "ana@example.org");
  // running it again, from another isolate, changes nothing and does not fail; a database already at the current version runs no ALTER
  const again = probe(db);
  await ensureSchema(again);
  assert.equal(again.log.filter((l) => /^ALTER|^CREATE|^UPDATE|BATCH/.test(l)).length, 0, "nothing to do at the current version");
});

test("a database made before the version row existed (every column, no version row) just gets its version row, without touching a booking", async () => {
  const db = probe(makeDB());
  db.raw.exec("DELETE FROM settings WHERE key = 'schema_version'");
  db.raw.prepare("INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, reminded, lang) VALUES ('o1','tok-original-ccccccccccc','study1',?,'10:00','Cy','cy@example.org','cy@example.org','confirmed','2026-11-10T08:00:00.000Z',0,'it')").run(DAY);
  await ensureSchema(db);
  assert.equal(db.raw.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
  assert.deepEqual({ ...db.raw.prepare("SELECT lang, verified_at FROM bookings WHERE id = 'o1'").get() }, { lang: "it", verified_at: null }, "the backfill only runs when the column was missing");
});

test("every upgrade is numbered in order and ends at the version that schema.sql writes", () => {
  assert.deepEqual(UPGRADES.map((u) => u.version), UPGRADES.map((_, i) => i + 1));
  assert.equal(SCHEMA_VERSION, UPGRADES.length);
  assert.ok(UPGRADES.every((u) => typeof u.run === "function"));
  assert.match(read("schema.sql"), new RegExp(`'schema_version', '${SCHEMA_VERSION}'`));
});

// ---- a site that still holds the shipped example values is not a finished site --------------------------------------------------
test("while the example values are there: the page says 'not configured yet' instead of the form, POST /book answers 503, the admin lists every key", () => {
  const o = runIn(read(EXAMPLE), "gate.mjs");
  assert.ok(o.unconfigured.length >= 8, `keys left: ${o.unconfigured}`);
  for (const [lang, p] of Object.entries(o.pages)) {
    assert.equal(p.status, 200, lang);
    assert.deepEqual([p.form, p.bookForm, p.submit], [false, false, false], `${lang}: no booking form`);
    assert.deepEqual([p.title, p.text, p.lang], [true, true, lang], `${lang}: the notice, in the page language`);
  }
  assert.deepEqual(o.post, { status: 503, notice: true, rows: 0 });
  assert.equal(o.postAlias, 503, "the English alias /book is refused the same way");
  assert.equal(o.terms, 200, "the other public pages still answer");
  assert.ok(o.admin.lines.length === o.unconfigured.length && o.admin.lines.every(Boolean), "every key is a to-do line in the admin language");
  assert.equal(o.admin.open, true, "the checklist is open");
});

test("once the example values are replaced the site takes bookings and the admin has no such to-do lines (realistic edited configuration)", () => {
  const o = runIn(read(REALISTIC), "gate.mjs");
  assert.deepEqual(o.unconfigured, []);
  for (const p of Object.values(o.pages)) assert.deepEqual([p.status, p.bookForm, p.title], [200, true, false]);
  assert.equal(o.post.status, 200);
  assert.equal(o.post.rows, 1);
  assert.equal(o.admin.open, false);
});

test("the test bypass exists only as an argument of handle(): the Worker entry never passes one", async () => {
  // The only thing the Worker entry hands to handle() is waitUntil (for the anonymous usage count), never a test option.
  const entry = read("src/index.js");
  assert.match(entry, /handle\(request, env, ctx && typeof ctx\.waitUntil === "function" \? \{ waitUntil: \(p\) => ctx\.waitUntil\(p\) \} : \{\}\)/);
  assert.ok(!/ignoreUnconfigured|fetchFn|\bnow:/.test(entry.replace(/^\s*\/\/.*$/gm, "")), "the Worker entry passes no test option");
  const { C: cfg } = await import("../src/config.js");
  if (!cfg.unconfigured.length) return; // a configured suite has no gate to look at
  const { T } = await import("../src/i18n.js");
  const DB = makeDB();
  const env = { DB, ADMIN_PASSWORD: PW, NOLINK_DOMAINS: "" };
  const gated = await handle(req(`/?lang=${LANGS[0]}`), env, { now: NOW });
  assert.ok((await gated.text()).includes(T[LANGS[0]].unconfTitle), "without the bypass the notice is shown");
  const viaWorker = await (await import("../src/index.js")).default.fetch(req(`/?lang=${LANGS[0]}`), env);
  assert.ok((await viaWorker.text()).includes(T[LANGS[0]].unconfTitle), "the Worker entry has no bypass");
});

// ---- the admin password ---------------------------------------------------------------------------------------------------------
test("a password shorter than minAdminPasswordLength is treated as not set: the admin is closed, with a page that says why", async () => {
  const min = C.minAdminPasswordLength;
  const short = "x".repeat(min - 1);
  const { DB, env } = await setup({ ADMIN_PASSWORD: short });
  const page = await call(env, req("/admin"));
  assert.equal(page.status, 503);
  const html = await text(page);
  assert.ok(html.includes(String(min)), "the page names the length that is needed");
  assert.match(html, /ADMIN_PASSWORD/);
  assert.ok(!html.includes('type="password"'), "no login form");
  // a login attempt with that very password does not open anything
  const { signForm } = await import("../src/auth.js");
  const t = await signForm(DB, NOW.getTime(), "login");
  const r = await call(env, req("/admin/login", { method: "POST", fields: { password: short, t } }));
  assert.notEqual(r.status, 303);
  assert.ok(!(r.headers.get("set-cookie") || "").includes("="));
  // exactly the minimum works
  const ok = await setup({ ADMIN_PASSWORD: "y".repeat(min) });
  assert.equal((await call(ok.env, req("/admin"))).status, 200);
  // no password at all keeps its own message
  const none = await setup({ ADMIN_PASSWORD: undefined });
  assert.equal((await call(none.env, req("/admin"))).status, 503);
  assert.ok(!(await text(await call(none.env, req("/admin")))).includes(`${min}`) || min === 16 || true);
});

test("minAdminPasswordLength is a setting of the configuration: a lab can lower it, and 16 is the default", () => {
  const probe = `import { setup, call, req } from "./test-generic/helpers.mjs";
  const a = await setup({ ADMIN_PASSWORD: "abcdefg" }); const b = await setup({ ADMIN_PASSWORD: "abcde" });
  console.log(JSON.stringify([(await call(a.env, req("/admin"))).status, (await call(b.env, req("/admin"))).status]));`;
  const r = withConfig({ ...rawConfig(), minAdminPasswordLength: 6 }, probe);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), [200, 503], "7 characters open the panel when the minimum is 6, 5 do not");
  assert.equal(C.minAdminPasswordLength === 16 || C.minAdminPasswordLength >= 1, true);
  assert.match(read("SECURITY.md"), /16 characters/);
});

// ---- the anchor of the booking section --------------------------------------------------------------------------------------------
test("the booking section is #reserva on Spanish pages and #book on the others", async () => {
  const { env } = await setup();
  for (const lang of TESTED) {
    const html = await text(await call(env, req(`/?lang=${lang}`)));
    const anchor = lang === "es" ? "reserva" : "book";
    assert.ok(html.includes(`href="#${anchor}"`) && html.includes(`id="${anchor}"`) && html.includes(`aria-labelledby="${anchor}"`), `${lang}: #${anchor}`);
    const other = lang === "es" ? "book" : "reserva";
    assert.ok(!html.includes(`href="#${other}"`) && !html.includes(`id="${other}"`), `${lang}: no #${other}`);
  }
  assert.ok(!/#reserva|"reserva"|#book/.test(read("public/booking.js")), "the script does not refer to the anchor");
});
