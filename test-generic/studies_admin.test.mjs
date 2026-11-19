// Studies managed from the panel, part 2: the sections of the panel, the studies section, what the public page shows, the
// declarations, archiving, progress, the calendar weekend, escaping of every editable field, and the session and CSRF rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { T } from "../src/i18n.js";
import { esc } from "../src/util.js";
import { AT } from "../src/admin_texts.js";
import { parseStored, LIMITS, oneLine, resolveTexts } from "../src/studies.js";
import { C, DAY, NOW, A, LANGS, TESTED, at, setup, call, req, text, book, bookFields, freshIp, relay, RELAY, rows, adminSession, adminDo, adminGet, code } from "./helpers.mjs";

const L0 = LANGS[0];
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const blank = () => Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]]));
const fields = (o = {}) => ({ name: "Study", target: "", ...blank(), ...o });
const stored = (DB, id) => parseStored(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data);
const studyRows = (DB) => DB.raw.prepare("SELECT id FROM studies ORDER BY position").all().map((r) => r.id);
const home = async (env, lang = L0) => text(await call(env, req(`/?lang=${lang}`)));
const has = (html, t) => html.includes(esc(t));
// A booking written straight into the table (the flows that matter are exercised through the pages elsewhere).
let k = 0;
function ins(DB, o = {}) {
  k++;
  const b = { id: `sa${k}`, date: DAY, time: A, name: "Test Person", email: `sa${k}@example.org`, status: "confirmed", lang: L0, study: "study1", ...o };
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?)")
    .run(b.id, b.id.padEnd(30, "x"), b.study, b.date, b.time, b.name, b.email, b.email, b.status, NOW.toISOString(), b.lang);
  return b;
}
// Creates a study from the panel and saves the given fields; returns its id.
async function create(env, s, o = {}) {
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  assert.equal(code(r), "study-new");
  const id = loc(r).searchParams.get("st");
  assert.match(id, /^s[0-9a-z]{10}$/);
  const r2 = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields(o) });
  assert.equal(code(r2), "study-saved", `saving ${id}: ${loc(r2).search}`);
  return id;
}

// ---- the sections ------------------------------------------------------------------------------------------------------------------
const MARK = { agenda: 'id="now-title"', studies: 'id="sec-studies"', contacts: 'id="sec-contacts"', data: 'id="sec-data"', settings: 'class="o-set"' };

test("the panel has five sections chosen with ?s=, a navigation of plain links, and 's=all' shows every section one after another", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const pages = {};
  for (const sec of Object.keys(MARK)) {
    pages[sec] = await adminGet(env, s, `?s=${sec}`);
    assert.ok(pages[sec].includes(MARK[sec]), `${sec} shows its own content`);
    for (const [other, m] of Object.entries(MARK)) if (other !== sec) assert.ok(!pages[sec].includes(m), `${sec} does not show ${other}`);
    const nav = /<nav class="main-nav"[^>]*>[\s\S]*?<\/nav>/.exec(pages[sec])[0];
    assert.equal((nav.match(/<a href="\/admin(\?s=[a-z]+)?"/g) || []).length, 6, "five sections and 'everything on one page', all plain links");
    assert.ok(!/<button|<script|onclick/.test(nav));
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
    assert.match(nav, new RegExp(`<a href="${sec === "agenda" ? "/admin" : `/admin\\?s=${sec}`}" aria-current="page">`));
  }
  const all = await adminGet(env, s, "?s=all");
  for (const m of Object.values(MARK)) assert.ok(all.includes(m), m);
  assert.match(all, /<a href="\/admin\?s=all" aria-current="page">/);
  // the sections come one after another: agenda, studies, contacts, data, settings
  const at = Object.values(MARK).map((m) => all.indexOf(m));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // the default is the agenda, and an unknown value too
  const def = await text(await call(env, req("/admin", { cookie: s.cookie })));
  assert.ok(def.includes(MARK.agenda) && !def.includes(MARK.studies));
  for (const bad of ["?s=nope", "?s=", "?s=ALL", "?s[]=studies", "?s=../x"]) {
    const h = await text(await call(env, req(`/admin${bad}`, { cookie: s.cookie })));
    assert.ok(h.includes(MARK.agenda) && !h.includes(MARK.studies), bad);
  }
  // no inline code anywhere
  for (const h of [...Object.values(pages), all]) assert.ok(!/<style|\sstyle=|<script|\son[a-z]+=/.test(h));
});

