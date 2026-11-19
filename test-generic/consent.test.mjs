// The informed-consent sheet of a study: the fields and their built-in defaults, the editor in the studies section, the printable
// page (/admin/consent), the consistency with the public page (read-only facts, the epilepsy warning), the limits, the escaping of every
// field, the session and CSRF rules, and the guarantee that nothing changes while no study has been saved from the panel.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esc } from "../src/util.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { parseStored, serialize, consentFromForm, CONSENT_FIELDS, CONSENT_LIMITS, consentMax, CONSENT_FORM } from "../src/studies.js";
import { BRACKETS, SHEET, SHEET_ORDER, consentDefaults, resolveConsent, consentWarnings } from "../src/consent.js";
import { T } from "../src/i18n.js";
import { SESSION_MINUTES } from "../src/slots.js";
import { C, LANGS, setup, call, req, text, adminSession, adminDo, adminGet, code, rawConfig, withConfig } from "./helpers.mjs";

const L0 = LANGS[0];
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const sheetUrl = (id, lang) => `/admin/consent?study=${id}&lang=${lang}`;
const sheet = async (env, s, id, lang) => call(env, req(sheetUrl(id, lang), { cookie: s.cookie }));
const studyRows = (DB) => DB.raw.prepare("SELECT id FROM studies ORDER BY position").all().map((r) => r.id);
const storedJson = (DB, id) => JSON.parse(DB.raw.prepare("SELECT data FROM studies WHERE id = ?").get(id).data);
const FIRST = "study1";
const text0 = (html) => html.replace(/<[^>]+>/g, " ");

// Form fields of the consent editor: every group blank, then the overrides ({ field: value } for the first language, or "field_lang").
const blank = () => Object.fromEntries(LANGS.flatMap((l) => [...CONSENT_FIELDS.map((f) => [CONSENT_FORM(f, l), ""]), [CONSENT_FORM("perms", l), ""], [CONSENT_FORM("researcher", l), "1"], [CONSENT_FORM("adult", l), "1"]]));
const cfields = (o = {}) => ({ ...blank(), ...o });
const save = (env, s, id, o = {}) => adminDo(env, s, `consent-save:${id}`, { s: "studies", ...cfields(o) });
const NASTY = `<script>alert(1)</script> "double" 'single' & <img src=x onerror=alert(2)> javascript:alert(3) <b>bold</b>`;

// A new study made from the panel (its first save also copies the configured studies), saved with the given declarations.
let nStudies = 0;
async function newStudy(env, s, { epilepsy = false, vestibular = false } = {}) {
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  assert.equal(code(r), "study-new");
  const id = loc(r).searchParams.get("st");
  const f = { s: "studies", name: `Consent study ${++nStudies}`, target: "", ...(epilepsy ? { epilepsy: "1" } : {}), ...(vestibular ? { vestibular: "1" } : {}) };
  for (const l of LANGS) for (const k of ["title", "lead", "does", "reqs"]) f[`${k}_${l}`] = "";
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, f)), "study-saved");
  return id;
}

