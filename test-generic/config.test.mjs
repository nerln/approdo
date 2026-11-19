// Configuration: defaults, validation errors, the language registry and text overrides.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { normalizeConfig, C, KNOWN_LANGS } from "../src/config.js";
import { rawConfig, withConfig, LANGS } from "./helpers.mjs";

const mutate = (f) => { const c = rawConfig(); f(c); return c; };
const rejects = (f, re) => assert.throws(() => normalizeConfig(mutate(f)), re);

test("the configuration the suite runs against loads and is normalised", () => {
  assert.ok(C.slotMinutes >= C.sessionMinutes);
  assert.ok(C.languages.length >= 1 && C.languages.every((l) => KNOWN_LANGS.includes(l)));
  assert.ok(C.defaultTimes.every((t) => /^\d\d:\d\d$/.test(t)));
  assert.deepEqual([...C.defaultTimes], [...C.defaultTimes].sort());
  assert.ok(C.baseUrl === null || !C.baseUrl.endsWith("/"), "baseUrl is optional (null) or has no trailing slash");
});

test("defaults are filled for the optional keys", () => {
  const c = rawConfig();
  for (const k of ["adminLanguage", "minNoticeHours", "shortNoticeMinutes", "daysAhead", "flexDefaultUntil", "noLinkDomains", "bookingRetentionDays", "contactMonths", "hero", "texts", "baseUrl", "studyName", "minAdminPasswordLength"]) delete c[k];
  const n = normalizeConfig(c);
  assert.equal(n.adminLanguage, "es");
  assert.equal(n.minNoticeHours, 12);
  assert.equal(n.shortNoticeMinutes, 20);
  assert.equal(n.daysAhead, 56);
  assert.equal(n.flexDefaultUntil, "17:00");
  assert.deepEqual([...n.noLinkDomains], []);
  assert.equal(n.bookingRetentionDays, 30);
  assert.equal(n.contactMonths, 24);
  assert.equal(n.hero.image, null, "no photo unless the configuration names one");
  assert.equal(n.baseUrl, null, "baseUrl is optional: links fall back on the origin of the request");
  assert.equal(n.minAdminPasswordLength, 16);
  assert.deepEqual({ ...n.studyName }, { es: "estudio de investigación", en: "research study", it: "studio di ricerca" });
});

test("studyName: a text for every language, or one per language; a language left out gets the generic name", () => {
  const n1 = normalizeConfig(mutate((c) => { c.studyName = "reading study"; }));
  assert.deepEqual({ ...n1.studyName }, { es: "reading study", en: "reading study", it: "reading study" });
  const n2 = normalizeConfig(mutate((c) => { c.studyName = { it: "studio sulla lettura", en: "reading study" }; c.languages = ["it", "en"]; c.place = { long: { it: "a", en: "a" }, short: { it: "a", en: "a" }, room: { it: "a", en: "a" } }; c.hero = { creditHtml: null }; c.texts = {}; }));
  assert.equal(n2.studyName.it, "studio sulla lettura");
  assert.equal(n2.studyName.en, "reading study");
  assert.equal(n2.studyName.es, "estudio de investigación", "a language that is left out gets the generic name");
  rejects((c) => { c.studyName = ""; }, /studyName/);
  rejects((c) => { c.studyName = { it: "" }; }, /studyName\.it/);
  rejects((c) => { c.studyName = ["x"]; }, /studyName/);
});

test("minAdminPasswordLength must be a whole number of at least 1", () => {
  rejects((c) => { c.minAdminPasswordLength = 0; }, /minAdminPasswordLength/);
  rejects((c) => { c.minAdminPasswordLength = "16"; }, /minAdminPasswordLength/);
  assert.equal(normalizeConfig(mutate((c) => { c.minAdminPasswordLength = 8; })).minAdminPasswordLength, 8);
});

test("baseUrl is optional; when given it must be a full address and loses its trailing slash", () => {
  assert.equal(normalizeConfig(mutate((c) => { delete c.baseUrl; })).baseUrl, null);
  assert.equal(normalizeConfig(mutate((c) => { c.baseUrl = "https://study.example.org///"; })).baseUrl, "https://study.example.org");
  rejects((c) => { c.baseUrl = "ftp://study.example.org"; }, /baseUrl/);
});

test("validation: slotMinutes smaller than sessionMinutes is refused, with both numbers in the message", () => {
  rejects((c) => { c.sessionMinutes = 50; c.slotMinutes = 40; }, /slotMinutes \(40\).*sessionMinutes \(50\)/);
});

test("validation: a default time that is not HH:MM is refused", () => {
  for (const bad of ["9:00", "25:00", "09:60", "noon", "09:00:00", 900]) rejects((c) => { c.defaultTimes = [bad]; }, /not a time in HH:MM/);
});

