// Mail: Google Apps Script relay (HMAC signature) and the templates, written per language (es, en, it) in the table M below.
import { esc, hmacHex } from "./util.js";
import * as D from "./db.js";
import { prettyDate, prettyDay, addMinutes, addDays, dayMonth, clockLocal, SESSION_MINUTES, shortHold } from "./slots.js";
import { C, orgFor } from "./config.js";
import { T } from "./i18n.js";
import { AT } from "./admin_texts.js";
import { pathFor } from "./paths.js";
import { ORIGIN_KEY } from "./env.js";

// Full address of the place, per language (used in e-mails and calendar events). A language the lab does not list
// gets the first configured address, so no template ever prints "undefined".
export const PLACE = { es: C.place.long[C.languages[0]], en: C.place.long[C.languages[0]], it: C.place.long[C.languages[0]], ...C.place.long };
// Solo es la dirección por defecto del aviso al administrador. Nunca se muestra en páginas públicas.
export const CONTACT = C.contactEmail;

// Languages the e-mail templates are written in (the table M below). A booking whose language is not configured gets
// English when it is configured, otherwise the first configured language.
export const MAIL_LANGS = ["es", "en", "it"];
export const mailLang = (l) => (MAIL_LANGS.includes(l) && C.languages.includes(l) ? l : C.languages.includes("en") ? "en" : C.languages[0]);

export const relayOn = (env) => !!(env.MAIL_RELAY_URL && env.MAIL_RELAY_KEY);
// The public address every link is built on: the BASE_URL variable, else baseUrl of site.config.js, else the origin of the request
// being served (handle() puts it in env, see requestEnv). Only the first two are fixed; the origin is the last resort.
export const baseUrl = (env) => String(env.BASE_URL || C.baseUrl || env[ORIGIN_KEY] || "http://localhost").replace(/\/+$/, "");
// Where the address comes from, for the admin checklist: "env", "config" or "request".
export const baseUrlSource = (env) => (env.BASE_URL ? "env" : C.baseUrl ? "config" : "request");
export const adminEmail = (env) => env.ADMIN_EMAIL || CONTACT;

