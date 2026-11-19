// Excepción a las 12 h de antelación, decidida día a día en el panel. Ahora = lunes 16/11/2026, 10:00 en hora local.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, req, call, book, rows, adminDo } from "./helpers.mjs";
import { admin, get } from "./spec_helpers.mjs";

const TODAY = "2026-11-16";
const TOMORROW = "2026-11-17";
const today = (t) => `${TODAY}T${t}`;
const setting = (DB, key) => DB.raw.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;

test("sin excepción las franjas de hoy no se ofrecen; con ella, desde 20 minutos después de ahora", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await D.openDay(DB, TODAY, ["09:00", "10:15", "11:00", "16:00"]);
  let h = await (await call(env, req("/"))).text();
  assert.ok(!h.includes(TODAY), "hoy no aparece sin excepción");
  await D.setNoNotice(DB, TODAY);
  h = await (await call(env, req("/"))).text();
  assert.ok(h.includes(today("11:00")) && h.includes(today("16:00")));
  assert.ok(!h.includes(today("09:00")), "una franja pasada no");
  assert.ok(!h.includes(today("10:15")), "a 15 minutos no se enseña");
  assert.match(h, /<legend>[^<]*\(hoy\)<\/legend>/);
  assert.ok(h.includes("o hasta la hora del turno si es hoy"), "el plazo de confirmación se explica");
  assert.ok(h.indexOf(TODAY) < h.indexOf(DAY), "hoy va primero");
  assert.match(h, new RegExp(`${DAY}T09:30`), "los otros días no cambian");
  await D.clearNoNotice(DB, TODAY);
  h = await (await call(env, req("/"))).text();
  assert.ok(!h.includes(TODAY));
});

test("reservar con la excepción: vale con el margen de 5 minutos, no vale más tarde ni una franja pasada", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, TODAY, ["09:00", "10:15", "11:30"]);
  assert.equal((await book(env, { slot: today("11:30") })).status, 409, "sin excepción, 409");
  await D.setNoNotice(DB, TODAY);
  // 10:15 a las 10:00: dentro del margen (20 - 5 minutos)
  assert.equal((await book(env, { slot: today("10:15") }, { ip: "2.2.2.2" })).status, 200);
  assert.equal((await book(env, { slot: today("09:00"), email: "b@unidemo.es" }, { ip: "3.3.3.3" })).status, 409, "franja pasada");
  assert.equal((await book(env, { slot: today("11:30"), email: "c@unidemo.es" }, { ip: "4.4.4.4" })).status, 200);
  assert.equal(rows(DB).length, 2);
});

test("a 14 minutos del inicio ya no se puede reservar", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, TODAY, ["10:15"]);
  await D.setNoNotice(DB, TODAY);
  const now = later(60_000); // 10:01
  assert.equal((await book(env, { slot: today("10:15") }, { now })).status, 409);
  assert.equal(rows(DB).length, 0);
});

test("la excepción vale solo para su día", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, TODAY, ["16:00"]);
  await D.openDay(DB, TOMORROW, ["09:15"]);
  const now = later(12 * 3600_000); // lunes 22:00: mañana 09:15 queda a menos de 12 h
  await D.setNoNotice(DB, TODAY);
  assert.equal((await book(env, { slot: `${TOMORROW}T09:15` }, { now })).status, 409, "la excepción de hoy no abre mañana");
  await D.setNoNotice(DB, TOMORROW);
  let h = await (await call(env, req("/"), now)).text();
  assert.ok(h.includes(`${TOMORROW}T09:15`));
  assert.ok(!h.includes("(hoy)"), "mañana no lleva la etiqueta de hoy");
  assert.equal((await book(env, { slot: `${TOMORROW}T09:15` }, { now })).status, 200);
  assert.equal(rows(DB).length, 1);
});

test("con relay, la reserva sin confirmar caduca al empezar el turno; una reserva normal sigue con 2 horas", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await D.openDay(DB, TODAY, ["10:45"]);
  await D.setNoNotice(DB, TODAY);
  const mf = mockFetch();
  const r = await book(env, { slot: today("10:45") }, { fetchFn: mf.fn });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /hasta las 10:45/);
  assert.ok(!h.includes("2 horas"));
  assert.equal(rows(DB)[0].expires_at, "2026-11-16T09:45:00.000Z"); // 10:45 local
  const r2 = await book(env, { email: "b@unidemo.es" }, { fetchFn: mf.fn, ip: "2.2.2.2" });
  assert.equal(r2.status, 200);
  const far = rows(DB).find((b) => b.date === DAY);
  assert.equal(far.expires_at, later(2 * 3600_000).toISOString());
});