test("the studies, contacts, data and settings sections carry their own name in every form; the agenda forms carry none", async () => {
  const { env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  for (const sec of ["agenda", "studies", "contacts", "data", "settings", "all"]) {
    const h = await adminGet(env, s, `?s=${sec}`);
    const forms = h.split("<form ").slice(1).map((f) => f.slice(0, f.indexOf("</form>")));
    assert.ok(forms.length >= 1, sec);
    for (const f of forms) {
      const named = f.includes(`<input type="hidden" name="s" value="${sec}">`);
      assert.equal(named, sec !== "agenda", `${sec}: ${f.slice(0, 90)}`);
    }
  }
});

test("an action goes back to the section its form came from, and the message is shown there", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const times = `${C.defaultTimes[0]}`;
  for (const sec of ["settings", "studies", "data", "contacts", "all"]) {
    const r = await adminDo(env, s, "times", { s: sec, times });
    assert.equal(r.status, 303);
    assert.equal(loc(r).searchParams.get("s"), sec);
    const h = await text(await call(env, req(loc(r).pathname + loc(r).search, { cookie: s.cookie })));
    assert.match(h, /<p class="flash" role="status">/, `the message is on the ${sec} page`);
    if (sec !== "all") assert.match(h, new RegExp(`<a href="/admin\\?s=${sec}" aria-current="page">`));
  }
  // from the agenda: no section in the address
  const r = await adminDo(env, s, "times", { times });
  assert.equal(loc(r).searchParams.get("s"), null);
  // a made-up section is the agenda
  assert.equal(loc(await adminDo(env, s, "times", { s: "x", times })).searchParams.get("s"), null);
  // the study switch and the other old actions keep their names (here: a day opens and closes)
  assert.equal(code(await adminDo(env, s, `close:${DAY}`, { s: "agenda" })), "closed");
  assert.equal(code(await adminDo(env, s, `open:${DAY}`)), "open");
  assert.ok(DB);
});

test("the invitation answers with the page of the section it was asked in", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const r = await adminDo(env, s, "invite", { s: "contacts", addresses: "someone@example.org", invlang: L0 });
  assert.equal(r.status, 200);
  const h = await text(r);
  assert.ok(h.includes(MARK.contacts) && !h.includes(MARK.agenda));
  assert.match(h, /id="invitar" open/);
});

// ---- calendar: the weekend --------------------------------------------------------------------------------------------------------
test("the month calendar marks Saturday and Sunday with classes of their own, and the cell label names the weekday", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const h = await adminGet(env, s, "?s=agenda&month=2026-11");
  const cell = (d) => new RegExp(`<a class="([^"]*)" href="/admin\\?month=2026-11&amp;day=${d}" aria-label="([^"]*)"`).exec(h);
  const sat = cell("2026-11-21"), sun = cell("2026-11-22"), mon = cell("2026-11-23"), fri = cell("2026-11-20");
  assert.match(sat[1], /\bc-sat\b/); assert.doesNotMatch(sat[1], /c-sun/);
  assert.match(sun[1], /\bc-sun\b/); assert.doesNotMatch(sun[1], /c-sat/);
  for (const c of [mon, fri]) assert.doesNotMatch(c[1], /c-sat|c-sun/);
  const days = AT.weekdays;
  assert.ok(sat[2].toLowerCase().includes(days[5][1]), `Saturday label: ${sat[2]}`);
  assert.ok(sun[2].toLowerCase().includes(days[6][1]), `Sunday label: ${sun[2]}`);
  // every cell of the month: the weekday is in the accessible label
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    assert.ok(cell(date)[2].toLowerCase().includes(days[wd][1]), `${date}: ${cell(date)[2]}`);
    assert.equal(/c-sat/.test(cell(date)[1]), wd === 5, date);
    assert.equal(/c-sun/.test(cell(date)[1]), wd === 6, date);
  }
  // the header cells of the two columns
  assert.match(h, new RegExp(`<th scope="col" class="h-sat"><abbr title="${days[5][1]}">${days[5][0]}</abbr></th>`));
  assert.match(h, new RegExp(`<th scope="col" class="h-sun"><abbr title="${days[6][1]}">${days[6][0]}</abbr></th>`));
  assert.equal((h.match(/class="h-s(at|un)"/g) || []).length, 2);
  assert.ok(!/ style=/.test(h), "no inline style");
});

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;

