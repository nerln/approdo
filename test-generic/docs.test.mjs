// The documentation and the commented examples in the configuration files must stay true: every key is documented, the
// keys named in docs/testi.md exist, and the example blocks that a lab copies in actually load.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_TEXTS } from "../src/i18n.js";
import { rawConfig, withConfig } from "./helpers.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
// The example that site.config.js starts as a copy of. The tests about the shipped example read this fixed file, never the
// site.config.js of the folder (that one is the lab's own, and the suite may be running against it).
const EXAMPLE = "config/example-lab.config.js";

// A configuration that offers Italian and English whatever the suite runs against (the docs write both).
function itEn(extra = {}) {
  const c = rawConfig();
  c.languages = ["it", "en"]; c.adminLanguage = "it";
  const some = (o) => ({ it: "a", en: "a", ...o });
  c.place = { long: some(), short: some(), room: some() };
  c.hero = { creditHtml: null }; c.texts = {};
  return Object.assign(c, extra);
}
const loads = (texts) => withConfig(itEn(), `import { T } from "./src/i18n.js"; console.log(JSON.stringify({ it: T.it.title, en: T.en.title, lead: T.it.study1.lead }));`,
  `const c = ${JSON.stringify(itEn())}; c.texts = ${texts}; export default c;\n`);

test("the block to copy in docs/testi.md loads, and every text it rewrites is in the page", () => {
  const md = read("docs/testi.md");
  const block = /```js\n(texts: \{[\s\S]*?\n\},)\n```/.exec(md)?.[1];
  assert.ok(block, "docs/testi.md has the texts block");
  const r = loads(block.replace(/^texts: /, "").replace(/,$/, ""));
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out);
  assert.match(o.it, /^DA RISCRIVERE/);
  assert.match(o.en, /^TO REWRITE/);
});

test("the commented example of texts in the shipped example loads when uncommented", () => {
  for (const f of [EXAMPLE]) {
    const src = read(f);
    const m = /^  \/\/ texts: \{\n((?:  \/\/ .*\n)+?)  \/\/ \},\n/m.exec(src);
    assert.ok(m, `${f} has the commented example`);
    const body = m[1].replace(/^  \/\/ /gm, "");
    const r = loads(`{\n${body}}`);
    assert.equal(r.status, 0, `${f}: ${r.err}`);
    assert.match(JSON.parse(r.out).it, /lettura su schermo/);
  }
});

