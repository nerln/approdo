// Reserva confirmada al momento (ajuste del panel), con calendario y sin el paso de confirmar por correo.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { googleCalUrl, tplConfirmed } from "../src/mail.js";
import { localToUtc } from "../src/slots.js";
import { T } from "../src/i18n.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, req, call, book, rows, adminDo, adminSession, goodFields } from "./helpers.mjs";
import { admin, get } from "./spec_helpers.mjs";

const instantSetup = async (extra = {}) => {
  const x = await setup({ ...RELAY, ADMIN_EMAIL: "inv@unidemo.es", ...extra });
  await D.setSetting(x.DB, "confirm_mode", "instant");
  return x;
};
const contacts = (DB) => DB.raw.prepare("SELECT * FROM contacts").all();
const setting = (DB, k) => DB.raw.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? null;

test("por defecto se confirma por correo; el ajuste solo cuenta con el correo activado", async () => {
  const { DB, env } = await setup({ ...RELAY });
  assert.equal(await D.getConfirmMode(DB), "email");
  const m = mockFetch();
  await book(env, {}, { fetchFn: m.fn });
  assert.equal(rows(DB)[0].status, "pending");
  await D.setSetting(DB, "confirm_mode", "cualquier cosa");
  assert.equal(await D.getConfirmMode(DB), "email");
  // sin correo siempre es al momento y la nota del formulario es la de siempre
  const off = await setup();
  await D.setSetting(off.DB, "confirm_mode", "instant");
  const h = await (await call(off.env, req("/"))).text();
  assert.ok(h.includes(T.es.afterSubmitNoMail) && !h.includes(T.es.afterSubmitInstant));
});

test("al momento: la reserva nace confirmada, un correo a la persona y uno a quien investiga, página con todo", async () => {
  const { DB, env } = await instantSetup();
  const m = mockFetch();
  const r = await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const b = rows(DB)[0];
  assert.equal(b.status, "confirmed");
  assert.equal(b.expires_at, null);
  const mails = m.calls.mail.map((x) => x.json);
  assert.deepEqual(mails.map((x) => x.to), ["ana@gmail.com", "inv@unidemo.es"]);
  assert.match(mails[0].subject, /^Turno confirmado: 18\/11 09:30$/);
  assert.match(mails[0].text, /Tu turno está confirmado\. No tienes que hacer nada más\./);
  assert.match(mails[0].text, /Cancelar el turno, si no puedes venir: https:\/\/\S+\/x\/\S+\n\nSi quieres, confírmanos que este correo te ha llegado \(no es obligatorio\): https:\/\/estudio-vr-demo\.workers\.dev\/c\/\S+\?lang=es&k=\d{6}\n\nSi no has hecho tú esta reserva, cancélala con el enlace de arriba\.\n/);
  assert.match(mails[0].html, />Confirmar mi correo<\/a>/);
  assert.match(mails[0].html, /<p>Si no has hecho tú esta reserva, cancélala con el enlace de arriba\.<\/p>/);
  assert.match(mails[0].text, /Tu código de reserva: \d{3} \d{3}/);
  assert.equal(b.verified_at, null, "reservada, con el correo aún sin confirmar");
  assert.deepEqual(DB.raw.prepare("SELECT kind, ok FROM mail_log ORDER BY rowid").all().map((x) => `${x.kind}:${x.ok}`), ["confirmed:1", "admin:1"]);
  const h = await r.text();
  assert.match(h, /<h1>Turno confirmado<\/h1>/);
  assert.ok(!h.includes("Revisa tu correo"));
  assert.ok(h.includes(`href="/ics/${b.token}?lang=es"`) || h.includes(`href="/ics/${b.token}"`), "archivo de calendario");
  assert.ok(h.includes(`/x/${b.token}`), "enlace para cancelar");
  assert.ok(!/Tu código de reserva|\d{3} \d{3}/.test(h.replace(/1\.2\.34/g, "")), "el código no está en la página: solo va en el correo");
  assert.ok(h.includes("También lo tienes en el correo."));
  assert.ok(h.includes(T.es.verifyHint));
  const g = /href="(https:\/\/calendar\.google\.com\/calendar\/render\?[^"]+)"[^>]*rel="noopener noreferrer" target="_blank">Añadir a Google Calendar \(pestaña nueva\)</.exec(h);
  assert.ok(g, "botón de Google Calendar");
  const q = new URL(g[1].replace(/&amp;/g, "&")).searchParams;
  assert.equal(q.get("dates"), "20261118T083000Z/20261118T091500Z"); // 09:30 a 10:15 en hora local
  assert.equal(q.get("text"), "Estudio de realidad virtual (EDI)");
  assert.match(q.get("location"), /^Laboratorio 1\.2\.34, EDI/);
  assert.match(q.get("details"), new RegExp(`cancela aquí: https://estudio-vr-demo\\.workers\\.dev/x/${b.token}\\?lang=es$`));
  assert.ok(!/\d{3} \d{3}|[Cc]ódigo/.test(q.get("details")), "sin el código en el calendario");
  assert.ok(!/style=|<script(?![^>]*\bsrc=)/.test(h));
  // el enlace del correo y el código siguen sirviendo para gestionar
  const x = await call(env, req(`/x/${b.token}`));
  assert.equal(x.status, 200);
});

