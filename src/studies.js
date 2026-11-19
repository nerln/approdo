// Studies managed from the admin panel: the shape of a stored study, its limits, how it is cleaned, how its texts are resolved
// against the built-in ones, and the numbers of its progress. Pure functions: the database side is in src/db.js.
//
// Everything a researcher types here is PLAIN TEXT. It is cleaned on the way in (control and bidirectional characters out), checked
// against the limits below, stored as JSON with a fixed set of keys (an unknown key is dropped, so nothing typed can become a key path),
// and escaped by whoever renders it (src/pages.js, src/admin.js, src/mail.js, the CSV helper).
import { C, LANGS, KNOWN_LANGS, declarationsFor } from "./config.js";
import { T } from "./i18n.js";
import { AT } from "./admin_texts.js";

// Limits of what the researcher STORES (a text left as the built-in one is stored as empty and has no limit).
export const LIMITS = Object.freeze({ name: 60, target: 9999, outside: 9999, title: 160, lead: 1200, does: 2000, req: 300, reqs: 20 });
export const TEXT_FIELDS = Object.freeze(["title", "lead", "does", "reqs"]);

// How a study is listed on the public page: "hidden" (not listed), "later", "done"; the active study always shows as "now".
export const PUBLIC_STATES = Object.freeze(["hidden", "later", "done"]);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// One line: control, format (bidi, zero-width) and line-separator characters become a space, runs of spaces collapse.
export const oneLine = (s) => String(s ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
// The form of a text for comparing it with the one the page would show anyway: line endings as "\n", whitespace around it removed.
export const normText = (s) => String(s ?? "").replace(/\r\n?|\u2028|\u2029/g, "\n").trim();
// A paragraph: line breaks are kept (as "\n"), every other control or format character is removed.
export const paragraph = (s) => String(s ?? "").replace(/\r\n?|\u2028|\u2029/g, "\n").replace(/[^\S\n]+/g, " ").replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// ---- the informed-consent form of a study (plain text, per language) ------------------------------------------------------------
// Stored as study.consent[lang] = { <field>: text, perms: [lines], researcher: bool, adult: bool, researcherFirst: bool }, and only for a
// language whose group holds something other than the defaults: while nobody has edited a consent form the stored JSON has no "consent"
// key at all. A field left empty prints the default text of src/consent.js; a field whose submitted text equals that default is stored empty.
export const CONSENT_FIELDS = Object.freeze(["heading", "welcome", "description", "procedure", "duration", "risks", "exclusion", "rights", "dataCollected", "storage", "whoUses", "publication", "retention", "controller", "supervisors", "withdraw"]);
export const CONSENT_LIMITS = Object.freeze({ heading: 160, duration: 200, text: 1500, perms: 6, perm: 300 });
export const consentMax = (f) => (f === "heading" ? CONSENT_LIMITS.heading : f === "duration" ? CONSENT_LIMITS.duration : CONSENT_LIMITS.text);
const ONE_LINE_FIELDS = new Set(["heading", "duration"]);
export const CONSENT_FORM = (name, lang) => `c_${name}_${lang}`;
const cleanConsentLang = (c) => {
  const t = isObj(c) ? c : {};
  const out = {};
  const str = (v) => (typeof v === "string" ? v : "");
  for (const f of CONSENT_FIELDS) out[f] = (ONE_LINE_FIELDS.has(f) ? oneLine(str(t[f])) : paragraph(str(t[f]))).slice(0, consentMax(f));
  out.perms = Array.isArray(t.perms) ? t.perms.map((r) => oneLine(str(r)).slice(0, CONSENT_LIMITS.perm)).filter(Boolean).slice(0, CONSENT_LIMITS.perms) : [];
  out.researcher = t.researcher !== false;
  out.adult = t.adult !== false;
  out.researcherFirst = t.researcherFirst === true;
  return out;
};
export const consentIsBlank = (c) => CONSENT_FIELDS.every((f) => !c[f]) && !c.perms.length && c.researcher && c.adult && !c.researcherFirst;
// The consent object to store: only the known languages, only the groups that differ from the defaults. undefined when there is nothing.
export function parseConsent(src) {
  if (!isObj(src)) return undefined;
  const out = {};
  for (const l of KNOWN_LANGS) {
    if (!isObj(src[l])) continue;
    const c = cleanConsentLang(src[l]);
    if (!consentIsBlank(c)) out[l] = c;
  }
  return Object.keys(out).length ? out : undefined;
}
// From the consent form of the panel. Nothing is cut: a text that is too long is refused. A field whose text equals the default one
// (defaultsOf(lang), after normalising line endings and the whitespace around it) is stored empty.
// { error: "long" | "perms", field: "<name>:<lang>" }.
export function consentFromForm(f, defaultsOf) {
  const get = (k) => String(f.get(k) ?? "");
  const out = {};
  for (const l of LANGS) {
    const c = {};
    const d = defaultsOf(l);
    for (const name of CONSENT_FIELDS) {
      const raw = get(CONSENT_FORM(name, l));
      let v = "";
      if (normText(raw) !== normText(d[name])) {
        v = ONE_LINE_FIELDS.has(name) ? oneLine(raw) : paragraph(raw);
        if (v === normText(d[name])) v = "";
        if (v.length > consentMax(name)) return { error: "long", field: `${name}:${l}` };
      }
      c[name] = v;
    }
    c.perms = get(CONSENT_FORM("perms", l)).split(/\r\n?|\n|\u2028|\u2029/).map(oneLine).filter(Boolean);
    if (c.perms.length > CONSENT_LIMITS.perms) return { error: "perms", field: `perms:${l}` };
    if (c.perms.some((r) => r.length > CONSENT_LIMITS.perm)) return { error: "long", field: `perms:${l}` };
    c.researcher = get(CONSENT_FORM("researcher", l)) === "1";
    c.adult = get(CONSENT_FORM("adult", l)) === "1";
    c.researcherFirst = get(CONSENT_FORM("researcherFirst", l)) === "1";
    out[l] = c;
  }
  return { consent: out };
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
// "s" plus 10 random base-36 characters (bytes above 251 are skipped so that every character is equally likely).
export function newStudyId() {
  let id = "s";
  while (id.length < 11) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 252 && id.length < 11) id += BASE36[b % 36];
    }
  }
  return id;
}
// The only shape an id can have in a request: nothing else is ever looked up.
export const isStudyId = (v) => typeof v === "string" && /^[A-Za-z0-9]{1,20}$/.test(v);

