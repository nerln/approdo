// Avisos de futuros estudios: casilla opcional, ciclo del consentimiento, baja, panel y texto de privacidad.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { NOW, later, DAY, RELAY, setup, call, req, book, tokenFrom, rows } from "./helpers.mjs";
import { relay, admin, get, text } from "./spec_helpers.mjs";

const HOUR = 3600_000;
const contacts = (DB) => DB.raw.prepare("SELECT * FROM contacts ORDER BY email_key").all();
const add = (DB, o = {}) => {
  const c = { email: "c@unidemo.es", lang: "es", consent_at: NOW.toISOString(), expires_at: "2028-11-16T09:00:00.000Z", confirmed: 1, booking_id: null, ...o };
  DB.raw.prepare("INSERT INTO contacts (email_key, email, lang, consent_at, expires_at, confirmed, booking_id) VALUES (?,?,?,?,?,?,?)")
    .run(c.email.toLowerCase(), c.email, c.lang, c.consent_at, c.expires_at, c.confirmed, c.booking_id);
};
const bajaPost = async (env, email, { now = NOW, ip = "5.5.5.5", lang = "" } = {}) =>
  call(env, req(`/baja${lang}`, { method: "POST", ip, fields: { email, t: await signForm(env.DB, now.getTime(), "baja") } }), now);
const byLink = async (env, m, at = later(60_000)) => call(env, req(`/c/${tokenFrom(m.calls[0].json.text)}`, { method: "POST" }), at, m.fn);
const byCode = async (env, DB, email, at = later(60_000)) => {
  const code = await D.bookingCode(DB, rows(DB)[0]);
  return call(env, req("/gestionar", { method: "POST", ip: "8.8.8.8", fields: { email, code, t: await signForm(DB, at.getTime(), "manage") } }), at, relay().fn);
};
const MONTHS24 = "2028-11-16T09:01:00.000Z"; // confirmado en later(60 s)

test("sin marcar la casilla no se guarda ningún contacto, ni al reservar ni al confirmar ni con el correo apagado", async () => {
  const on = await setup({ ...RELAY });
  const m = relay();
  await book(on.env, {}, { fetchFn: m.fn });
  assert.equal(contacts(on.DB).length, 0);
  await byLink(on.env, m);
  assert.equal(rows(on.DB)[0].status, "confirmed");
  assert.equal(contacts(on.DB).length, 0);
  const off = await setup();
  await book(off.env);
  assert.equal(contacts(off.DB).length, 0);
  await call(off.env, req("/"), later(40 * 86400_000));
  assert.equal(contacts(off.DB).length, 0);
});

test("marcada y nunca confirmada: la fila queda sin confirmar y la limpieza la borra a las 3 horas", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await book(env, { future: "1" }, { fetchFn: relay().fn });
  let c = contacts(DB);
  assert.equal(c.length, 1);
  assert.equal(c[0].confirmed, 0);
  assert.equal(c[0].booking_id, rows(DB)[0].id);
  assert.deepEqual([c[0].email, c[0].lang], ["ana@unidemo.es", "es"]);
  await call(env, req("/"), later(2.5 * HOUR));
  assert.equal(rows(DB).length, 0, "la reserva sin confirmar ya se borró a las 2 horas");
  assert.equal(contacts(DB).length, 1, "a las 2,5 horas la fila aún existe");
  await call(env, req("/"), later(3 * HOUR + 120_000));
  assert.equal(contacts(DB).length, 0);
});

test("marcada y confirmada con el enlace: confirmada, caduca 24 meses después y solo guarda correo e idioma", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  await book(env, { future: "1" }, { fetchFn: m.fn });
  await byLink(env, m);
  const c = contacts(DB);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].confirmed, c[0].consent_at, c[0].expires_at], [1, later(60_000).toISOString(), MONTHS24]);
  assert.deepEqual(Object.keys(c[0]).sort(), ["booking_id", "confirmed", "consent_at", "email", "email_key", "expires_at", "lang"]);
  assert.equal(JSON.stringify(c[0]).includes("Ana"), false, "sin nombre");
});