test("the red of Sunday (number and column header) is defined in admin.css for both themes and is readable on every background it meets", () => {
  const css = readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  // The red of Sunday is the dashboard's --danger (one token for every red of the panel).
  const light = /:root\{[^}]*--danger:(#[0-9a-f]{6})/.exec(css)[1];
  const dark = /prefers-color-scheme:dark\)\{:root\{[^}]*--danger:(#[0-9a-f]{6})/.exec(css)[1];
  assert.match(css, /table\.cal th\.h-sun\{color:var\(--danger\)\}/);
  assert.match(css, /a\.cell\.c-sun \.dn\{color:var\(--danger\)\}/);
  assert.match(css, /a\.cell\.c-sat \.dn\{[^}]*underline/, "Saturday is not told by colour: its number is underlined");
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  const lightT = tokens(/:root\{([^}]*)\}/.exec(css)[1]);
  const darkT = { ...lightT, ...tokens(/prefers-color-scheme:dark\)\{:root\{([^}]*)\}/.exec(css)[1]) };
  // a past cell is no longer faded with opacity (that cost contrast): its numbers use the muted ink, and the Sunday red stays red
  assert.ok(!/c-past[^{]*\{opacity/.test(css));
  assert.match(css, /a\.cell\.c-past \.dn\{color:var\(--muted\)\}/);
  assert.match(css, /a\.cell\.c-past\.c-sun \.dn\{color:var\(--danger\)\}/);
  for (const [name, sun, t] of [["light", light, lightT], ["dark", dark, darkT]]) {
    // the number sits on the cells (closed/empty: bg, open: ok-bg, full: warn-bg); the header on the page surface
    // (cells: paper for closed, surface for open, subtle for a weekend, warning-bg for full; the header on the paper)
    for (const bg of [t.paper, t.surface, t.subtle, t["warning-bg"]]) assert.ok(ratio(sun, bg) >= 4.5, `${name}: ${sun} on ${bg} = ${ratio(sun, bg).toFixed(2)}`);
    // a past cell: the muted ink of the number reaches 4.5:1 on the cells a past day can have
    for (const bg of [t.paper, t.surface, t.subtle, t["warning-bg"]]) assert.ok(ratio(t.muted, bg) >= 4.5, `${name} past muted on ${bg}`);
  }
  assert.ok(ratio(light, "#ffffff") > ratio(dark, "#ffffff"), "the two themes use different reds");
});

// ---- the studies section -----------------------------------------------------------------------------------------------------------------
test("while nothing was saved the studies section lists the configured studies as editable, with a form per language and a preview", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const h = await adminGet(env, s, "?s=studies");
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, 0, "looking changes nothing");
  assert.equal((h.match(/<li class="study-row/g) || []).length, C.twoStudies ? 2 : 1);
  assert.ok(has(h, AT.studies.firstNote), "says that the first save copies the configuration");
  assert.ok(has(h, AT.studies.activeMark), "the active study is marked");
  // the edit form: name, target, the two switches, and for each configured language title, lead, does, requirements
  for (const name of ["name", "target", "epilepsy", "vestibular"]) assert.match(h, new RegExp(`name="${name}"`));
  for (const l of LANGS) for (const f of ["title", "lead", "does", "reqs"]) assert.match(h, new RegExp(`name="${f}_${l}"`));
  assert.match(h, /maxlength="60"/); assert.match(h, /maxlength="160"/); assert.match(h, /maxlength="1200"/); assert.match(h, /maxlength="2000"/);
  assert.match(h, /type="number" min="1" max="9999"/);
  // the buttons: save, new study (archive and restore appear where they apply)
  assert.match(h, /value="study-save:study1"/); assert.match(h, /value="study-new"/);
  // the preview: one language at a time, switched with plain links
  assert.match(h, /class="pv"/);
  for (const l of LANGS) assert.match(h, new RegExp(`href="/admin\\?s=studies&amp;st=study1&amp;pl=${l}#studies-preview"`), "the preview links stay on the preview");
  assert.ok(!/<script|\sstyle=/.test(h));
  // the seeded texts are in the form, as the public page shows them
  assert.ok(has(h, T[L0].study1.does), "the text of the page is the text of the form");
});

test("the preview shows the chosen language, its title, lead, does and requirements, plus the declarations that are on", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Preview", [`title_${L0}`]: "Preview title A", [`lead_${L0}`]: "Preview lead A", [`does_${L0}`]: "Preview does A", [`reqs_${L0}`]: "Req one\nReq two", epilepsy: "1" });
  const h = await adminGet(env, s, `?s=studies&st=${id}&pl=${L0}`);
  const pv = /<div class="pv"[\s\S]*?<\/div>/.exec(h)[0];
  for (const t of ["Preview title A", "Preview lead A", "Preview does A", "Req one", "Req two", T[L0].reqEpilepsy]) assert.ok(pv.includes(esc(t)), t);
  assert.ok(!pv.includes(esc(T[L0].reqVestibular)), "the declaration that is off is not listed");
  assert.match(pv, new RegExp(`lang="${T[L0].htmlLang}"`));
  if (LANGS.length > 1) {
    const other = LANGS[1];
    const h2 = await adminGet(env, s, `?s=studies&st=${id}&pl=${other}`);
    const pv2 = /<div class="pv"[\s\S]*?<\/div>/.exec(h2)[0];
    assert.ok(!pv2.includes("Preview title A"), "another language, another text");
    assert.ok(pv2.includes(esc(T[other].title)), "empty fields fall back to the built-in text of that language");
  }
  // a language that is not configured, or garbage, is the first one
  const bad = await adminGet(env, s, `?s=studies&st=${id}&pl=xx`);
  assert.ok(/<div class="pv"[\s\S]*?<\/div>/.exec(bad)[0].includes("Preview title A"));
  // an id that is not a study selects the active one
  const none = await adminGet(env, s, "?s=studies&st=nope");
  assert.match(none, /class="study-row is-sel"/);
});

test("a new study is a draft seeded from the generic texts, not active, with an id of 's' and 10 base-36 characters", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  const id = loc(r).searchParams.get("st");
  assert.match(id, /^s[0-9a-z]{10}$/);
  assert.equal(loc(r).searchParams.get("s"), "studies");
  const reg = await D.getRegistry(DB);
  assert.equal(reg.table, true, "creating a study is a save: the configuration was copied first");
  assert.deepEqual(studyRows(DB), [...(C.twoStudies ? ["study1", "study2"] : ["study1"]), id]);
  const d = stored(DB, id);
  assert.equal(d.name, AT.studies.newName(1), "an untitled study, numbered");
  assert.equal(d.target, null);
  assert.equal(d.archived, false);
  assert.equal(d.publicState, "hidden", "a new draft is not listed on the public page");
  for (const l of LANGS) {
    assert.deepEqual(d.texts[l], { title: "", lead: "", does: "", reqs: [] }, "a draft stores no text of its own");
    assert.equal(resolveTexts(l, { id, texts: d.texts }).does, T[l].study1.does, "it shows the generic texts of the first study");
  }
  assert.notEqual(reg.active, id, "a draft is not active");
  // two new studies do not collide
  const id2 = loc(await adminDo(env, s, "study-new", { s: "studies" })).searchParams.get("st");
  assert.notEqual(id, id2);
});

test("an edited study shows its texts on the public page in each language, and an empty field falls back to the built-in text", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const f = {};
  for (const l of TESTED) Object.assign(f, { [`title_${l}`]: `Own title ${l}`, [`lead_${l}`]: `Own lead ${l}`, [`does_${l}`]: `Own does ${l}`, [`reqs_${l}`]: `Own req one ${l}\nOwn req two ${l}` });
  assert.equal(code(await adminDo(env, s, "study-save:study1", { s: "studies", ...fields(f) })), "study-saved");
  for (const l of TESTED) {
    const h = await home(env, l);
    assert.ok(h.includes(`<h1 id="hero-title">Own title ${l}</h1>`), `${l} title`);
    for (const t of [`Own lead ${l}`, `Own does ${l}`, `Own req one ${l}`, `Own req two ${l}`]) assert.ok(h.includes(t), `${l}: ${t}`);
    assert.ok(!h.includes(esc(T[l].study1.does)), `${l}: the built-in text is replaced`);
  }
  // empty fields: the built-in text of each language comes back, field by field
  const l = TESTED[0];
  await adminDo(env, s, "study-save:study1", { s: "studies", ...fields({ [`title_${l}`]: "Only the title" }) });
  const h = await home(env, l);
  assert.ok(h.includes('<h1 id="hero-title">Only the title</h1>'));
  assert.ok(h.includes(esc(T[l].study1.lead || T[l].lead)), "lead falls back");
  assert.ok(h.includes(esc(T[l].study1.does)), "does falls back");
  for (const r of T[l].study1.reqs) assert.ok(h.includes(esc(r)), "requirements fall back");
  assert.ok(!h.includes("Own does"), "nothing of the previous text is left");
});

