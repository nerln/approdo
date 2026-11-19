import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { langFromHeader } from "../src/i18n.js";
import { C } from "../src/config.js";
import { NOW, later, DAY, RELAY, setup, mockFetch, call, book, tokenFrom, rows, adminSession, adminDo } from "./helpers.mjs";

const PW = "una-contrasena-larga-123";
const text = (r) => r.text();
const rq = (path, { lang, cookie, method = "GET", fields } = {}) => {
  const headers = { "cf-connecting-ip": "1.2.3.4" };
  if (lang !== undefined) headers["accept-language"] = lang;
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (fields) { init.body = new URLSearchParams(fields); headers["content-type"] = "application/x-www-form-urlencoded"; }
  return new Request("https://estudio-vr-demo.workers.dev" + path, init);
};
const htmlLang = (h) => /<html lang="(\w+)"/.exec(h)[1];
const PUBLIC = ["/", "/condiciones", "/privacidad"];

// ---- idioma --------------------------------------------------------------------
test("Accept-Language: es, ca, gl y eu dan español; el resto inglés; sin cabecera, español", () => {
  for (const h of ["es-ES,es;q=0.9", "ca", "ca-ES,en;q=0.5", "gl", "eu", "es", "fr,es;q=0.5", "en;q=0.5, es;q=0.9", "ES-es"]) assert.equal(langFromHeader(h), "es", h);
  for (const h of ["en-GB", "en-US,es;q=0.8", "de", "fr-FR,de;q=0.8", "*", "es;q=0", "en,ca;q=0.9"]) assert.equal(langFromHeader(h), "en", h);
  assert.equal(langFromHeader(""), "es");
  assert.equal(langFromHeader(undefined), "es");
});

test("la cabecera elige el idioma de las páginas públicas y ?lang lo anula", async () => {
  const { env } = await setup();
  for (const p of PUBLIC) {
    assert.equal(htmlLang(await text(await call(env, rq(p, { lang: "ca-ES,ca;q=0.9" })))), "es", p);
    assert.equal(htmlLang(await text(await call(env, rq(p, { lang: "en-GB,en;q=0.9" })))), "en", p);
    assert.equal(htmlLang(await text(await call(env, rq(p)))), "es", p);
    assert.equal(htmlLang(await text(await call(env, rq(p + "?lang=en", { lang: "es-ES" })))), "en", p);
    assert.equal(htmlLang(await text(await call(env, rq(p + "?lang=es", { lang: "en-GB" })))), "es", p);
    assert.equal(htmlLang(await text(await call(env, rq(p + "?lang=fr", { lang: "en-GB" })))), "en", "valor no válido: manda la cabecera");
  }
  const r = await call(env, rq("/", { lang: "en" }));
  assert.match(r.headers.get("vary"), /Accept-Language/i);
  assert.ok(!r.headers.get("set-cookie"));
});

const internal = (h) =>
  [...h.matchAll(/(?:href|action)="(\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"))
    .filter((u) => !/^\/(style\.css|admin\.css|theme\.css|favicon\.svg|booking\.js)/.test(u));

