// Codigo de reserva de 6 cifras y correos sin enlaces para direcciones de la universidad.
import test from "node:test";
import assert from "node:assert/strict";
import { NOW, DAY, RELAY, setup, call, req, book, rows, mockFetch, tokenFrom, later } from "./helpers.mjs";
import { admin, get, text } from "./spec_helpers.mjs";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { noLinks, tplConfirmRequest, tplConfirmed, tplReminder, tplCancelled, tplNoShow, bareHost } from "../src/mail.js";

// Lista de fabrica: NOLINK_DOMAINS sin definir. Los helpers la vacian por defecto.
const REAL = { ...RELAY, NOLINK_DOMAINS: undefined };
const HOST = "estudio-vr-demo.workers.dev";
const B = (o = {}) => ({ id: "b1", token: "t".repeat(30), date: "2026-11-19", time: "10:00", name: "Ana", email: "ana@unidemo.es", lang: "es", study: "study1", status: "pending", created_at: "2026-11-18T08:00:00.000Z", expires_at: "2026-11-18T10:00:00.000Z", ...o });
const forbidden = ["http", "href", "www.", "://"];

async function post(env, fields, { ip = "1.2.3.4", now = NOW, fetchFn, lang = "" } = {}) {
  const t = fields.t ?? (await signForm(env.DB, now.getTime(), "manage"));
  return call(env, req("/gestionar" + lang, { method: "POST", fields: { t, ...fields }, ip }), now, fetchFn);
}
const codeOf = async (DB, b) => D.formatCode(await D.bookingCode(DB, b));

test("el codigo es estable, de 6 cifras y distinto entre reservas", async () => {
  const { DB } = await setup();
  const a = { token: "a".repeat(30) }, b = { token: "b".repeat(30) };
  const c1 = await D.bookingCode(DB, a);
  assert.match(c1, /^\d{6}$/);
  assert.equal(await D.bookingCode(DB, a), c1);
  assert.notEqual(await D.bookingCode(DB, b), c1);
  assert.match(D.formatCode(c1), /^\d{3} \d{3}$/);
  assert.equal(D.parseCode("123 456"), "123456"); assert.equal(D.parseCode("123-456"), "123456"); assert.equal(D.parseCode("12345"), ""); assert.equal(D.parseCode("abcdef"), "");
});

test("noLinks: unidemo.es y subdominios si; el resto no; la lista se puede cambiar", () => {
  for (const e of ["a@unidemo.es", "a@alumni.unidemo.es", "a@Alumni.Unidemo.es", "A@UNIDEMO.ES"]) assert.equal(noLinks({}, e), true, e);
  for (const e of ["a@unidemoa.es", "a@notunidemo.es", "a@gmail.com", "a@unidemo.es.evil.com", ""]) assert.equal(noLinks({}, e), false, e);
  assert.equal(noLinks({ NOLINK_DOMAINS: "unidemoa.es, example.org" }, "a@unidemoa.es"), true);
  assert.equal(noLinks({ NOLINK_DOMAINS: "unidemoa.es, example.org" }, "a@unidemo.es"), false);
  assert.equal(noLinks({ NOLINK_DOMAINS: "" }, "a@unidemo.es"), false);
});