test("the declarations of the study decide the checkboxes of the form and the checks of the server", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const post = async (drop) => { const f = await bookFields(DB); for (const x of drop) delete f[x]; return call(env, req("/reservar", { method: "POST", fields: f, ip: freshIp() })); };
  const combos = [{ epilepsy: true, vestibular: true }, { epilepsy: true, vestibular: false }, { epilepsy: false, vestibular: true }, { epilepsy: false, vestibular: false }];
  for (const c of combos) {
    const o = { name: "Declarations" };
    if (c.epilepsy) o.epilepsy = "1";
    if (c.vestibular) o.vestibular = "1";
    await adminDo(env, s, "study-save:study1", { s: "studies", ...fields(o) });
    const h = await home(env);
    assert.equal(/name="noepi"/.test(h), c.epilepsy, `epilepsy checkbox ${JSON.stringify(c)}`);
    assert.equal(/name="vestibular"/.test(h), c.vestibular, `vestibular checkbox ${JSON.stringify(c)}`);
    assert.equal(h.includes(esc(T[L0].reqEpilepsy)), c.epilepsy, "requirement line of epilepsy");
    assert.equal(h.includes(esc(T[L0].reqVestibular)), c.vestibular, "requirement line of vestibular");
    // the server checks what the form asks, not only the browser
    DB.raw.exec("DELETE FROM bookings");
    const missing = await post(["noepi", "vestibular"]);
    const needed = c.epilepsy || c.vestibular;
    assert.equal(missing.status === 200, !needed, `a booking without the declarations ${JSON.stringify(c)}: ${missing.status}`);
    assert.equal(rows(DB).length, needed ? 0 : 1);
    if (needed) {
      assert.equal((await post(c.epilepsy ? ["noepi"] : ["vestibular"])).status, 400, "one missing declaration is refused");
      assert.equal(rows(DB).length, 0);
      assert.equal((await post([])).status, 200, "with the declarations the booking goes through");
      assert.equal(rows(DB).length, 1);
    }
  }
});

test("a third study is created, made active, booked, attended and counted; the second booking of the same person in it is refused, in another study it is not", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Third study", target: "5", [`title_${L0}`]: "The third study", [`does_${L0}`]: "Does of the third" });
  assert.equal(code(await adminDo(env, s, `study:${id}`, { s: "studies" })), "study");
  assert.equal(await D.getActiveStudy(DB), id);
  const h = await home(env);
  assert.ok(h.includes('<h1 id="hero-title">The third study</h1>') && h.includes("Does of the third"));
  const email = "third.person@example.org";
  assert.equal((await book(env, { email })).status, 200);
  const b = rows(DB)[0];
  assert.equal(b.study, id, "the booking holds the id of the study");
  assert.equal(b.status, "confirmed");
  // the participation is held: mark it attended (after the slot started)
  const later = at(DAY, b.time, 10);
  const s2 = await adminSession(env, later);
  assert.equal(code(await adminDo(env, s2, `attended:${b.id}`, { s: "agenda" }, later)), "marked");
  const counts = (await D.studyCounts(DB, DAY)).get(id);
  assert.deepEqual({ attended: counts.attended, upcoming: counts.upcoming, booked: counts.booked }, { attended: 1, upcoming: 0, booked: 0 });
  assert.equal(await D.hasAttended(DB, email, id), true);
  // the same person cannot take part twice in the same study
  const again = await book(env, { email }, { now: later });
  assert.equal(again.status, 409);
  // but can in another one
  await adminDo(env, s2, "study-save:study1", { s: "studies", ...fields({ name: "First" }) }, later);
  assert.equal(code(await adminDo(env, s2, "study:study1", { s: "studies" }, later)), "study");
  await D.openDay(DB, "2026-11-20", C.defaultTimes);
  assert.equal((await book(env, { email, slot: `2026-11-20T${C.defaultTimes[0]}` }, { now: later })).status, 200, "the other study takes the same person");
  assert.equal(rows(DB).filter((r) => r.email === email).map((r) => r.study).sort().join(), [id, "study1"].sort().join());
  // the progress of the third study in the studies list: 1 of 5
  const list = await text(await call(env, req(`/admin?s=studies&st=${id}`, { cookie: s2.cookie }), later));
  assert.ok(has(list, AT.progress.of(1, 5)));
});

