// Ver quién viene y escribirle: Hoy y mañana, filas del día, caducidad, canceladas y CSV.
import test from "node:test";
import assert from "node:assert/strict";
import { NOW, later, DAY, RELAY, call, req, adminDo } from "./helpers.mjs";
import { relay, ins, admin, get } from "./spec_helpers.mjs";

const SUBJ_ES = (dm, t) => encodeURIComponent(`Estudio de realidad virtual: tu turno del ${dm} a las ${t}`);

test("B13 'Hoy y mañana' es el primer bloque: hora, nombre, estado, correo seleccionable, Escribir, enlace al día y Cco", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "t1", date: "2026-11-16", time: "12:15", name: "Ana <i>", email: "ana@unidemo.es", status: "confirmed" });
  ins(DB, { id: "t2", date: "2026-11-16", time: "13:50", name: "Canc", email: "canc@unidemo.es", status: "cancelled" });
  ins(DB, { id: "t3", date: "2026-11-17", time: "09:15", name: "Bea", email: "a&b+c?d=e#f%@unidemo.es", status: "pending", expires_at: "2026-11-16T11:00:00.000Z" });
  ins(DB, { id: "t4", date: "2026-11-17", time: "10:00", name: "Eva", email: "eva@unidemo.es", status: "confirmed", lang: "en" });
  const h = await get(env, s);
  assert.ok(h.indexOf('id="now-title"') < h.indexOf('id="cal-title"'), "antes del calendario");
  assert.match(h, /<h2 id="now-title">Hoy y mañana<\/h2>/);
  const now = h.slice(h.indexOf('id="now-title"'), h.indexOf('id="cal-title"'));
  assert.match(now, /Hoy: lunes, 16 de noviembre <span class="count">1 reserva<\/span>/);
  assert.match(now, /Mañana: martes, 17 de noviembre <span class="count">2 reservas<\/span>/);
  assert.match(now, /12:15–13:00<\/span> <strong>Ana &lt;i&gt;<\/strong> <span class="tag t-confirmed">Confirmada<\/span>/);
  assert.ok(!now.includes("Canc"), "las canceladas no salen");
  assert.match(now, /<span class="addr">ana@unidemo\.es<\/span>/);
  assert.match(now, new RegExp(`href="mailto:ana@unidemo\\.es\\?subject=${SUBJ_ES("16/11", "12:15")}">Escribir</a>`));
  // correo con caracteres especiales: codificado en el mailto y escapado en el HTML
  assert.match(now, /<span class="addr">a&amp;b\+c\?d=e#f%@unidemo\.es<\/span>/);
  assert.match(now, /href="mailto:a%26b%2Bc%3Fd%3De%23f%25@unidemo\.es\?subject=/);
  for (const m of now.matchAll(/href="(mailto:[^"]*)"/g)) assert.ok(!/[<>' ]/.test(m[1]) && !/[^&]#|\?[^s]*\?/.test(m[1].replace(/&amp;/g, "&")), `mailto sin codificar: ${m[1]}`);
  // enlace al panel del día
  assert.match(now, /href="\/admin\?month=2026-11&amp;day=2026-11-16">Abrir el día en el panel/);
  assert.match(now, /href="\/admin\?month=2026-11&amp;day=2026-11-17">Abrir el día en el panel/);
  // Cco: solo con dos o más personas (mañana sí, hoy no)
  assert.equal((now.match(/Escribir a todos \(Cco\)/g) || []).length, 1);
  assert.match(now, /href="mailto:\?bcc=a%26b%2Bc%3Fd%3De%23f%25@unidemo\.es,eva@unidemo\.es&amp;subject=/);
  assert.match(now, new RegExp(`subject=${encodeURIComponent("Estudio de realidad virtual / Virtual reality study: 17/11")}`));
  // reserva en inglés: asunto en inglés
  assert.match(now, new RegExp(`mailto:eva@unidemo\\.es\\?subject=${encodeURIComponent("Virtual reality study: your slot on 17/11 at 10:00")}`));
});

test("B13 'Próximas reservas' empieza pasado mañana, enseña hasta 30 filas y dice cuántas más hay", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "p0", date: "2026-11-17", time: "09:15", email: "p0@unidemo.es", name: "Mañana" });
  for (let i = 0; i < 33; i++) {
    ins(DB, { id: `pp${i}`, date: "2026-11-18", time: `${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${["00", "15", "30", "45"][i % 4]}`, email: `pp${i}@unidemo.es`, name: `Persona ${i}` });
  }
  ins(DB, { id: "far", date: "2026-12-05", time: "09:15", email: "far@unidemo.es", name: "Lejos" });
  const h = await get(env, s);
  const up = h.slice(h.indexOf('id="up-title"'), h.indexOf("</section>", h.indexOf('id="up-title"')));
  assert.equal((up.match(/<li><a href/g) || []).length, 30);
  assert.match(up, /y 3 más en los próximos 14 días\./);
  assert.ok(!up.includes("Mañana</span>"), "mañana ya está en Hoy y mañana");
  assert.ok(!up.includes("Lejos"), "fuera de los 14 días");
});