// ---- reading what is stored ---------------------------------------------------------------------------------------------
// Lenient: a stored value that does not fit is cut or dropped, never trusted. null = not a study at all (invalid JSON, not an object).
export function parseStored(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!isObj(o)) return null;
  const texts = {};
  const src = isObj(o.texts) ? o.texts : {};
  for (const l of KNOWN_LANGS) {
    const t = isObj(src[l]) ? src[l] : {};
    const reqs = Array.isArray(t.reqs) ? t.reqs.map((r) => oneLine(r).slice(0, LIMITS.req)).filter(Boolean).slice(0, LIMITS.reqs) : [];
    texts[l] = { title: oneLine(t.title).slice(0, LIMITS.title), lead: paragraph(t.lead).slice(0, LIMITS.lead), does: paragraph(t.does).slice(0, LIMITS.does), reqs };
  }
  const d = isObj(o.declarations) ? o.declarations : {};
  const consent = parseConsent(o.consent);
  return {
    name: oneLine(o.name).slice(0, LIMITS.name),
    target: Number.isInteger(o.target) && o.target >= 1 && o.target <= LIMITS.target ? o.target : null,
    archived: o.archived === true,
    outside: Number.isInteger(o.outside) && o.outside >= 1 && o.outside <= LIMITS.outside ? o.outside : 0,
    declarations: { epilepsy: d.epilepsy === true, vestibular: d.vestibular === true },
    ...(PUBLIC_STATES.includes(o.publicState) ? { publicState: o.publicState } : {}),
    texts,
    ...(consent ? { consent } : {}),
  };
}
// What is written to the database: only the known keys, in a fixed order.
export function serialize(s) {
  const consent = parseConsent(s.consent);
  return JSON.stringify({ name: s.name, target: s.target, archived: s.archived, ...(s.outside > 0 ? { outside: s.outside } : {}), declarations: { epilepsy: !!s.declarations.epilepsy, vestibular: !!s.declarations.vestibular }, ...(PUBLIC_STATES.includes(s.publicState) ? { publicState: s.publicState } : {}), texts: s.texts, ...(consent ? { consent } : {}) });
}
// The data of a view, to be written back (with the given changes).
// outside is carried like every other key: an unrelated save must never drop the number the researcher typed.
export const dataOf = (x, over = {}) => ({ name: x.name, target: x.target, archived: x.archived, outside: x.outside, declarations: x.declarations, publicState: x.publicState, texts: x.texts, consent: x.consent, ...over });

// The study as the rest of the code sees it. raw: the JSON exactly as stored (what an update compares against, see updateStudy in src/db.js).
export const toView = (id, position, data, updatedAt = "", raw = "") => ({ id, position, updatedAt, raw, ...data, name: data.name || id });

