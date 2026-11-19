// Studies managed from the panel, part 3: the counts that survive the purge (tallies), the data section and its three exports,
// the privacy sentence, and the guarantee that merely opening the new sections changes nothing while no study was saved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { T, BUILTIN_TEXTS } from "../src/i18n.js";
import { esc } from "../src/util.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { addDays, weekMonday } from "../src/slots.js";
import { C, DAY, NOW, LANGS, TESTED, rawConfig, withConfig, setup, call, req, text, relay, RELAY, book, adminSession, adminDo, adminGet } from "./helpers.mjs";

const L0 = LANGS[0];
const TODAY = "2026-11-16";
const RET = C.bookingRetentionDays;
const OLD1 = addDays(TODAY, -RET - 10);
const OLD2 = addDays(TODAY, -RET - 3);
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
let k = 0;
function ins(DB, o = {}) {
  k++;
  // every booking gets a start time of its own: a day holds one live booking per start time
  const b = { id: `sd${k}`, date: DAY, time: `${String(5 + Math.floor(k / 60)).padStart(2, "0")}:${String(k % 60).padStart(2, "0")}`, name: `Person Number${k}`, email: `sd${k}@example.org`, status: "confirmed", lang: L0, study: "study1", expires_at: null, ...o };
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)")
    .run(b.id, b.id.padEnd(30, "x"), b.study, b.date, b.time, b.name, b.email, b.email, b.status, NOW.toISOString(), b.expires_at, b.lang);
  return b;
}
const tallies = (DB) => DB.raw.prepare("SELECT study, week, status, n FROM tallies ORDER BY study, week, status").all().map((r) => ({ ...r }));
const W1 = weekMonday(OLD1), W2 = weekMonday(OLD2);
const bookingCount = (DB) => DB.raw.prepare("SELECT count(*) n FROM bookings").get().n;

// A database whose batches are atomic and one at a time, as D1's are (the in-memory adapter of the helpers runs a batch statement by
// statement, so two batches started together could interleave there and not on Cloudflare).
function atomic(DB) {
  let chain = Promise.resolve();
  DB.batch = (statements) => {
    const run = chain.then(async () => {
      DB.raw.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        DB.raw.exec("COMMIT");
        return out;
      } catch (e) { DB.raw.exec("ROLLBACK"); throw e; }
    });
    chain = run.catch(() => {});
    return run;
  };
  return DB;
}
function oldBookings(DB) {
  // study1: OLD1 attended x2, noshow x1, cancelled x1, confirmed x1 (never marked); OLD2 attended x1. study "sother": OLD1 attended x1.
  for (const st of ["attended", "attended", "noshow", "cancelled", "confirmed"]) ins(DB, { date: OLD1, status: st });
  ins(DB, { date: OLD2, status: "attended" });
  ins(DB, { date: OLD1, status: "attended", study: "sother00001" });
}
// OLD1 and OLD2 are in the same ISO week or in two consecutive ones: the counts are per week (the Monday), so the rows are summed per week.
const sumRows = (rows) => { const m = new Map(); for (const r of rows) { const k = `${r.study}|${r.week}|${r.status}`; m.set(k, { ...r, n: (m.get(k) || { n: 0 }).n + r.n }); } return [...m.values()].sort((a, b) => (`${a.study}|${a.week}|${a.status}` < `${b.study}|${b.week}|${b.status}` ? -1 : 1)); };
const EXPECTED = sumRows([
  { study: "sother00001", week: W1, status: "attended", n: 1 },
  { study: "study1", week: W1, status: "attended", n: 2 },
  { study: "study1", week: W1, status: "cancelled", n: 1 },
  { study: "study1", week: W1, status: "confirmed", n: 1 },
  { study: "study1", week: W1, status: "noshow", n: 1 },
  { study: "study1", week: W2, status: "attended", n: 1 },
]);

