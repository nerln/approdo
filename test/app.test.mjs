import test from "node:test";
import assert from "node:assert/strict";
import { hmacHex } from "../src/util.js";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { csvCell } from "../src/util.js";
import { relayOn } from "../src/mail.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, req, call, book, goodFields, tokenFrom, rows, login, adminSession, adminDo } from "./helpers.mjs";

const text = (r) => r.text();
const PW = "una-contrasena-larga-123";

test("dias abiertos y franjas: solo se ven las abiertas, libres y con aviso minimo", async () => {
  const { DB, env } = await setup();
  await D.openDay(DB, "2026-11-16", ["10:30", "18:00"]); // hoy: 10:30 ya no cumple las 12 h de aviso
  let h = await text(await call(env, req("/")));
  assert.match(h, /09:30/); assert.match(h, /15:00/);
  assert.ok(!h.includes("2026-11-16T10:30"), "hoy no hay aviso suficiente");
  assert.ok(!h.includes("2026-11-19"), "dia cerrado no aparece");
  // una franja reservada desaparece
  await book(env);
  h = await text(await call(env, req("/"), later(60_000)));
  assert.ok(!h.includes(`${DAY}T09:30"`));
  assert.match(h, new RegExp(`${DAY}T10:30`));
});

test("sin relay: la reserva queda confirmada al instante, con .ics y enlace de cancelacion", async () => {
  const { DB, env } = await setup();
  const r = await book(env);
  assert.equal(r.status, 200);
  const h = await text(r);
  assert.match(h, /Turno reservado/); assert.match(h, /\/ics\//); assert.match(h, /\/x\//); assert.match(h, /Guarda este enlace/);
  assert.equal(rows(DB)[0].status, "confirmed");
  const ics = await text(await call(env, req(`/ics/${tokenFrom(h)}`)));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /TRIGGER:-P1D/); assert.match(ics, /TRIGGER:-PT2H/);
  assert.match(ics, /LOCATION:Laboratorio 1\.2\.34\\, EDI \(Escuela de Ingeniería\)\\, Universidad de Ejemplo\\, Avenida de la Universidad s\/n\\, Villaejemplo/);
  assert.match(ics, /DTSTART:20261118T083000Z/); // 09:30 local en noviembre = 08:30 UTC
});

test("doble reserva de la misma franja: rechazada", async () => {
  const { DB, env } = await setup();
  assert.equal((await book(env)).status, 200);
  const r2 = await book(env, { email: "otra@unidemo.es", name: "Bea" }, { ip: "5.5.5.5" });
  assert.equal(r2.status, 409);
  assert.equal(rows(DB).length, 1);
});

test("una reserva activa por correo (tambien con +etiqueta y puntos de Gmail)", async () => {
  const { DB, env } = await setup();
  assert.equal((await book(env, { email: "a.b@gmail.com" })).status, 200);
  const r = await book(env, { email: "ab+x@gmail.com", slot: `${DAY}T10:30` });
  assert.equal(r.status, 409);
  assert.equal(rows(DB).length, 1);
});

test("con relay: reserva pendiente, el GET no cambia nada, el POST confirma y avisa", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  const r = await book(env, {}, { fetchFn: m.fn });
  assert.match(await text(r), /Revisa tu correo/);
  assert.equal(rows(DB)[0].status, "pending");
  assert.equal(m.calls.mail.length, 1);
  const mail = m.calls.mail[0];
  assert.equal(mail.json.to, "ana@unidemo.es");
  assert.equal(mail.sig, await hmacHex(RELAY.MAIL_RELAY_KEY, mail.body), "firma HMAC del cuerpo en bruto");
  assert.ok(Math.abs(mail.json.ts - NOW.getTime()) < 1000);
  const token = tokenFrom(mail.json.text);
  assert.ok(token);
  assert.match(mail.json.html, /\/c\//);

  const g = await call(env, req(`/c/${token}`), NOW, m.fn);
  assert.equal(g.status, 200);
  assert.match(await text(g), /Confirmar mi turno/);
  assert.equal(rows(DB)[0].status, "pending", "GET no confirma");

  const p = await call(env, req(`/c/${token}`, { method: "POST" }), later(60_000), m.fn);
  assert.equal(p.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(m.calls.mail.length, 3, "correo al participante y aviso al administrador");
  assert.equal(m.calls.mail[2].json.to, "investigacion@example.org");
  assert.match(m.calls.mail[1].json.subject, /confirmado/);
});

test("si el relay falla la reserva pendiente se retira", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const r = await book(env, {}, { fetchFn: mockFetch({ relayOk: false }).fn });
  assert.equal(r.status, 502);
  assert.equal(rows(DB).length, 0);
});

