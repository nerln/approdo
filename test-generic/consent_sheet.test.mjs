// The informed-consent sheet, the order of the signature blocks (and the switch that puts the researcher's block first), the footer with
// the study name and the date of the last change, the defaults taken from the study, the count of bracketed gaps on the screen strip,
// the wording of the built-in texts and what the editor shows about the promises of the public page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esc } from "../src/util.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { CONSENT_FIELDS, CONSENT_FORM } from "../src/studies.js";
import { SHEET, BRACKETS, consentDefaults, consentPromises, countGaps, publicFacts, ownStudyTexts } from "../src/consent.js";
import { T, BUILTIN_TEXTS } from "../src/i18n.js";
import { LANG_REGISTRY } from "../src/config.js";
import * as D from "../src/db.js";
import { C, LANGS, MONDAY, at, setup, call, req, text, adminSession, adminDo, adminGet, code, rawConfig, withConfig } from "./helpers.mjs";

const L0 = LANGS[0];
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const sheet = async (env, s, id, lang, now) => text(await call(env, req(`/admin/consent?study=${id}&lang=${lang}`, { cookie: s.cookie }), now));
const blankConsent = () => Object.fromEntries(LANGS.flatMap((l) => [...CONSENT_FIELDS.map((f) => [CONSENT_FORM(f, l), ""]), [CONSENT_FORM("perms", l), ""], [CONSENT_FORM("researcher", l), "1"], [CONSENT_FORM("adult", l), "1"]]));
const saveConsent = (env, s, id, o = {}, now) => adminDo(env, s, `consent-save:${id}`, { s: "studies", ...blankConsent(), ...o }, now);
const blank = () => Object.fromEntries(LANGS.flatMap((l) => [[`title_${l}`, ""], [`lead_${l}`, ""], [`does_${l}`, ""], [`reqs_${l}`, ""]]));
let k = 0;
async function study(env, s, o = {}, now) {
  const r = await adminDo(env, s, "study-new", { s: "studies" }, now);
  const id = loc(r).searchParams.get("st");
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, { s: "studies", name: `Sheet study ${++k}`, target: "", ...blank(), ...o }, now)), "study-saved");
  return id;
}
const blockOf = (h) => /<section class="sheet-sec sheet-consent"[\s\S]*<\/section>/.exec(h)[0];
const view = async (DB, id) => (await D.getRegistry(DB)).studies.find((x) => x.id === id);

// ---- the order on paper ---------------------------------------------------------------------------------------------------------------------
test("on paper: the participant's statement, the optional permissions, the participant's block (printed name, date, signature), then the researcher's block", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await study(env, s);
  await saveConsent(env, s, id, { [CONSENT_FORM("perms", L0)]: "I agree to be photographed.\nI agree to be filmed" });
  const S = SHEET[L0];
  const b = blockOf(await sheet(env, s, id, L0));
  const pos = (x) => { const i = b.indexOf(x); assert.ok(i >= 0, x); return i; };
  assert.ok(pos("sheet-statement") < pos("sheet-perms"), "statement, then the permissions");
  assert.ok(pos("sheet-perms") < pos(`>${S.participant}<`), "then the participant's block");
  assert.ok(pos(`>${S.participant}<`) < pos(`>${S.researcher}<`), "then the researcher's block");
  const rows = b.split('<div class="sheet-sign-row">').slice(1).map((x) => x.slice(0, x.indexOf("</div>")));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const labels = [...row.matchAll(/class="sheet-line-label">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(labels, [S.printedName, S.date, S.signature].map(esc), "printed name, date, signature");
  }
  assert.ok(pos("sheet-copies") > pos(`>${S.researcher}<`));
});