// ---- the defaults -----------------------------------------------------------------------------------------------------------------
test("the default sheet renders for every configured language: the config values are in it, and no square-bracket key of the code is left", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  for (const lang of LANGS) {
    const r = await sheet(env, s, FIRST, lang);
    assert.equal(r.status, 200, lang);
    const h = await text(r);
    const body = text0(h);
    const org = C.orgBy[lang];
    for (const v of [org.group, org.university, C.place.long[lang], C.contactEmail, C.responsible, String(SESSION_MINUTES), String(C.bookingRetentionDays), String(C.contactMonths)]) {
      assert.ok(h.includes(esc(v)), `${lang}: the sheet says "${v}"`);
    }
    assert.match(h, new RegExp(`<html lang="${lang}"`));
    assert.doesNotMatch(h, /undefined|\bnull\b|\[object|\$\{|\{\{|NaN/, `${lang}: nothing unresolved`);
    // Every square-bracketed phrase is one of the declared "only the lab can know" phrases, and none of the keys of the code appears alone.
    const found = [...body.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
    assert.ok(found.length >= 8, `${lang}: the parts only the lab knows are marked (${found.length})`);
    const allowed = new Set(Object.values(BRACKETS[lang]));
    for (const f of found) assert.ok(allowed.has(esc(f).replace(/&#39;|&#x27;/g, "'")) || allowed.has(f), `${lang}: unknown bracket "${f}"`);
    for (const key of Object.keys(BRACKETS[lang])) assert.ok(!body.includes(`[${key}]`), `${lang}: key [${key}] left over`);
    assert.equal(Object.keys(BRACKETS.es).sort().join(), Object.keys(BRACKETS[lang]).sort().join(), "the same phrases in every language");
    // The default of every field is printed when nothing was edited.
    const d = consentDefaults(lang, { id: FIRST, texts: {}, declarations: { epilepsy: false, vestibular: false } });
    for (const f of CONSENT_FIELDS) assert.ok(d[f] && d[f].length > 3 && d[f].length <= consentMax(f), `${lang}.${f}: a default within its limit`);
  }
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM studies").get().n, 0, "looking at a sheet writes nothing");
});

test("the sections come in the order of a real consent sheet, and the permission block ends the page", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const h = await text(await sheet(env, s, FIRST, L0));
  const at = (id) => { const i = h.indexOf(`id="${id}"`); assert.ok(i > 0, id); return i; };
  const order = ["description", "procedure", "duration", "risks", "exclusion", "rights", "dataCollected", "storage", "whoUses", "publication", "retention", "controller", "withdraw", "supervisors"];
  assert.deepEqual(SHEET_ORDER.filter((k) => k !== "welcome"), order);
  const pos = order.map((k) => at(`s-${k}`));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "sections in order");
  assert.ok(h.indexOf("<h1>") < h.indexOf('class="sheet-sec sheet-welcome"') && h.indexOf('class="sheet-sec sheet-welcome"') < pos[0], "title, welcome, then the sections");
  assert.ok(at("s-consent") > pos[pos.length - 1], "the permission block comes last");
});

test("a field left empty prints the default and an edited one prints instead; line breaks are paragraphs; the heading names the study", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  const before = await text(await sheet(env, s, id, L0));
  assert.ok(before.includes(`<h1>${esc(SHEET[L0].titleDefault)}: `), "the default heading carries the title of the study");
  const r = await save(env, s, id, { [CONSENT_FORM("procedure", L0)]: "First paragraph.\n\nSecond paragraph.\r\nThird one.", [CONSENT_FORM("heading", L0)]: "My own heading" });
  assert.equal(code(r), "consent-saved");
  const after = await text(await sheet(env, s, id, L0));
  assert.ok(after.includes("<h1>My own heading</h1>"));
  const sec = /<section class="sheet-sec" id="s-procedure">([\s\S]*?)<\/section>/.exec(after)[1];
  assert.equal((sec.match(/<p>/g) || []).length, 3, "three paragraphs");
  assert.ok(sec.includes("<p>First paragraph.</p><p>Second paragraph.</p><p>Third one.</p>"));
  assert.ok(!sec.includes(consentDefaults(L0, { id, texts: {}, declarations: { epilepsy: false, vestibular: false } }).procedure.split("\n")[0]), "the edited text replaces the default");
  // The other fields and the other languages are untouched.
  assert.ok(after.includes(esc(resolveConsent(L0, { id, texts: {}, declarations: { epilepsy: false, vestibular: false } }).fields.duration)));
  for (const l of LANGS.slice(1)) assert.ok((await text(await sheet(env, s, id, l))).includes(`<h1>${esc(SHEET[l].titleDefault)}: `), `${l} still has its default`);
  // Emptying a field brings the default back.
  await save(env, s, id, {});
  assert.equal(await text(await sheet(env, s, id, L0)), before);
  assert.ok(!("consent" in storedJson(DB, id)), "a form that holds only the defaults stores no consent at all");
});

// ---- the permission block ---------------------------------------------------------------------------------------------------------
test("the permission block: researcher lines, the participant statement, optional permissions as empty boxes, date and signature", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  await save(env, s, id, { [CONSENT_FORM("perms", L0)]: "I agree to be photographed.\n\nI agree to be contacted again" });
  const h = await text(await sheet(env, s, id, L0));
  const blockHtml = /<section class="sheet-sec sheet-consent"[\s\S]*<\/section>/.exec(h)[0];
  const S = SHEET[L0];
  assert.ok(blockHtml.includes(`${esc(S.stmtPre)} <span class="sheet-blank"></span>${esc(S.stmtAdult)}`), "the statement with the legal-age clause");
  assert.ok(blockHtml.includes(S.researcher) && blockHtml.includes(S.printedName) && blockHtml.includes(S.date));
  assert.equal((blockHtml.match(/class="sheet-line"/g) || []).length, 6, "printed name, date and signature of the participant, then of the researcher");
  assert.ok(blockHtml.indexOf(S.participant) < blockHtml.indexOf(S.researcher), "the participant's block comes before the researcher's");
  assert.equal((blockHtml.match(/<li><span class="sheet-box" aria-hidden="true"><\/span>/g) || []).length, 2, "one empty box per permission");
  assert.ok(blockHtml.includes("I agree to be photographed.") && blockHtml.includes("I agree to be contacted again"));
  assert.ok(blockHtml.indexOf("sheet-statement") < blockHtml.indexOf("sheet-perms"), "statement, then the permissions");
  assert.doesNotMatch(h, /<input|<form|<select|<textarea|<button/i, "boxes are drawn with CSS, never form controls");
  // The two switches.
  await save(env, s, id, { [CONSENT_FORM("researcher", L0)]: "", [CONSENT_FORM("adult", L0)]: "" });
  const h2 = await text(await sheet(env, s, id, L0));
  const b2 = /<section class="sheet-sec sheet-consent"[\s\S]*<\/section>/.exec(h2)[0];
  assert.ok(!b2.includes(S.researcher) && (b2.match(/class="sheet-line"/g) || []).length === 3, "no researcher lines");
  assert.ok(b2.includes(esc(S.stmtNoAdult)) && !b2.includes(esc(S.stmtAdult)), "no legal-age clause");
  assert.ok(!b2.includes("sheet-perms"), "no permissions, no block");
  // The English sentence of the specification, word for word.
  assert.equal(`${SHEET.en.stmtPre} ______${SHEET.en.stmtAdult}`, "I, ______, have read this document, have been able to ask questions, am of legal age, and agree to take part in this study.");
});

// ---- the page ---------------------------------------------------------------------------------------------------------------------
test("the sheet is a self-contained page: security headers, no-store, noindex, no inline style or script, black on white, a hint to print and a link back", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const r = await sheet(env, s, FIRST, L0);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/html; charset=utf-8/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  for (const h of ["x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "strict-transport-security"]) assert.ok(r.headers.get(h), h);
  const h = await text(r);
  assert.doesNotMatch(h, /<script|<style|\sstyle=|\son[a-z]+=|javascript:/i, "no inline style or script");
  assert.match(h, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(h, /<meta name="color-scheme" content="light">/);
  assert.match(h, /<body class="sheet-page">/);
  assert.ok(h.includes('<link rel="stylesheet" href="/admin.css">') && !h.includes("/style.css"), "only the panel's stylesheet: no theme of the site is loaded");
  assert.ok(!/<nav|class="skip-link"|<header class="site-header"/.test(h), "no navigation");
  assert.ok(h.includes(esc(AT.consent.printHint)) && h.includes(esc(AT.consent.printHintTitle)), "the hint to print is in words");
  assert.ok(h.includes(`href="/admin?s=studies&amp;st=${FIRST}&amp;c=consent#consent-edit"`) && h.includes(esc(AT.consent.backToEditor)), "link back to the editor");
  assert.ok(h.includes(`<p class="sheet-lab">`), "the lab name as a small header");
  const css = readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  assert.match(css, /body\.sheet-page\{[^}]*background:#fff;color:#000/, "black on white whatever the theme");
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /@page\{size:A4;margin:/);
  assert.match(print, /\.sheet-screen\{display:none\}|\.sheet-screen\{display:none/);
  assert.match(print, /\.main-nav/);
  assert.match(print, /background:none!important/);
  assert.match(print, /break-inside:avoid/);
  assert.match(print, /\.sheet-consent/);
  assert.ok(!/@media \(prefers-color-scheme:dark\)\{[^}]*sheet/.test(css), "no dark variant for the sheet");
});

test("the route needs the session: anonymous requests go to the login, a forged or missing CSRF token does not save", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const anon = await call(env, req(sheetUrl(FIRST, L0)));
  assert.equal(anon.status, 303);
  assert.equal(loc(anon).pathname, "/admin");
  assert.equal((await anon.text()), "");
  const bad = await call(env, req(sheetUrl(FIRST, L0), { cookie: "sb_admin=forged" }));
  assert.equal(bad.status, 303);
  // A POST without the session is the "session expired" page, and without the token a 403; neither saves anything.
  const post = (fields, cookie) => call(env, req("/admin/do", { method: "POST", cookie, fields: { do: `consent-save:${FIRST}`, s: "studies", ...cblank(), ...fields } }));
  const cblank = () => cfields({ [CONSENT_FORM("heading", L0)]: "Should not be saved" });
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ csrf: "wrong" }, s.cookie)).status, 403);
  assert.equal((await post({}, s.cookie)).status, 403);
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM studies").get().n, 0);
  // With the token it saves.
  assert.equal(code(await post({ csrf: s.csrf }, s.cookie)), "consent-saved");
  assert.equal(storedJson(DB, FIRST).consent[L0].heading, "Should not be saved");
  // Only GET shows the sheet.
  assert.notEqual((await call(env, req(sheetUrl(FIRST, L0), { method: "POST", cookie: s.cookie, fields: { csrf: "x" } }))).status, 200);
});

test("an unknown study or language is a 404, whatever else is in the address", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  const bad = [
    "/admin/consent", `/admin/consent?study=${id}`, `/admin/consent?lang=${L0}`, `/admin/consent?study=&lang=${L0}`,
    `/admin/consent?study=nope&lang=${L0}`, `/admin/consent?study=${id}&lang=xx`, `/admin/consent?study=${id}&lang=`, `/admin/consent?study=${id}&lang=${L0.toUpperCase()}`,
    `/admin/consent?study=${id.toUpperCase()}&lang=${L0}`, `/admin/consent?study=../${id}&lang=${L0}`, `/admin/consent?study=${id}%00&lang=${L0}`,
    `/admin/consent?study=${encodeURIComponent("<script>")}&lang=${L0}`, `/admin/consent?study=${id}&lang=${encodeURIComponent("it'; --")}`,
    `/admin/consent?study=${id}${id}&lang=${L0}`, "/admin/consent?study[]=x&lang[]=y",
  ];
  for (const l of ["es", "en", "it"].filter((x) => !LANGS.includes(x))) bad.push(`/admin/consent?study=${id}&lang=${l}`);
  for (const u of bad) {
    const r = await call(env, req(u, { cookie: s.cookie }));
    assert.equal(r.status, 404, u);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.ok(r.headers.get("content-security-policy"), "headers on the 404 too");
    assert.doesNotMatch(await r.text(), /sheet-page|<script/, u);
  }
  assert.equal((await sheet(env, s, id, L0)).status, 200);
  assert.equal((await call(env, req(`/admin/consent/x?study=${id}&lang=${L0}`, { cookie: s.cookie }))).status, 404);
});

// ---- escaping ---------------------------------------------------------------------------------------------------------------------
test("every field is plain text on the sheet and in the editor: tags and quotes are escaped, 'javascript:' stays text", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  for (const f of CONSENT_FIELDS) {
    const mark = `[${f}]`;
    const oneLine = f === "heading" || f === "duration";
    const value = `${NASTY} ${mark}`;
    assert.ok(value.length < consentMax(f));
    assert.equal(code(await save(env, s, id, { [CONSENT_FORM(f, L0)]: value })), "consent-saved", f);
    const h = await text(await sheet(env, s, id, L0));
    assert.ok(h.includes(esc(value)), `${f}: escaped text on the sheet`);
    assert.ok(!h.includes("<img src=x") && !h.includes("<script>alert") && !h.includes("<b>bold"), `${f}: no raw markup`);
    assert.doesNotMatch(h, /<script|<img|<a [^>]*href="javascript/i, f);
    if (f === "heading") assert.ok(h.includes(`<title>${esc(value)}</title>`), "also in the title");
    const ed = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
    assert.ok(ed.includes(esc(value)), `${f}: escaped in the editor`);
    assert.ok(!ed.includes("<img src=x") && !/<script/i.test(ed.replace(/<script[^>]*src=/g, "")), `${f}: no raw markup in the editor`);
    assert.ok(oneLine || value.includes(" "), "multi-line fields take the same text");
  }
  // The permissions and a study name that is typed in the panel.
  await save(env, s, id, { [CONSENT_FORM("perms", L0)]: `${NASTY}\n"quoted" <i>x</i>` });
  const h = await text(await sheet(env, s, id, L0));
  assert.ok(h.includes(esc(NASTY)) && h.includes(esc(`"quoted" <i>x</i>`)));
  assert.doesNotMatch(h, /<i>x|<img|<script/i);
  // Nothing typed in a field becomes a key, a header or a path: the stored object has only known keys.
  assert.deepEqual(Object.keys(storedJson(DB, id).consent[L0]), [...CONSENT_FIELDS, "perms", "researcher", "adult", "researcherFirst"]);
});

test("the heading of a study with a hostile title is escaped, and the lab name is escaped in the header", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const r = await adminDo(env, s, "study-new", { s: "studies" });
  const id = loc(r).searchParams.get("st");
  const f = { s: "studies", name: "N", target: "" };
  for (const l of LANGS) Object.assign(f, { [`title_${l}`]: `<script>alert(9)</script> "t"`, [`lead_${l}`]: "", [`does_${l}`]: "", [`reqs_${l}`]: "" });
  await adminDo(env, s, `study-save:${id}`, f);
  for (const l of LANGS) {
    const h = await text(await sheet(env, s, id, l));
    assert.ok(h.includes(esc(`<script>alert(9)</script> "t"`)));
    assert.doesNotMatch(h, /<script/i);
  }
});

