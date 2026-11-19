// Participants done outside the booking site: a number the researcher sets by hand per study ("outside"). It adds to the done count of
// the progress, is edited in the study form and in a quick form of the progress block, survives every other save, and never reaches the
// anonymous usage report.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { esc } from "../src/util.js";
import { LIMITS, parseStored, serialize, studyFromForm, progressOf, parseOutside, dataOf } from "../src/studies.js";
import { usageBody } from "../src/usage.js";
import { LANGS, NOW, DAY, A, C, setup, call, req, adminSession, adminDo, adminGet, code } from "./helpers.mjs";

const L0 = LANGS[0];
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const blank = () => Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]]));
const fields = (o = {}) => ({ name: "Study", target: "", ...blank(), ...o });
const row = (DB, id) => DB.raw.prepare("SELECT data, updated_at FROM studies WHERE id = ?").get(id);
const stored = (DB, id) => parseStored(row(DB, id).data);
const has = (html, t) => html.includes(esc(t));
let k = 0;
function attended(DB, study, n = 1) {
  for (let i = 0; i < n; i++) {
    k++;
    DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?)")
      .run(`so${k}`, `so${k}`.padEnd(30, "x"), study, new Date(Date.UTC(2026, 0, 1) + k * 86400000).toISOString().slice(0, 10), A, "Test Person", `so${k}@example.org`, `so${k}@example.org`, "attended", NOW.toISOString(), L0);
  }
}
async function create(env, s, o = {}) {
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  const id = loc(r).searchParams.get("st");
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields(o) })), "study-saved");
  return id;
}
// The quick form of a study as the page draws it: the fields a browser would post (the first form of that id on the page).
function quickForm(html, id, at = "ag") {
  const m = new RegExp(`<form class="out-form"[^>]*id="${at}-out-${id}">([\\s\\S]*?)</form>`).exec(html);
  assert.ok(m, `no quick form for ${id} at ${at}`);
  const out = {};
  for (const i of m[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) out[i[1]] = i[2];
  delete out.csrf; // each test adds the token the way it wants to
  out.outside = /name="outside"[^>]*value="([^"]*)"/.exec(m[1])[1];
  return { fields: out, html: m[1] };
}
const quick = (env, s, id, verb, extra = {}) => adminDo(env, s, `${verb}:${id}`, extra);

test("parseStored and serialize: outside is read leniently and written only when it is above 0", () => {
  const base = { name: "N", target: 5, archived: false, declarations: { epilepsy: false, vestibular: false }, texts: {} };
  for (const bad of [-1, 0, 1.5, "4", null, true, [], {}, 10000, 1e9, NaN]) assert.equal(parseStored(JSON.stringify({ ...base, outside: bad })).outside, 0, String(bad));
  assert.equal(parseStored(JSON.stringify(base)).outside, 0);
  assert.equal(parseStored(JSON.stringify({ ...base, outside: 4 })).outside, 4);
  assert.equal(parseStored(JSON.stringify({ ...base, outside: 9999 })).outside, 9999);
  // round trip, and the JSON of a study without the number is byte-identical to what was stored before the key existed
  const without = serialize(parseStored(JSON.stringify(base)));
  assert.ok(!without.includes("outside"));
  assert.equal(serialize(parseStored(without)), without);
  assert.ok(!serialize({ ...parseStored(JSON.stringify(base)), outside: 0 }).includes("outside"));
  assert.ok(!serialize({ ...parseStored(JSON.stringify(base)), outside: undefined }).includes("outside"));
  const withIt = serialize({ ...parseStored(JSON.stringify(base)), outside: 7 });
  assert.match(withIt, /"outside":7/);
  assert.equal(parseStored(withIt).outside, 7);
  assert.equal(serialize(parseStored(withIt)), withIt);
  assert.equal(LIMITS.outside, 9999);
});