test("the switch 'researcher's lines first' (off by default, per study and language) restores the old order", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await study(env, s);
  const S = SHEET[L0];
  const ed = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  assert.match(ed, new RegExp(`name="c_researcherFirst_${L0}" value="1"(?! checked)`), "off by default");
  assert.ok(ed.includes(esc(AT.consent.fResearcherFirst)));
  assert.equal(code(await saveConsent(env, s, id, { [CONSENT_FORM("researcherFirst", L0)]: "1", [CONSENT_FORM("perms", L0)]: "One permission" })), "consent-saved");
  const b = blockOf(await sheet(env, s, id, L0));
  const i = (x) => b.indexOf(x);
  assert.ok(i(`>${S.researcher}<`) < i("sheet-statement") && i("sheet-statement") < i("sheet-perms") && i("sheet-perms") < i(`>${S.participant}<`), "researcher, statement, permissions, participant");
  assert.equal((await view(DB, id)).consent[L0].researcherFirst, true);
  assert.match(await adminGet(env, s, `?s=studies&st=${id}&c=consent`), new RegExp(`name="c_researcherFirst_${L0}" value="1" checked`));
  // another language of the same study keeps the default order
  if (LANGS.length > 1) {
    const other = LANGS[1], So = SHEET[other];
    const bo = blockOf(await sheet(env, s, id, other));
    assert.ok(bo.indexOf("sheet-statement") < bo.indexOf(`>${So.participant}<`) && bo.indexOf(`>${So.participant}<`) < bo.indexOf(`>${So.researcher}<`));
  }
  // with no researcher lines at all the switch has nothing to move
  await saveConsent(env, s, id, { [CONSENT_FORM("researcherFirst", L0)]: "1", [CONSENT_FORM("researcher", L0)]: "" });
  assert.ok(!blockOf(await sheet(env, s, id, L0)).includes(`>${S.researcher}<`));
  // switching it off again removes the group when it holds only defaults
  await saveConsent(env, s, id, {});
  assert.equal((await view(DB, id)).consent, undefined);
});

