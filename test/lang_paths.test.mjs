import test from "node:test";
import assert from "node:assert/strict";
import { setup, req, call } from "./helpers.mjs";

test("H1 /es y /en llevan al inicio en ese idioma; otras rutas de dos letras siguen sin existir", async () => {
  const { env } = await setup();
  for (const l of ["es", "en"]) {
    const r = await call(env, req(`/${l}`));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), `/?lang=${l}`);
    const page = await (await call(env, req(`/?lang=${l}`))).text();
    assert.match(page, new RegExp(`<html lang="${l}"`));
  }
  assert.equal((await call(env, req("/fr"))).status, 404);
  assert.equal((await call(env, req("/es", { method: "POST" }))).status, 404);
});