// ---- tallies ------------------------------------------------------------------------------------------------------------------------
test("the purge adds the bookings it deletes to the tallies, grouped by study, ISO week and status; recent bookings stay and are not counted", async () => {
  const { DB } = await setup();
  oldBookings(DB);
  const recent = ins(DB, { date: TODAY, status: "confirmed" });
  const future = ins(DB, { date: DAY, status: "confirmed" });
  const pending = ins(DB, { date: OLD1, status: "pending", expires_at: "2026-11-01T00:00:00.000Z" }); // an expired hold: never a participation
  const deleted = await D.cleanup(DB, NOW.getTime(), TODAY);
  assert.equal(deleted.old, 7, "the seven old bookings (the expired hold goes with its own rule)");
  assert.deepEqual(tallies(DB), EXPECTED);
  assert.equal(bookingCount(DB), 2);
  assert.deepEqual(DB.raw.prepare("SELECT id FROM bookings ORDER BY id").all().map((r) => r.id).sort(), [recent.id, future.id].sort());
  assert.ok(pending);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM tallies WHERE status = 'pending'").get().n, 0, "expired holds are not tallied");
});

test("running the purge again, later, adds nothing: no double counting; and what was counted survives", async () => {
  const { DB } = await setup();
  oldBookings(DB);
  const before = (await D.studyCounts(DB, TODAY)).get("study1");
  await D.cleanup(DB, NOW.getTime(), TODAY);
  const first = tallies(DB);
  await D.cleanup(DB, NOW.getTime() + 61_000, TODAY);
  await D.cleanup(DB, NOW.getTime() + 200_000, TODAY);
  assert.deepEqual(tallies(DB), first);
  assert.deepEqual(first, EXPECTED);
  // the numbers of the study are the same before and after the purge
  const after = (await D.studyCounts(DB, TODAY)).get("study1");
  assert.deepEqual(after, before);
  assert.equal(after.attended, 3);
  assert.equal(after.absent, 1);
  assert.equal(after.cancelled, 1);
  assert.equal(after.booked, 1);
  // a purge a year later still finds the tallies: they are never purged, and hold no person
  await D.cleanup(DB, NOW.getTime() + 365 * 86400_000, addDays(TODAY, 365));
  assert.deepEqual(tallies(DB), EXPECTED);
  assert.deepEqual(DB.raw.prepare("PRAGMA table_info(tallies)").all().map((c) => c.name), ["study", "week", "status", "n"]);
  const dump = JSON.stringify(DB.raw.prepare("SELECT * FROM tallies").all());
  assert.ok(!/Person Number|@example\.org/.test(dump), "no name, no e-mail address");
});

test("several purges at the same time count every booking once", async () => {
  const { DB } = await setup();
  atomic(DB);
  oldBookings(DB);
  const results = await Promise.all(Array.from({ length: 6 }, () => D.purgeOldBookings(DB, addDays(TODAY, -RET))));
  assert.equal(results.reduce((a, b) => a + b, 0), 7, "each booking is deleted by exactly one of them");
  assert.deepEqual(tallies(DB), EXPECTED);
  assert.equal(bookingCount(DB), 0);
  // the same through the opportunistic cleanup of two requests (the second one may be skipped by its one-minute rule)
  const { DB: DB2 } = await setup();
  atomic(DB2);
  oldBookings(DB2);
  await Promise.all([D.cleanup(DB2, NOW.getTime(), TODAY), D.cleanup(DB2, NOW.getTime() + 61_000, TODAY), D.cleanup(DB2, NOW.getTime() + 122_000, TODAY)]);
  assert.deepEqual(tallies(DB2), EXPECTED);
});

test("counting and deleting are one batch: if the delete fails nothing is counted, and a later purge counts once", async () => {
  const { DB } = await setup();
  atomic(DB);
  oldBookings(DB);
  DB.raw.exec("CREATE TRIGGER no_delete BEFORE DELETE ON bookings BEGIN SELECT RAISE(ABORT, 'refused'); END");
  await assert.rejects(D.purgeOldBookings(DB, addDays(TODAY, -RET)), /refused/);
  assert.deepEqual(tallies(DB), [], "the counts were rolled back with the failed delete");
  assert.equal(bookingCount(DB), 7);
  DB.raw.exec("DROP TRIGGER no_delete");
  assert.equal(await D.purgeOldBookings(DB, addDays(TODAY, -RET)), 7);
  assert.deepEqual(tallies(DB), EXPECTED);
});