// ---- the texts a study falls back on ----------------------------------------------------------------------------------------
const builtIn = (lang, id) => { const S = T[lang]; return Object.hasOwn(S, id) && (id === "study1" || id === "study2") ? S[id] : S.study1; };
// The text the site shows for a study of the configuration (or the generic text, for any other study) when the study has none of its
// own: the configuration's text if it has one, else the built-in one. A study row stores only what differs from this.
export function fallbackTexts(lang, id) {
  const S = T[lang]; const s = builtIn(lang, id);
  return { title: S.title, lead: s.lead || S.lead, does: s.does, reqs: [...s.reqs] };
}
const emptyTexts = () => Object.fromEntries(LANGS.map((l) => [l, { title: "", lead: "", does: "", reqs: [] }]));

// How the configuration names its studies in the panel (the panel's own words, before anybody renames them).
const SN_ADMIN = C.studyName[C.adminLanguage] || C.studyName[LANGS[0]];
export const legacyName = (id) => (id === "study2" ? AT.set.study2 : C.twoStudies ? AT.set.study1 : SN_ADMIN.charAt(0).toUpperCase() + SN_ADMIN.slice(1));
export const defaultDeclarations = () => ({ epilepsy: C.declarations.epilepsy, vestibular: C.declarations.vestibular === "always" });

// The ids of the studies the configuration defines.
export const configIds = () => (C.twoStudies ? ["study1", "study2"] : ["study1"]);
export const isSeededId = (id) => configIds().includes(id);

// True while the studies are exactly the ones of the configuration with the names the panel gave them (nothing renamed, nothing added):
// then the exports and the notices name them the way they always did ("1", "2", "Study 1"), so that saving a study without changing it
// changes none of them.
export const usesConfigNames = (reg) => reg.studies.length === configIds().length && reg.studies.every((x) => isSeededId(x.id) && x.name === oneLine(legacyName(x.id)).slice(0, LIMITS.name));

// The studies the configuration defines, as they are written to the table by the first save: with EMPTY texts (the page keeps showing
// the configuration's texts), so that saving changes nothing nobody changed.
export function configStudies() {
  return configIds().map((id, i) => ({
    id, position: i + 1,
    data: { name: oneLine(legacyName(id)).slice(0, LIMITS.name), target: null, archived: false, declarations: declarationsFor(id), texts: emptyTexts() },
  }));
}
// A new study: no texts of its own (it shows the generic ones), not listed on the public page until the researcher lists it.
export function draftStudy(name) {
  return { name: oneLine(name).slice(0, LIMITS.name), target: null, archived: false, declarations: defaultDeclarations(), publicState: "hidden", texts: emptyTexts() };
}
// The generic texts a new study shows (the ones of the first study, which do not say "second").
export const genericTexts = () => Object.fromEntries(LANGS.map((l) => [l, fallbackTexts(l, "study1")]));

// ---- what the public page shows ---------------------------------------------------------------------------------------------
// The four texts of a study in one language; a field left empty falls back to the text of the configuration or the built-in one.
export function resolveTexts(lang, view) {
  const f = fallbackTexts(lang, view.id);
  const t = (view.texts && view.texts[lang]) || {};
  return { title: t.title || f.title, lead: t.lead || f.lead, does: t.does || f.does, reqs: t.reqs && t.reqs.length ? t.reqs : f.reqs };
}
// The study's own public title in one language ("" when it has none: the page then shows the generic title).
export const ownTitle = (view, lang) => (((view && view.texts && view.texts[lang]) || {}).title || "");

// ---- the public list of studies ------------------------------------------------------------------------------------------------
// The state of a seeded study nobody has set by hand: the one the page always had, by position (before the active study: done, after
// it: later). Any other study that has no state of its own is hidden.
export function autoPublicState(view, reg) {
  if (!isSeededId(view.id)) return "hidden";
  const at = reg.studies.findIndex((x) => x.id === view.id), act = reg.studies.findIndex((x) => x.id === reg.active);
  return at < act ? "done" : "later";
}
// "now" (the active study), or its state: the one stored, else the automatic one.
export const publicStateOf = (view, reg) => (view.id === reg.active ? "now" : view.publicState || autoPublicState(view, reg));
// The studies the public page lists: not archived, and the active one or any that is listed (not hidden).
export const publicStudies = (reg) => reg.studies.filter((x) => !x.archived && (x.id === reg.active || publicStateOf(x, reg) !== "hidden"));