test("al momento, dirección universitaria: el correo no lleva enlaces y dice cómo cancelar; la página sí los tiene", async () => {
  const { DB, env } = await instantSetup({ NOLINK_DOMAINS: "unidemo.es" });
  const m = mockFetch();
  const r = await book(env, { email: "ana@alumni.unidemo.es" }, { fetchFn: m.fn });
  const mail = m.calls.mail[0].json;
  assert.ok(!/https?:\/\//.test(mail.text) && !/<a /.test(mail.html), "sin enlaces");
  assert.match(mail.text, /Tu código de reserva: \d{3} \d{3}/);
  assert.match(mail.text, /Si no has hecho tú esta reserva, responde a este correo y la cancelamos\./);
  assert.match(mail.text, /escribe tu correo y este código\. Al hacerlo también sabremos que este correo te ha llegado \(no es obligatorio\)\./);
  const h = await r.text();
  assert.ok(h.includes(`/x/${rows(DB)[0].token}`) && h.includes("calendar.google.com"));
  assert.ok(h.includes(T.es.verifyHintCode) && !h.includes("Guarda este código"));
});

test("al momento, en inglés", async () => {
  const { env } = await instantSetup();
  const m = mockFetch();
  const r = await call(env, req("/reservar?lang=en", { method: "POST", fields: await goodFields(env.DB, { email: "ann@gmail.com" }) }), NOW, m.fn);
  const h = await r.text();
  assert.match(h, /<h1>Slot confirmed<\/h1>/);
  assert.ok(h.includes("Add to Google Calendar (new tab)") && h.includes("Add to calendar (.ics)"));
  assert.match(m.calls.mail[0].json.text, /If you did not make this booking, please cancel it with the link above\./);
});

test("al momento: si el correo falla la reserva se queda confirmada y la página lo dice", async () => {
  const { DB, env } = await instantSetup();
  const m = mockFetch({ relayOk: false });
  const r = await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 1);
  assert.equal(rows(DB)[0].status, "confirmed");
  const h = await r.text();
  assert.match(h, /<h1>Turno confirmado<\/h1>/);
  assert.ok(!h.includes("También lo tienes en el correo."), "no promete un correo que no salió");
  assert.ok(h.includes(T.es.bookedKeepNoMail));
  assert.ok(!h.includes(T.es.verifyHint), "ni pide confirmar un correo que no salió");
  assert.ok(setting(DB, "mail_fail_last"));
});

test("al momento: el freno por hora cuenta los correos de «turno confirmado»", async () => {
  const { DB, env } = await instantSetup();
  for (let i = 0; i < 30; i++) await D.logMail(DB, `x${i}`, "confirmed", true, null, new Date(NOW.getTime() - 60_000).toISOString());
  const m = mockFetch();
  assert.equal((await book(env, {}, { fetchFn: m.fn })).status, 429);
  assert.equal(rows(DB).length, 0);
  // y por correo siguen contando las peticiones de confirmación, no las confirmaciones
  await D.setSetting(DB, "confirm_mode", "email");
  assert.equal((await book(env, {}, { fetchFn: m.fn, ip: "2.2.2.2" })).status, 200);
});