test("pendiente caduca a las 2 h y el hueco se libera", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  await book(env, {}, { fetchFn: m.fn });
  assert.equal(rows(DB).length, 1);
  // otra persona no puede coger el hueco mientras esta pendiente
  assert.equal((await book(env, { email: "b@unidemo.es" }, { ip: "6.6.6.6", fetchFn: m.fn })).status, 409);
  const token = tokenFrom(m.calls.mail[0].json.text);
  const t3 = later(3 * 3600_000);
  const p = await call(env, req(`/c/${token}`, { method: "POST" }), t3, m.fn);
  assert.equal(p.status, 404, "los datos ya se han borrado");
  assert.equal(rows(DB).length, 0, "borrada");
  assert.equal((await book(env, { email: "b@unidemo.es" }, { now: t3, ip: "6.6.6.6", fetchFn: m.fn })).status, 200);
});

test("cancelar: el GET solo muestra, el POST cancela y libera la franja", async () => {
  const { DB, env } = await setup();
  const token = tokenFrom(await text(await book(env)));
  const g = await call(env, req(`/x/${token}`));
  assert.match(await text(g), /Cancelar mi turno/);
  assert.equal(rows(DB)[0].status, "confirmed");
  const p = await call(env, req(`/x/${token}`, { method: "POST" }));
  assert.match(await text(p), /Turno cancelado/);
  assert.equal(rows(DB)[0].status, "cancelled");
  assert.equal((await book(env, { email: "b@unidemo.es" }, { ip: "7.7.7.7" })).status, 200, "franja libre otra vez");
  assert.equal((await call(env, req(`/ics/${token}`))).status, 404, "sin .ics tras cancelar");
});

test("honeypot: respuesta normal pero no se guarda nada", async () => {
  const { DB, env } = await setup();
  const r = await book(env, { web: "http://spam" });
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 0);
});

test("tiempo minimo de 4 s entre cargar y enviar", async () => {
  const { DB, env } = await setup();
  const f = await goodFields(DB, { t: await signForm(DB, NOW.getTime() - 1000) });
  const r = await call(env, req("/reservar", { method: "POST", fields: f }));
  assert.equal(r.status, 400);
  assert.match(await text(r), /demasiado rápido/);
  const f2 = await goodFields(DB, { t: "123.abc" });
  assert.equal((await call(env, req("/reservar", { method: "POST", fields: f2 }))).status, 400);
  assert.equal(rows(DB).length, 0);
});

test("limite: 20 peticiones cada 10 minutos por IP; las filas se purgan a la hora", async () => {
  const { DB, env } = await setup();
  for (let i = 0; i < 20; i++) assert.notEqual((await book(env, { email: `x${i}@unidemo.es`, slot: "bad" })).status, 429);
  assert.equal((await book(env)).status, 429);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM rate_limit").get().n, 20);
  assert.ok(!JSON.stringify(DB.raw.prepare("SELECT * FROM rate_limit").all()).includes("1.2.3.4"), "solo hash");
  assert.equal((await book(env, {}, { ip: "8.8.8.8" })).status, 200, "otra IP no se ve afectada");
  await call(env, req("/"), later(61 * 60_000));
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM rate_limit").get().n, 0);
});

test("correo desechable: rechazado", async () => {
  const { DB, env } = await setup();
  const r = await book(env, { email: "x@mailinator.com" });
  assert.equal(r.status, 400);
  assert.equal(rows(DB).length, 0);
});

