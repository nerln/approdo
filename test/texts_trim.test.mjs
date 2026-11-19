// Textos retirados: ocio, "instrucciones en español" y la explicación sobre la epilepsia.
import test from "node:test";
import assert from "node:assert/strict";
import { setup, req, call } from "./helpers.mjs";
import { tplConfirmed } from "../src/mail.js";

const GONE = [
  /no es una actividad de ocio/i, /not a leisure activity/i,
  /instrucciones (te las damos |ser[aá]n |son )?en espa[nñ]ol/i, /instructions (are |will be given )?in Spanish/i, /we give you the instructions/i,
  /Por qu[eé] te preguntamos por la epilepsia/i, /Why we ask about epilepsy/i,
  /pueden provocar crisis/i, /can trigger seizures/i, /photosensitive/i, /fotosensible/i,
];
const B = (lang) => ({ token: "t".repeat(30), date: "2026-11-19", time: "10:00", name: "Ana", email: "ana@unidemo.es", lang, study: "study2", expires_at: "2026-11-19T09:00:00.000Z" });

test("las páginas públicas no llevan los textos retirados, en es y en", async () => {
  const { env } = await setup();
  for (const lang of ["es", "en"]) for (const p of ["/", "/condiciones", "/privacidad"]) {
    const h = await (await call(env, req(`${p}?lang=${lang}`))).text();
    for (const re of GONE) assert.doesNotMatch(h, re, `${p} ${lang} ${re}`);
  }
});

test("el correo de turno confirmado no dice que las instrucciones sean en español", () => {
  for (const lang of ["es", "en"]) {
    const t = tplConfirmed({ BASE_URL: "https://estudio-vr-demo.workers.dev" }, B(lang));
    for (const re of GONE) assert.doesNotMatch(t.text + t.html, re, `${lang} ${re}`);
    assert.match(t.text, lang === "en" ? /Please arrive a few minutes early\./ : /Llega unos minutos antes\./);
  }
});

test("la portada conserva el requisito y la casilla de epilepsia y tiene dos chips", async () => {
  const { env } = await setup();
  const exp = { es: [/No tener ni haber tenido nunca epilepsia/, /No tengo ni he tenido nunca epilepsia/], en: [/Not have epilepsy, and never have had it/, /I do not have epilepsy and have never had it/] };
  for (const lang of ["es", "en"]) {
    const h = await (await call(env, req(`/?lang=${lang}`))).text();
    for (const re of exp[lang]) assert.match(h, re);
    assert.match(h, /name="noepi"/);
    const m = h.match(/class="facts"[^>]*>([\s\S]*?)<\/ul>/);
    assert.ok(m, "bloque de chips");
    assert.equal((m[1].match(/<li\b/g) || []).length, 2, `chips ${lang}`);
  }
});
