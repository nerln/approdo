// "Disponible hoy": turnos flexibles del mismo día. Ahora = lunes 16/11/2026, 10:00 en hora local.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { flexStarts, flexAllows, hhmmToMin as m, minToHhmm } from "../src/slots.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, req, call, book, rows, adminSession, adminDo } from "./helpers.mjs";
import { admin, get, PW, ins } from "./spec_helpers.mjs";

const TODAY = "2026-11-16";
const hh = (xs) => xs.map(minToHhmm);
const fs = (o) => hh(flexStarts({ busy: [], nowMin: m("10:00"), fromMin: m("00:00"), untilMin: m("17:00"), ...o }));
const today = (t) => `${TODAY}T${t}`;

test("flexStarts: dia vacio, redondeo a 5 min, ultimo turno acaba justo en until", () => {
  assert.deepEqual(fs({}), ["10:20", "11:05", "11:50", "12:35", "13:20", "14:05", "14:50", "15:35"]);
  assert.deepEqual(fs({ nowMin: m("10:03") }), ["10:25", "11:10", "11:55", "12:40", "13:25", "14:10", "14:55", "15:40"]);
  // 15:40 + 45 = 16:25 <= 16:25: el ultimo acaba exactamente en until
  assert.deepEqual(fs({ nowMin: m("10:03"), untilMin: m("16:25") }).at(-1), "15:40");
  assert.deepEqual(fs({ nowMin: m("10:03"), untilMin: m("16:24") }).at(-1), "14:55");
});

test("flexStarts: nada despues de until y desde mas tarde que ahora", () => {
  assert.deepEqual(fs({ nowMin: m("16:30") }), []);
  assert.deepEqual(fs({ nowMin: m("16:00") }), []); // 16:20 + 45 > 17:00
  assert.deepEqual(fs({ nowMin: m("16:15") }), []);
  assert.deepEqual(fs({ nowMin: m("15:35") }), ["15:55"]);
  assert.deepEqual(fs({ fromMin: m("14:00") }), ["14:00", "14:45", "15:30", "16:15"]);
  assert.deepEqual(fs({ fromMin: m("14:01") }), ["14:05", "14:50", "15:35"]);
});

test("flexStarts: se empaqueta alrededor de una y dos reservas", () => {
  // una reserva 11:00-11:45: antes cabe 10:20 (acaba 11:05 > 11:00) no; despues empieza a las 11:45
  assert.deepEqual(fs({ busy: [m("11:00")] }), ["11:45", "12:30", "13:15", "14:00", "14:45", "15:30", "16:15"]);
  // una reserva 11:30 deja el hueco 10:20-11:30 (70 min): un turno, y despues desde 12:15
  assert.deepEqual(fs({ busy: [m("11:30")] }), ["10:20", "12:15", "13:00", "13:45", "14:30", "15:15", "16:00"]);
  // dos reservas: 10:30 y 12:00: hueco 10:20-10:30 vacio, 11:15-12:00 un turno, luego 12:45...
  assert.deepEqual(fs({ busy: [m("12:00"), m("10:30")] }), ["11:15", "12:45", "13:30", "14:15", "15:00", "15:45"]);
  // reserva pasada (antes de ahora) no estorba
  assert.deepEqual(fs({ busy: [m("09:00")] }), fs({}));
});

test("flexAllows: margen, rejilla, solape por ambos lados y ventana", () => {
  const o = { nowMin: m("10:00"), fromMin: m("00:00"), untilMin: m("17:00"), busy: [] };
  assert.equal(flexAllows({ ...o, startMin: m("10:15") }), true, "margen de 5 min");
  assert.equal(flexAllows({ ...o, startMin: m("10:10") }), false, "demasiado pronto");
  assert.equal(flexAllows({ ...o, startMin: m("10:21") }), false, "fuera de la rejilla de 5");
  assert.equal(flexAllows({ ...o, startMin: m("16:15") }), true);
  assert.equal(flexAllows({ ...o, startMin: m("16:20") }), false, "acabaria despues de until");
  assert.equal(flexAllows({ ...o, fromMin: m("12:00"), startMin: m("11:55") }), false, "antes de from");
  const b = { ...o, busy: [m("12:00")] };
  assert.equal(flexAllows({ ...b, startMin: m("11:20") }), false, "pisa por la izquierda");
  assert.equal(flexAllows({ ...b, startMin: m("11:15") }), true, "justo 45 antes");
  assert.equal(flexAllows({ ...b, startMin: m("12:40") }), false, "pisa por la derecha");
  assert.equal(flexAllows({ ...b, startMin: m("12:45") }), true, "justo 45 despues");
  assert.equal(flexAllows({ ...b, startMin: m("12:00") }), false);
});