test("para unidemo.es TODAS las plantillas de participante van sin enlaces y con codigo y nombre del sitio", () => {
  const env = {};
  assert.equal(bareHost(env), HOST);
  for (const lang of ["es", "en"]) for (const email of ["ana@unidemo.es", "ana@alumni.unidemo.es"]) {
    const shortHold = B({ lang, email, created_at: "2026-11-18T08:30:00.000Z", expires_at: "2026-11-18T09:00:00.000Z" });
    const longHold = B({ lang, email });
    const conf = B({ lang, email, status: "confirmed" });
    const all = {
      "pedir (2 h)": tplConfirmRequest(env, longHold, { code: "123456" }),
      "pedir (corto)": tplConfirmRequest(env, shortHold, { code: "123456" }),
      confirmado: tplConfirmed(env, conf, { code: "123456" }),
      recordatorio: tplReminder(env, conf, { code: "123456" }),
      cancelado: tplCancelled(env, conf, "Mira https://x.example/a y www.b.com"),
      "no vino": tplNoShow(env, conf, "Mira http://x.example"),
    };
    for (const [k, t] of Object.entries(all)) {
      for (const w of forbidden) for (const part of ["subject", "text", "html"]) assert.ok(!t[part].includes(w), `${k} ${lang} ${part} lleva "${w}"`);
      assert.doesNotMatch(t.html, /<a[ >]/, `${k} sin <a>`);
      assert.ok(t.text.includes(HOST) && t.html.includes(HOST), `${k} nombra el sitio`);
    }
    for (const k of ["pedir (2 h)", "pedir (corto)", "confirmado", "recordatorio"]) {
      assert.ok(all[k].text.includes("123 456") && all[k].html.includes("123 456"), `${k} lleva el codigo`);
      assert.match(all[k].text, lang === "en" ? /Your booking code: 123 456/ : /Tu código de reserva: 123 456/);
    }
    assert.match(all["pedir (2 h)"].text, lang === "en" ? /type this code on the page where you booked/ : /Para confirmar, escribe este código en la página donde has reservado\. Si la has cerrado: abre estudio-vr-demo\.workers\.dev en el navegador, pulsa «Gestionar mi reserva» y escribe tu correo y este código\. Tienes 2 horas \(hasta las \d\d:\d\d\)/);
    assert.match(all["pedir (corto)"].text, lang === "en" ? /until 10:00, when it starts/ : /hasta las 10:00, cuando empieza/);
    assert.match(all.confirmado.text, lang === "en" ? /To cancel or add the slot to your calendar: open estudio-vr-demo\.workers\.dev/ : /Para cancelar o añadir el turno al calendario: abre estudio-vr-demo\.workers\.dev en el navegador, pulsa «Gestionar mi reserva» y escribe tu correo y este código\./);
  }
});

test("para hotmail las plantillas siguen con enlace de confirmar, cancelar, calendario y ademas el codigo", () => {
  const env = {};
  for (const lang of ["es", "en"]) {
    const b = B({ lang, email: "ana@hotmail.com" });
    const c = tplConfirmRequest(env, b, { code: "123456" });
    assert.ok(c.text.includes(`https://${HOST}/c/${b.token}?lang=${lang}`) && c.html.includes(`href="https://${HOST}/c/${b.token}?lang=${lang}"`));
    assert.ok(c.text.includes("123 456") && c.html.includes("123 456"));
    const k = tplConfirmed(env, { ...b, status: "confirmed" }, { code: "123456" });
    assert.ok(k.text.includes(`/ics/${b.token}`) && k.text.includes(`/x/${b.token}`) && k.html.includes(`href="https://${HOST}/ics/`) && k.html.includes(`href="https://${HOST}/x/`));
    assert.ok(k.text.includes("123 456") && k.html.includes("123 456"));
    const r = tplReminder(env, { ...b, status: "confirmed" }, { code: "123456" });
    assert.ok(r.text.includes(`/x/${b.token}`) && r.text.includes("123 456"));
    assert.ok(tplCancelled(env, b).text.includes(`https://${HOST}/?lang=${lang}`));
  }
});