test("parseOutside: an integer from 0 to 9999, empty is 0, anything else is null", () => {
  assert.equal(parseOutside(""), 0);
  assert.equal(parseOutside("  "), 0);
  assert.equal(parseOutside(" 12 "), 12);
  assert.equal(parseOutside("0"), 0);
  assert.equal(parseOutside("9999"), 9999);
  for (const bad of ["10000", "-1", "1.5", "1e3", "abc", "1 2", "+3", "0x10", "99999"]) assert.equal(parseOutside(bad), null, bad);
});

test("progressOf adds outside to the done count; remaining and the percentage follow", () => {
  assert.deepEqual(progressOf({ target: 10, outside: 4 }, { attended: 3, upcoming: 2 }), { done: 7, site: 3, outside: 4, upcoming: 2, target: 10, remaining: 3, pct: 70 });
  assert.deepEqual(progressOf({ target: 10 }, { attended: 3, upcoming: 2 }).outside, 0);
  assert.equal(progressOf({ target: 10, outside: 20 }, undefined).remaining, 0);
  assert.equal(progressOf({ target: 10, outside: 20 }, undefined).pct, 100);
  assert.equal(progressOf({ target: null, outside: 3 }, { attended: 1 }).done, 4);
  assert.equal(progressOf({ target: 5, outside: -3 }, { attended: 1 }).done, 1, "a negative number is never used");
});

test("the form field: valid, empty and invalid values; a form that does not send it leaves the number alone", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Outside", target: "10" });
  assert.equal(stored(DB, id).outside, 0);
  assert.ok(!row(DB, id).data.includes("outside"), "nothing stored while it is 0");
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Outside", target: "10", outside: "6" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 6);
  // not sent: unchanged
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Outside again", target: "10" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 6);
  // empty: 0, and the key goes away
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Outside again", target: "10", outside: "" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 0);
  assert.ok(!row(DB, id).data.includes("outside"));
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Outside again", target: "10", outside: "9999" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 9999);
  // refused: the form comes back (200) with its own message and nothing is saved
  for (const bad of ["10000", "-1", "2.5", "abc", "1e2"]) {
    const before = row(DB, id).data;
    const r = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Hacked", target: "10", outside: bad }) });
    assert.equal(r.status, 200, bad);
    const html = await r.text();
    assert.ok(has(html, AT.refuse.outside), `the field message for ${bad}`);
    assert.ok(html.includes('id="st-outside-err"'));
    assert.ok(html.includes(`value="${esc(bad)}"`), "what was typed is kept");
    assert.equal(row(DB, id).data, before, `nothing saved for ${bad}`);
  }
  // the field is drawn with its label and hint
  const page = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.match(page, /<input id="st-outside" name="outside" type="number" min="0" max="9999" step="1"[^>]*value="9999">/);
  assert.ok(has(page, AT.studies.fOutside) && has(page, AT.studies.outsideHint));
  // studyFromForm directly: a Map without the key keeps the current value
  const reg = await D.getRegistry(DB);
  const cur = reg.studies.find((x) => x.id === id);
  assert.equal(studyFromForm(new Map([["name", "X"]]), cur, reg).data.outside, 9999);
});

test("the first save of a study of the configuration with outside 0 stores no key; the field is drawn with 0", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  assert.match(await adminGet(env, s, "?s=studies"), /name="outside"[^>]*value="0"/);
  assert.equal(code(await adminDo(env, s, "study-save:study1", { s: "studies", ...fields({ name: "Renamed", outside: "0" }) })), "study-saved");
  assert.equal((await D.getRegistry(DB)).table, true);
  for (const r of DB.raw.prepare("SELECT data FROM studies").all()) assert.ok(!r.data.includes("outside"));
});

