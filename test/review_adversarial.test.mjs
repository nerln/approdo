// Pruebas de rutas hostiles y casos limite.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { NOW, later, DAY, RELAY, call, req, adminDo, book, tokenFrom, rows } from "./helpers.mjs";
import { relay, ins, admin, get, text } from "./spec_helpers.mjs";

test("R1 nombre y nota hostiles: el panel y los correos los escapan, el asunto no lleva saltos de linea", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "h1", date: DAY, time: "09:30", name: '<b>x</b> "a&b"', email: "h+1@unidemo.es", status: "confirmed" });
  const h = await get(env, s, `?day=${DAY}`);
  assert.ok(!h.includes("<b>x</b>"));
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt; &quot;a&amp;b&quot;/);
  const m = relay();
  const note = "</textarea><script>alert(1)</script>\r\nBcc: evil@x.com";
  const r = await adminDo(env, s, "cancel:h1", { day: DAY, note_h1: note }, NOW, m.fn);
  assert.match(r.headers.get("location"), /m=cancel-ok/);
  const sent = m.calls[0].json;
  assert.ok(!/[\r\n]/.test(sent.subject), "asunto sin saltos");
  assert.ok(!sent.html.includes("<script>") && !sent.html.includes("</textarea>"), "html escapado");
  assert.match(sent.html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.ok(!/<b>x<\/b>/.test(sent.html));
  // flash con datos hostiles en la URL
  const f = await get(env, s, "?m=cancel-fail&a=%3Cb%3Ex%3C%2Fb%3E&x=%22q%22&e=%3Cscript%3E");
  assert.ok(!f.includes("<b>x</b>") && !f.includes("<script>alert") && !/<script>(?!\s*<)/.test(f.replace(/<script[^>]*src[^>]*><\/script>/g, "")));
});

test("R2 invitar: direcciones con + y comillas, texto con </textarea>; sin sesión o sin CSRF no hace nada", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  const r = await adminDo(env, s, "invite", { addresses: 'a+b@unidemo.es, "q"@unidemo.es, <c@unidemo.es>, </textarea><b>@x.es\nA+B@Unidemo.es', invlang: "es" });
  assert.equal(r.status, 200);
  const h = await text(r);
  assert.ok(!h.includes("</textarea><b>"));
  assert.match(h, /href="mailto:\?bcc=a%2Bb%40unidemo\.es|href="mailto:\?bcc=a%2Bb@unidemo\.es/);
  const before = DB.raw.prepare("SELECT count(*) n FROM bookings").get().n;
  const noCsrf = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: "invite", addresses: "a@unidemo.es" } }));
  assert.equal(noCsrf.status, 403);
  const noSess = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: "invite", addresses: "a@unidemo.es" } }));
  assert.equal(noSess.status, 401);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM bookings").get().n, before);
});

test("R3 sin mail_log: reenviar, cancelar, recordatorios y prueba del panel no se rompen", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  DB.raw.exec("DROP TABLE mail_log");
  ins(DB, { id: "p1", date: DAY, time: "09:30", status: "pending", expires_at: "2026-11-16T11:00:00.000Z" });
  ins(DB, { id: "p2", date: DAY, time: "10:30", status: "confirmed" });
  const m = relay();
  assert.match((await adminDo(env, s, "resend:p1", {}, NOW, m.fn)).headers.get("location"), /m=resend/);
  assert.match((await adminDo(env, s, "cancel:p2", {}, NOW, m.fn)).headers.get("location"), /m=cancel-ok/);
  assert.match((await adminDo(env, s, "testmail", {}, NOW, m.fn)).headers.get("location"), /m=testmail/);
  assert.match((await adminDo(env, s, "remind", {}, NOW, m.fn)).headers.get("location"), /m=reminders/);
  assert.equal((await call(env, req(`/admin?day=${DAY}`, { cookie: s.cookie }))).status, 200);
});

test("R4 recordatorios: dos llamadas seguidas mandan un solo correo; tras un fallo el siguiente reintenta", async () => {
  const { DB, env } = await admin({ ...RELAY });
  const T17 = new Date("2026-11-17T09:00:00Z");
  const s = await (await import("./helpers.mjs")).adminSession(env, T17);
  ins(DB, { id: "r1", date: DAY, time: "09:30", status: "confirmed" });
  const bad = relay({ ok: false, error: "quota" });
  const a = await adminDo(env, s, "remind", {}, T17, bad.fn);
  assert.match(a.headers.get("location"), /m=reminders&n=0&f=1/);
  assert.equal(DB.raw.prepare("SELECT reminded FROM bookings WHERE id='r1'").get().reminded, 0);
  const ok = relay();
  await adminDo(env, s, "remind", {}, T17, ok.fn);
  await adminDo(env, s, "remind", {}, T17, ok.fn);
  assert.equal(ok.calls.length, 1);
});

test("R5 reserva pública con relay que falla: se borra, sin correo se confirma, y el relay apagado no deja mail_log", async () => {
  const { DB, env } = await admin({ ...RELAY });
  const bad = relay({ ok: false, error: "quota" });
  const r = await book(env, {}, { fetchFn: bad.fn });
  assert.equal(r.status, 502);
  assert.equal(rows(DB).length, 0);
  assert.match(await D.getSetting(DB, "mail_fail_last"), /quota/);
  const off = await admin({});
  const r2 = await book(off.env, {});
  assert.equal(r2.status, 200);
  assert.equal(rows(off.DB)[0].status, "confirmed");
  assert.equal(off.DB.raw.prepare("SELECT count(*) n FROM mail_log").get().n, 0);
});

test("R6 si el correo de confirmación final falla, la página no dice que el enlace está en el correo", async () => {
  const { DB, env } = await admin({ ...RELAY });
  const m = relay();
  await book(env, {}, { fetchFn: m.fn });
  const token = tokenFrom(m.calls[0].json.text);
  const bad = relay({ ok: false, error: "quota" });
  const r = await call(env, req(`/c/${token}`, { method: "POST" }), later(60_000), bad.fn);
  assert.equal(r.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  const h = await text(r);
  assert.doesNotMatch(h, /También lo tienes en el correo/);
});

test("R7 un turno de las 00:00 de hoy ha empezado a las 00:00 (local) y no antes", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.openDay(DB, "2026-11-16", ["00:00"]);
  ins(DB, { id: "m1", date: "2026-11-16", time: "00:00", status: "confirmed" });
  const just = new Date("2026-11-15T23:00:00Z"); // 00:00 local
  const s2 = (await import("./helpers.mjs")).adminSession;
  const sess = await s2(env, just);
  assert.match((await adminDo(env, sess, "attended:m1", {}, just)).headers.get("location"), /m=marked/);
  ins(DB, { id: "m2", date: "2026-11-16", time: "00:30", status: "confirmed" });
  assert.match((await adminDo(env, sess, "attended:m2", {}, just)).headers.get("location"), /m=not-started/);
  const before = new Date("2026-11-15T22:59:00Z"); // 15/11 23:59 local
  const sess2 = await s2(env, before);
  assert.match((await adminDo(env, sess2, "attended:m1", {}, before)).headers.get("location"), /m=not-started|m=state/);
});