test("a booking that reaches an old day later is added to the count of its group (n = n + new)", async () => {
  const { DB } = await setup();
  ins(DB, { date: OLD1, status: "attended" });
  await D.purgeOldBookings(DB, addDays(TODAY, -RET));
  ins(DB, { date: OLD1, status: "attended" });
  ins(DB, { date: OLD1, status: "attended" });
  await D.purgeOldBookings(DB, addDays(TODAY, -RET));
  assert.deepEqual(tallies(DB), [{ study: "study1", week: W1, status: "attended", n: 3 }]);
});

test("the tallies are per ISO week: every day of Monday to Sunday goes to the Monday, and a Sunday belongs to the week that ends on it", async () => {
  const { DB } = await setup();
  const mon = "2026-09-07"; // a Monday, long before the retention limit
  assert.equal(weekMonday(mon), mon);
  for (let i = 0; i < 7; i++) ins(DB, { date: addDays(mon, i), status: "attended" });
  ins(DB, { date: addDays(mon, 7), status: "attended" }); // the next Monday: the next week
  await D.purgeOldBookings(DB, addDays(TODAY, -RET));
  assert.deepEqual(tallies(DB), [{ study: "study1", week: mon, status: "attended", n: 7 }, { study: "study1", week: addDays(mon, 7), status: "attended", n: 1 }]);
  assert.ok(tallies(DB).every((r) => new Date(`${r.week}T12:00:00Z`).getUTCDay() === 1), "every week is a Monday");
});

// ---- the weekly summary: one statement, "not marked", the totals ---------------------------------------------------------------------------------
test("weeklyCounts: booked is a confirmed (or pending) session not held yet; a past confirmed session nobody marked is 'unmarked', never booked", async () => {
  const { DB } = await setup();
  // today 2026-11-16, 10:00 local: 08:00 has started, 14:00 has not
  ins(DB, { date: TODAY, time: "08:00", status: "confirmed" });
  ins(DB, { date: TODAY, time: "14:00", status: "confirmed" });
  ins(DB, { date: "2026-11-12", time: "09:00", status: "confirmed" });
  ins(DB, { date: "2026-11-12", time: "10:00", status: "attended" });
  ins(DB, { date: "2026-11-18", time: "09:00", status: "pending", expires_at: "2026-11-16T12:00:00.000Z" });
  const rows = await D.weeklyCounts(DB, TODAY, "10:00");
  const by = (w, kind) => rows.filter((r) => r.week === w && r.kind === kind).reduce((n, r) => n + r.n, 0);
  assert.equal(by("2026-11-16", "booked"), 2, "14:00 today and the pending one on Wednesday");
  assert.equal(by("2026-11-16", "unmarked"), 1, "08:00 today started and nobody marked it");
  assert.equal(by("2026-11-09", "unmarked"), 1, "a session of last week nobody marked");
  assert.equal(by("2026-11-09", "attended"), 1);
  assert.equal(by("2026-11-09", "booked"), 0, "not counted as booked any more");
  // the time of the session counts: at 14:00 sharp it has started
  assert.equal((await D.weeklyCounts(DB, TODAY, "14:00")).filter((r) => r.kind === "unmarked").reduce((n, r) => n + r.n, 0), 3);
});