test("the quick form: set, +1, the cap, an empty and an invalid value", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Quick", target: "10" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  attended(DB, id, 2);
  // the form is in the agenda block and in the list, with a real label and the +1 button
  const agenda = await adminGet(env, s, "?s=agenda");
  const q = quickForm(agenda, id, "ag");
  assert.equal(q.fields.outside, "0");
  assert.ok(has(q.html, AT.progress.outsideLabel) && q.html.includes(`for="ag-out-${id}-n"`) && q.html.includes(`id="ag-out-${id}-n"`));
  assert.match(q.html, /<input id="[^"]+" name="outside" type="number" inputmode="numeric" min="0" max="9999" step="1" value="0">/);
  assert.ok(q.html.includes(`value="study-outside:${id}"`) && q.html.includes(`value="study-outside-plus:${id}"`) && q.html.includes(">+1</button>"));
  assert.ok(!/style=/.test(q.html));
  quickForm(await adminGet(env, s, `?s=studies&st=${id}`), id, "st");
  // set
  let r = await quick(env, s, id, "study-outside", { ...q.fields, outside: "4" });
  assert.equal(r.status, 303);
  assert.equal(code(r), "study-outside");
  assert.match(r.headers.get("location"), new RegExp(`#ag-out-${id}$`));
  assert.equal(stored(DB, id).outside, 4);
  let page = await adminGet(env, s, "?s=agenda");
  assert.ok(has(page, AT.progress.of(6, 10)), "2 on the site + 4 outside");
  assert.ok(has(page, AT.progress.parts(2, 4)));
  assert.ok(has(page, AT.progress.remaining(4)));
  assert.match(page, /<progress class="prog" max="10" value="6"[^>]*>60%<\/progress>/);
  // the redirect shows the message
  const flash = await adminGet(env, s, loc(r).search + "&s=agenda");
  assert.ok(has(flash, AT.flash["study-outside"]));
  // +1 (the number typed in the box is ignored: +1 adds to the stored one)
  r = await quick(env, s, id, "study-outside-plus", { ...quickForm(page, id).fields, outside: "100" });
  assert.equal(code(r), "study-outside");
  assert.equal(stored(DB, id).outside, 5);
  // the list returns to the study that was selected there
  const list = quickForm(await adminGet(env, s, `?s=studies&st=${id}`), id, "st");
  r = await quick(env, s, id, "study-outside-plus", list.fields);
  assert.equal(stored(DB, id).outside, 6);
  assert.match(r.headers.get("location"), new RegExp(`s=studies.*&st=${id}.*#st-out-${id}$`));
  // empty is 0
  r = await quick(env, s, id, "study-outside", { ...quickForm(await adminGet(env, s, "?s=agenda"), id).fields, outside: "" });
  assert.equal(code(r), "study-outside");
  assert.equal(stored(DB, id).outside, 0);
  assert.ok(!row(DB, id).data.includes("outside"));
  // cap
  const f = () => adminGet(env, s, "?s=agenda").then((h) => quickForm(h, id).fields);
  assert.equal(code(await quick(env, s, id, "study-outside", { ...(await f()), outside: "9999" })), "study-outside");
  assert.equal(code(await quick(env, s, id, "study-outside-plus", await f())), "study-outside");
  assert.equal(stored(DB, id).outside, 9999, "+1 stops at 9999");
  // invalid
  for (const bad of ["10000", "-2", "1.5", "x"]) {
    const before = row(DB, id);
    r = await quick(env, s, id, "study-outside", { ...(await f()), outside: bad });
    assert.equal(code(r), "study-outside-bad", bad);
    assert.deepEqual(row(DB, id), before);
  }
  assert.ok(has(await adminGet(env, s, "?s=agenda&m=study-outside-bad"), AT.flash["study-outside-bad"]));
});