test("casillas obligatorias y datos invalidos: 400", async () => {
  const { DB, env } = await setup();
  const bad = [{ noepi: "" }, { accept: "" }, { email: "nope" }, { name: "" }, { name: "x".repeat(41) }, { slot: "garbage" }];
  for (let i = 0; i < bad.length; i++) {
    const r = await book(env, bad[i], { ip: `10.0.0.${i}` });
    assert.equal(r.status, 400, JSON.stringify(bad[i]));
  }
  for (const [i, slot] of ["2026-11-21T09:30", `${DAY}T13:00`, "2026-11-19T09:30"].entries())
    assert.equal((await book(env, { slot }, { ip: `10.0.1.${i}` })).status, 409, slot);
  assert.equal(rows(DB).length, 0);
});

test("estudio 2 muestra y exige la casilla vestibular; el estudio 1 no", async () => {
  const { DB, env } = await setup();
  assert.ok(!(await text(await call(env, req("/")))).includes('name="vestibular"'));
  await D.setSetting(DB, "active_study", "study2");
  const h = await text(await call(env, req("/")));
  assert.match(h, /name="vestibular"/); assert.match(h, /silla giratoria/);
  assert.equal((await book(env, { vestibular: "" })).status, 400);
  assert.equal((await book(env, { vestibular: "1" }, { ip: "3.3.3.3" })).status, 200);
  assert.equal(rows(DB)[0].study, "study2");
});

test("sin ADMIN_PASSWORD el panel esta desactivado", async () => {
  const { env } = await setup();
  const r = await call(env, req("/admin"));
  assert.equal(r.status, 503);
  assert.match(await text(r), /desactivada/);
});

test("login correcto: cookie HttpOnly, Secure, SameSite=Strict, Path=/admin, 12 h; clave generada y guardada en D1", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW });
  assert.match(await text(await call(env, req("/admin"))), /Contraseña/);
  const r = await login(env, PW);
  assert.equal(r.status, 303);
  const c = r.headers.get("set-cookie");
  for (const part of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/admin", "Max-Age=43200"]) assert.ok(c.includes(part), part);
  const key = await D.getSetting(DB, "hmac_key");
  assert.ok(key && key.length >= 40);
  assert.ok(!JSON.stringify(env).includes(key));
  const s = await adminSession(env);
  assert.match(await text(await call(env, req("/admin", { cookie: s.cookie }))), /Próximas reservas/);
});

test("bloqueo tras 5 fallos por IP en 15 minutos", async () => {
  const { env } = await setup({ ADMIN_PASSWORD: PW });
  for (let i = 0; i < 5; i++) assert.equal((await login(env, "mal")).status, 401);
  assert.equal((await login(env, PW)).status, 429, "ni la buena pasa");
  assert.equal((await login(env, PW, { ip: "4.4.4.4" })).status, 303, "otra IP si");
  assert.equal((await login(env, PW, { now: later(16 * 60_000) })).status, 303, "pasados 15 min");
});

test("CSRF: POST de administracion sin token o con token ajeno: 403", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW });
  const s = await adminSession(env);
  const r1 = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: "study:study2" } }));
  assert.equal(r1.status, 403);
  const r2 = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "otro", do: "study:study2" } }));
  assert.equal(r2.status, 403);
  assert.equal(await D.getActiveStudy(DB), "study1");
  assert.equal((await adminDo(env, s, "study:study2")).status, 303);
  assert.equal(await D.getActiveStudy(DB), "study2");
});

test("cookie manipulada o de otra contraseña: se pide login", async () => {
  const { env } = await setup({ ADMIN_PASSWORD: PW });
  const s = await adminSession(env);
  const [p, sig] = s.cookie.split("=")[1].split(".");
  const forged = Buffer.from(JSON.stringify({ exp: NOW.getTime() + 1e9, csrf: "x" })).toString("base64url");
  for (const cookie of [`vr_admin=${forged}.${sig}`, `vr_admin=${p}.${"0".repeat(64)}`, `vr_admin=${p}x.${sig}`, "vr_admin=basura"]) {
    assert.match(await text(await call(env, req("/admin", { cookie }))), /type="password"/);
  }
  assert.match(await text(await call(env, req("/admin", { cookie: s.cookie }, later(13 * 3600_000)), later(13 * 3600_000))), /type="password"/, "caduca a las 12 h");
  assert.match(await text(await call({ ...env, ADMIN_PASSWORD: "otra-contrasena-larga" }, req("/admin", { cookie: s.cookie }))), /type="password"/);
});

