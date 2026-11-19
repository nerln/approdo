// Without a mail relay no e-mail is ever sent. The public sentences that tell the person to look for the confirmation e-mail, to
// answer it, or to use a link or code "in the e-mail" must therefore appear only when the relay is on (relayOn in src/mail.js).
import test from "node:test";
import assert from "node:assert/strict";
import { T, BUILTIN_TEXTS } from "../src/i18n.js";
import { C, DAY, TESTED, RELAY, setup, call, req, text, book, relay, withConfig, rawConfig } from "./helpers.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const has = (html, s) => html.includes(s) || html.includes(esc(s));

for (const lang of TESTED) {
  test(`[${lang}] home page: the questions and cancel sentences and the e-mail note speak of an e-mail only when the relay is on`, async () => {
    const S = T[lang];
    for (const k of ["cantCome", "help", "step2Help"]) assert.ok(S[k + "NoMail"] && S[k + "NoMail"] !== S[k], `${k}NoMail exists and differs`);
    const off = await text(await call((await setup()).env, req(`/?lang=${lang}`)));
    const on = await text(await call((await setup({ ...RELAY })).env, req(`/?lang=${lang}`)));
    for (const k of ["cantCome", "help", "step2Help"]) {
      assert.ok(has(on, S[k]) && !has(on, S[k + "NoMail"]), `${k}: relay on`);
      assert.ok(has(off, S[k + "NoMail"]) && !has(off, S[k]), `${k}: relay off`);
    }
    assert.ok(!/e-?mail|correo/i.test(S.cantComeNoMail + S.helpNoMail), "the replacements do not mention an e-mail");
  });

  test(`[${lang}] the 'already booked with this e-mail' error points to a received e-mail only when the relay is on`, async () => {
    const S = T[lang];
    assert.ok(S.err.liveEmailNoMail && S.err.liveEmailNoMail !== S.err.liveEmail);
    for (const [relayOn, expected, other] of [[false, S.err.liveEmailNoMail, S.err.liveEmail], [true, S.err.liveEmail, S.err.liveEmailNoMail]]) {
      const { env, DB } = await setup(relayOn ? { ...RELAY } : {});
      const m = relay();
      const email = "same.person@example.org";
      const first = await book(env, { email, slot: `${DAY}T${C.defaultTimes[0]}` }, { fetchFn: m.fn });
      assert.equal(first.status, 200, "the first booking is accepted");
      const second = await book(env, { email, slot: `${DAY}T${C.defaultTimes[C.defaultTimes.length - 1]}` }, { fetchFn: m.fn, lang });
      const html = await text(second);
      assert.equal(second.status, 409);
      assert.ok(has(html, expected), `relay ${relayOn}: the sentence for this case`);
      assert.ok(!has(html, other), `relay ${relayOn}: not the other one`);
    }
  });

  test(`[${lang}] terms and privacy: the sentences that send the person to the confirmation e-mail are replaced when the relay is off`, async () => {
    const S = T[lang];
    for (const [page, key, pairsKey] of [["/condiciones", "terms", "termsNoMail"], ["/privacidad", "privacy", "privacyNoMail"]]) {
      const pairs = S[pairsKey];
      assert.ok(Array.isArray(pairs) && pairs.length >= 2, `${pairsKey} exists`);
      // The built-in texts must contain every sentence (a pair that matches nothing would do nothing); a lab that rewrote the page keeps its own.
      if (S[key] === BUILTIN_TEXTS[lang][key]) for (const [a] of pairs) assert.ok(S[key].includes(a), `${pairsKey}: ${a.slice(0, 50)}`);
      const off = await text(await call((await setup()).env, req(`${page}?lang=${lang}`)));
      const on = await text(await call((await setup({ ...RELAY })).env, req(`${page}?lang=${lang}`)));
      for (const [a, b] of pairs) {
        if (!S[key].includes(a)) continue;
        assert.ok(has(on, a), `relay on keeps: ${a.slice(0, 50)}`);
        assert.ok(!has(off, a) && has(off, b), `relay off replaces: ${a.slice(0, 50)}`);
      }
    }
    if (S.privacy === BUILTIN_TEXTS[lang].privacy && S.terms === BUILTIN_TEXTS[lang].terms) {
      const strip = (h) => h.replace(/<[^>]*>/g, " ");
      for (const page of ["/condiciones", "/privacidad"]) {
        const off = strip(await text(await call((await setup()).env, req(`${page}?lang=${lang}`))));
        assert.ok(!/(confirmation email|correo de confirmación|e-mail di conferma)/i.test(off), `${page}: no confirmation e-mail is mentioned without a relay`);
      }
    }
  });
}

test("a sentence the lab rewrote itself is kept as written when the relay is off; the built-in ones next to it are replaced", () => {
  const lang = TESTED[0];
  const cfg = rawConfig();
  cfg.texts = { ...(cfg.texts || {}), [lang]: { ...((cfg.texts || {})[lang] || {}), help: "Our own help sentence." } };
  const r = withConfig(cfg, `import { T, mailText } from "./src/i18n.js"; console.log(JSON.stringify({ own: mailText(${JSON.stringify(lang)}, "help", false), ownOn: mailText(${JSON.stringify(lang)}, "help", true), cant: mailText(${JSON.stringify(lang)}, "cantCome", false), cantNo: T[${JSON.stringify(lang)}].cantComeNoMail }));`);
  assert.equal(r.status, 0, r.err);
  const o = JSON.parse(r.out);
  assert.equal(o.own, "Our own help sentence.");
  assert.equal(o.ownOn, "Our own help sentence.");
  assert.equal(o.cant, o.cantNo);
});