// ---- the footer ------------------------------------------------------------------------------------------------------------------------------
test("every sheet has a footer line with the study name and the version: the date of the last change of the study", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const fmt = (lang, iso) => new Intl.DateTimeFormat(LANG_REGISTRY[lang].locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  const id = await study(env, s, {});
  const created = await sheet(env, s, id, L0);
  const foot = (h) => /<footer class="sheet-foot"><p>([^<]*)<\/p><\/footer>/.exec(h)[1];
  // a study saved from the panel today: the date of that change
  assert.equal(foot(created), `Sheet study ${k} · ${SHEET[L0].version(fmt(L0, MONDAY))}`.replace(/&#39;/g, "'"));
  // a later change moves the date; another language writes it in its own words
  const later = at("2026-12-05", "09:00");
  const sLater = await adminSession(env, later);
  await adminDo(env, sLater, `study-save:${id}`, { s: "studies", name: `Sheet study ${k}`, target: "", ...blank(), [`title_${L0}`]: "A changed title" }, later);
  for (const l of LANGS) {
    const h = await sheet(env, sLater, id, l, later);
    assert.equal(foot(h), `Sheet study ${k} · ${SHEET[l].version(fmt(l, "2026-12-05"))}`, `${l}: the footer of the sheet`);
    assert.ok(h.indexOf("sheet-foot") > h.indexOf("sheet-consent"), "at the end");
  }
  // saving it again without a change does not move the date
  const latest = at("2026-12-20", "09:00");
  const sLatest = await adminSession(env, latest);
  await adminDo(env, sLatest, `study-save:${id}`, { s: "studies", name: `Sheet study ${k}`, target: "", ...blank(), [`title_${L0}`]: "A changed title" }, latest);
  assert.ok(foot(await sheet(env, sLatest, id, L0, latest)).includes(SHEET[L0].version(fmt(L0, "2026-12-05"))));
  // a study of the configuration nobody changed: the day the sheet is printed
  const plain = await sheet(env, s, "study1", L0);
  assert.ok(foot(plain).endsWith(SHEET[L0].version(fmt(L0, MONDAY))));
  // the study name is escaped
  const evil = await study(env, s, { name: `<b>x</b> "q"` });
  assert.ok(!(await sheet(env, s, evil, L0)).includes("<b>x</b>"));
  assert.ok((await sheet(env, s, evil, L0)).includes(esc(`<b>x</b> "q"`)));
});

// ---- defaults taken from the study ---------------------------------------------------------------------------------------------------------
test("'what you will do' and 'who cannot take part' are filled from the study's what-you-will-do text, requirements and declarations; with none of them the bracketed gap stays", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const bracket = (l, key) => `[${BRACKETS[l][key]}]`;
  const text0 = (h, sec) => new RegExp(`<section class="sheet-sec" id="s-${sec}">([\\s\\S]*?)</section>`).exec(h)[1].replace(/<[^>]+>/g, " ");
  const bare = await study(env, s);
  const hb = await sheet(env, s, bare, L0);
  // a draft falls back on the generic texts: when the configuration gives them (realistic-edit) they count as the study's own text
  const bareOwn = ownStudyTexts(L0, await view(DB, bare));
  assert.equal(text0(hb, "procedure").includes(bracket(L0, "tasks")), !bareOwn.does, "nothing of its own: the gap");
  assert.equal(text0(hb, "exclusion").includes(bracket(L0, "who")), !bareOwn.reqs.length, "nothing of its own: the gap");
  if (bareOwn.does) assert.ok(text0(hb, "procedure").includes(bareOwn.does.split("\n")[0].slice(0, 40)));
  // with texts of its own
  const own = await study(env, s, { [`does_${L0}`]: "You will move through a virtual corridor and answer two questionnaires.", [`reqs_${L0}`]: "Be over 18\nSpeak the language of the questionnaires", epilepsy: "1" });
  const h = await sheet(env, s, own, L0);
  const proc = text0(h, "procedure"), excl = text0(h, "exclusion");
  assert.ok(proc.includes("You will move through a virtual corridor and answer two questionnaires."));
  assert.ok(!/\[[^\]]*\]/.test(proc.replace(bracket(L0, "tasks"), "")) && !proc.includes(bracket(L0, "tasks")), "the gap is gone");
  assert.ok(excl.includes("Be over 18") && excl.includes("Speak the language of the questionnaires"), "the requirements");
  assert.ok(excl.includes(SHEET[L0].reqIntro), "introduced as the conditions to take part");
  assert.match(excl, /epilep|epiless/i, "and the declaration");
  assert.ok(!excl.includes(bracket(L0, "who")), "no gap");
  // only declarations: they are the text, no gap
  const decl = await study(env, s, { vestibular: "1" });
  const exclD = text0(await sheet(env, s, decl, L0), "exclusion");
  assert.ok(/vestib/i.test(exclD) && !exclD.includes(bracket(L0, "who")));
  // the study's own text of another language does not leak into this one
  if (LANGS.length > 1) assert.equal(text0(await sheet(env, s, own, LANGS[1]), "procedure").includes(bracket(LANGS[1], "tasks")), !ownStudyTexts(LANGS[1], await view(DB, bare)).does);
  // a stored consent text wins over the default
  await saveConsent(env, s, own, { [CONSENT_FORM("procedure", L0)]: "Procedure written by hand." });
  const hand = text0(await sheet(env, s, own, L0), "procedure");
  assert.ok(hand.includes("Procedure written by hand.") && !hand.includes("virtual corridor"), "replaces the default");
  // the editor shows the same default text as its value
  assert.ok((await adminGet(env, s, `?s=studies&st=${decl}&c=consent`)).includes(esc(consentDefaults(L0, await view(DB, decl)).exclusion.split("\n")[0])));
  const o = ownStudyTexts(L0, await view(DB, own));
  assert.deepEqual([o.does.length > 0, o.reqs.length], [true, 2]);
});

