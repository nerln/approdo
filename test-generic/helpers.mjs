// Helpers of the config-agnostic suite: nothing here assumes a lab, a language, a time zone or a session length.
// Expectations are always read from the configuration (C) that the suite is running against.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { handle } from "../src/app.js";
import { C } from "../src/config.js";
import { hasBuiltinTexts } from "../src/i18n.js";
import { localToUtc, addMinutes, hhmmToMin, SLOT_MINUTES } from "../src/slots.js";

// No test may reach the network: the global fetch is replaced by a function that throws. A test that needs a fetch injects its own
// (fetchFn of handle(), see call() below); the code under test never calls the global one when it is given a fetchFn.
// The anonymous usage count (src/usage.js) is covered by the same rule: it posts through that injected fetch.
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network access is not allowed in tests: inject a fetchFn"); };
// The one exception: a test that talks to a server it started itself on this computer (the preview script) uses this, which refuses any other host.
export const loopbackFetch = (url, init) => {
  const host = new URL(String(url)).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error(`network access is not allowed in tests: ${host}`);
  return nativeFetch(url, init);
};

export { C };
// The address the tests visit: the configured one, or (when baseUrl is left out, as in the shipped example) an invented origin.
// Every link of the site is then built on it, because the origin of the request is the last resort of baseUrl().
export const BASE = C.baseUrl || "https://study.example.org";
export const LANGS = C.languages;
// Configured languages with built-in texts (all of es, en and it have them): the language-dependent tests run for each.
export const TESTED = LANGS.filter(hasBuiltinTexts);

// Adapter that mimics the D1 API on in-memory SQLite.
// With schema false the database is empty, as Cloudflare creates it on deploy: the Worker has to create its own tables.
export function makeDB(schema = true) {
  const db = new DatabaseSync(":memory:");
  if (schema) db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    // Like D1, a prepared statement can be run as it is or after bind(); db.batch() runs a list of them in order.
    // Like D1, nothing is compiled before the statement runs (a batch may create a table and an index on it).
    prepare(sql) {
      let compiled;
      const st = { run: (...a) => (compiled ??= db.prepare(sql)).run(...a), all: (...a) => (compiled ??= db.prepare(sql)).all(...a), get: (...a) => (compiled ??= db.prepare(sql)).get(...a) };
      const bound = (a) => ({
        async run() { const r = st.run(...a); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { return { results: st.all(...a).map((x) => ({ ...x })) }; },
        async first() { const x = st.get(...a); return x ? { ...x } : null; },
      });
      return { sql, bind: (...a) => bound(a), ...bound([]) };
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

// A Monday, 10:00 local time of the configured zone; DAY is the Wednesday after it.
export const MONDAY = "2026-11-16";
export const DAY = "2026-11-18";
export const at = (date, time, plusMinutes = 0) => new Date(localToUtc(date, time).getTime() + plusMinutes * 60000);
export const NOW = at(MONDAY, "10:00");
export const PW = "a-long-test-password-123";
export const RELAY = { MAIL_RELAY_URL: "https://relay.example/exec", MAIL_RELAY_KEY: "k".repeat(64) };
// By default no domain is link-free, so every e-mail carries its links; tests of that feature pass NOLINK_DOMAINS: undefined.
export const ENV = (DB, extra = {}) => ({ DB, NOLINK_DOMAINS: "", ADMIN_PASSWORD: PW, ...extra });

export async function setup(extra = {}, { openDay = true, times = C.defaultTimes } = {}) {
  const DB = makeDB();
  if (openDay) await D.openDay(DB, DAY, times);
  return { DB, env: ENV(DB, extra) };
}

// Fake relay (and Turnstile): records what would be mailed.
export function relay(decide = () => ({ ok: true })) {
  const calls = [];
  const fn = async (url, init) => {
    const json = JSON.parse(init.body);
    calls.push({ url: String(url), json });
    return new Response(JSON.stringify(typeof decide === "function" ? decide(json, calls.length) : decide));
  };
  return { fn, calls };
}

export function req(path, { method = "GET", fields, ip = "1.2.3.4", cookie, lang } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (cookie) headers.cookie = cookie;
  if (lang) headers["accept-language"] = lang;
  const init = { method, headers };
  if (fields) { init.body = new URLSearchParams(fields); headers["content-type"] = "application/x-www-form-urlencoded"; }
  return new Request(BASE + path, init);
}
// A test that does not pass a fake relay can never reach the network: a mail attempt just fails with "network".
const NO_NETWORK = async () => { throw new Error("network access is not allowed in tests"); };
// ignoreUnconfigured: a configuration that still holds the shipped example values (the example itself) would answer "not configured
// yet" to every booking; the suites that exercise bookings must run against it too. The tests of that gate call handle() themselves.
export const call = (env, r, now = NOW, fetchFn = NO_NETWORK) => handle(r, env, { now, fetchFn, ignoreUnconfigured: true });
export const text = (r) => r.text();

let n = 0;
export const uniqueEmail = () => `person${++n}@example.org`;
let ipn = 0;
export const freshIp = () => `10.1.${Math.floor(++ipn / 250)}.${ipn % 250}`;

export async function bookFields(DB, o = {}, now = NOW) {
  return {
    slot: `${DAY}T${C.defaultTimes[0]}`, name: "Test Person", email: uniqueEmail(), noepi: "1", vestibular: "1", accept: "1", web: "",
    t: await signForm(DB, now.getTime() - 10_000), ...o,
  };
}
// Posts the booking form. `lang` goes in the query string (an explicit choice, as the page links do).
export async function book(env, o = {}, { now = NOW, ip = freshIp(), fetchFn, lang } = {}) {
  return call(env, req("/reservar" + (lang ? `?lang=${lang}` : ""), { method: "POST", fields: await bookFields(env.DB, o, now), ip }), now, fetchFn);
}
export const rows = (DB) => DB.raw.prepare("SELECT * FROM bookings ORDER BY time").all();
export const tokenFrom = (html) => /\/(?:c|x|ics)\/([A-Za-z0-9_-]{20,})/.exec(html)?.[1];

export async function adminSession(env, now = NOW) {
  const t = await signForm(env.DB, now.getTime(), "login");
  const r = await call(env, req("/admin/login", { method: "POST", fields: { password: env.ADMIN_PASSWORD, t }, ip: "9.9.9.9" }), now);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const dash = await call(env, req("/admin", { cookie }), now);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await dash.text())[1];
  return { cookie, csrf };
}
export const adminDo = (env, s, action, extra = {}, now = NOW, fetchFn) =>
  call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: action, ...extra } }), now, fetchFn);
