// The study-specific switches of the configuration: declarations { epilepsy, vestibular }, twoStudies and privacyReviewed.
// Every test reads the switches from C, so each configuration (the shipped example and the variants in config/test-variants/)
// proves its own combination: what is switched off has no checkbox, no server-side check, no requirement line and no
// mention in the terms or the privacy text; what is switched on is checked on the server as well.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { declarationsFor } from "../src/config.js";
import { esc } from "../src/util.js";
import { T, BUILTIN_TEXTS } from "../src/i18n.js";
import { tplAdmin } from "../src/mail.js";
import { ADMIN_TEXT_SETS, AT } from "../src/admin_texts.js";
import { C, DAY, A, NOW, TESTED, setup, call, req, text, book, bookFields, rows, adminSession, adminDo, adminGet, relay, RELAY } from "./helpers.mjs";

const STUDIES = C.twoStudies ? ["study1", "study2"] : ["study1"];
const plain = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'");
const EPI = /epilep|epilessi/i, VEST = /vestib/i;

test("declarationsFor follows the configuration", () => {
  for (const study of ["study1", "study2"]) {
    const d = declarationsFor(study);
    assert.equal(d.epilepsy, C.declarations.epilepsy);
    const v = C.declarations.vestibular;
    assert.equal(d.vestibular, v === "always" || (v === "study2" && C.twoStudies && study === "study2"));
  }
});