test("a study can be archived and restored, never deleted; the active study cannot be archived; an archived study cannot be made active", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const a = await create(env, s, { name: "Archive me", [`title_${L0}`]: "Archive me title" });
  const b = await create(env, s, { name: "Keep me", [`title_${L0}`]: "Keep me title" });
  await adminDo(env, s, `study:${b}`, { s: "studies" });
  // the active one is refused, with a message, and nothing changes
  assert.equal(code(await adminDo(env, s, `study-archive:${b}`, { s: "studies" })), "study-archive-active");
  assert.equal(stored(DB, b).archived, false);
  const page = await adminGet(env, s, `?s=studies&st=${b}`);
  assert.match(page, new RegExp(`<button class="plain" disabled>${esc(AT.studies.archive)}</button>`), "no archive button for the active study");
  assert.ok(has(page, AT.studies.cannotArchive));
  // another one is archived
  ins(DB, { study: a, status: "attended", date: "2026-11-10" });
  assert.equal(code(await adminDo(env, s, `study-archive:${a}`, { s: "studies" })), "study-archived");
  assert.equal(stored(DB, a).archived, true);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM bookings WHERE study = ?").get(a).n, 1, "its bookings stay");
  assert.ok(studyRows(DB).includes(a), "never deleted");
  const arch = await adminGet(env, s, `?s=studies&st=${a}`);
  assert.ok(has(arch, AT.studies.archivedMark));
  assert.match(arch, new RegExp(`value="study-restore:${a}"`));
  assert.ok(!arch.includes(`value="study-archive:${a}"`));
  assert.ok(!arch.includes(`value="study:${a}"`), "no 'make active' for an archived study");
  // hidden from the choices of the switch and refused as the active one
  const sw = (await adminGet(env, s, "?s=studies")).split("<h3>" + esc(AT.set.studyTitle) + "</h3>")[1] || "";
  assert.ok(!sw.split("</form>")[0].includes("Archive me"), "an archived study is not among the choices of the switch");
  assert.equal(code(await adminDo(env, s, `study:${a}`, { s: "studies" })), "denied");
  assert.equal(await D.getActiveStudy(DB), b);
  // restored
  assert.equal(code(await adminDo(env, s, `study-restore:${a}`, { s: "studies" })), "study-restored");
  assert.equal(stored(DB, a).archived, false);
  // an unknown or malformed id is "that study does not exist" and changes nothing
  for (const verb of ["study-archive", "study-restore", "study-save"]) for (const bad of ["nope", "../x", "s'; DROP TABLE studies;--", ""]) {
    assert.equal(code(await adminDo(env, s, `${verb}:${bad}`, { s: "studies", ...fields() })), "study-gone", `${verb}:${bad}`);
  }
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM studies").get().n, (C.twoStudies ? 2 : 1) + 2);
});

test("the 'several studies' card lists the studies that are not archived by their title with now/later, only when there are at least two", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const l = TESTED[0];
  // one study saved: with one study in the table there is no card, whatever twoStudies said before
  await adminDo(env, s, "study-save:study1", { s: "studies", ...fields({ name: "One", [`title_${l}`]: "Card title one" }) });
  const S = T[l];
  let h = await home(env, l);
  if (!C.twoStudies) assert.ok(!h.includes(esc(S.manyH)) && !h.includes(esc(S.twoH)), "one study: no card");
  // a new study is hidden until it is listed: it does not make a card by itself
  const two = await create(env, s, { name: "Two", [`title_${l}`]: "Card title two", public_state: "hidden" });
  const three = await create(env, s, { name: "Three", [`title_${l}`]: "Card title three", public_state: "hidden" });
  if (!C.twoStudies) assert.ok(!(await home(env, l)).includes(esc(S.manyH)), "two hidden drafts: still no card");
  await adminDo(env, s, `study-save:${two}`, { s: "studies", ...fields({ name: "Two", [`title_${l}`]: "Card title two", public_state: "later" }) });
  await adminDo(env, s, `study-save:${three}`, { s: "studies", ...fields({ name: "Three", [`title_${l}`]: "Card title three", public_state: "later" }) });
  h = await home(env, l);
  assert.ok(h.includes(`<h2>${esc(S.manyH)}</h2>`));
  const card = /<h2>[^<]*<\/h2><p>[^<]*<\/p><ul>(?:<li>[^<]*<\/li>)+<\/ul>/.exec(h.slice(h.indexOf(`<h2>${esc(S.manyH)}</h2>`) - 30))[0];
  const items = [...card.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, (C.twoStudies ? 2 : 1) + 2);
  assert.match(items.find((x) => x.includes("Card title one")), new RegExp(`${esc(S.twoNow)}$`));
  assert.match(items.find((x) => x.includes("Card title two")), new RegExp(`${esc(S.twoLater)}$`));
  assert.match(items.find((x) => x.includes("Card title three")), new RegExp(`${esc(S.twoLater)}$`));
  // the active one moves; an archived one leaves the list
  await adminDo(env, s, `study:${three}`, { s: "studies" });
  await adminDo(env, s, `study-archive:${two}`, { s: "studies" });
  h = await home(env, l);
  assert.ok(!h.includes("Card title two"), "archived: not listed");
  const items2 = [...h.slice(h.indexOf(`<h2>${esc(S.manyH)}</h2>`)).split("</ul>")[0].matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
  assert.match(items2.find((x) => x.includes("Card title three")), new RegExp(`${esc(S.twoNow)}$`));
  assert.match(items2.find((x) => x.includes("Card title one")), new RegExp(`${esc(S.twoDone)}$`));
  // down to one study that is not archived: the card goes away
  if (!C.twoStudies) {
    await adminDo(env, s, "study:study1", { s: "studies" });
    await adminDo(env, s, `study-archive:${three}`, { s: "studies" });
    assert.ok(!(await home(env, l)).includes(esc(S.manyH)));
  }
});