test("the summary reads live bookings and tallies in ONE statement, so a purge between two reads cannot count the same bookings twice", async () => {
  const { DB } = await setup();
  oldBookings(DB);
  ins(DB, { date: TODAY, time: "15:00", status: "confirmed" });
  // one statement: count the statements the read prepares
  const seen = [];
  const prepare = DB.prepare.bind(DB);
  DB.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const before = await D.weeklyCounts(DB, TODAY, "10:00");
  DB.prepare = prepare;
  assert.equal(seen.length, 1, "a single statement reads the bookings and the tallies");
  assert.match(seen[0], /FROM bookings[\s\S]*UNION ALL[\s\S]*FROM tallies/);
  // a purge between two summaries moves the rows from one source to the other: the numbers stay the same
  await D.purgeOldBookings(DB, addDays(TODAY, -RET));
  assert.deepEqual(await D.weeklyCounts(DB, TODAY, "10:00"), before);
  // and the same total whether a booking is live or already a tally
  const total = (rows, kind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.n, 0);
  assert.equal(total(before, "attended"), 4);
  assert.equal(total(before, "unmarked"), 1, "the old confirmed booking nobody marked");
  assert.equal(total(before, "booked"), 1);
});

// ---- the data section --------------------------------------------------------------------------------------------------------------
test("the data section has three separate blocks, each saying in words whether it holds personal data", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const h = await adminGet(env, s, "?s=data");
  const block = (id) => { const i = h.indexOf(`id="${id}"`); return h.slice(i, h.indexOf("</section>", i)); };
  const sum = block("datos-resumen"), book_ = block("datos-reservas"), con = block("datos-contactos");
  assert.ok(sum && book_ && con);
  assert.ok(sum.includes(esc(AT.data.noPersonal)) && !sum.includes(esc(AT.data.personal)));
  assert.ok(book_.includes(esc(AT.data.personal)) && !book_.includes(esc(AT.data.noPersonal)));
  assert.ok(con.includes(esc(AT.data.personal)));
  assert.match(sum, /href="\/admin\/csv-resumen"/);
  assert.match(book_, /href="\/admin\/csv"/);
  assert.match(con, /href="\/admin\/csv-contactos"/);
  // the note of the bookings export: personal data, for the researcher, deleted from the site N days after each session (N from the config)
  assert.ok(book_.includes(esc(AT.data.bookingsNote(RET))), "the note names the retention days of the configuration");
  assert.ok(book_.includes(String(RET)));
  assert.ok(con.includes(esc(AT.data.contactsNote(C.contactMonths))));
  // the blocks are separate: no link of one in another
  assert.ok(!sum.includes("/admin/csv\"") && !sum.includes("csv-contactos"));
  assert.ok(!book_.includes("csv-resumen") && !book_.includes("csv-contactos"));
});