// ---- limits -----------------------------------------------------------------------------------------------------------------------
test("limits: each field accepts exactly its maximum and refuses one more, naming the field and the language, and a refusal writes nothing and keeps what was typed", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  assert.deepEqual({ ...CONSENT_LIMITS }, { heading: 160, duration: 200, text: 1500, perms: 6, perm: 300 });
  // a refused save answers with the same form (200), the error next to the field and an alert at the top
  const refused = async (r, field, typed) => {
    assert.equal(r.status, 200, `${field}: the form again, not a redirect`);
    const page = await text(r);
    assert.match(page, /<p class="error" role="alert">/, `${field}: an alert at the top`);
    assert.match(page, /<p class="error field-error" id="[^"]+-err">/, `${field}: the error next to the field`);
    assert.ok(new RegExp(`name="${field}"[^>]*aria-invalid="true"`).test(page), `${field}: the field is marked`);
    if (typed) assert.ok(page.includes(esc(typed)), `${field}: what was typed is still in the form`);
    return page;
  };
  for (const f of CONSENT_FIELDS) {
    const max = consentMax(f);
    assert.equal(max, f === "heading" ? 160 : f === "duration" ? 200 : 1500);
    const typed = "x".repeat(max + 1);
    const page = await refused(await save(env, s, FIRST, { [CONSENT_FORM(f, L0)]: typed }), CONSENT_FORM(f, L0), typed);
    assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM studies").get().n, 0, `${f}: nothing written, not even the copy of the configured studies`);
    assert.ok(page.includes(esc(AT.consent.fields[f])) && page.includes(esc(AT.langName[L0])), `${f}: the message names field and language`);
    assert.ok(page.includes(esc(AT.refuse.tooLong(max))), `${f}: and says the limit`);
  }
  for (const f of CONSENT_FIELDS) assert.equal(code(await save(env, s, FIRST, { [CONSENT_FORM(f, L0)]: "x".repeat(consentMax(f)) })), "consent-saved", `${f} at its maximum`);
  // The last language has its own limits too.
  const last = LANGS[LANGS.length - 1];
  await refused(await save(env, s, FIRST, { [CONSENT_FORM("risks", last)]: "y".repeat(1501) }), CONSENT_FORM("risks", last), "y".repeat(1501));
  // Permissions: six lines of 300, not seven, not 301.
  const lines = (n, len = 5) => Array.from({ length: n }, (_, i) => `p${i}`.padEnd(len, "x")).join("\n");
  await refused(await save(env, s, FIRST, { [CONSENT_FORM("perms", L0)]: lines(7) }), CONSENT_FORM("perms", L0), "p6xxx");
  await refused(await save(env, s, FIRST, { [CONSENT_FORM("perms", L0)]: lines(1, 301) }), CONSENT_FORM("perms", L0));
  assert.equal(code(await save(env, s, FIRST, { [CONSENT_FORM("perms", L0)]: lines(6, 300) })), "consent-saved");
  assert.equal(storedJson(DB, FIRST).consent[L0].perms.length, 6);
  assert.equal(code(await save(env, s, FIRST, { [CONSENT_FORM("perms", L0)]: `${lines(6)}\n\n   \n` })), "consent-saved", "blank lines do not count");
  // Control and bidirectional characters are removed; a one-line field cannot hold a line break.
  await save(env, s, FIRST, { [CONSENT_FORM("heading", L0)]: "a‮b\nc\u0000d", [CONSENT_FORM("welcome", L0)]: "one‮two\r\n\r\n\r\n\r\nthree" });
  const c = storedJson(DB, FIRST).consent[L0];
  assert.equal(c.heading, "a b c d");
  assert.ok(!/[‮\u0000\n]/.test(c.heading));
  assert.equal(c.welcome, "onetwo\n\nthree");
});