// ---- progress ---------------------------------------------------------------------------------------------------------------------------
test("progress: done counts the attended bookings, the ones already purged included; the agenda shows it above today; the list shows it per study", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Progress", target: "5" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  ins(DB, { study: id, status: "attended", date: "2026-11-09", time: A });
  ins(DB, { study: id, status: "attended", date: "2026-11-10", time: A });
  ins(DB, { study: id, status: "noshow", date: "2026-11-10", time: C.defaultTimes[C.defaultTimes.length - 1] });
  ins(DB, { study: id, status: "cancelled", date: DAY });
  ins(DB, { study: id, status: "confirmed", date: DAY });
  DB.raw.exec(`INSERT INTO tallies (study, week, status, n) VALUES ('${id}', '2026-08-31', 'attended', 1), ('${id}', '2026-08-31', 'noshow', 4)`);
  const agenda = await adminGet(env, s, "?s=agenda");
  assert.ok(has(agenda, AT.progress.of(3, 5)), "2 live + 1 purged = 3 of 5");
  assert.match(agenda, /<progress class="prog" max="5" value="3"[^>]*>60%<\/progress>/);
  assert.ok(has(agenda, AT.progress.booked(1)), "one still booked for the coming days");
  assert.ok(has(agenda, AT.progress.remaining(2)), "two remain");
  assert.ok(agenda.indexOf('id="prog-title"') > 0 && agenda.indexOf('id="prog-title"') < agenda.indexOf('id="cal-title"'), "in the block above the calendar, beside today and tomorrow");
  assert.ok(!/<progress[^>]*style=/.test(agenda));
  const list = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.ok(has(list, AT.progress.of(3, 5)));
  assert.ok(has(list, AT.studies.targetOf(5)));
  // reached: nothing remains
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Progress", target: "3" }) });
  const done = await adminGet(env, s, "?s=agenda");
  assert.ok(has(done, AT.progress.of(3, 3)) && has(done, AT.progress.reached));
  assert.match(done, /<progress class="prog" max="3" value="3"/);
  // more than the target: the bar stops at the target, the number does not lie
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Progress", target: "2" }) });
  const over = await adminGet(env, s, "?s=agenda");
  assert.ok(has(over, AT.progress.of(3, 2)));
  assert.match(over, /<progress class="prog" max="2" value="2"/);
  // no target: no bar in the agenda, the list says what is known
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Progress", target: "" }) });
  const none = await adminGet(env, s, "?s=agenda");
  assert.ok(!none.includes("<progress") && !none.includes('id="prog-title"'));
  assert.ok(has(await adminGet(env, s, `?s=studies&st=${id}`), AT.studies.doneNoTarget(3, 1)));
  // the study that is not active does not show in the agenda
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Progress", target: "5" }) });
  await adminDo(env, s, "study:study1", { s: "studies" });
  assert.ok(!(await adminGet(env, s, "?s=agenda")).includes("<progress"));
  assert.ok((await adminGet(env, s, "?s=studies")).includes("<progress"), "but the list shows it");
});