test("?lang se conserva en todos los enlaces y formularios internos", async () => {
  const { env } = await setup({ ...RELAY });
  const m = mockFetch();
  for (const lang of ["en", "es"]) {
    const other = lang === "en" ? "es" : "en";
    for (const p of PUBLIC) {
      const h = await text(await call(env, rq(`${p}?lang=${lang}`)));
      const links = internal(h).filter((u) => !u.includes(`lang=${other}`)); // el selector apunta al otro idioma
      assert.ok(links.length >= 2, p);
      for (const u of links) assert.ok(u.includes(`lang=${lang}`), `${p} ${u}`);
      assert.ok(h.includes(`href="${p}?lang=${other}"`), "el selector de idioma está");
    }
    // la acción del formulario también
    const home = await text(await call(env, rq(`/?lang=${lang}`)));
    assert.match(home, new RegExp(`action="/reservar\\?lang=${lang}"`));
  }
  // sin elección explícita los enlaces quedan limpios
  const clean = internal(await text(await call(env, rq("/", { lang: "en" })))).filter((u) => !u.startsWith("/?lang=") && !u.startsWith("/condiciones?lang=") && !u.startsWith("/privacidad?lang="));
  assert.ok(clean.every((u) => !u.includes("lang=")), clean.join());
  // pantallas de reserva: heredan el idioma de la reserva
  const r = await book(env, { slot: `${DAY}T10:30` }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
});

test("la página de inicio en inglés", async () => {
  const { DB, env } = await setup({ BASE_URL: "https://estudio-vr-demo.workers.dev" });
  const r = await call(env, rq("/?lang=en"));
  assert.equal(r.status, 200);
  const h = await text(r);
  for (const re of [
    /<html lang="en">/, /property="og:locale" content="en_GB"/, /property="og:locale:alternate" content="es_ES"/,
    /hreflang="es" href="https:\/\/estudio-vr-demo\.workers\.dev\/\?lang=es"/, /hreflang="en" href="https:\/\/estudio-vr-demo\.workers\.dev\/\?lang=en"/, /hreflang="x-default"/,
    /Take part in a virtual reality study/, /DemoLab VR/, /Choose a day and a time/, /Your details/, /Book slot/, /Wednesday,? 18 November/,
    /Laboratory 1\.2\.34/, /45 minutes/, /research study of the DemoLab group/, /aria-current="true"[^>]*>English|English<\/a>/, /Español<\/a>/,
  ]) assert.match(h, re, String(re));
  assert.ok(!h.includes("Reservar turno"));
  assert.match(h, /name="slot" value="2026-11-18T09:30"/);
  const es = await text(await call(env, rq("/")));
  assert.match(es, /property="og:locale" content="es_ES"/); assert.match(es, /Reservar turno/); assert.match(es, /Elige un día y una hora/);
  await D.setSetting(DB, "active_study", "study2");
  assert.match(await text(await call(env, rq("/?lang=en"))), /swivel chair/);
});

test("ninguna página pública muestra el correo del investigador, en ningún idioma ni estudio", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = mockFetch();
  const pages = [];
  for (const st of ["study1", "study2"]) {
    await D.setSetting(DB, "active_study", st);
    for (const lang of ["es", "en"]) for (const p of PUBLIC) pages.push(await text(await call(env, rq(`${p}?lang=${lang}`))));
  }
  for (const lang of ["es", "en"]) {
    const email = `p-${lang}@unidemo.es`;
    const r = await book(env, { email, slot: `${DAY}T${lang === "es" ? "09:30" : "10:30"}` }, { fetchFn: m.fn, ip: lang === "es" ? "1.1.1.1" : "2.2.2.2" });
    // book() no pasa ?lang: se reserva con la cabecera; aquí lo hacemos directo
    pages.push(await text(r));
  }
  for (const b of rows(DB)) {
    for (const lang of ["es", "en"]) {
      pages.push(await text(await call(env, rq(`/c/${b.token}?lang=${lang}`), NOW, m.fn)));
      pages.push(await text(await call(env, rq(`/x/${b.token}?lang=${lang}`), NOW, m.fn)));
    }
    await call(env, rq(`/c/${b.token}`, { method: "POST" }), later(1000), m.fn);
    for (const lang of ["es", "en"]) {
      pages.push(await text(await call(env, rq(`/c/${b.token}?lang=${lang}`), later(2000), m.fn)));
      pages.push(await text(await call(env, rq(`/ics/${b.token}?lang=${lang}`), later(2000), m.fn)));
    }
  }
  pages.push(await text(await call(env, rq("/c/" + "a".repeat(30), { lang: "en" }))));
  pages.push(await text(await call(env, rq("/nada", { lang: "en" }))));
  assert.ok(pages.length > 25);
  // The address that must stay private is the configured contact address (whatever it is), not a literal. The control proves the
  // check is not vacuous: that very address received the researcher's notice of the confirmations made above.
  const contact = C.contactEmail.toLowerCase();
  assert.ok(m.calls.mail.some((c) => String(c.json.to).toLowerCase() === contact), "control: the contact address is the one the notices go to");
  for (const h of pages) {
    const low = h.toLowerCase();
    assert.ok(!low.includes(contact), "correo del investigador expuesto");
    assert.ok(!low.includes(contact.split("@")[0] + "@"), "la parte local del correo del investigador expuesta");
  }
  const priv = await text(await call(env, rq("/privacidad?lang=es")));
  assert.match(priv, /grupo de investigación DemoLab/); assert.match(priv, /Universidad de Ejemplo/); assert.doesNotMatch(priv, /lopd@unidemo\.es/);
  assert.match(priv, /enlace de cancelación/);
  const privEn = await text(await call(env, rq("/privacidad?lang=en")));
  assert.match(privEn, /DemoLab research group/); assert.match(privEn, /cancellation link/); assert.doesNotMatch(privEn, /lopd@unidemo\.es/);
  assert.match(await text(await call(env, rq("/condiciones?lang=es"))), /responde al correo de confirmación/);
  assert.match(await text(await call(env, rq("/condiciones?lang=en"))), /reply to the confirmation email/);
});