test("validation: two default times closer than slotMinutes are refused", () => {
  rejects((c) => { c.sessionMinutes = 50; c.slotMinutes = 60; c.defaultTimes = ["10:00", "10:59"]; }, /closer than slotMinutes \(60 minutes\)/);
  // exactly slotMinutes apart is fine
  assert.doesNotThrow(() => normalizeConfig(mutate((c) => { c.sessionMinutes = 50; c.slotMinutes = 60; c.defaultTimes = ["10:00", "11:00"]; })));
});

test("validation: unknown language, empty languages, wrong admin language", () => {
  rejects((c) => { c.languages = ["fr"]; }, /unknown language "fr"/);
  rejects((c) => { c.languages = []; }, /languages must not be empty/);
  rejects((c) => { c.languages = ["en", "en"]; }, /twice/);
  rejects((c) => { c.adminLanguage = "en"; }, /adminLanguage must be one of es, it/);
});

test("validation: time zone, e-mail, address, unknown key, place per language", () => {
  rejects((c) => { c.timeZone = "Mars/Olympus"; }, /not an IANA time zone/);
  rejects((c) => { c.contactEmail = "not-an-address"; }, /contactEmail/);
  rejects((c) => { c.baseUrl = "studio.example.org"; }, /baseUrl/);
  rejects((c) => { c.sesionMinutes = 10; }, /unknown key "sesionMinutes"/);
  rejects((c) => { delete c.place.long[c.languages[0]]; }, new RegExp(`place\\.long\\.${C.languages[0]}`));
  rejects((c) => { c.defaultTimes = ["23:30"]; c.sessionMinutes = 45; c.slotMinutes = 45; }, /end after midnight/);
});

test("the registry accepts Italian everywhere: languages, adminLanguage, place and texts", () => {
  const n = normalizeConfig(mutate((c) => {
    c.languages = ["it"]; c.adminLanguage = "it";
    c.place = { long: { it: "Via Esempio 1" }, short: { it: "Città" }, room: { it: "laboratorio" } };
    c.hero = { creditHtml: { it: "Foto" } };
    c.texts = { it: { title: "Titolo" } };
  }));
  assert.deepEqual([...n.languages], ["it"]);
  assert.equal(n.adminLanguage, "it");
});

const probe = (cfg, body) => withConfig(cfg, `import { C } from "./src/config.js"; import { T, MISSING_TEXTS } from "./src/i18n.js"; ${body}`);

test("texts overrides: dotted keys and nested objects both work, and function texts take {0} templates", () => {
  const lang = LANGS.find((l) => l === "en" || l === "es") || "en";
  const cfg = mutate((c) => {
    if (!c.languages.includes(lang)) c.languages.push(lang);
    c.place.long[lang] ??= "Somewhere"; c.place.short[lang] ??= "Somewhere"; c.place.room[lang] ??= "the room";
    if (c.hero && c.hero.creditHtml) c.hero.creditHtml[lang] ??= "credit";
    c.texts = { [lang]: { "study1.lead": "FLAT LEAD", study2: { lead: "NESTED LEAD" }, title: "MY TITLE", pendingP1: "Mail to {0}!" } };
  });
  const r = probe(cfg, `const S = T[${JSON.stringify(lang)}]; console.log(JSON.stringify([S.study1.lead, S.study2.lead, S.title, S.pendingP1("a@b"), S.study1.does.length > 10]));`);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), ["FLAT LEAD", "NESTED LEAD", "MY TITLE", "Mail to a@b!", true]);
});

test("texts overrides: an unknown key stops the site at load with a clear error", () => {
  const cfg = mutate((c) => { c.texts = { [c.languages[0]]: { "study1.leed": "x" } }; });
  const r = probe(cfg, "console.log('loaded')");
  assert.notEqual(r.status, 0);
  assert.match(r.err, /unknown text "study1\.leed"/);
});

test("a configuration error stops the site at load with the key name", () => {
  const cfg = mutate((c) => { c.slotMinutes = 1; c.sessionMinutes = 5; });
  const r = withConfig(cfg, `import "./src/app.js";`);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /site\.config\.js: slotMinutes/);
});

test("a language with no built-in texts yet is served in English instead of breaking", () => {
  const cfg = mutate((c) => {
    c.languages = ["it", "en"]; c.adminLanguage = "it";
    c.place = { long: { it: "a", en: "a" }, short: { it: "a", en: "a" }, room: { it: "a", en: "a" } };
    c.hero = { creditHtml: null }; c.texts = {};
  });
  const r = probe(cfg, `console.log(JSON.stringify([MISSING_TEXTS, T.it.title === T.en.title, T.it.switchLabel]));`);
  assert.equal(r.status, 0, r.err);
  const [missing, same, label] = JSON.parse(r.out);
  // once Italian texts exist MISSING_TEXTS becomes [] and the fallback is not used: both outcomes are valid
  assert.ok(Array.isArray(missing));
  if (missing.includes("it")) { assert.equal(same, true); assert.match(label, /Italiano/); }
});

