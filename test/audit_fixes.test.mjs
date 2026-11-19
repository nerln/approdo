// Correcciones de la auditoría de seguridad.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { MAIL_DAY_MAX, MAIL_ADMIN_SKIP } from "../src/mail.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, req, call, book, tokenFrom, rows } from "./helpers.mjs";
import { admin, get } from "./spec_helpers.mjs";

// n filas en el registro de correos, todas hace `agoMs`.
async function fillLog(DB, n, agoMs = 3600_000 * 2, kind = "reminder") {
  for (let i = 0; i < n; i++) await D.logMail(DB, `old${i}`, kind, true, null, new Date(NOW.getTime() - agoMs).toISOString());
}

test("tope diario de correos: con 80 en 24 h no se aceptan reservas nuevas y no sale ningún correo", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await fillLog(DB, MAIL_DAY_MAX);
  const m = mockFetch();
  const r = await book(env, {}, { fetchFn: m.fn });
  assert.equal(r.status, 429);
  const h = await r.text();
  assert.ok(h.includes("Hoy no podemos aceptar más reservas"));
  assert.ok(!h.includes("10 minutos"), "no es el mensaje del límite por dirección");
  assert.equal(rows(DB).length, 0);
  assert.equal(m.calls.mail.length, 0);
  const en = await (await call(env, req("/reservar?lang=en", { method: "POST", fields: await (await import("./helpers.mjs")).goodFields(DB, { email: "b@unidemo.es" }), ip: "2.2.2.2" }), NOW, m.fn)).text();
  assert.ok(en.includes("We cannot take more bookings today"));
});

test("tope diario: con 79 se acepta, y los correos de hace más de 24 h no cuentan", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await fillLog(DB, MAIL_DAY_MAX - 1);
  await fillLog(DB, 50, 25 * 3600_000);
  const m = mockFetch();
  const r = await book(env, {}, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 1);
  assert.equal(m.calls.mail.length, 1);
});

test("sin relay el tope diario no se aplica", async () => {
  const { DB, env } = await setup();
  await fillLog(DB, MAIL_DAY_MAX + 5);
  assert.equal((await book(env)).status, 200);
});

test("desde 50 correos en 24 h se confirma igual, pero sin el aviso a quien investiga", async () => {
  for (const [n, adminMails] of [[MAIL_ADMIN_SKIP - 3, 1], [MAIL_ADMIN_SKIP, 0]]) {
    const { DB, env } = await setup({ ...RELAY, ADMIN_EMAIL: "inv@unidemo.es" });
    await fillLog(DB, n);
    const m = mockFetch();
    const r = await book(env, {}, { fetchFn: m.fn });
    assert.equal(r.status, 200);
    const token = tokenFrom(m.calls.mail[0].json.text);
    const p = await call(env, req(`/c/${token}`, { method: "POST" }), later(60_000), m.fn);
    assert.equal(p.status, 200);
    assert.equal(rows(DB)[0].status, "confirmed");
    const to = m.calls.mail.map((x) => x.json.to);
    assert.equal(to.filter((t) => t === "ana@unidemo.es").length, 2, "petición y confirmación");
    assert.equal(to.filter((t) => t === "inv@unidemo.es").length, adminMails, `con ${n} correos previos`);
  }
});

test("el saludo del correo en HTML lleva el alias desarmado, igual que el texto", async () => {
  const { env } = await setup({ ...RELAY });
  const m = mockFetch();
  const r = await book(env, { name: "Pago: pago-ya.example", email: "ana@gmail.com" }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const { html, text } = m.calls.mail[0].json;
  assert.ok(!html.includes("pago-ya.example"), "el dominio no queda entero en el HTML");
  assert.ok(html.includes("pago-ya. example"));
  assert.ok(text.includes("pago-ya. example"));
});

test("panel: el mensaje ya no lee nombre, correo ni error de la URL", async () => {
  const { env, s } = await admin();
  const h = await get(env, s, "?m=mail-fail&a=Ana&x=malo%40evil.example&e=quota");
  assert.ok(!h.includes("malo@evil.example"));
  assert.ok(!h.includes("Ana"));
});

test("panel: los ajustes enseñan los correos de las últimas 24 horas", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await fillLog(DB, 7);
  const h = await get(env, s);
  assert.ok(h.includes("Correos en las últimas 24 horas: 7 "));
});

test("Turnstile: en observación hasta la primera comprobación correcta; después bloquea, y el panel lo cuenta", async () => {
  const { DB, env, s } = await admin({ TURNSTILE_SITEKEY: "0xKEY", TURNSTILE_SECRET: "sec" });
  const setting = (k) => JSON.parse(DB.raw.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? "null");
  let h = await get(env, s);
  assert.ok(h.includes("en observación: no bloquea a nadie hasta la primera comprobación correcta · última comprobación correcta: ninguna todavía · último fallo: ninguno"));
  // En observación: un fallo se anota pero la reserva pasa.
  const bad = mockFetch({ turnstile: { success: false, "error-codes": ["timeout-or-duplicate"] } });
  assert.equal((await book(env, { "cf-turnstile-response": "tok" }, { fetchFn: bad.fn })).status, 200);
  assert.equal(setting("ts_fail_last").why, "timeout-or-duplicate");
  assert.equal(setting("ts_ok_last"), null);
  assert.equal(rows(DB).length, 1);
  // La primera comprobación correcta la activa.
  const ok = mockFetch();
  assert.equal((await book(env, { "cf-turnstile-response": "tok", email: "b@unidemo.es", slot: `${DAY}T10:30` }, { fetchFn: ok.fn, ip: "3.3.3.3" })).status, 200);
  assert.equal(setting("ts_ok_last").at, NOW.toISOString());
  // Desde entonces, sin respuesta del widget o con una respuesta rechazada no se reserva.
  assert.equal((await book(env, { email: "c@unidemo.es", slot: `${DAY}T11:30` }, { fetchFn: ok.fn, ip: "2.2.2.2" })).status, 400);
  assert.equal(setting("ts_fail_last").why, "sin respuesta del widget");
  assert.equal((await book(env, { "cf-turnstile-response": "tok", email: "d@unidemo.es", slot: `${DAY}T11:30` }, { fetchFn: bad.fn, ip: "4.4.4.4" })).status, 400);
  assert.equal(rows(DB).length, 2);
  h = await get(env, s);
  assert.ok(h.includes("activa: bloquea a quien no la pasa · última comprobación correcta: 16/11 10:00 · último fallo: 16/11 10:00 (timeout-or-duplicate)"));
});

test("Turnstile llama a fetch suelto, no como método (en Workers eso lanza «Illegal invocation»)", async () => {
  const { DB, env } = await setup({ TURNSTILE_SITEKEY: "0xKEY", TURNSTILE_SECRET: "sec" });
  const inner = mockFetch();
  // Como el fetch de Workers: solo acepta que lo llamen sin `this` (o con el global).
  function strictFetch(...a) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return inner.fn(...a);
  }
  assert.equal((await book(env, { "cf-turnstile-response": "tok" }, { fetchFn: strictFetch })).status, 200);
  assert.equal(rows(DB).length, 1);
});
