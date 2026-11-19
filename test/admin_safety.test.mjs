// Menos errores: asistencia, cancelación, sesión caducada, mensajes, login, horas, varias semanas, aviso de 12 h y reserva repetida.
import test from "node:test";
import assert from "node:assert/strict";
import { NOW, later, DAY, RELAY, setup, call, req, book, rows, login, adminDo, adminSession } from "./helpers.mjs";
import { ins, admin, get, text } from "./spec_helpers.mjs";
import { parseTimes } from "../src/slots.js";
import { signForm } from "../src/auth.js";
import * as D from "../src/db.js";

const flash = async (env, s, res) => get(env, s, res.headers.get("location").replace("/admin", ""));

test("C18 Asistió / No vino solo cuando el turno ha empezado: en la página y en doAction", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.openDay(DB, "2026-11-16", ["09:30", "10:00", "10:30"]);
  const started = ins(DB, { id: "s1", date: "2026-11-16", time: "10:00", email: "s1@unidemo.es" }); // empieza a las 10:00, ahora son las 10:00
  const future = ins(DB, { id: "s2", date: "2026-11-16", time: "10:30", email: "s2@unidemo.es" });
  const tomorrow = ins(DB, { id: "s3", date: "2026-11-17", time: "09:30", email: "s3@unidemo.es" });
  const h = await get(env, s, "?day=2026-11-16");
  assert.match(h, /value="attended:s1"/); assert.match(h, /value="noshow:s1"/);
  assert.doesNotMatch(h, /value="attended:s2"/);
  assert.match(h, /Aún no ha empezado/);
  const r = await adminDo(env, s, `attended:${future.id}`, { day: "2026-11-16" });
  assert.match(r.headers.get("location"), /m=not-started/);
  assert.match(await flash(env, s, r), /class="error" role="status">Ese turno todavía no ha empezado\./);
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id='s2'").get().status, "confirmed");
  assert.match((await adminDo(env, s, `noshow:${tomorrow.id}`)).headers.get("location"), /m=not-started/);
  assert.match((await adminDo(env, s, `attended:${started.id}`)).headers.get("location"), /m=marked/);
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id='s1'").get().status, "attended");
  // un minuto antes del inicio: todavía no
  const early = new Date(NOW.getTime() - 60_000);
  const s0 = await adminSession(env, early);
  assert.match((await adminDo(env, s0, `attended:${future.id}`, {}, new Date(NOW.getTime() + 29 * 60_000 - 1), undefined)).headers.get("location"), /m=not-started/);
  assert.match((await adminDo(env, s, `attended:${future.id}`, {}, new Date(NOW.getTime() + 30 * 60_000))).headers.get("location"), /m=marked/);
});

test("C19 Cancelar solo para hoy o más adelante, en la página y en doAction", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.openDay(DB, "2026-11-15", ["09:30"]);
  ins(DB, { id: "k1", date: "2026-11-15", time: "09:30", email: "k1@unidemo.es" });
  ins(DB, { id: "k2", date: "2026-11-16", time: "08:00", email: "k2@unidemo.es" }); // hoy, ya empezó
  const past = await get(env, s, "?day=2026-11-15");
  assert.doesNotMatch(past, /value="cancel:k1"/);
  assert.match(await get(env, s, "?day=2026-11-16"), /value="cancel:k2"/);
  const r = await adminDo(env, s, "cancel:k1", { day: "2026-11-15" });
  assert.match(r.headers.get("location"), /m=past-day/);
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id='k1'").get().status, "confirmed");
  assert.match(await flash(env, s, r), /No se puede cancelar un turno de un día que ya pasó\./);
  assert.match((await adminDo(env, s, "cancel:k2", {}, NOW, async () => new Response(JSON.stringify({ ok: true })))).headers.get("location"), /m=cancel-ok/);
});

test("C20 un POST con sesión caducada o ausente devuelve la página de entrada, 401, y no hace nada", async () => {
  const { DB, env, s } = await admin();
  const msg = /La sesión ha caducado y la acción NO se ha hecho\. Entra de nuevo y repítela\./;
  const noCookie = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: "study:study2" } }));
  assert.equal(noCookie.status, 401);
  const h = await text(noCookie);
  assert.match(h, msg); assert.match(h, /type="password"/);
  const expired = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: "study:study2" } }), later(13 * 3600_000));
  assert.equal(expired.status, 401);
  assert.match(await text(expired), msg);
  assert.equal(await D.getActiveStudy(DB), "study1", "la acción no se hizo");
  assert.equal((await call(env, req("/admin"))).status, 200, "un GET sigue mostrando el formulario normal");
  assert.doesNotMatch(await text(await call(env, req("/admin"))), msg);
});