test("a configuration that gives its own text for the study fills the sheet the same way, without any panel edit", () => {
  const cfg = rawConfig();
  const l = cfg.languages[0];
  cfg.texts = { ...(cfg.texts || {}), [l]: { ...((cfg.texts || {})[l] || {}), "study1.does": "Text of the configuration about the tasks.", "study1.reqs": ["Requirement of the configuration."] } };
  const script = `
import { setup, adminSession, adminGet, call, req, text, LANGS } from "./test-generic/helpers.mjs";
import { consentDefaults } from "./src/consent.js";
import * as D from "./src/db.js";
const { DB, env } = await setup();
const s = await adminSession(env);
const view = (await D.getRegistry(DB)).studies[0];
const d = consentDefaults(LANGS[0], view);
console.log(JSON.stringify({ procedure: d.procedure, exclusion: d.exclusion }));
`;
  const r = withConfig(cfg, script);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  assert.ok(o.procedure.includes("Text of the configuration about the tasks.") && !/\[/.test(o.procedure));
  assert.ok(o.exclusion.includes("Requirement of the configuration."));
});

// ---- the screen strip ------------------------------------------------------------------------------------------------------------------------------
test("the strip on the screen (not printed) says how many bracketed gaps remain, in the language of the panel; it counts down as they are filled", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await study(env, s);
  const gapsOf = (h) => [...h.replace(/<div class="sheet-screen">[\s\S]*?<\/div>/, "").replace(/<[^>]+>/g, " ").matchAll(/\[[^\[\]\n]*\]/g)].length;
  const strip = (h) => /<div class="sheet-screen">([\s\S]*?)<\/div>/.exec(h)[1];
  const h = await sheet(env, s, id, L0);
  const n = gapsOf(h);
  assert.ok(n >= 8, `${n} gaps in the default sheet`);
  assert.ok(strip(h).includes(esc(AT.consent.gapsLeft(n))), `the strip says ${n}`);
  assert.ok(AT.consent.gapsLeft(n).includes(String(n)));
  // the strip is not printed
  assert.match(readFileSync(new URL("../public/admin.css", import.meta.url), "utf8"), /@media print\{[\s\S]*\.sheet-screen\{display:none\}/);
  // filling one removes one; filling all of them says there are none
  await saveConsent(env, s, id, { [CONSENT_FORM("aim", L0)]: "x", [CONSENT_FORM("description", L0)]: "A description with no gap." });
  const h2 = await sheet(env, s, id, L0);
  assert.equal(gapsOf(h2), n - 1);
  assert.ok(strip(h2).includes(esc(AT.consent.gapsLeft(n - 1))));
  const all = Object.fromEntries(CONSENT_FIELDS.map((f) => [CONSENT_FORM(f, L0), f === "heading" || f === "duration" ? "Filled" : `Filled in ${f}`]));
  await saveConsent(env, s, id, all);
  const h3 = await sheet(env, s, id, L0);
  assert.equal(gapsOf(h3), 0);
  assert.ok(strip(h3).includes(esc(AT.consent.gapsLeft(0))));
  // the counter itself
  assert.equal(countGaps({ a: "x [one] y [two]", b: "no gap", c: "[three]" }, ["[four]"]), 4);
  assert.equal(countGaps({ a: "" }), 0);
  // in both languages of the panel
  for (const set of Object.values(ADMIN_TEXT_SETS)) assert.ok(set.consent.gapsLeft(0) && set.consent.gapsLeft(1).includes("1") && set.consent.gapsLeft(7).includes("7"));
});

// ---- wording ----------------------------------------------------------------------------------------------------------------------------------------
test("the Italian and English default texts read correctly whatever the university is called: no article is needed before it", () => {
  for (const university of ["Università degli Studi di Roma", "Politecnico di Milano", "the University of Somewhere", "Università di Esempio"]) {
    const cfg = rawConfig();
    cfg.languages = ["it", "en"]; cfg.adminLanguage = "it";
    cfg.org = { ...cfg.org, group: "Gruppo Prova", university };
    const some = () => ({ it: "Laboratorio Prova, Via Prova 1", en: "Test laboratory, 1 Test Street" });
    cfg.place = { long: some(), short: some(), room: some() };
    cfg.hero = { creditHtml: null }; cfg.texts = {};
    const script = `
import { consentDefaults } from "./src/consent.js";
const v = { id: "x", texts: {}, declarations: {} };
console.log(JSON.stringify({ it: consentDefaults("it", v), en: consentDefaults("en", v) }));
`;
    const r = withConfig(cfg, script);
    assert.equal(r.status, 0, r.err);
    const o = JSON.parse(r.out.trim().split("\n").pop());
    assert.ok(o.it.description.startsWith(`Questo studio è condotto dal gruppo Gruppo Prova (${university}).`), `it: ${o.it.description}`);
    assert.ok(!o.it.description.includes(`Gruppo Prova di ${university}`), "no 'di' before the university");
    assert.ok(o.it.welcome.includes(`(${university})`));
    assert.ok(o.en.procedure.startsWith("The session is individual and takes place at: Test laboratory, 1 Test Street."), `en: ${o.en.procedure}`);
    assert.ok(!o.en.procedure.startsWith("You will come to"));
  }
});

test("the default retention text also says that copies of the booking notices stay in the researcher's mailbox until the study ends and that counts per week without names are kept", () => {
  const cfg = rawConfig();
  cfg.languages = ["es", "en", "it"]; cfg.adminLanguage = "es";
  const some = () => ({ es: "a", en: "a", it: "a" });
  cfg.place = { long: some(), short: some(), room: some() };
  cfg.hero = { creditHtml: null }; cfg.texts = {};
  const r = withConfig(cfg, `
import { consentDefaults } from "./src/consent.js";
const v = { id: "x", texts: {}, declarations: {} };
console.log(JSON.stringify(Object.fromEntries(["es", "en", "it"].map((l) => [l, consentDefaults(l, v).retention]))));
`);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out.trim().split("\n").pop());
  const want = {
    es: /copias de los avisos de reserva se quedan en el buzón de correo del investigador hasta que termine el estudio, y se conservan recuentos por semana, sin nombres/,
    en: /Copies of the booking notices stay in the researcher's mailbox until the study ends, and counts per week without names are kept/,
    it: /copie degli avvisi di prenotazione restano nella casella di posta del ricercatore fino alla fine dello studio, e si conservano conteggi per settimana, senza nomi/,
  };
  for (const l of ["es", "en", "it"]) {
    assert.match(o[l], want[l], l);
    assert.ok(o[l].split("\n").length >= 3, `${l}: its own paragraph`);
  }
});