test("avisos de futuros estudios: la fila espera a que la persona venga; «Asistió» la confirma con 24 meses", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.setSetting(DB, "confirm_mode", "instant");
  const m = mockFetch();
  const r = await book(env, { email: "ana@gmail.com", future: "1" }, { fetchFn: m.fn });
  const h = await r.text();
  assert.ok(h.includes(T.es.listLater));
  assert.ok(!h.includes("Te avisaremos de futuros estudios"), "aún no está en la lista");
  let c = contacts(DB);
  assert.equal(c.length, 1);
  assert.equal(c[0].confirmed, 0);
  assert.equal(c[0].expires_at, "2026-12-19T00:00:00.000Z"); // el día del turno más 31
  assert.equal((await D.contactsConfirmed(DB, NOW.toISOString())).length, 0, "no cuenta todavía");
  // dos días después, antes de la sesión... no: el turno es el 18; a las 12:00 del 18 la limpieza no la borra
  const after = later(2 * 86400_000 + 3 * 3600_000);
  await D.cleanup(DB, after.getTime(), "2026-11-18");
  assert.equal(contacts(DB).length, 1, "con la reserva confirmada la fila espera");
  const b = rows(DB)[0];
  const rr = await adminDo(env, await adminSession(env, after), `attended:${b.id}`, { day: DAY }, after, m.fn);
  assert.match(rr.headers.get("location"), /m=marked/);
  c = contacts(DB);
  assert.equal(c[0].confirmed, 1);
  assert.equal(c[0].booking_id, null);
  assert.equal(c[0].consent_at, after.toISOString());
  assert.equal(c[0].expires_at, D.addMonthsIso(after.toISOString(), 24));
  assert.equal((await D.contactsConfirmed(DB, after.toISOString())).length, 1);
});

test("avisos: si la persona cancela, no viene o la reserva se cancela desde el panel, la fila se borra", async () => {
  for (const how of ["cancel-self", "noshow", "cancel-admin"]) {
    const { DB, env, s } = await admin({ ...RELAY });
    await D.setSetting(DB, "confirm_mode", "instant");
    const m = mockFetch();
    await book(env, { email: "ana@gmail.com", future: "1" }, { fetchFn: m.fn });
    const b = rows(DB)[0];
    const after = later(2 * 86400_000 + 3 * 3600_000);
    if (how === "cancel-self") assert.equal((await call(env, req(`/x/${b.token}`, { method: "POST" }), later(3600_000), m.fn)).status, 200);
    if (how === "noshow") assert.match((await adminDo(env, await adminSession(env, after), `noshow:${b.id}`, { day: DAY }, after, m.fn)).headers.get("location"), /m=marked/);
    if (how === "cancel-admin") await adminDo(env, s, `cancel:${b.id}`, { day: DAY }, later(3600_000), m.fn);
    await D.cleanup(DB, after.getTime() + 120_000, "2026-11-18");
    assert.equal(contacts(DB).length, 0, how);
  }
});

test("avisos por correo (modo de antes): sin confirmar la reserva, la fila se sigue borrando a las 3 horas", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  await book(env, { future: "1" }, { fetchFn: m.fn });
  assert.equal(contacts(DB)[0].confirmed, 0);
  await D.cleanup(DB, NOW.getTime() + 3 * 3600_000 + 120_000, "2026-11-16");
  assert.equal(contacts(DB).length, 0);
});

test("textos: la nota del formulario, la de los avisos y la política cambian con el ajuste, en los dos idiomas", async () => {
  const { DB, env } = await setup({ ...RELAY });
  for (const lang of ["es", "en"]) {
    await D.setSetting(DB, "confirm_mode", "email");
    let h = await (await call(env, req(`/?lang=${lang}`))).text();
    assert.ok(h.includes(T[lang].afterSubmit) && h.includes(T[lang].futureNote));
    let p = await (await call(env, req(`/privacidad?lang=${lang}`))).text();
    for (const [a] of T[lang].privacyInstant) assert.ok(p.includes(a), a.slice(0, 40));
    await D.setSetting(DB, "confirm_mode", "instant");
    h = await (await call(env, req(`/?lang=${lang}`))).text();
    assert.ok(h.includes(T[lang].afterSubmitInstant) && h.includes(T[lang].futureNoteInstant));
    assert.ok(!h.includes(T[lang].afterSubmit) && !h.includes(T[lang].futureNote));
    p = await (await call(env, req(`/privacidad?lang=${lang}`))).text();
    for (const [a, b] of T[lang].privacyInstant) { assert.ok(!p.includes(a), "frase de antes: " + a.slice(0, 40)); assert.ok(p.includes(b), "frase nueva: " + b.slice(0, 40)); }
    assert.ok(!/2 horas|2 hours|3 horas|3 hours/.test(p), "la política al momento no habla de plazos de confirmación");
    assert.ok(p.includes(lang === "es" ? "30 días después del turno" : "30 days after the slot"));
  }
});