test("pagina publica: horas flexibles de hoy y (hoy) solo con flex activo", async () => {
  const { DB, env } = await setup();
  let h = await (await call(env, req("/"))).text();
  assert.ok(!h.includes(today("10:20"))); assert.ok(!h.includes("(hoy)"));
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  h = await (await call(env, req("/"))).text();
  assert.ok(h.includes(today("10:20"))); assert.ok(h.includes(today("15:35"))); assert.ok(!h.includes(today("16:20")));
  assert.match(h, /<legend>[^<]*\(hoy\)<\/legend>/);
  assert.ok(h.indexOf(TODAY) < h.indexOf(DAY), "hoy es el primer dia");
  assert.match(h, new RegExp(`${DAY}T09:30`), "los otros dias no cambian");
  const en = await (await call(env, req("/?lang=en"))).text();
  assert.match(en, /\(today\)<\/legend>/);
  await D.clearFlex(DB, TODAY);
  h = await (await call(env, req("/"))).text();
  assert.ok(!h.includes("(hoy)"));
});

test("reservar con 20 minutos de antelacion funciona; solape, ventana y demasiado pronto se rechazan", async () => {
  const { DB, env } = await setup();
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  const ok = await book(env, { slot: today("10:20") }, { ip: "2.2.2.2" });
  assert.equal(ok.status, 200);
  assert.equal(rows(DB).length, 1);
  assert.equal(rows(DB)[0].time, "10:20");
  assert.equal(rows(DB)[0].status, "confirmed");
  // 11:00 pisa 10:20-11:05
  const over = await book(env, { slot: today("11:00"), email: "b@unidemo.es" }, { ip: "3.3.3.3" });
  assert.equal(over.status, 409);
  assert.equal(rows(DB).length, 1);
  // justo despues sí
  assert.equal((await book(env, { slot: today("11:05"), email: "c@unidemo.es" }, { ip: "4.4.4.4" })).status, 200);
  // muy pronto, fuera de rejilla, fuera de ventana
  for (const [i, t] of ["10:05", "12:37", "16:20", "17:00"].entries()) {
    const r = await book(env, { slot: today(t), email: `x${i}@unidemo.es` }, { ip: `5.5.5.${i}` });
    assert.equal(r.status, 409, t);
  }
  assert.equal(rows(DB).length, 2);
});

test("sin flex una franja de hoy se rechaza como siempre; con flex la fija de hoy tampoco vale", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, TODAY, ["10:30", "18:00"]);
  assert.equal((await book(env, { slot: today("10:30") })).status, 409);
  assert.equal(rows(DB).length, 0);
  assert.equal((await book(env, { slot: today("10:20") }, { ip: "2.2.2.2" })).status, 409);
});

test("franjas fijas de otro dia siguen valiendo y dos a 45 minutos caben", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, "2026-11-19", ["09:15", "10:00"]);
  await D.setFlex(DB, TODAY, "10:00", "17:00"); // el flex de hoy no toca otros dias
  assert.equal((await book(env, { slot: "2026-11-19T09:15" })).status, 200);
  assert.equal((await book(env, { slot: "2026-11-19T10:00", email: "b@unidemo.es" }, { ip: "6.6.6.6" })).status, 200);
  assert.equal(rows(DB).length, 2);
});

