// Studies managed from the panel, part 4: a row stores only what differs from the fallback, the public list of studies (hidden, later,
// done), updates that cannot overwrite each other, refused saves that keep what was typed, the study title where it belongs, and the
// small flow and wording changes of the panel.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { T } from "../src/i18n.js";
import { esc } from "../src/util.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { weekToOpen, weekMonday, addDays, prettyDay, DAYS_AHEAD } from "../src/slots.js";
import { parseStored, LIMITS, fallbackTexts, resolveTexts, autoPublicState, publicStateOf, publicStudies, studyFromForm, normText } from "../src/studies.js";
import { formFields } from "./forms.mjs";
import { C, DAY, NOW, MONDAY, LANGS, TESTED, at, setup, call, req, text, book, relay, RELAY, rows, adminSession, adminDo, adminGet, code, rawConfig, withConfig, loopbackFetch } from "./helpers.mjs";

const L0 = LANGS[0];
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const stored = (DB, id) => parseStored(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data);
const rawRow = (DB, id) => DB.raw.prepare("SELECT data, updated_at FROM studies WHERE id = ?").get(id);
const home = async (env, lang = L0) => text(await call(env, req(`/?lang=${lang}`)));
const blank = () => Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]]));
const fields = (o = {}) => ({ name: "Study", target: "", ...blank(), ...o });
// A new draft, saved with the given fields (the drafts get names "untitled study N": the name is given here, always different)
let n = 0;
async function draft(env, s, o = {}) {
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  assert.equal(code(r), "study-new");
  const id = loc(r).searchParams.get("st");
  if (Object.keys(o).length) {
    const r2 = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: `Rules study ${++n}`, ...o }) });
    assert.equal(code(r2), "study-saved", `${id}: ${r2.status}`);
  }
  return id;
}
// The posted form of the study editor, as the panel shows it (what a browser would send), with changes.
const editorForm = async (env, s, id, over = {}) => ({ ...formFields(await adminGet(env, s, `?s=studies&st=${id}`), `study-save:${id}`), ...over });
const consentForm = async (env, s, id, over = {}) => ({ ...formFields(await adminGet(env, s, `?s=studies&st=${id}&c=consent`), `consent-save:${id}`), ...over });

// ---- A: a row stores only what differs from the fallback ------------------------------------------------------------------------------
test("the editor shows the text the page shows; saving it as it is stores nothing; a changed text is stored; putting the original back stores nothing again", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s);
  const f = await editorForm(env, s, id);
  for (const l of LANGS) {
    const fb = fallbackTexts(l, id);
    assert.equal(f[`title_${l}`], fb.title, `${l}: the title field holds the text of the page`);
    assert.equal(f[`lead_${l}`].replace(/\r\n/g, "\n"), fb.lead);
    assert.equal(f[`does_${l}`].replace(/\r\n/g, "\n"), fb.does);
    assert.equal(f[`reqs_${l}`].replace(/\r\n/g, "\n"), fb.reqs.join("\n"));
  }
  const before = rawRow(DB, id);
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, f)), "study-saved");
  assert.deepEqual({ ...rawRow(DB, id) }, { ...before }, "an unedited save writes nothing: the JSON and the change date stay");
  // only the field that was changed is stored
  await adminDo(env, s, `study-save:${id}`, { ...f, [`does_${L0}`]: "My own description of the session." });
  const one = stored(DB, id);
  assert.equal(one.texts[L0].does, "My own description of the session.");
  for (const l of LANGS) {
    assert.equal(one.texts[l].title, "", `${l}: title not stored`);
    assert.equal(one.texts[l].lead, "", `${l}: lead not stored`);
    assert.deepEqual(one.texts[l].reqs, [], `${l}: requirements not stored`);
    if (l !== L0) assert.equal(one.texts[l].does, "", `${l}: does not stored`);
  }
  assert.ok((await home(env)).length > 0);
  // the original text again, with other line endings and spaces around it: stored as empty
  const original = fallbackTexts(L0, id).does;
  await adminDo(env, s, `study-save:${id}`, { ...f, [`does_${L0}`]: `  ${original.replace(/\n/g, "\r\n")}\r\n \r\n` });
  assert.equal(stored(DB, id).texts[L0].does, "", "equal after normalising line endings and the whitespace around it");
  // anything else that differs, even by one character or by the whitespace inside, is the researcher's text
  await adminDo(env, s, `study-save:${id}`, { ...f, [`does_${L0}`]: `${original}!` });
  assert.equal(stored(DB, id).texts[L0].does, `${original}!`);
  assert.equal(normText(" a\r\nb \r\n"), "a\nb");
});