test("panel: el ajuste se cambia con sesión y CSRF, se ve cuál está puesto, y sin correo va desactivado", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  let h = await get(env, s);
  assert.match(h, /value="confirm-mode:email" class="on" aria-pressed="true"/);
  assert.match(h, /value="confirm-mode:instant" class="plain" aria-pressed="false"/);
  let r = await adminDo(env, s, "confirm-mode:instant");
  assert.match(r.headers.get("location"), /m=confirm-instant/);
  assert.equal(setting(DB, "confirm_mode"), "instant");
  h = await get(env, s);
  assert.match(h, /value="confirm-mode:instant" class="on" aria-pressed="true"/);
  r = await adminDo(env, s, "confirm-mode:otra");
  assert.match(r.headers.get("location"), /m=denied/);
  assert.equal(setting(DB, "confirm_mode"), "instant");
  await adminDo(env, s, "confirm-mode:email");
  assert.equal(setting(DB, "confirm_mode"), "email");
  const bad = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "malo", do: "confirm-mode:instant" } }));
  assert.notEqual(bad.status, 200);
  assert.equal(setting(DB, "confirm_mode"), "email");
  const off = await admin();
  assert.match(await get(off.env, off.s), /value="confirm-mode:instant" class="plain" aria-pressed="false" disabled/);
});

test("las reservas que estaban pendientes al cambiar el ajuste se siguen pudiendo confirmar con su enlace", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  const b = rows(DB)[0];
  assert.equal(b.status, "pending");
  await D.setSetting(DB, "confirm_mode", "instant");
  const p = await call(env, req(`/c/${b.token}`, { method: "POST" }), later(60_000), m.fn);
  assert.equal(p.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  const h = await p.text();
  assert.ok(h.includes("calendar.google.com") && h.includes(`/ics/${b.token}`));
});

test("enlace de Google Calendar y plantilla: funciones puras", () => {
  const b = { id: "i", token: "t".repeat(24), date: "2026-07-01", time: "16:05", lang: "en", email: "a@b.es", name: "Ann" };
  const q = new URL(googleCalUrl({}, b, localToUtc)).searchParams;
  assert.equal(q.get("dates"), "20260701T140500Z/20260701T145000Z"); // verano: UTC+2
  assert.equal(q.get("action"), "TEMPLATE");
  assert.ok(!/code/i.test(q.get("details")));
  const mail = tplConfirmed({}, b, { code: "123456" });
  assert.ok(!mail.text.includes("did not make this booking") && !mail.text.includes("&k="), "sin aviso ni enlace de confirmar cuando se confirmó por correo");
});

test("confirmar el correo es opcional: el enlace del mensaje abre una página con un botón, y el panel lo cuenta", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  await D.setSetting(DB, "confirm_mode", "instant");
  const m = mockFetch();
  await book(env, { email: "ana@gmail.com", future: "1" }, { fetchFn: m.fn });
  const b = rows(DB)[0];
  const url = /https:\/\/estudio-vr-demo\.workers\.dev(\/c\/\S+\?lang=es&k=\d{6})/.exec(m.calls.mail[0].json.text)[1];
  let panel = await get(env, s, `?month=2026-11&day=${DAY}`);
  assert.ok(panel.includes("Correo sin confirmar"));
  // abrir el enlace no cambia nada (los filtros de correo abren los enlaces): hace falta pulsar el botón
  const g = await call(env, req(url), later(60_000));
  const gh = await g.text();
  assert.equal(g.status, 200);
  assert.match(gh, /<h1>Confirma tu correo<\/h1>/);
  assert.match(gh, new RegExp(`<form method="post" action="/c/${b.token}\\?k=\\d{6}&amp;lang=es">`));
  assert.equal(rows(DB)[0].verified_at, null);
  assert.equal(contacts(DB)[0].confirmed, 0);
  const p = await call(env, req(url, { method: "POST" }), later(120_000), m.fn);
  const ph = await p.text();
  assert.equal(p.status, 200);
  assert.ok(ph.includes(T.es.verifiedDone));
  assert.equal(rows(DB)[0].verified_at, later(120_000).toISOString());
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(contacts(DB)[0].confirmed, 1, "con el correo confirmado entra en la lista de avisos");
  assert.equal(m.calls.mail.length, 2, "confirmar el correo no manda más correos");
  panel = await get(env, s, `?month=2026-11&day=${DAY}`);
  assert.ok(panel.includes("Correo confirmado el 16/11 10:02") && !panel.includes("Correo sin confirmar"));
  const csv = await (await call(env, req("/admin/csv", { cookie: s.cookie }))).text();
  assert.match(csv, /,recordatorio,correo_confirmado\r\n/);
  assert.match(csv, /,"no","sí"\r\n/);
  // el mismo enlace, otra vez: ya no ofrece confirmar
  const again = await (await call(env, req(url), later(180_000))).text();
  assert.ok(!again.includes("Confirma tu correo") && again.includes("Tu turno está confirmado"));
});