test("sin guiones largos ni palabras prohibidas en inglés", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...RELAY });
  const m = mockFetch();
  const all = [];
  for (const st of ["study1", "study2"]) {
    await D.setSetting(DB, "active_study", st);
    for (const p of PUBLIC) all.push(await text(await call(env, rq(`${p}?lang=en`))));
  }
  const r = await call(env, rq("/reservar?lang=en", { method: "POST", fields: { slot: "x" }, lang: "en" }));
  all.push(await text(r));
  await book(env, {}, { fetchFn: m.fn });
  all.push(JSON.stringify(m.calls.mail.map((x) => x.json)));
  for (const t of all) {
    assert.ok(!/pregnan|embaraz|incentiv|compensat|reward|raffle|payment of/i.test(t), "texto prohibido");
    assert.ok(!t.includes("—"), "guion largo");
  }
});

test("la reserva guarda el idioma y los correos van en ese idioma; el aviso al administrador, en español", async () => {
  const { DB, env } = await setup({ ...RELAY, ADMIN_EMAIL: "admin@example.org" });
  const m = mockFetch();
  const fields = async (o) => (await import("./helpers.mjs")).goodFields(DB, o);
  const post = async (o, q, hdr, ip) => call(env, rq(`/reservar${q}`, { method: "POST", fields: await fields(o), lang: hdr }), NOW, m.fn);
  // inglés por cabecera
  let r = await post({ email: "eva@unidemo.es", name: "Eva" }, "", "en-GB");
  assert.match(await text(r), /Check your email/);
  assert.equal(rows(DB)[0].lang, "en");
  const mail = m.calls.mail[0].json;
  assert.match(mail.subject, /Confirm your slot/);
  assert.match(mail.text, /Hello Eva/); assert.match(mail.text, /from 09:30 to 10:15/); assert.match(mail.text, /Wednesday,? 18 November 2026/);
  assert.match(mail.text, /\/c\/[A-Za-z0-9_-]+\?lang=en/); assert.match(mail.html, /Confirm my slot/); assert.match(mail.text, /until 1[0-9]:\d\d/);
  const token = tokenFrom(mail.text);
  // el enlace del correo abre la página en inglés aunque el navegador diga español
  const g = await text(await call(env, rq(`/c/${token}?lang=en`, { lang: "es-ES" }), NOW, m.fn));
  assert.match(g, /Confirm my slot/);
  // sin ?lang, la página de la reserva usa el idioma de la reserva
  assert.match(await text(await call(env, rq(`/c/${token}`, { lang: "es-ES" }), NOW, m.fn)), /Confirm my slot/);
  // confirmar
  const p = await call(env, rq(`/c/${token}?lang=en`, { method: "POST", lang: "es-ES" }), later(60_000), m.fn);
  const ph = await text(p);
  assert.match(ph, /Slot confirmed/); assert.match(ph, /Add to calendar/);
  const toUser = m.calls.mail.at(-2).json, toAdmin = m.calls.mail.at(-1).json;
  assert.equal(toUser.to, "eva@unidemo.es"); assert.match(toUser.subject, /Slot confirmed/); assert.match(toUser.text, /Please arrive a few minutes early\./);
  assert.match(toUser.text, /\/ics\/[A-Za-z0-9_-]+\?lang=en/); assert.match(toUser.text, /\/x\/[A-Za-z0-9_-]+\?lang=en/);
  assert.equal(toAdmin.to, "admin@example.org"); assert.match(toAdmin.subject, /^Reserva confirmada: 18\/11 09:30$/); assert.match(toAdmin.text, /Día en el panel: https:\/\/estudio-vr-demo\.workers\.dev\/admin\?day=2026-11-18/);
  // .ics en inglés
  const ics = await text(await call(env, rq(`/ics/${token}`, { lang: "es" }), later(70_000)));
  assert.match(ics, /SUMMARY:Virtual reality study/); assert.match(ics, /Tomorrow: virtual reality study/);
  // español por cabecera
  r = await post({ email: "ana@unidemo.es", name: "Ana", slot: `${DAY}T10:30` }, "", "es-ES");
  assert.match(await text(r), /Revisa tu correo/);
  assert.equal(rows(DB).find((x) => x.email === "ana@unidemo.es").lang, "es");
  assert.match(m.calls.mail.at(-1).json.subject, /Confirma tu turno/);
  // ?lang explícito gana sobre la cabecera al reservar
  r = await post({ email: "lu@unidemo.es", name: "Lu", slot: `${DAY}T11:30` }, "?lang=en", "es-ES");
  assert.equal(rows(DB).find((x) => x.email === "lu@unidemo.es").lang, "en");
  assert.match(await text(r), /Check your email/);
  // recordatorio y cancelación desde el panel, en el idioma de cada reserva
  await D.openDay(DB, "2026-11-17", ["10:30", "11:30"]);
  const tomorrow = async (email, lang, time) => {
    const q = lang === "en" ? "?lang=en" : "";
    await call(env, rq(`/reservar${q}`, { method: "POST", fields: await fields({ email, slot: `2026-11-17T${time}`, name: "N" }), lang }), later(1000), m.fn);
    const t = tokenFrom(m.calls.mail.at(-1).json.text);
    await call(env, rq(`/c/${t}`, { method: "POST" }), later(2000), m.fn);
    return rows(DB).find((x) => x.email === email);
  };
  const en = await tomorrow("en@unidemo.es", "en", "10:30");
  const es = await tomorrow("es@unidemo.es", "es", "11:30");
  const s = await adminSession({ ...env, ADMIN_PASSWORD: PW });
  const envA = { ...env, ADMIN_PASSWORD: PW };
  const sess = await adminSession(envA);
  await adminDo(envA, sess, "remind", {}, later(3000), m.fn);
  const subj = m.calls.mail.slice(-2).map((x) => [x.json.to, x.json.subject]);
  assert.deepEqual(Object.fromEntries(subj), { "en@unidemo.es": "Tomorrow at 10:30: virtual reality study", "es@unidemo.es": "Mañana a las 11:30: estudio de realidad virtual" });
  await adminDo(envA, sess, `cancel:${en.id}`, {}, later(5000), m.fn);
  const cancelMail = m.calls.mail.find((x) => x.json.to === "en@unidemo.es" && /cancelled/.test(x.json.subject));
  assert.ok(cancelMail, "cancelación en inglés");
  await adminDo(envA, sess, `cancel:${es.id}`, {}, later(6000), m.fn);
  assert.ok(m.calls.mail.find((x) => x.json.to === "es@unidemo.es" && /cancelado/.test(x.json.subject)));
  void s;
});

