// Resultado de los correos: sendMail, registro, avisos del panel, recordatorios, prueba y relay apagado.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { sendMail } from "../src/mail.js";
import { NOW, later, DAY, RELAY, setup, call, req, book, tokenFrom, rows, adminDo } from "./helpers.mjs";
import { relay, ins, admin, get, text, PW } from "./spec_helpers.mjs";
import { hmacHex } from "../src/util.js";

const flashOf = (loc) => { const u = new URL("https://x" + loc); return u.searchParams; };
const logRows = (DB) => DB.raw.prepare("SELECT * FROM mail_log ORDER BY id").all();
const TOMORROW_RUN = new Date("2026-11-17T09:00:00Z"); // mañana = 18/11 = DAY

test("A1 sendMail devuelve { ok, error }: ok, campo error del relay, http <estado>, network, sin relay", async () => {
  const msg = { to: "a@unidemo.es", subject: "s", text: "t", html: "h" };
  assert.deepEqual(await sendMail(RELAY, msg, relay({ ok: true }).fn), { ok: true, error: "" });
  assert.deepEqual(await sendMail(RELAY, msg, relay({ ok: false, error: "quota" }).fn), { ok: false, error: "quota" });
  assert.deepEqual(await sendMail(RELAY, msg, relay({ status: 500 }).fn), { ok: false, error: "http 500" });
  assert.deepEqual(await sendMail(RELAY, msg, relay("throw").fn), { ok: false, error: "network" });
  const none = await sendMail({}, msg, relay().fn);
  assert.equal(none.ok, false);
  assert.equal(typeof none.error, "string");
});

test("A2/A3 cada correo de una reserva deja una fila en mail_log (kinds, ok, err, hora ISO)", async () => {
  const { DB, env } = await setup({ ...RELAY, ADMIN_EMAIL: "adm@example.org" });
  const m = relay();
  await book(env, {}, { fetchFn: m.fn });
  const token = tokenFrom(m.calls[0].json.text);
  await call(env, req(`/c/${token}`, { method: "POST" }), later(60_000), m.fn);
  await call(env, req(`/x/${token}`, { method: "POST" }), later(120_000), m.fn);
  const l = logRows(DB);
  assert.deepEqual(l.map((r) => r.kind), ["confirm_request", "confirmed", "admin", "admin"]);
  assert.ok(l.every((r) => r.ok === 1 && r.err === null && r.booking_id === rows(DB)[0].id));
  assert.equal(l[0].at, NOW.toISOString());
  assert.equal(m.calls[3].json.subject, "Cancelada por la persona: 18/11 09:30");
  assert.equal(DB.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'ix_mail_booking'").all().length, 1);
});

test("A2 sin la tabla mail_log nada se rompe: reservar, confirmar, cancelar, panel y limpieza", async () => {
  const { DB, env } = await admin({ ...RELAY });
  DB.raw.exec("DROP TABLE mail_log");
  const m = relay();
  const r = await book(env, {}, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const token = tokenFrom(m.calls[0].json.text);
  assert.equal((await call(env, req(`/c/${token}`, { method: "POST" }), later(1000), m.fn)).status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  const { cookie } = await (await import("./helpers.mjs")).adminSession(env, later(1500));
  const page = await call(env, req(`/admin?day=${DAY}`, { cookie }), later(2000));
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /Correos:/);
  assert.equal((await call(env, req(`/x/${token}`, { method: "POST" }), later(3000), m.fn)).status, 200);
  assert.equal(rows(DB)[0].status, "cancelled");
  assert.equal((await call(env, req("/"), later(4000))).status, 200, "limpieza tolerante");
});

test("A2 limpieza: borra filas de mail_log de más de 60 días y deja las de menos", async () => {
  const { DB, env } = await setup();
  const ins2 = DB.raw.prepare("INSERT INTO mail_log (booking_id, kind, ok, err, at) VALUES ('x', 'reminder', 1, NULL, ?)");
  ins2.run(new Date(NOW.getTime() - 61 * 86400_000).toISOString());
  ins2.run(new Date(NOW.getTime() - 59 * 86400_000).toISOString());
  await call(env, req("/"));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM mail_log").get().n, 1);
});

test("A4 el panel del día muestra 'Correos:' con hora local, lo enviado y lo fallido; nada sin filas", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const a = ins(DB, { id: "ba", time: "09:30" });
  ins(DB, { id: "bb", time: "10:30" });
  const at = (iso) => iso;
  DB.raw.prepare("INSERT INTO mail_log (booking_id, kind, ok, err, at) VALUES (?,?,?,?,?)").run(a.id, "confirmed", 1, null, at("2026-11-12T09:02:00.000Z"));
  DB.raw.prepare("INSERT INTO mail_log (booking_id, kind, ok, err, at) VALUES (?,?,?,?,?)").run(a.id, "reminder", 0, "quota", at("2026-11-17T09:00:00.000Z"));
  const h = await get(env, s, `?day=${DAY}`);
  assert.match(h, /Correos: confirmación enviada 12\/11 10:02 · recordatorio NO enviado 17\/11 10:00 \(quota\)/);
  assert.equal((h.match(/Correos:/g) || []).length, 1, "sin fila no se muestra la línea");
});

test("A5 cancelar desde el panel: el aviso depende del resultado y nombra a la persona; no se avisa al investigador", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const b1 = ins(DB, { id: "c1", name: "Ana <b>", email: "ana@unidemo.es", time: "09:30" });
  const b2 = ins(DB, { id: "c2", name: "Bea", email: "bea@unidemo.es", time: "10:30" });
  const ok = relay();
  let loc = (await adminDo(env, s, `cancel:${b1.id}`, { day: DAY }, NOW, ok.fn)).headers.get("location");
  assert.equal(ok.calls.length, 1, "solo el correo a la persona");
  assert.equal(ok.calls[0].json.to, "ana@unidemo.es");
  let h = await get(env, s, loc.replace("/admin", ""));
  assert.match(h, /class="flash" role="status">Reserva de Ana &lt;b&gt; cancelada\. Aviso enviado por correo\./);
  const bad = relay({ ok: false, error: "quota" });
  loc = (await adminDo(env, s, `cancel:${b2.id}`, { day: DAY }, NOW, bad.fn)).headers.get("location");
  h = await get(env, s, loc.replace("/admin", ""));
  assert.match(h, /class="error" role="status">Reserva de Bea cancelada, pero el correo NO se ha enviado \(quota\)\. Escríbele tú: bea@unidemo\.es/);
  assert.equal(rows(DB).find((r) => r.id === b2.id).status, "cancelled");
  assert.deepEqual(logRows(DB).map((r) => [r.kind, r.ok, r.err]), [["cancelled", 1, null], ["cancelled", 0, "quota"]]);
  // relay apagado
  const off = await admin({});
  const b3 = ins(off.DB, { id: "c3", name: "Eva", email: "eva@unidemo.es" });
  loc = (await adminDo(off.env, off.s, `cancel:${b3.id}`, { day: DAY })).headers.get("location");
  h = await get(off.env, off.s, loc.replace("/admin", ""));
  assert.match(h, /class="error" role="status">Reserva de Eva cancelada\. Los correos están desactivados: avisa tú a eva@unidemo\.es\./);
});