test("a text of the configuration that is longer than the limits, with special characters, survives the first save untouched: nothing is cut, the form does not cut it either", () => {
  const cfg = rawConfig();
  const l = cfg.languages[0];
  const long = `Línea uno: <b>"quoted"</b> & 'single' ñ é   non-breaking.\n\n${"Palabra ".repeat(400)}fin & <i>x</i>`;
  assert.ok(long.length > LIMITS.does + 500);
  cfg.texts = { ...(cfg.texts || {}), [l]: { ...((cfg.texts || {})[l] || {}), "study1.does": long, "study1.lead": `L${"l".repeat(1500)}`, "study1.reqs": Array.from({ length: 25 }, (_, i) => `Requirement ${i} ${"r".repeat(310)}`), title: `T${"t".repeat(190)}` } };
  const script = `
import { setup, call, req, text, adminSession, adminDo, adminGet, LANGS } from "./test-generic/helpers.mjs";
import { formFields } from "./test-generic/forms.mjs";
import { parseStored } from "./src/studies.js";
const { DB, env } = await setup();
const s = await adminSession(env);
const l = LANGS[0];
const page = async () => text(await call(env, req("/?lang=" + l)));
const before = await page();
const editor = await adminGet(env, s, "?s=studies&st=study1");
const f = formFields(editor, "study-save:study1");
const r = await adminDo(env, s, "study-save:study1", f);
const row = DB.raw.prepare("SELECT data, updated_at FROM studies WHERE id = 'study1'").get();
const t = parseStored(row.data).texts[l];
const tag = (name) => new RegExp('<(?:textarea|input)[^>]*name="' + name + '"[^>]*>').exec(editor)[0];
console.log(JSON.stringify({ status: r.status, location: r.headers.get("location"), same: before === (await page()), stored: t, updated: row.updated_at,
  longKept: before.includes("Palabra Palabra"), maxlength: { does: /maxlength/.test(tag("does_" + l)), lead: /maxlength/.test(tag("lead_" + l)), title: /maxlength/.test(tag("title_" + l)) },
  hasReqs: f["reqs_" + l].split("\\r\\n").length }));
`;
  const r = withConfig(cfg, script);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  assert.equal(o.status, 303, o.location);
  assert.match(o.location, /m=study-saved/, "the save is accepted although the texts are over the limits: limits apply to what is stored");
  assert.equal(o.same, true, "the landing page is byte-identical");
  assert.equal(o.longKept, true, "the long text is on the page in full");
  assert.deepEqual(o.stored, { title: "", lead: "", does: "", reqs: [] }, "nothing of it was copied into the row");
  assert.equal(o.updated, "");
  assert.deepEqual(o.maxlength, { does: false, lead: false, title: false }, "the fields that hold more than the limit do not carry a maxlength that would cut them in the browser");
  assert.equal(o.hasReqs, 25);
});

test("every field that has a limit says it in a short hint under the field, and the limit is also in the control when the text fits", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s, { [`title_${L0}`]: "Short title" });
  const h = await adminGet(env, s, `?s=studies&st=${id}`);
  for (const [field, max] of [["name", LIMITS.name], ["st-title-" + L0, LIMITS.title], ["st-lead-" + L0, LIMITS.lead], ["st-does-" + L0, LIMITS.does]]) {
    const idAttr = field.startsWith("st-") ? field : "st-name";
    assert.match(h, new RegExp(`id="${idAttr}-hint">${esc(AT.studies.max(max))}</p>`), `${idAttr}: hint with the limit`);
    assert.match(h, new RegExp(`id="${idAttr}"[^>]*aria-describedby="${idAttr}-hint"`), `${idAttr}: the field points at its hint`);
  }
  assert.match(h, new RegExp(`id="st-reqs-${L0}-hint">${esc(AT.studies.maxReqs(LIMITS.reqs, LIMITS.req))}</p>`));
  assert.match(h, /id="st-target-hint">/);
  const c = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  assert.match(c, new RegExp(`id="cs-heading-${L0}-hint">`));
  assert.match(c, new RegExp(`id="cs-perms-${L0}-hint">`));
});

// ---- B: the public list of studies ---------------------------------------------------------------------------------------------------
const reg = (list, active, extra = {}) => ({ table: true, active, studies: list.map((x, i) => ({ position: i + 1, archived: false, texts: {}, declarations: {}, ...x })), ...extra });

test("publicState: hidden, later or done, and the active study is always 'now'; a seeded study nobody set follows its position, any other is hidden", () => {
  const seeded = C.twoStudies ? ["study1", "study2"] : ["study1"];
  const r = reg([...seeded.map((id) => ({ id })), { id: "sdraft00001" }, { id: "slater00001", publicState: "later" }, { id: "sdone000001", publicState: "done" }, { id: "shid0000001", publicState: "hidden" }], "study1");
  const st = (id) => publicStateOf(r.studies.find((x) => x.id === id), r);
  assert.equal(st("study1"), "now");
  assert.equal(st("sdraft00001"), "hidden", "a new draft is hidden");
  assert.equal(st("slater00001"), "later"); assert.equal(st("sdone000001"), "done"); assert.equal(st("shid0000001"), "hidden");
  if (C.twoStudies) assert.equal(st("study2"), "later", "study1 active: study2 is later");
  assert.deepEqual(publicStudies(r).map((x) => x.id), [...seeded, "slater00001", "sdone000001"], "hidden studies are not public");
  // the active study is shown whatever its own state
  const r2 = { ...r, active: "shid0000001" };
  assert.equal(publicStateOf(r2.studies.find((x) => x.id === "shid0000001"), r2), "now");
  assert.ok(publicStudies(r2).some((x) => x.id === "shid0000001"));
  if (C.twoStudies) {
    const r3 = { ...r, active: "study2" };
    assert.equal(publicStateOf(r3.studies[0], r3), "done", "study2 active: study1 is done");
    assert.equal(autoPublicState(r3.studies[1], r3), "later");
  }
  // an archived study is not public
  const r4 = reg([{ id: "study1" }, { id: "sx000000001", publicState: "later", archived: true }], "study1");
  assert.deepEqual(publicStudies(r4).map((x) => x.id), ["study1"]);
});