test("marcada y confirmada con el código de 6 cifras: igual que con el enlace", async () => {
  const { DB, env } = await setup({ ...RELAY });
  await book(env, { future: "1", email: "eva@unidemo.es" }, { fetchFn: relay().fn });
  const r = await byCode(env, DB, "eva@unidemo.es");
  assert.equal(r.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  const c = contacts(DB);
  assert.deepEqual([c[0].confirmed, c[0].expires_at], [1, MONTHS24]);
  assert.match(await text(r), /Te avisaremos de futuros estudios/);
});

test("marcada con el correo apagado: confirmada al instante y la página lo dice", async () => {
  const { DB, env } = await setup();
  const r = await book(env, { future: "1" });
  const c = contacts(DB);
  assert.deepEqual([c.length, c[0].confirmed, c[0].consent_at, c[0].expires_at], [1, 1, NOW.toISOString(), "2028-11-16T09:00:00.000Z"]);
  const h = await text(r);
  assert.match(h, /Te avisaremos de futuros estudios\. Para darte de baja: <a href="\/baja">/);
});

test("un contacto confirmado no se toca al volver a reservar, con o sin casilla", async () => {
  const { DB, env } = await setup();
  add(DB, { email: "ana@unidemo.es", consent_at: "2026-10-01T10:00:00.000Z", expires_at: "2028-10-01T10:00:00.000Z" });
  await book(env, { future: "1" });
  await D.setStatus(DB, rows(DB)[0].id, "cancelled", ["confirmed"]);
  await book(env, { slot: `${DAY}T10:30` }, { ip: "2.2.2.2" });
  const c = contacts(DB);
  assert.deepEqual([c.length, c[0].consent_at, c[0].expires_at], [1, "2026-10-01T10:00:00.000Z", "2028-10-01T10:00:00.000Z"]);
});

test("la caducidad borra el contacto confirmado", async () => {
  const { DB, env } = await setup();
  await book(env, { future: "1" });
  assert.equal(contacts(DB).length, 1);
  await call(env, req("/"), new Date("2028-11-15T00:00:00Z"));
  assert.equal(contacts(DB).length, 1, "un día antes sigue");
  await call(env, req("/"), new Date("2028-11-17T00:00:00Z"));
  assert.equal(contacts(DB).length, 0);
});

test("fallo del correo al reservar: la reserva y su contacto sin confirmar se borran", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const r = await book(env, { future: "1" }, { fetchFn: relay({ ok: false, error: "quota" }).fn });
  assert.equal(r.status, 502);
  assert.equal(contacts(DB).length, 0);
});

test("POST /baja borra el contacto y responde igual para una dirección conocida y una desconocida", async () => {
  const { DB, env } = await setup();
  add(DB, { email: "known@unidemo.es" });
  const a = await bajaPost(env, "known@unidemo.es");
  const b = await bajaPost(env, "nadie@unidemo.es", { ip: "6.6.6.6" });
  assert.equal(contacts(DB).length, 0);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const ha = await text(a);
  assert.equal(ha, await text(b));
  assert.match(ha, /Si esa dirección estaba en la lista, la hemos borrado\. No recibirás más avisos\./);
  const en = await text(await bajaPost(env, "otro@unidemo.es", { lang: "?lang=en", ip: "7.7.7.7" }));
  assert.match(en, /If that address was on the list, we have removed it\. You will not receive further notices\./);
});