test("A6 mensaje opcional en la cancelación: caja con textarea (máx. 500), párrafo propio, texto plano escapado", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const b = ins(DB, { id: "n1", name: "Luis", email: "luis@unidemo.es" });
  const h = await get(env, s, `?day=${DAY}`);
  assert.match(h, /Mensaje para Luis \(opcional\)<\/label><textarea id="note-n1" name="note_n1" maxlength="500"/);
  const m = relay();
  await adminDo(env, s, `cancel:${b.id}`, { day: DAY, note_n1: `Lo siento.\nHay una avería <b>grave</b>.${"x".repeat(600)}` }, NOW, m.fn);
  const sent = m.calls[0].json;
  const note = sent.text.split("\n\n")[2];
  assert.match(note, /^Lo siento\.\nHay una avería <b>grave<\/b>\.x+$/);
  assert.equal(note.length, 500, "recortado a 500");
  assert.doesNotMatch(sent.text, /motivos técnicos/, "ya no hay motivo fijo");
  assert.match(sent.html, /<p>Lo siento\.<br>Hay una avería &lt;b&gt;grave&lt;\/b&gt;\./);
  // sin nota: ningún párrafo extra
  const b2 = ins(DB, { id: "n2", email: "n2@unidemo.es", time: "10:30" });
  const m2 = relay();
  await adminDo(env, s, `cancel:${b2.id}`, { day: DAY }, NOW, m2.fn);
  assert.equal(m2.calls[0].json.text.split("\n\n").length, 3);
});

