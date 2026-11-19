// Pruebas de seguridad: cada una reproduce un hallazgo y queda como regresion.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { NOW, later, DAY, RELAY, setup, call, req, book, login, adminDo, tokenFrom, rows, mockFetch } from "./helpers.mjs";
import { PW, relay, ins, admin, get, text } from "./spec_helpers.mjs";

const logLogin = (env, pw, ip, now = NOW) => login(env, pw, { ip, now });

test("S1 login: una rafaga en paralelo no consigue mas de 5 intentos evaluados, y la buena queda bloqueada", async () => {
  const { env } = await setup({ ADMIN_PASSWORD: PW });
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => logLogin(env, "mala-" + i, "8.8.8.8")));
  assert.ok(rs.filter((r) => r.status === 401).length <= 5, "como mucho 5 contraseñas evaluadas");
  assert.equal((await logLogin(env, PW, "8.8.8.8")).status, 429);
  // otra red entra con normalidad, y entrar bien no gasta intentos
  for (let i = 0; i < 8; i++) assert.equal((await logLogin(env, PW, "7.7.7.7")).status, 303);
});

test("S2 limites: las direcciones IPv6 de un mismo /64 comparten contador", async () => {
  const { DB } = await setup();
  const a = await D.ipHash(DB, "2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2026-11-16");
  const b = await D.ipHash(DB, "2001:DB8:1:2::1", "2026-11-16");
  const c = await D.ipHash(DB, "2001:db8:1:3::1", "2026-11-16");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(await D.ipHash(DB, "1.2.3.4", "2026-11-16"), await D.ipHash(DB, "1.2.3.5", "2026-11-16"));
  // y el limite de reservar lo aplica de verdad
  const { env } = await setup();
  for (let i = 0; i < 20; i++) await book(env, { web: "x" }, { ip: `2001:db8:9:9:${i}::1` });
  assert.equal((await book(env, { web: "x" }, { ip: "2001:db8:9:9:ffff::1" })).status, 429);
});

test("S3 contraseña corta: el panel avisa en la lista de puesta en marcha", async () => {
  const short = await admin({ ADMIN_PASSWORD: "corta-123" });
  assert.match(await get(short.env, short.s), /class="todo">Pendiente: ADMIN_PASSWORD definida y de al menos 16/);
  const ok = await admin();
  assert.doesNotMatch(await get(ok.env, ok.s), /class="todo">Pendiente: ADMIN_PASSWORD/);
});

test("S4 salir invalida la cookie en el servidor, no solo en el navegador", async () => {
  const { env, s } = await admin();
  const csv = () => call(env, req("/admin/csv", { cookie: s.cookie }));
  assert.equal((await csv()).headers.get("content-type").split(";")[0], "text/csv");
  await call(env, req("/admin/logout", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf } }));
  assert.equal((await csv()).status, 303, "la cookie copiada ya no entra: redirige al acceso");
  const again = await admin().then(() => login(env, PW));
  assert.equal(again.status, 303, "volver a entrar funciona");
});

test("S5 alias: sin saltos de linea ni caracteres de direccion; el texto de los correos no puede falsear lineas ni enlaces", async () => {
  const { DB, env } = await setup({ ...RELAY });
  for (const name of ["Ana\n\nPulsa aqui", "Ana\r\nx", "Ana‮abc", "Ana x", "a@b.cc"]) {
    const r = await book(env, { name }, { fetchFn: mockFetch().fn, ip: "5.5.5." + Math.floor(Math.random() * 200) });
    assert.equal(r.status, 400, JSON.stringify(name));
  }
  assert.equal(rows(DB).length, 0);
  // un alias con forma de enlace pasa (es un alias), pero en el texto del correo no queda ningun enlace pulsable
  const m = mockFetch();
  await book(env, { name: "http://evil.example/x www.evil.example" }, { fetchFn: m.fn });
  const t = m.calls.mail[0].json.text.split("\n")[0];
  assert.doesNotMatch(t, /:\/\/|www\.[a-z]|evil\.example/);
  // defensa en la plantilla del aviso al investigador
  const { tplAdmin } = await import("../src/mail.js");
  const adm = tplAdmin({}, "confirmed", { name: "x\nDía en el panel: https://evil.example", email: "a@b.cc", study: "study1", date: DAY, time: "09:30" });
  assert.equal(adm.text.split("\n").length, 4);
});

test("S6 freno global: no salen mas de 30 correos de confirmacion por hora, vengan de donde vengan", async () => {
  const { DB, env } = await setup({ ...RELAY });
  for (let i = 0; i < 30; i++) await D.logMail(DB, "x" + i, "confirm_request", true, "", NOW.toISOString());
  const m = mockFetch();
  const r = await book(env, {}, { fetchFn: m.fn });
  assert.equal(r.status, 429);
  assert.equal(m.calls.mail.length, 0);
  assert.equal(rows(DB).length, 0);
  // pasada la hora, vuelve a funcionar
  const m2 = mockFetch();
  assert.equal((await book(env, { t: await signForm(DB, later(3700_000).getTime() - 10_000) }, { fetchFn: m2.fn, now: later(3700_000), ip: "6.6.6.6" })).status, 200);
});

test("S7 confirmar y cancelar con un token tienen tope por direccion", async () => {
  const { env } = await setup();
  const h = await text(await book(env));
  const token = tokenFrom(h);
  let last;
  for (let i = 0; i < 41; i++) last = await call(env, req(`/x/${token}`, { method: "POST" }));
  assert.equal(last.status, 429);
});