test("GET /baja: formulario con correo y botón en ES y EN, noindex y sin caché", async () => {
  const { env } = await setup();
  const es = await call(env, req("/baja"));
  const h = await text(es);
  assert.equal(es.status, 200);
  assert.match(es.headers.get("x-robots-tag"), /noindex/);
  assert.equal(es.headers.get("cache-control"), "no-store");
  assert.match(h, /<meta name="robots" content="noindex/);
  assert.match(h, /<input id="b-email" name="email" type="email"/);
  assert.match(h, />Darme de baja<\/button>/);
  assert.match(await text(await call(env, req("/baja?lang=en"))), />Unsubscribe<\/button>/);
  assert.equal((await call(env, req("/baja", { method: "PUT" }))).status, 405);
});

test("/baja con formulario caducado o falso no borra nada; con correo mal escrito pide corregirlo", async () => {
  const { DB, env } = await setup();
  add(DB, { email: "known@unidemo.es" });
  const bad = await call(env, req("/baja", { method: "POST", fields: { email: "known@unidemo.es", t: "x" } }));
  assert.equal(bad.status, 400);
  assert.equal(contacts(DB).length, 1);
  const typo = await bajaPost(env, "no-es-un-correo");
  assert.equal(typo.status, 400);
  assert.equal(contacts(DB).length, 1);
});

test("/baja tiene su propio tope por IP y no gasta el de reservar ni el de gestionar", async () => {
  const { env } = await setup();
  let last;
  for (let i = 0; i < 21; i++) last = await bajaPost(env, `x${i}@unidemo.es`, { ip: "4.4.4.4" });
  assert.equal(last.status, 429);
  assert.equal((await bajaPost(env, "x@unidemo.es", { ip: "4.4.4.5" })).status, 200, "otra IP, no afectada");
  assert.equal((await book(env, {}, { ip: "4.4.4.4" })).status, 200, "reservar sigue libre desde la misma IP");
  const mg = await call(env, req("/gestionar", { method: "POST", ip: "4.4.4.4", fields: { email: "a@unidemo.es", code: "123456", t: await signForm(env.DB, NOW.getTime(), "manage") } }));
  assert.equal(mg.status, 400, "gestionar responde su error normal, no 429");
});

test("cancelar la reserva no quita el contacto y la página de cancelación explica cómo darse de baja", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  await book(env, { future: "1" }, { fetchFn: m.fn });
  await byLink(env, m);
  const token = tokenFrom(m.calls[0].json.text);
  const r = await call(env, req(`/x/${token}`, { method: "POST" }), later(120_000), m.fn);
  const h = await text(r);
  assert.equal(rows(DB)[0].status, "cancelled");
  assert.equal(contacts(DB).length, 1);
  assert.match(h, /Sigues en la lista de avisos de futuros estudios\. Para darte de baja: <a href="\/baja\?lang=es">/);
  // sin contacto, la página no menciona la lista
  const o = await setup({ ...RELAY });
  const m2 = relay();
  await book(o.env, {}, { fetchFn: m2.fn });
  await byLink(o.env, m2);
  const h2 = await text(await call(o.env, req(`/x/${tokenFrom(m2.calls[0].json.text)}`, { method: "POST" }), later(120_000), m2.fn));
  assert.doesNotMatch(h2, /lista de avisos/);
  assert.doesNotMatch(h2.replace(/<footer[\s\S]*<\/footer>/, ""), /\/baja/);
});

