// The built-in texts must not state facts about a study they cannot know: nothing about the language of the application or of the
// questionnaires, and no mention of Spanish on any page or e-mail of a site that does not offer Spanish.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { C } from "../src/config.js";
import { LANGS, TESTED, DAY, A, RELAY, setup, call, req, text, book, relay, tokenFrom } from "./helpers.mjs";

const SPANISH = /espa[nñ]ol|spagnol|\bSpanish\b|castellano|castigliano/i;
const hasEs = LANGS.includes("es");
const opts = { skip: hasEs ? 'Spanish is one of the configured languages ("Español" is in the language switch)' : false };

test("no page or e-mail mentions Spanish when Spanish is not a configured language", opts, async () => {
  for (const mode of ["email", "instant"]) {
    const { DB, env } = await setup(RELAY);
    if (mode === "instant") await D.setSetting(DB, "confirm_mode", "instant");
    const m = relay();
    for (const lang of TESTED) {
      const pages = ["/", "/terms", "/privacy", "/manage", "/unsubscribe", "/condiciones", "/privacidad", "/gestionar", "/baja", "/nowhere", "/c/" + "a".repeat(30), "/x/" + "a".repeat(30)];
      for (const p of pages) {
        const html = await text(await call(env, req(`${p}?lang=${lang}`)));
        assert.ok(!SPANISH.test(html), `${mode} ${lang} ${p}: ${SPANISH.exec(html)?.[0]} in "${html.slice(Math.max(0, SPANISH.exec(html)?.index - 60), SPANISH.exec(html)?.index + 60)}"`);
      }
      const page = await text(await book(env, { slot: `${DAY}T${A}`, email: `neutral.${mode}.${lang}@example.org` }, { lang, fetchFn: m.fn }));
      assert.ok(!SPANISH.test(page), `${mode} ${lang}: booked page`);
      const token = tokenFrom(page);
      for (const k of ["c", "x"]) assert.ok(!SPANISH.test(await text(await call(env, req(`/${k}/${token}?lang=${lang}`)))), `${mode} ${lang}: /${k}/ page`);
      DB.raw.exec("DELETE FROM bookings");
    }
    for (const c of m.calls) if (c.json.to !== C.contactEmail) assert.ok(!SPANISH.test(`${c.json.subject}\n${c.json.text}\n${c.json.html}`), `${mode}: e-mail "${c.json.subject}"`);
  }
});

test("the terms say nothing about the language of the materials unless the lab wrote it", async () => {
  const { env } = await setup();
  for (const l of TESTED) {
    if (C.texts[l] && ("terms" in C.texts[l] || "termsMaterials" in C.texts[l])) continue;
    const terms = await text(await call(env, req(`/condiciones?lang=${l}`)));
    assert.ok(!/questionnaires? (are|is) in|questionari sono in|cuestionarios están en|in English|in inglese|en inglés/i.test(terms), l);
  }
});