test("panel: abrir y cerrar dias, franjas, reservas, estados, recordatorios y CSV", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...RELAY });
  const m = mockFetch();
  const s = await adminSession(env);
  // abrir un dia nuevo con las horas por defecto
  await adminDo(env, s, "day:2026-11-19");
  assert.equal((await D.slotsBetween(DB, "2026-11-19", "2026-11-19")).length, 9);
  assert.deepEqual((await D.slotsBetween(DB, "2026-11-19", "2026-11-19")).map((x) => x.time), ["09:15", "10:00", "10:45", "11:30", "12:15", "13:50", "14:35", "15:20", "16:05"]);
  await adminDo(env, s, "slot:2026-11-19T16:05");
  assert.equal((await D.slotsBetween(DB, "2026-11-19", "2026-11-19")).length, 8);
  // horas por defecto editables
  await adminDo(env, s, "times", { times: "08:00, 09:00" });
  await adminDo(env, s, "day:2026-11-20");
  assert.deepEqual((await D.slotsBetween(DB, "2026-11-20", "2026-11-20")).map((x) => x.time), ["08:00", "09:00"]);
  assert.match((await adminDo(env, s, "times", { times: "25:99" })).headers.get("location"), /bad-times/);
  // reservar (confirmada) y cerrar el dia con reservas: no deja
  await book(env, { name: '=HYPERLINK("http://x")' }, { fetchFn: m.fn });
  const token = tokenFrom(m.calls.mail[0].json.text);
  await call(env, req(`/c/${token}`, { method: "POST" }), NOW, m.fn);
  const loc = (await adminDo(env, s, `day:${DAY}`)).headers.get("location");
  assert.match(loc, /has-bookings/);
  // CSV con proteccion de formulas
  const csv = await text(await call(env, req("/admin/csv", { cookie: s.cookie })));
  assert.match(csv, /alias,correo,estudio,fecha,hora,estado,idioma,recordatorio/);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)","ana@unidemo\.es","1","2026-11-18","09:30","confirmada","es","no"/);
  assert.equal((await call(env, req("/admin/csv"))).status, 303, "CSV sin sesion redirige");
  // asistio / no vino (solo cuando el turno ya ha empezado: se mueve la reserva al pasado)
  const id = rows(DB)[0].id;
  DB.raw.prepare("UPDATE bookings SET date = '2026-11-16', time = '08:00' WHERE id = ?").run(id);
  await adminDo(env, s, `attended:${id}`);
  assert.equal(rows(DB)[0].status, "attended");
  await adminDo(env, s, `noshow:${id}`);
  assert.equal(rows(DB)[0].status, "noshow");
  // recordatorios de manana: reserva para el 17/11 confirmada, una sola vez
  await D.openDay(DB, "2026-11-17", ["10:30"]);
  await book(env, { slot: "2026-11-17T10:30", email: "z@unidemo.es" }, { ip: "2.2.2.2", fetchFn: m.fn, now: later(1000) });
  const tok2 = tokenFrom(m.calls.mail.at(-1).json.text);
  await call(env, req(`/c/${tok2}`, { method: "POST" }), later(2000), m.fn);
  const before = m.calls.mail.length;
  await adminDo(env, s, "remind", {}, later(3000), m.fn);
  assert.equal(m.calls.mail.length, before + 1);
  assert.match(m.calls.mail.at(-1).json.subject, /Mañana/);
  await adminDo(env, s, "remind", {}, later(4000), m.fn);
  assert.equal(m.calls.mail.length, before + 1, "una sola vez");
  // cancelar desde el panel avisa a la persona
  const id2 = rows(DB).find((r) => r.email === "z@unidemo.es").id;
  const b2 = m.calls.mail.length;
  await adminDo(env, s, `cancel:${id2}`, {}, later(5000), m.fn);
  assert.equal(rows(DB).find((r) => r.id === id2).status, "cancelled");
  assert.equal(m.calls.mail[b2].json.to, "z@unidemo.es");
  assert.match(m.calls.mail[b2].json.subject, /cancelado/);
});