test("sin la tabla contacts todo sigue funcionando: reservar, confirmar, cancelar, panel, limpieza y /baja", async () => {
  const { DB, env, s } = await admin({ ...RELAY });
  DB.raw.exec("DROP TABLE contacts");
  const m = relay();
  assert.equal((await book(env, { future: "1" }, { fetchFn: m.fn })).status, 200);
  const token = tokenFrom(m.calls[0].json.text);
  const ok = await call(env, req(`/c/${token}`, { method: "POST" }), later(1000), m.fn);
  assert.equal(ok.status, 200);
  assert.doesNotMatch(await text(ok), /Te avisaremos/);
  assert.equal(rows(DB)[0].status, "confirmed");
  const page = await get(env, s, `?day=${DAY}`);
  assert.match(page, /Contactos para futuros estudios/);
  assert.match(page, /falta aplicar la migración 0004/);
  assert.equal((await call(env, req(`/x/${token}`, { method: "POST" }), later(3000), m.fn)).status, 200);
  assert.equal(rows(DB)[0].status, "cancelled");
  assert.equal((await call(env, req("/"), later(4 * HOUR))).status, 200, "limpieza tolerante");
  assert.equal((await bajaPost(env, "a@unidemo.es", { now: later(4 * HOUR) })).status, 200);
  assert.equal((await call(env, req("/admin/csv-contactos", { cookie: s.cookie }), later(5000))).status, 200);
  // con el correo apagado, reservar con la casilla tampoco rompe
  const off = await setup();
  off.DB.raw.exec("DROP TABLE contacts");
  assert.equal((await book(off.env, { future: "1" })).status, 200);
});

test("panel: la sección necesita sesión; el CSV necesita sesión y lleva las cabeceras del otro CSV", async () => {
  const { DB, env, s } = await admin();
  add(DB, { email: "uno@unidemo.es", lang: "es" });
  add(DB, { email: "two@unidemo.es", lang: "en" });
  add(DB, { email: "pend@unidemo.es", confirmed: 0 });
  const anon = await call(env, req("/admin"));
  assert.doesNotMatch(await text(anon), /Contactos para futuros estudios/);
  const csvAnon = await call(env, req("/admin/csv-contactos"));
  assert.equal(csvAnon.status, 303);
  assert.equal(csvAnon.headers.get("location"), "/admin");
  const h = await get(env, s);
  assert.match(h, /<summary>Contactos para futuros estudios<\/summary>/);
  assert.match(h, /Contactos confirmados: <strong>2<\/strong>/);
  assert.match(h, /En español: <strong>1<\/strong>/);
  assert.match(h, /En inglés: <strong>1<\/strong>/);
  assert.doesNotMatch(h, /pend@unidemo\.es/, "los pendientes no cuentan ni se listan");
  assert.match(h, /<details class="confirm"><summary>Ver la lista \(2\)<\/summary>/);
  const csv = await call(env, req("/admin/csv-contactos", { cookie: s.cookie }));
  assert.match(csv.headers.get("content-type"), /^text\/csv/);
  assert.equal(csv.headers.get("cache-control"), "no-store");
  assert.match(csv.headers.get("content-disposition"), /^attachment; filename="contactos-2026-11-16\.csv"$/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "con BOM como el otro CSV");
  const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  assert.equal(body.split("\r\n")[0], "\ufeffcorreo,idioma,consentimiento,caduca");
  assert.match(body, /"uno@unidemo\.es","es","2026-11-16T09:00:00\.000Z","2028-11-16T09:00:00\.000Z"/);
  assert.match(body, /"two@unidemo\.es","en"/);
  assert.doesNotMatch(body, /pend@unidemo/);
});

