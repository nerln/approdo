// Studies managed from the panel, part 1: the two new tables and their upgrade, what is stored and how it is cleaned, the limits,
// where the studies come from while the table is empty, and what the first save writes.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { SCHEMA_STATEMENTS } from "../src/schema.js";
import { ensureSchema, UPGRADES, SCHEMA_VERSION } from "../src/migrate.js";
import { T } from "../src/i18n.js";
import { LANGS, KNOWN_LANGS, declarationsFor } from "../src/config.js";
import { LIMITS, parseStored, serialize, studyFromForm, fallbackTexts, genericTexts, newStudyId, isStudyId, configStudies, oneLine, paragraph, resolveTexts, progressOf, autoPublicState, publicStateOf, publicStudies, normText } from "../src/studies.js";
import { C, NOW, makeDB, setup, adminSession, adminDo } from "./helpers.mjs";

const version = (DB) => DB.raw.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get().value;
const tables = (DB) => DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
const cols = (DB, t) => DB.raw.prepare(`PRAGMA table_info(${t})`).all().map((r) => `${r.name} ${r.type}${r.notnull ? " NOT NULL" : ""}${r.pk ? ` PK${r.pk}` : ""}`);

// ---- schema ------------------------------------------------------------------------------------------------------------------
test("schema version 3 has the tables studies and tallies (counts per ISO week), with the columns of the specification", async () => {
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(UPGRADES[UPGRADES.length - 1].version, 3);
  const DB = makeDB();
  assert.equal(version(DB), "3");
  assert.deepEqual(cols(DB, "studies"), ["id TEXT PK1", "position INTEGER NOT NULL", "data TEXT NOT NULL", "updated_at TEXT NOT NULL"]);
  assert.deepEqual(cols(DB, "tallies"), ["study TEXT NOT NULL PK1", "week TEXT NOT NULL PK2", "status TEXT NOT NULL PK3", "n INTEGER NOT NULL"]);
  // src/schema.js (what the Worker runs) and schema.sql (what the tests load) describe the same two tables
  const fromJs = SCHEMA_STATEMENTS.filter((s) => /^CREATE TABLE IF NOT EXISTS (studies|tallies)\b/.test(s));
  assert.equal(fromJs.length, 2);
  const fresh = makeDB(false);
  for (const s of SCHEMA_STATEMENTS) fresh.raw.exec(s);
  assert.deepEqual(cols(fresh, "studies"), cols(DB, "studies"));
  assert.deepEqual(cols(fresh, "tallies"), cols(DB, "tallies"));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0, "both tables start empty");
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM tallies").get().n, 0);
});

test("a version-1 database is upgraded to the current version in place: the new tables appear, nothing else changes, and running it again is harmless", async () => {
  const DB = makeDB(false);
  // The schema as it was at version 1: every statement except the two new tables and the version row.
  for (const s of SCHEMA_STATEMENTS) if (!/^INSERT\b/i.test(s) && !/^CREATE TABLE IF NOT EXISTS (studies|tallies)\b/.test(s)) DB.raw.exec(s);
  DB.raw.exec("INSERT INTO settings (key, value) VALUES ('schema_version', '1'), ('active_study', 'study2')");
  DB.raw.prepare("INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, reminded, lang) VALUES ('v1','tok-version-one-aaaaaaaaaa','study1','2026-11-18','10:00','Old Booking','old@example.org','old@example.org','confirmed',?,0,'en')").run(NOW.toISOString());
  assert.ok(!tables(DB).includes("studies") && !tables(DB).includes("tallies"));
  await ensureSchema(DB);
  assert.equal(version(DB), "3");
  assert.ok(tables(DB).includes("studies") && tables(DB).includes("tallies"));
  assert.deepEqual(cols(DB, "tallies").slice(0, 2), ["study TEXT NOT NULL PK1", "week TEXT NOT NULL PK2"], "a version-1 database gets the weekly tallies at once");
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0, "the upgrade writes no study: the site keeps using the configuration");
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id = 'v1'").get().status, "confirmed", "the booking is untouched");
  assert.equal(DB.raw.prepare("SELECT value FROM settings WHERE key = 'active_study'").get().value, "study2");
  // the same step again (another isolate racing): no error, no change
  DB.raw.exec("INSERT INTO tallies (study, week, status, n) VALUES ('study1','2026-09-28','attended',3)");
  await UPGRADES[1].run(DB);
  await UPGRADES[1].run(DB);
  await UPGRADES[2].run(DB);
  assert.equal(DB.raw.prepare("SELECT n FROM tallies").get().n, 3);
  // the upgraded database serves the application: the registry reads the configuration, not an error
  const reg = await D.getRegistry(DB);
  assert.equal(reg.table, false);
});