test("a new draft is hidden: it never shows on the public page until the researcher lists it, and the card appears only with at least two public studies", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const l = TESTED[0];
  const S = T[l];
  const a = await draft(env, s, { [`title_${l}`]: "Hidden draft A" });
  const b = await draft(env, s, { [`title_${l}`]: "Hidden draft B" });
  assert.equal(stored(DB, a).publicState, "hidden");
  assert.equal(stored(DB, b).publicState, "hidden");
  let h = await home(env, l);
  for (const x of ["Hidden draft A", "Hidden draft B"]) assert.ok(!h.includes(x), `${x} is not shown`);
  if (!C.twoStudies) assert.ok(!h.includes(esc(S.manyH)) && !h.includes(esc(S.twoH)), "one public study: no card");
  // listing one: the card appears, with the active study "now" and the listed one "later"
  await adminDo(env, s, `study-save:${a}`, { s: "studies", ...fields({ name: "Draft A", [`title_${l}`]: "Hidden draft A", public_state: "later" }) });
  h = await home(env, l);
  assert.ok(h.includes("Hidden draft A") && h.includes(esc(S.twoLater)));
  assert.ok(!h.includes("Hidden draft B"), "the other draft is still hidden");
  assert.match(h, new RegExp(`<h2>${esc(S.manyH)}</h2>`));
  // done, then hidden again
  await adminDo(env, s, `study-save:${a}`, { s: "studies", ...fields({ name: "Draft A", [`title_${l}`]: "Hidden draft A", public_state: "done" }) });
  assert.ok((await home(env, l)).includes(esc(S.twoDone)));
  await adminDo(env, s, `study-save:${a}`, { s: "studies", ...fields({ name: "Draft A", [`title_${l}`]: "Hidden draft A", public_state: "hidden" }) });
  assert.ok(!(await home(env, l)).includes("Hidden draft A"));
  // a value that is not a state is ignored (the stored one stays)
  await adminDo(env, s, `study-save:${a}`, { s: "studies", ...fields({ name: "Draft A", public_state: "sideways" }) });
  assert.equal(stored(DB, a).publicState, "hidden");
  // an active hidden draft is shown (it is the study being booked), as "now"
  await adminDo(env, s, `study:${b}`, { s: "studies" });
  assert.ok((await home(env, l)).includes("Hidden draft B"));
});

test("the edit form has a control for the public state with a one-line explanation; the active study says it is always 'now'", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s);
  const h = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.match(h, /<select id="st-state" name="public_state"/);
  for (const k of ["hidden", "later", "done"]) assert.ok(h.includes(`<option value="${k}"`) && h.includes(esc(AT.studies.stateOpts[k])), k);
  assert.match(h, /<option value="hidden" selected>/, "a new draft is hidden");
  assert.ok(h.includes(esc(AT.studies.stateNote)) && h.includes(esc(AT.studies.fState)));
  assert.ok(!h.includes(esc(AT.studies.stateActive)), "a study that is not active has no such note");
  const active = await adminGet(env, s, "?s=studies&st=study1");
  assert.ok(active.includes(esc(AT.studies.stateActive)));
});

test("two seeded studies keep the card of the configuration, word for word, and keep reproducing it when the active study is switched, until a state is changed by hand", () => {
  const cfg = rawConfig();
  cfg.twoStudies = true;
  const script = `
import { setup, call, req, text, adminSession, adminDo, adminGet, LANGS } from "./test-generic/helpers.mjs";
import { formFields } from "./test-generic/forms.mjs";
import { T } from "./src/i18n.js";
import { parseStored } from "./src/studies.js";
const { DB, env } = await setup();
const s = await adminSession(env);
const l = LANGS[0];
const S = T[l];
const card = async () => {
  const h = await text(await call(env, req("/?lang=" + l)));
  const i = h.indexOf("<h2>" + S.twoH + "</h2>");
  return i < 0 ? null : h.slice(i, h.indexOf("</section>", i));
};
const out = {};
out.s1 = await card();
await adminDo(env, s, "study:study2", {});
out.s2 = await card();
await adminDo(env, s, "study:study1", {});
// save both studies without changing anything, then switch the active study again
for (const id of ["study1", "study2"]) await adminDo(env, s, "study-save:" + id, formFields(await adminGet(env, s, "?s=studies&st=" + id), "study-save:" + id));
out.states = ["study1", "study2"].map((id) => parseStored(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data).publicState ?? null);
out.afterSave1 = await card();
await adminDo(env, s, "study:study2", {});
out.afterSave2 = await card();
await adminDo(env, s, "study:study1", {});
// by hand: the other study is "done" instead of "later"
const f = formFields(await adminGet(env, s, "?s=studies&st=study2"), "study-save:study2");
out.shown = f.public_state;
await adminDo(env, s, "study-save:study2", { ...f, public_state: "done" });
out.hand = await card();
out.handState = parseStored(DB.raw.prepare("SELECT data FROM studies WHERE id = 'study2'").get().data).publicState;
// hidden by hand: no card with study1 active
await adminDo(env, s, "study-save:study2", { ...f, public_state: "hidden" });
out.hidden = await card();
await adminDo(env, s, "study:study2", {});
out.hiddenSwitched = await card();
console.log(JSON.stringify({ ...out, twoH: S.twoH, twoS1: S.twoS1, twoS2: S.twoS2, twoNow: S.twoNow, twoLater: S.twoLater, twoDone: S.twoDone, twoIntro: S.twoIntro, twoNotice: S.twoNotice }));
`;
  const r = withConfig(cfg, script);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  const e = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const original = (a, b) => `<h2>${e(o.twoH)}</h2><p>${e(o.twoIntro)}</p><ul><li>${e(`${o.twoS1} ${a}`)}</li><li>${e(`${o.twoS2} ${b}`)}</li></ul><p>${e(o.twoNotice)}</p>`;
  assert.equal(o.s1, original(o.twoNow, o.twoLater), "study1 active: study 2 later");
  assert.equal(o.s2, original(o.twoDone, o.twoNow), "study2 active: study 1 done");
  assert.deepEqual(o.states, [null, null], "saving the two studies as they are stores no public state");
  assert.equal(o.afterSave1, o.s1);
  assert.equal(o.afterSave2, o.s2, "and the switch still reproduces the seeded card");
  assert.equal(o.shown, "later", "the form shows the state the page gives it");
  assert.equal(o.hand, original(o.twoNow, o.twoDone), "set by hand: study 2 is done");
  assert.equal(o.handState, "done");
  assert.equal(o.hidden, null, "hidden by hand: only one public study, no card");
  assert.equal(o.hiddenSwitched, original(o.twoDone, o.twoNow).replace(/<li>[^]*?<\/li><li>/, (m) => m), "study2 active: study 1 follows its automatic state");
});