test("the summary export merges live bookings and tallies: one row per study and week, a total row per study with its target, the study id beside the name, no names and no e-mail addresses", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const blank = Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]]));
  await adminDo(env, s, "study-save:study1", { s: "studies", name: "Alpha", target: "10", ...blank });
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  const B = loc(r).searchParams.get("st");
  await adminDo(env, s, `study-save:${B}`, { s: "studies", name: "Beta", target: "", ...blank });
  const D1 = "2026-11-10", D2 = "2026-11-18", D0 = "2026-09-01", DX = "2026-11-12";
  ins(DB, { date: D1, status: "attended", name: "Zelda Secretname", email: "zelda.secret@example.org" });
  ins(DB, { date: D1, status: "attended" }); ins(DB, { date: D1, status: "noshow" });
  ins(DB, { date: DX, status: "confirmed" }); // last week, confirmed, never marked
  ins(DB, { date: D2, status: "confirmed" }); ins(DB, { date: D2, status: "pending", expires_at: "2026-11-16T11:00:00.000Z" }); ins(DB, { date: D2, status: "cancelled" });
  ins(DB, { date: TODAY, time: "08:00", status: "confirmed" }); // today, started at 08:00, never marked (it is 10:00)
  ins(DB, { date: D2, status: "confirmed", study: B });
  const W0 = weekMonday(D0), W1_ = weekMonday(D1), W2_ = weekMonday(D2);
  DB.raw.exec(`INSERT INTO tallies (study, week, status, n) VALUES ('study1','${W0}','attended',3), ('study1','${W0}','noshow',1), ('study1','${W0}','cancelled',2), ('study1','${W0}','confirmed',1), ('${B}','${W0}','attended',1)`);
  const resp = await call(env, req("/admin/csv-resumen", { cookie: s.cookie }));
  assert.deepEqual([...new Uint8Array(await resp.clone().arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], "a byte order mark for spreadsheets");
  assert.match(resp.headers.get("content-disposition"), new RegExp(`filename="${AT.csv.summaryFile}-${TODAY}\\.csv"`));
  const csv = await resp.text();
  const reg = await D.getRegistry(DB);
  const q = (...c) => c.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",");
  const z = (st) => q(st.name, st.id, AT.data.totalLabel, 0, 0, 0, 0, 0, "");
  assert.equal(AT.csv.summaryHead.split(",").length, 9, "name, study id, week, five counts, target");
  const lines = [AT.csv.summaryHead]; // (Response.text() drops the byte order mark; it is checked above)
  for (const st of reg.studies) {
    if (st.id === "study1") lines.push(q("Alpha", st.id, W0, 0, 3, 1, 2, 1, ""), q("Alpha", st.id, W1_, 0, 2, 1, 0, 1, ""), q("Alpha", st.id, W2_, 2, 0, 0, 1, 1, ""), q("Alpha", st.id, AT.data.totalLabel, 2, 5, 2, 3, 3, 10));
    else if (st.id === B) lines.push(q("Beta", B, W0, 0, 1, 0, 0, 0, ""), q("Beta", B, W2_, 1, 0, 0, 0, 0, ""), q("Beta", B, AT.data.totalLabel, 1, 1, 0, 0, 0, ""));
    else lines.push(z(st));
  }
  assert.equal(csv, lines.join("\r\n") + "\r\n");
  assert.ok(!/Zelda|Secretname|secret@/.test(csv), "no name, no e-mail address");
  // the same numbers on the page, in a table with a head and total rows
  const h = await adminGet(env, s, "?s=data");
  const sec = h.slice(h.indexOf('id="datos-resumen"'), h.indexOf('id="datos-reservas"'));
  assert.match(sec, /<table class="sum"><thead><tr>(<th scope="col">[^<]*<\/th>){8}<\/tr><\/thead>/);
  for (const col of Object.values(AT.data.cols)) assert.ok(sec.includes(`<th scope="col">${esc(col)}</th>`), col);
  assert.match(sec, new RegExp(`<tr><td>Alpha</td><td>${W1_}</td><td>0</td><td>2</td><td>1</td><td>0</td><td>1</td><td></td></tr>`));
  assert.match(sec, new RegExp(`<tr><td>Alpha</td><td>${W0}</td><td>0</td><td>3</td><td>1</td><td>2</td><td>1</td><td></td></tr>`));
  assert.match(sec, new RegExp(`<tr class="sum-total"><th scope="row">Alpha</th><th scope="row">${esc(AT.data.totalLabel)}</th><td>2</td><td>5</td><td>2</td><td>3</td><td>3</td><td>10</td></tr>`));
  assert.match(sec, new RegExp(`<tr class="sum-total"><th scope="row">Beta</th><th scope="row">${esc(AT.data.totalLabel)}</th><td>1</td><td>1</td><td>0</td><td>0</td><td>0</td><td></td></tr>`));
  assert.ok(!/Zelda|Secretname|secret@/.test(sec));
  // the wording says what the numbers are: per week, no names, and the honest limit
  assert.ok(sec.includes(esc(AT.data.noPersonal)) && sec.includes(esc(AT.data.summaryNote)) && sec.includes(esc(AT.data.csvNote)));
  // after the purge the export is the same: the tallies stand in for the deleted rows
  const early = await (await call(env, req("/admin/csv-resumen", { cookie: s.cookie }))).text();
  DB.raw.exec(`UPDATE bookings SET date = '${OLD1}' WHERE date = '${D1}'`);
  await D.purgeOldBookings(DB, addDays(TODAY, -RET));
  const late = await (await call(env, req("/admin/csv-resumen", { cookie: s.cookie }))).text();
  assert.ok(late.split("\r\n").includes(q("Alpha", "study1", W1, 0, 2, 1, 0, 0, "")), "the three bookings of the old day are now a tally of their week, with the same numbers");
  assert.ok(early.includes(q("Alpha", "study1", AT.data.totalLabel, 2, 5, 2, 3, 3, 10)) && late.includes(q("Alpha", "study1", AT.data.totalLabel, 2, 5, 2, 3, 3, 10)), "the total does not change");
});