test("B14 filas del día: dirección seleccionable, enlace Escribir y sin la etiqueta 'Reservado'", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "d1", name: "Luis", email: "luis@unidemo.es", time: "10:30" });
  const h = await get(env, s, `?day=${DAY}`);
  const row = h.slice(h.indexOf('<li class="slot-row s-booked">'));
  assert.match(row, /<span class="addr">luis@unidemo\.es<\/span> · <a class="lnk" href="mailto:luis@unidemo\.es\?subject=/);
  assert.doesNotMatch(row, /t-booked|>Reservado</);
  const css = (await import("node:fs")).readFileSync(new URL("../public/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.addr\{user-select:all/);
});

test("B15 pendientes: 'Caduca a las HH:MM' en hora local y botón para reenviar (solo con relay); el plazo no se alarga", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "w1", status: "pending", name: "Pía", email: "pia@unidemo.es", expires_at: "2026-11-16T11:30:00.000Z", time: "11:30" });
  let h = await get(env, s, `?day=${DAY}`);
  assert.match(h, /Caduca a las 12:30/);
  assert.match(h, /value="resend:w1"[^>]*>Reenviar correo de confirmación/);
  const m = relay();
  let loc = (await adminDo(env, s, "resend:w1", { day: DAY }, NOW, m.fn)).headers.get("location");
  assert.equal(m.calls[0].json.to, "pia@unidemo.es");
  assert.match(m.calls[0].json.text, /hasta las 12:30/, "el plazo es el original");
  assert.equal(DB.raw.prepare("SELECT expires_at FROM bookings WHERE id='w1'").get().expires_at, "2026-11-16T11:30:00.000Z");
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="flash" role="status">Correo de confirmación reenviado a Pía\./);
  assert.match(DB.raw.prepare("SELECT kind FROM mail_log").get().kind, /confirm_request/);
  loc = (await adminDo(env, s, "resend:w1", { day: DAY }, NOW, relay({ ok: false, error: "quota" }).fn)).headers.get("location");
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="error" role="status">El correo a Pía NO se ha enviado \(quota\)\. Escríbele tú: pia@unidemo\.es/);
  // una reserva que no es pendiente no se reenvía
  ins(DB, { id: "w2", status: "confirmed", time: "10:30" });
  assert.match((await adminDo(env, s, "resend:w2", { day: DAY }, NOW, m.fn)).headers.get("location"), /m=state/);
  // sin relay: ni botón
  const off = await admin({});
  ins(off.DB, { id: "w3", status: "pending", expires_at: "2026-11-16T11:30:00.000Z" });
  h = await get(off.env, off.s, `?day=${DAY}`);
  assert.match(h, /Caduca a las 12:30/); assert.doesNotMatch(h, /Reenviar correo/);
});

test("B16 canceladas del día: <details> con hora, nombre y enlace mailto", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "x1", status: "cancelled", name: "Nora & Co", email: "nora@unidemo.es", time: "11:30" });
  const h = await get(env, s, `?day=${DAY}`);
  assert.match(h, /<details class="cancelled"><summary>1 reserva cancelada este día<\/summary>.*11:30–12:15<\/span> <strong>Nora &amp; Co<\/strong> <a class="lnk" href="mailto:nora@unidemo\.es\?subject=/s);
});

test("B17 CSV: columnas, nombre con la fecha de hoy, nota de borrado y protección de fórmulas", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "e1", name: "=CMD()", email: "e1@unidemo.es", status: "attended", lang: "en", study: "study2", reminded: 1, date: "2026-11-10" });
  const r = await call(env, req("/admin/csv", { cookie: s.cookie }));
  assert.equal(r.headers.get("content-disposition"), 'attachment; filename="reservas-2026-11-16.csv"');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM para Excel");
  const csv = buf.toString("utf8");
  assert.match(csv, /^\uFEFFalias,correo,estudio,fecha,hora,estado,idioma,recordatorio,correo_confirmado\r\n/);
  assert.match(csv, /"'=CMD\(\)","e1@unidemo\.es","2","2026-11-10","09:30","asistió","en","sí"/);
  assert.match(await get(env, s), /Los datos de las reservas se borran 30 días después del turno: exporta antes\./);
});