// ---- escaping -------------------------------------------------------------------------------------------------------------------------------
const EVIL = `<script>alert(1)</script> "quoted" 'single' & <img src=x onerror=alert(2)>`;
const NAME_EVIL = `<script>alert(1)</script> "q" 'a' & <img onerror=x>`; // a name has at most 60 characters
const NAME_ESC = "&lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot; &#39;a&#39; &amp; &lt;img onerror=x&gt;";
const EVIL_ESC = "&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &#39;single&#39; &amp; &lt;img src=x onerror=alert(2)&gt;";
const clean = (h, where) => {
  assert.ok(!h.includes("<script>alert"), `${where}: raw <script>`);
  assert.ok(!h.includes("<img src=x") && !h.includes("<img onerror"), `${where}: raw <img>`);
  assert.ok(!/<[a-z][^>]*\son[a-z]+=/i.test(h.replace(/="[^"]*"/g, '=""')), `${where}: event handler attribute`); // attribute values are escaped text: look at the attribute names only
};

test("every editable field is plain text on every page: public, admin (list, form, preview, day panel, data), and the notice e-mail", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  const f = { name: NAME_EVIL, target: "7" };
  for (const l of LANGS) Object.assign(f, { [`title_${l}`]: EVIL, [`lead_${l}`]: `${EVIL}\nsecond line <b>bold</b>`, [`does_${l}`]: `${EVIL}\n\nnew paragraph <i>x</i>`, [`reqs_${l}`]: `${EVIL}\n<u>second</u> requirement` });
  assert.equal(code(await adminDo(env, s, "study-save:study1", { s: "studies", ...fields(f) })), "study-saved");
  const other = await create(env, s, { name: "Second study", [`title_${L0}`]: EVIL });
  assert.equal(stored(DB, "study1").name, oneLine(NAME_EVIL), "stored as typed, nothing interpreted");
  // public page, every language, with the card of several studies
  for (const l of TESTED) {
    const h = await home(env, l);
    clean(h, `public ${l}`);
    assert.ok(h.includes(`<h1 id="hero-title">${EVIL_ESC}</h1>`), `${l}: title escaped`);
    assert.ok(h.includes(`${EVIL_ESC}\nsecond line &lt;b&gt;bold&lt;/b&gt;`), `${l}: lead escaped, line break kept as text`);
    assert.ok(h.includes("&lt;u&gt;second&lt;/u&gt; requirement"), `${l}: requirement escaped`);
    assert.ok(h.includes(`<li>${EVIL_ESC}`) , `${l}: the card of the studies escapes the titles`);
  }
  // a booking in the second study, so that the day panel names it
  await adminDo(env, s, `study:${other}`, { s: "studies" });
  ins(DB, { study: other, date: DAY, status: "confirmed", name: "Booked Person" });
  await adminDo(env, s, "study-save:study1", { s: "studies", ...fields(f) }); // unchanged
  const all = await adminGet(env, s, `?s=all&day=${DAY}&st=study1&pl=${L0}`);
  clean(all, "admin all");
  assert.ok(all.includes(NAME_ESC), "the name is shown, escaped");
  assert.ok(all.includes(`value="${NAME_ESC}"`), "the input value is escaped");
  assert.match(all, new RegExp(`<textarea id="st-lead-${L0}"[^>]*>${EVIL_ESC.replace(/[()]/g, "\\$&")}\nsecond line &lt;b&gt;bold&lt;/b&gt;</textarea>`));
  // the data section and its CSV
  // the e-mail to the researcher names the study (several studies in the table), escaped in the HTML part
  const m = relay();
  await adminDo(env, s, "confirm-mode:instant", {}, NOW, m.fn);
  await adminDo(env, s, `study:${other}`, { s: "studies" });
  await adminDo(env, s, `study-save:${other}`, { s: "studies", ...fields({ name: NAME_EVIL + "!" }) });
  await D.openDay(DB, "2026-11-19", C.defaultTimes);
  assert.equal((await book(env, { slot: `2026-11-19T${C.defaultTimes[0]}` }, { fetchFn: m.fn })).status, 200);
  const notice = m.calls.find((c) => c.json.to === C.contactEmail);
  assert.ok(notice, "the researcher gets the notice");
  assert.ok(!notice.json.html.includes("<script>alert") && !notice.json.html.includes("<img "), "e-mail HTML");
  assert.ok(notice.json.html.includes(NAME_ESC + "!"), "the study name is in the HTML part, escaped");
  assert.ok(!/\r|\n/.test(notice.json.subject) && !notice.json.subject.includes("alert"), "nothing typed reaches the subject");
  for (const c of m.calls) { clean(c.json.html || "", "mail html"); assert.ok(!/[\r\n]Bcc:/i.test(String(c.json.subject))); }
});
test("a study name that looks like a formula is neutralised in both CSV files, and no line break reaches a CSV", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "=cmd|' /C calc'!A0" });
  await create(env, s, { name: "@SUM(1+1)" });
  await adminDo(env, s, `study:${id}`, { s: "studies" });
  ins(DB, { study: id, name: "=HYPERLINK(\"http://x\")", status: "attended", date: "2026-11-10" });
  DB.raw.exec(`INSERT INTO tallies (study, week, status, n) VALUES ('${id}', '2026-08-31', 'attended', 2)`);
  for (const path of ["/admin/csv", "/admin/csv-resumen"]) {
    const r = await call(env, req(path, { cookie: s.cookie }));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/csv/);
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.match(r.headers.get("content-disposition"), /attachment; filename="[^"]+\.csv"/);
    const body = await r.text();
    assert.ok(body.includes(`"'=cmd|' /C calc'!A0"`), `${path}: the formula is quoted with a leading apostrophe`);
    for (const line of body.split("\r\n").slice(1)) for (const cell of line.match(/"(?:[^"]|"")*"/g) || []) assert.ok(!/^"[=+\-@\t\r]/.test(cell), `${path}: ${cell}`);
  }
});