// ---- the stored shape and what else the edits touch -------------------------------------------------------------------------------
test("what is stored: only the known keys and languages, nothing for a group that holds the defaults, and the other saves keep it", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  assert.deepEqual(Object.keys(storedJson(DB, id)), ["name", "target", "archived", "declarations", "publicState", "texts"], "no consent key until somebody saves one");
  const extra = { "c_evil_es": "x", "c___proto___es": "y", "consent": "z", [CONSENT_FORM("heading", L0)]: "Kept" };
  assert.equal(code(await save(env, s, id, extra)), "consent-saved");
  const j = storedJson(DB, id);
  assert.deepEqual(Object.keys(j), ["name", "target", "archived", "declarations", "publicState", "texts", "consent"]);
  assert.deepEqual(Object.keys(j.consent), [L0], "only the language that differs from the defaults");
  assert.ok(!JSON.stringify(j).includes("evil"));
  // The study editor, archiving and restoring keep the consent form.
  const f = { s: "studies", name: "Renamed", target: "5" };
  for (const l of LANGS) Object.assign(f, { [`title_${l}`]: "", [`lead_${l}`]: "", [`does_${l}`]: "", [`reqs_${l}`]: "" });
  assert.equal(code(await adminDo(env, s, `study-save:${id}`, f)), "study-saved");
  assert.equal(storedJson(DB, id).consent[L0].heading, "Kept");
  assert.equal(code(await adminDo(env, s, `study-archive:${id}`, { s: "studies" })), "study-archived");
  assert.equal(storedJson(DB, id).consent[L0].heading, "Kept");
  assert.equal(code(await adminDo(env, s, `study-restore:${id}`, { s: "studies" })), "study-restored");
  assert.equal(storedJson(DB, id).consent[L0].heading, "Kept");
  // A stored value that does not fit is cut or dropped when it is read, never trusted.
  const p = parseStored(JSON.stringify({ consent: { [L0]: { heading: "H".repeat(500), welcome: 5, perms: "no", risks: "r".repeat(3000), researcher: "yes", evil: 1 }, xx: { heading: "no such language" }, [LANGS[0] === "es" ? "en" : "es"]: "text" } }));
  assert.deepEqual(Object.keys(p.consent), [L0]);
  assert.equal(p.consent[L0].heading.length, 160);
  assert.equal(p.consent[L0].risks.length, 1500);
  assert.deepEqual([p.consent[L0].welcome, p.consent[L0].perms, p.consent[L0].researcher, "evil" in p.consent[L0]], ["", [], true, false]);
  assert.equal(parseStored(JSON.stringify({ consent: "x" })).consent, undefined);
  assert.equal(JSON.parse(serialize(parseStored("{}"))).consent, undefined);
  // An unknown study id is "no such study".
  assert.equal(code(await adminDo(env, s, "consent-save:nope", { s: "studies", ...cfields() })), "study-gone");
  assert.equal(code(await adminDo(env, s, "consent-save:", { s: "studies", ...cfields() })), "study-gone");
  assert.equal(consentFromForm(new Map(), () => ({})).consent[L0].researcher, false, "a missing checkbox is off");
});