// ---- the study name must be unique ---------------------------------------------------------------------------------------------------
test("a study name already used by another study that is not archived is refused (any case), on save and on restore; drafts are numbered", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const names = [];
  for (let i = 0; i < 3; i++) { const id = await draft(env, s); names.push(stored(DB, id).name); }
  assert.deepEqual(names, [1, 2, 3].map((k) => AT.studies.newName(k)), "untitled study 1, 2, 3");
  const ids = DB.raw.prepare("SELECT id FROM studies ORDER BY position").all().map((r) => r.id).slice(-3);
  // renaming one to the name of another
  let r = await adminDo(env, s, `study-save:${ids[0]}`, { s: "studies", ...fields({ name: names[1].toUpperCase() }) });
  assert.equal(r.status, 200);
  assert.ok((await text(r)).includes(esc(AT.refuse.nameDup)));
  assert.equal(stored(DB, ids[0]).name, names[0], "nothing changed");
  // the same name as itself is fine
  assert.equal(code(await adminDo(env, s, `study-save:${ids[0]}`, { s: "studies", ...fields({ name: names[0] }) })), "study-saved");
  // an archived study may keep a name that another one then takes; restoring it is refused while that name is in use
  await adminDo(env, s, `study-archive:${ids[2]}`, { s: "studies" });
  assert.equal(code(await adminDo(env, s, `study-save:${ids[1]}`, { s: "studies", ...fields({ name: names[2] }) })), "study-saved", "the archived study does not hold its name");
  assert.equal(code(await adminDo(env, s, `study-restore:${ids[2]}`, { s: "studies" })), "study-name-dup");
  assert.equal(stored(DB, ids[2]).archived, true);
  // new drafts take the first number that is free
  const next = await draft(env, s);
  assert.equal(stored(DB, next).name, AT.studies.newName(2), "1 and 3 are in use: the first free number");
  await adminDo(env, s, `study-save:${next}`, { s: "studies", ...fields({ name: AT.studies.newName(1) }) });
  assert.equal(stored(DB, next).name, AT.studies.newName(2), "the name 1 is taken by the first draft");
});

// ---- D: updates that cannot overwrite each other -------------------------------------------------------------------------------------------
// The DB seen by the application changes the row of the study right before the application writes it, as a second request would.
function racing(env, mutate) {
  const real = env.DB;
  let armed = true;
  const db = { raw: real.raw, batch: (x) => real.batch(x), prepare(sql) { if (armed && /^UPDATE studies SET data/.test(sql)) { armed = false; mutate(real); } return real.prepare(sql); } };
  return { ...env, DB: db };
}
const bump = (id, target = 77) => (db) => db.raw.prepare("UPDATE studies SET data = json_set(data, '$.target', ?) WHERE id = ?").run(target, id);

test("saving a study is a compare-and-swap on the stored JSON: if it changed in the meantime nothing is written and the typed text is kept in the form", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s, { name: "CAS study" });
  const typed = "Text typed by the researcher while another request changed the study";
  const r = await adminDo(racing(env, bump(id)), s, `study-save:${id}`, { s: "studies", ...fields({ name: "CAS study renamed", [`does_${L0}`]: typed }) });
  assert.equal(r.status, 200, "the same form again");
  const h = await text(r);
  assert.ok(h.includes(esc(AT.refuse.changed)), "a clear message: it was changed in the meantime, your text is still in the form");
  assert.match(h, /<p class="error" role="alert">/);
  assert.ok(h.includes(esc(typed)) && h.includes("CAS study renamed"), "what was typed is in the form");
  assert.equal(stored(DB, id).target, 77, "the other change was not overwritten");
  assert.equal(stored(DB, id).name, "CAS study", "and the refused one was not written");
  // nothing in the way: it saves
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "CAS study renamed", target: "77" }) })), "study-saved");
  // a study that vanished is "that study does not exist"
  const id2 = await draft(env, s, { name: "Vanishing" });
  const gone = await adminDo(racing(env, (db) => db.raw.prepare("DELETE FROM studies WHERE id = ?").run(id2)), s, `study-save:${id2}`, { s: "studies", ...fields({ name: "Vanishing 2" }) });
  assert.equal(code(gone), "study-gone");
});

test("archiving, restoring and saving the consent form are compare-and-swap too", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s, { name: "CAS two" });
  const arch = await adminDo(racing(env, bump(id, 5)), s, `study-archive:${id}`, { s: "studies" });
  assert.equal(code(arch), "study-changed", "a redirect with a clear message");
  assert.equal(stored(DB, id).archived, false);
  assert.equal(stored(DB, id).target, 5);
  assert.equal(code(await adminDo(env, s, `study-archive:${id}`, { s: "studies" })), "study-archived");
  const rest = await adminDo(racing(env, bump(id, 6)), s, `study-restore:${id}`, { s: "studies" });
  assert.equal(code(rest), "study-changed");
  assert.equal(stored(DB, id).archived, true);
  assert.ok((await adminGet(env, s, `?s=studies&st=${id}&m=study-changed`)).includes(esc(AT.flash["study-changed"])));
  await adminDo(env, s, `study-restore:${id}`, { s: "studies" });
  // the consent form: the typed heading is kept in the form
  const cf = await consentForm(env, s, id, { [`c_heading_${L0}`]: "Heading typed during the race" });
  const c = await adminDo(racing(env, bump(id, 8)), s, `consent-save:${id}`, cf);
  assert.equal(c.status, 200);
  const h = await text(c);
  assert.ok(h.includes(esc(AT.refuse.consentChanged)) && h.includes("Heading typed during the race"));
  assert.equal(stored(DB, id).consent, undefined, "nothing was written");
  assert.equal(stored(DB, id).target, 8);
  assert.equal(code(await adminDo(env, s, `consent-save:${id}`, cf)), "consent-saved");
});