test("confirmar el correo: la página del enlace no delata si el código es el bueno, y solo se comprueba al pulsar, con 3 intentos por hora", async () => {
  const { DB, env } = await instantSetup();
  const m = mockFetch();
  await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  const b = rows(DB)[0];
  const real = /&k=(\d{6})/.exec(m.calls.mail[0].json.text)[1];
  const wrong = real === "000000" ? "000001" : "000000";
  const strip = (h) => h.replace(/k=\d{6}/g, "k=X");
  // GET: con el código bueno y con uno malo, la misma página
  const gOk = await (await call(env, req(`/c/${b.token}?k=${real}`))).text();
  const gBad = await (await call(env, req(`/c/${b.token}?k=${wrong}`))).text();
  assert.ok(gOk.includes("Confirma tu correo") && gBad.includes("Confirma tu correo"));
  assert.equal(strip(gOk), strip(gBad), "no hay oráculo");
  // sin código, o con algo que no son 6 cifras: la página de siempre
  for (const q of ["", "?k=abc", "?k=", "?k=12345"]) assert.ok(!(await (await call(env, req(`/c/${b.token}${q}`))).text()).includes("Confirma tu correo"), `GET ${q}`);
  // POST con un código malo: no confirma; al cuarto intento en una hora, 429 aunque el código sea el bueno
  for (let i = 0; i < 3; i++) {
    const p = await call(env, req(`/c/${b.token}?k=${wrong}`, { method: "POST", ip: `7.7.7.${i}` }), later(60_000 * (i + 1)), m.fn);
    assert.equal(p.status, 200);
    assert.ok(!(await p.text()).includes(T.es.verifiedDone));
  }
  assert.equal(rows(DB)[0].verified_at, null);
  const blocked = await call(env, req(`/c/${b.token}?k=${real}`, { method: "POST", ip: "7.7.8.1" }), later(5 * 60_000), m.fn);
  assert.equal(blocked.status, 429, "el tope es por reserva, venga de la dirección que venga");
  assert.equal(rows(DB)[0].verified_at, null);
  // pasada la hora, el código bueno confirma
  const okp = await call(env, req(`/c/${b.token}?k=${real}`, { method: "POST" }), later(70 * 60_000), m.fn);
  assert.equal(okp.status, 200);
  assert.ok((await okp.text()).includes(T.es.verifiedDone));
  assert.ok(rows(DB)[0].verified_at);
  // sin código en el POST no se cuenta ni se confirma nada (y no rompe)
  assert.equal((await call(env, req(`/c/${b.token}`, { method: "POST" }), later(71 * 60_000), m.fn)).status, 200);
  assert.equal(m.calls.mail.length, 2);
});