test("C21 mensajes claros: la reserva ya no existe, o ya estaba cancelada o marcada", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "g1", status: "cancelled", date: "2026-11-16", time: "08:00" });
  const gone = await adminDo(env, s, "cancel:no-existe", { day: DAY });
  assert.match(await flash(env, s, gone), /class="error" role="status">Esa reserva ya no existe: la persona la canceló o caducó sin confirmar\./);
  for (const a of ["cancel:g1", "attended:g1", "noshow:g1", "rebook:g1", "resend:g1"]) {
    const r = await adminDo(env, s, a, {}, NOW, async () => new Response(JSON.stringify({ ok: true })));
    assert.match(r.headers.get("location"), /m=state/, a);
  }
  assert.match(await get(env, s, "?m=state"), /Esa reserva ya estaba cancelada o marcada\. No se ha cambiado nada\./);
  assert.match(await get(env, s, "?m=denied"), /Acción no permitida\./, "denied sigue existiendo para lo demás");
  assert.equal(DB.raw.prepare("SELECT status FROM bookings WHERE id='g1'").get().status, "cancelled");
});

test("C22 formulario de entrada caducado con la contraseña buena: mensaje propio y no cuenta como fallo", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: "una-contrasena-larga-123" });
  const old = await signForm(DB, NOW.getTime() - 25 * 3600_000, "login");
  const r = await call(env, req("/admin/login", { method: "POST", fields: { password: "una-contrasena-larga-123", t: old }, ip: "3.3.3.3" }));
  assert.equal(r.status, 401);
  assert.match(await text(r), /El formulario había caducado\. Escribe la contraseña otra vez\./);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM login_attempts").get().n, 0);
  assert.equal((await login(env, "una-contrasena-larga-123", { ip: "3.3.3.3" })).status, 303, "con un formulario nuevo entra");
  // contraseña mala con formulario viejo: sí cuenta
  const r2 = await call(env, req("/admin/login", { method: "POST", fields: { password: "mala", t: old }, ip: "3.3.3.3" }));
  assert.match(await text(r2), /Contraseña incorrecta\./);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM login_attempts").get().n, 1);
});

test("C23 horas por defecto: se rechazan turnos que se pisan y un último turno que acaba después de medianoche", async () => {
  assert.deepEqual(parseTimes("09:00, 09:45, 22:15"), ["09:00", "09:45", "22:15"]);
  assert.equal(parseTimes("09:00, 09:44"), null, "menos de 45 minutos entre inicios");
  assert.equal(parseTimes("09:30 09:00"), null);
  assert.equal(parseTimes("23:30"), null, "acabaría a las 00:15");
  assert.equal(parseTimes("23:16"), null);
  assert.deepEqual(parseTimes("23:15"), ["23:15"], "acaba justo a medianoche");
  const { DB, env, s } = await admin();
  for (const bad of ["09:00, 09:30", "08:00, 23:30"]) {
    const r = await adminDo(env, s, "times", { times: bad });
    assert.match(r.headers.get("location"), /m=bad-times/);
    assert.match(await flash(env, s, r), /Horas no válidas\. Usa HH:MM separadas por comas \(máximo 12\), con al menos 45 minutos entre un inicio y el siguiente y sin que el último turno acabe después de medianoche\./);
  }
  assert.equal(await D.getSetting(DB, "slot_times"), null, "nada guardado");
  assert.match((await adminDo(env, s, "times", { times: "09:00, 09:45" })).headers.get("location"), /m=times/);
});