test("a brand-new empty database gets both tables from the first request", async () => {
  const DB = makeDB(false);
  await ensureSchema(DB);
  assert.ok(tables(DB).includes("studies") && tables(DB).includes("tallies"));
  assert.equal(version(DB), "3");
});

test("version 3 turns the daily tallies of a version-2 database into weekly ones (summed into the Monday), keeps everything else, and is idempotent", async () => {
  const DB = makeDB(false);
  // the database exactly as version 2 left it: the old tallies table, per day
  for (const s of SCHEMA_STATEMENTS) if (!/^INSERT\b/i.test(s) && !/^CREATE TABLE IF NOT EXISTS tallies\b/.test(s)) DB.raw.exec(s);
  DB.raw.exec("CREATE TABLE tallies (study TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (study, date, status))");
  DB.raw.exec("INSERT INTO settings (key, value) VALUES ('schema_version', '2'), ('active_study', 'study2')");
  const put = (study, date, status, n) => DB.raw.prepare("INSERT INTO tallies (study, date, status, n) VALUES (?,?,?,?)").run(study, date, status, n);
  // 2026-11-16 is a Monday: Monday and Sunday of one ISO week, Wednesday, then the next Monday and a day of the week before
  put("study1", "2026-11-16", "attended", 2); put("study1", "2026-11-18", "attended", 3); put("study1", "2026-11-22", "attended", 4);
  put("study1", "2026-11-22", "noshow", 1); put("study1", "2026-11-23", "attended", 5); put("study2", "2026-11-09", "cancelled", 7);
  DB.raw.prepare("INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, reminded, lang) VALUES ('v2','tok-version-two-aaaaaaaaaa','study1','2026-11-18','10:00','Kept Booking','k@example.org','k@example.org','confirmed',?,0,'en')").run(NOW.toISOString());
  await ensureSchema(DB);
  assert.equal(version(DB), "3");
  assert.deepEqual(cols(DB, "tallies"), ["study TEXT NOT NULL PK1", "week TEXT NOT NULL PK2", "status TEXT NOT NULL PK3", "n INTEGER NOT NULL"]);
  const weekly = () => DB.raw.prepare("SELECT study, week, status, n FROM tallies ORDER BY study, week, status").all().map((r) => ({ ...r }));
  const expected = [
    { study: "study1", week: "2026-11-16", status: "attended", n: 9 }, { study: "study1", week: "2026-11-16", status: "noshow", n: 1 },
    { study: "study1", week: "2026-11-23", status: "attended", n: 5 }, { study: "study2", week: "2026-11-09", status: "cancelled", n: 7 },
  ];
  assert.deepEqual(weekly(), expected, "Monday, Wednesday and Sunday of one week are one row; the total is unchanged");
  assert.equal(weekly().reduce((t, r) => t + r.n, 0), 2 + 3 + 4 + 1 + 5 + 7);
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id = 'v2'").get().status, "confirmed", "bookings are untouched");
  assert.equal(DB.raw.prepare("SELECT value FROM settings WHERE key = 'active_study'").get().value, "study2");
  // idempotent: the step again (another isolate racing), and the whole upgrade again
  await UPGRADES[2].run(DB);
  await UPGRADES[2].run(DB);
  assert.deepEqual(weekly(), expected, "running it again changes nothing");
  assert.ok(!tables(DB).includes("tallies_week"), "no scratch table is left behind");
  // an empty old table, and a database that never had old rows
  const empty = makeDB(false);
  for (const s of SCHEMA_STATEMENTS) if (!/^INSERT\b/i.test(s) && !/^CREATE TABLE IF NOT EXISTS tallies\b/.test(s)) empty.raw.exec(s);
  empty.raw.exec("CREATE TABLE tallies (study TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (study, date, status))");
  empty.raw.exec("INSERT INTO settings (key, value) VALUES ('schema_version', '2')");
  await ensureSchema(empty);
  assert.equal(empty.raw.prepare("SELECT count(*) n FROM tallies").get().n, 0);
});

// ---- ids -----------------------------------------------------------------------------------------------------------------------
test("a new study id is 's' plus 10 random base-36 characters; nothing else is accepted as an id in a request", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const id = newStudyId(); assert.match(id, /^s[0-9a-z]{10}$/); seen.add(id); }
  assert.ok(seen.size > 495, "random, not a counter");
  for (const ok of ["study1", "study2", "s0123456789"]) assert.ok(isStudyId(ok), ok);
  for (const bad of ["", "a b", "x'; DROP", "../x", "x".repeat(21), "é", null, undefined, 5, ["study1"]]) assert.ok(!isStudyId(bad), String(bad));
});

