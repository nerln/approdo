import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeDB } from "../../test/helpers.mjs";
import { handle } from "../src/index.js";
import worker from "../src/index.js";

const NOW = new Date("2026-11-18T12:34:56Z");
const hex = (n) => n.toString(16).padStart(32, "0");
const body = (o) => JSON.stringify(o);
const post = (env, payload, now = NOW, init = {}) =>
  handle(new Request("https://approdo-stats.example/ping", { method: "POST", headers: { "content-type": "application/json" }, body: typeof payload === "string" ? payload : body(payload), ...init }), env, { now });
const get = (env, path, now = NOW, method = "GET") =>
  handle(new Request("https://approdo-stats.example" + path, { method }), env, { now });
const mk = () => ({ DB: makeDB() });
// A rejected ping never touches the database, so the table may not exist yet: that also means nothing was stored.
const rows = (env) => {
  try { return env.DB.raw.prepare("SELECT * FROM installs ORDER BY id").all().map((r) => ({ ...r })); }
  catch (e) { if (/no such table/.test(String(e.message))) return []; throw e; }
};
const good = (n, extra = {}) => ({ id: hex(n), v: "0.2.0", sessions: 10, ...extra });
const stats = async (env, now = NOW) => (await get(env, "/stats.json", now)).json();
const dayAt = (d) => new Date(d + "T10:00:00Z");
const addDays = (d, n) => new Date(dayAt(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
// An established installation: reported on seven consecutive days, the last one on endDay.
const seed = async (env, n, sessions, endDay) => {
  for (let k = 6; k >= 0; k--) await post(env, good(n, { sessions }), dayAt(addDays(endDay, -k)));
};

test("a valid ping stores one row and answers 204 with an empty body", async () => {
  const env = mk();
  const r = await post(env, good(1));
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  assert.deepEqual(rows(env), [{ id: hex(1), first_seen: "2026-11-18", last_seen: "2026-11-18", version: "0.2.0", sessions: 10, days_seen: 1 }]);
});

test("the stored row holds nothing but its six columns, and days only", async () => {
  const env = mk();
  await post(env, good(1), NOW, { headers: { "content-type": "application/json", "cf-worker": "lab.workers.dev", "cf-connecting-ip": "9.9.9.9", "user-agent": "x", "x-extra": "y" } });
  const cols = env.DB.raw.prepare("PRAGMA table_info(installs)").all().map((c) => c.name);
  assert.deepEqual(cols, ["id", "first_seen", "last_seen", "version", "sessions", "days_seen"]);
  const [row] = rows(env);
  assert.deepEqual(Object.keys(row), cols);
  assert.match(row.first_seen, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(row.last_seen, /^\d{4}-\d{2}-\d{2}$/);
  const dump = JSON.stringify(row);
  for (const s of ["9.9.9.9", "lab.workers.dev", "12:34", "user-agent"]) assert.ok(!dump.includes(s));
});

test("schema.sql matches the table the Worker creates", async () => {
  const env = mk();
  await post(env, good(1));
  const fromWorker = env.DB.raw.prepare("PRAGMA table_info(installs)").all().map((c) => [c.name, c.type, c.notnull, c.pk]);
  const other = makeDB();
  other.raw.exec("DROP TABLE IF EXISTS installs");
  other.raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const fromFile = other.raw.prepare("PRAGMA table_info(installs)").all().map((c) => [c.name, c.type, c.notnull, c.pk]);
  assert.deepEqual(fromFile, fromWorker);
});

test("malformed or invalid bodies answer 204 and store nothing", async () => {
  const env = mk();
  const bad = [
    "", "not json", "[]", "null", "42", '"x"',
    body({}), body({ id: hex(1), v: "0.2.0" }), body({ id: hex(1), sessions: 1 }), body({ v: "0.2.0", sessions: 1 }),
    body({ ...good(1), extra: 1 }), body({ ...good(1), lang: "es" }),
    body({ ...good(1), id: hex(1).toUpperCase().replace(/0/g, "A") }),
    body({ ...good(1), id: "abc" }), body({ ...good(1), id: hex(1) + "0" }), body({ ...good(1), id: 5 }),
    body({ ...good(1), v: "1.2" }), body({ ...good(1), v: "v1.2.3" }), body({ ...good(1), v: "1.2.3-beta" }), body({ ...good(1), v: "1234.0.0" }), body({ ...good(1), v: 1 }),
    body({ ...good(1), sessions: -1 }), body({ ...good(1), sessions: 1.5 }), body({ ...good(1), sessions: "3" }), body({ ...good(1), sessions: 1_000_001 }), body({ ...good(1), sessions: null }),
  ];
  for (const b of bad) {
    const r = await post(env, b);
    assert.equal(r.status, 204, b);
    assert.equal(await r.text(), "");
  }
  assert.deepEqual(rows(env), []);
});

test("boundary values are accepted", async () => {
  const env = mk();
  await post(env, { id: hex(1), v: "999.999.999", sessions: 0 });
  await post(env, { id: hex(2), v: "0.0.0", sessions: 1_000_000 });
  assert.equal(rows(env).length, 2);
});

test("an oversize body is ignored", async () => {
  const env = mk();
  const padded = body(good(1)) + " ".repeat(400);
  assert.equal((await post(env, padded)).status, 204);
  assert.equal((await post(env, "x".repeat(100_000))).status, 204);
  assert.deepEqual(rows(env), []);
  const exactly300 = body(good(1)) + " ".repeat(300 - body(good(1)).length);
  assert.equal(exactly300.length, 300);
  await post(env, exactly300);
  assert.equal(rows(env).length, 1);
});

test("a known id is updated: last_seen, version, sessions; first_seen stays", async () => {
  const env = mk();
  await post(env, good(1));
  const later = new Date("2026-11-20T01:00:00Z");
  await post(env, good(1, { v: "0.3.0", sessions: 25 }), later);
  assert.deepEqual(rows(env), [{ id: hex(1), first_seen: "2026-11-18", last_seen: "2026-11-20", version: "0.3.0", sessions: 25, days_seen: 2 }]);
});

test("sessions never drop and grow by at most 2000 per day, the first value included", async () => {
  const env = mk();
  const d = (n) => dayAt(addDays("2026-11-01", n));
  await post(env, good(1, { sessions: 100 }), d(0));
  await post(env, good(1, { sessions: 40 }), d(1));
  assert.equal(rows(env)[0].sessions, 100);
  await post(env, good(1, { sessions: 900_000 }), d(2));
  assert.equal(rows(env)[0].sessions, 2100);
  await post(env, good(1, { sessions: 2100 + 2000 }), d(3));
  assert.equal(rows(env)[0].sessions, 4100);
  await post(env, good(1, { sessions: 4100 + 1999 }), d(4));
  assert.equal(rows(env)[0].sessions, 6099);
  // a new identifier that claims the maximum is stored at the cap
  await post(env, good(2, { sessions: 1_000_000 }), d(0));
  assert.equal(rows(env).find((r) => r.id === hex(2)).sessions, 2000);
});

test("a second ping the same UTC day changes nothing", async () => {
  const env = mk();
  await post(env, good(1, { sessions: 100 }));
  await post(env, good(1, { v: "0.9.0", sessions: 1500 }), new Date("2026-11-18T23:00:00Z"));
  assert.deepEqual(rows(env), [{ id: hex(1), first_seen: "2026-11-18", last_seen: "2026-11-18", version: "0.2.0", sessions: 100, days_seen: 1 }]);
});

test("a ping without content-type application/json is ignored", async () => {
  const env = mk();
  for (const headers of [{}, { "content-type": "text/plain" }, { "content-type": "application/x-www-form-urlencoded" }, { "content-type": "application/jsonx" }]) {
    const r = await post(env, good(1), NOW, { headers });
    assert.equal(r.status, 204);
  }
  assert.deepEqual(rows(env), []);
  await post(env, good(1), NOW, { headers: { "content-type": "Application/JSON; charset=utf-8" } });
  assert.equal(rows(env).length, 1);
});

test("days_seen counts the days with a report, not the pings", async () => {
  const env = mk();
  await post(env, good(1), dayAt("2026-11-01"));
  await post(env, good(1), dayAt("2026-11-01"));
  await post(env, good(1), dayAt("2026-11-05"));
  assert.equal(rows(env)[0].days_seen, 2);
});

test("a table made by an earlier version gets the days_seen column", async () => {
  const env = mk();
  env.DB.raw.exec("DROP TABLE IF EXISTS installs");
  env.DB.raw.exec("CREATE TABLE installs (id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, version TEXT NOT NULL, sessions INTEGER NOT NULL)");
  env.DB.raw.exec("INSERT INTO installs VALUES ('" + hex(9) + "', '2026-10-01', '2026-11-10', '0.2.0', 5)");
  assert.equal((await get(env, "/stats.json")).status, 200);
  await post(env, good(9, { sessions: 6 }));
  assert.equal(rows(env)[0].days_seen, 2);
});

test("fresh identifiers are bounded to the newest ones; an installation seen again is kept before them", async () => {
  const env = mk();
  const opt = { pendingCap: 5 };
  const send = (p, now) => handle(new Request("https://approdo-stats.example/ping", { method: "POST", headers: { "content-type": "application/json" }, body: body(p) }), env, { now, ...opt });
  const d1 = dayAt("2026-11-17"), d2 = dayAt("2026-11-18");
  await send(good(1), d1);
  await send(good(1), d2);
  for (let i = 2; i <= 12; i++) await send(good(i), d2);
  const ids = rows(env).map((r) => r.id);
  assert.equal(ids.length, 5);
  assert.ok(ids.includes(hex(1)), "the one that came back stays");
  // an established installation is never pushed out
  await seed(env, 50, 10, "2026-11-10");
  for (let i = 60; i <= 70; i++) await send(good(i), d2);
  assert.ok(rows(env).some((r) => r.id === hex(50)));
  assert.equal(rows(env).length, 5 + 1);
  // and a new identifier is always admitted, whatever came before it
  await send(good(99), d2);
  assert.ok(rows(env).some((r) => r.id === hex(99)));
});

test("GET /stats.json: shape, headers, null below three active installs", async () => {
  const env = mk();
  let r = await get(env, "/stats.json");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/json");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await r.json(), { updated: NOW.toISOString(), installs: { active: 0, total: 0 }, sessions: null, minInstallsForSessions: 3 });
  await seed(env, 1, 70, "2026-11-17");
  await seed(env, 2, 80, "2026-11-17");
  let s = await stats(env);
  assert.deepEqual(s.installs, { active: 2, total: 2 });
  assert.equal(s.sessions, null);
  await seed(env, 3, 50, "2026-11-17");
  s = await stats(env);
  assert.deepEqual(s.installs, { active: 3, total: 3 });
  assert.equal(s.sessions, 200);
});

test("one real installation plus new identifiers never publishes the real number", async () => {
  const env = mk();
  await seed(env, 1, 37, "2026-11-17");
  await post(env, good(2, { sessions: 0 }));
  await post(env, good(3, { sessions: 0 }));
  let s = await stats(env);
  assert.deepEqual(s.installs, { active: 1, total: 1 });
  assert.equal(s.sessions, null);
  // seven pings on seven days but a first report under seven days old does not count either
  for (let k = 0; k < 7; k++) { await post(env, good(4, { sessions: 0 }), dayAt(addDays("2026-11-12", k))); await post(env, good(5, { sessions: 0 }), dayAt(addDays("2026-11-12", k))); }
  s = await stats(env, dayAt("2026-11-18"));
  assert.equal(s.sessions, null);
  // they are counted as installations (seen on two days or more), but their sessions are not in any sum yet
  assert.deepEqual(s.installs, { active: 3, total: 3 });
  // a week after their first report they are established
  s = await stats(env, dayAt("2026-11-19"));
  assert.deepEqual(s.installs, { active: 3, total: 3 });
  assert.equal(s.sessions, 30);
});

test("an installation is counted from its second day; its sessions wait until it is established", async () => {
  const env = mk();
  await seed(env, 1, 40, "2026-11-17");
  await seed(env, 2, 40, "2026-11-17");
  await post(env, good(3, { sessions: 40 }), dayAt("2026-11-17"));
  let s = await stats(env, dayAt("2026-11-17"));
  assert.deepEqual(s.installs, { active: 2, total: 2 }, "one day only: not counted");
  await post(env, good(3, { sessions: 40 }), dayAt("2026-11-18"));
  s = await stats(env, dayAt("2026-11-18"));
  assert.deepEqual(s.installs, { active: 3, total: 3 }, "second day: counted");
  assert.equal(s.sessions, null, "three are counted but only two are established: no sum");
  for (let k = 2; k <= 6; k++) await post(env, good(3, { sessions: 40 }), dayAt(addDays("2026-11-17", k)));
  s = await stats(env, dayAt("2026-11-23"));
  assert.equal(s.sessions, null, "seven days seen, first report six days old");
  s = await stats(env, dayAt("2026-11-24"));
  assert.equal(s.sessions, 120);
});

test("the published sum is rounded down to a multiple of ten", async () => {
  const env = mk();
  await seed(env, 1, 107, "2026-11-17");
  await seed(env, 2, 108, "2026-11-17");
  await seed(env, 3, 109, "2026-11-17");
  assert.equal((await stats(env)).sessions, 320);
});

test("active means seen in the last 30 days; sessions sum only the active ones", async () => {
  const env = mk();
  await seed(env, 1, 1000, "2026-10-10");
  await seed(env, 2, 110, "2026-10-19");
  await seed(env, 3, 220, "2026-11-01");
  await seed(env, 4, 330, "2026-11-10");
  // 30 days before 2026-11-18 is 2026-10-19, which still counts
  let s = await stats(env, NOW);
  assert.deepEqual(s.installs, { active: 3, total: 4 });
  assert.equal(s.sessions, 660);
  // one day later 2026-10-19 falls out: two active, so sessions is null
  s = await stats(env, new Date("2026-11-19T10:00:00Z"));
  assert.deepEqual(s.installs, { active: 2, total: 4 });
  assert.equal(s.sessions, null);
});

test("HEAD /stats.json has the headers and no body", async () => {
  const env = mk();
  const r = await get(env, "/stats.json", NOW, "HEAD");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/json");
  assert.equal(await r.text(), "");
});

test("GET / redirects to the product site", async () => {
  const r = await get(mk(), "/");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://nerln.github.io/approdo/");
});

test("other paths and methods answer 404 or 405 with an empty body", async () => {
  const env = mk();
  const cases = [
    ["GET", "/ping", 405], ["PUT", "/ping", 405], ["DELETE", "/ping", 405],
    ["POST", "/stats.json", 405], ["POST", "/", 405],
    ["GET", "/nope", 404], ["POST", "/nope", 404], ["GET", "/<script>alert(1)</script>", 404], ["GET", "/ping/", 404],
  ];
  for (const [m, p, st] of cases) {
    const r = await handle(new Request("https://approdo-stats.example" + p, { method: m, body: m === "POST" ? "x" : undefined }), env, { now: NOW });
    assert.equal(r.status, st, m + " " + p);
    assert.equal(await r.text(), "");
  }
});

test("the table is created on first use, and a broken database never leaks details", async () => {
  const fresh = { DB: makeDB() };
  fresh.DB.raw.exec("DROP TABLE IF EXISTS installs");
  assert.equal((await get(fresh, "/stats.json")).status, 200);
  const broken = { DB: { prepare() { throw new Error("secret detail"); } } };
  const r = await post(broken, good(1));
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  const s = await get(broken, "/stats.json");
  assert.equal(s.status, 503);
  assert.equal(await s.text(), "");
});

test("the default export uses the real clock and reads no request data", async () => {
  const env = mk();
  const r = await worker.fetch(new Request("https://approdo-stats.example/ping", { method: "POST", headers: { "content-type": "application/json" }, body: body(good(1)) }), env);
  assert.equal(r.status, 204);
  assert.equal(rows(env)[0].first_seen, new Date().toISOString().slice(0, 10));
});

test("the source never touches headers, console or request metadata", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  // The one header the collector looks at is content-type, and only to compare it with application/json.
  const withoutContentType = src.replace('request.headers.get("content-type")', "");
  assert.ok(src.includes('request.headers.get("content-type")'));
  for (const s of ["console.", ".headers.get", "request.headers", "request.cf", "cf-connecting-ip", "user-agent"]) {
    assert.ok(!withoutContentType.includes(s), s);
  }
});