test("csvCell neutraliza formulas", () => {
  for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", " =x"]) assert.ok(csvCell(s).startsWith(`"'`), s);
  assert.equal(csvCell("Ana"), '"Ana"');
  assert.equal(csvCell('a"b'), '"a""b"');
});

test("limpieza: 30 dias despues del turno se borra todo; filas de limite e intentos a la hora", async () => {
  const { DB, env } = await setup();
  await book(env);
  assert.equal(rows(DB).length, 1);
  await call(env, req("/"), new Date("2026-12-17T12:00:00Z"));
  assert.equal(rows(DB).length, 1, "29 dias despues sigue");
  await call(env, req("/"), new Date("2026-12-19T12:00:00Z"));
  assert.equal(rows(DB).length, 0, "pasados 30 dias");
  DB.raw.prepare("INSERT INTO login_attempts VALUES ('h', 1)").run();
  await call(env, req("/"), NOW);
  assert.equal(DB.raw.prepare("SELECT count(*) n FROM login_attempts").get().n, 0);
});

test("Open Graph, twitter, descripcion y favicon en las paginas publicas", async () => {
  const { env } = await setup({ BASE_URL: "https://estudio-vr-demo.workers.dev" });
  for (const p of ["/", "/condiciones", "/privacidad"]) {
    const h = await text(await call(env, req(p)));
    for (const re of [
      /<meta name="description" content="[^"]+"/,
      /property="og:title" content="Participa en un estudio de realidad virtual"/,
      /property="og:description" content="Una sesión de 45 minutos en el laboratorio 1\.2\.34 de la EDI\. Reserva tu turno\."/,
      /property="og:image" content="https:\/\/estudio-vr-demo\.workers\.dev\/og\.png"/,
      /og:image:width" content="1200"/, /og:image:height" content="630"/,
      new RegExp(`property="og:url" content="https://estudio-vr-demo.workers.dev${p === "/" ? "/" : p}"`),
      /property="og:type" content="website"/, /property="og:locale" content="es_ES"/, /property="og:site_name"/,
      /name="twitter:card" content="summary_large_image"/, /name="theme-color"/, /rel="icon" href="\/favicon\.svg"/,
    ]) assert.match(h, re, `${p} ${re}`);
  }
  const alt = await text(await call({ ...env, BASE_URL: "https://otro.example/" }, req("/")));
  assert.match(alt, /og:image" content="https:\/\/otro\.example\/og\.png"/);
});

test("sin pagina con texto de embarazo, incentivos ni guiones largos", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...RELAY });
  const m = mockFetch();
  const all = [];
  for (const st of ["study1", "study2"]) {
    await D.setSetting(DB, "active_study", st);
    for (const p of ["/", "/condiciones", "/privacidad"]) all.push(await text(await call(env, req(p))));
  }
  const s = await adminSession(env);
  all.push(await text(await call(env, req("/admin", { cookie: s.cookie }))));
  await book(env, {}, { fetchFn: m.fn });
  all.push(JSON.stringify(m.calls.mail.map((x) => x.json)));
  for (const t of all) {
    assert.ok(!/embaraz|gestaci|gravid|pregnan|incentiv|compensaci|recompensa|sorteo/i.test(t), "texto prohibido");
    assert.ok(!t.includes("—"), "guion largo");
  }
});

test("paginas publicas: contenido clave y cabeceras de seguridad", async () => {
  const { env } = await setup();
  const r = await call(env, req("/"));
  const h = await text(r);
  for (const re of [/Laboratorio 1\.2\.34/, /45 minutos/, /investigación del grupo DemoLab/, /parar en cualquier momento/, /No tengo ni he tenido nunca epilepsia/, /acepto las/, /href="\/condiciones"/, /href="\/privacidad"/, /action="\/reservar"/, /name="web"/]) assert.match(h, re);
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(h), "sin scripts en linea");
  assert.ok(!/ on[a-z]+=|style=/.test(h), "sin manejadores ni estilos en linea");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.ok(r.headers.get("permissions-policy"));
  assert.ok(!r.headers.get("content-security-policy").includes("unsafe-inline"));
  assert.ok(!r.headers.get("set-cookie"), "sin cookies para visitantes");
  const priv = await text(await call(env, req("/privacidad")));
  for (const re of [/grupo de investigación DemoLab/, /tu consentimiento/, /30 días/, /2 horas/, /Cloudflare/, /Google/, /Turnstile/, /nunca con los datos del estudio|no se vinculan nunca/]) assert.match(priv, re);
  assert.doesNotMatch(priv, /AEPD|Agencia Española|aepd\.es/);
});

