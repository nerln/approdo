// Site configuration: loads site.config.js (the ONLY file a lab edits), fills the defaults and validates it.
// Every other module reads the normalised object C exported here; nothing institution-specific lives in src/.
// A wrong value throws a clear Error when the module loads, so a bad configuration never reaches production.
import raw from "../site.config.js";
import { findPlaceholders } from "./placeholders.js";

// Public languages the template knows. A language needs built-in texts in src/i18n.js to be fully translated;
// until they exist the site serves the English texts for it (see MISSING_TEXTS in src/i18n.js).
//   label    text of the link in the language switch (always written in that language)
//   locale   Intl locale used to format dates
//   og       Open Graph locale
//   htmlLang value of <html lang>
//   family   primary subtags of Accept-Language that select this language
export const LANG_REGISTRY = {
  es: { label: "Español", locale: "es-ES", og: "es_ES", htmlLang: "es", family: ["es", "ca", "gl", "eu"] },
  en: { label: "English", locale: "en-GB", og: "en_GB", htmlLang: "en", family: ["en"] },
  it: { label: "Italiano", locale: "it-IT", og: "it_IT", htmlLang: "it", family: ["it"] },
};
export const KNOWN_LANGS = Object.keys(LANG_REGISTRY);
export const ADMIN_LANGS = ["es", "it"];

const KEYS = new Set([
  "brand", "org", "responsible", "contactEmail", "baseUrl", "timeZone", "languages", "adminLanguage",
  "sessionMinutes", "slotMinutes", "defaultTimes", "minNoticeHours", "shortNoticeMinutes", "daysAhead", "flexDefaultUntil",
  "place", "noLinkDomains", "bookingRetentionDays", "contactMonths", "hero", "texts",
  "declarations", "twoStudies", "privacyReviewed", "legacyPaths", "usageCount", "studyName", "minAdminPasswordLength", "accent", "palette",
]);
// The default accent colour of the design (a petroleum green); a lab sets its own with the key "accent" in site.config.js.
export const DEFAULT_ACCENT = "#246b5c";
// The two built-in palettes: "paper" (warm paper, marine ink; the default) and "theatre" (cream paper, warm near-black ink, a full-width
// band in the accent colour on the landing page).
export const PALETTES = Object.freeze(["paper", "theatre"]);
export const HERO_ARTS = Object.freeze(["contour", "hologram"]);
// How the study is named when a configuration does not say (e-mail subjects, calendar title, invitation, built-in texts).
export const DEFAULT_STUDY_NAME = Object.freeze({ es: "estudio de investigación", en: "research study", it: "studio di ricerca" });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (msg) => { throw new Error(`site.config.js: ${msg}`); };

const str = (v, name, { empty = false } = {}) => {
  if (typeof v !== "string" || (!empty && !v.trim())) fail(`${name} must be a non-empty text`);
  return v.trim();
};
const int = (v, name, min, max = Infinity) => {
  if (!Number.isInteger(v) || v < min || v > max) fail(`${name} must be a whole number${max === Infinity ? ` of at least ${min}` : ` between ${min} and ${max}`} (got ${JSON.stringify(v)})`);
  return v;
};
const withDefault = (o, k, d) => (o[k] === undefined ? d : o[k]);
// A local file path for an image: starts with one "/", only safe characters, no "//" (a web address without a scheme) and no "..".
const safePath = (v) => typeof v === "string" && /^\/[\w.\/-]+$/.test(v) && !v.includes("//") && !v.split("/").includes("..");

// One text per configured language, e.g. place.long = { it: "...", en: "..." }.
function perLang(v, name, langs) {
  if (!isObj(v)) fail(`${name} must be an object with one text per language (${langs.join(", ")})`);
  const out = {};
  for (const l of langs) out[l] = str(v[l], `${name}.${l}`);
  return out;
}