test("the bookings export keeps its columns: 1 or 2 while the studies are the configured ones, the study's own name afterwards", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  ins(DB, { study: "study1", name: "First Person" });
  const r1 = await call(env, req("/admin/csv", { cookie: s.cookie }));
  assert.equal(r1.status, 200);
  assert.match(r1.headers.get("cache-control"), /no-store/);
  const csv1 = await r1.text();
  assert.ok(csv1.startsWith(AT.csv.bookingsHead));
  assert.deepEqual([...new Uint8Array(await (await call(env, req("/admin/csv", { cookie: s.cookie }))).arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], "a byte order mark for spreadsheets");
  assert.match(csv1, /"First Person","sd\d+@example\.org","1","2026-11-18"/);
  await adminDo(env, s, "study-save:study1", { s: "studies", name: "Renamed study", target: "" });
  const csv2 = await (await call(env, req("/admin/csv", { cookie: s.cookie }))).text();
  assert.match(csv2, /"First Person","sd\d+@example\.org","Renamed study","2026-11-18"/);
  // the contacts export is still there
  const c = await call(env, req("/admin/csv-contactos", { cookie: s.cookie }));
  assert.equal(c.status, 200);
  assert.ok((await c.text()).startsWith(AT.csv.contactsHead));
});

// ---- the privacy sentence -------------------------------------------------------------------------------------------------------------
test("the built-in privacy text says, in es, en and it, that only counts per week are kept (no names or e-mail addresses), and that a count could still be connected to a person", async () => {
  const phrase = { es: "solo conserva recuentos por semana", en: "keeps only counts per week", it: "conserva soltanto i conteggi per settimana" };
  const names = { es: "sin nombres ni correos", en: "with no names or e-mail addresses", it: "senza nomi né indirizzi e-mail" };
  const honest = { es: "podría, aun así, relacionar un recuento con una persona", en: "could still connect a count to a person", it: "potrebbe comunque collegare un conteggio a una persona" };
  for (const l of ["es", "en", "it"]) {
    const p = BUILTIN_TEXTS[l].privacy;
    assert.ok(p.includes(phrase[l]) && p.includes(names[l]) && p.includes(honest[l]), l);
    assert.ok(!/sin ningún dato personal|without any personal data|senza alcun dato personale|por día|per day|per giorno/.test(p), `${l}: the old wording is gone`);
    // it sits in the retention part: between the retention heading and the cookies heading
    const from = p.search(/<h2>(Cuánto tiempo|How long|Per quanto tempo)<\/h2>/), to = p.search(/<h2>(Cookies|Cookie)<\/h2>/);
    assert.ok(from >= 0 && to > from && p.indexOf(phrase[l]) > from && p.indexOf(phrase[l]) < to, `${l}: in the retention part`);
  }
  // the page shows it unless the configuration restates its own privacy text
  const { env } = await setup();
  for (const l of TESTED) {
    const page = await text(await call(env, req(`/privacy?lang=${l}`)));
    if (T[l].privacy === BUILTIN_TEXTS[l].privacy) assert.ok(page.includes(phrase[l]), `${l} page`);
  }
  // the panel and the documents use the same words
  for (const set of Object.values(ADMIN_TEXT_SETS)) {
    assert.ok(!/per giorno|por día|per day/.test(set.data.summaryNote + set.data.noPersonal), "the panel says per week");
    assert.ok(/settimana|semana/.test(set.data.summaryNote) && /settimana|semana/.test(set.data.noPersonal) && /settimana|semana/.test(set.data.csvNote));
  }
});