test("A7 Proponer otro turno: details.confirm con mensaje opcional y aviso según el resultado", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const b = ins(DB, { id: "r1", status: "noshow", name: "Rosa", email: "rosa@unidemo.es" });
  const h = await get(env, s, `?day=${DAY}`);
  assert.match(h, /<details class="confirm"><summary>Proponer otro turno<\/summary>.*Mensaje para Rosa \(opcional\).*value="rebook:r1"/s);
  const m = relay();
  let loc = (await adminDo(env, s, "rebook:r1", { day: DAY, note_r1: "Ven cuando quieras." }, NOW, m.fn)).headers.get("location");
  assert.match(m.calls[0].json.text, /\n\nVen cuando quieras\.\n/);
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="flash" role="status">Propuesta enviada a Rosa\./);
  loc = (await adminDo(env, s, "rebook:r1", { day: DAY }, NOW, relay({ ok: false, error: "quota" }).fn)).headers.get("location");
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="error" role="status">El correo a Rosa NO se ha enviado \(quota\)\. Escríbele tú: rosa@unidemo\.es/);
  assert.deepEqual(logRows(DB).map((r) => [r.kind, r.ok]), [["noshow", 1], ["noshow", 0]]);
  void b;
});

test("A8 recordatorios del panel: se reclaman antes de enviar, un fallo se reintenta, avisos por resultado", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "m1", date: "2026-11-17", time: "09:30", email: "m1@unidemo.es" });
  ins(DB, { id: "m2", date: "2026-11-17", time: "10:30", email: "m2@unidemo.es" });
  // el primero falla, el segundo sale
  const m = relay((j) => (j.to === "m1@unidemo.es" ? { ok: false, error: "quota" } : { ok: true }));
  let loc = (await adminDo(env, s, "remind", {}, NOW, m.fn)).headers.get("location");
  assert.equal(DB.raw.prepare("SELECT reminded FROM bookings WHERE id='m1'").get().reminded, 0, "fallo: se libera para reintentar");
  assert.equal(DB.raw.prepare("SELECT reminded FROM bookings WHERE id='m2'").get().reminded, 1);
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="error" role="status">Recordatorios de mañana: 1 enviados, 1 fallidos\./);
  // la siguiente llamada reintenta solo el fallido
  const m2 = relay();
  loc = (await adminDo(env, s, "remind", {}, NOW, m2.fn)).headers.get("location");
  assert.deepEqual(m2.calls.map((c) => c.json.to), ["m1@unidemo.es"]);
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="flash" role="status">Recordatorios de mañana: 1 enviados, 0 fallidos\./);
  // ya no queda nada
  loc = (await adminDo(env, s, "remind", {}, NOW, m2.fn)).headers.get("location");
  assert.match(await get(env, s, loc.replace("/admin", "")), /No hay turnos confirmados mañana sin recordatorio\./);
  assert.equal(m2.calls.length, 1);
  // reserva ya reclamada por otro proceso: no se envía
  DB.raw.prepare("UPDATE bookings SET reminded = 0 WHERE id='m1'").run();
  assert.equal(await D.claimReminder(DB, "m1"), true);
  assert.equal(await D.claimReminder(DB, "m1"), false, "la segunda reclamación no cambia ninguna fila");
});

test("A8 /cron/remind: responde { ok, sent, failed }, guarda cron_result y reintenta lo fallido", async () => {
  const { DB, env } = await setup({ ...RELAY });
  ins(DB, { id: "k1", email: "k1@unidemo.es" });
  ins(DB, { id: "k2", email: "k2@unidemo.es", time: "10:30" });
  const cron = async (fetchFn, now = TOMORROW_RUN) => {
    const body = JSON.stringify({ ts: now.getTime() });
    const sig = await hmacHex(RELAY.MAIL_RELAY_KEY, body);
    return call(env, new Request(`https://estudio-vr-demo.workers.dev/cron/remind?sig=${sig}`, { method: "POST", body }), now, fetchFn);
  };
  const m = relay((j) => (j.to === "k2@unidemo.es" ? { ok: false, error: "quota" } : { ok: true }));
  assert.deepEqual(await (await cron(m.fn)).json(), { ok: true, sent: 1, failed: 1 });
  assert.deepEqual(JSON.parse(await D.getSetting(DB, "cron_result")), { at: TOMORROW_RUN.toISOString(), sent: 1, failed: 1 });
  const m2 = relay();
  assert.deepEqual(await (await cron(m2.fn)).json(), { ok: true, sent: 1, failed: 0 });
  assert.deepEqual(m2.calls.map((c) => c.json.to), ["k2@unidemo.es"]);
});