test("con «Disponible hoy» activado mandan sus horas, no las franjas fijas de la excepción", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, TODAY, ["12:02"]);
  await D.setNoNotice(DB, TODAY);
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  const h = await (await call(env, req("/"))).text();
  assert.ok(h.includes(today("10:20")));
  assert.ok(!h.includes(today("12:02")), "la franja fija no se enseña");
  assert.equal((await book(env, { slot: today("12:02") })).status, 409, "12:02 no es un inicio flexible (múltiplos de 5)");
  await D.clearFlex(DB, TODAY);
  assert.equal((await book(env, { slot: today("12:02") })).status, 200, "sin flex vuelve a valer la franja fija");
});

test("panel: activar y quitar la excepción de un día, con su texto y sus botones", async () => {
  const { DB, env, s } = await admin();
  await D.openDay(DB, TODAY, ["09:00", "10:10", "16:00"]);
  const q = `?month=2026-11&day=${TODAY}`;
  let h = await get(env, s, q);
  assert.ok(h.includes(`value="notice-off:${TODAY}"`));
  assert.ok(h.includes("menos de 12 h"));
  let r = await adminDo(env, s, `notice-off:${TODAY}`);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /m=notice-off/);
  assert.equal(setting(DB, `nonotice:${TODAY}`), "1");
  h = await get(env, s, q);
  assert.ok(h.includes("Excepción activada: este día se puede reservar hasta 20 minutos antes"));
  assert.ok(h.includes(`value="notice-on:${TODAY}"`));
  assert.ok(!h.includes(`value="notice-off:${TODAY}"`));
  assert.ok(h.includes("menos de 20 min"), "10:10 ya no entra en los 20 minutos");
  assert.ok(!h.includes("menos de 12 h)"));
  r = await adminDo(env, s, `notice-on:${TODAY}`);
  assert.match(r.headers.get("location"), /m=notice-on/);
  assert.equal(setting(DB, `nonotice:${TODAY}`), null);
});

test("panel: fechas no válidas se rechazan y un día cerrado o pasado no ofrece el botón", async () => {
  const { DB, env, s } = await admin();
  for (const bad of ["2026-11-15", "2027-03-01", "2026-13-40", "x", ""]) {
    const r = await adminDo(env, s, `notice-off:${bad}`);
    assert.match(r.headers.get("location"), /m=bad-date/, bad);
  }
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'nonotice:%'").get().n, 0);
  const closed = await get(env, s, "?month=2026-11&day=2026-11-20");
  assert.ok(!closed.includes("notice-off:"));
  const past = await get(env, s, "?month=2026-11&day=2026-11-13");
  assert.ok(!past.includes("notice-off:"));
});

test("panel: sin CSRF no se cambia nada", async () => {
  const { DB, env, s } = await admin();
  const r = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "malo", do: `notice-off:${TODAY}` } }));
  assert.ok(r.status === 403 || r.status === 303);
  assert.equal(setting(DB, `nonotice:${TODAY}`), null);
  const anon = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: `notice-off:${TODAY}` } }));
  assert.notEqual(anon.status, 200);
  assert.equal(setting(DB, `nonotice:${TODAY}`), null);
});

test("la limpieza borra las excepciones de días pasados y deja las de hoy en adelante", async () => {
  const { DB } = await setup();
  await D.setNoNotice(DB, "2026-11-15");
  await D.setNoNotice(DB, TODAY);
  await D.setNoNotice(DB, TOMORROW);
  await D.cleanup(DB, NOW.getTime() + 10 * 60_000, TODAY);
  assert.equal(setting(DB, "nonotice:2026-11-15"), null);
  assert.equal(setting(DB, `nonotice:${TODAY}`), "1");
  assert.equal(setting(DB, `nonotice:${TOMORROW}`), "1");
  assert.deepEqual([...(await D.noNoticeDays(DB, TODAY, TOMORROW))].sort(), [TODAY, TOMORROW]);
});