test("Turnstile: solo cuando hay claves; se verifica en el servidor con host y remoteip", async () => {
  const { DB, env } = await setup();
  assert.ok(!(await text(await call(env, req("/")))).includes("turnstile"));
  const e2 = { ...env, TURNSTILE_SITEKEY: "0xKEY", TURNSTILE_SECRET: "sec" };
  const r0 = await call(e2, req("/"));
  const h = await text(r0);
  assert.match(h, /class="cf-turnstile" data-sitekey="0xKEY" data-action="reserva" data-language="es"/);
  assert.match(r0.headers.get("content-security-policy"), /challenges\.cloudflare\.com/);
  const ok = mockFetch();
  // Antes de la primera comprobación correcta está en observación: un fallo no bloquea.
  const soft = mockFetch({ turnstile: { success: false, "error-codes": ["invalid-input-response"] } });
  assert.equal((await book(e2, { "cf-turnstile-response": "tok", email: "obs@unidemo.es", slot: `${DAY}T11:30` }, { fetchFn: soft.fn, ip: "8.8.8.8" })).status, 200, "en observación no bloquea");
  assert.equal((await book(e2, { "cf-turnstile-response": "tok" }, { fetchFn: ok.fn })).status, 200);
  assert.deepEqual(ok.calls.turnstile[0], { secret: "sec", response: "tok", remoteip: "1.2.3.4" });
  // cierra en falso: otra acción, sin hostname, respuesta no 200, token enorme
  let k = 0;
  for (const turnstile of [{ success: true, hostname: "estudio-vr-demo.workers.dev", action: "login" }, { success: true, action: "reserva" }, { success: "true", hostname: "estudio-vr-demo.workers.dev", action: "reserva" }, { success: false, hostname: "estudio-vr-demo.workers.dev", action: "reserva" }]) {
    const m = mockFetch({ turnstile });
    assert.equal((await book(e2, { "cf-turnstile-response": "tok", email: `w${k}@unidemo.es`, slot: `${DAY}T10:30` }, { fetchFn: m.fn, ip: `6.6.6.${k++}` })).status, 400, JSON.stringify(turnstile));
  }
  const http500 = async () => new Response("x", { status: 500 });
  assert.equal((await book(e2, { "cf-turnstile-response": "tok", email: "h@unidemo.es", slot: `${DAY}T10:30` }, { fetchFn: http500, ip: "6.6.7.1" })).status, 400);
  const never = mockFetch();
  assert.equal((await book(e2, { "cf-turnstile-response": "x".repeat(2049), email: "l@unidemo.es", slot: `${DAY}T10:30` }, { fetchFn: never.fn, ip: "6.6.7.2" })).status, 400);
  assert.equal(never.calls.turnstile.length, 0, "un token enorme ni se envía a verificar");
  const bad = mockFetch({ turnstile: { success: true, hostname: "evil.example", action: "reserva" } });
  assert.equal((await book(e2, { "cf-turnstile-response": "tok", email: "q@unidemo.es", slot: `${DAY}T10:30` }, { fetchFn: bad.fn, ip: "5.5.5.5" })).status, 400);
  assert.equal((await book(e2, { email: "q@unidemo.es", slot: `${DAY}T10:30` }, { fetchFn: ok.fn, ip: "5.5.5.6" })).status, 400, "sin respuesta del widget");
  assert.equal(rows(DB).length, 2, "la de observación y la comprobada");
});

test("rutas /c /x /ics con token inventado: 404; metodos no permitidos", async () => {
  const { env } = await setup();
  for (const p of ["/c/", "/c/abc", "/x/" + "a".repeat(30), "/ics/" + "b".repeat(30)]) assert.ok([404].includes((await call(env, req(p))).status), p);
  assert.equal(relayOn({}), false);
  assert.equal(relayOn(RELAY), true);
});
