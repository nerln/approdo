import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { setup, req, call } from "./helpers.mjs";

test("I1 aviso de los dos estudios: el activo tiene turnos abiertos, el otro va después o ya ha terminado", async () => {
  const { DB, env } = await setup();
  let es = await (await call(env, req("/?lang=es"))).text();
  let en = await (await call(env, req("/?lang=en"))).text();
  assert.match(es, /<h2>Dos estudios<\/h2>/); assert.match(en, /<h2>Two studies<\/h2>/);
  assert.match(es, /<li>Estudio 1: [^<]* Turnos abiertos ahora\.<\/li><li>Estudio 2: [^<]* Más adelante\.<\/li>/);
  assert.match(en, /<li>Study 1: [^<]* Slots open now\.<\/li><li>Study 2: [^<]* Later on\.<\/li>/);
  await D.setSetting(DB, "active_study", "study2");
  es = await (await call(env, req("/?lang=es"))).text();
  assert.match(es, /<li>Estudio 1: [^<]* Ya ha terminado\.<\/li><li>Estudio 2: [^<]* Turnos abiertos ahora\.<\/li>/);
});

test("I2 idioma: aplicación y cuestionarios en inglés; cuestionarios en español solo si hace falta", async () => {
  const { env } = await setup();
  for (const [l, re] of [["es", /cuestionarios están en inglés\. Si lo necesitas, puedes hacer los cuestionarios en español\./], ["en", /questionnaires are in English\. If you need it, you can do the questionnaires in Spanish\./]]) {
    assert.match(await (await call(env, req(`/condiciones?lang=${l}`))).text(), re);
  }
});