// ---- panel -------------------------------------------------------------------------
const setupAdmin = async (extra = {}, opts) => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...extra }, opts);
  return { DB, env, s: await adminSession(env) };
};
// The panel is split in sections (?s=): the helper asks for all of them on one page unless the query names one.
const allSections = (qs) => (/[?&]s=/.test(qs) ? qs : `${qs}${qs.includes("?") ? "&" : "?"}s=all`);
const adminGet = async (env, s, qs = "", now = NOW) => text(await call(env, rq(`/admin${allSections(qs)}`, { cookie: s.cookie }), now));

test("admin: el mes se ve con título, navegación, cabecera lunes a domingo, estados y leyenda", async () => {
  const { DB, env, s } = await setupAdmin();
  await D.openDay(DB, "2026-11-19", ["09:30", "10:30"]);   // abierto, libre
  await D.openDay(DB, "2026-11-20", ["09:30"]);            // se llenará
  // reservas directas: una en el 18 (de 4 franjas) y otra en el 20 (de 1 franja)
  const ins = (id, date, time, status) => DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,0,'es')").run(id, "t".repeat(30) + id, "study1", date, time, "Ana " + id, id + "@unidemo.es", id + "@unidemo.es", status, NOW.toISOString());
  ins("a1", DAY, "09:30", "confirmed");
  ins("a2", "2026-11-20", "09:30", "pending");
  const h = await adminGet(env, s);
  assert.match(h, /<h2 id="cal-title">Noviembre de 2026<\/h2>/);
  assert.match(h, /href="\/admin\?month=2026-10"/); assert.match(h, /href="\/admin\?month=2026-12"/);
  assert.match(h, /href="\/admin">Hoy<\/a>/);
  for (const w of ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]) assert.match(h, new RegExp(`<abbr title="[^"]+">${w}</abbr>`));
  assert.ok(h.indexOf(">lun<") < h.indexOf(">dom<"));
  // estados en texto, no solo color
  const cell = (d) => new RegExp(`<a class="([^"]*)" href="/admin\\?month=2026-11&amp;day=${d}" aria-label="([^"]*)"[^>]*>(.*?)</a>`).exec(h);
  const c18 = cell("2026-11-18"), c19 = cell("2026-11-19"), c20 = cell("2026-11-20"), c25 = cell("2026-11-25"), c16 = cell("2026-11-16");
  assert.match(c18[1], /c-open/); assert.match(c18[3], /3\/4 libres/); assert.match(c18[3], /<b>1<\/b>[^<]*<span class="lg"> reserva</);
  assert.match(c19[1], /c-open/); assert.match(c19[3], /2\/2 libres/); assert.ok(!c19[3].includes('class="bk"'), "sin reservas, sin insignia");
  assert.match(c20[1], /c-full/); assert.match(c20[3], /Completo/); assert.match(c20[3], /<b>1<\/b>/);
  assert.match(c25[1], /c-closed/); assert.match(c25[3], /Cerrado/);
  assert.match(c16[1], /c-today/); assert.match(c16[2], /hoy/);
  assert.match(h, /aria-current="date"/);
  assert.match(c16[1], /c-sel/, "sin ?day, el día elegido es hoy");
  // días pasados: atenuados pero con enlace
  const c1 = cell("2026-11-01");
  assert.match(c1[1], /c-past/);
  // leyenda
  assert.match(h, /class="legend"/);
  for (const t of ["Cerrado", "5/9 libres", "Completo", "reservas", "anillo", "borde grueso", "atenuado"]) assert.ok(h.includes(t), t);
  // sin scripts ni estilos en línea
  assert.ok(!/<script/.test(h)); assert.ok(!/ style=| on[a-z]+=/.test(h));
  // otros meses
  const dec = await adminGet(env, s, "?month=2026-12");
  assert.match(dec, /Diciembre de 2026/); assert.match(dec, /c-sel[^>]*href="\/admin\?month=2026-12&amp;day=2026-12-01"|href="\/admin\?month=2026-12&amp;day=2026-12-01"/);
  assert.match(await adminGet(env, s, "?month=basura"), /Noviembre de 2026/, "mes no válido: se ignora");
  assert.match(await adminGet(env, s, "?day=2026-02-31"), /Noviembre de 2026/, "día no válido: se ignora");
  assert.match(await adminGet(env, s, "?day=2027-01-05"), /Enero de 2027/, "el día manda sobre el mes");
});