// The panel is split in sections (?s=). The helper asks for every section on one page ("s=all") unless the query names a section.
const allSections = (qs) => (/[?&]s=/.test(qs) ? qs : `${qs}${qs.includes("?") ? "&" : "?"}s=all`);
export const adminGet = async (env, s, qs = "", now = NOW) => text(await call(env, req(`/admin${allSections(qs)}`, { cookie: s.cookie }), now));
export const code = (r) => new URL(r.headers.get("location"), "https://x.invalid").searchParams.get("m");

// Times used by the slot-rule tests, derived from the config: A is a start time, NEAR is inside the calendar time it blocks,
// NEXT is the first start that no longer overlaps it.
export const A = C.defaultTimes[Math.max(0, C.defaultTimes.length - 2)];
export const NEAR = addMinutes(A, SLOT_MINUTES > 30 ? SLOT_MINUTES - 30 : Math.max(1, Math.floor(SLOT_MINUTES / 2)));
export const NEXT = addMinutes(A, SLOT_MINUTES);
export const minutesBetween = (a, b) => hhmmToMin(b) - hhmmToMin(a);

// Runs `script` (an ES module body) in a scratch copy of src/ configured with `cfg` (a plain object, written as JSON to
// site.config.js). For tests that need a configuration different from the one the suite runs against.
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// `configSource`, when given, is the whole text of site.config.js (for values JSON cannot carry, such as an own "__proto__" key).
export function withConfig(cfg, script, configSource) {
  const dir = mkdtempSync(join(tmpdir(), "approdo-cfg-"));
  try {
    cpSync(new URL("../src", import.meta.url), join(dir, "src"), { recursive: true });
    cpSync(new URL("../schema.sql", import.meta.url), join(dir, "schema.sql"));
    cpSync(new URL("../test-generic", import.meta.url), join(dir, "test-generic"), { recursive: true }); // so `script` can use these helpers
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(join(dir, "site.config.js"), configSource ?? `export default ${JSON.stringify(cfg)};\n`);
    writeFileSync(join(dir, "run.mjs"), script);
    const r = spawnSync(process.execPath, ["--no-warnings", "run.mjs"], { cwd: dir, encoding: "utf8" });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// The raw configuration object the suite runs against (a deep copy, safe to edit).
import raw from "../site.config.js";
// The organisation names are flattened to the first language's text, so a test may change "languages" freely.
export const rawConfig = () => {
  const c = JSON.parse(JSON.stringify(raw));
  for (const [k, v] of Object.entries(c.org)) if (v && typeof v === "object") c.org[k] = v[c.languages[0]];
  return c;
};