// ---- what is stored ----------------------------------------------------------------------------------------------------------------
test("parseStored keeps only the known keys, cuts what is too long, and treats invalid JSON as absent", () => {
  assert.equal(parseStored("{not json"), null);
  assert.equal(parseStored("[1,2]"), null);
  assert.equal(parseStored("null"), null);
  assert.equal(parseStored('"text"'), null);
  const s = parseStored(JSON.stringify({
    name: "N".repeat(100), target: 5, archived: true, evil: "x", __proto__: { polluted: 1 }, constructor: "c",
    declarations: { epilepsy: true, vestibular: "yes", extra: true },
    texts: { [LANGS[0]]: { title: "T".repeat(500), lead: "L".repeat(2000), does: "D".repeat(2000), reqs: Array.from({ length: 30 }, (_, i) => `r${i}`.padEnd(400, "x")), junk: 1 }, xx: { title: "no such language" } },
  }));
  assert.deepEqual(Object.keys(s).sort(), ["archived", "declarations", "name", "outside", "target", "texts"], "outside always reads as a number (0 when nothing valid is stored)");
  assert.equal(s.name.length, LIMITS.name);
  assert.equal(s.target, 5);
  assert.equal(s.archived, true);
  assert.deepEqual(s.declarations, { epilepsy: true, vestibular: false }, "only a real true counts");
  assert.deepEqual(Object.keys(s.texts).sort(), [...KNOWN_LANGS].sort());
  const t = s.texts[LANGS[0]];
  assert.deepEqual(Object.keys(t).sort(), ["does", "lead", "reqs", "title"]);
  assert.equal(t.title.length, LIMITS.title);
  assert.equal(t.lead.length, LIMITS.lead);
  assert.equal(t.does.length, LIMITS.does);
  assert.equal(t.reqs.length, LIMITS.reqs);
  assert.ok(t.reqs.every((r) => r.length <= LIMITS.req));
  assert.equal(({}).polluted, undefined);
  // a target that is not an integer from 1 to 9999 is no target
  for (const bad of [0, -1, 10000, 1.5, "7", null, true]) assert.equal(parseStored(JSON.stringify({ target: bad })).target, null, String(bad));
  assert.equal(parseStored(JSON.stringify({ target: 9999 })).target, 9999);
});

test("serialize writes a fixed set of keys in a fixed order", () => {
  const d = parseStored("{}");
  const out = JSON.parse(serialize({ ...d, name: "x", unknown: "dropped", declarations: { epilepsy: 1, vestibular: 0, other: 1 } }));
  assert.deepEqual(Object.keys(out), ["name", "target", "archived", "declarations", "texts"]);
  assert.deepEqual(out.declarations, { epilepsy: true, vestibular: false });
  // the public state is written only when it is one of the three
  assert.equal(JSON.parse(serialize({ ...d, name: "x", publicState: "later" })).publicState, "later");
  assert.ok(!("publicState" in JSON.parse(serialize({ ...d, name: "x", publicState: "now" }))), "'now' is not a stored state");
  assert.equal(parseStored(JSON.stringify({ publicState: "done" })).publicState, "done");
  assert.ok(!("publicState" in parseStored(JSON.stringify({ publicState: "sideways" }))));
});

test("oneLine and paragraph remove control and bidirectional characters; a paragraph keeps its line breaks", () => {
  assert.equal(oneLine("  a\u0000b\u202eC\r\nd\te  "), "a b C d e");
  assert.ok(!/[\u0000-\u001f\u202a-\u202e\u2028\u2029]/.test(oneLine("x\u2028y\u2029z\u0007")));
  assert.equal(paragraph("a\r\nb\rc\u2028d\n\n\n\ne"), "a\nb\nc\nd\n\ne");
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u202a-\u202e]/.test(paragraph("a\u0000b\u202ec")));
});

// ---- the limits, one by one --------------------------------------------------------------------------------------------------------
const L0 = LANGS[0];
function form(o = {}) {
  const f = new Map([["name", "Study"], ["target", ""]]);
  for (const l of LANGS) for (const k of ["title", "lead", "does", "reqs"]) f.set(`${k}_${l}`, "");
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return { get: (k) => (f.has(k) ? f.get(k) : null) };
}
const cur = { id: "sxxxxxxxxxx", archived: false };
const reg0 = { studies: [], active: "study1" };