test("a third language works end to end once it is configured: switch, hreflang, short paths, default and header choice", () => {
  const cfg = mutate((c) => {
    c.languages = ["it", "es", "en"]; c.adminLanguage = "it";
    const some = (o) => ({ it: "a", es: "a", en: "a", ...o });
    c.place = { long: some(), short: some(), room: some() };
    c.hero = { creditHtml: null }; c.texts = {};
  });
  const r = withConfig(cfg, readFileSync(new URL("./scripts/third-language.mjs", import.meta.url), "utf8"));
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out);
  assert.deepEqual(o.nav, ["it", "es", "en"]);
  assert.deepEqual(o.alt.filter((l) => l !== "x-default"), ["it", "es", "en"]);
  assert.deepEqual(o.locales, ["es_ES", "it_IT", "en_GB"]);
  assert.deepEqual(o.short, [302, 302, 302, 404]);
  assert.deepEqual(o.def, ["it", "it", "es", "en", "en"]);
  assert.equal(o.itPage, 200);
});

// ---- validation added with the study switches ------------------------------------------------------------------------
test("validation: hero.image and hero.ogImage are plain local paths", () => {
  for (const bad of ["photo.webp", "//evil.example/x.png", "/a/../b.png", "/a b.png", "/x.png?y=1", "/x\".png", "/<x>.png", "https://x.example/a.png", "/", 5]) {
    rejects((c) => { c.hero = { ...(c.hero || {}), image: bad }; }, /hero\.image/);
    rejects((c) => { c.hero = { ...(c.hero || {}), ogImage: bad }; }, /hero\.ogImage/);
  }
  for (const ok of ["/photo.webp", "/img/photo-1_a.b.png"]) assert.doesNotThrow(() => normalizeConfig(mutate((c) => { c.hero = { ...(c.hero || {}), image: ok, ogImage: ok }; })));
  assert.doesNotThrow(() => normalizeConfig(mutate((c) => { c.hero = { ...(c.hero || {}), ogImage: null }; })));
});

test("validation: a slot longer than 12 hours is refused", () => {
  rejects((c) => { c.sessionMinutes = 60; c.slotMinutes = 721; c.defaultTimes = ["08:00"]; }, /slotMinutes must be a whole number between 1 and 720/);
  assert.doesNotThrow(() => normalizeConfig(mutate((c) => { c.sessionMinutes = 60; c.slotMinutes = 720; c.defaultTimes = ["08:00"]; })));
});

test("declarations, twoStudies, privacyReviewed and legacyPaths: defaults and validation", () => {
  const c = rawConfig();
  for (const k of ["declarations", "twoStudies", "privacyReviewed", "legacyPaths"]) delete c[k];
  const n = normalizeConfig(c);
  assert.deepEqual({ ...n.declarations }, { epilepsy: true, vestibular: "study2" });
  assert.equal(n.twoStudies, true);
  assert.equal(n.privacyReviewed, false);
  assert.equal(n.legacyPaths, false);
  rejects((c) => { c.declarations = { epilepsy: "yes" }; }, /declarations\.epilepsy must be true or false/);
  rejects((c) => { c.declarations = { vestibular: "sometimes" }; }, /declarations\.vestibular must be "study2", "always" or "never"/);
  rejects((c) => { c.declarations = { epilepsia: true }; }, /declarations: unknown key "epilepsia"/);
  rejects((c) => { c.declarations = [true]; }, /declarations must be an object/);
  rejects((c) => { c.twoStudies = "no"; }, /twoStudies must be true or false/);
  rejects((c) => { c.privacyReviewed = 1; }, /privacyReviewed must be true or false/);
});