test("updateStudy writes only if the row still holds the JSON the new data was built from, and a save that changes nothing writes nothing", async () => {
  const { DB } = await setup();
  const id = "scas0000001";
  const base = parseStored(JSON.stringify({ name: "Direct", target: 3 }));
  await D.insertStudy(DB, id, base, "2026-11-01T00:00:00.000Z");
  const raw0 = (await D.getRegistry(DB)).studies.find((x) => x.id === id).raw;
  assert.equal(raw0, DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data, "the view carries the stored JSON");
  assert.equal(await D.updateStudy(DB, id, { ...base, target: 4 }, "2026-11-02T00:00:00.000Z", "{\"stale\":true}"), false, "a stale copy writes nothing");
  assert.equal(stored(DB, id).target, 3);
  assert.equal(await D.updateStudy(DB, id, { ...base, target: 4 }, "2026-11-02T00:00:00.000Z", raw0), true);
  assert.equal(rawRow(DB, id).updated_at, "2026-11-02T00:00:00.000Z");
  assert.equal(await D.updateStudy(DB, id, { ...base, target: 5 }, "2026-11-03T00:00:00.000Z", raw0), false, "the same stale copy a second time");
  const raw1 = (await D.getRegistry(DB)).studies.find((x) => x.id === id).raw;
  assert.equal(await D.updateStudy(DB, id, { ...base, target: 4 }, "2026-11-04T00:00:00.000Z", raw1), true, "nothing to change: accepted");
  assert.equal(rawRow(DB, id).updated_at, "2026-11-02T00:00:00.000Z", "and the change date did not move");
  assert.equal(await D.updateStudy(DB, "snothere001", base, "x", raw1), false, "no such row");
  // the code uses the compare in every write of a study
  const src = readFileSync(new URL("../src/db.js", import.meta.url), "utf8");
  assert.match(src, /UPDATE studies SET data = \?1, updated_at = \?2 WHERE id = \?3 AND data = \?4/);
});

// ---- E: a refused save does not lose what was typed ------------------------------------------------------------------------------------------
test("a refused study save answers 200 with the form filled with everything typed (texts, switches, state, target), an alert at the top and the error next to the field", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s, { name: "Refuse me" });
  const before = rawRow(DB, id);
  const f = fields({ name: "Typed name", target: "12x", epilepsy: "1", public_state: "done", [`lead_${L0}`]: "Typed lead <b>text</b>\nsecond line", [`reqs_${L0}`]: "One\nTwo", pl: L0 });
  const r = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...f });
  assert.equal(r.status, 200);
  const h = await text(r);
  assert.ok(h.includes(esc(AT.refuse.target)), "the message of the field");
  assert.match(h, /name="target"[^>]*aria-invalid="true"/);
  assert.match(h, /<p class="error" role="alert">/);
  assert.ok(h.includes('value="Typed name"'), "the name as typed");
  assert.ok(h.includes('value="12x"'), "the wrong target as typed");
  assert.match(h, /name="epilepsy" value="1" checked/, "the switch as typed");
  assert.match(h, /<option value="done" selected>/, "the state as typed");
  assert.ok(h.includes(`Typed lead &lt;b&gt;text&lt;/b&gt;\nsecond line</textarea>`), "the lead as typed, escaped");
  assert.ok(h.includes(">One\nTwo</textarea>"));
  assert.deepEqual({ ...rawRow(DB, id) }, { ...before }, "nothing saved");
  // "save and make active" that is refused does not activate
  const a = await adminDo(env, s, `study-save-activate:${id}`, { s: "studies", ...f });
  assert.equal(a.status, 200);
  assert.equal(await D.getActiveStudy(DB), "study1");
  // the refusal of a field is shown even when the panel was open on "everything": the same page
  const all = await adminDo(env, s, `study-save:${id}`, { s: "all", ...f });
  assert.equal(all.status, 200);
  const allHtml = await text(all);
  assert.ok(allHtml.includes('id="now-title"') && allHtml.includes('id="sec-studies"') && allHtml.includes('value="Typed name"'), "the page of the section it came from, with the typed values");
});

// ---- F: the study title where it belongs -----------------------------------------------------------------------------------------------------
test("the title of the active study names the landing page in the tab and in the link previews, the booked, confirmation and cancellation pages and the notice to the researcher; the calendar keeps the configured name", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  const l = TESTED[0];
  const other = LANGS.find((x) => x !== l);
  const own = `Own <title> "${l}"`;
  const id = await draft(env, s, { [`title_${l}`]: own });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  const h = await home(env, l);
  const S = T[l];
  assert.ok(h.includes(`<title>${esc(own)} · ${esc(S.brand)}</title>`), "the title of the tab");
  assert.ok(h.includes(`<meta property="og:title" content="${esc(own)}">`) && h.includes(`<meta name="twitter:title" content="${esc(own)}">`));
  assert.ok(h.includes(`<h1 id="hero-title">${esc(own)}</h1>`));
  if (other) {
    const ho = await home(env, other);
    assert.ok(ho.includes(`<title>${esc(`${T[other].title} · ${T[other].brand}`)}</title>`), "a language without its own title keeps the generic one");
    assert.ok(ho.includes(`<meta property="og:title" content="${esc(T[other].title)}">`));
  }
  // a booking: the e-mail relay is on and bookings are confirmed at once, to see the booked page and the notice
  const m = relay();
  await adminDo(env, s, "confirm-mode:instant", {}, NOW, m.fn);
  const res = await book(env, { email: "titled@example.org" }, { fetchFn: m.fn, lang: l });
  assert.equal(res.status, 200);
  const booked = await text(res);
  assert.ok(booked.includes(`<dt>${esc(S.cardStudy)}</dt><dd>${esc(own)}</dd>`), "the booked page names the study");
  const b = rows(DB)[0];
  for (const kind of ["c", "x"]) {
    const page = await text(await call(env, req(`/${kind}/${b.token}?lang=${l}`)));
    assert.ok(page.includes(`<dt>${esc(S.cardStudy)}</dt><dd>${esc(own)}</dd>`), `/${kind}/ names the study`);
  }
  const notice = m.calls.find((c) => c.json.to === C.contactEmail).json;
  assert.ok(notice.text.includes(` · ${own}`), "the notice to the researcher names the study by its title");
  assert.ok(notice.html.includes(esc(own)) && !notice.html.includes("<title>"), "escaped in the HTML part");
  // the calendar event keeps the studyName of the configuration
  const ics = await text(await call(env, req(`/ics/${b.token}`)));
  assert.ok(!ics.includes("Own"), "the calendar file does not carry the study title");
  assert.match(ics, new RegExp(`SUMMARY:${(C.studyName[b.lang] || C.studyName[l]).charAt(0).toUpperCase()}`));
  // the studies with no title of their own show none of this
  await adminDo(env, s, "study:study1", { s: "studies" });
  const plain = await home(env, l);
  assert.ok(plain.includes(`<title>${esc(`${S.title} · ${S.brand}`)}</title>`));
  assert.ok(!plain.includes(`<dt>${esc(S.cardStudy)}</dt>`));
});