test("the quick form: no session, no token, a stale page, an unknown study and a study still in the configuration are all refused", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Guard", target: "10" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  const q = quickForm(await adminGet(env, s, "?s=agenda"), id);
  for (const verb of ["study-outside", "study-outside-plus"]) {
    const extra = { ...q.fields, outside: "3" };
    const before = row(DB, id);
    assert.equal((await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: `${verb}:${id}`, ...extra } }))).status, 403, "no token");
    assert.equal((await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: `${verb}:${id}`, ...extra, csrf: "x".repeat(24) } }))).status, 403, "wrong token");
    assert.equal((await call(env, req("/admin/do", { method: "POST", fields: { do: `${verb}:${id}`, ...extra } }))).status, 401, "no session");
    assert.equal((await call(env, req(`/admin/do?do=${verb}:${id}`, { cookie: s.cookie }))).status === 200, false);
    assert.deepEqual(row(DB, id), before);
  }
  // unknown id
  assert.equal(code(await quick(env, s, "nope", "study-outside", { ...q.fields, outside: "3" })), "study-gone");
  // a stale page: the study was saved from another tab after this page was drawn
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Guard 2", target: "10", outside: "2" }) }, new Date(NOW.getTime() + 60_000))), "study-saved");
  const before = row(DB, id);
  for (const verb of ["study-outside", "study-outside-plus"]) {
    const r = await quick(env, s, id, verb, { ...q.fields, outside: "50" });
    assert.equal(code(r), "study-changed", verb);
    assert.deepEqual(row(DB, id), before, `${verb}: nothing overwritten`);
  }
  // a page without the change date is a stale page too
  const { rev, ...noRev } = q.fields;
  assert.equal(code(await quick(env, s, id, "study-outside", { ...noRev, outside: "50" })), "study-changed");
  assert.equal(stored(DB, id).outside, 2);
  // the fresh page works
  const fresh = quickForm(await adminGet(env, s, "?s=agenda"), id);
  assert.equal(fresh.fields.outside, "2");
  assert.equal(code(await quick(env, s, id, "study-outside-plus", fresh.fields)), "study-outside");
  assert.equal(stored(DB, id).outside, 3);
});

test("a study still coming from the configuration has no quick form; an archived study keeps its form, like its target", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const list = await adminGet(env, s, "?s=studies");
  assert.ok(!list.includes('class="out-form"'), "no study row to write to yet");
  assert.equal((await D.getRegistry(DB)).table, false);
  assert.equal(code(await adminDo(env, s, "study-outside:study1", { at: "st", sel: "study1", rev: "", outside: "3" })), "denied");
  assert.equal((await D.getRegistry(DB)).table, false, "and nothing was seeded");
  const a = await create(env, s, { name: "A", target: "4" });
  const b = await create(env, s, { name: "B", target: "4" });
  await adminDo(env, s, `study:${a}`, { s: "studies" });
  assert.equal(code(await adminDo(env, s, `study-archive:${b}`, { s: "studies" })), "study-archived");
  const q = quickForm(await adminGet(env, s, `?s=studies&st=${b}`), b, "st");
  assert.equal(code(await quick(env, s, b, "study-outside", { ...q.fields, outside: "2" })), "study-outside");
  assert.equal(stored(DB, b).outside, 2);
  assert.equal(stored(DB, b).archived, true);
});