test("the consent texts never reach the public pages, the e-mails or the CSV exports", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s);
  const secret = "ZZ-consent-secret-ZZ";
  await save(env, s, id, Object.fromEntries(CONSENT_FIELDS.map((f) => [CONSENT_FORM(f, L0), f === "duration" || f === "heading" ? secret : `${secret} ${f}`])));
  for (const u of ["/", `/?lang=${L0}`, "/condiciones", "/privacidad"]) assert.ok(!(await text(await call(env, req(u)))).includes(secret), u);
  for (const u of ["/admin/csv", "/admin/csv-resumen", "/admin/csv-contactos"]) assert.ok(!(await text(await call(env, req(u, { cookie: s.cookie })))).includes(secret), u);
});

// ---- the editor ---------------------------------------------------------------------------------------------------------------------
test("the editor is a sub-view of the studies section with a link back, one group per configured language, the review note and a link to every sheet", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s, { epilepsy: true });
  const studies = await adminGet(env, s, `?s=studies&st=${id}`);
  assert.ok(studies.includes(`href="/admin?s=studies&amp;st=${id}&amp;c=consent#consent-edit"`), "the study page links to its consent form");
  assert.ok(!studies.includes('id="consent-edit"'));
  const ed = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  assert.ok(ed.includes('id="consent-edit"'));
  assert.ok(ed.includes(`href="/admin?s=studies&amp;st=${id}#studies-edit"`) && ed.includes(esc(AT.consent.back)), "link back to the study");
  assert.ok(ed.includes(esc(AT.consent.ethics)), "the note about the ethics committee or the data protection office");
  assert.equal((ed.match(/<fieldset class="lang-box">/g) || []).length, LANGS.length, "one group per configured language");
  for (const l of LANGS) {
    for (const f of CONSENT_FIELDS) assert.ok(ed.includes(`name="${CONSENT_FORM(f, l)}"`), `${f}_${l}`);
    for (const k of ["perms", "researcher", "researcherFirst", "adult"]) assert.ok(ed.includes(`name="${CONSENT_FORM(k, l)}"`), `${k}_${l}`);
    assert.ok(ed.includes(`href="/admin/consent?study=${id}&amp;lang=${l}"`), `link to the sheet in ${l}`);
    assert.ok(new RegExp(`id="cs-heading-${l}"[^>]*value="[^"]+"`).test(ed), "the heading field shows the text that would print");
  }
  assert.match(ed, /name="c_researcher_[a-z]+" value="1" checked/);
  assert.match(ed, /<form method="post" action="\/admin\/do"><input type="hidden" name="csrf"/);
  assert.ok(!ed.includes('id="st-name"'), "the study form is not on this page");
  assert.doesNotMatch(ed, /<script/i);
  // Under "all sections" the editor is not drawn (the page stays the usual one); a made-up study just shows the first study.
  assert.ok(!(await adminGet(env, s, `?s=all&st=${id}&c=consent`)).includes('id="consent-edit"'));
  assert.ok((await adminGet(env, s, `?s=studies&st=nope&c=consent`)).includes('id="consent-edit"'));
  // The saved values come back in the form.
  await save(env, s, id, { [CONSENT_FORM("risks", L0)]: "Saved risk text", [CONSENT_FORM("perms", L0)]: "One\nTwo", [CONSENT_FORM("researcher", L0)]: "" });
  const again = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  assert.ok(again.includes(">Saved risk text</textarea>") && again.includes(">One\nTwo</textarea>"));
  assert.doesNotMatch(again, new RegExp(`name="${CONSENT_FORM("researcher", L0)}" value="1" checked`));
  assert.ok(storedJson(DB, id).consent);
  // The message after saving is shown on the same sub-view.
  const r = await save(env, s, id, {});
  assert.equal(loc(r).searchParams.get("c"), "consent");
  assert.equal(loc(r).searchParams.get("st"), id);
  const msg = await text(await call(env, req(loc(r).pathname + loc(r).search, { cookie: s.cookie })));
  assert.ok(msg.includes(esc(AT.flash["consent-saved"])) && msg.includes('id="consent-edit"'));
});