test("a study of the configuration without a title of its own keeps the pages and the notice it always had after it was saved (no study line, 'Study 1' in the notice, '1' in the CSV)", async () => {
  const { env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  const m = relay();
  await adminDo(env, s, "confirm-mode:instant", {}, NOW, m.fn);
  await adminDo(env, s, "study-save:study1", await editorForm(env, s, "study1"));
  const res = await book(env, { email: "plain@example.org" }, { fetchFn: m.fn, lang: L0 });
  assert.ok(!(await text(res)).includes(`<dt>${esc(T[L0].cardStudy)}</dt>`));
  const notice = m.calls.find((c) => c.json.to === C.contactEmail).json;
  if (C.twoStudies) assert.ok(notice.text.includes(` · ${AT.mail.study(false)}`) && !notice.text.includes("interacci"), notice.text);
  else assert.ok(!/ · /.test(notice.text.split("\n")[1]), notice.text);
  const csv = await text(await call(env, req("/admin/csv", { cookie: s.cookie })));
  assert.match(csv, /"plain@example\.org","1",/);
});

// ---- H: the flow and the wording of the panel -----------------------------------------------------------------------------------------------
test("after a save the panel lands on the form (anchor) and keeps the preview language; the preview links stay on the preview", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const l = LANGS[LANGS.length - 1];
  const id = await draft(env, s);
  for (const verb of ["study-save"]) {
    const r = await adminDo(env, s, `${verb}:${id}`, { s: "studies", ...fields({ name: "Anchored" }), pl: l });
    const u = loc(r);
    assert.equal(u.hash, "#studies-edit", "lands on the form");
    assert.equal(u.searchParams.get("pl"), l, "keeps the preview language");
    assert.equal(u.searchParams.get("st"), id);
  }
  const created = await adminDo(env, s, "study-new", { s: "studies", pl: l });
  assert.equal(loc(created).hash, "#studies-edit");
  assert.equal(loc(created).searchParams.get("pl"), l);
  const h = await adminGet(env, s, `?s=studies&st=${id}&pl=${l}`);
  assert.match(h, new RegExp(`<input type="hidden" name="pl" value="${l}">`), "the forms carry the preview language");
  for (const x of LANGS) assert.match(h, new RegExp(`href="/admin\\?s=studies&amp;st=${id}&amp;pl=${x}#studies-preview"`));
  assert.match(h, /<section class="surface" id="studies-preview"/);
  assert.ok(h.includes(esc(AT.studies.previewOrder)), "a note on where the texts go on the public page: after the booking form");
  // after archive and restore the page is the study, with its language
  const arch = await adminDo(env, s, `study-archive:${id}`, { s: "studies", pl: l });
  assert.equal(loc(arch).searchParams.get("pl"), l);
});

test("'Save and make active' is offered on a study that is not active: it saves, makes it the active study and says so", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await draft(env, s);
  const h = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.match(h, new RegExp(`name="do" value="study-save-activate:${id}"[^>]*>${esc(AT.studies.saveActivate)}`));
  const r = await adminDo(env, s, `study-save-activate:${id}`, { s: "studies", ...fields({ name: "Go live", [`title_${L0}`]: "Live title" }) });
  assert.equal(code(r), "study-saved-active");
  assert.equal(await D.getActiveStudy(DB), id);
  assert.equal(stored(DB, id).name, "Go live");
  assert.ok((await home(env)).includes("Live title"));
  const active = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.ok(!active.includes("study-save-activate"), "not offered on the active study");
  const archived = await draft(env, s);
  await adminDo(env, s, `study-archive:${archived}`, { s: "studies" });
  assert.ok(!(await adminGet(env, s, `?s=studies&st=${archived}`)).includes("study-save-activate"), "nor on an archived one");
});