test("the limits of every field are enforced exactly: the limit is accepted, one more is refused, and nothing is cut", () => {
  const ok = (o) => { const r = studyFromForm(form(o), cur, reg0); assert.ok(r.data, JSON.stringify(r).slice(0, 80)); return r.data; };
  const no = (o, error) => { const r = studyFromForm(form(o), cur, reg0); assert.equal(r.error, error, JSON.stringify(o).slice(0, 60)); };
  ok({ name: "n".repeat(60) }); no({ name: "n".repeat(61) }, "name"); no({ name: "   " }, "name"); no({ name: "" }, "name");
  ok({ target: "1" }); ok({ target: "9999" }); ok({ target: "" }); ok({ target: " 12 " });
  for (const bad of ["0", "10000", "-1", "1.5", "1e3", "abc", "０５", "12345", "+5"]) no({ target: bad }, "target");
  assert.deepEqual([LIMITS.title, LIMITS.lead, LIMITS.does, LIMITS.req, LIMITS.reqs], [160, 1200, 2000, 300, 20]);
  ok({ [`title_${L0}`]: "t".repeat(160) }); no({ [`title_${L0}`]: "t".repeat(161) }, "long");
  ok({ [`lead_${L0}`]: "l".repeat(1200) }); no({ [`lead_${L0}`]: "l".repeat(1201) }, "long");
  ok({ [`does_${L0}`]: "d".repeat(2000) }); no({ [`does_${L0}`]: "d".repeat(2001) }, "long");
  ok({ [`reqs_${L0}`]: "r".repeat(300) }); no({ [`reqs_${L0}`]: "r".repeat(301) }, "long");
  ok({ [`reqs_${L0}`]: Array.from({ length: 20 }, (_, i) => `req ${i}`).join("\n") });
  no({ [`reqs_${L0}`]: Array.from({ length: 21 }, (_, i) => `req ${i}`).join("\n") }, "reqs");
  // blank lines do not count as requirements
  assert.equal(ok({ [`reqs_${L0}`]: "a\n\n  \nb\r\nc" }).texts[L0].reqs.length, 3);
  // the stored text is what was written, not a cut version
  assert.equal(ok({ [`lead_${L0}`]: "x".repeat(1200) }).texts[L0].lead.length, 1200);
  // the reported field names the language and the field
  assert.deepEqual(studyFromForm(form({ [`does_${LANGS[LANGS.length - 1]}`]: "d".repeat(2001) }), cur, reg0), { error: "long", field: `does:${LANGS[LANGS.length - 1]}` });
});

test("the form keeps the 'archived' state of the stored study and builds the declarations from the two switches", () => {
  const r = studyFromForm(form({ epilepsy: "1" }), { ...cur, archived: true }, reg0);
  assert.equal(r.data.archived, true);
  assert.deepEqual(r.data.declarations, { epilepsy: true, vestibular: false });
  assert.deepEqual(studyFromForm(form({ vestibular: "1" }), cur, reg0).data.declarations, { epilepsy: false, vestibular: true });
  assert.deepEqual(studyFromForm(form({ vestibular: "on", epilepsy: "yes" }), cur, reg0).data.declarations, { epilepsy: false, vestibular: false }, "only the value of the switch counts");
});

// ---- where the studies come from -------------------------------------------------------------------------------------------------
test("while the table is empty the studies are the ones of the configuration, with the declarations and the texts the site shows now (their own texts are empty)", async () => {
  const { DB } = await setup();
  const reg = await D.getRegistry(DB);
  assert.equal(reg.table, false);
  assert.deepEqual(reg.studies.map((x) => x.id), C.twoStudies ? ["study1", "study2"] : ["study1"]);
  assert.equal(reg.active, "study1");
  for (const x of reg.studies) {
    assert.deepEqual(x.declarations, declarationsFor(x.id), x.id);
    assert.equal(x.target, null);
    assert.equal(x.archived, false);
    for (const l of LANGS) {
      const S = T[l], s = S[x.id];
      assert.deepEqual(x.texts[l], { title: "", lead: "", does: "", reqs: [] }, "a study of the configuration stores no text of its own");
      assert.deepEqual(resolveTexts(l, x), { title: S.title, lead: s.lead || S.lead, does: s.does, reqs: s.reqs }, "and shows the configuration's text");
    }
  }
  if (C.twoStudies) {
    await D.setSetting(DB, "active_study", "study2");
    assert.equal((await D.getRegistry(DB)).active, "study2");
  } else {
    await D.setSetting(DB, "active_study", "study2");
    assert.equal((await D.getRegistry(DB)).active, "study1", "a site with one study never switches");
  }
});