test("consistency: the editor shows, read-only, what the public page states (session length, declarations, requirements)", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const id = await newStudy(env, s, { epilepsy: true, vestibular: true });
  const ed = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
  for (const l of LANGS) {
    assert.ok(ed.includes(esc(AT.consent.factMinutes(SESSION_MINUTES))));
    assert.ok(ed.includes(esc(AT.consent.factDecl(true, true))));
    assert.ok(ed.includes(esc(T[l].reqEpilepsy)) && ed.includes(esc(T[l].reqVestibular)), `${l}: the requirements the public page lists`);
  }
  const none = await newStudy(env, s);
  assert.ok((await adminGet(env, s, `?s=studies&st=${none}&c=consent`)).includes(esc(AT.consent.factDecl(false, false))));
  assert.ok(!(await adminGet(env, s, `?s=studies&st=${none}&c=consent`)).includes(esc(T[L0].reqEpilepsy)));
});

test("the epilepsy warning: shown when the booking form asks for the declaration and the sheet's exclusion does not mention epilepsy", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const warn = (html) => (html.match(/class="banner consent-warn"/g) || []).length;
  const id = await newStudy(env, s, { epilepsy: true });
  const ed = (qs = "") => adminGet(env, s, `?s=studies&st=${id}&c=consent${qs}`);
  // The default exclusion text already mentions it (in every language): no warning.
  assert.equal(warn(await ed()), 0);
  for (const l of LANGS) assert.match(resolveConsent(l, { id, texts: {}, declarations: { epilepsy: true, vestibular: false } }).fields.exclusion, /epilep|epiless/i, l);
  // An edited exclusion that leaves it out: a warning, in that language only.
  await save(env, s, id, { [CONSENT_FORM("exclusion", L0)]: "Nobody under 18." });
  let h = await ed();
  assert.equal(warn(h), 1);
  assert.ok(h.includes(esc(AT.consent.warnEpilepsy)));
  // The warning disappears when the text mentions it again, and does not depend on the case.
  await save(env, s, id, { [CONSENT_FORM("exclusion", L0)]: "People with EPILEPSY, EPILESSIA or epilepsia cannot take part." });
  assert.equal(warn(await ed()), 0);
  // Every language is checked on its own.
  const edits = Object.fromEntries(LANGS.map((l) => [CONSENT_FORM("exclusion", l), "Nothing special."]));
  await save(env, s, id, edits);
  assert.equal(warn(await ed()), LANGS.length);
  // A study that does not ask for the declaration has nothing to warn about.
  const other = await newStudy(env, s, { epilepsy: false });
  await save(env, s, other, Object.fromEntries(LANGS.map((l) => [CONSENT_FORM("exclusion", l), "Nothing special."])));
  assert.equal(warn(await adminGet(env, s, `?s=studies&st=${other}&c=consent`)), 0);
  assert.deepEqual(consentWarnings(L0, { id, texts: {}, declarations: { epilepsy: false, vestibular: true }, consent: { [L0]: { ...Object.fromEntries(CONSENT_FIELDS.map((f) => [f, ""])), exclusion: "x", perms: [], researcher: true, adult: true } } }), []);
});