test("reservar con unidemo.es y confirmar con el codigo: confirma, manda el correo y el aviso al admin", async () => {
  const { DB, env } = await setup(REAL);
  const m = mockFetch();
  const r = await book(env, { email: "ana@unidemo.es" }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const page = await r.text();
  assert.match(page, /Te hemos enviado un código de 6 cifras a <strong>ana@unidemo\.es<\/strong>\. Escríbelo aquí para confirmar el turno\./);
  assert.match(page, /autocomplete="one-time-code"/);
  assert.match(page, /<label for="m-code">/);
  assert.doesNotMatch(page, /<(style|script)[^>]*>(?!<\/script>)[^<]|style="|onclick=/i, "sin estilos ni scripts en linea");
  const sent = m.calls.mail[0].json;
  for (const w of forbidden) for (const p of ["subject", "text", "html"]) assert.ok(!sent[p].includes(w), `${p} lleva ${w}`);
  const b = rows(DB)[0];
  const code = await codeOf(DB, b);
  assert.ok(sent.text.includes(code));
  const ok = await post(env, { email: "ANA@unidemo.es", code }, { fetchFn: m.fn });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Turno confirmado/);
  assert.equal(rows(DB)[0].status, "confirmed");
  const mails = m.calls.mail.map((x) => x.json);
  assert.equal(mails.length, 3);
  assert.match(mails[1].subject, /^Turno confirmado/); assert.equal(mails[1].to, "ana@unidemo.es");
  assert.match(mails[2].subject, /^Reserva confirmada/);
  assert.ok(!mails[1].text.includes("://") && mails[1].text.includes(code));
});

test("el camino del enlace /c/<token> sigue igual y manda los mismos correos que el del codigo", async () => {
  const run = async (viaCode) => {
    const { DB, env } = await setup({ ...RELAY, NOLINK_DOMAINS: undefined });
    const m = mockFetch();
    const r = await book(env, { email: "ana@hotmail.com" }, { fetchFn: m.fn });
    const token = tokenFrom(m.calls.mail[0].json.text);
    assert.ok(token);
    let res;
    if (viaCode) res = await post(env, { email: "ana@hotmail.com", code: await codeOf(DB, rows(DB)[0]) }, { fetchFn: m.fn });
    else res = await call(env, req(`/c/${token}`, { method: "POST" }), NOW, m.fn);
    assert.equal(res.status, 200);
    assert.equal(rows(DB)[0].status, "confirmed");
    return { mails: m.calls.mail.slice(1).map((x) => [x.json.to, x.json.subject, x.json.text.replace(/\d{3} \d{3}/, "CODE").replace(/\/[cxs]+\/[A-Za-z0-9_-]+|\/ics\/[A-Za-z0-9_-]+/g, "/T")]), logs: DB.raw.prepare("SELECT kind, ok FROM mail_log ORDER BY id").all().map((x) => x.kind + x.ok), r };
  };
  const a = await run(false), b = await run(true);
  assert.deepEqual(a.mails, b.mails);
  assert.deepEqual(a.logs, b.logs);
  assert.deepEqual(a.logs, ["confirm_request1", "confirmed1", "admin1"]);
});

test("codigo malo, correo desconocido y pendiente caducada dan el mismo estado y el mismo texto", async () => {
  const { DB, env } = await setup(REAL);
  const m = mockFetch();
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: m.fn });
  const code = await codeOf(DB, rows(DB)[0]);
  const wrongCode = await post(env, { email: "ana@unidemo.es", code: "000 000" === code ? "111 111" : "000 000" });
  const unknown = await post(env, { email: "nadie@unidemo.es", code }, { ip: "2.2.2.2" });
  const late = later(3 * 3600_000);
  const expired = await post(env, { email: "ana@unidemo.es", code }, { ip: "3.3.3.3", now: late });
  const bodies = [];
  for (const r of [wrongCode, unknown, expired]) {
    assert.equal(r.status, 400);
    const t = await r.text();
    assert.match(t, /El correo o el código no son correctos\./);
    bodies.push(t.match(/<main[\s\S]*<\/main>/)[0].replace(/name="t" value="[^"]+"/, "").replace(/value="[^"]*@unidemo\.es"/, 'value="E"'));
  }
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0], bodies[2]);
  assert.match(await (await post(env, { email: "nadie@unidemo.es", code: "1", lang: "" }, { ip: "4.4.4.4" })).text(), /value="nadie@unidemo\.es"/, "el correo se conserva");
});

test("la sexta prueba tras cinco fallos da 429 aunque el codigo sea bueno; igual con un correo desconocido", async () => {
  const { DB, env } = await setup(REAL);
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: mockFetch().fn });
  const code = await codeOf(DB, rows(DB)[0]);
  for (let i = 0; i < 5; i++) assert.equal((await post(env, { email: "ana@unidemo.es", code: "000 00" + i })).status, 400);
  const blocked = await post(env, { email: "ana@unidemo.es", code });
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Demasiados intentos\. Espera 15 minutos\./);
  assert.equal(rows(DB)[0].status, "pending");
  for (let i = 0; i < 5; i++) assert.equal((await post(env, { email: "nadie@unidemo.es", code: "000 00" + i })).status, 400);
  assert.equal((await post(env, { email: "nadie@unidemo.es", code })).status, 429, "un correo desconocido se limita igual");
  // pasados 15 minutos vuelve a funcionar
  const ok = await post(env, { email: "ana@unidemo.es", code }, { now: later(16 * 60_000) });
  assert.equal(ok.status, 200);
});