test("admin: el panel del día muestra título, estado, botón, franjas con rango y acciones de reserva", async () => {
  const { DB, env, s } = await setupAdmin();
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES ('b1',?,'study1',?,?,?,?,?,'confirmed',?,0,'es')")
    .run("k".repeat(30), DAY, "10:30", "Alias<b>", "ana@unidemo.es", "ana@unidemo.es", NOW.toISOString());
  await D.removeSlot(DB, DAY, "11:30");
  const h = await adminGet(env, s, `?month=2026-11&day=${DAY}`);
  assert.match(h, /<h2 id="day-title">miércoles, 18 de noviembre<\/h2>/);
  assert.match(h, /class="pill p-open">Abierto, 2\/3 libres/);
  assert.match(h, /09:30–10:15/); assert.match(h, /10:30–11:15/); assert.match(h, /15:00–15:45/);
  assert.match(h, /Libre/); assert.match(h, /class="tag t-off">Cerrado/);
  assert.doesNotMatch(h, /Reservado/); assert.match(h, /<strong>Alias&lt;b&gt;<\/strong>/); assert.ok(!h.includes("Alias<b>"));
  assert.match(h, /class="tag t-confirmed">Confirmada/); assert.match(h, /class="addr">ana@unidemo\.es<\/span> · <a class="lnk" href="mailto:ana@unidemo\.es\?subject=Estudio%20de%20realidad%20virtual%3A%20tu%20turno%20del%2018%2F11%20a%20las%2010%3A30">Escribir/);
  assert.match(h, /Aún no ha empezado/); assert.doesNotMatch(h, /value="attended:b1"/); assert.doesNotMatch(h, /value="noshow:b1"/);
  assert.match(h, /<details class="confirm"><summary>Cancelar<\/summary>.*value="cancel:b1".*Sí, cancelar reserva/s);
  assert.match(h, /Cerrar franja/); assert.match(h, /Abrir franja/);
  // con reservas activas no se ofrece cerrar el día: se explica por qué
  assert.ok(!h.includes('value="close:'));
  assert.match(h, /No se puede cerrar este día: tiene 1 reserva pendiente o confirmada/);
  assert.match(h, /name="csrf"/);
  // próximas reservas enlaza al día
  assert.match(h, /Próximas reservas/); assert.match(h, /href="\/admin\?month=2026-11&amp;day=2026-11-18"><span class="u-day">miércoles, 18 de noviembre/);
  // acción rápida y ajustes plegados
  assert.match(h, /Abrir lunes a viernes de esta semana con el horario por defecto/);
  assert.match(h, /<details class="surface settings"><summary>Ajustes<\/summary>/);
  for (const t of ["Estudio 1: interacción", "Exportar CSV", "Enviar recordatorios de mañana", "Puesta en marcha", "Horas por defecto"]) assert.ok(h.includes(t), t);
  assert.match(h, /action="\/admin\/logout"/);
  // día cerrado: botón de abrir
  const closed = await adminGet(env, s, "?day=2026-11-24");
  assert.match(closed, /class="pill p-closed">Cerrado/); assert.match(closed, /value="open:2026-11-24"[^>]*>Abrir este día/);
  assert.match(closed, /Se crearán 9 franjas: 09:15–10:00/);
  // día abierto sin reservas: botón de cerrar
  await D.openDay(DB, "2026-11-19", ["09:30"]);
  const open = await adminGet(env, s, "?day=2026-11-19");
  assert.match(open, /value="close:2026-11-19"[^>]*>Cerrar este día/);
  // día pasado: consulta, sin botones de abrir ni cerrar
  const past = await adminGet(env, s, "?day=2026-11-10");
  assert.match(past, /Día pasado/); assert.ok(!past.includes('value="open:') && !past.includes('value="close:'));
  // día completo
  await D.openDay(DB, "2026-11-21", ["09:30"]);
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES ('b2',?,'study1','2026-11-21','09:30','Z','z@unidemo.es','z@unidemo.es','pending',?,0,'es')").run("q".repeat(30), NOW.toISOString());
  const full = await adminGet(env, s, "?day=2026-11-21");
  assert.match(full, /class="pill p-full">Completo/); assert.match(full, /class="tag t-pending">Pendiente/);
});