test("the epilepsy warning and the default text work in Spanish, English and Italian", () => {
  const cfg = rawConfig();
  cfg.languages = ["es", "en", "it"]; cfg.adminLanguage = "es";
  const some = () => ({ es: "a", en: "a", it: "a" });
  cfg.place = { long: some(), short: some(), room: some() };
  cfg.hero = { creditHtml: null }; cfg.texts = {};
  const script = `
import assert from "node:assert/strict";
import { setup, adminSession, adminDo, adminGet, code, LANGS } from "./test-generic/helpers.mjs";
import { consentWarnings, resolveConsent, SHEET } from "./src/consent.js";
import { AT } from "./src/admin_texts.js";
assert.deepEqual([...LANGS], ["es", "en", "it"]);
const { env } = await setup();
const s = await adminSession(env);
const loc = (r) => new URL(r.headers.get("location"), "https://x.invalid");
const r = await adminDo(env, s, "study-new", { s: "studies" });
const id = loc(r).searchParams.get("st");
const f = { s: "studies", name: "N", target: "", epilepsy: "1" };
for (const l of LANGS) Object.assign(f, { ["title_" + l]: "", ["lead_" + l]: "", ["does_" + l]: "", ["reqs_" + l]: "" });
assert.equal(code(await adminDo(env, s, "study-save:" + id, f)), "study-saved");
const form = (o) => { const x = { s: "studies" }; for (const l of LANGS) for (const k of ["heading","welcome","description","procedure","duration","risks","exclusion","rights","dataCollected","storage","whoUses","publication","retention","controller","supervisors","withdraw","perms"]) x["c_" + k + "_" + l] = ""; for (const l of LANGS) { x["c_researcher_" + l] = "1"; x["c_adult_" + l] = "1"; } return { ...x, ...o }; };
const warns = (h) => (h.match(/consent-warn/g) || []).length;
const view = { id, texts: {}, declarations: { epilepsy: true, vestibular: false } };
for (const l of LANGS) {
  assert.deepEqual(consentWarnings(l, view), [], l + ": the default exclusion mentions epilepsy");
  assert.match(resolveConsent(l, view).fields.exclusion, /epilep|epiless/i, l);
}
for (const l of LANGS) {
  assert.equal(code(await adminDo(env, s, "consent-save:" + id, form({ ["c_exclusion_" + l]: "Nothing else." }))), "consent-saved");
  const h = await adminGet(env, s, "?s=studies&st=" + id + "&c=consent");
  assert.equal(warns(h), 1, l + ": exactly one warning");
  assert.ok(h.includes(AT.consent.warnEpilepsy), l);
  const word = { es: "epilepsia", en: "epilepsy", it: "epilessia" }[l];
  assert.equal(code(await adminDo(env, s, "consent-save:" + id, form({ ["c_exclusion_" + l]: "Not allowed: " + word + "." }))), "consent-saved");
  assert.equal(warns(await adminGet(env, s, "?s=studies&st=" + id + "&c=consent")), 0, l + ": gone with the word " + word);
}
for (const l of LANGS) assert.ok(SHEET[l].stmtAdult.length > 20);
console.log("ok");
`;
  const r = withConfig(cfg, script);
  assert.equal(r.status, 0, r.err + r.out);
  assert.match(r.out, /ok/);
});