test("codigo bueno sobre una reserva confirmada: la vista con calendario y cancelar", async () => {
  const { DB, env } = await setup({ ...RELAY, NOLINK_DOMAINS: undefined });
  const m = mockFetch();
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: m.fn });
  const code = await codeOf(DB, rows(DB)[0]);
  await post(env, { email: "ana@unidemo.es", code }, { fetchFn: m.fn });
  const n = m.calls.mail.length;
  const again = await post(env, { email: "ana@unidemo.es", code: code.replace(" ", "-") }, { fetchFn: m.fn, ip: "5.5.5.5" });
  assert.equal(again.status, 200);
  const t = await again.text();
  const token = rows(DB)[0].token;
  assert.ok(t.includes(`/ics/${token}`) && t.includes(`/x/${token}`));
  assert.ok(t.includes(code));
  assert.equal(m.calls.mail.length, n, "no se manda nada otra vez");
});

test("formulario de /gestionar, portada y paginas privadas", async () => {
  const { env } = await setup(REAL);
  for (const [lang, title, link] of [["es", "Gestionar mi reserva", "¿Ya tienes un turno? Gestionar mi reserva"], ["en", "Manage my booking", "Already have a slot? Manage my booking"]]) {
    const g = await call(env, req(`/gestionar?lang=${lang}`));
    assert.equal(g.status, 200);
    const t = await g.text();
    assert.match(t, new RegExp(`<h1>${title}</h1>`));
    assert.match(t, /autocomplete="one-time-code"/); assert.match(t, /inputmode="numeric"/); assert.match(t, /maxlength="7"/);
    assert.match(t, /<label for="m-email">/); assert.match(t, /action="\/gestionar\?lang=/);
    assert.equal(g.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(g.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(t, /\sstyle=|<script(?![^>]*src=)|\son[a-z]+=/i);
    const home = await (await call(env, req(`/?lang=${lang}`))).text();
    assert.ok(home.includes(`href="/gestionar?lang=${lang}">${link}</a>`), `portada ${lang}`);
  }
  assert.equal((await call(env, req("/gestionar", { method: "PUT" }))).status, 405);
});

test("sin marca de tiempo valida el formulario se rechaza sin tocar nada; una escritura rapida si vale", async () => {
  const { DB, env } = await setup(REAL);
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: mockFetch().fn });
  const code = await codeOf(DB, rows(DB)[0]);
  const bad = await post(env, { email: "ana@unidemo.es", code, t: "basura" });
  assert.equal(bad.status, 400);
  assert.equal(rows(DB)[0].status, "pending");
  const quick = await post(env, { email: "ana@unidemo.es", code });
  assert.equal(quick.status, 200);
});

test("el panel del dia muestra el codigo de cada reserva viva", async () => {
  const { DB, env, s } = await admin();
  const b = (await (async () => { const { ins } = await import("./spec_helpers.mjs"); return ins(DB, { token: "z".repeat(30), email: "z1@unidemo.es" }); })());
  const row = DB.raw.prepare("SELECT * FROM bookings WHERE id = ?").get(b.id);
  const html = await get(env, s, `?day=${DAY}`);
  assert.ok(html.includes("Código: " + (await codeOf(DB, row))), "el panel lleva el codigo");
});

test("el recordatorio y el recordatorio a unidemo.es salen sin enlaces y con codigo", async () => {
  const { DB, env } = await setup(REAL);
  const m = mockFetch();
  await book(env, { email: "ana@unidemo.es", slot: `${DAY}T09:30` }, { fetchFn: m.fn });
  const row = rows(DB)[0];
  DB.raw.prepare("UPDATE bookings SET status='confirmed', expires_at=NULL WHERE id=?").run(row.id);
  const { sendReminders } = await import("../src/mail.js");
  const c = { db: DB, fetchFn: m.fn, nowMs: NOW.getTime(), today: "2026-11-17" };
  const r = await sendReminders(env, c);
  assert.equal(r.sent, 1);
  const t = m.calls.mail.at(-1).json;
  assert.match(t.subject, /^Mañana/);
  assert.ok(t.text.includes(await codeOf(DB, row)));
  for (const w of forbidden) assert.ok(!t.text.includes(w) && !t.html.includes(w));
});

// ---- revision: carreras, bloqueo ajeno, cupo propio, cuerpo no valido, notas y nombres -------------------
const wrongOf = (c) => (c === "000000" ? "000001" : "000000");

test("peticiones simultaneas: el tope de intentos se aplica aunque lleguen a la vez", async () => {
  const { DB, env } = await setup(REAL);
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: mockFetch().fn });
  const code = D.parseCode(await codeOf(DB, rows(DB)[0]));
  // 12 intentos a la vez desde la misma IP: solo 5 se evaluan
  const same = await Promise.all(Array.from({ length: 12 }, () => post(env, { email: "ana@unidemo.es", code: wrongOf(code) }, { ip: "8.8.8.8" })));
  assert.equal(same.filter((r) => r.status === 400).length, 5);
  assert.equal(same.filter((r) => r.status === 429).length, 7);
  // 60 a la vez desde IP distintas: el techo por correo (30) corta el resto
  const many = await Promise.all(Array.from({ length: 60 }, (_, i) => post(env, { email: "luis@unidemo.es", code: wrongOf(code) }, { ip: `9.9.${i}.1` })));
  assert.ok(many.filter((r) => r.status === 400).length <= 30, "no mas de 30 evaluados");
  assert.ok(many.filter((r) => r.status === 429).length >= 30);
});