test("org.group, university, unit and signature accept a text or an object with one text per language", () => {
  const n = normalizeConfig(mutate((c) => {
    c.languages = ["it", "en"]; c.adminLanguage = "it";
    c.org = { group: { it: "Gruppo", en: "Group" }, university: "Uni", unit: { it: "Dip", en: "Dept" }, signature: { it: "Gruppo, Uni", en: "Group, Uni" } };
    c.place = { long: { it: "a", en: "a" }, short: { it: "a", en: "a" }, room: { it: "a", en: "a" } };
    c.hero = { creditHtml: null }; c.texts = {};
  }));
  assert.equal(n.orgBy.it.group, "Gruppo");
  assert.equal(n.orgBy.en.group, "Group");
  assert.equal(n.orgBy.en.university, "Uni", "a plain text is used for every language");
  assert.equal(n.orgBy.en.signature, "Group, Uni");
  assert.equal(n.orgBy.es.group, "Gruppo", "a language that is not public borrows the first public language");
  assert.equal(n.org.group, "Gruppo", "C.org is the first language's");
  rejects((c) => { c.languages = ["it", "en"]; c.org.group = { it: "Gruppo" }; }, /org\.group\.en must be a non-empty text/);
  rejects((c) => { c.org.group = 5; }, /org\.group must be a text or an object/);
  rejects((c) => { c.org.group = ""; }, /org\.group must be a non-empty text/);
  assert.doesNotThrow(() => normalizeConfig(mutate((c) => { c.org.unit = ""; })), "unit may be empty");
});

// ---- text overrides: no way to reach the prototype chain, one clear error for a language that is not served -----------
const loadFails = (texts, re) => {
  const r = probe(mutate((c) => { c.texts = { [c.languages[0]]: texts }; }), "console.log('loaded')");
  assert.notEqual(r.status, 0, `loaded with ${JSON.stringify(texts)}`);
  assert.match(r.err, re);
};
test("texts overrides: keys that name the prototype chain are refused", () => {
  loadFails({ "__proto__.toString": "x" }, /"__proto__\.toString" contains "__proto__", which is not allowed/);
  loadFails({ "study1.__proto__.lead": "x" }, /contains "__proto__"/);
  loadFails({ "constructor.prototype.polluted": "x" }, /contains "constructor"/);
  loadFails({ "study1.constructor": "x" }, /contains "constructor"/);
  loadFails({ prototype: "x" }, /contains "prototype"/);
});

test("texts overrides: the two words of the footer credit cannot be changed or blanked (the licence asks every site to keep that line)", () => {
  loadFails({ madeWith: "" }, /texts\.[a-z]{2}\.madeWith cannot be changed: it is part of the credit line/);
  loadFails({ madeBy: "" }, /texts\.[a-z]{2}\.madeBy cannot be changed/);
  loadFails({ madeWith: "Powered by" }, /madeWith cannot be changed/);
});

test("texts overrides: only own properties are walked, so inherited names are unknown texts", () => {
  loadFails({ toString: "x" }, /unknown text "toString"/);
  loadFails({ hasOwnProperty: "x" }, /unknown text "hasOwnProperty"/);
  loadFails({ "study1.toString": "x" }, /unknown text "study1\.toString"/);
  loadFails({ "toString.x": "x" }, /unknown text group "toString"/);
});

test("texts overrides: an own \"__proto__\" key in a nested object is refused and nothing is polluted", () => {
  const cfg = rawConfig();
  const lang = cfg.languages[0];
  const src = `const c = ${JSON.stringify(cfg)};\nc.texts = { ${JSON.stringify(lang)}: JSON.parse('{"study1":{"__proto__":{"lead":"POLLUTED"}}}') };\nexport default c;\n`;
  const r = withConfig(cfg, `import { T } from "./src/i18n.js"; console.log('loaded', ({}).lead);`, src);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /contains "__proto__"/);
  assert.ok(!/POLLUTED/.test(r.out));
  // the same source without the dangerous key loads, so the failure above is about the key
  const ok = withConfig(cfg, `import { T } from "./src/i18n.js"; console.log(JSON.stringify([({}).lead, T[${JSON.stringify(lang)}].study1.lead]));`, src.replace('{"study1":{"__proto__":{"lead":"POLLUTED"}}}', '{"study1":{"lead":"FINE"}}'));
  assert.equal(ok.status, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out), [null, "FINE"], "Object.prototype.lead is undefined (null in JSON) and the override applied");
});

test("texts: naming a language that is not in languages fails clearly", () => {
  const other = KNOWN_LANGS.find((l) => !C.languages.includes(l));
  if (!other) return;
  rejects((c) => { c.texts = { [other]: { title: "x" } }; }, new RegExp(`texts\\.${other}: "${other}" is not in languages`));
  rejects((c) => { c.texts = { fr: {} }; }, /texts: unknown language "fr"/);
  // and the text layer refuses it too, even if the validation of the configuration were bypassed
  const cfg = mutate((c) => { c.texts = {}; });
  const src = `const c = ${JSON.stringify(cfg)}; c.texts = { ${other}: { title: "x" } }; export default c;`;
  const r = withConfig(cfg, "import './src/i18n.js'; console.log('loaded')", src);
  assert.notEqual(r.status, 0);
  assert.match(r.err, new RegExp(`"${other}" is not in languages`));
});