test("the built-in 'rights' list promises nothing about photos or videos (it cannot know the consent form); the fixture restates its own sentence", () => {
  for (const l of ["es", "en", "it"]) {
    assert.ok(!/foto|v[ií]deo|photo|video/i.test(BUILTIN_TEXTS[l].rights.join(" ")), `${l}: the built-in rights list`);
    assert.equal(BUILTIN_TEXTS[l].rights.length, 3, `${l}: three sentences`);
  }
  const fixture = readFileSync(new URL("../config/fixture-lab.config.js", import.meta.url), "utf8");
  for (const sentence of ["Las fotos o los vídeos de la sesión son opcionales: solo se hacen si lo aceptas en el consentimiento.", "Photos or videos of the session are optional: they are taken only if you agree in the consent form."]) {
    assert.match(fixture, /rights: \[/);
    assert.ok(fixture.includes(sentence), sentence);
  }
});

test("the editor lists every promise the public text makes about the consent, read-only, next to the sheet it has to agree with", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await study(env, s);
  const ed = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  for (const l of LANGS) {
    const promises = publicFacts(l, await view(DB, id)).promises;
    assert.ok(promises.length >= 1, `${l}: the public pages mention the consent`);
    assert.deepEqual(promises, consentPromises(l));
    for (const p of promises) {
      assert.ok(ed.includes(esc(p)), `${l}: "${p}" is listed`);
      assert.match(p, /consent|consenso|consentimiento/i);
      assert.ok(!/<|>|\{/.test(p), "plain text");
    }
    assert.ok(ed.includes(esc(AT.consent.promisesTitle)));
  }
  // a promise the lab's own text makes (in the "rights" list) is listed too
  const cfg = rawConfig();
  cfg.texts = { ...(cfg.texts || {}), [cfg.languages[0]]: { ...((cfg.texts || {})[cfg.languages[0]] || {}), rights: ["Voluntary.", "Photos of the session are taken only if you accept them in the consent form."] } };
  const r = withConfig(cfg, `import { LANGS } from "./test-generic/helpers.mjs"; import { consentPromises } from "./src/consent.js"; console.log(JSON.stringify(consentPromises(LANGS[0])));`);
  assert.equal(r.status, 0, r.err);
  assert.ok(JSON.parse(r.out.trim().split("\n").pop()).includes("Photos of the session are taken only if you accept them in the consent form."));
  assert.ok(T[L0].rights.length >= 1);
});

test("the documentation of the sheet: the order, the footer, the defaults, the gaps and the promises", () => {
  const doc = readFileSync(new URL("../docs/consenso.md", import.meta.url), "utf8");
  for (const w of ["prima le righe del ricercatore", "versione del", "parentesi quadre che restano", "nome in stampatello", "copie degli avvisi", "promette"]) assert.ok(doc.includes(w), w);
});