test("un tercero no puede dejar fuera al dueno: el bloqueo cuenta por correo y por IP", async () => {
  const { DB, env } = await setup(REAL);
  await book(env, { email: "ana@unidemo.es" }, { fetchFn: mockFetch().fn });
  const code = await codeOf(DB, rows(DB)[0]);
  for (let i = 0; i < 6; i++) await post(env, { email: "ana@unidemo.es", code: "000 00" + (i % 9) }, { ip: "66.6.6.6" });
  assert.equal((await post(env, { email: "ana@unidemo.es", code }, { ip: "66.6.6.6" })).status, 429, "el atacante sigue bloqueado");
  assert.equal((await post(env, { email: "ana@unidemo.es", code }, { ip: "10.0.0.1" })).status, 200, "la dueña entra desde otra IP");
  assert.equal(rows(DB)[0].status, "confirmed");
});

test("gestionar tiene su propio cupo por IP y no gasta el de reservar", async () => {
  const { env } = await setup(REAL);
  for (let i = 0; i < 25; i++) await post(env, { email: "x@unidemo.es", code: "000 000" }, { ip: "51.0.0.1" });
  const r = await book(env, { email: "ana@gmail.com" }, { ip: "51.0.0.1", fetchFn: mockFetch().fn });
  assert.notEqual(r.status, 429);
});

test("un cuerpo que no es formulario da 400 y no 500", async () => {
  const { env } = await setup(REAL);
  const r = await call(env, new Request("https://estudio-vr-demo.workers.dev/gestionar", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "4.4.4.4" }, body: "{}" }), NOW);
  assert.equal(r.status, 400);
});

test("notas y nombre para unidemo.es: sin enlaces y sin romper horas ni aulas", () => {
  const b = B({ status: "confirmed" });
  const t = tplCancelled({}, b, "Te esperamos a las 10.30 en el aula 1.2.34. Gracias.");
  assert.ok(t.text.includes("10.30") && t.text.includes("aula 1.2.34. Gracias") && t.html.includes("10.30"));
  for (const name of ["www.ana.com", "http://x", "hhttpttp", "wwwww.x", "a href=b"]) for (const lang of ["es", "en"]) {
    for (const t2 of [tplConfirmRequest({}, B({ name, lang }), { code: "042017" }), tplConfirmed({}, B({ name, lang, status: "confirmed" }), { code: "042017" }), tplCancelled({}, B({ name, lang }), "x"), tplNoShow({}, B({ name, lang }), "x")]) {
      for (const w of forbidden) for (const part of ["subject", "text", "html"]) assert.ok(!t2[part].toLowerCase().includes(w), `${name} ${part} lleva "${w}"`);
    }
  }
});