test("S8 el .ics no lleva el token secreto en el UID", async () => {
  const { env } = await setup();
  const token = tokenFrom(await text(await book(env)));
  const ics = await text(await call(env, req(`/ics/${token}`)));
  assert.match(ics, /UID:[^\r\n]+@/);
  assert.ok(!/UID:[^\r\n]*/.exec(ics)[0].includes(token));
});

test("S9 los mensajes del panel no llevan nombre ni correo en la URL, y se leen una sola vez", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  ins(DB, { id: "f1", name: "Marta Prueba", email: "marta@unidemo.es", status: "confirmed" });
  const loc = (await adminDo(env, s, "cancel:f1", { day: DAY }, NOW, relay({ ok: false, error: "quota marta@unidemo.es" }).fn)).headers.get("location");
  assert.match(loc, /m=cancel-fail/);
  assert.ok(!/Marta|marta|%40|@|quota/.test(loc), loc);
  const first = await get(env, s, loc.replace("/admin", ""));
  assert.match(first, /Reserva de Marta Prueba cancelada, pero el correo NO se ha enviado \(quota marta@unidemo\.es\)\. Escríbele tú: marta@unidemo\.es/);
  assert.doesNotMatch(await get(env, s, loc.replace("/admin", "")), /Marta Prueba cancelada/, "la segunda carga ya no lo muestra");
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM settings WHERE key LIKE 'flash:%'").get().n, 0);
  // una llave inventada no rompe nada
  assert.equal((await call(env, req("/admin?m=cancel-ok&k=zzz", { cookie: s.cookie }))).status, 200);
  // las filas sin leer se limpian a los 10 minutos
  await D.setSetting(DB, "flash:000000000000001:abc", "{}");
  await call(env, req("/", {}), later(120_000));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM settings WHERE key LIKE 'flash:%'").get().n, 0);
});

test("S10 un error del relay con una direccion no se guarda con la direccion", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay({ ok: false, error: "Invalid email: bob@gmail..com" });
  const r = await book(env, { email: "bob@gmail.com" }, { fetchFn: m.fn });
  assert.equal(r.status, 502);
  const log = DB.raw.prepare("SELECT err FROM mail_log").get().err;
  const fail = await D.getSetting(DB, "mail_fail_last");
  assert.ok(!log.includes("bob@") && !fail.includes("bob@"), log + fail);
});

test("S11 correo: formas con ?, /, # o caracteres de direccion de texto se rechazan", async () => {
  const { EMAIL_RE } = await import("../src/util.js");
  for (const bad of ["a@b.cc?x", "a@b.cc/../x", "a@b.cc?bcc=x%40y.zz", "a@b.cc#x", "a‮@b.cc", "a@b‮.cc", "a@b.c", "a b@c.dd", "a@@b.cc"]) assert.ok(!EMAIL_RE.test(bad), bad);
  for (const good of ["ana@unidemo.es", "a.b+c@mail.unidemo.es", "o'brien@unidemo.es", "a&b@unidemo.es", "x_y%z@a-b.co.uk"]) assert.ok(EMAIL_RE.test(good), good);
});

test("S12 registro de correos: con mas de 100 reservas en una vista las consultas no pasan de 90 parametros", async () => {
  const { DB } = await setup();
  const ids = Array.from({ length: 250 }, (_, i) => "id" + i);
  for (const id of ids) await D.logMail(DB, id, "confirmed", true, "", NOW.toISOString());
  let max = 0;
  const wrapped = { prepare: (sql) => { const p = DB.prepare(sql); return { bind: (...a) => { max = Math.max(max, a.length); return p.bind(...a); } }; } };
  const map = await D.mailLogFor(wrapped, ids);
  assert.equal(map.size, 250);
  assert.ok(max <= 90, "parametros por consulta: " + max);
});

test("S13 cabeceras y tamaños: noindex en las rutas privadas y 413 para cuerpos enormes", async () => {
  const { env } = await setup({ ADMIN_PASSWORD: PW });
  const token = tokenFrom(await text(await book(env)));
  for (const p of ["/admin", `/c/${token}`, `/x/${token}`, `/ics/${token}`, "/admin/csv"]) {
    assert.match((await call(env, req(p))).headers.get("x-robots-tag") || "", /noindex/, p);
  }
  assert.equal((await call(env, req("/"))).headers.get("x-robots-tag"), null);
  for (const p of ["/reservar", "/admin/login", "/cron/remind"]) {
    const r = req(p, { method: "POST", fields: { a: "b" } });
    r.headers.set("content-length", "500000");
    assert.equal((await call(env, r)).status, 413, p);
  }
});

test("S14 la limpieza no corre en cada peticion: como mucho una vez por minuto", async () => {
  const { DB, env } = await setup();
  let deletes = 0;
  const counting = { ...DB, prepare: (sql) => { if (/^DELETE/.test(sql)) deletes++; return DB.prepare(sql); } };
  const e = { ...env, DB: counting };
  await call(e, req("/privacidad"));
  const first = deletes;
  assert.ok(first >= 5);
  for (let i = 0; i < 20; i++) await call(e, req("/privacidad"), later(1000 * i));
  assert.equal(deletes, first, "ninguna limpieza mas dentro del minuto");
  await call(e, req("/privacidad"), later(61_000));
  assert.ok(deletes > first);
});