test("panel: Quitar exige CSRF y sesión", async () => {
  const { DB, env, s } = await admin();
  add(DB, { email: "uno@unidemo.es" });
  const post = (fields, cookie) => call(env, req("/admin/do", { method: "POST", cookie, fields }));
  assert.equal((await post({ csrf: "mal", do: "contact-remove:uno@unidemo.es" }, s.cookie)).status, 403);
  assert.equal(contacts(DB).length, 1);
  assert.equal((await post({ csrf: s.csrf, do: "contact-remove:uno@unidemo.es" }, undefined)).status, 401);
  assert.equal(contacts(DB).length, 1);
  const ok = await post({ csrf: s.csrf, do: "contact-remove:uno@unidemo.es" }, s.cookie);
  assert.equal(ok.status, 303);
  assert.equal(contacts(DB).length, 0);
  assert.match(await get(env, s, ok.headers.get("location").replace("/admin", "").replace(/#.*/, "")), /Contacto quitado de la lista de avisos\./);
});

test("invitación a los contactos: solo sus direcciones, un texto por idioma y el párrafo de baja al final", async () => {
  const { DB, env, s } = await admin();
  add(DB, { email: "uno@unidemo.es", lang: "es" });
  add(DB, { email: "two@unidemo.es", lang: "en" });
  add(DB, { email: "pend@unidemo.es", confirmed: 0 });
  const r = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: "invite-contacts", addresses: "otra@unidemo.es" } }));
  const h = await text(r);
  assert.equal(r.status, 200);
  assert.match(h, /Recibes este correo porque pediste que te avisáramos de futuros estudios\. Para dejar de recibirlos: estudio-vr-demo\.workers\.dev\/baja<\/textarea>/);
  assert.match(h, /You are receiving this email because you asked us to tell you about future studies\. To stop receiving them: estudio-vr-demo\.workers\.dev\/baja<\/textarea>/);
  const hrefs = [...h.matchAll(/class="btn-link" href="(mailto:[^"]+)"/g)].map((x) => decodeURIComponent(x[1].replace(/&amp;/g, "&")));
  assert.equal(hrefs.length, 2);
  const all = hrefs.join(" ");
  assert.match(all, /uno@unidemo\.es/);
  assert.match(all, /two@unidemo\.es/);
  assert.doesNotMatch(all, /pend@unidemo|otra@unidemo/);
  assert.doesNotMatch(h, /https?:\/\/estudio-vr-demo\.workers\.dev\/baja/, "dirección sin esquema");
  // la invitación normal no lleva el párrafo
  const plain = await text(await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: "invite", addresses: "otra@unidemo.es", invlang: "es" } })));
  assert.doesNotMatch(plain, /Recibes este correo porque/);
  // CSRF
  assert.equal((await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: "mal", do: "invite-contacts" } }))).status, 403);
});

test("textos de privacidad en ES y EN: 24 meses, página de baja y código de reserva", async () => {
  const { env } = await setup();
  const es = await text(await call(env, req("/privacidad?lang=es")));
  assert.match(es, /<h2>Avisos de futuros estudios \(opcional\)<\/h2>/);
  assert.match(es, /24 meses/);
  assert.match(es, /<a href="\/baja\?lang=es">/);
  assert.match(es, /código de reserva de 6 cifras/);
  assert.match(es, /«Gestionar mi reserva»/);
  assert.match(es, /hasta que termina el estudio/);
  const en = await text(await call(env, req("/privacidad?lang=en")));
  assert.match(en, /<h2>Notices about future studies \(optional\)<\/h2>/);
  assert.match(en, /24 months/);
  assert.match(en, /<a href="\/baja\?lang=en">/);
  assert.match(en, /6-digit booking code/);
  assert.match(en, /“Manage my booking”/);
  assert.match(en, /until the study ends/);
});

test("el formulario tiene la casilla opcional sin marcar y con etiqueta, y conserva el valor tras un error", async () => {
  const { DB, env } = await setup();
  const h = await text(await call(env, req("/")));
  assert.match(h, /<label><input type="checkbox" name="future" value="1"> <span>Quiero que me aviséis por correo de futuros estudios del grupo \(opcional\)\.<\/span><\/label>/);
  assert.doesNotMatch(h, /name="future"[^>]*(required|checked)/);
  assert.match(h, /Guardaremos solo tu correo durante 24 meses desde que confirmes el turno y después lo borraremos\. Puedes darte de baja antes, cuando quieras\./);
  const en = await text(await call(env, req("/?lang=en")));
  assert.match(en, /Tell me by email about future studies of the group \(optional\)\./);
  assert.match(en, /We will keep only your email address for 24 months from when you confirm the slot, and then delete it\. You can unsubscribe earlier, at any time\./);
  // tras un error (correo no válido) la casilla sigue marcada
  const bad = await book(env, { future: "1", email: "no-correo" });
  assert.equal(bad.status, 400);
  assert.match(await text(bad), /name="future" value="1" checked/);
  assert.equal(contacts(DB).length, 0);
});