test("D.insertBooking: dos inserciones que se pisan, la segunda da taken; el mismo correo sigue dando email", async () => {
  const { DB } = await setup();
  const mk = (id, time, email, date = TODAY) => ({ id, token: id.padEnd(30, "x"), study: "study1", date, time, name: "A", email, email_key: email, status: "confirmed", created_at: NOW.toISOString(), lang: "es" });
  assert.deepEqual(await D.insertBooking(DB, mk("a1", "11:25", "a@unidemo.es")), { ok: true });
  assert.deepEqual(await D.insertBooking(DB, mk("a2", "11:30", "b@unidemo.es")), { ok: false, reason: "taken" });
  assert.deepEqual(await D.insertBooking(DB, mk("a3", "10:45", "c@unidemo.es")), { ok: false, reason: "taken" });
  assert.deepEqual(await D.insertBooking(DB, mk("a4", "11:25", "d@unidemo.es")), { ok: false, reason: "taken" });
  assert.deepEqual(await D.insertBooking(DB, mk("a5", "12:10", "e@unidemo.es")), { ok: true });
  assert.deepEqual(await D.insertBooking(DB, mk("a6", "09:40", "a@unidemo.es")), { ok: false, reason: "email" });
  assert.deepEqual(await D.insertBooking(DB, mk("a7", "11:30", "f@unidemo.es", "2026-11-17")), { ok: true }, "otro dia no cuenta");
  DB.raw.prepare("UPDATE bookings SET status='cancelled' WHERE id='a1'").run();
  assert.deepEqual(await D.insertBooking(DB, mk("a8", "11:25", "g@unidemo.es")), { ok: true }, "una cancelada no bloquea");
  assert.equal(rows(DB).length, 4);
});

test("pendiente con relay: la caducidad de un turno flexible no pasa del inicio; el correo y la pagina lo dicen", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  const mf = mockFetch();
  const r = await book(env, { slot: today("10:20") }, { fetchFn: mf.fn });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /hasta las 10:20/);
  assert.ok(!h.includes("2 horas"), "la página no promete 2 horas");
  const b = rows(DB)[0];
  assert.equal(b.status, "pending");
  assert.equal(b.expires_at, "2026-11-16T09:20:00.000Z"); // 10:20 local
  assert.match(mf.calls.mail[0].json.text, /hasta las 10:20/);
  assert.ok(!mf.calls.mail[0].json.text.includes("Tienes 2 horas"));
  // un turno de mas de 2 h por delante conserva las 2 h
  const r2 = await book(env, { slot: today("14:05"), email: "b@unidemo.es" }, { fetchFn: mf.fn, ip: "7.7.7.7" });
  assert.equal(r2.status, 200);
  assert.equal(rows(DB).find((x) => x.time === "14:05").expires_at, "2026-11-16T11:00:00.000Z");
  assert.match(mf.calls.mail[1].json.text, /Tienes 2 horas/);
  // franja fija de otro dia: 2 h
  const r3 = await book(env, { email: "c@unidemo.es" }, { fetchFn: mf.fn, ip: "8.8.8.8" });
  assert.equal(r3.status, 200);
  assert.equal(rows(DB).find((x) => x.date === DAY).expires_at, "2026-11-16T11:00:00.000Z");
});

test("admin: el verbo flex-on pide sesion y CSRF, valida horas, activa y desactiva", async () => {
  const { DB, env, s } = await admin();
  // sin sesion
  const r0 = await call(env, req("/admin/do", { method: "POST", fields: { do: "flex-on", flex_from: "10:00", flex_until: "17:00" } }));
  assert.equal(r0.status, 401);
  assert.equal(await D.getFlex(DB, TODAY), null);
  // CSRF malo
  const r1 = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "mal", do: "flex-on", flex_from: "10:00", flex_until: "17:00" } }));
  assert.equal(r1.status, 403);
  assert.equal(await D.getFlex(DB, TODAY), null);
  // horas malas
  for (const [a, z] of [["25:00", "17:00"], ["10:00", "abc"], ["", ""], ["17:00", "10:00"], ["10:00", "10:00"]]) {
    const r = await adminDo(env, s, "flex-on", { flex_from: a, flex_until: z });
    assert.match(r.headers.get("location"), /m=bad-flex/);
    assert.equal(await D.getFlex(DB, TODAY), null);
  }
  // bien
  const ok = await adminDo(env, s, "flex-on", { flex_from: "10:00", flex_until: "17:00" });
  assert.match(ok.headers.get("location"), /m=flex-on/);
  assert.deepEqual(await D.getFlex(DB, TODAY), { from: "10:00", until: "17:00" });
  const h = await get(env, s);
  assert.match(h, /Disponible hoy de 10:00 a 17:00\. El público puede reservar con 20 minutos de antelación\./);
  assert.match(h, /10:20, 11:05/);
  assert.match(h, /Desactivar/);
  assert.match(h, /salvo hoy si activas «Disponible hoy» \(20 minutos/);
  assert.match(h, /al menos 12 horas de antelación/);
  const off = await adminDo(env, s, "flex-off");
  assert.match(off.headers.get("location"), /m=flex-off/);
  assert.equal(await D.getFlex(DB, TODAY), null);
  assert.ok(!(await get(env, s)).includes("Disponible hoy de"));
  assert.match(await get(env, s), /Activar/);
});