test("the first save writes the configured studies with EMPTY texts (nothing is copied, so nothing is cut): what the page shows is what it showed before", () => {
  for (const x of configStudies()) {
    for (const l of LANGS) {
      const S = T[l], s = S[x.id];
      assert.deepEqual(x.data.texts[l], { title: "", lead: "", does: "", reqs: [] }, `${x.id} ${l}`);
      assert.deepEqual(resolveTexts(l, { id: x.id, texts: x.data.texts }), { title: S.title, lead: s.lead || S.lead, does: s.does, reqs: s.reqs }, `${x.id} ${l} resolved`);
      assert.deepEqual(fallbackTexts(l, x.id), { title: S.title, lead: s.lead || S.lead, does: s.does, reqs: s.reqs });
    }
    assert.ok(!("publicState" in x.data), "a seeded study follows the automatic public state until somebody sets it");
  }
  assert.deepEqual(Object.keys(genericTexts()), [...LANGS]);
  for (const l of LANGS) assert.deepEqual(genericTexts()[l], fallbackTexts(l, "study1"), "a new study falls back on the generic texts of the first study");
});

test("a row with invalid JSON is ignored: the study is treated as absent, and with no valid row the configuration is used", async () => {
  const { DB } = await setup();
  const put = (id, pos, data) => DB.raw.prepare("INSERT INTO studies (id, position, data, updated_at) VALUES (?,?,?,?)").run(id, pos, data, NOW.toISOString());
  put("sbroken0001", 1, "{this is not json");
  put("sarray00001", 2, "[1,2,3]");
  assert.equal((await D.getRegistry(DB)).table, false, "no valid row: still the configuration");
  put("sgood000001", 3, serialize({ ...parseStored("{}"), name: "Valid" }));
  const reg = await D.getRegistry(DB);
  assert.equal(reg.table, true);
  assert.deepEqual(reg.studies.map((x) => x.id), ["sgood000001"], "the two broken rows are absent");
  assert.equal(reg.active, "sgood000001");
});

test("the first save writes every configured study (ids study1, study2), then applies the edit; a refused edit writes nothing", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const f = (o = {}) => ({ name: "Edited", target: "", ...Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]])), ...o });
  // refused: too long, then a bad target: the table stays empty (not even the copy of the configuration is written)
  await adminDo(env, s, "study-save:study1", f({ [`title_${L0}`]: "x".repeat(161) }));
  await adminDo(env, s, "study-save:study1", f({ target: "0" }));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0);
  assert.equal((await D.getRegistry(DB)).table, false);
  // accepted
  const r = await adminDo(env, s, "study-save:study1", f({ name: "Edited", target: "30" }));
  assert.equal(r.status, 303);
  const rows = DB.raw.prepare("SELECT id, position, data FROM studies ORDER BY position").all();
  assert.deepEqual(rows.map((x) => x.id), C.twoStudies ? ["study1", "study2"] : ["study1"]);
  assert.deepEqual(rows.map((x) => x.position), C.twoStudies ? [1, 2] : [1]);
  const one = parseStored(rows[0].data);
  assert.equal(one.name, "Edited");
  assert.equal(one.target, 30);
  if (C.twoStudies) {
    const two = parseStored(rows[1].data);
    assert.equal(two.target, null);
    assert.deepEqual(two.declarations, declarationsFor("study2"));
    for (const l of LANGS) assert.deepEqual(two.texts[l], { title: "", lead: "", does: "", reqs: [] }, "the second study was seeded with no text of its own");
  }
  assert.equal((await D.getRegistry(DB)).table, true);
  // a second save does not seed again: the other study keeps what it has
  await adminDo(env, s, "study-save:study1", f({ name: "Edited again", target: "31" }));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, rows.length);
});

test("progressOf: done, upcoming, remaining and the percentage step", () => {
  assert.deepEqual(progressOf({ target: null }, { attended: 3, upcoming: 2 }), { done: 3, site: 3, outside: 0, upcoming: 2, target: null, remaining: null, pct: null });
  assert.deepEqual(progressOf({ target: 10 }, { attended: 3, upcoming: 2 }), { done: 3, site: 3, outside: 0, upcoming: 2, target: 10, remaining: 7, pct: 30 });
  assert.equal(progressOf({ target: 10 }, { attended: 12, upcoming: 0 }).remaining, 0);
  assert.equal(progressOf({ target: 10 }, { attended: 12, upcoming: 0 }).pct, 100);
  assert.deepEqual(progressOf({ target: 5 }, undefined), { done: 0, site: 0, outside: 0, upcoming: 0, target: 5, remaining: 5, pct: 0 });
});