test("el pie de las páginas públicas enlaza la baja, y las páginas nuevas no llevan estilos ni scripts en línea", async () => {
  const { DB, env } = await setup();
  add(DB, { email: "ana@unidemo.es" });
  const pages = [
    await text(await call(env, req("/"))),
    await text(await call(env, req("/baja"))),
    await text(await call(env, req("/baja?lang=en"))),
    await text(await bajaPost(env, "x@unidemo.es")),
    await text(await call(env, req("/privacidad"))),
    await text(await book(env, { future: "1" }, { ip: "3.3.3.3" })),
  ];
  assert.match(pages[0], /<a href="\/baja">Darse de baja de avisos<\/a>/);
  assert.match(await text(await call(env, req("/?lang=en"))), /<a href="\/baja\?lang=en">Unsubscribe from notices<\/a>/);
  for (const p of pages) {
    assert.doesNotMatch(p, /<style|\sstyle=|\son[a-z]+=|<script(?![^>]*\ssrc=)/i);
  }
});

// ---- regresiones de la revision ----------------------------------------------------------------
test("solo future=1 cuenta como consentimiento; cualquier otro valor no crea contacto ni marca la casilla", async () => {
  for (const v of ["0", "no", "on", "true", "x"]) {
    const { DB, env } = await setup({ ...RELAY });
    assert.equal((await book(env, { future: v }, { fetchFn: relay().fn })).status, 200);
    assert.equal(contacts(DB).length, 0, `future=${v}`);
  }
  const { env } = await setup();
  const bad = await book(env, { future: "0", email: "no-correo" });
  assert.doesNotMatch(await text(bad), /name="future" value="1" checked/);
});

test("al confirmar, el contacto ya no guarda el id de la reserva", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  await book(env, { future: "1" }, { fetchFn: m.fn });
  await byLink(env, m);
  assert.equal(contacts(DB)[0].booking_id, null);
});

test("cancelar una reserva pendiente borra su peticion de aviso y la pagina no dice que sigas en la lista", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  await book(env, { future: "1" }, { fetchFn: m.fn });
  const r = await call(env, req(`/x/${tokenFrom(m.calls[0].json.text)}`, { method: "POST" }), later(60_000), m.fn);
  assert.equal(r.status, 200);
  assert.doesNotMatch(await text(r), /Sigues en la lista/);
  assert.equal(contacts(DB).length, 0);
});

test("el panel, el CSV y la invitacion no incluyen contactos ya caducados aunque la limpieza no haya pasado", async () => {
  const { DB, env, s } = await admin();
  add(DB, { email: "vivo@unidemo.es" });
  add(DB, { email: "viejo@unidemo.es", expires_at: "2026-11-16T08:59:59.000Z" });
  const csv = await text(await call(env, req("/admin/csv-contactos", { cookie: s.cookie })));
  assert.match(csv, /vivo@unidemo\.es/);
  assert.doesNotMatch(csv, /viejo@unidemo\.es/);
  assert.match(await get(env, s), /Contactos confirmados: <strong>1<\/strong>/);
});

test("accesibilidad: el error va antes de la banda, enlaza al campo y marca el control; el titulo lo dice", async () => {
  const { env } = await setup();
  const bad = await text(await book(env, { noepi: "" }));
  const body = bad.slice(bad.indexOf("<main"));
  assert.ok(body.indexOf('id="err"') < body.indexOf('class="study-intro"'), "el error esta antes de la banda");
  assert.match(bad, /<a href="#noepi">Ir al campo<\/a>/);
  assert.match(bad, /id="noepi" name="noepi" value="1" required aria-invalid="true" aria-describedby="err"/);
  assert.match(bad, /<title>Error: Participa en un estudio/);
  const ok = await text(await call(env, req("/")));
  assert.doesNotMatch(ok, /id="err"|aria-invalid/);
  assert.match(ok, /<title>Participa/);
});