test("A8 la lista de puesta en marcha muestra la última llamada en hora local y solo es 'Listo' si tiene menos de 26 h", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.setSetting(DB, "cron_result", JSON.stringify({ at: "2026-11-15T09:00:00.000Z", sent: 3, failed: 1 }));
  let h = await get(env, s);
  assert.match(h, /<li class="ok">Listo: recordatorios automáticos el día antes \(última llamada: 15\/11 10:00, 3 enviados, 1 fallidos\)/);
  await D.setSetting(DB, "cron_result", JSON.stringify({ at: "2026-11-15T07:00:00.000Z", sent: 3, failed: 0 }));
  h = await get(env, s);
  assert.match(h, /<li class="todo">Pendiente: recordatorios automáticos el día antes \(última llamada: 15\/11 08:00/, "27 h: pendiente");
});

test("A9 correo de prueba al ADMIN_EMAIL: aviso de éxito y de fallo con el error", async () => {
  const { DB, env, s } = await admin({ ...RELAY, ADMIN_EMAIL: "yo@example.org" });
  const m = relay();
  let loc = (await adminDo(env, s, "testmail", {}, NOW, m.fn)).headers.get("location");
  assert.equal(m.calls[0].json.to, "yo@example.org");
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="flash" role="status">Correo de prueba enviado a yo@example\.org\./);
  loc = (await adminDo(env, s, "testmail", {}, NOW, relay({ ok: false, error: "quota" }).fn)).headers.get("location");
  assert.match(await get(env, s, loc.replace("/admin", "")), /class="error" role="status">El correo de prueba NO se ha enviado: quota/);
  assert.deepEqual(logRows(DB).map((r) => [r.kind, r.ok]), [["test", 1], ["test", 0]]);
  assert.match(await get(env, s), /value="testmail"[^>]*>Enviar correo de prueba/);
});

test("A10 relay apagado: banner siempre visible arriba del panel; con relay no aparece", async () => {
  const off = await admin({});
  const h = await get(off.env, off.s);
  assert.match(h, /<p class="banner" role="note">Los correos están desactivados\. Las reservas se confirman al instante y no se envía ningún correo, ni a la persona ni a ti\. Para activarlos: Ajustes &gt; Puesta en marcha\./);
  assert.ok(h.indexOf('class="banner"') < h.indexOf('id="now-title"'), "arriba del todo");
  assert.match(await get(off.env, off.s, `?day=${DAY}&month=2026-11`), /class="banner"/);
  const on = await admin({ ...RELAY });
  assert.doesNotMatch(await get(on.env, on.s), /class="banner"/);
  assert.match(await get(off.env, off.s), /value="testmail"[^>]*disabled/);
});

test("A11 fallo del relay al reservar: se borra la reserva, mensaje nuevo ES/EN, mail_fail_last y línea de la lista", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const bad = relay({ ok: false, error: "quota" });
  const es = await book(env, {}, { fetchFn: bad.fn });
  assert.equal(es.status, 502);
  assert.equal(rows(DB).length, 0);
  assert.match(await text(es), /No hemos podido enviar el correo ahora mismo\. Inténtalo de nuevo en unos minutos\. Si sigue fallando, comprueba la dirección\./);
  const last = JSON.parse(await D.getSetting(DB, "mail_fail_last"));
  assert.deepEqual(last, { at: NOW.toISOString(), error: "quota" });
  const f = await (await import("./helpers.mjs")).goodFields(DB, {});
  const en = await call(env, req("/reservar?lang=en", { method: "POST", fields: f, ip: "7.7.7.7" }), NOW, bad.fn);
  assert.match(await text(en), /We could not send the email right now\. Please try again in a few minutes\. If it keeps failing, check the address\./);
  assert.match(await get(env, s), /último fallo al enviar: 16\/11 10:00 \(quota\)/);
});

test("A12 si falla el correo 'confirmado' la reserva sigue confirmada y el fallo queda en el registro", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const ok = relay();
  await book(env, {}, { fetchFn: ok.fn });
  const token = tokenFrom(ok.calls[0].json.text);
  const bad = relay({ ok: false, error: "quota" });
  const r = await call(env, req(`/c/${token}`, { method: "POST" }), later(1000), bad.fn);
  assert.equal(r.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.deepEqual(logRows(DB).filter((x) => x.ok === 0).map((x) => [x.kind, x.err]), [["confirmed", "quota"], ["admin", "quota"]]);
});