test("the shipped example describes every key, and the README table and docs/configurazione.md name them", () => {
  const keys = ["brand", "org", "responsible", "contactEmail", "baseUrl", "timeZone", "studyName", "minAdminPasswordLength", "languages", "adminLanguage", "sessionMinutes", "slotMinutes", "defaultTimes", "minNoticeHours", "shortNoticeMinutes", "daysAhead", "flexDefaultUntil", "place", "noLinkDomains", "bookingRetentionDays", "contactMonths", "hero", "texts", "declarations", "twoStudies", "privacyReviewed", "legacyPaths", "palette"];
  const readme = read("README.md"), conf = read("docs/configurazione.md");
  for (const f of [EXAMPLE]) {
    const src = read(f);
    // baseUrl is optional and shipped commented out; every other key is a live line
    for (const k of keys) assert.ok(new RegExp(`^  ${k === "baseUrl" ? "(// )?" : ""}${k}:`, "m").test(src), `${f} has the key ${k}`);
    for (const k of ["twoStudies", "declarations", "privacyReviewed", "legacyPaths"]) {
      const at = src.search(new RegExp(`^  ${k}:`, "m"));
      assert.ok(/^\s*\/\//.test(src.slice(src.lastIndexOf("\n", at - 2) + 1, at)), `${f}: ${k} is preceded by a comment`);
    }
  }
  for (const k of keys.filter((x) => !["org", "place", "hero"].includes(x))) {
    assert.ok(readme.includes(`\`${k}\``), `README names ${k}`);
    assert.ok(conf.includes(`\`${k}`), `docs/configurazione.md names ${k}`);
  }
  for (const k of ["org.group", "org.signature", "place.long", "hero.image", "hero.ogImage", "declarations.epilepsy", "declarations.vestibular"]) assert.ok(readme.includes(`\`${k}\``), `README names ${k}`);
});

test("docs/testi.md names only text keys that exist", () => {
  const md = read("docs/testi.md");
  const table = md.slice(md.indexOf("| Chiave |"), md.indexOf("Le frasi dell'informativa"));
  const cells = [...table.matchAll(/^\| ([^|]+) \|/gm)].map((m) => m[1]).filter((c) => c.includes("`"));
  const names = cells.flatMap((c) => [...c.matchAll(/`([A-Za-z0-9_.]+)`/g)].map((m) => m[1]));
  assert.ok(names.length > 25, `found ${names.length} keys`);
  for (const n of names) {
    const v = n.split(".").reduce((o, p) => (o && Object.hasOwn(o, p) ? o[p] : undefined), BUILTIN_TEXTS.it);
    assert.notEqual(v, undefined, `docs/testi.md names "${n}", which is not a text of src/i18n.js`);
  }
});

test("the README and AGENTS.md worked examples use the 50/60 case with three start times", () => {
  for (const f of ["README.md", "AGENTS.md"]) {
    const t = read(f);
    assert.ok(/sessionMinutes: 50`?,\s*`?slotMinutes: 60/.test(t), `${f} has the 50/60 example`);
    assert.ok(t.includes('defaultTimes: ["10:00", "11:00", "12:00"]'), `${f}: the example lists 10:00, 11:00 and 12:00`);
  }
});

test("AGENTS.md tells the agent to ask for every value, to read defaultTimes back and not to go on while the placeholder check fails", () => {
  const a = read("AGENTS.md");
  for (const re of [/Ask the human for every value/, /Read `defaultTimes` back/, /exactly the times he stated|exactly the two start\s+times he stated/, /do not continue while this fails/i, /scripts\/setup\.mjs --dry-run --no-tests/, /not a git repository/, /\bskipped\b/]) assert.match(a, re, String(re));
  assert.match(a, /fail` and `cancelled` must always be 0/);
});

test("the commented virtual-reality study block of the shipped example loads when uncommented and brings back the VR wording", () => {
  const src = read(EXAMPLE);
  const from = src.indexOf("  // studyName: {"), mid = src.indexOf("  // vrTexts (to put inside `texts`):"), to = src.indexOf("  // ===== TEXT OVERRIDES");
  assert.ok(from > 0 && mid > from && to > mid, "the block is there");
  const uncomment = (t) => t.split("\n").map((l) => l.replace(/^  \/\/ ?/, "")).join("\n");
  const top = uncomment(src.slice(from, mid)), vr = uncomment(src.slice(mid, to)).replace(/^vrTexts[^\n]*\n/, "");
  const cfg = itEn();
  const source = `const c = ${JSON.stringify(cfg)};\nObject.assign(c, { twoStudies: true, declarations: { epilepsy: true, vestibular: "study2" }, ${top}\ntexts: {\n${vr}\n} });\nexport default c;\n`;
  const r = withConfig(cfg, `import { T } from "./src/i18n.js"; import { C } from "./src/config.js"; import { tplConfirmRequest } from "./src/mail.js";
console.log(JSON.stringify({ it: T.it.title, en: T.en.title, does2: T.en.study2.does, image: C.hero.image, two: C.twoStudies, sub: tplConfirmRequest({ NOLINK_DOMAINS: "" }, { id: "b", token: "t".repeat(30), date: "2026-11-18", time: "10:00", name: "A", email: "a@example.org", lang: "en", expires_at: "2026-11-18T09:00:00.000Z", created_at: "2026-11-18T08:00:00.000Z" }).subject }));`, source);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out);
  assert.equal(o.it, "Partecipa a uno studio di realtà virtuale");
  assert.equal(o.en, "Take part in a virtual reality study");
  assert.match(o.does2, /swivel chair/);
  assert.equal(o.image, "/quest3.webp");
  assert.equal(o.two, true);
  assert.equal(o.sub, "Confirm your slot: virtual reality study");
});

test("the shipped example is a configuration that is not configured yet: it names invented examples, and only those are flagged", async () => {
  const { normalizeConfig } = await import("../src/config.js");
  const ex = (await import(`../${EXAMPLE}`)).default;
  const n = normalizeConfig(ex);
  for (const k of ["brand", "responsible", "contactEmail", "org.group", "org.university", "org.unit", "org.signature", "place.long.it", "place.long.en", "place.short.it", "place.room.en"]) assert.ok(n.unconfigured.includes(k), `${k} is flagged`);
  assert.ok(!n.unconfigured.includes("timeZone") && !n.unconfigured.includes("studyName"));
  assert.equal(n.baseUrl, null, "no baseUrl in the example");
  assert.equal(n.hero.image, null, "no photo in the example");
  assert.equal(n.twoStudies, false);
  assert.deepEqual({ ...n.declarations }, { epilepsy: false, vestibular: "never" });
  assert.deepEqual({ ...n.studyName }, { it: "studio di ricerca", en: "research study", es: "estudio de investigación" });
  // "org.university" and "org.unit" are per-language objects, so that the English pages are in English
  assert.equal(typeof ex.org.university, "object"); assert.equal(typeof ex.org.unit, "object");
  assert.notEqual(ex.org.university.en, ex.org.university.it);
});