test("admin: un GET con month, day o m no cambia nada", async () => {
  const { DB, env, s } = await setupAdmin();
  await D.openDay(DB, "2026-11-19", ["09:30"]);
  const snap = () => JSON.stringify(["days", "day_slots", "bookings", "settings", "rate_limit"].map((t) => DB.raw.prepare(`SELECT * FROM ${t}`).all()));
  await adminGet(env, s); // crea la clave HMAC si faltaba
  const before = snap();
  for (const qs of ["?day=2026-11-24", "?day=2026-11-19", "?month=2026-12", "?day=2026-11-24&month=2026-11&m=open", "?m=week&n=5", "?day=2026-11-10", "?day=garbage", "?open=2026-11-24", "?do=day:2026-11-24", "?do=close:2026-11-19"]) {
    const r = await call(env, rq(`/admin${qs}`, { cookie: s.cookie }));
    assert.equal(r.status, 200, qs);
    assert.equal(snap(), before, qs);
  }
  // sin sesión tampoco
  assert.equal(snap(), before);
});

test("admin: un día con reservas pendientes o confirmadas no se puede cerrar; sin ellas sí", async () => {
  const { DB, env, s } = await setupAdmin({ ...RELAY });
  const m = mockFetch();
  await book(env, {}, { fetchFn: m.fn }); // pendiente
  assert.equal(rows(DB)[0].status, "pending");
  for (const verb of ["close", "day"]) {
    const loc = (await adminDo(env, s, `${verb}:${DAY}`, { day: DAY })).headers.get("location");
    assert.match(loc, /m=has-bookings/); assert.match(loc, new RegExp(`day=${DAY}`));
    assert.equal((await D.slotsBetween(DB, DAY, DAY)).length, 4, "las franjas siguen");
  }
  const token = tokenFrom(m.calls.mail[0].json.text);
  await call(env, rq(`/c/${token}`, { method: "POST" }), NOW, m.fn);
  assert.match((await adminDo(env, s, `close:${DAY}`)).headers.get("location"), /has-bookings/);
  assert.equal((await D.openDays(DB, DAY, DAY)).length, 1);
  const h = await adminGet(env, s, `?day=${DAY}&m=has-bookings`);
  assert.match(h, /class="error" role="status">Ese día tiene reservas pendientes o confirmadas/);
  // cancelada la reserva, ya se puede cerrar
  await adminDo(env, s, `cancel:${rows(DB)[0].id}`, {}, later(1000), m.fn);
  assert.match((await adminDo(env, s, `close:${DAY}`, {}, later(2000))).headers.get("location"), /m=closed/);
  assert.equal((await D.openDays(DB, DAY, DAY)).length, 0);
  // abrir de forma explícita no es un interruptor: abrir un día ya abierto no cambia nada
  await adminDo(env, s, `open:${DAY}`, {}, later(3000));
  assert.equal((await D.slotsBetween(DB, DAY, DAY)).length, 9);
  await D.removeSlot(DB, DAY, "16:05");
  assert.match((await adminDo(env, s, `open:${DAY}`, {}, later(4000))).headers.get("location"), /already-open/);
  assert.equal((await D.slotsBetween(DB, DAY, DAY)).length, 8, "no vuelve a añadir franjas");
});