// ---- what comes from the form ---------------------------------------------------------------------------------------------------
export const FIELD = (name, lang) => `${name}_${lang}`;
// The number of participants done outside the site, as typed: an integer 0 to 9999, empty meaning 0. null when it is anything else.
export function parseOutside(raw) {
  const t = String(raw ?? "").trim();
  if (t === "") return 0;
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n <= LIMITS.outside ? n : null;
}
export const nameTaken = (reg, id, name) => reg.studies.some((x) => x.id !== id && !x.archived && oneLine(x.name).toLowerCase() === name.toLowerCase());
// The edited study from the posted form, or { error, field } with the first thing that is wrong. Nothing is cut: a text that is too
// long is refused, so what is saved is what the researcher wrote. A text equal to the one the page shows anyway (the fallback, after
// normalising line endings and the whitespace around it) is stored as empty, and so is a public state equal to the automatic one: the
// first save changes nothing the researcher did not change. The limits apply to what is stored.
// error: "name" | "name-dup" | "target" | "outside" | "long" | "reqs".
export function studyFromForm(f, current, reg) {
  const get = (k) => String(f.get(k) ?? "");
  const name = oneLine(get("name"));
  if (!name || name.length > LIMITS.name) return { error: "name", field: "name" };
  if (!current.archived && nameTaken(reg, current.id, name)) return { error: "name-dup", field: "name" };
  const rawTarget = get("target").trim();
  let target = null;
  if (rawTarget !== "") {
    if (!/^\d{1,4}$/.test(rawTarget)) return { error: "target", field: "target" };
    target = Number(rawTarget);
    if (target < 1 || target > LIMITS.target) return { error: "target", field: "target" };
  }
  // Participants done outside the booking site. A form that does not send the field leaves the number as it is; an empty field is 0.
  let outside = current.outside || 0;
  const sentOutside = f.get("outside");
  if (sentOutside !== null && sentOutside !== undefined) {
    const parsed = parseOutside(sentOutside);
    if (parsed === null) return { error: "outside", field: "outside" };
    // The quick form is a second writer of this number. If the field still holds what the page was drawn with,
    // the researcher did not touch it, so the current value stays and a "+1" made meanwhile is not undone.
    const was = f.get("outside_was");
    if (was === null || was === undefined || parseOutside(was) !== parsed) outside = parsed;
  }
  const texts = {};
  for (const l of LANGS) {
    const fb = fallbackTexts(l, current.id);
    const one = (raw, fallback) => (normText(raw) === normText(fallback) ? "" : oneLine(raw));
    const many = (raw, fallback) => { if (normText(raw) === normText(fallback)) return ""; const v = paragraph(raw); return v === normText(fallback) ? "" : v; };
    const title = one(get(FIELD("title", l)), fb.title);
    const lead = many(get(FIELD("lead", l)), fb.lead);
    const does = many(get(FIELD("does", l)), fb.does);
    if (title.length > LIMITS.title) return { error: "long", field: `title:${l}` };
    if (lead.length > LIMITS.lead) return { error: "long", field: `lead:${l}` };
    if (does.length > LIMITS.does) return { error: "long", field: `does:${l}` };
    const rawReqs = get(FIELD("reqs", l));
    let reqs = [];
    if (normText(rawReqs) !== normText(fb.reqs.join("\n"))) {
      reqs = rawReqs.split(/\r\n?|\n|\u2028|\u2029/).map(oneLine).filter(Boolean);
      if (reqs.join("\n") === normText(fb.reqs.join("\n"))) reqs = [];
      else {
        if (reqs.length > LIMITS.reqs) return { error: "reqs", field: `reqs:${l}` };
        if (reqs.some((r) => r.length > LIMITS.req)) return { error: "long", field: `reqs:${l}` };
      }
    }
    texts[l] = { title, lead, does, reqs };
  }
  // The public state: a missing field leaves it as it is; a seeded study whose state equals the automatic one keeps following it.
  let publicState = current.publicState;
  const sent = get("public_state");
  if (PUBLIC_STATES.includes(sent)) publicState = isSeededId(current.id) && sent === autoPublicState(current, reg) ? undefined : sent;
  return { data: { name, target, archived: current.archived, outside, declarations: { epilepsy: get("epilepsy") === "1", vestibular: get("vestibular") === "1" }, publicState, texts, consent: current.consent } };
}

// ---- progress ---------------------------------------------------------------------------------------------------------------------
// counts: { attended, upcoming } of the study (see studyCounts in src/db.js). "Done" includes the sessions already purged, plus the
// participants the researcher says were done outside the site (view.outside, absent on a study that never had one).
export function progressOf(view, counts) {
  const site = (counts && counts.attended) || 0;
  const outside = view.outside > 0 ? view.outside : 0;
  const done = site + outside;
  const upcoming = (counts && counts.upcoming) || 0;
  const target = view.target;
  return { done, site, outside, upcoming, target, remaining: target ? Math.max(0, target - done) : null, pct: target ? Math.min(100, Math.floor((done * 100) / target)) : null };
}