test("al momento: textos de la página cuando el correo no lleva enlaces o no ha salido", async () => {
  // dirección sin enlaces: la página no promete un enlace en el correo
  let x = await instantSetup({ NOLINK_DOMAINS: "unidemo.es" });
  let m = mockFetch();
  let h = await (await book(x.env, { email: "ana@unidemo.es" }, { fetchFn: m.fn })).text();
  assert.ok(h.includes(T.es.bookedKeepNoLink) && !h.includes("También lo tienes en el correo."));
  // el correo falla y la persona pidió los avisos: ni «mensaje que te hemos enviado» ni silencio sobre el fallo
  x = await instantSetup();
  m = mockFetch({ relayOk: false });
  h = await (await book(x.env, { email: "ana@gmail.com", future: "1" }, { fetchFn: m.fn })).text();
  assert.ok(h.includes(T.es.bookedMailFailed) && h.includes(T.es.listLaterNoMail));
  assert.ok(!h.includes(T.es.listLater) && !h.includes(T.es.verifyHint));
  assert.equal(contacts(x.DB).length, 1, "la petición de avisos se guarda igual, a la espera de que venga");
  // el correo al momento dice qué confirma el código
  x = await instantSetup();
  m = mockFetch();
  await book(x.env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  assert.match(m.calls.mail[0].json.text, /para confirmar tu correo, cancelar o añadir el turno al calendario\./);
});

test("confirmar el correo vale también para una reserva ya marcada como asistida, y sin correo el panel no habla de ello", async () => {
  const { DB, env } = await instantSetup();
  const m = mockFetch();
  await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  const b = rows(DB)[0];
  const real = /&k=(\d{6})/.exec(m.calls.mail[0].json.text)[1];
  DB.raw.prepare("UPDATE bookings SET status = 'attended' WHERE id = ?").run(b.id);
  const p = await call(env, req(`/c/${b.token}?k=${real}`, { method: "POST" }), later(60_000), m.fn);
  assert.ok((await p.text()).includes(T.es.verifiedDone));
  const off = await admin();
  await book(off.env, { email: "ana@gmail.com" });
  const panel = await get(off.env, off.s, `?month=2026-11&day=${DAY}`);
  assert.ok(!panel.includes("Correo sin confirmar") && !panel.includes("Correo confirmado el"));
  assert.match(await get(off.env, off.s), /value="confirm-mode:email" class="plain" aria-pressed="false" disabled/);
});

test("confirmar el correo con el código en «Gestionar mi reserva» (direcciones sin enlaces)", async () => {
  const { DB, env } = await instantSetup({ NOLINK_DOMAINS: "unidemo.es" });
  const m = mockFetch();
  await book(env, { email: "ana@alumni.unidemo.es", future: "1" }, { fetchFn: m.fn });
  const code = /Tu código de reserva: (\d{3} \d{3})/.exec(m.calls.mail[0].json.text)[1];
  const t = await (await import("../src/auth.js")).signForm(DB, NOW.getTime(), "manage");
  const r = await call(env, req("/gestionar", { method: "POST", fields: { email: "ana@alumni.unidemo.es", code, t } }), later(60_000), m.fn);
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(h.includes(T.es.verifiedDone) && h.includes("calendar.google.com"));
  assert.equal(rows(DB)[0].verified_at, later(60_000).toISOString());
  assert.equal(contacts(DB)[0].confirmed, 1);
  // otra vez: sigue entrando, sin el aviso de «confirmado ahora»
  const t2 = await (await import("../src/auth.js")).signForm(DB, NOW.getTime(), "manage");
  const h2 = await (await call(env, req("/gestionar", { method: "POST", fields: { email: "ana@alumni.unidemo.es", code, t: t2 } }), later(120_000), m.fn)).text();
  assert.ok(!h2.includes(T.es.verifiedDone) && h2.includes("Turno confirmado"));
  assert.equal(rows(DB)[0].verified_at, later(60_000).toISOString());
});

test("por correo (modo de antes): confirmar el turno deja el correo como confirmado", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  const b = rows(DB)[0];
  assert.equal(b.verified_at, null);
  await call(env, req(`/c/${b.token}`, { method: "POST" }), later(60_000), m.fn);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(rows(DB)[0].verified_at, later(60_000).toISOString());
});

test("la base de antes de la migración (sin la columna) no rompe nada: reservar, confirmar y gestionar siguen funcionando", async () => {
  const { DB, env } = await instantSetup();
  DB.raw.exec("ALTER TABLE bookings DROP COLUMN verified_at");
  const m = mockFetch();
  const r = await book(env, { email: "ana@gmail.com" }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const b = rows(DB)[0];
  const url = /(\/c\/\S+\?lang=es&k=\d{6})/.exec(m.calls.mail[0].json.text)[1];
  assert.equal((await call(env, req(url))).status, 200);
  assert.equal((await call(env, req(url, { method: "POST" }), later(60_000), m.fn)).status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(b.status, "confirmed");
});