test("C24 abrir varias semanas: 1/2/4/8, solo días cerrados, solo dentro de las 8 semanas, con el número de días", async () => {
  const { DB, env, s } = await admin({}, { openDay: false });
  const h = await get(env, s);
  assert.match(h, /<select id="weeks" name="weeks"><option value="1">1<\/option><option value="2">2<\/option><option value="4">4<\/option><option value="8">8<\/option><\/select> <button name="do" value="weeks:2026-11-16" class="plain">Abrir<\/button>/);
  assert.match(h, /value="week:2026-11-16"/, "el botón de una semana sigue");
  await D.openDay(DB, "2026-11-18", ["09:00"]); // ya abierto: no se toca
  const r = await adminDo(env, s, "weeks:2026-11-18", { weeks: "2", day: "2026-11-18" });
  assert.match(r.headers.get("location"), /m=weeks&day=2026-11-18&n=9&w=2/);
  assert.match(await flash(env, s, r), /class="flash" role="status">Abiertos 9 días nuevos en 2 semanas\./);
  const open = await D.openDays(DB, "2026-11-01", "2026-12-31");
  assert.deepEqual(open, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.equal((await D.slotsBetween(DB, "2026-11-18", "2026-11-18")).length, 1, "no pisa franjas editadas");
  // valor no permitido: una sola semana
  assert.match((await adminDo(env, s, "weeks:2026-11-30", { weeks: "3" })).headers.get("location"), /n=5&w=1/);
  // horizonte de 8 semanas: hoy + 56 días = 11/01/2027
  const far = await adminDo(env, s, "weeks:2026-12-28", { weeks: "8" });
  assert.match(far.headers.get("location"), /n=11&w=8/);
  assert.equal((await D.openDays(DB, "2027-01-12", "2027-12-31")).length, 0);
  assert.match(await flash(env, s, far), /Abiertos 11 días nuevos en 8 semanas\./);
  // semana pasada: no abre nada
  assert.match((await adminDo(env, s, "weeks:2026-11-02", { weeks: "1" })).headers.get("location"), /n=0&w=1/);
  assert.match(await get(env, s, "?m=weeks&n=0&w=2"), /No había días cerrados que abrir de lunes a viernes en 2 semanas\./);
});

test("C25 turnos libres que el público ya no puede reservar (menos de 12 h) se marcan en el panel; Ajustes lo explica", async () => {
  const { DB, env, s } = await admin();
  await D.openDay(DB, "2026-11-16", ["09:00", "21:45", "22:15"]); // ahora 10:00: 21:45 es dentro de 11 h 45; 22:15 dentro de 12 h 15
  await D.openDay(DB, "2026-11-10", ["09:00"]);
  const h = await get(env, s, "?day=2026-11-16");
  const row = (t) => h.slice(h.indexOf(`${t}–`), h.indexOf("</li>", h.indexOf(`${t}–`)));
  assert.match(row("09:00"), /Libre, ya no reservable \(menos de 12 h\)/);
  assert.match(row("21:45"), /Libre, ya no reservable \(menos de 12 h\)/);
  assert.doesNotMatch(row("22:15"), /ya no reservable/);
  assert.match(row("22:15"), /class="tag t-free">Libre</);
  assert.match(await get(env, s, "?day=2026-11-10"), /Libre, ya no reservable \(menos de 12 h\)/, "un día pasado también");
  assert.match(h, /El público solo puede reservar con al menos 12 horas de antelación/);
});

test("C26 quien ya asistió al estudio activo no reserva otra vez con el mismo correo; otro estudio sí", async () => {
  const { DB, env } = await setup();
  ins(DB, { id: "a1", status: "attended", date: "2026-11-10", email: "ana@unidemo.es", study: "study1", time: "08:00" });
  const es = await book(env, { email: "Ana+x@unidemo.es" });
  assert.equal(es.status, 409);
  assert.match(await text(es), /Ya has participado en este estudio con este correo\. Gracias\./);
  const f = await (await import("./helpers.mjs")).goodFields(DB, { email: "ana@unidemo.es" });
  const en = await call(env, req("/reservar?lang=en", { method: "POST", fields: f, ip: "6.6.6.6" }));
  assert.equal(en.status, 409);
  assert.match(await text(en), /You have already taken part in this study with this email\. Thank you\./);
  assert.equal(rows(DB).filter((r) => r.status !== "attended").length, 0);
  await D.setSetting(DB, "active_study", "study2");
  assert.equal((await book(env, { email: "ana@unidemo.es" }, { ip: "8.8.8.8" })).status, 200, "estudio 2: no hay bloqueo");
  // un no-show o una cancelada no bloquean
  ins(DB, { id: "a2", status: "noshow", date: "2026-11-10", email: "luis@unidemo.es", study: "study2", time: "09:00" });
  assert.equal((await book(env, { email: "luis@unidemo.es", slot: `${DAY}T10:30` }, { ip: "9.9.9.9" })).status, 200);
});

test("C27 límite público: 20 envíos cada 10 minutos por IP (el 21 recibe 429)", async () => {
  const { env } = await setup();
  for (let i = 0; i < 20; i++) assert.notEqual((await book(env, { slot: "x" })).status, 429, `envío ${i + 1}`);
  assert.equal((await book(env, { slot: "x" })).status, 429);
  assert.notEqual((await book(env, { slot: "x" }, { now: later(11 * 60_000) })).status, 429, "pasados 10 minutos");
});