test("admin: acciones sin token CSRF siguen rechazadas y la vista vuelve al día elegido", async () => {
  const { env, s } = await setupAdmin();
  const bad = await call(env, rq("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: "open:2026-11-24" } }));
  assert.equal(bad.status, 403);
  const ok = await adminDo(env, s, "open:2026-11-24", { day: "2026-11-24" });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/admin?m=open&day=2026-11-24");
  assert.match((await adminDo(env, s, "open:2026-01-01")).headers.get("location"), /bad-date/, "no se abre un día pasado");
  assert.match((await adminDo(env, s, "open:2027-06-01")).headers.get("location"), /bad-date/, "ni uno fuera de las 8 semanas");
});

test("admin: abrir lunes a viernes de la semana con las horas por defecto", async () => {
  const { DB, env, s } = await setupAdmin({}, { openDay: false });
  await adminDo(env, s, "times", { times: "09:00, 10:00, 17:00" });
  const loc = (await adminDo(env, s, "week:2026-11-18", { day: "2026-11-18" })).headers.get("location"); // miércoles de la semana del 16
  assert.match(loc, /m=week/); assert.match(loc, /n=5/);
  const open = await D.openDays(DB, "2026-11-01", "2026-12-31");
  assert.deepEqual(open, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"], "solo lunes a viernes");
  for (const d of open) assert.deepEqual((await D.slotsBetween(DB, d, d)).map((x) => x.time), ["09:00", "10:00", "17:00"], d);
  // el sábado de esa semana sigue cerrado y los fines de semana no se abren aunque se elijan
  await adminDo(env, s, "week:2026-11-22"); // domingo: misma semana, nada nuevo
  assert.equal((await D.openDays(DB, "2026-11-21", "2026-11-22")).length, 0);
  // otra semana: la siguiente
  assert.match((await adminDo(env, s, "week:2026-11-28")).headers.get("location"), /n=5/); // sábado de la semana del 23
  assert.deepEqual(await D.openDays(DB, "2026-11-21", "2026-11-29"), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  // no pisa los días ya abiertos ni sus franjas editadas
  await D.removeSlot(DB, "2026-11-24", "10:00");
  assert.match((await adminDo(env, s, "week:2026-11-24")).headers.get("location"), /n=0/);
  assert.equal((await D.slotsBetween(DB, "2026-11-24", "2026-11-24")).length, 2);
  // la semana actual con días pasados: solo desde hoy (martes 17)
  const later17 = new Date("2026-11-17T09:00:00Z");
  const { DB: DB2, env: env2 } = await setup({ ADMIN_PASSWORD: PW }, { openDay: false });
  const s2 = await adminSession(env2, later17);
  await adminDo(env2, s2, "week:2026-11-17", {}, later17);
  assert.deepEqual(await D.openDays(DB2, "2026-11-01", "2026-12-31"), ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  // semana pasada: nada
  const { DB: DB3, env: env3, s: s3 } = await setupAdmin({}, { openDay: false });
  await adminDo(env3, s3, "week:2026-11-09");
  assert.equal((await D.openDays(DB3, "2026-11-01", "2026-12-31")).length, 0);
  // y el panel ofrece el botón con el día elegido
  assert.match(await adminGet(env, s, "?day=2026-12-02"), /value="week:2026-12-02"/);
  assert.match(await adminGet(env, s, "?m=week&n=5"), /Semana abierta: 5 días nuevos/);
});