// ---- nothing changes before the first save ----------------------------------------------------------------------------------------
test("while the studies table is empty the editor, the sheet and a refused save write nothing, and every public page is byte-identical", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const urls = ["/", `/?lang=${L0}`, ...LANGS.map((l) => `/?lang=${l}`), "/condiciones", "/privacidad", "/gestionar", "/baja"];
  const snap = async () => { const o = {}; for (const u of urls) { const r = await call(env, req(u)); o[u] = [r.status, [...r.headers].sort().join("|"), await r.text()]; } return o; };
  const before = await snap();
  const csvBefore = [];
  for (const u of ["/admin/csv", "/admin/csv-resumen", "/admin/csv-contactos"]) csvBefore.push(await text(await call(env, req(u, { cookie: s.cookie }))));
  await adminGet(env, s, `?s=studies&st=${FIRST}&c=consent`);
  for (const l of LANGS) await sheet(env, s, FIRST, l);
  await save(env, s, FIRST, { [CONSENT_FORM("risks", L0)]: "z".repeat(1501) });
  await adminDo(env, s, "consent-save:nope", { s: "studies", ...cfields() });
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM studies").get().n, 0, "no row");
  assert.deepEqual(await snap(), before, "public pages unchanged");
  const csvAfter = [];
  for (const u of ["/admin/csv", "/admin/csv-resumen", "/admin/csv-contactos"]) csvAfter.push(await text(await call(env, req(u, { cookie: s.cookie }))));
  assert.deepEqual(csvAfter, csvBefore, "exports unchanged");
  // The first save is what starts the new behaviour: the table gets the studies of the configuration plus the consent form.
  assert.equal(code(await save(env, s, FIRST, { [CONSENT_FORM("heading", L0)]: "First" })), "consent-saved");
  assert.deepEqual(studyRows(DB), C.twoStudies ? ["study1", "study2"] : ["study1"]);
  assert.equal(storedJson(DB, FIRST).consent[L0].heading, "First");
});

// ---- texts and docs ---------------------------------------------------------------------------------------------------------------
test("the panel texts of the consent form exist in both admin languages with the same shape", () => {
  const shape = (o) => Object.entries(o).map(([k, v]) => `${k}:${typeof v === "object" ? `{${shape(v)}}` : typeof v}`).join(",");
  assert.equal(shape(ADMIN_TEXT_SETS.es.consent), shape(ADMIN_TEXT_SETS.it.consent));
  for (const set of Object.values(ADMIN_TEXT_SETS)) {
    assert.deepEqual(Object.keys(set.consent.fields).sort(), [...CONSENT_FIELDS].sort());
    for (const k of ["consent-saved", "consent-perms"]) assert.ok(typeof set.flash[k] === "string" && set.flash[k].length > 10, k);
    assert.equal(typeof set.dyn["consent-long"], "function");
    assert.match(set.consent.ethics, /(comité|comitato)/i);
  }
  assert.match(ADMIN_TEXT_SETS.it.consent.intro, /turno|foglio/);
  for (const l of ["es", "en", "it"]) {
    assert.deepEqual(Object.keys(SHEET[l].sections).sort(), SHEET_ORDER.filter((k) => k !== "welcome").sort(), l);
    assert.deepEqual(Object.keys(BRACKETS[l]).sort(), Object.keys(BRACKETS.en).sort());
  }
});

test("the documentation covers the consent form: docs/consenso.md, the README sections and AGENTS.md", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const doc = read("docs/consenso.md");
  for (const w of ["/admin/consent", "punto di partenza", "comitato etico", "Stampa", "A4", "parentesi quadre", "epilessia", "dati personali"]) assert.ok(doc.includes(w), `docs/consenso.md mentions ${w}`);
  assert.ok(read("README.md").includes("docs/consenso.md") && read("README.it.md").includes("docs/consenso.md"));
  assert.ok(read("AGENTS.md").includes("src/consent.js") && read("AGENTS.md").includes("/admin/consent"));
  assert.ok(read("docs/studi.md").includes("consenso.md"));
});