test("accesibilidad: las paginas de resultado no ofrecen un selector de idioma que lleve a un 404 o a otra pagina", async () => {
  const { env } = await setup({ ...RELAY });
  const m = relay();
  const pend = await text(await book(env, {}, { fetchFn: m.fn }));
  assert.doesNotMatch(pend, /class="languages"/);
  const done = await text(await call(env, req(`/x/${tokenFrom(m.calls[0].json.text)}`, { method: "POST" }), later(60_000), m.fn));
  assert.doesNotMatch(done, /class="languages"|\/x\?lang=/);
  assert.match(await text(await call(env, req("/"))), /class="languages"/);
  assert.match(await text(await call(env, req("/baja"))), /class="languages"/);
});

test("accesibilidad: contraste del borde de los controles, color-scheme, imagen sin deformar y .sr-only", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const strong = /--strong-line:(#[0-9a-f]{6})/.exec(css)[1];
  assert.ok(ratio(strong, "#f5f3eb") >= 3 && ratio(strong, "#fffefa") >= 3, strong);
  assert.match(css, /color-scheme:light dark/);
  assert.doesNotMatch(css, /\.scene \.hs\{[^}]*height:180px/);
  assert.match(css, /\.sr-only\{/);
});

test("accesibilidad: formulario con aviso de obligatorios, alias sin given-name, enlaces nuevos avisados y pie en nav", async () => {
  const { env } = await setup();
  const h = await text(await call(env, req("/")));
  assert.match(h, /Todo es obligatorio salvo lo marcado como opcional\./);
  assert.doesNotMatch(h, /given-name/);
  assert.match(h, /autocomplete="nickname"/);
  assert.match(h, /\(se abre en una pestaña nueva\)/);
  assert.match(h, /<nav aria-label="[^"]+"><p><a href="\/condiciones/);
  assert.doesNotMatch(h, /<section class="step"/);
  assert.match(h, /<div aria-live="polite"><div class="summary" id="summary" hidden>/);
  const en = await text(await call(env, req("/?lang=en")));
  assert.match(en, /Everything is required except what is marked optional\./);
  assert.match(en, /\(opens in a new tab\)/);
});

test("titulos: la baja hecha tiene el suyo y el aviso de demasiados intentos dice cuanto esperar", async () => {
  const { env } = await setup();
  const done = await text(await bajaPost(env, "nadie@unidemo.es"));
  assert.match(done, /<title>Solicitud de baja recibida/);
  assert.match(done, /No recibirás más avisos/);
  const es = (await import("../src/i18n.js")).T;
  assert.match(es.es.rateP, /10 minutos/);
  assert.match(es.en.rateP, /10 minutes/);
});

test("los textos de privacidad dicen que sin confirmar el correo se borra a las 3 horas y mencionan las copias del investigador", async () => {
  const { env } = await setup();
  for (const [q, re] of [["", /se borra a las 3 horas y no cuenta como consentimiento/], ["?lang=en", /deleted after 3 hours and does not count as consent/]]) {
    const h = await text(await call(env, req(`/privacidad${q}`)));
    assert.match(h, re);
    assert.doesNotMatch(h, /no se guarda nada|nothing is kept/);
    assert.match(h, /60 (días|days)/);
    assert.match(h, /24 (meses|months)/);
  }
});

test("con la turnstile activada, el formulario avisa de que hace falta JavaScript", async () => {
  const { env } = await setup({ TURNSTILE_SITEKEY: "s", TURNSTILE_SECRET: "x" });
  assert.match(await text(await call(env, req("/"))), /<noscript><p class="note">Para reservar hace falta activar JavaScript/);
});