// JSON con todo carácter no ASCII escapado: el mismo texto byte a byte en cualquier codificación.
export const asciiJson = (o) => JSON.stringify(o).replace(/[\u007f-\uffff]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

// Envia por el relay. Devuelve { ok, error }: error es el campo "error" del relay, "http <estado>" o "network".
// Sin relay devuelve { ok:false, error:"no relay" }. Nunca lanza.
export async function sendMail(env, { to, subject, text, html }, fetchFn = fetch, nowMs = Date.now()) {
  if (!relayOn(env)) return { ok: false, error: "no relay" };
  try {
    // Cuerpo solo ASCII (los acentos van como \uXXXX): Apps Script calcula el HMAC de un texto con acentos
    // de otra manera y la firma no coincidía ("bad signature" en cualquier correo en español).
    const body = asciiJson({ ts: nowMs, to, subject, text, html });
    const sig = await hmacHex(env.MAIL_RELAY_KEY, body);
    const u = new URL(env.MAIL_RELAY_URL);
    u.searchParams.set("sig", sig);
    const r = await fetchFn(u.toString(), { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body, redirect: "follow" });
    if (!r.ok) return { ok: false, error: `http ${r.status}` };
    const j = await r.json().catch(() => null);
    if (j && j.ok) return { ok: true, error: "" };
    return { ok: false, error: String((j && j.error) || (j ? "unknown" : "bad response")).slice(0, 120) };
  } catch {
    return { ok: false, error: "network" };
  }
}

// Envia un correo sobre una reserva y deja constancia del resultado en mail_log.
// kind: confirm_request | confirmed | reminder | cancelled | noshow | admin | test. Con el relay apagado no envia ni registra.
// La cuenta de Gmail del relay permite 100 correos al día. Con MAIL_DAY_MAX correos de cualquier tipo en 24 h no se aceptan
// reservas nuevas: lo que queda es para confirmar, cancelar y recordar las reservas que ya existen.
// Desde MAIL_ADMIN_SKIP ya no se avisa a quien investiga de cada confirmación (se ve en el panel).
export const MAIL_DAY_MAX = 80;
export const MAIL_ADMIN_SKIP = 50;

export async function sendLogged(env, c, bookingId, kind, msg) {
  if (!relayOn(env)) return { ok: false, error: "no relay" };
  const res = await sendMail(env, msg, c.fetchFn, c.nowMs);
  await D.logMail(c.db, bookingId, kind, res.ok, res.error, new Date(c.nowMs).toISOString());
  return res;
}

// Recordatorios de mañana. Cada reserva se reclama antes de enviar (reminded = 1) para que dos llamadas
// seguidas no manden dos correos; si el envio falla se libera para que la siguiente llamada lo reintente.
export async function sendReminders(env, c) {
  // Sin relay no se envía nada: no se reclama ninguna reserva ni se cuenta como fallo.
  if (!relayOn(env)) return { total: 0, sent: 0, failed: 0 };
  const list = await D.confirmedOn(c.db, addDays(c.today, 1));
  let sent = 0, failed = 0;
  for (const b of list) {
    if (!(await D.claimReminder(c.db, b.id))) continue;
    const res = await sendLogged(env, c, b.id, "reminder", { to: b.email, ...tplReminder(env, b, { code: await D.bookingCode(c.db, b) }) });
    if (res.ok) sent++;
    else { await D.releaseReminder(c.db, b.id); failed++; }
  }
  return { total: list.length, sent, failed };
}

// ---- the texts of every template, one table per language ------------------------------------------
// Every language has the same keys; the templates further down only assemble them, so adding a language means adding
// one table here (and the matching built-in texts in src/i18n.js). Functions return plain text: the templates escape it
// where it goes into HTML. The Spanish and English tables are pinned character for character by the regression suite.
const SN = C.studyName;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const M = {
  es: {
    tag: "ES",
    when: (d, a, b) => `${prettyDate(d, "es")}, de ${a} a ${b}`,
    hello: (n) => `Hola ${n},`,
    slotL: "Turno", placeL: "Lugar",
    manage: "Gestionar mi reserva",
    codeLabel: "Tu código de reserva",
    codeUse: (links, instant) => links
      ? `Si pierdes este correo, escríbelo en «Gestionar mi reserva», en la página del estudio, para ${instant ? "confirmar tu correo" : "confirmar"}, cancelar o añadir el turno al calendario.`
      : "Es lo que identifica tu reserva si necesitas gestionarla más tarde.",
    deadline: (short, until) => short ? `Es para hoy, así que tienes hasta las ${until}, cuando empieza; después el turno se libera.` : `Tienes 2 horas (hasta las ${until}); después el turno se libera.`,
    manageHow: (host) => `abre ${host} en el navegador, pulsa «Gestionar mi reserva» y escribe tu correo y este código.`,
    howNL: (manageHow) => `Para cancelar o añadir el turno al calendario: ${manageHow}`,
    // confirmation request
    reqSubject: `Confirma tu turno: ${SN.es}`,
    reqTail: "Si no lo has pedido tú, ignora este correo.",
    reqHowNL: (manageHow) => `Para confirmar, escribe este código en la página donde has reservado. Si la has cerrado: ${manageHow}`,
    reqEither: "Puedes pulsar el enlace o escribir tu código de reserva en la página del estudio («Gestionar mi reserva»).",
    reqCta: "Confirmar mi turno",
    reqIntro: (cta, dl) => `Confirma tu turno abriendo este enlace y pulsando «${cta}». ${dl}`,
    reqIntroH: (cta, dl) => `Confirma tu turno abriendo el enlace y pulsando «${cta}». ${dl}`,
    // confirmed
    okSubject: (dm, time) => `Turno confirmado: ${dm} ${time}`,
    ok: "Tu turno está confirmado. No tienes que hacer nada más.",
    dur: (n) => `Duración: ${n} minutos. Llega unos minutos antes.`,
    notYouNL: "Si no has hecho tú esta reserva, responde a este correo y la cancelamos.",
    notYouLink: "Si no has hecho tú esta reserva, cancélala con el enlace de arriba.",
    vText: "Si quieres, confírmanos que este correo te ha llegado (no es obligatorio):",
    vBtn: "Confirmar mi correo",
    vNl: " Al hacerlo también sabremos que este correo te ha llegado (no es obligatorio).",
    addCal: "Añadir al calendario",
    cancelT: "Cancelar el turno, si no puedes venir",
    cancelHpre: "Si no puedes venir", cancelHlabel: "cancelar el turno",
    // reminder
    remSubject: (time) => `Mañana a las ${time}: ${SN.es}`,
    rem: "Te recordamos tu turno de mañana:",
    remCancelT: (url) => `Si no puedes venir, cancela aquí: ${url}`,
    // cancelled by the researcher
    canSubject: (dm, time) => `Turno cancelado: ${dm} ${time}`,
    canBody: (w) => `Hemos tenido que cancelar tu turno del ${w}. Lo sentimos.`,
    canNL: (h) => `Para elegir otro, abre ${h} en el navegador.`,
    canLinkT: (home) => `Puedes elegir otro aquí: ${home}`,
    canLinkH: (a) => `<a href="${a}">Elegir otro turno</a>.`,
    // no-show
    nsSubject: "¿Quieres elegir otro turno?",
    nsBody: (w) => `No te vimos en tu turno del ${w}. No pasa nada. Si quieres venir otro día,`,
    nsNL: (h) => `abre ${h} en el navegador y elige turno.`,
    nsLinkT: (home) => `elige turno aquí: ${home}`,
    nsLinkH: (a) => `<a href="${a}">elige turno</a>.`,
    nsEnd: "Si no, no hace falta que respondas.",
    // calendar event
    calSummary: cap(SN.es),
    calLines: (n, place, cancelUrl) => [`Sesión individual de ${n} minutos. Llega unos minutos antes.`, `Lugar: ${place}.`, `Si no puedes venir, cancela aquí: ${cancelUrl}`],
    calAlarm1: `Mañana: ${SN.es}`,
    calAlarm2: `En 2 horas: ${SN.es}`,
    // invitation
    invHello: "Hola:", invBook: "Puedes reservar turno aquí:", invThanks: "Gracias,",
    invUnsub: (url) => `Recibes este correo porque pediste que te avisáramos de futuros estudios. Para dejar de recibirlos: ${url}`,
  },
  en: {
    tag: "EN",
    when: (d, a, b) => `${prettyDate(d, "en")}, from ${a} to ${b}`,
    hello: (n) => `Hello ${n},`,
    slotL: "Slot", placeL: "Place",
    manage: "Manage my booking",
    codeLabel: "Your booking code",
    codeUse: (links, instant) => links
      ? `If you lose this email, type it under “Manage my booking” on the study page to ${instant ? "confirm your email" : "confirm"}, cancel or add the slot to your calendar.`
      : "It is what identifies your booking if you need to manage it later.",
    deadline: (short, until) => short ? `Your slot is for today, so you have until ${until}, when it starts; after that the slot is released.` : `You have 2 hours (until ${until}); after that the slot is released.`,
    manageHow: (host) => `open ${host} in your browser, press “Manage my booking” and type your email and this code.`,
    howNL: (manageHow) => `To cancel or add the slot to your calendar: ${manageHow}`,
    reqSubject: `Confirm your slot: ${SN.en}`,
    reqTail: "If you did not request it, ignore this email.",
    reqHowNL: (manageHow) => `To confirm, type this code on the page where you booked. If you closed it: ${manageHow}`,
    reqEither: "You can press the link or type your booking code on the study page (“Manage my booking”).",
    reqCta: "Confirm my slot",
    reqIntro: (cta, dl) => `Confirm your slot by opening this link and pressing “${cta}”. ${dl}`,
    reqIntroH: (cta, dl) => `Confirm your slot by opening the link and pressing “${cta}”. ${dl}`,
    okSubject: (dm, time) => `Slot confirmed: ${dm} ${time}`,
    ok: "Your slot is confirmed. You do not need to do anything else.",
    dur: (n) => `Duration: ${n} minutes. Please arrive a few minutes early.`,
    notYouNL: "If you did not make this booking, reply to this email and we will cancel it.",
    notYouLink: "If you did not make this booking, please cancel it with the link above.",
    vText: "If you like, let us know this email reached you (it is optional):",
    vBtn: "Confirm my email",
    vNl: " Doing so also tells us this email reached you (it is optional).",
    addCal: "Add to calendar",
    cancelT: "Cancel the slot, if you cannot come",
    cancelHpre: "If you cannot come", cancelHlabel: "cancel the slot",
    remSubject: (time) => `Tomorrow at ${time}: ${SN.en}`,
    rem: "A reminder of your slot tomorrow:",
    remCancelT: (url) => `If you cannot come, cancel here: ${url}`,
    canSubject: (dm, time) => `Slot cancelled: ${dm} ${time}`,
    canBody: (w) => `We have had to cancel your slot on ${w}. We are sorry.`,
    canNL: (h) => `To choose another one, open ${h} in your browser.`,
    canLinkT: (home) => `You can choose another one here: ${home}`,
    canLinkH: (a) => `<a href="${a}">Choose another slot</a>.`,
    nsSubject: "Would you like to choose another slot?",
    nsBody: (w) => `We did not see you at your slot on ${w}. No problem. If you would like to come another day,`,
    nsNL: (h) => `open ${h} in your browser and choose a slot.`,
    nsLinkT: (home) => `choose a slot here: ${home}`,
    nsLinkH: (a) => `<a href="${a}">choose a slot</a>.`,
    nsEnd: "If not, there is no need to reply.",
    calSummary: cap(SN.en),
    calLines: (n, place, cancelUrl) => [`Individual session of ${n} minutes. Please arrive a few minutes early.`, `Place: ${place}.`, `If you cannot come, cancel here: ${cancelUrl}`],
    calAlarm1: `Tomorrow: ${SN.en}`,
    calAlarm2: `In 2 hours: ${SN.en}`,
    invHello: "Hello,", invBook: "You can book a slot here:", invThanks: "Thank you,",
    invUnsub: (url) => `You are receiving this email because you asked us to tell you about future studies. To stop receiving them: ${url}`,
  },
  it: {
    tag: "IT",
    when: (d, a, b) => `${prettyDate(d, "it")}, dalle ${a} alle ${b}`,
    hello: (n) => `Ciao ${n},`,
    slotL: "Turno", placeL: "Luogo",
    manage: "Gestisci la mia prenotazione",
    codeLabel: "Il tuo codice di prenotazione",
    codeUse: (links, instant) => links
      ? `Se perdi questa e-mail, scrivi il codice in «Gestisci la mia prenotazione», nella pagina dello studio, per ${instant ? "confermare la tua e-mail" : "confermare"}, annullare o aggiungere il turno al calendario.`
      : "È ciò che identifica la tua prenotazione se ti serve gestirla più avanti.",
    deadline: (short, until) => short ? `Il turno è per oggi, quindi hai tempo fino alle ${until}, l'ora in cui inizia; dopo, il turno viene liberato.` : `Hai 2 ore (fino alle ${until}); dopo, il turno viene liberato.`,
    manageHow: (host) => `apri ${host} nel browser, premi «Gestisci la mia prenotazione» e scrivi la tua e-mail e questo codice.`,
    howNL: (manageHow) => `Per annullare o aggiungere il turno al calendario: ${manageHow}`,
    reqSubject: `Conferma il tuo turno: ${SN.it}`,
    reqTail: "Se non l'hai richiesto tu, ignora questa e-mail.",
    reqHowNL: (manageHow) => `Per confermare, scrivi questo codice nella pagina in cui hai prenotato. Se l'hai chiusa: ${manageHow}`,
    reqEither: "Puoi aprire il link oppure scrivere il tuo codice di prenotazione nella pagina dello studio («Gestisci la mia prenotazione»).",
    reqCta: "Conferma il mio turno",
    reqIntro: (cta, dl) => `Conferma il tuo turno aprendo questo link e premendo «${cta}». ${dl}`,
    reqIntroH: (cta, dl) => `Conferma il tuo turno aprendo il link e premendo «${cta}». ${dl}`,
    okSubject: (dm, time) => `Turno confermato: ${dm} ${time}`,
    ok: "Il tuo turno è confermato. Non devi fare altro.",
    dur: (n) => `Durata: ${n} minuti. Arriva con qualche minuto di anticipo.`,
    notYouNL: "Se non hai prenotato tu, rispondi a questa e-mail e annulleremo la prenotazione.",
    notYouLink: "Se non hai prenotato tu, annulla la prenotazione con il link qui sopra.",
    vText: "Se vuoi, facci sapere che questa e-mail ti è arrivata (non è obbligatorio):",
    vBtn: "Conferma la mia e-mail",
    vNl: " Così sapremo anche che questa e-mail ti è arrivata (non è obbligatorio).",
    addCal: "Aggiungi al calendario",
    cancelT: "Annulla il turno, se non puoi venire",
    cancelHpre: "Se non puoi venire", cancelHlabel: "annulla il turno",
    remSubject: (time) => `Domani alle ${time}: ${SN.it}`,
    rem: "Ti ricordiamo il tuo turno di domani:",
    remCancelT: (url) => `Se non puoi venire, annulla qui: ${url}`,
    canSubject: (dm, time) => `Turno annullato: ${dm} ${time}`,
    canBody: (w) => `Purtroppo abbiamo dovuto annullare il tuo turno di ${w}. Ci dispiace.`,
    canNL: (h) => `Per sceglierne un altro, apri ${h} nel browser.`,
    canLinkT: (home) => `Puoi sceglierne un altro qui: ${home}`,
    canLinkH: (a) => `<a href="${a}">Scegli un altro turno</a>.`,
    nsSubject: "Vuoi scegliere un altro turno?",
    nsBody: (w) => `Non è stato possibile incontrarci al tuo turno di ${w}. Nessun problema. Se vuoi venire un altro giorno,`,
    nsNL: (h) => `apri ${h} nel browser e scegli un turno.`,
    nsLinkT: (home) => `scegli un turno qui: ${home}`,
    nsLinkH: (a) => `<a href="${a}">scegli un turno</a>.`,
    nsEnd: "Altrimenti, non serve che tu risponda.",
    calSummary: cap(SN.it),
    calLines: (n, place, cancelUrl) => [`Sessione individuale di ${n} minuti. Arriva con qualche minuto di anticipo.`, `Luogo: ${place}.`, `Se non puoi venire, annulla qui: ${cancelUrl}`],
    calAlarm1: `Domani: ${SN.it}`,
    calAlarm2: `Tra 2 ore: ${SN.it}`,
    invHello: "Ciao,", invBook: "Puoi prenotare un turno qui:", invThanks: "Grazie,",
    invUnsub: (url) => `Ricevi questa e-mail perché hai chiesto di ricevere avvisi sui prossimi studi. Per non riceverne più: ${url}`,
  },
};
const langOf = (b) => mailLang(b && b.lang);
const when = (b, lang = langOf(b)) => M[lang].when(b.date, b.time, addMinutes(b.time, SESSION_MINUTES));
const wrap = (inner) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1b1b1b;max-width:36em">${inner}</div>`;
const btn = (href, label) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#7a1f1f;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>`;
// The line that signs the e-mails of a language (the organisation names may differ per language).
const signOf = (lang) => orgFor(lang).signature;
const signHtmlOf = (lang) => `<p>${esc(signOf(lang))}</p>`;
// The links in the e-mails carry the language of the booking.
const link = (env, kind, b) => `${baseUrl(env)}/${kind}/${b.token}?lang=${langOf(b)}`;
// Un alias nunca debe poder abrir lineas nuevas en la parte de texto de un correo.
// Tambien desarma lo que un programa de correo convertiria en enlace (esquema://, www., dominio.tld).
const nm = (s) => String(s ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/:\/\//g, ": ").replace(/\//g, " ").replace(/([A-Za-z0-9])\.(?=[A-Za-z0-9])/g, "$1. ").trim();
const para = (s) => esc(s).replace(/\r?\n/g, "<br>");

// ---- direcciones sin enlaces ------------------------------------------------------
// El filtro del correo de la universidad descarta en silencio todo mensaje con un enlace (medido con correos reales).
// Para esas direcciones los correos no llevan ninguna URL: solo el nombre del sitio sin esquema ni ruta, y el codigo de reserva.
export const NOLINK_DOMAINS = [...C.noLinkDomains];
export function noLinks(env, email) {
  const list = (env && env.NOLINK_DOMAINS != null ? String(env.NOLINK_DOMAINS).split(",") : NOLINK_DOMAINS)
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, "")).filter(Boolean);
  const d = String(email ?? "").trim().toLowerCase().split("@").pop();
  return !!d && list.some((x) => d === x || d.endsWith("." + x));
}
// Nombre del sitio sin esquema ni ruta: "study.example.org".
export const bareHost = (env) => { try { return new URL(baseUrl(env)).host; } catch { return baseUrl(env).replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, ""); } };
// Nota escrita a mano por la persona responsable: para direcciones sin enlaces se le quita todo lo que parezca uno.
// Sin tocar los puntos (horas, aulas, frases): solo se quita lo que un filtro tomaria por enlace, hasta que no quede nada.
const plainNote = (s) => {
  let t = String(s ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/:\/\//g, ": ").replace(/\//g, " ");
  for (let prev = ""; prev !== t; ) { prev = t; t = t.replace(/https?|href|www\./gi, ""); }
  return t.trim();
};
// Nombre de la persona tal como entra en sus correos: para direcciones sin enlaces, sin nada que parezca uno.
const nameFor = (env, b) => (noLinks(env, b.email) ? plainNote(b.name) : b.name);
// "Hello Name," in the booking language, as plain text and as HTML.
const greet = (env, b) => { const n = nm(nameFor(env, b)); const m = M[langOf(b)]; return { text: m.hello(n), html: m.hello(esc(n)) }; };

// Linea del codigo y para que sirve. Sin codigo (llamada sin el) no se escribe nada.
// instant: el turno ya está confirmado; lo que el código confirma es el correo.
const codeBlock = (lang, code, withLinks, instant = false) => {
  if (!code) return { text: "", html: "" };
  const m = M[lang];
  const fc = D.formatCode(code);
  const use = m.codeUse(withLinks, instant);
  return { text: `${m.codeLabel}: ${fc}\n${use}\n\n`, html: `<p>${m.codeLabel}: <strong>${esc(fc)}</strong><br>${esc(use)}</p>` };
};

// opts.code: codigo de 6 cifras de la reserva (ver D.bookingCode); lo calcula quien llama, las plantillas son puras.
export function tplConfirmRequest(env, b, { code } = {}) {
  const lang = langOf(b);
  const m = M[lang];
  const sign = signOf(lang), signHtml = signHtmlOf(lang);
  const w = when(b);
  const until = b.expires_at ? clockLocal(b.expires_at) : "";
  const dl = m.deadline(shortHold(b), until);
  const g = greet(env, b);
  const tail = esc(m.reqTail);
  const place = PLACE[lang];
  const { slotL, placeL } = m;
  if (noLinks(env, b.email)) {
    const cb = codeBlock(lang, code, false);
    const how = m.reqHowNL(m.manageHow(bareHost(env)));
    return {
      subject: m.reqSubject,
      text: `${g.text}\n\n${cb.text}${how} ${dl}\n\n${slotL}: ${w}\n${placeL}: ${place}\n\n${m.reqTail}\n\n${sign}`,
      html: wrap(`<p>${g.html}</p>${cb.html}<p>${esc(how)} ${esc(dl)}</p><p>${slotL}: <strong>${esc(w)}</strong><br>${placeL}: ${esc(place)}</p><p>${tail}</p>${signHtml}`),
    };
  }
  const url = link(env, "c", b);
  const cb = codeBlock(lang, code, false);
  const either = code ? m.reqEither : "";
  const cta = m.reqCta;
  return {
    subject: m.reqSubject,
    text: `${g.text}\n\n${m.reqIntro(cta, dl)}\n${url}\n\n${cb.text}${either ? either + "\n\n" : ""}${slotL}: ${w}\n${placeL}: ${place}\n\n${m.reqTail}\n\n${sign}`,
    html: wrap(`<p>${g.html}</p><p>${esc(m.reqIntroH(cta, dl))}</p>${btn(url, cta)}${cb.html}${either ? `<p>${esc(either)}</p>` : ""}<p>${slotL}: <strong>${esc(w)}</strong><br>${placeL}: ${esc(place)}</p><p>${tail}</p>${signHtml}`),
  };
}
// instant: la reserva se confirmó al momento, sin comprobar el correo; el mensaje dice qué hacer si no la hizo quien lo recibe.
export function tplConfirmed(env, b, { code, instant = false } = {}) {
  const lang = langOf(b);
  const m = M[lang];
  const sign = signOf(lang), signHtml = signHtmlOf(lang);
  const w = when(b);
  const dm = dayMonth(b.date);
  const g = greet(env, b);
  const ok = esc(m.ok);
  const { slotL, placeL } = m;
  const place = PLACE[lang];
  const dur = m.dur(SESSION_MINUTES);
  const nl = noLinks(env, b.email);
  const notYou = !instant ? "" : nl ? m.notYouNL : m.notYouLink;
  // Confirmar el correo es opcional: el turno ya está reservado. El enlace lleva el código, que solo viaja por correo.
  const vurl = instant && !nl && code ? `${link(env, "c", b)}&k=${code}` : "";
  const vNl = !instant || !nl ? "" : m.vNl;
  const notYouT = (vurl ? `${m.vText} ${vurl}\n\n` : "") + (notYou ? `${notYou}\n\n` : "");
  const notYouH = (vurl ? `<p>${esc(m.vText)}</p>${btn(vurl, m.vBtn)}` : "") + (notYou ? `<p>${esc(notYou)}</p>` : "");
  const subject = m.okSubject(dm, b.time);
  if (nl) {
    const cb = codeBlock(lang, code, false);
    const how = m.howNL(m.manageHow(bareHost(env)));
    return {
      subject,
      text: `${g.text}\n\n${m.ok}\n\n${slotL}: ${w}\n${placeL}: ${place}\n${dur}\n\n${cb.text}${how}${vNl}\n\n${notYouT}${sign}`,
      html: wrap(`<p>${g.html}</p><p>${ok}</p><p>${slotL}: <strong>${esc(w)}</strong><br>${placeL}: ${esc(place)}<br>${esc(dur)}</p>${cb.html}<p>${esc(how + vNl)}</p>${notYouH}${signHtml}`),
    };
  }
  const ics = link(env, "ics", b);
  const cancel = link(env, "x", b);
  const cb = codeBlock(lang, code, true, instant);
  return {
    subject,
    text: `${g.text}\n\n${m.ok}\n\n${slotL}: ${w}\n${placeL}: ${place}\n${dur}\n\n${m.addCal}: ${ics}\n${m.cancelT}: ${cancel}\n\n${notYouT}${cb.text}${sign}`,
    html: wrap(`<p>${g.html}</p><p>${ok}</p><p>${slotL}: <strong>${esc(w)}</strong><br>${placeL}: ${esc(place)}<br>${esc(dur)}</p><p><a href="${esc(ics)}">${m.addCal}</a></p><p>${m.cancelHpre}: <a href="${esc(cancel)}">${m.cancelHlabel}</a>.</p>${notYouH}${cb.html}${signHtml}`),
  };
}
export function tplReminder(env, b, { code } = {}) {
  const lang = langOf(b);
  const m = M[lang];
  const sign = signOf(lang), signHtml = signHtmlOf(lang);
  const w = when(b);
  const g = greet(env, b);
  const place = PLACE[lang];
  const rem = esc(m.rem);
  if (noLinks(env, b.email)) {
    const cb = codeBlock(lang, code, false);
    const how = m.howNL(m.manageHow(bareHost(env)));
    return {
      subject: m.remSubject(b.time),
      text: `${g.text}\n\n${m.rem}\n${w}\n${place}\n\n${cb.text}${how}\n\n${sign}`,
      html: wrap(`<p>${g.html}</p><p>${rem}<br><strong>${esc(w)}</strong><br>${esc(place)}</p>${cb.html}<p>${esc(how)}</p>${signHtml}`),
    };
  }
  const cancel = link(env, "x", b);
  const cb = codeBlock(lang, code, true);
  return {
    subject: m.remSubject(b.time),
    text: `${g.text}\n\n${m.rem}\n${w}\n${place}\n\n${m.remCancelT(cancel)}\n\n${cb.text}${sign}`,
    html: wrap(`<p>${g.html}</p><p>${rem}<br><strong>${esc(w)}</strong><br>${esc(place)}</p><p>${m.cancelHpre}: <a href="${esc(cancel)}">${m.cancelHlabel}</a>.</p>${cb.html}${signHtml}`),
  };
}
// Cancelacion hecha por la persona responsable. La nota (opcional, texto plano) va en su propio parrafo.
export function tplCancelled(env, b, note = "") {
  const sign = signOf(langOf(b)), signHtml = signHtmlOf(langOf(b));
  const m = M[langOf(b)];
  const nl = noLinks(env, b.email);
  const home = `${baseUrl(env)}/?lang=${langOf(b)}`;
  const host = bareHost(env);
  const w = when(b);
  const n = nl ? plainNote(note) : String(note || "").trim();
  const g = greet(env, b);
  return {
    subject: m.canSubject(dayMonth(b.date), b.time),
    text: `${g.text}\n\n${m.canBody(w)}\n${n ? `\n${n}\n\n` : ""}${nl ? m.canNL(host) : m.canLinkT(home)}\n\n${sign}`,
    html: wrap(`<p>${g.html}</p><p>${esc(m.canBody(w))}</p>${n ? `<p>${para(n)}</p>` : ""}${nl ? `<p>${m.canNL(`<strong>${esc(host)}</strong>`)}</p>` : `<p>${m.canLinkH(esc(home))}</p>`}${signHtml}`),
  };
}
// A quien no vino: una propuesta, a mano desde el panel, de elegir otro turno.
export function tplNoShow(env, b, note = "") {
  const sign = signOf(langOf(b)), signHtml = signHtmlOf(langOf(b));
  const m = M[langOf(b)];
  const nl = noLinks(env, b.email);
  const home = `${baseUrl(env)}/?lang=${langOf(b)}`;
  const host = bareHost(env);
  const w = when(b);
  const n = nl ? plainNote(note) : String(note || "").trim();
  const g = greet(env, b);
  return {
    subject: m.nsSubject,
    text: `${g.text}\n\n${m.nsBody(w)} ${nl ? m.nsNL(host) : m.nsLinkT(home)}\n${n ? `\n${n}\n` : ""}\n${m.nsEnd}\n\n${sign}`,
    html: wrap(`<p>${g.html}</p><p>${esc(m.nsBody(w))} ${nl ? m.nsNL(`<strong>${esc(host)}</strong>`) : m.nsLinkH(esc(home))}</p>${n ? `<p>${para(n)}</p>` : ""}<p>${esc(m.nsEnd)}</p>${signHtml}`),
  };
}
// The notice to the researcher is written in the admin language (texts: AT.mail in src/admin_texts.js), dates in its locale.
// kind: "confirmed" | "cancelled_by_participant".
export function tplAdmin(env, kind, b) {
  const dm = dayMonth(b.date);
  const a = AT.mail;
  const what = kind === "cancelled_by_participant" ? a.noticeCancelled : a.noticeConfirmed;
  // A site with one study does not name a study in the notice.
  // When the studies come from the panel the caller passes studyLabel: the study's own name ("" = name none). Plain text, escaped below.
  const studyN = b.studyLabel !== undefined ? (b.studyLabel ? ` · ${b.studyLabel}` : "") : C.twoStudies ? ` · ${a.study(b.study === "study2")}` : "";
  const slot = `${prettyDay(b.date, C.adminLanguage)}, ${b.time}–${addMinutes(b.time, SESSION_MINUTES)}`;
  const panel = `${baseUrl(env)}/admin?day=${b.date}`;
  return {
    subject: `${what}: ${dm} ${b.time}`,
    text: `${what}\n${nm(b.name)} <${b.email}>${studyN}\n${slot}\n${a.panelLine}${panel}`,
    html: wrap(`<p><strong>${esc(what)}</strong><br>${esc(b.name)} &lt;${esc(b.email)}&gt;${esc(studyN)}<br>${esc(slot)}</p><p><a href="${esc(panel)}">${a.panelLink}</a></p>`),
  };
}
// Test e-mail to the administrator, in the admin language.
export function tplTest(env) {
  const a = AT.mail;
  return {
    subject: a.testSubject,
    text: `${a.testBody}\n\n${a.testPanel}${baseUrl(env)}/admin`,
    html: wrap(`<p>${a.testBody}</p><p><a href="${esc(baseUrl(env) + "/admin")}">${a.testLink}</a></p>`),
  };
}

// Datos del evento de calendario, los mismos para el archivo .ics y para el enlace de Google Calendar.
// Sin el código de la reserva: el código solo viaja por correo, porque escribirlo demuestra que el correo llega.
function calEvent(env, b, localToUtc) {
  const lang = langOf(b);
  const m = M[lang];
  const start = localToUtc(b.date, b.time);
  // The event lasts what the person is told (the session), not the calendar time the booking blocks.
  const end = new Date(start.getTime() + SESSION_MINUTES * 60000);
  const lines = m.calLines(SESSION_MINUTES, PLACE[lang], link(env, "x", b));
  return { m, start, end, summary: `${m.calSummary}${orgFor(lang).unit ? ` (${orgFor(lang).unit})` : ""}`, location: PLACE[lang], lines };
}
const calStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Texto de un campo de .ics: barra, punto y coma, coma y salto de línea escapados.
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Archivo de calendario con avisos a 1 dia y 2 horas.
export function buildIcs(env, b, localToUtc) {
  const ev = calEvent(env, b, localToUtc);
  const host = new URL(baseUrl(env)).hostname;
  const alarm = (trig, d) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${d}`, `TRIGGER:${trig}`, "END:VALARM"];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${C.brand.replace(/[^A-Za-z0-9 ._-]/g, "")}//${ev.m.tag}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id || "booking"}@${host}`,
    `DTSTAMP:${calStamp(new Date())}`,
    `DTSTART:${calStamp(ev.start)}`,
    `DTEND:${calStamp(ev.end)}`,
    `SUMMARY:${icsText(ev.summary)}`,
    `LOCATION:${icsText(ev.location)}`,
    `DESCRIPTION:${icsText(ev.lines.join("\n"))}`,
    ...alarm("-P1D", ev.m.calAlarm1),
    ...alarm("-PT2H", ev.m.calAlarm2),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
// Enlace que abre Google Calendar con el evento ya rellenado (la persona lo guarda en su propia cuenta).
export function googleCalUrl(env, b, localToUtc) {
  const ev = calEvent(env, b, localToUtc);
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.summary, dates: `${calStamp(ev.start)}/${calStamp(ev.end)}`, details: ev.lines.join("\n"), location: ev.location });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// Texto de la invitacion que el investigador copia o abre en su propio correo. No se envia desde la web.
// Con unsub (invitacion a los contactos de avisos) el texto acaba con un parrafo sobre como darse de baja.
export function invitation(env, lang, { unsub = false } = {}) {
  const base = baseUrl(env);
  const host = bareHost(env);
  const S = T[lang] || T[C.languages[0]];
  const ml = mailLang(lang);
  const m = M[ml];
  // The unsubscribe address is written without a scheme (a mail filter may drop messages with links), in the path style of the language.
  return {
    subject: S.inviteSubject,
    body: `${m.invHello}\n\n${S.invitePitch}\n\n${m.invBook}\n${base}/?lang=${lang}\n\n${m.invThanks}\n${C.responsible}\n${signOf(ml)}${unsub ? `\n\n${m.invUnsub(host + pathFor(ml, "/baja"))}` : ""}`,
  };
}