test("admin: sin hueco dice que no cabe ningun turno", async () => {
  const { DB, env, s } = await admin();
  await D.setFlex(DB, TODAY, "10:00", "10:30");
  assert.match(await get(env, s), /Ahora mismo no cabe ningún turno\./);
});

test("admin: una reserva flexible sale en el panel del dia y en Hoy y mañana, y se marca asistió tras empezar", async () => {
  const { DB, env, s } = await admin();
  ins(DB, { id: "flx1", date: TODAY, time: "10:20", name: "Flexi", status: "confirmed" });
  ins(DB, { id: "flx2", date: TODAY, time: "09:05", name: "Antes", status: "confirmed" });
  let h = await get(env, s);
  assert.match(h, /10:20–11:05/); assert.match(h, /Flexi/);
  assert.ok(h.indexOf("Antes") < h.indexOf("Flexi"), "en orden de hora");
  assert.match(h, /Aún no ha empezado/);
  const bad = await adminDo(env, s, "attended:flx1");
  assert.match(bad.headers.get("location"), /m=not-started/);
  const t = later(30 * 60_000); // 10:30, ya ha empezado
  const s2 = await adminSession(env, t);
  const ok = await adminDo(env, s2, "attended:flx1", {}, t);
  assert.match(ok.headers.get("location"), /m=marked/);
  assert.equal(rows(DB).find((x) => x.id === "flx1").status, "attended");
  const csv = await (await call(env, req("/admin/csv", { cookie: s2.cookie }), t)).text();
  assert.match(csv, /Flexi.*10:20/);
});

test("cleanup borra las claves flex de dias pasados y deja hoy y los dias futuros", async () => {
  const { DB } = await setup();
  await D.setFlex(DB, "2026-11-15", "10:00", "17:00");
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  await D.setFlex(DB, "2026-11-17", "10:00", "17:00");
  await D.cleanup(DB, NOW.getTime(), TODAY);
  const keys = DB.raw.prepare("SELECT key FROM settings WHERE key LIKE 'flex:%' ORDER BY key").all().map((x) => x.key);
  assert.deepEqual(keys, [`flex:${TODAY}`, "flex:2026-11-17"]);
});

test("getFlex: JSON roto o horas invalidas equivalen a sin flex", async () => {
  const { DB } = await setup();
  for (const v of ["no json", '{"from":"25:00","until":"17:00"}', '{"from":"12:00","until":"11:00"}', "null", "{}"]) {
    await D.setSetting(DB, `flex:${TODAY}`, v);
    assert.equal(await D.getFlex(DB, TODAY), null, v);
  }
  assert.equal(await D.getFlex(DB, "2030-01-01"), null);
});

// ---- regresiones de la revision ----
test("con flex y sin hueco no se ofrecen las franjas fijas de hoy (de madrugada)", async () => {
  const { DB, env } = await setup();
  const now = new Date("2026-11-15T23:05:00Z"); // 00:05 del 16 en hora local
  await D.openDay(DB, TODAY, ["12:30"]);
  await D.setFlex(DB, TODAY, "09:00", "09:30"); // no cabe ningun turno
  const page = await (await call(env, req("/"), now)).text();
  assert.ok(!page.includes(today("12:30")));
  assert.equal((await book(env, { slot: today("12:30") }, { now })).status, 409);
});

test("admin: no deja abrir una franja a menos de 45 min de otra del mismo dia", async () => {
  const { DB, env, s } = await admin();
  await D.openDay(DB, "2026-11-18", ["09:30", "10:30"]);
  const r = await adminDo(env, s, "slot:2026-11-18T10:00");
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location") || "", /m=slot-near/);
  assert.equal(await D.isSlotOpen(DB, "2026-11-18", "10:00"), false);
  const ok = await adminDo(env, s, "slot:2026-11-18T12:30");
  assert.match(ok.headers.get("location") || "", /m=slot(&|$)/);
});

test("el aviso del formulario habla del inicio del turno solo cuando hay flex y relay", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const off = await (await call(env, req("/"))).text();
  assert.ok(!off.includes("hasta la hora del turno"));
  await D.setFlex(DB, TODAY, "10:00", "17:00");
  const on = await (await call(env, req("/"))).text();
  assert.ok(on.includes("hasta la hora del turno"));
});