test("the limits hold on the page too: a field that is too long, a bad target, too many requirements, an empty name are refused with the same form (200) filled with what was typed, and save nothing", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Limits", target: "9" });
  await create(env, s, { name: "Taken name" });
  const before = DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data;
  const bad = [
    [{ name: "x".repeat(61) }, "name"], [{ name: "  " }, "name"], [{ name: "taken NAME" }, "name"], [{ target: "0" }, "target"], [{ target: "10000" }, "target"], [{ target: "2.5" }, "target"],
    [{ [`title_${L0}`]: "t".repeat(161) }, `title_${L0}`], [{ [`lead_${L0}`]: "l".repeat(1201) }, `lead_${L0}`], [{ [`does_${L0}`]: "d".repeat(2001) }, `does_${L0}`],
    [{ [`reqs_${L0}`]: "r".repeat(301) }, `reqs_${L0}`], [{ [`reqs_${L0}`]: Array.from({ length: 21 }, (_, i) => `r${i}`).join("\n") }, `reqs_${L0}`],
  ];
  for (const [o, field] of bad) {
    const typed = fields({ name: "Limits", target: "9", ...o });
    const r = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...typed });
    assert.equal(r.status, 200, `${JSON.stringify(o).slice(0, 70)}: the same form, not a redirect`);
    const h = await text(r);
    assert.match(h, /<p class="error" role="alert">/, "an alert at the top");
    assert.match(h, new RegExp(`<p class="error field-error" id="[^"]*-err">`), "and the error next to the field");
    assert.match(h, new RegExp(`id="([^"]+)"[^>]*aria-invalid="true"`), "the field is marked");
    assert.ok(new RegExp(`name="${field}"[^>]*aria-invalid="true"`).test(h), `the field ${field} is the one marked`);
    assert.match(h, /aria-current="page">/);
    // what was typed is in the form, not the stored study
    const typedValue = String(o[Object.keys(o)[0]]).trim();
    if (typedValue && !typedValue.includes("\n")) assert.ok(h.includes(esc(typedValue)), "the typed text is in the form");
    assert.equal(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data, before, "nothing was saved");
  }
  // a message about a long field names the field and the language, and carries no markup
  const r = await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Limits", [`does_${L0}`]: "<b>" + "d".repeat(2001) }) });
  const h = await text(r);
  assert.ok(h.includes(esc(AT.studies.fieldLabel.does.charAt(0).toUpperCase() + AT.studies.fieldLabel.does.slice(1))));
  assert.ok(!h.includes("<b>ddd"), "the typed text is escaped in the form");
  assert.ok(h.includes("&lt;b&gt;ddd"));
  // limits as stated in the constants
  assert.deepEqual({ ...LIMITS }, { name: 60, target: 9999, outside: 9999, title: 160, lead: 1200, does: 2000, req: 300, reqs: 20 });
});

test("keys that are not part of a study are dropped on save: nothing typed becomes a key", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Keys" });
  await adminDo(env, s, `study-save:${id}`, { s: "studies", ...fields({ name: "Keys" }), archived: "1", "__proto__": "x", constructor: "y", "texts.xx.title": "z", unknown: "q", [`extra_${L0}`]: "e", id: "other", position: "99", data: "{}" });
  const raw = JSON.parse(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data);
  assert.deepEqual(Object.keys(raw), ["name", "target", "archived", "declarations", "publicState", "texts"]);
  assert.equal(raw.archived, false, "'archived' only changes with the archive button");
  assert.deepEqual(Object.keys(raw.texts).sort(), [...LANGS].sort());
  for (const l of LANGS) assert.deepEqual(Object.keys(raw.texts[l]), ["title", "lead", "does", "reqs"]);
  assert.equal(DB.raw.prepare("SELECT position FROM studies WHERE id = ?").get(id).position, (C.twoStudies ? 2 : 1) + 1);
});

// ---- session and CSRF ------------------------------------------------------------------------------------------------------------------------
test("every new action needs the session and the CSRF token; the exports need the session", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await create(env, s, { name: "Guarded" });
  const snapshot = () => JSON.stringify([DB.raw.prepare("SELECT * FROM studies ORDER BY id").all(), DB.raw.prepare("SELECT * FROM settings WHERE key = 'active_study'").all()]);
  const before = snapshot();
  const actions = [[`study-save:${id}`, fields({ name: "Changed" })], ["study-new", {}], [`study-archive:${id}`, {}], [`study-restore:${id}`, {}], [`study:${id}`, {}], ["study:study1", {}]];
  for (const [action, extra] of actions) {
    const noCsrf = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: action, ...extra } }));
    assert.equal(noCsrf.status, 403, `${action} without a token`);
    const wrong = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "x".repeat(24), do: action, ...extra } }));
    assert.equal(wrong.status, 403, `${action} with a wrong token`);
    const noSession = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: action, ...extra } }));
    assert.equal(noSession.status, 401, `${action} without a session`);
    assert.doesNotMatch(await noSession.text(), /Changed|Guarded/);
    const get = await call(env, req(`/admin/do?do=${encodeURIComponent(action)}`, { cookie: s.cookie }));
    assert.ok(get.status === 404 || get.status === 303, `${action} by GET does nothing`);
  }
  assert.equal(snapshot(), before, "nothing changed");
  // the summary export: no session, no data (the login page or a redirect, never the file)
  const anon = await call(env, req("/admin/csv-resumen"));
  assert.notEqual(anon.status, 200);
  assert.ok(!(await anon.text()).includes("text/csv"));
  assert.ok(!(anon.headers.get("content-type") || "").includes("csv"));
  const bookings = await call(env, req("/admin/csv"));
  assert.notEqual(bookings.status, 200);
  // the CSV is only a GET
  const post = await call(env, req("/admin/csv-resumen", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf } }));
  assert.notEqual(post.status, 200);
});