// ---- nothing changes until the first save --------------------------------------------------------------------------------------------
// The surfaces that must be byte-identical: the landing page in every language, the e-mails (to the person and to the researcher) and the
// admin "everything" page, before and after only LOOKING at the studies section (and the preview of every language, and the data section).
async function surfaces(env, s, relayCalls) {
  const out = { pages: {}, admin: await adminGet(env, s, `?s=all&day=${DAY}`) };
  for (const l of LANGS) out.pages[l] = await text(await call(env, req(`/?lang=${l}`)));
  out.mails = relayCalls.map((c) => JSON.stringify(c.json));
  return out;
}
const SCRIPT = (cfgName) => `
import { setup, call, req, text, adminSession, adminDo, adminGet, relay, book, RELAY, LANGS, DAY } from "./test-generic/helpers.mjs";
const { DB, env } = await setup({ ...RELAY });
const s = await adminSession(env);
const m = relay();
await adminDo(env, s, "confirm-mode:instant", {}, undefined, m.fn);
const snap = async () => {
  const pages = {};
  for (const l of LANGS) pages[l] = await text(await call(env, req("/?lang=" + l)));
  return { pages, admin: await adminGet(env, s, "?s=all&day=" + DAY) };
};
const before = await snap();
// look at the new sections, every study, every preview language, the data section, the exports
for (const q of ["?s=studies", "?s=studies&st=study1", "?s=studies&st=study2", "?s=data", "?s=contacts", "?s=settings", ...LANGS.map((l) => "?s=studies&st=study1&pl=" + l)]) await adminGet(env, s, q);
await call(env, req("/admin/csv-resumen", { cookie: s.cookie }));
await call(env, req("/admin/csv", { cookie: s.cookie }));
const after = await snap();
const rowsAfter = DB.raw.prepare("SELECT (SELECT count(*) FROM studies) st, (SELECT count(*) FROM tallies) ta").get();
// the e-mails of a booking, before any save
const res = await book(env, {}, { fetchFn: m.fn });
console.log(JSON.stringify({ cfg: ${JSON.stringify(cfgName)}, samePages: JSON.stringify(before.pages) === JSON.stringify(after.pages), sameAdmin: before.admin === after.admin, rowsAfter: { ...rowsAfter }, status: res.status, mails: m.calls.length, hasLandingCard: LANGS.length }));
`;

test("while no study was saved, the landing page and the admin 'everything' page are byte-identical before and after merely opening the studies section", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  const m = relay();
  const before = await surfaces(env, s, m.calls);
  for (const q of ["?s=studies", "?s=studies&st=study1", `?s=studies&st=study1&pl=${L0}`, "?s=data", "?s=contacts", "?s=settings", "?s=studies&st=study2", "?s=studies&st=nope&pl=xx"]) await adminGet(env, s, q);
  for (const l of LANGS) await adminGet(env, s, `?s=studies&st=study1&pl=${l}`);
  for (const p of ["/admin/csv-resumen", "/admin/csv", "/admin/csv-contactos"]) assert.equal((await call(env, req(p, { cookie: s.cookie }))).status, 200);
  const after = await surfaces(env, s, m.calls);
  assert.deepEqual(after.pages, before.pages);
  assert.equal(after.admin, before.admin);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0, "no row was written by looking");
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM tallies").get().n, 0);
  assert.equal((await D.getRegistry(DB)).table, false);
  // actions that are not a save of a study do not write the table either: switching the active study, the exports, the settings
  if (C.twoStudies) await adminDo(env, s, "study:study2", { s: "studies" });
  await adminDo(env, s, "times", { s: "settings", times: C.defaultTimes[0] });
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0);
});