for (const study of STUDIES) {
  for (const lang of TESTED) {
    test(`[${lang}, ${study}] the form, the requirements and the legal pages show exactly the declarations that are on`, async () => {
      const { DB, env } = await setup();
      await D.setSetting(DB, "active_study", study);
      const d = declarationsFor(study);
      const home = await text(await call(env, req(`/?lang=${lang}`)));
      assert.equal(/name="noepi"/.test(home), d.epilepsy, "epilepsy checkbox");
      assert.equal(/name="vestibular"/.test(home), d.vestibular, "vestibular checkbox");
      const from = home.indexOf(`<h2>${T[lang].reqH}</h2>`);
      // The card lists the study's own requirements and the declarations that are on; with none of them there is no card.
      const own = T[lang][study].reqs;
      if (!own.length && !d.epilepsy && !d.vestibular) assert.equal(from, -1, "no requirements, no card");
      else {
        assert.ok(from > 0, "the requirements card");
        const reqs = plain(home.slice(from, home.indexOf("</section>", from)));
        assert.equal(reqs.includes(T[lang].reqEpilepsy), d.epilepsy, "epilepsy requirement line");
        assert.equal(reqs.includes(T[lang].reqVestibular.replace(/'/g, "'")), d.vestibular, "vestibular requirement line");
        for (const r of own) assert.ok(reqs.includes(r), "the study's own requirement stays");
      }
      // The terms and the privacy text follow the configuration (not the study): vestibular "study2" is named when two studies exist.
      const terms = plain(await text(await call(env, req(`/condiciones?lang=${lang}`))));
      const priv = plain(await text(await call(env, req(`/privacidad?lang=${lang}`))));
      const v = C.declarations.vestibular;
      const vestNamed = v === "always" || (v === "study2" && C.twoStudies);
      assert.equal(EPI.test(terms), C.declarations.epilepsy, "epilepsy in the terms");
      assert.equal(VEST.test(terms), vestNamed, "vestibular in the terms");
      assert.equal(EPI.test(priv), C.declarations.epilepsy, "epilepsy in the privacy text");
      assert.equal(VEST.test(priv), vestNamed, "vestibular in the privacy text");
      // No dangling separators where a declaration was removed.
      const flat = (await text(await call(env, req(`/privacidad?lang=${lang}`)))).replace(/<[^>]*>/g, "");
      assert.ok(!/ ,|,\s*,|\(\s*\)|,\./.test(flat), "no stray punctuation in the privacy text");
    });
  }
}

test("the server checks the declarations that are on, and only those", async () => {
  for (const study of STUDIES) {
    const d = declarationsFor(study);
    for (const [field, on] of [["noepi", d.epilepsy], ["vestibular", d.vestibular]]) {
      const { DB, env } = await setup();
      await D.setSetting(DB, "active_study", study);
      await D.setSetting(DB, "confirm_mode", "instant");
      const r = await book(env, { [field]: "" });
      if (on) { assert.equal(r.status, 400, `${study}: ${field} is required`); assert.equal(rows(DB).length, 0); }
      else { assert.equal(r.status, 200, `${study}: ${field} is not asked`); assert.equal(rows(DB).length, 1); }
    }
    const { DB, env } = await setup();
    await D.setSetting(DB, "active_study", study);
    await D.setSetting(DB, "confirm_mode", "instant");
    assert.equal((await book(env, {})).status, 200, `${study}: with every declaration ticked the booking goes through`);
  }
});

test("twoStudies: the two-studies card, the switch in the admin panel and the stored study follow the configuration", async () => {
  const { DB, env } = await setup();
  const S = T[TESTED[0]];
  await D.setSetting(DB, "active_study", "study2"); // a stored value must be ignored when there is one study
  const home = await text(await call(env, req(`/?lang=${TESTED[0]}`)));
  assert.equal(home.includes(`<h2>${S.twoH}</h2>`), C.twoStudies, "the card");
  const active = await D.getActiveStudy(DB);
  assert.equal(active, C.twoStudies ? "study2" : "study1");
  const lead = (st) => esc(S[st].does); // the "what you will do" paragraph differs between the two studies
  assert.equal(home.includes(lead("study2")), C.twoStudies, "study2 text only with two studies");
  if (!C.twoStudies) assert.ok(home.includes(lead("study1")), "study1 text is always used");

  const s = await adminSession(env);
  const panel = await adminGet(env, s);
  assert.equal(panel.includes('value="study:study1"'), C.twoStudies, "switch in the admin panel");
  assert.equal(panel.includes(AT.set.studyTitle), C.twoStudies);
  const r = await adminDo(env, s, "study:study2");
  const msg = new URL(r.headers.get("location"), "https://x.invalid").searchParams.get("m");
  if (C.twoStudies) assert.equal(msg, "study");
  else assert.equal(msg, "denied", "the switch is refused on the server too");
  await D.setSetting(DB, "active_study", "study1");
  if (!C.twoStudies) { await adminDo(env, s, "study:study2"); assert.equal(await D.getSetting(DB, "active_study"), "study1"); }
});

test("twoStudies: no study is named in the day list of the admin panel or in the notice to the researcher", async () => {
  const { DB, env } = await setup();
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES ('s1',?,'study1',?,?,'Test Person','tp@example.org','tp@example.org','confirmed',?,NULL,0,?)")
    .run("t".repeat(30), DAY, A, NOW.toISOString(), C.languages[0]);
  const s = await adminSession(env);
  const day = plain(await adminGet(env, s, `?day=${DAY}`));
  assert.equal(day.includes(AT.day.study(false)), C.twoStudies, `"${AT.day.study(false)}" in the day list`);
  const notice = tplAdmin({ NOLINK_DOMAINS: "" }, "confirmed", { id: "x", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email: "tp@example.org", lang: C.languages[0], study: "study2" });
  assert.equal(notice.text.includes(AT.mail.study(true)), C.twoStudies, `"${AT.mail.study(true)}" in the notice`);
});

// ---- privacyReviewed ------------------------------------------------------------------------------------------------
test("privacyReviewed: both admin languages have the to-do line, and the checklist shows it only while it is false", async () => {
  for (const l of ["es", "it"]) assert.match(ADMIN_TEXT_SETS[l].set.privacyReview, /privacyReviewed: true/, l);
  assert.match(ADMIN_TEXT_SETS.es.set.privacyReview, /protección de datos/);
  assert.match(ADMIN_TEXT_SETS.it.set.privacyReview, /protezione dei dati/);
  const { env } = await setup();
  const s = await adminSession(env);
  const panel = await adminGet(env, s);
  const m = new RegExp(`<li class="(\\w+)">[^<]*: ${esc(AT.set.privacyReview).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</li>`).exec(panel);
  if (C.privacyReviewed) assert.equal(m, null, "no to-do line once reviewed");
  else { assert.ok(m, "the to-do line is in the checklist"); assert.equal(m[1], "todo"); }
});

// ---- texts about the study materials are empty by default and print nothing -----------------------------------
test("the built-in texts say nothing about the language of the application or the questionnaires", async () => {
  for (const l of ["es", "en", "it"]) {
    assert.equal(BUILTIN_TEXTS[l].factLangText, "", `${l}.factLangText`);
    assert.equal(BUILTIN_TEXTS[l].termsMaterials, "", `${l}.termsMaterials`);
  }
  const { env } = await setup();
  for (const l of TESTED) {
    if (C.texts[l] && ("termsMaterials" in C.texts[l] || "terms" in C.texts[l])) continue;
    const terms = await text(await call(env, req(`/condiciones?lang=${l}`)));
    assert.ok(!terms.includes("{materials}"), `${l}: the placeholder is replaced`);
    assert.ok(!/\S {2,}\S/.test(terms.replace(/<[^>]*>/g, "")), `${l}: no double space where the sentence would be`);
  }
});
