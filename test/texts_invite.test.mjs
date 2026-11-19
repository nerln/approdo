// Textos (correos y páginas públicas), Apps Script, migración e invitaciones.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { NOW, DAY, RELAY, setup, call, req, adminDo } from "./helpers.mjs";
import { ins, admin, text, relay } from "./spec_helpers.mjs";
import * as D from "../src/db.js";
import { tplConfirmRequest, tplConfirmed, tplReminder, tplCancelled, tplNoShow, tplAdmin, buildIcs, invitation, PLACE } from "../src/mail.js";
import { localToUtc } from "../src/slots.js";

// Este test comprueba las plantillas con enlaces: la lista de dominios sin enlaces se vacía (los de unidemo.es están en test/code_flow.test.mjs).
const ENV = { BASE_URL: "https://estudio-vr-demo.workers.dev", NOLINK_DOMAINS: "sin-enlaces.invalid" };
const B = (lang) => ({ token: "t".repeat(30), date: "2026-11-19", time: "10:00", name: "Ana", email: "ana@unidemo.es", lang, study: "study2", expires_at: "2026-11-19T09:00:00.000Z" }); // 10:00 local
const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

test("D28 correos: acción primero, plazo con hora, asunto con dd/mm y hora, 45 minutos, comillas, enlaces claros, firma y lugar", () => {
  for (const lang of ["es", "en"]) {
    const en = lang === "en";
    const place = PLACE[lang];
    assert.match(place, /^(Laboratorio|Laboratory) 1\.2\.34, EDI \(Escuela de Ingeniería\), Universidad de Ejemplo, Avenida de la Universidad s\/n, Villaejemplo$/);
    const b = B(lang);
    const all = {
      confirmRequest: tplConfirmRequest(ENV, b), confirmed: tplConfirmed(ENV, b), reminder: tplReminder(ENV, b), cancelled: tplCancelled(ENV, b), noshow: tplNoShow(ENV, b),
    };
    for (const [k, t] of Object.entries(all)) {
      assert.ok(t.text.endsWith("DemoLab, Universidad de Ejemplo"), `${k} firma`);
      assert.ok(t.html.includes("<p>DemoLab, Universidad de Ejemplo</p>"), `${k} firma html`);
      assert.doesNotMatch(t.text + t.html, /!|\b(unos|about) \d|Nombre Apellido/, `${k} sin signos de exclamación, unos/about ni firma antigua`);
      for (const link of t.text.match(/https:\/\/\S+/g) || []) assert.ok(t.html.includes(link.replace(/&/g, "&amp;")), `${k} el html lleva ${link}`);
    }
    // 1 petición de confirmación
    const c = all.confirmRequest;
    assert.equal(c.subject, en ? "Confirm your slot: virtual reality study" : "Confirma tu turno: estudio de realidad virtual");
    assert.match(c.text, en ? /^Hello Ana,\n\nConfirm your slot by opening this link and pressing “Confirm my slot”\. You have 2 hours \(until 10:00\); after that the slot is released\.\nhttps:\/\/estudio-vr-demo\.workers\.dev\/c\/t+\?lang=en\n\nSlot: Thursday, 19 November 2026, from 10:00 to 10:45\nPlace: / : /^Hola Ana,\n\nConfirma tu turno abriendo este enlace y pulsando «Confirmar mi turno»\. Tienes 2 horas \(hasta las 10:00\); después el turno se libera\.\nhttps:\/\/estudio-vr-demo\.workers\.dev\/c\/t+\?lang=es\n\nTurno: jueves, 19 de noviembre de 2026, de 10:00 a 10:45\nLugar: /);
    assert.ok(c.text.includes(place) && strip(c.html).includes(place), "lugar en texto y html");
    assert.match(c.html, en ? />Confirm my slot<\/a>/ : />Confirmar mi turno<\/a>/);
    assert.match(c.html, en ? /until 10:00/ : /hasta las 10:00/);
    // 2 confirmado
    const k = all.confirmed;
    assert.equal(k.subject, en ? "Slot confirmed: 19/11 10:00" : "Turno confirmado: 19/11 10:00");
    assert.match(k.text, en ? /Duration: 45 minutes\. Please arrive a few minutes early\. ?$/m : /Duración: 45 minutos\. Llega unos minutos antes\. ?$/m);
    assert.match(k.text, en ? /Add to calendar: https:\/\/\S+\/ics\/\S+\nCancel the slot, if you cannot come: https:\/\/\S+\/x\// : /Añadir al calendario: https:\/\/\S+\/ics\/\S+\nCancelar el turno, si no puedes venir: https:\/\/\S+\/x\//);
    assert.ok(k.text.includes(place) && strip(k.html).includes(place));
    assert.match(k.html, en ? />Add to calendar<\/a>.*>cancel the slot<\/a>/s : />Añadir al calendario<\/a>.*>cancelar el turno<\/a>/s);
    // 3 recordatorio
    assert.equal(all.reminder.subject, en ? "Tomorrow at 10:00: virtual reality study" : "Mañana a las 10:00: estudio de realidad virtual");
    assert.ok(all.reminder.text.includes(place) && strip(all.reminder.html).includes(place));
    // 4 cancelación
    assert.equal(all.cancelled.subject, en ? "Slot cancelled: 19/11 10:00" : "Turno cancelado: 19/11 10:00");
    assert.match(all.cancelled.text, en ? /We have had to cancel your slot on Thursday, 19 November 2026, from 10:00 to 10:45\. We are sorry\.\nYou can choose another one here: / : /Hemos tenido que cancelar tu turno del jueves, 19 de noviembre de 2026, de 10:00 a 10:45\. Lo sentimos\.\nPuedes elegir otro aquí: /);
    // 5 no vino
    assert.equal(all.noshow.subject, en ? "Would you like to choose another slot?" : "¿Quieres elegir otro turno?");
    assert.match(all.noshow.text, en ? /We did not see you at your slot on / : /No te vimos en tu turno del /);
  }
  // ES usa «», EN usa “” (y no al revés)
  assert.match(tplConfirmRequest(ENV, B("es")).text, /«Confirmar mi turno»/); assert.doesNotMatch(tplConfirmRequest(ENV, B("es")).text, /[“”]/);
  assert.match(tplConfirmRequest(ENV, B("en")).text, /“Confirm my slot”/); assert.doesNotMatch(tplConfirmRequest(ENV, B("en")).text, /[«»]/);
  // con nota: párrafo propio
  assert.match(tplCancelled(ENV, B("es"), "Nota.").text, /Lo sentimos\.\n\nNota\.\n\nPuedes elegir otro/);
  // hora límite en hora local, también en horario de verano (UTC+2)
  assert.match(tplConfirmRequest(ENV, { ...B("es"), expires_at: "2026-07-01T10:30:00.000Z" }).text, /hasta las 12:30/);
});

test("D28 .ics: LOCATION con la dirección completa en cada idioma y duración sin 'about'/'unos'", () => {
  const es = buildIcs(ENV, B("es"), localToUtc), en = buildIcs(ENV, B("en"), localToUtc);
  assert.ok(es.includes("LOCATION:" + PLACE.es.replace(/,/g, "\\,")));
  assert.ok(en.includes("LOCATION:" + PLACE.en.replace(/,/g, "\\,")));
  assert.match(es, /DESCRIPTION:Sesión individual de 45 minutos\. Llega unos minutos antes\.\\nLugar: .*\\nSi no puedes venir\\, cancela aquí: https:\/\/\S+\/x\//);
  assert.match(en, /DESCRIPTION:Individual session of 45 minutes\. Please arrive a few minutes early\.\\nPlace: .*\\nIf you cannot come\\, cancel here: https:\/\/\S+\/x\//);
  assert.ok(!/[Cc]ódigo|code/.test(es + en), "sin el código de la reserva en el calendario");
  for (const ics of [es, en]) for (const line of ics.split("\r\n")) assert.ok(!/[^\\][,;]/.test(line.replace(/^[A-Z-]+[:;]/, "").replace(/\\[,;n\\]/g, "")) || /^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|UID|DTSTAMP|DTSTART|DTEND|TRIGGER|ACTION)/.test(line), line);
});

test("D29 aviso al administrador: asunto con dd/mm, línea 'nombre <correo> · Estudio N', enlace al día", () => {
  const a = tplAdmin(ENV, "confirmed", B("es"));
  assert.equal(a.subject, "Reserva confirmada: 19/11 10:00");
  assert.match(a.text, /^Reserva confirmada\nAna <ana@unidemo\.es> · Estudio 2\njueves, 19 de noviembre, 10:00–10:45\nDía en el panel: https:\/\/estudio-vr-demo\.workers\.dev\/admin\?day=2026-11-19$/);
  const c = tplAdmin(ENV, "cancelled_by_participant", { ...B("es"), study: "study1", name: "<b>" });
  assert.equal(c.subject, "Cancelada por la persona: 19/11 10:00");
  assert.match(c.text, /Estudio 1/);
  assert.match(c.html, /&lt;b&gt; &lt;ana@unidemo\.es&gt; · Estudio 1/); assert.doesNotMatch(c.html, /<b>/);
  assert.match(c.html, />Abrir el día en el panel<\/a>/);
});

test("D30 las páginas públicas describen el estudio en los dos idiomas y estudios", async () => {
  const { DB, env } = await setup(ENV);
  const pages = [];
  for (const st of ["study1", "study2"]) {
    await D.setSetting(DB, "active_study", st);
    for (const lang of ["es", "en"]) for (const p of ["/", "/condiciones", "/privacidad"]) pages.push(await text(await call(env, req(`${p}?lang=${lang}`))));
  }
  for (const h of pages) {
    assert.doesNotMatch(h, /\b(unos|about) \d+ (minutos|minutes)/i, "sin 'unos/about' antes de los minutos");
  }
  // La entradilla dice qué se prueba y para qué, y cambia con el estudio activo (aquí queda puesto el 2).
  const es2 = await text(await call(env, req("/?lang=es"))), en2 = await text(await call(env, req("/?lang=en")));
  assert.ok(es2.includes("Con las gafas puestas, probarás distintas formas de moverte por un entorno de realidad virtual. El objetivo es saber cómo hacer que la realidad virtual sea más cómoda y fácil de usar."));
  assert.ok(en2.includes("Wearing the headset, you will try different ways of moving around a virtual reality environment. The aim is to learn how to make virtual reality more comfortable and easier to use."));
  await D.setSetting(DB, "active_study", "study1");
  const es = await text(await call(env, req("/?lang=es"))), en = await text(await call(env, req("/?lang=en")));
  const q = (s) => s.replace(/&#39;/g, "'");
  assert.ok(es.includes("Con las gafas puestas, manejarás los menús de una aplicación de realidad virtual de distintas formas, con los mandos o con las manos según el grupo que te toque. El objetivo es saber cómo hacer que la realidad virtual sea más fácil de usar. Es un estudio de investigación del grupo DemoLab de la Universidad de Ejemplo."));
  assert.ok(en.includes("Wearing the headset, you will use the menus of a virtual reality application in different ways, with controllers or with your hands depending on the group you are assigned to. The aim is to learn how to make virtual reality easier to use. This is a research study of the DemoLab group at the Universidad de Ejemplo."));
  assert.ok(q(es).includes('content="Prueba distintas formas de usar una aplicación de realidad virtual y ayúdanos a que sea más fácil de usar. Sesión de 45 minutos en el laboratorio 1.2.34 de la EDI (Villaejemplo)."'));
  assert.ok(q(en).includes('content="Try different ways of using a virtual reality application and help us make it easier to use. A 45-minute session in laboratory 1.2.34 of the EDI (Villaejemplo)."'));
  assert.ok(es.includes("La sesión es individual y no hace falta experiencia previa con realidad virtual."));
  assert.ok(en.includes("The session is one person at a time and no previous experience with virtual reality is needed."));
  await D.setSetting(DB, "active_study", "study2");
  assert.ok((await text(await call(env, req("/?lang=es")))).includes("te moverás por un entorno virtual siguiendo unos anillos."));
  assert.ok((await text(await call(env, req("/?lang=en")))).includes("you will move around a virtual environment by following some rings."));
});

test("D31 privacidad y frases de las páginas: cancelar no borra los datos; frases corregidas en ES y EN", async () => {
  const { env } = await setup({ ...ENV });
  const es = await text(await call(env, req("/privacidad?lang=es"))), en = await text(await call(env, req("/privacidad?lang=en")));
  assert.match(es, /puedes retirar cuando quieras, cancelando la reserva\./);
  assert.match(es, /Para cancelar tu reserva tienes dos caminos: el enlace de cancelación del correo de confirmación, o «Gestionar mi reserva» en la página de inicio, con tu correo y el código de reserva de 6 cifras que también va en el correo\. Cancelar no borra los datos: tus datos de reserva se borran como máximo 30 días después de la fecha del turno; si quieres que se borren antes, escríbenos respondiendo al correo\./);
  assert.doesNotMatch(es, /Para borrar tu reserva, cancélala/);
  assert.match(en, /To cancel your booking there are two ways: the cancellation link in the confirmation email, or “Manage my booking” on the home page, with your email address and the 6-digit booking code that is also in the email\. Cancelling does not delete the data: your booking data is deleted at most 30 days after the date of the slot; if you want it deleted sooner, reply to the email\./);
  assert.doesNotMatch(en, /To delete your booking, cancel it/);
  // con relay: «Te enviaremos un correo...»; y las cuatro frases en inglés
  const { env: envR } = await setup({ ...ENV, ...RELAY });
  const homeEsR = await text(await call(envR, req("/?lang=es"))), homeEnR = await text(await call(envR, req("/?lang=en")));
  assert.match(homeEsR, /Te enviaremos un correo con un enlace\. Tienes 2 horas para confirmar el turno\./);
  assert.match(homeEnR, /We will email you a link\. You have 2 hours to confirm the slot\./);
  assert.match(homeEnR, /Taking part is voluntary and unpaid: you can stop at any time, without giving a reason and with no consequence\./);
  assert.match(homeEnR, /Cancel with the link in the confirmation email or under ("|&quot;)Manage my booking("|&quot;), with your email address and your code\. That way someone else can use the slot\. There is no penalty\./);
  assert.doesNotMatch(homeEnR, /It is not paid|Cancelling is fine/);
  // sin relay el texto no promete un correo
  assert.doesNotMatch(await text(await call(env, req("/?lang=es"))), /Te enviaremos un correo/);
  const slot = await (await import("./helpers.mjs")).book(env, {});
  const hb = await text(slot);
  assert.match(hb, /sirve para cancelar o ver los detalles\./); assert.doesNotMatch(hb, /No pasa nada por cancelar/);
});

test("D32 Apps Script: REPLY_TO como replyTo, cuota agotada responde 'quota', cabecera y README hablan de la cuenta del estudio", () => {
  const gs = read("apps-script/Code.gs");
  assert.match(gs, /getProperty\('REPLY_TO'\)/); assert.match(gs, /opts\.replyTo = replyTo/);
  const q = gs.indexOf("getRemainingDailyQuota() < 1"), send = gs.indexOf("MailApp.sendEmail(opts)");
  assert.ok(q > 0 && send > q, "la cuota se mira antes de enviar");
  assert.match(gs, /return out_\(\{ ok: false, error: 'quota' \}\)/);
  // The Apps Script header is in English now (the script is shared by labs of any language).
  assert.match(gs, /Gmail account OF THE STUDY \(not a personal one\)/);
  const readme = read("README.it.md");
  assert.match(readme, /account Gmail dello studio, non quello personale/);
  assert.doesNotMatch(readme, /account Gmail del ricercatore/);
  for (const t of ["schema.sql", "REPLY_TO", "mail_log", "Invitar", "mail_fail_last", "cron_result", "Hoy y mañana", "20 richieste/10 min"]) assert.ok(readme.includes(t), t);
});

test("A2 schema.sql y src/schema.js (la que ejecuta el Worker) declaran mail_log con las mismas sentencias", () => {
  const sql = "CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, err TEXT, at TEXT NOT NULL)";
  const idx = "CREATE INDEX IF NOT EXISTS ix_mail_booking ON mail_log(booking_id, at)";
  for (const f of ["schema.sql", "src/schema.js"]) { const s = read(f); assert.ok(s.includes(sql), f); assert.ok(s.includes(idx), f); }
});

// ---- invitaciones ------------------------------------------------------------------
const snapshot = (DB) => JSON.stringify(["bookings", "days", "day_slots", "mail_log", "rate_limit"].map((t) => DB.raw.prepare(`SELECT * FROM ${t}`).all()));
const invite = (env, s, fields, now = NOW, fetchFn) => adminDo(env, s, "invite", fields, now, fetchFn);
const hrefs = (h) => [...h.matchAll(/href="(mailto:[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

test("E33 invitar: la respuesta es la página (200), con recuentos, asunto y texto de solo lectura y enlaces mailto con Cco", async () => {
  const { DB, env, s } = await admin({ ...ENV, ...RELAY });
  ins(DB, { id: "i1", email: "vivo@unidemo.es", status: "confirmed" });
  ins(DB, { id: "i2", email: "pend@unidemo.es", status: "pending", expires_at: "2026-11-16T11:00:00.000Z", time: "10:30" });
  ins(DB, { id: "i3", email: "viejo@unidemo.es", status: "cancelled", time: "11:30" }); // cancelada: no cuenta como activa
  const input = ["ana@unidemo.es, Ana@Unidemo.es", "bea@unidemo.es;mal@", "vivo@unidemo.es", "PEND@unidemo.es", "viejo@unidemo.es", "<script>alert(1)</script>", "a+b@unidemo.es", "a&b@unidemo.es", "x@y"].join("\n");
  const m = relay();
  const r = await invite(env, s, { addresses: input, invlang: "es", day: DAY }, NOW, m.fn);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("location"), null, "no es una redirección");
  assert.equal(m.calls.length, 0, "no se envía nada");
  const h = await r.text();
  assert.match(h, /<h2 id="now-title">/, "es la página de administración");
  assert.doesNotMatch(h, /<script/i); assert.doesNotMatch(h, /<script>alert/);
  assert.match(h, /Válidas, en la invitación: <strong>5<\/strong>/); // ana, bea, viejo, a+b, a&b
  assert.match(h, /Repetidas \(descartadas\): <strong>1<\/strong>/);
  assert.match(h, /No válidas: <strong>3<\/strong>.*mal@.*script&gt;alert\(1\)&lt;\/script.*x@y/s);
  assert.match(h, /Ya tienen una reserva activa \(descartadas\): <strong>2<\/strong>.*vivo@unidemo\.es.*PEND@unidemo\.es/s);
  assert.match(h, /<input id="inv-subject" type="text" readonly value="Participa en un estudio de realidad virtual \(EDI\)">/);
  const inv = invitation(ENV, "es");
  assert.equal(inv.body, "Hola:\n\nBuscamos personas para un estudio de realidad virtual del grupo DemoLab (Universidad de Ejemplo). Con las gafas puestas, probarás distintas formas de usar una aplicación de realidad virtual: queremos saber cómo hacer que la realidad virtual sea más fácil de usar. Es una sesión individual de 45 minutos en el laboratorio 1.2.34 de la EDI, en Villaejemplo. No hace falta experiencia previa. La participación es voluntaria y no se paga.\n\nPuedes reservar turno aquí:\nhttps://estudio-vr-demo.workers.dev/?lang=es\n\nGracias,\nNombre Apellido\nDemoLab, Universidad de Ejemplo");
  assert.match(h, /<textarea id="inv-body" readonly rows="12">Hola:\n\nBuscamos personas/);
  const links = hrefs(h);
  const bcc = links.filter((l) => l.startsWith("mailto:?bcc="));
  assert.equal(bcc.length, 1);
  const u = new URL(bcc[0]);
  assert.equal(u.searchParams.get("bcc"), "ana@unidemo.es,bea@unidemo.es,viejo@unidemo.es,a+b@unidemo.es,a&b@unidemo.es");
  assert.equal(u.searchParams.get("subject"), inv.subject);
  assert.equal(u.searchParams.get("body"), inv.body.replace(/\n/g, "\r\n"));
  assert.ok(bcc[0].includes("a%2Bb@unidemo.es,a%26b@unidemo.es"), "+ y & codificados");
  assert.ok(!/[\n\r ]/.test(bcc[0]), "ningún espacio ni salto sin codificar");
  assert.match(h, />Abrir en tu correo: direcciones 1 a 5<\/a>/);
  assert.match(h, /<details class="surface settings" id="invitar" open>/);
});

test("E33 invitar: bloques de 40 direcciones, inglés, y nada se guarda", async () => {
  const { DB, env, s } = await admin({ ...ENV });
  const addr = Array.from({ length: 95 }, (_, i) => `p${i}@unidemo.es`);
  const before = snapshot(DB);
  const r = await invite(env, s, { addresses: addr.join(", "), invlang: "en" });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.equal(snapshot(DB), before, "ni reservas ni registro ni nada: las direcciones no se guardan");
  assert.doesNotMatch(JSON.stringify(DB.raw.prepare("SELECT * FROM settings").all()), /p\d+@unidemo\.es/);
  const bcc = hrefs(h).filter((l) => l.startsWith("mailto:?bcc="));
  assert.equal(bcc.length, 3);
  assert.deepEqual(bcc.map((l) => new URL(l).searchParams.get("bcc").split(",").length), [40, 40, 15]);
  assert.match(h, />Abrir en tu correo: direcciones 1 a 40<\/a>/); assert.match(h, />Abrir en tu correo: direcciones 41 a 80<\/a>/); assert.match(h, />Abrir en tu correo: direcciones 81 a 95<\/a>/);
  assert.equal(new URL(bcc[0]).searchParams.get("subject"), "Take part in a virtual reality study (EDI)");
  assert.ok(new URL(bcc[0]).searchParams.get("body").includes("It is a 45-minute session, one person at a time, in laboratory 1.2.34 of the EDI, in Villaejemplo."));
  assert.equal(invitation(ENV, "en").body, "Hello,\n\nWe are looking for people to take part in a virtual reality study of the DemoLab group (Universidad de Ejemplo). Wearing the headset, you will try different ways of using a virtual reality application: we want to learn how to make virtual reality easier to use. It is a 45-minute session, one person at a time, in laboratory 1.2.34 of the EDI, in Villaejemplo. No previous experience is needed. Taking part is voluntary and unpaid.\n\nYou can book a slot here:\nhttps://estudio-vr-demo.workers.dev/?lang=en\n\nThank you,\nNombre Apellido\nDemoLab, Universidad de Ejemplo");
  // vacío: sin enlaces
  const empty = await (await invite(env, s, { addresses: "  ,, " })).text();
  assert.match(empty, /No hay direcciones válidas para invitar\./); assert.equal(hrefs(empty).filter((l) => l.startsWith("mailto:?bcc=")).length, 0);
});

test("E33 invitar: exige sesión y CSRF como el resto de acciones", async () => {
  const { env, s } = await admin({ ...ENV });
  const noCsrf = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: "invite", addresses: "a@unidemo.es" } }));
  assert.equal(noCsrf.status, 403);
  const noSession = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: "invite", addresses: "a@unidemo.es" } }));
  assert.equal(noSession.status, 401);
  assert.doesNotMatch(await noSession.text(), /a@unidemo\.es/);
  // la sección aparece plegada y sin script en el panel
  const dash = await text(await call(env, req("/admin?s=all", { cookie: s.cookie })));
  assert.match(dash, /<details class="surface settings" id="invitar"><summary>Invitar<\/summary>/);
  assert.match(dash, /Direcciones \(una por línea o separadas por comas\)/); assert.match(dash, /<option value="es">Español<\/option><option value="en">English<\/option>/);
  assert.match(dash, /value="invite" class="plain">Preparar invitación/);
});