test("while no study was saved, the e-mails (to the person and to the researcher) are the same as before: no study name appears in the notice", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  const m = relay();
  await adminDo(env, s, "confirm-mode:instant", {}, NOW, m.fn);
  assert.equal((await book(env, {}, { fetchFn: m.fn })).status, 200);
  const notice = m.calls.find((c) => c.json.to === C.contactEmail).json;
  // the notice of a configuration with one study names none; with two it uses the fixed words "Study 1" / "Study 2" of the admin language
  const label = (n) => AT.mail.study(n);
  if (C.twoStudies) assert.ok(notice.text.includes(` · ${label(false)}`) && !notice.text.includes(label(true)));
  else assert.ok(!/ · /.test(notice.text.split("\n")[1]), notice.text);
  assert.equal((await D.getRegistry(DB)).table, false);
  // after the first save, with a single study in the table, the notice names none; with several it names the study by its own name
  await adminDo(env, s, "study-save:study1", { s: "studies", name: "Named study", target: "" });
  const reg = await D.getRegistry(DB);
  const m2 = relay();
  await D.openDay(DB, "2026-11-19", C.defaultTimes);
  assert.equal((await book(env, { slot: `2026-11-19T${C.defaultTimes[0]}` }, { fetchFn: m2.fn })).status, 200);
  const n2 = m2.calls.find((c) => c.json.to === C.contactEmail).json;
  if (reg.studies.length > 1) assert.ok(n2.text.includes(" · Named study"), n2.text);
  else assert.ok(!n2.text.includes("Named study"), n2.text);
});

test("the same guarantee under another configuration (two studies, Spanish and Italian), in a scratch copy", () => {
  const source = readFileSync(new URL("../config/test-variants/spanish-italian.config.js", import.meta.url), "utf8");
  const r = withConfig(null, SCRIPT("spanish-italian"), source);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  assert.equal(o.cfg, "spanish-italian");
  assert.equal(o.samePages, true);
  assert.equal(o.sameAdmin, true);
  assert.deepEqual(o.rowsAfter, { st: 0, ta: 0 });
  assert.equal(o.status, 200);
  assert.ok(o.mails >= 1);
});

test("the same guarantee under the configuration the suite runs against, in a scratch copy", () => {
  const r = withConfig(rawConfig(), SCRIPT("own"));
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  assert.equal(o.samePages, true);
  assert.equal(o.sameAdmin, true);
  assert.deepEqual(o.rowsAfter, { st: 0, ta: 0 });
});

test("the studies section does not exist for a visitor: no session, no sections", async () => {
  const { env } = await setup();
  for (const q of ["?s=studies", "?s=data", "?s=all"]) {
    const h = await text(await call(env, req(`/admin${q}`)));
    assert.ok(!h.includes('id="sec-studies"') && !h.includes('id="sec-data"') && !h.includes("main-nav"), q);
    assert.match(h, /name="password"/);
  }
});

// ---- documentation -------------------------------------------------------------------------------------------------------------------
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the documentation describes the studies, the first save, the targets, the tallies and the privacy sentence", () => {
  const studi = read("docs/studi.md");
  for (const w of ["primo salvataggio", "study1", "obiettivo", "Archivia", "mai", "tallies", "testo semplice", "s…", "Nuovo studio", "Anteprima".toLowerCase()]) assert.ok(studi.toLowerCase().includes(w.toLowerCase()), `docs/studi.md says "${w}"`);
  for (const n of ["60", "160", "1200", "2000", "300", "20", "9999"]) assert.ok(studi.includes(n), `docs/studi.md states the limit ${n}`);
  for (const f of ["README.md", "README.it.md", "AGENTS.md"]) assert.ok(read(f).includes("docs/studi.md"), `${f} points to docs/studi.md`);
  const privacy = read("docs/privacy.md");
  assert.ok(privacy.includes("`tallies`") && /conteggi per settimana/.test(privacy) && !/conteggi per giorno/.test(privacy), "docs/privacy.md lists the tallies and the sentence a lab with its own privacy text should add");
  assert.ok(/chi sa chi è venuto/i.test(privacy) && /collegare un conteggio a una persona/.test(privacy), "docs/privacy.md says honestly that a count could still be connected to a person");
  assert.ok(/texts\.<lingua>\.privacy/.test(privacy));
  for (const f of ["README.md", "README.it.md"]) assert.ok(/tallies/.test(read(f)), `${f} mentions the counts that survive the purge`);
  assert.ok(/studies/.test(read("AGENTS.md")) && /tallies/.test(read("AGENTS.md")));
});