test("outside survives every other action on the study", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const a = await create(env, s, { name: "Keep A", target: "10", outside: "8" });
  const b = await create(env, s, { name: "Keep B", target: "10" });
  await adminDo(env, s, `study:${a}`, { s: "studies" });
  const outside = () => stored(DB, a).outside;
  assert.equal(outside(), 8);
  assert.equal(code(await adminDo(env, s, `study-archive:${b}`, { s: "studies" })), "study-archived");
  assert.equal(code(await adminDo(env, s, `study-restore:${b}`, { s: "studies" })), "study-restored");
  await adminDo(env, s, `study:${b}`, { s: "studies" });
  assert.equal(code(await adminDo(env, s, `study-archive:${a}`, { s: "studies" })), "study-archived");
  assert.equal(outside(), 8, "archive");
  assert.equal(code(await adminDo(env, s, `study-restore:${a}`, { s: "studies" })), "study-restored");
  assert.equal(outside(), 8, "restore");
  // study-save-activate, public state, a plain form save that has no outside field
  assert.equal(code(await adminDo(env, s, `study-save-activate:${a}`, { s: "studies", ...fields({ name: "Keep A", target: "10", public_state: "later" }) })), "study-saved-active");
  assert.equal(outside(), 8, "save and activate");
  assert.equal(code(await adminDo(env, s, `study-save:${a}`, { s: "studies", ...fields({ name: "Keep A", target: "12", public_state: "done" }) })), "study-saved");
  assert.equal(stored(DB, a).publicState, "done");
  assert.equal(outside(), 8, "public state");
  // the consent sheet
  const consent = Object.fromEntries(LANGS.flatMap((l) => ["heading", "welcome", "description", "procedure", "duration", "risks", "exclusion", "rights", "dataCollected", "storage", "whoUses", "publication", "retention", "controller", "supervisors", "withdraw", "perms"].map((n) => [`c_${n}_${l}`, ""])));
  assert.equal(code(await adminDo(env, s, `consent-save:${a}`, { s: "studies", ...consent, [`c_heading_${L0}`]: "A heading" })), "consent-saved");
  assert.equal(stored(DB, a).consent[L0].heading, "A heading");
  assert.equal(outside(), 8, "consent");
  // the study that is active changes with the switch buttons
  await adminDo(env, s, `study:${b}`, { s: "studies" });
  assert.equal(outside(), 8, "switching the active study");
  // dataOf carries it
  const reg = await D.getRegistry(DB);
  assert.equal(dataOf(reg.studies.find((x) => x.id === a), { archived: true }).outside, 8);
  // a study of the configuration saved first: the number typed in the form is stored with the seeding
  const { DB: DB2, env: env2 } = await setup();
  const s2 = await adminSession(env2);
  assert.equal(code(await adminDo(env2, s2, "study-save:study1", { s: "studies", ...fields({ name: "Config study", target: "5", outside: "3" }) })), "study-saved");
  assert.equal(stored(DB2, "study1").outside, 3);
  assert.equal(stored(DB2, "study1").target, 5);
});

test("the progress shows the sum, and the line with the two parts only when outside is above 0, in the agenda and in the list", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Sum", target: "10" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  attended(DB, id, 3);
  for (const qs of ["?s=agenda", `?s=studies&st=${id}`]) {
    const page = await adminGet(env, s, qs);
    assert.ok(has(page, AT.progress.of(3, 10)), qs);
    assert.ok(has(page, AT.progress.remaining(7)));
    assert.ok(!page.includes('class="prog-parts note"'), "no parts line without outside");
  }
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Sum", target: "10", outside: "4" }) });
  for (const qs of ["?s=agenda", `?s=studies&st=${id}`]) {
    const page = await adminGet(env, s, qs);
    assert.ok(has(page, AT.progress.of(7, 10)), qs);
    assert.ok(has(page, AT.progress.remaining(3)));
    assert.ok(has(page, AT.progress.parts(3, 4)));
    assert.match(page, /<progress class="prog" max="10" value="7"[^>]*>70%<\/progress>/);
  }
  // more than needed: reached
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Sum", target: "10", outside: "30" }) });
  const over = await adminGet(env, s, "?s=agenda");
  assert.ok(has(over, AT.progress.of(33, 10)) && has(over, AT.progress.reached));
  assert.match(over, /<progress class="prog" max="10" value="10"/);
  // no target: the list line counts it and shows the parts and the form
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Sum", target: "", outside: "4" }) });
  const none = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.ok(has(none, AT.studies.doneNoTarget(7, 0)) && has(none, AT.progress.parts(3, 4)));
  quickForm(none, id, "st");
  assert.ok(!(await adminGet(env, s, "?s=agenda")).includes("<progress"));
});