test("week actions: the button says the dates, 'this week' is the coming one on a Saturday or a Sunday, the select is labelled with its unit", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  for (const [day, monday, next] of [[MONDAY, "2026-11-16", false], [DAY, "2026-11-16", false], ["2026-11-20", "2026-11-16", false], ["2026-11-21", "2026-11-23", true], ["2026-11-22", "2026-11-23", true]]) {
    assert.equal(weekToOpen(day), monday, day);
    const h = await adminGet(env, s, `?s=agenda&day=${day}`);
    const label = AT.day.openWeek(prettyDay(monday, C.adminLanguage), prettyDay(addDays(monday, 4), C.adminLanguage), next);
    assert.ok(h.includes(`>${esc(label)}</button>`), `${day}: ${label}`);
    assert.equal(h.includes(esc(AT.day.openWeekendNote)), next, `${day}: the weekend note`);
    assert.ok(h.includes(`<label for="weeks">${esc(AT.day.weeksLabel)}</label><select id="weeks" name="weeks">`), `${day}: the select is labelled`);
  }
  // the legacy words are still in the label
  assert.match(ADMIN_TEXT_SETS.es.day.openWeek("a", "b", false), /^Abrir lunes a viernes de esta semana con el horario por defecto/);
  // on a Saturday the action opens the days of the coming week, and not the week that ended
  const r = await adminDo(env, s, "week:2026-11-21", { day: "2026-11-21" });
  assert.equal(code(r), "week");
  const open = await D.openDays(DB, "2026-11-14", "2026-11-30");
  assert.deepEqual(open.filter((d) => d >= "2026-11-16" && d !== DAY), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.ok(!open.includes("2026-11-20") && !open.includes("2026-11-16") || open.includes(DAY), "the week that ended was not opened");
  const r2 = await adminDo(env, s, "weeks:2026-11-22", { day: "2026-11-22", weeks: "2" });
  assert.equal(code(r2), "weeks");
  const open2 = await D.openDays(DB, "2026-11-28", "2026-12-12");
  assert.deepEqual(open2, ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"], "the second week of the two");
  assert.equal(weekMonday("2026-11-22"), "2026-11-16", "a Sunday belongs to the week that ends on it");
  assert.ok(DAYS_AHEAD >= 14);
});

test("a closed day with 'available today' on says so in the day panel instead of the generic closed note", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const closed = await adminGet(env, s, `?s=agenda&day=${MONDAY}`);
  assert.ok(closed.includes(esc(AT.day.closedNote)), "without it, the generic note");
  assert.equal(code(await adminDo(env, s, "flex-on", { flex_from: "10:30", flex_until: "15:00" })), "flex-on");
  const h = await adminGet(env, s, `?s=agenda&day=${MONDAY}`);
  assert.ok(h.includes(esc(AT.day.flexClosed("10:30", "15:00"))));
  assert.ok(!h.includes(esc(AT.day.closedNote)), "the generic note would mislead");
  // another closed day keeps the generic note
  assert.ok((await adminGet(env, s, "?s=agenda&day=2026-11-24")).includes(esc(AT.day.closedNote)));
});

test("settings: the CSV button says it holds names and e-mail addresses; the progress line says 'participants'; the consent editor has no duplicated note and clearer labels", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const set = await adminGet(env, s, "?s=settings");
  assert.match(set, new RegExp(`href="/admin/csv">${esc(AT.set.exportCsv)}</a>`));
  for (const [lang, set2] of Object.entries(ADMIN_TEXT_SETS)) {
    assert.match(set2.set.exportCsv, lang === "es" ? /nombres y correos/ : /nomi e le e-mail/, lang);
  }
  assert.equal(ADMIN_TEXT_SETS.it.progress.remaining(12), "Mancano 12 partecipanti all'obiettivo");
  assert.equal(ADMIN_TEXT_SETS.it.progress.remaining(1), "Manca 1 partecipante all'obiettivo");
  assert.equal(ADMIN_TEXT_SETS.es.progress.remaining(12), "Faltan 12 participantes para llegar al objetivo");
  assert.equal(ADMIN_TEXT_SETS.es.progress.remaining(1), "Falta 1 participante para llegar al objetivo");
  assert.equal(ADMIN_TEXT_SETS.it.consent.fields.welcome, "Frase di benvenuto");
  assert.equal(ADMIN_TEXT_SETS.it.consent.fields.supervisors, "Responsabili dello studio");
  assert.equal(ADMIN_TEXT_SETS.es.consent.fields.welcome, "Frase de bienvenida");
  assert.equal(ADMIN_TEXT_SETS.es.consent.fields.supervisors, "Responsables del estudio");
  const ed = await adminGet(env, s, "?s=studies&st=study1&c=consent");
  assert.ok(ed.includes(esc(AT.consent.intro)));
  assert.ok(!ed.includes(esc(AT.studies.plainNote)), "the plain-text note is said once, in the introduction");
  assert.equal(ed.split(esc(AT.consent.intro.split(".")[1].trim())).length, 2);
  // the draft names and the "turno" of the Italian panel
  assert.equal(ADMIN_TEXT_SETS.it.studies.newName(2), "Studio senza titolo 2");
  assert.equal(ADMIN_TEXT_SETS.es.studies.newName(2), "Estudio sin título 2");
  assert.match(ADMIN_TEXT_SETS.it.day.openWeek("a", "b", false), /turn|settimana/);
});

// ---- I: small robustness ---------------------------------------------------------------------------------------------------------------------------
test("a POST to the panel whose body is not a form answers 400, never 500, with or without a session", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const post = (path, body, type, cookie) => call(env, new Request(`https://study.example.org${path}`, { method: "POST", headers: { "cf-connecting-ip": "5.5.5.5", ...(type ? { "content-type": type } : {}), ...(cookie ? { cookie } : {}) }, body }));
  for (const [body, type] of [["{\"do\":\"times\"}", "application/json"], ["plain text", "text/plain"], ["", null], ["--x\r\nbroken", "multipart/form-data; boundary=zzz"], ["a=1", "application/octet-stream"]]) {
    for (const path of ["/admin/do", "/admin/logout", "/admin/login", "/admin/nothing"]) {
      const withSession = await post(path, body, type, s.cookie);
      assert.ok(withSession.status < 500, `${path} ${type}: ${withSession.status}`);
      if (path !== "/admin/nothing") assert.equal(withSession.status, 400, `${path} ${type}`);
      const anon = await post(path, body, type);
      assert.ok(anon.status < 500, `${path} ${type} anonymous: ${anon.status}`);
    }
  }
  assert.ok((await text(await post("/admin/do", "x", "text/plain", s.cookie))).includes(esc(AT.badRequestTitle)));
});