export function normalizeConfig(input) {
  if (!isObj(input)) fail("the file must export default an object");
  for (const k of Object.keys(input)) if (!KEYS.has(k)) fail(`unknown key "${k}" (check the spelling; the allowed keys are listed at the top of site.config.js)`);

  // ---- languages -------------------------------------------------------------
  if (!Array.isArray(input.languages)) fail('languages must be a list such as ["it", "en"]');
  if (!input.languages.length) fail("languages must not be empty: list at least one language");
  for (const l of input.languages) if (!KNOWN_LANGS.includes(l)) fail(`unknown language ${JSON.stringify(l)} in languages (allowed: ${KNOWN_LANGS.join(", ")})`);
  if (new Set(input.languages).size !== input.languages.length) fail("languages lists the same language twice");
  const languages = [...input.languages];
  const adminLanguage = withDefault(input, "adminLanguage", "es");
  if (!ADMIN_LANGS.includes(adminLanguage)) fail(`adminLanguage must be one of ${ADMIN_LANGS.join(", ")} (got ${JSON.stringify(adminLanguage)})`);

  // ---- identity --------------------------------------------------------------
  const org = input.org;
  if (!isObj(org)) fail("org must be an object { group, university, unit, signature }");
  // Each org field is a text or an object with one text per configured language.
  const orgField = (v, name, { empty = false } = {}) => {
    if (typeof v === "string") return Object.fromEntries(KNOWN_LANGS.map((l) => [l, str(v, name, { empty })]));
    if (!isObj(v)) fail(`${name} must be a text or an object with one text per language (${languages.join(", ")})`);
    const own = Object.fromEntries(languages.map((l) => [l, str(v[l], `${name}.${l}`, { empty })]));
    // A language that is not public (the admin language, for instance) borrows the first public language's text.
    return Object.fromEntries(KNOWN_LANGS.map((l) => [l, own[l] ?? own[languages[0]]]));
  };
  const orgFields = { group: orgField(org.group, "org.group"), university: orgField(org.university, "org.university"), unit: orgField(withDefault(org, "unit", ""), "org.unit", { empty: true }), signature: orgField(org.signature, "org.signature") };
  const orgBy = Object.fromEntries(KNOWN_LANGS.map((l) => [l, Object.freeze(Object.fromEntries(Object.entries(orgFields).map(([k, v]) => [k, v[l]])))]));
  const orgOut = orgBy[languages[0]];
  const contactEmail = str(input.contactEmail, "contactEmail");
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(contactEmail)) fail(`contactEmail is not an e-mail address (got ${JSON.stringify(contactEmail)})`);
  // baseUrl is optional: without it (and without the BASE_URL variable) the links are built from the address of the request.
  let baseUrl = withDefault(input, "baseUrl", null);
  if (baseUrl !== null) {
    baseUrl = str(baseUrl, "baseUrl");
    try { if (!/^https?:$/.test(new URL(baseUrl).protocol)) throw new Error("scheme"); } catch { fail(`baseUrl must be a full web address such as https://study.example.org, or left out (got ${JSON.stringify(baseUrl)})`); }
    baseUrl = baseUrl.replace(/\/+$/, "");
  }
  const timeZone = str(input.timeZone, "timeZone");
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { fail(`timeZone ${JSON.stringify(timeZone)} is not an IANA time zone such as Europe/Rome`); }

  // ---- durations and slots -----------------------------------------------------
  const sessionMinutes = int(input.sessionMinutes, "sessionMinutes", 1, 1440);
  const slotMinutes = int(input.slotMinutes, "slotMinutes", 1, 720); // 12 hours: a longer booking cannot be a sensible lab session
  if (slotMinutes < sessionMinutes) fail(`slotMinutes (${slotMinutes}) must be at least sessionMinutes (${sessionMinutes}): a booking cannot occupy less calendar time than the session lasts`);
  if (!Array.isArray(input.defaultTimes) || !input.defaultTimes.length) fail('defaultTimes must be a non-empty list such as ["10:00", "11:00"]');
  if (input.defaultTimes.length > 12) fail("defaultTimes can have at most 12 start times");
  for (const t of input.defaultTimes) if (typeof t !== "string" || !TIME.test(t)) fail(`defaultTimes: ${JSON.stringify(t)} is not a time in HH:MM format (00:00 to 23:59)`);
  const defaultTimes = [...new Set(input.defaultTimes)].sort();
  if (defaultTimes.length !== input.defaultTimes.length) fail("defaultTimes lists the same time twice");
  for (let i = 1; i < defaultTimes.length; i++) {
    if (toMin(defaultTimes[i]) - toMin(defaultTimes[i - 1]) < slotMinutes) fail(`defaultTimes: ${defaultTimes[i - 1]} and ${defaultTimes[i]} are closer than slotMinutes (${slotMinutes} minutes), so the two bookings would overlap`);
  }
  const lastT = defaultTimes[defaultTimes.length - 1];
  if (toMin(lastT) + slotMinutes > 1440) fail(`defaultTimes: a booking at ${lastT} would end after midnight (slotMinutes is ${slotMinutes})`);
  const flexDefaultUntil = withDefault(input, "flexDefaultUntil", "17:00");
  if (typeof flexDefaultUntil !== "string" || !TIME.test(flexDefaultUntil)) fail(`flexDefaultUntil must be a time in HH:MM format (got ${JSON.stringify(flexDefaultUntil)})`);

  // ---- place, mail filters, retention ------------------------------------------
  if (!isObj(input.place)) fail("place must be an object { long, short, room }");
  const place = { long: perLang(input.place.long, "place.long", languages), short: perLang(input.place.short, "place.short", languages), room: perLang(input.place.room, "place.room", languages) };
  const noLinkDomains = withDefault(input, "noLinkDomains", []);
  if (!Array.isArray(noLinkDomains) || !noLinkDomains.every((d) => typeof d === "string")) fail('noLinkDomains must be a list of e-mail domains such as ["example.edu"] (or [])');

  // ---- landing photo --------------------------------------------------------------
  const hero0 = withDefault(input, "hero", {});
  if (!isObj(hero0)) fail("hero must be an object { image, width, height, creditHtml, art }");
  const image = withDefault(hero0, "image", null);
  if (image !== null && !safePath(image)) fail(`hero.image must be null (no photo) or a local path inside public/ such as "/photo.webp" (letters, digits, "." "-" "_" and "/"; got ${JSON.stringify(image)})`);
  const ogImage = withDefault(hero0, "ogImage", null);
  if (ogImage !== null && !safePath(ogImage)) fail(`hero.ogImage must be null or a local path inside public/ such as "/og.png" (got ${JSON.stringify(ogImage)})`);
  let creditHtml = withDefault(hero0, "creditHtml", null);
  if (creditHtml !== null) creditHtml = perLang(creditHtml, "hero.creditHtml", languages);
  // hero.art: the drawing that stands in the art area of the landing page: "contour" (a quiet line drawing, the default; the photo
  // takes its place when hero.image is set) or "hologram" (the decorative menu drawn over the photo, with its one-shot animation).
  const art = withDefault(hero0, "art", "contour");
  if (!HERO_ARTS.includes(art)) fail(`hero.art must be one of ${HERO_ARTS.map((a) => `"${a}"`).join(", ")} (got ${JSON.stringify(art)})`);
  const hero = { art, image, width: int(withDefault(hero0, "width", 1040), "hero.width", 1), height: int(withDefault(hero0, "height", 551), "hero.height", 1), ogImage, creditHtml };

  // ---- accent colour: exactly #rrggbb (the stylesheet /theme.css is built from it; nothing else may reach a stylesheet) ----------
  const accent0 = withDefault(input, "accent", DEFAULT_ACCENT);
  if (typeof accent0 !== "string" || !/^#[0-9a-fA-F]{6}$/.test(accent0)) fail(`accent must be a colour written as #rrggbb, for example "#246b5c" (got ${JSON.stringify(accent0)})`);
  const accent = accent0.toLowerCase();
  const palette = withDefault(input, "palette", "paper");
  if (!PALETTES.includes(palette)) fail(`palette must be one of ${PALETTES.map((p) => `"${p}"`).join(", ")} (got ${JSON.stringify(palette)})`);

  // ---- text overrides: validated against the built-in texts in src/i18n.js --------
  const texts = withDefault(input, "texts", {});
  if (!isObj(texts)) fail("texts must be an object { es: {...}, en: {...}, it: {...} }");
  for (const [l, v] of Object.entries(texts)) {
    if (!KNOWN_LANGS.includes(l)) fail(`texts: unknown language ${JSON.stringify(l)} (allowed: ${KNOWN_LANGS.join(", ")})`);
    if (!languages.includes(l)) fail(`texts.${l}: "${l}" is not in languages (${languages.join(", ")}), so these texts would never be shown. Add the language to languages or delete texts.${l}`);
    if (!isObj(v)) fail(`texts.${l} must be an object of overrides`);
  }

  // ---- study-specific switches -----------------------------------------------------
  const decl0 = withDefault(input, "declarations", {});
  if (!isObj(decl0)) fail("declarations must be an object { epilepsy, vestibular }");
  for (const k of Object.keys(decl0)) if (!["epilepsy", "vestibular"].includes(k)) fail(`declarations: unknown key "${k}" (allowed: epilepsy, vestibular)`);
  const epilepsy = withDefault(decl0, "epilepsy", true);
  if (typeof epilepsy !== "boolean") fail(`declarations.epilepsy must be true or false (got ${JSON.stringify(epilepsy)})`);
  const vestibular = withDefault(decl0, "vestibular", "study2");
  if (!["study2", "always", "never"].includes(vestibular)) fail(`declarations.vestibular must be "study2", "always" or "never" (got ${JSON.stringify(vestibular)})`);
  // The name of the study, per language: a text (all languages), an object with a text per language (a language left out gets the generic name), or nothing.
  const sn0 = input.studyName;
  let studyName = { ...DEFAULT_STUDY_NAME };
  if (typeof sn0 === "string") studyName = Object.fromEntries(KNOWN_LANGS.map((l) => [l, str(sn0, "studyName")]));
  else if (sn0 !== undefined) {
    if (!isObj(sn0)) fail(`studyName must be a text or an object with one text per language (${languages.join(", ")})`);
    // A language the object leaves out gets the generic name of that language.
    studyName = Object.fromEntries(KNOWN_LANGS.map((l) => [l, sn0[l] === undefined ? DEFAULT_STUDY_NAME[l] : str(sn0[l], `studyName.${l}`)]));
  }
  const bool = (k, d) => { const v = withDefault(input, k, d); if (typeof v !== "boolean") fail(`${k} must be true or false (got ${JSON.stringify(v)})`); return v; };

  const out = {
    brand: str(input.brand, "brand"), org: orgOut, orgBy: Object.freeze(orgBy), responsible: str(input.responsible, "responsible"),
    contactEmail, baseUrl, timeZone, languages: Object.freeze(languages), adminLanguage,
    sessionMinutes, slotMinutes, defaultTimes: Object.freeze(defaultTimes),
    minNoticeHours: int(withDefault(input, "minNoticeHours", 12), "minNoticeHours", 0, 24 * 30),
    shortNoticeMinutes: int(withDefault(input, "shortNoticeMinutes", 20), "shortNoticeMinutes", 0, 24 * 60),
    daysAhead: int(withDefault(input, "daysAhead", 56), "daysAhead", 1, 366),
    flexDefaultUntil, place: Object.freeze(place), noLinkDomains: Object.freeze(noLinkDomains.map((d) => d.trim()).filter(Boolean)),
    bookingRetentionDays: int(withDefault(input, "bookingRetentionDays", 30), "bookingRetentionDays", 1, 3650),
    contactMonths: int(withDefault(input, "contactMonths", 24), "contactMonths", 1, 120),
    hero: Object.freeze(hero), accent, palette, texts: Object.freeze(texts),
    declarations: Object.freeze({ epilepsy, vestibular }), twoStudies: bool("twoStudies", true),
    privacyReviewed: bool("privacyReviewed", false), legacyPaths: bool("legacyPaths", false), usageCount: bool("usageCount", true),
    studyName: Object.freeze(studyName), minAdminPasswordLength: int(withDefault(input, "minAdminPasswordLength", 16), "minAdminPasswordLength", 1, 1024),
  };
  // The keys that still hold the shipped example values (see src/placeholders.js). While there are any the site shows
  // "not configured yet" instead of the booking form, and the admin set-up checklist lists them.
  out.unconfigured = Object.freeze(findPlaceholders(out).map((p) => p.key));
  return Object.freeze(out);
}

export const C = normalizeConfig(raw);

// ---- language helpers (the registry restricted to the configured languages) ----------
export const LANGS = C.languages;
export const DEFAULT_LANG = LANGS[0];
export const isLang = (l) => LANGS.includes(l);
// A stored or submitted language code, forced to a configured language.
export const normLang = (l) => (isLang(l) ? l : DEFAULT_LANG);

// The organisation names in one language (a language that is not configured borrows the default language's names).
export const orgFor = (lang) => C.orgBy[lang] || C.orgBy[DEFAULT_LANG];
// Which declarations the booking form asks for, given the study being booked (always "study1" when twoStudies is false).
export function declarationsFor(study) {
  const s = C.twoStudies ? study : "study1";
  const v = C.declarations.vestibular;
  return { epilepsy: C.declarations.epilepsy, vestibular: v === "always" || (v === "study2" && s === "study2") };
}