test("both admin languages have the same new keys, and the singular and the numbers read right", () => {
  const P = ["parts", "outsideLabel", "outsideSave", "outsidePlusLabel", "outsideSaveLabel"];
  const S = ["fOutside", "outsideHint"];
  for (const lang of Object.keys(ADMIN_TEXT_SETS)) {
    const t = ADMIN_TEXT_SETS[lang];
    for (const key of P) assert.ok(t.progress[key], `${lang}.progress.${key}`);
    for (const key of S) assert.ok(typeof t.studies[key] === "string" && t.studies[key], `${lang}.studies.${key}`);
    assert.ok(t.studies.fieldLabel.outside && t.refuse.outside, lang);
    assert.ok(t.flash["study-outside"] && t.flash["study-outside-bad"], lang);
    assert.match(t.progress.parts(28, 4), /28/);
    assert.match(t.progress.parts(28, 4), /4/);
    assert.match(t.progress.outsidePlusLabel("X"), /X/);
    assert.match(t.progress.outsideSaveLabel("X"), /X/);
    assert.ok(t.progress.outsidePlusLabel("X").startsWith("+1"), "the accessible name starts with the visible text");
    assert.ok(t.progress.outsideSaveLabel("X").startsWith(t.progress.outsideSave), "the accessible name starts with the visible text");
  }
  assert.equal(ADMIN_TEXT_SETS.it.progress.parts(28, 4), "28 con prenotazione sul sito, 4 al di fuori del sito");
  assert.equal(ADMIN_TEXT_SETS.es.progress.parts(28, 4), "28 con reserva en la web, 4 fuera de la web");
  assert.equal(ADMIN_TEXT_SETS.it.flash["study-outside"], "Numero aggiornato.");
  assert.equal(ADMIN_TEXT_SETS.es.flash["study-outside"], "Número actualizado.");
});

test("the anonymous usage report keeps counting only the bookings marked as attended", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Usage", target: "10" });
  attended(DB, id, 2);
  const before = await usageBody(DB);
  assert.equal(JSON.parse(before).sessions, 2);
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Usage", target: "10", outside: "40" }) });
  assert.equal(stored(DB, id).outside, 40);
  assert.equal(await usageBody(DB), before);
});

test("the quick form is drawn mobile first with the existing styles and no inline style", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.out-form\b/);
  assert.match(css, /\.out-form input\[type=number\]\{max-width:12rem\}/);
  assert.ok(!/\.out-form[^{]*\{[^}]*(?:width:\s*\d{3,}px|min-width:\s*\d{3,}px)/.test(css), "no fixed width wider than a small phone");
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Style", target: "3" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  const html = await adminGet(env, s, "?s=all");
  assert.ok(!/<form class="out-form"[^>]*style=/.test(html));
  // the two buttons are the admin buttons (44 px high in admin.css) and the input is a number input (46 px)
  assert.match(css, /button,\.btn-link\{[^}]*min-height:44px/);
});

test("a full form saved after a quick +1 does not undo it; a number the researcher typed is saved", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Race", target: "10", outside: "4" });
  // the form is drawn showing 4, and it carries what it showed
  const page = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.match(page, /<input type="hidden" name="outside_was" value="4">/);
  // meanwhile the quick form adds one
  const q = quickForm(page, id, "st");
  assert.equal(code(await quick(env, s, id, "study-outside-plus", { ...q.fields, s: "studies" })), "study-outside");
  assert.equal(stored(DB, id).outside, 5);
  // the old form is saved with an unrelated change and the untouched number
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Race renamed", target: "10", outside: "4", outside_was: "4" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 5, "the +1 is kept");
  assert.equal(stored(DB, id).name, "Race renamed");
  // a number changed in the form is written
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Race renamed", target: "10", outside: "8", outside_was: "5" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 8);
  // changed to 0 on purpose
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Race renamed", target: "10", outside: "0", outside_was: "8" }) })), "study-saved");
  assert.equal(stored(DB, id).outside, 0);
});