test("the files with names and e-mail addresses say so in their name (the short Spanish names stay under legacyPaths)", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  for (const [path, name] of [["/admin/csv", AT.csv.bookingsFile], ["/admin/csv-contactos", AT.csv.contactsFile], ["/admin/csv-resumen", AT.csv.summaryFile]]) {
    const r = await call(env, req(path, { cookie: s.cookie }));
    assert.equal(r.headers.get("content-disposition"), `attachment; filename="${name}-${MONDAY}.csv"`);
  }
  for (const [lang, set] of Object.entries(ADMIN_TEXT_SETS)) {
    const legacy = lang === "es" && C.legacyPaths;
    assert.match(set.csv.bookingsFile, legacy ? /^reservas$/ : lang === "es" ? /^reservas-con-datos-personales$/ : /^prenotazioni-con-dati-personali$/, lang);
    assert.match(set.csv.contactsFile, legacy ? /^contactos$/ : lang === "es" ? /^contactos-con-datos-personales$/ : /^contatti-con-dati-personali$/, lang);
    assert.ok(!/personal|personali/.test(set.csv.summaryFile), "the summary has no names: its name says nothing about them");
  }
});

test("the public name field has its own message for angle brackets, '@' and control characters, and keeps the old one for an empty or too long name", async () => {
  const { DB, env } = await setup();
  for (const l of TESTED) {
    const S = T[l];
    assert.ok(S.err.nameChars && S.err.nameChars !== S.err.name, `${l}: a message of its own`);
    assert.match(S.err.nameChars, /< >|<|>/, `${l}: it names what is not allowed`);
    for (const bad of ["<b>x</b>", "a@b", "tab\there", "line\nbreak", "x‮y"]) {
      const r = await book(env, { name: bad }, { lang: l });
      assert.equal(r.status, 400, bad);
      const h = await text(r);
      assert.ok(h.includes(esc(S.err.nameChars)), `${l} ${JSON.stringify(bad)}: the new message`);
      assert.ok(!h.includes(esc(S.err.name)), "not the generic one");
    }
    for (const bad of ["", "x".repeat(41)]) {
      const r = await book(env, { name: bad }, { lang: l });
      assert.equal(r.status, 400);
      assert.ok((await text(r)).includes(esc(S.err.name)), `${l}: ${bad.length} characters`);
    }
    assert.equal((await book(env, { name: "Ana-María O'Neil, Jr." }, { lang: l })).status, 200, "common punctuation is fine");
    DB.raw.exec("DELETE FROM bookings");
  }
});

test("scripts/preview.mjs accepts --now with an instant and runs on that fixed clock; a bad value is refused", async () => {
  const { spawn, spawnSync } = await import("node:child_process");
  const root = new URL("..", import.meta.url).pathname;
  const bad = spawnSync(process.execPath, ["scripts/preview.mjs", "--now", "tomorrow"], { cwd: root, encoding: "utf8", timeout: 20_000 });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--now needs an ISO date-time/);
  assert.equal(spawnSync(process.execPath, ["scripts/preview.mjs", "--now"], { cwd: root, encoding: "utf8", timeout: 20_000 }).status, 2);
  assert.equal(spawnSync(process.execPath, ["scripts/preview.mjs", "--nope"], { cwd: root, encoding: "utf8", timeout: 20_000 }).status, 2);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["scripts/preview.mjs", String(port), "--now", "2026-11-16T10:00:00+01:00"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes("Fixed clock"); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /Fixed clock: 2026-11-16T09:00:00\.000Z/);
    const pw = /Admin password:\s+(\S+)/.exec(out)[1];
    const base = `http://127.0.0.1:${port}`;
    const login = await (await loopbackFetch(`${base}/admin`)).text();
    const t = /name="t" value="([^"]+)"/.exec(login)[1];
    const r = await loopbackFetch(`${base}/admin/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: pw, t }) });
    const cookie = r.headers.get("set-cookie").split(";")[0];
    const panel = await (await loopbackFetch(`${base}/admin`, { headers: { cookie } })).text();
    // "today" in the panel is the fixed day, whatever day the computer says it is
    const { prettyDay: pd } = await import("../src/slots.js");
    const { C: cfg } = await import("../src/config.js");
    assert.ok(panel.includes(esc(pd("2026-11-16", cfg.adminLanguage))), "the panel's today is the fixed day");
    assert.match(panel, /class="c-today|cell c-[a-z]+ c-today|c-today/);
  } finally {
    child.kill();
  }
});

test("the documentation says what changed: stored differences, the public list, weeks, the compare-and-swap, the sheet, --now", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const studi = read("docs/studi.md");
  for (const w of ["publicState", "Nascosto", "Più avanti", "Già concluso", "settimana", "nel frattempo", "Salva e attiva", "Studio senza titolo", "non salva nessuna copia", "conteggi per settimana", "collegare un conteggio a una persona", "non segnati"]) assert.ok(studi.includes(w), `docs/studi.md says "${w}"`);
  const consenso = read("docs/consenso.md");
  for (const w of ["prima le righe del ricercatore", "versione del", "parentesi quadre che restano", "nome in stampatello", "copie degli avvisi", "promette"]) assert.ok(consenso.includes(w), `docs/consenso.md says "${w}"`);
  assert.ok(read("AGENTS.md").includes("--now") && read("README.md").includes("--now") && read("README.it.md").includes("--now"), "--now is documented");
  assert.ok(/prenotazioni-con-dati-personali/.test(read("README.md") + read("docs/privacy.md") + studi), "the new file names are documented");
});
