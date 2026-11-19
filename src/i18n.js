// Public-page texts. Built-in Spanish, English and Italian; the configured languages are served (the first one is the default).
// Everything that names the lab, room, university, person responsible, session length or retention periods comes from
// the configuration (src/config.js), and any text can be overridden from site.config.js (`texts`), see applyOverrides below.
import { C, LANGS, DEFAULT_LANG, LANG_REGISTRY, KNOWN_LANGS, orgFor } from "./config.js";
import { pathFor } from "./paths.js";
import { SESSION_MINUTES } from "./slots.js";
import { esc } from "./util.js";

// Accept-Language primary subtag -> configured language (es also covers ca, gl and eu).
const FAMILY = new Map();
for (const l of LANGS) for (const p of LANG_REGISTRY[l].family) FAMILY.set(p, l);

// First configured language in the header (by q and order). No header: the first configured language.
// Header with no configured language at all: English for international visitors when it is configured, else the first language.
export function langFromHeader(header) {
  const h = String(header || "").trim();
  if (!h) return DEFAULT_LANG;
  const items = h.split(",").map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)/i.exec(p);
      if (m) q = Number(m[1]);
    }
    return { p: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i };
  }).filter((x) => x.p && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  const first = items.find((x) => FAMILY.has(x.p));
  if (!first) return LANGS.includes("en") ? "en" : DEFAULT_LANG;
  return FAMILY.get(first.p);
}

// Contexto de idioma de una petición: { lang, explicit }.
export function langCtx(request, url) {
  const q = url.searchParams.get("lang");
  if (LANGS.includes(q)) return { lang: q, explicit: true };
  return { lang: langFromHeader(request.headers.get("accept-language")), explicit: false };
}

// Enlace interno que conserva la elección explícita de idioma.
export function lk(L, href) {
  if (!L || !L.explicit) return href;
  const [base, hash] = href.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}lang=${L.lang}${hash ? "#" + hash : ""}`;
}

export const LOCALE_OG = Object.fromEntries(KNOWN_LANGS.map((l) => [l, LANG_REGISTRY[l].og]));

const { brand, responsible } = C;
// How the study is named (studyName in site.config.js) and the indefinite article that goes in front of it.
const SN = C.studyName;
const aEs = (n) => `un ${n}`;
const aEn = (n) => `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
const aIt = (n) => `${/^(s[^aeiouàèéìòù\s]|z|gn|ps|x|y)/i.test(n) ? "uno" : "un"} ${n}`;
// The place texts for every known language: a language the lab did not configure borrows the default language's text,
// so the built-in texts of an unused language never print "undefined".
const place = Object.fromEntries(Object.entries(C.place).map(([k, v]) => [k, Object.fromEntries(KNOWN_LANGS.map((l) => [l, v[l] ?? v[DEFAULT_LANG]]))]));
// Retention periods, written out per language (the config holds the numbers).
const days = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const RET = { es: days(C.bookingRetentionDays, "día", "días"), en: days(C.bookingRetentionDays, "day", "days"), it: days(C.bookingRetentionDays, "giorno", "giorni") };
const MON = { es: days(C.contactMonths, "mes", "meses"), en: days(C.contactMonths, "month", "months"), it: days(C.contactMonths, "mese", "mesi") };
// The organisation names of one language (they may differ per language in the configuration), and the same values escaped
// for the terms and the privacy policy, which are raw HTML: the values of the configuration are escaped before they go in.
function orgCtx(lang) {
  const org = orgFor(lang);
  const kicker = [org.group, org.university, org.unit].filter(Boolean).join(" · ");
  const h = {
    group: esc(org.group), university: esc(org.university), uniUnit: esc([org.university, org.unit].filter(Boolean).join(", ")), responsible: esc(responsible),
    longEs: esc(place.long.es ?? ""), longEn: esc(place.long.en ?? ""), roomEs: esc(place.room.es ?? ""), roomEn: esc(place.room.en ?? ""),
    longIt: esc(place.long.it ?? ""), roomIt: esc(place.room.it ?? ""),
  };
  return { org, kicker, h, unitP: org.unit ? ` (${org.unit})` : "" };
}
const credit = (l) => (C.hero.creditHtml ? C.hero.creditHtml[l] || "" : "");

const es = (({ org, kicker, h, unitP }) => ({
  htmlLang: "es",
  brand,
  skip: "Saltar al contenido",
  switchLabel: "Idioma / Language",
  title: `Participa en ${aEs(SN.es)}`,
  siteName: `${brand} · ${org.university}`,
  kicker,
  chipPlace: place.short.es,
  ogDesc: `Una sesión de ${SESSION_MINUTES} minutos (${place.room.es}). Reserva tu turno.`,
  desc: `Participa en ${aEs(SN.es)} del grupo ${org.group}. Sesión de ${SESSION_MINUTES} minutos (${place.room.es}).`,
  footTerms: "Condiciones de participación",
  footPrivacy: "Política de privacidad",
  footBaja: "Darse de baja de avisos",
  footUv: kicker,
  // Product credit in the footer: "<madeWith> Approdo <madeBy> nerln" (the name is a link, see src/product.js). The licence asks to keep it visible.
  madeWith: "Hecho con",
  madeBy: "de",
  // HTML de confianza escrito por el laboratorio (hero.creditHtml): crédito de la foto de la portada; vacío = sin línea de crédito.
  footPhoto: credit("es"),
  lab: place.long.es,
  back: "Volver al inicio",
  lead: `Es un estudio de investigación del grupo ${org.group} (${org.university}).`,
  doesH: "Qué harás",
  reqH: "Requisitos",
  rightsH: "Tus datos y tus derechos",
  rights: ["Participar es voluntario: puedes parar en cualquier momento, sin dar ninguna razón y sin ninguna consecuencia. No se paga.", "Tus datos del estudio se guardan con un código, nunca con tu nombre, y solo los usa el equipo de investigación.", "El consentimiento se firma en papel en el laboratorio. Te llevas una copia con el contacto para ver, corregir o borrar tus datos."],
  cantComeH: "Si no puedes venir",
  cantCome: "Cancela con el enlace del correo de confirmación o en «Gestionar mi reserva», con tu correo y tu código. Así otra persona puede usar el hueco. No pasa nada por cancelar.",
  cantComeNoMail: "Cancela con el enlace de la página que ves al reservar. Así otra persona puede usar el hueco. No pasa nada por cancelar.",
  helpH: "Dudas",
  help: `Responde al correo de confirmación o pregúntanos en persona (${place.room.es}).`,
  helpNoMail: `Pregúntanos en persona (${place.room.es}).`,
  factDuration: "Duración:",
  factMinutes: (n) => `${n} minutos.`,
  factWhere: "Dónde:",
  factLang: "Idioma:",
  // Language of the study materials (application, questionnaires). Empty: the built-in texts say nothing about it.
  factLangText: "",
  study1: {
    lead: `Participarás en ${aEs(SN.es)} del grupo ${org.group} (${org.university}). Una persona del equipo te explicará en qué consiste cuando llegues.`,
    does: "Vienes al laboratorio para una sesión individual con una persona del equipo de investigación. Te explicamos todo al llegar y no hace falta experiencia previa.",
    reqs: [],
  },
  study2: {
    lead: `Participarás en el segundo estudio del grupo ${org.group} (${org.university}). Una persona del equipo te explicará en qué consiste cuando llegues.`,
    does: "En este segundo estudio vienes al laboratorio para otra sesión individual con una persona del equipo de investigación. Te explicamos todo al llegar y no hace falta experiencia previa.",
    reqs: [],
  },
  // Requirements that follow the declarations of site.config.js (a declaration that is off shows no line and no checkbox).
  reqEpilepsy: "No tener ni haber tenido nunca epilepsia.",
  reqVestibular: "No tener ni haber tenido nunca un trastorno vestibular (del oído interno o del equilibrio).",
  bookH: "Reserva tu turno",
  noSlots: "Ahora mismo no hay turnos libres. Vuelve a mirar dentro de unos días.",
  step1: "Elige un día y una hora",
  step1Help: `Pulsa la hora que prefieras. Cada sesión dura ${SESSION_MINUTES} minutos.`,
  step2: "Tus datos",
  step2Help: "Solo usamos tu correo para enviarte la confirmación y el recordatorio.",
  step2HelpNoMail: "Solo usamos tu correo para que no haya dos reservas con la misma dirección.",
  step3: "Confirma",
  step3Help: "Revisa que el día y la hora son los que quieres y marca las declaraciones.",
  nameL: "Nombre o alias",
  emailL: "Correo electrónico",
  hpL: "No rellenes este campo",
  noepi: "No tengo ni he tenido nunca epilepsia",
  vest: "No tengo ni he tenido nunca un trastorno vestibular",
  accept: (terms, priv) => `He leído y acepto las <a href="${terms}" target="_blank" rel="noopener">condiciones de participación<span class="sr-only"> (se abre en una pestaña nueva)</span></a> y la <a href="${priv}" target="_blank" rel="noopener">política de privacidad<span class="sr-only"> (se abre en una pestaña nueva)</span></a>`,
  futureL: "Quiero que me aviséis por correo de futuros estudios del grupo (opcional).",
  futureNote: `Guardaremos solo tu correo durante ${MON.es} desde que confirmes el turno y después lo borraremos. Puedes darte de baja antes, cuando quieras.`,
  futureNoteInstant: `Guardaremos solo tu correo durante ${MON.es} desde que confirmes tu correo o, si vienes a tu turno, desde ese día, y después lo borraremos. Si no haces ninguna de las dos cosas, no entrarás en la lista. Puedes darte de baja antes, cuando quieras.`,
  listLaterNoMail: "Has pedido los avisos de futuros estudios: te apuntaremos a la lista el día que vengas a tu turno.",
  bookedKeepNoLink: "<strong>Guarda este enlace:</strong> sirve para cancelar o ver los detalles. El correo que te hemos enviado no lleva enlaces: lleva un código para «Gestionar mi reserva», en la página de inicio.",
  bookedMailFailed: "<strong>Guarda este enlace:</strong> sirve para cancelar o ver los detalles. No hemos podido enviarte el correo con estos datos, así que solo los tienes en esta página.",
  listLater: "Has pedido los avisos de futuros estudios: te apuntaremos a la lista cuando confirmes tu correo, con el botón o el código del mensaje que te hemos enviado, o el día que vengas a tu turno.",
  verifyHint: "Te hemos enviado un correo con estos datos. Si pulsas su botón «Confirmar mi correo», sabremos que te ha llegado. No es obligatorio: el turno ya es tuyo.",
  verifyHintCode: "Te hemos enviado un correo con estos datos y un código. Si escribes el código en «Gestionar mi reserva», en la página de inicio, sabremos que te ha llegado. No es obligatorio: el turno ya es tuyo.",
  verifyH1: "Confirma tu correo",
  verifyP: "Tu turno ya está reservado. Pulsa el botón para confirmarnos que este correo te llega.",
  verifyBtn: "Confirmar mi correo",
  verifiedDone: "Correo confirmado. Gracias.",
  // Aviso de los dos estudios: el cartel sirve para los dos. Sin fechas: el que está abierto es el estudio activo.
  twoH: "Dos estudios",
  twoIntro: "Hacemos dos estudios, uno después del otro:",
  twoS1: "Estudio 1.",
  twoS2: "Estudio 2.",
  twoNow: "Turnos abiertos ahora.",
  twoLater: "Más adelante.",
  twoDone: "Ya ha terminado.",
  twoNotice: "Si quieres que te avisemos cuando abra el otro, marca la casilla de avisos al reservar.",
  // Same card when the studies come from the admin panel: any number of studies, listed by their own titles.
  manyH: "Varios estudios",
  manyIntro: "Hacemos varios estudios, uno después del otro:",
  manyNotice: "Si quieres que te avisemos cuando abra otro, marca la casilla de avisos al reservar.",
  errPrefix: "Error: ",
  errGo: "Ir al campo",
  requiredNote: "Todo es obligatorio salvo lo marcado como opcional.",
  noscriptTs: `Para reservar hace falta activar JavaScript, por la comprobación contra robots. Si no puedes, pregúntanos en persona (${place.room.es}).`,
  footNav: "Condiciones, privacidad y baja de avisos",
  bajaDoneTitle: "Solicitud de baja recibida",
  bajaTitle: "Darse de baja de los avisos",
  bajaLead: "Escribe tu correo y lo quitaremos de la lista de avisos de futuros estudios del grupo.",
  bajaBtn: "Darme de baja",
  bajaDone: "Si esa dirección estaba en la lista, la hemos borrado. No recibirás más avisos.",
  onList: (a) => `Te avisaremos de futuros estudios. Para darte de baja: <a href="${a}">página de baja</a>.`,
  cancelOnList: (a) => `Sigues en la lista de avisos de futuros estudios. Para darte de baja: <a href="${a}">página de baja</a>.`,
  submit: "Reservar turno",
  summaryL: "Tu turno:",
  slotLabel: (day, from, to) => `${day}, de ${from} a ${to}`,
  afterSubmit: "Te enviaremos un correo con un enlace. Tienes 2 horas para confirmar el turno.",
  afterSubmitFlex: "Te enviaremos un correo con un enlace. Tienes 2 horas para confirmar, o hasta la hora del turno si es hoy.",
  afterSubmitNoMail: "El turno queda confirmado al instante. Guarda el enlace de la página siguiente: sirve para cancelar.",
  afterSubmitInstant: "El turno queda confirmado al instante. En la página siguiente podrás añadirlo a tu calendario, y te enviaremos un correo con los datos y con cómo cancelarlo.",
  cardDay: "Día", cardHour: "Hora", cardPlace: "Lugar", cardStudy: "Estudio",
  hourRange: (a, b) => `${a} a ${b}`,
  pendingTitle: "Revisa tu correo",
  pendingP1: (email) => `Hemos guardado el hueco durante 2 horas. Te hemos escrito a <strong>${email}</strong> con un enlace para confirmar el turno.`,
  pendingP2: "Si no lo ves, mira en la carpeta de correo no deseado. Si pasan 2 horas sin confirmar, el hueco se libera y se borran tus datos.",
  pendingShortP1: (email, until) => `Hemos guardado el hueco hasta las ${until}, la hora del turno. Te hemos escrito a <strong>${email}</strong> con un enlace para confirmarlo.`,
  pendingShortP2: (until) => `Si no lo ves, mira en la carpeta de correo no deseado. Si a las ${until} no está confirmado, el hueco se libera y se borran tus datos.`,
  todayTag: " (hoy)",
  yourMail: "tu correo",
  bookedConfirmed: "Turno confirmado",
  bookedReserved: "Turno reservado",
  bookedThanks: (name) => `Gracias, ${name}. Estos son los detalles:`,
  addCal: "Añadir al calendario (.ics)",
  addGcal: "Añadir a Google Calendar (pestaña nueva)",
  calLead: "Añádelo a tu calendario para no olvidarlo. El archivo .ics sirve para el calendario de Apple, Outlook y los demás.",
  bookedCancel: (a) => `Si no puedes venir, <a href="${a}">cancela tu turno con este enlace</a> para que otra persona use el hueco.`,
  bookedKeep: "<strong>Guarda este enlace:</strong> sirve para cancelar o ver los detalles. También lo tienes en el correo.",
  bookedKeepNoMail: "<strong>Guarda este enlace:</strong> sirve para cancelar o ver los detalles.",
  bookedInstr: "Llega unos minutos antes.",
  manageLink: "¿Ya tienes un turno? Gestionar mi reserva",
  manageTitle: "Gestionar mi reserva",
  manageLead: "Escribe el correo con el que reservaste y el código de 6 cifras de tu reserva. Si el turno está pendiente, se confirma al enviarlo; si ya está confirmado, podrás cancelarlo o añadirlo al calendario.",
  codeL: "Código de reserva (6 cifras)",
  manageBtn: "Confirmar o gestionar",
  pendingCodeP1: (email) => `Te hemos enviado un código de 6 cifras a <strong>${email}</strong>. Escríbelo aquí para confirmar el turno.`,
  pendingCodeAlt: "También puedes escribir aquí el código de 6 cifras que lleva el correo.",
  codeLine: (c) => `Tu código de reserva: <strong>${c}</strong>`,
  bookedKeepCode: "<strong>Guarda este código:</strong> sirve para cancelar o ver los detalles en «Gestionar mi reserva», en la página de inicio. También lo tienes en el correo.",
  errCode: "El correo o el código no son correctos.",
  errCodeRate: "Demasiados intentos. Espera 15 minutos.",
  confirmTitle: "Confirmar turno",
  confirmH1: "Confirma tu turno",
  confirmBtn: "Confirmar mi turno",
  confirmCancel: "No puedo, quiero cancelar",
  confirmedH1: "Tu turno está confirmado",
  confirmedCancel: (a) => `Si no puedes venir, <a href="${a}">cancela aquí</a>.`,
  confirmGone: "Este turno ya no está activo. Puedes elegir otro en la página de inicio.",
  cancelTitle: "Cancelar turno",
  cancelH1: "Cancelar tu turno",
  cancelP: "Si cancelas, el hueco queda libre para otra persona.",
  cancelBtn: "Cancelar mi turno",
  cancelNo: "No, volver al inicio",
  cancelGone: "Este turno ya estaba cancelado o ya no está activo.",
  doneTitle: "Turno cancelado",
  doneP: "Gracias por avisar. El hueco ha quedado libre.",
  doneAgain: "Elegir otro turno",
  goneTitle: "Enlace no válido",
  goneH1: "Enlace no válido o caducado",
  goneDefault: "No encontramos ese turno. Puede que haya caducado.",
  notFound: "No encontrado.",
  errTitle: "Error",
  errP: "Algo ha fallado. Inténtalo de nuevo en unos minutos.",
  unavailTitle: "Servicio no disponible",
  unavailP: "Falta la base de datos.",
  unconfTitle: "Este sitio todavía no está configurado",
  unconfP: "Todavía no se pueden hacer reservas aquí: la persona que gestiona el sitio no ha terminado de configurarlo. Vuelve a intentarlo más adelante.",
  dayFullTitle: "Hoy no podemos aceptar más reservas",
  dayFullP: "Hemos recibido muchas solicitudes en las últimas horas. Vuelve a intentarlo mañana.",
  rateTitle: "Demasiados intentos",
  rateP: "Has hecho demasiadas peticiones. Prueba de nuevo dentro de 10 minutos.",
  err: {
    tooFast: "Has enviado el formulario demasiado rápido. Espera unos segundos y vuelve a pulsar «Reservar turno».",
    expired: "El formulario ha caducado. Revisa tus datos y vuelve a enviarlo.",
    human: "No hemos podido comprobar que eres una persona. Inténtalo de nuevo.",
    pick: "Elige un turno de la lista.",
    name: "Escribe un nombre o alias (máximo 40 caracteres).",
    nameChars: "Usa letras, números y signos de puntuación comunes (sin < > @ ni caracteres de control).",
    email: "El correo no parece válido.",
    disposable: "Usa un correo que no sea temporal o desechable.",
    noepi: "Por seguridad, no podemos incluir a personas con epilepsia.",
    vest: "Por seguridad, no podemos incluir a personas con un trastorno vestibular.",
    accept: "Tienes que aceptar las condiciones de participación y la política de privacidad.",
    taken: "Ese turno ya no está disponible. Elige otro.",
    liveEmail: "Ya hay un turno reservado con este correo. Si quieres cambiarlo, cancélalo con el enlace del correo que recibiste y reserva de nuevo.",
    liveEmailNoMail: "Ya hay un turno reservado con este correo. Si quieres cambiarlo, cancélalo con el enlace de la página que viste al reservar y reserva de nuevo; si no lo tienes, pregúntanos en persona.",
    raceEmail: "Ya hay un turno reservado con este correo.",
    raceSlot: "Alguien acaba de reservar ese turno. Elige otro.",
    mail: "No hemos podido enviar el correo ahora mismo. Inténtalo de nuevo en unos minutos. Si sigue fallando, comprueba la dirección.",
    attended: "Ya has participado en este estudio con este correo. Gracias.",
  },
  // Invitation the researcher copies into their own mail program (admin panel, «Invitar»).
  inviteSubject: `Participa en ${aEs(SN.es)}${unitP}`,
  invitePitch: `Buscamos personas para ${aEs(SN.es)} del grupo ${org.group} (${org.university}). Es una sesión individual de ${SESSION_MINUTES} minutos (${place.room.es}). No hace falta experiencia previa. La participación es voluntaria y no se paga.`,
  // The lines of the list "who can take part" in the terms; {reqs} in `terms` is replaced by the lines that apply.
  termsVision: "",
  termsEpilepsy: "Que no tengan ni hayan tenido nunca epilepsia.",
  termsVestibularStudy2: "En el segundo estudio, que además no tengan ni hayan tenido nunca un trastorno vestibular.",
  termsVestibularAlways: "Que no tengan ni hayan tenido nunca un trastorno vestibular.",
  // Sentence about the language of the study materials, put where {materials} is in `terms` (empty by default).
  termsMaterials: "",
  termsTitle: "Condiciones de participación",
  termsDesc: `Condiciones de participación en el ${SN.es} (${org.group}).`,
  terms: `<h1>Condiciones de participación</h1>
<h2>Quién puede participar</h2>
<ul>
{reqs}
</ul>
<h2>Qué ocurre</h2>
<p>Vienes a: ${h.longEs}. La sesión dura ${SESSION_MINUTES} minutos y es individual: haces las actividades del estudio y, si hace falta, rellenas algún cuestionario.{materials} El consentimiento informado se firma en papel en el laboratorio, antes de empezar. Las fotos o los vídeos de la sesión son opcionales: solo se hacen si lo aceptas en el consentimiento.</p>
<h2>Es voluntario</h2>
<p>Puedes parar en cualquier momento, sin dar ninguna razón y sin ninguna consecuencia. La participación no se paga.</p>
<h2>Si no puedes venir</h2>
<p>Cancela con el enlace que recibes al reservar o en «Gestionar mi reserva», con tu correo y tu código, para que otra persona pueda usar el hueco. No hay ninguna penalización si no vienes.</p>
<h2>Cambios del investigador</h2>
<p>Por motivos técnicos, el investigador puede mover o cancelar un turno. Si ocurre, te escribirá al correo que diste.</p>
<h2>Dudas</h2>
<p>Si tienes alguna pregunta, responde al correo de confirmación que recibes al reservar o pregúntanos en el laboratorio.</p>
<p><a href="{home}">Volver al inicio</a></p>`,
  // What the privacy text says about the declarations ({decl} in `privacy`); each variant starts with its own separator.
  privDecl: {
    epiVestStudy2: ", tus declaraciones de requisitos (ausencia de epilepsia y, en su caso, de trastorno vestibular)",
    epiVestAlways: ", tus declaraciones de requisitos (ausencia de epilepsia y de trastorno vestibular)",
    epi: ", tu declaración de requisitos (ausencia de epilepsia)",
    vestStudy2: ", tu declaración de requisitos (en su caso, ausencia de trastorno vestibular)",
    vestAlways: ", tu declaración de requisitos (ausencia de trastorno vestibular)",
  },
  privacyTitle: "Política de privacidad",
  privacyDesc: `Información sobre el tratamiento de datos del sistema de reservas del ${SN.es} (${org.group}).`,
  // Frases de la política que cambian cuando las reservas se confirman al momento: [frase por correo, frase al momento].
  privacyInstant: [
    ["<li>Con qué base: tu consentimiento, el de la casilla opcional. Cuenta desde que confirmas la reserva; si no la confirmas, tu correo se borra a las 3 horas y no cuenta como consentimiento.</li>",
     "<li>Con qué base: tu consentimiento, el de la casilla opcional. Cuenta desde que confirmas tu correo, con el botón o el código del mensaje que te enviamos, o desde el día en que vienes a tu turno, lo que ocurra primero. Si no haces ninguna de las dos cosas, tu correo no entra en la lista.</li>"],
    [`<li>Cuánto tiempo: ${MON.es} desde esa confirmación. Después se borra automáticamente.</li>`,
     `<li>Cuánto tiempo: ${MON.es} desde ese momento. Después se borra automáticamente.</li>`],
    [`Las reservas sin confirmar se borran a las 2 horas. Si pediste los avisos de futuros estudios, tu correo y el idioma se guardan ${MON.es} desde que confirmas la reserva y después se borran; si no confirmas la reserva, se borran a las 3 horas.`,
     `Si pediste los avisos de futuros estudios, tu correo y el idioma se guardan ${MON.es} desde que confirmas tu correo o vienes a tu turno, y después se borran; si no haces ninguna de las dos cosas, no se guardan para los avisos.`],
  ],
  // Frases de las condiciones y de la política que mandan a un correo; sin el correo activado (relayOn falso) se cambian por estas: [frase con correo, frase sin correo].
  termsNoMail: [
    ["<p>Cancela con el enlace que recibes al reservar o en «Gestionar mi reserva», con tu correo y tu código, para que otra persona pueda usar el hueco.",
     "<p>Cancela con el enlace de la página que ves al reservar, para que otra persona pueda usar el hueco."],
    ["<p>Si tienes alguna pregunta, responde al correo de confirmación que recibes al reservar o pregúntanos en el laboratorio.</p>",
     "<p>Si tienes alguna pregunta, pregúntanos en el laboratorio.</p>"],
  ],
  privacyNoMail: [
    [`responde al correo de confirmación de tu reserva o pregúntanos en persona (${h.roomEs})`, `pregúntanos en persona (${h.roomEs})`],
    [`responde al correo de confirmación o pregúntanos en persona (${h.roomEs}). Para cancelar tu reserva tienes dos caminos: el enlace de cancelación del correo de confirmación, o «Gestionar mi reserva» en la página de inicio, con tu correo y el código de reserva de 6 cifras que también va en el correo. Cancelar no borra los datos: tus datos de reserva se borran como máximo ${RET.es} después de la fecha del turno; si quieres que se borren antes, escríbenos respondiendo al correo.`,
     `pregúntanos en persona (${h.roomEs}). Para cancelar tu reserva usa el enlace de la página que ves al reservar. Cancelar no borra los datos: tus datos de reserva se borran como máximo ${RET.es} después de la fecha del turno; si quieres que se borren antes, pídenoslo en persona.`],
  ],
  privacy: `<h1>Política de privacidad</h1>
<p>Esta página explica qué datos usa el sistema de reservas y resume cómo se tratan los datos del estudio. La información completa del estudio está en el consentimiento informado que firmas en el laboratorio.</p>
<h2>Quién trata tus datos</h2>
<p>El grupo de investigación ${h.group} (${h.uniUnit}). Responsable: ${h.responsible}. Para cualquier consulta sobre tus datos, responde al correo de confirmación de tu reserva o pregúntanos en persona (${h.roomEs}).</p>
<h2>Para qué</h2>
<p>Para gestionar tu turno y enviarte la confirmación, un recordatorio y los cambios que pudieran producirse. Lo hacemos con tu consentimiento, que das al reservar y puedes retirar cuando quieras, cancelando la reserva.</p>
<h2>Qué datos</h2>
<p>Nombre o alias, correo electrónico, el turno elegido, el idioma de la página{decl} y, si lo haces, cuándo confirmaste que recibes nuestro correo. Para limitar el abuso del formulario se guarda durante una hora un código derivado de la dirección IP, que no permite identificarte.</p>
<h2>Servicios que usamos</h2>
<ul>
<li>Cloudflare: alojamiento de la web y base de datos.</li>
<li>Google: envío de los correos desde la cuenta de Gmail del estudio, cuando está activado.</li>
<li>Cloudflare Turnstile: comprobación contra robots, cuando está activada.</li>
</ul>
<h2>Avisos de futuros estudios (opcional)</h2>
<p>Al reservar puedes marcar una casilla para que te avisemos por correo de futuros estudios del grupo. Es opcional y no cambia tu reserva.</p>
<ul>
<li>Qué guardamos: solo tu dirección de correo y el idioma de la página. No guardamos tu nombre ni el turno.</li>
<li>Para qué: para avisarte de futuros estudios del grupo ${h.group}.</li>
<li>Con qué base: tu consentimiento, el de la casilla opcional. Cuenta desde que confirmas la reserva; si no la confirmas, tu correo se borra a las 3 horas y no cuenta como consentimiento.</li>
<li>Cuánto tiempo: ${MON.es} desde esa confirmación. Después se borra automáticamente.</li>
<li>Cómo retirarlo: en la página <a href="{baja}">Darse de baja de avisos</a>, o respondiendo a cualquier correo del estudio. Cancelar la reserva no te quita de la lista.</li>
</ul>
<p>Los avisos los envía la persona responsable desde su propio correo: la web no envía nada a esa lista.</p>
<h2>Cuánto tiempo</h2>
<p>Los datos de la reserva se borran ${RET.es} después del turno. Las reservas sin confirmar se borran a las 2 horas. Si pediste los avisos de futuros estudios, tu correo y el idioma se guardan ${MON.es} desde que confirmas la reserva y después se borran; si no confirmas la reserva, se borran a las 3 horas. Los correos que te enviamos, y las copias de los avisos de reserva que recibe la persona responsable (con tu nombre y tu correo), también quedan en la cuenta de correo desde la que se envían hasta que termina el estudio, y entonces se borran. Los correos de aviso a la lista y los ficheros que la persona responsable descargue de ella son copias suyas: se borran al limpiar la lista y, como muy tarde, a los ${MON.es}. El registro técnico de envíos (qué correo salió y si falló, sin su texto) se guarda 60 días. Cuando se borran los datos de las reservas, la web solo conserva recuentos por semana (cuántos turnos se reservaron, asistieron, faltaron o se cancelaron), sin nombres ni correos. Quien sepa quién vino una semana concreta podría, aun así, relacionar un recuento con una persona.</p>
<h2>Cookies</h2>
<p>No usamos cookies ni seguimiento para las personas que visitan la web.</p>
<h2>Relación con los datos del estudio</h2>
<p>Los datos de la reserva no se vinculan nunca con los datos del estudio ni con los códigos de participante.</p>
<h2>Datos del estudio</h2>
<p>Antes de empezar firmas en papel un consentimiento informado y te llevas una copia. Las respuestas a los cuestionarios y las notas del investigador se guardan con un código de participante, nunca con tu nombre. Solo los usa el grupo ${h.group} (${h.university}). Pueden publicarse como conjunto de datos anonimizado. Se conservan cinco años desde el final del estudio y después se borran. Las fotos o los vídeos solo se hacen si lo aceptas en el consentimiento.</p>
<h2>Tus derechos</h2>
<p>Para ver, corregir o borrar los datos de tu reserva, responde al correo de confirmación o pregúntanos en persona (${h.roomEs}). Para cancelar tu reserva tienes dos caminos: el enlace de cancelación del correo de confirmación, o «Gestionar mi reserva» en la página de inicio, con tu correo y el código de reserva de 6 cifras que también va en el correo. Cancelar no borra los datos: tus datos de reserva se borran como máximo ${RET.es} después de la fecha del turno; si quieres que se borren antes, escríbenos respondiendo al correo. Para darte de baja de los avisos de futuros estudios, usa la <a href="{baja}">página de baja</a>: basta con escribir tu correo. Para los datos del estudio, escribe al contacto de tu copia del consentimiento, con tu código de participante.</p>
<p><a href="{home}">Volver al inicio</a></p>`,
}))(orgCtx("es"));

const en = (({ org, kicker, h, unitP }) => ({
  htmlLang: "en",
  brand,
  skip: "Skip to content",
  switchLabel: "Idioma / Language",
  title: `Take part in ${aEn(SN.en)}`,
  siteName: `${brand} · ${org.university}`,
  kicker,
  chipPlace: place.short.en,
  ogDesc: `A session of ${SESSION_MINUTES} minutes (${place.room.en}). Book your slot.`,
  desc: `Take part in ${aEn(SN.en)} of the ${org.group} group. A ${SESSION_MINUTES}-minute session (${place.room.en}).`,
  footTerms: "Participation conditions",
  footPrivacy: "Privacy policy",
  footBaja: "Unsubscribe from notices",
  footUv: kicker,
  // Product credit in the footer: "<madeWith> Approdo <madeBy> nerln" (the name is a link, see src/product.js). The licence asks to keep it visible.
  madeWith: "Made with",
  madeBy: "by",
  footPhoto: credit("en"),
  lab: place.long.en,
  back: "Back to the start",
  lead: `This is a research study of the ${org.group} group (${org.university}).`,
  doesH: "What you will do",
  reqH: "Requirements",
  rightsH: "Your data and your rights",
  rights: ["Taking part is voluntary and unpaid: you can stop at any time, without giving a reason and with no consequence.", "Your study data is stored under a code, never with your name, and only the research team uses it.", "You sign the consent form on paper at the lab. You keep a copy with the contact to see, correct or delete your data."],
  cantComeH: "If you cannot come",
  cantCome: "Cancel with the link in the confirmation email or under \"Manage my booking\", with your email address and your code. That way someone else can use the slot. There is no penalty.",
  cantComeNoMail: "Cancel with the link on the page you see when you book. That way someone else can use the slot. There is no penalty.",
  helpH: "Questions",
  help: `Reply to the confirmation email or ask us in person (${place.room.en}).`,
  helpNoMail: `Ask us in person (${place.room.en}).`,
  factDuration: "Duration:",
  factMinutes: (n) => `${n} minutes.`,
  factWhere: "Where:",
  factLang: "Language:",
  factLangText: "",
  study1: {
    lead: `You will take part in ${aEn(SN.en)} of the ${org.group} group (${org.university}). Someone from the team will explain what it involves when you arrive.`,
    does: "You come to the laboratory for an individual session with a member of the research team. We explain everything when you arrive and no previous experience is needed.",
    reqs: [],
  },
  study2: {
    lead: `You will take part in the second study of the ${org.group} group (${org.university}). Someone from the team will explain what it involves when you arrive.`,
    does: "In this second study you come to the laboratory for another individual session with a member of the research team. We explain everything when you arrive and no previous experience is needed.",
    reqs: [],
  },
  reqEpilepsy: "Not have epilepsy, and never have had it.",
  reqVestibular: "Not have a vestibular disorder (inner ear or balance), and never have had one.",
  bookH: "Book your slot",
  noSlots: "There are no free slots right now. Please check again in a few days.",
  step1: "Choose a day and a time",
  step1Help: `Tap the time you prefer. Each session lasts ${SESSION_MINUTES} minutes.`,
  step2: "Your details",
  step2Help: "We only use your email to send you the confirmation and a reminder.",
  step2HelpNoMail: "We only use your email so that there are not two bookings with the same address.",
  step3: "Confirm",
  step3Help: "Check that the day and time are the ones you want, then tick the declarations.",
  nameL: "Name or alias",
  emailL: "Email address",
  hpL: "Leave this field empty",
  noepi: "I do not have epilepsy and have never had it",
  vest: "I do not have a vestibular disorder and have never had one",
  accept: (terms, priv) => `I have read and accept the <a href="${terms}" target="_blank" rel="noopener">participation conditions<span class="sr-only"> (opens in a new tab)</span></a> and the <a href="${priv}" target="_blank" rel="noopener">privacy policy<span class="sr-only"> (opens in a new tab)</span></a>`,
  futureL: "Tell me by email about future studies of the group (optional).",
  futureNote: `We will keep only your email address for ${MON.en} from when you confirm the slot, and then delete it. You can unsubscribe earlier, at any time.`,
  futureNoteInstant: `We will keep only your email address for ${MON.en} from when you confirm your email or, if you come to your slot, from that day, and then delete it. If you do neither, you will not be added to the list. You can unsubscribe earlier, at any time.`,
  listLaterNoMail: "You asked for notices about future studies: we will add you to the list on the day you come to your slot.",
  bookedKeepNoLink: "<strong>Keep this link:</strong> it lets you cancel or see the details. The email we sent you has no links: it has a code for “Manage my booking”, on the home page.",
  bookedMailFailed: "<strong>Keep this link:</strong> it lets you cancel or see the details. We could not send you the email with these details, so you only have them on this page.",
  listLater: "You asked for notices about future studies: we will add you to the list when you confirm your email, with the button or the code in the message we sent you, or on the day you come to your slot.",
  verifyHint: "We have emailed you these details. If you press its “Confirm my email” button, we will know it reached you. It is optional: the slot is already yours.",
  verifyHintCode: "We have emailed you these details and a code. If you type the code in “Manage my booking”, on the home page, we will know it reached you. It is optional: the slot is already yours.",
  verifyH1: "Confirm your email",
  verifyP: "Your slot is already booked. Press the button to let us know this email reaches you.",
  verifyBtn: "Confirm my email",
  verifiedDone: "Email confirmed. Thank you.",
  twoH: "Two studies",
  twoIntro: "We run two studies, one after the other:",
  twoS1: "Study 1.",
  twoS2: "Study 2.",
  twoNow: "Slots open now.",
  twoLater: "Later on.",
  twoDone: "Already finished.",
  twoNotice: "If you want to be told when the other one opens, tick the notices box when you book.",
  manyH: "Several studies",
  manyIntro: "We run several studies, one after the other:",
  manyNotice: "If you want to be told when another one opens, tick the notices box when you book.",
  errPrefix: "Error: ",
  errGo: "Go to the field",
  requiredNote: "Everything is required except what is marked optional.",
  noscriptTs: `To book you need to turn on JavaScript, because of the check against robots. If you cannot, ask us in person (${place.room.en}).`,
  footNav: "Conditions, privacy and unsubscribing",
  bajaDoneTitle: "Unsubscribe request received",
  bajaTitle: "Unsubscribe from notices",
  bajaLead: "Enter your email address and we will remove it from the list of notices about future studies of the group.",
  bajaBtn: "Unsubscribe",
  bajaDone: "If that address was on the list, we have removed it. You will not receive further notices.",
  onList: (a) => `We will tell you about future studies. To unsubscribe: <a href="${a}">unsubscribe page</a>.`,
  cancelOnList: (a) => `You are still on the list for notices about future studies. To unsubscribe: <a href="${a}">unsubscribe page</a>.`,
  submit: "Book slot",
  summaryL: "Your slot:",
  slotLabel: (day, from, to) => `${day}, from ${from} to ${to}`,
  afterSubmit: "We will email you a link. You have 2 hours to confirm the slot.",
  afterSubmitFlex: "We will email you a link. You have 2 hours to confirm, or until the slot starts if it is today.",
  afterSubmitNoMail: "The slot is confirmed straight away. Keep the link on the next page: it lets you cancel.",
  afterSubmitInstant: "The slot is confirmed straight away. On the next page you can add it to your calendar, and we will email you the details and how to cancel.",
  cardDay: "Day", cardHour: "Time", cardPlace: "Place", cardStudy: "Study",
  hourRange: (a, b) => `${a} to ${b}`,
  pendingTitle: "Check your email",
  pendingP1: (email) => `We are holding your slot for 2 hours. We have written to <strong>${email}</strong> with a link to confirm it.`,
  pendingP2: "If you do not see it, check your spam folder. If 2 hours pass without confirmation, the slot is released and your data is deleted.",
  pendingShortP1: (email, until) => `We are holding your slot until ${until}, the start of the slot. We have written to <strong>${email}</strong> with a link to confirm it.`,
  pendingShortP2: (until) => `If you do not see it, check your spam folder. If it is not confirmed by ${until}, the slot is released and your data is deleted.`,
  todayTag: " (today)",
  yourMail: "your email",
  bookedConfirmed: "Slot confirmed",
  bookedReserved: "Slot booked",
  bookedThanks: (name) => `Thank you, ${name}. Here are the details:`,
  addCal: "Add to calendar (.ics)",
  addGcal: "Add to Google Calendar (new tab)",
  calLead: "Add it to your calendar so you do not forget. The .ics file works with Apple Calendar, Outlook and the rest.",
  bookedCancel: (a) => `If you cannot come, <a href="${a}">cancel your slot with this link</a> so someone else can use it.`,
  bookedKeep: "<strong>Keep this link:</strong> it lets you cancel or see the details. You also have it in the email.",
  bookedKeepNoMail: "<strong>Keep this link:</strong> it lets you cancel or see the details.",
  bookedInstr: "Please arrive a few minutes early.",
  manageLink: "Already have a slot? Manage my booking",
  manageTitle: "Manage my booking",
  manageLead: "Enter the email address you booked with and the 6-digit code of your booking. If the slot is pending, sending it confirms it; if it is already confirmed, you can cancel it or add it to your calendar.",
  codeL: "Booking code (6 digits)",
  manageBtn: "Confirm or manage",
  pendingCodeP1: (email) => `We have sent a 6-digit code to <strong>${email}</strong>. Type it here to confirm the slot.`,
  pendingCodeAlt: "You can also type here the 6-digit code that is in the email.",
  codeLine: (c) => `Your booking code: <strong>${c}</strong>`,
  bookedKeepCode: "<strong>Keep this code:</strong> it lets you cancel or see the details under “Manage my booking” on the home page. You also have it in the email.",
  errCode: "The email address or the code is not correct.",
  errCodeRate: "Too many attempts. Wait 15 minutes.",
  confirmTitle: "Confirm slot",
  confirmH1: "Confirm your slot",
  confirmBtn: "Confirm my slot",
  confirmCancel: "I cannot come, I want to cancel",
  confirmedH1: "Your slot is confirmed",
  confirmedCancel: (a) => `If you cannot come, <a href="${a}">cancel here</a>.`,
  confirmGone: "This slot is no longer active. You can choose another one on the start page.",
  cancelTitle: "Cancel slot",
  cancelH1: "Cancel your slot",
  cancelP: "If you cancel, the slot becomes free for someone else.",
  cancelBtn: "Cancel my slot",
  cancelNo: "No, back to the start",
  cancelGone: "This slot was already cancelled or is no longer active.",
  doneTitle: "Slot cancelled",
  doneP: "Thank you for letting us know. The slot is now free.",
  doneAgain: "Choose another slot",
  goneTitle: "Invalid link",
  goneH1: "Invalid or expired link",
  goneDefault: "We could not find that slot. It may have expired.",
  notFound: "Not found.",
  errTitle: "Error",
  errP: "Something went wrong. Please try again in a few minutes.",
  unavailTitle: "Service unavailable",
  unavailP: "The database is missing.",
  unconfTitle: "This site is not configured yet",
  unconfP: "Bookings are not possible here yet: the person who runs this site has not finished setting it up. Please come back later.",
  dayFullTitle: "We cannot take more bookings today",
  dayFullP: "We have received many requests in the last few hours. Please try again tomorrow.",
  rateTitle: "Too many attempts",
  rateP: "You have made too many requests. Please try again in 10 minutes.",
  err: {
    tooFast: "You sent the form too quickly. Wait a few seconds and press “Book slot” again.",
    expired: "The form has expired. Check your details and send it again.",
    human: "We could not check that you are a person. Please try again.",
    pick: "Choose a slot from the list.",
    name: "Enter a name or alias (maximum 40 characters).",
    nameChars: "Use letters, numbers and common punctuation (no < > @ or control characters).",
    email: "The email address does not look valid.",
    disposable: "Please use an email address that is not temporary or disposable.",
    noepi: "For safety, we cannot include people with epilepsy.",
    vest: "For safety, we cannot include people with a vestibular disorder.",
    accept: "You need to accept the participation conditions and the privacy policy.",
    taken: "That slot is no longer available. Please choose another one.",
    liveEmail: "There is already a booking with this email address. To change it, cancel it with the link in the email you received and book again.",
    liveEmailNoMail: "There is already a booking with this email address. To change it, cancel it with the link on the page you saw when you booked and book again; if you no longer have it, ask us in person.",
    raceEmail: "There is already a booking with this email address.",
    raceSlot: "Someone has just booked that slot. Please choose another one.",
    mail: "We could not send the email right now. Please try again in a few minutes. If it keeps failing, check the address.",
    attended: "You have already taken part in this study with this email. Thank you.",
  },
  inviteSubject: `Take part in ${aEn(SN.en)}${unitP}`,
  invitePitch: `We are looking for people to take part in ${aEn(SN.en)} of the ${org.group} group (${org.university}). It is a ${SESSION_MINUTES}-minute session, one person at a time (${place.room.en}). No previous experience is needed. Taking part is voluntary and unpaid.`,
  termsVision: "",
  termsEpilepsy: "Who do not have epilepsy and have never had it.",
  termsVestibularStudy2: "In the second study, who also do not have a vestibular disorder and have never had one.",
  termsVestibularAlways: "Who do not have a vestibular disorder and have never had one.",
  termsMaterials: "",
  termsTitle: "Participation conditions",
  termsDesc: `Conditions for taking part in the ${SN.en} (${org.group}).`,
  terms: `<h1>Participation conditions</h1>
<h2>Who can take part</h2>
<ul>
{reqs}
</ul>
<h2>What happens</h2>
<p>You come to: ${h.longEn}. The session lasts ${SESSION_MINUTES} minutes and is one person at a time: you do the activities of the study and, if needed, fill in a questionnaire.{materials} You sign the informed consent form on paper at the lab, before starting. Photos or videos of the session are optional: they are taken only if you agree in the consent form.</p>
<h2>It is voluntary</h2>
<p>You can stop at any time, without giving a reason and without any consequence. Participation is unpaid.</p>
<h2>If you cannot come</h2>
<p>Cancel with the link you receive when you book or under "Manage my booking", with your email address and your code, so that someone else can use the slot. There is no penalty if you do not come.</p>
<h2>Changes made by the researcher</h2>
<p>For technical reasons, the researcher may move or cancel a slot. If that happens, we will write to the email address you gave.</p>
<h2>Questions</h2>
<p>If you have a question, reply to the confirmation email you receive when you book, or ask us at the lab.</p>
<p><a href="{home}">Back to the start</a></p>`,
  privDecl: {
    epiVestStudy2: ", your declarations about the requirements (no epilepsy and, where relevant, no vestibular disorder)",
    epiVestAlways: ", your declarations about the requirements (no epilepsy and no vestibular disorder)",
    epi: ", your declaration about the requirements (no epilepsy)",
    vestStudy2: ", your declaration about the requirements (where relevant, no vestibular disorder)",
    vestAlways: ", your declaration about the requirements (no vestibular disorder)",
  },
  privacyTitle: "Privacy policy",
  privacyDesc: `Information on how the booking system of the ${SN.en} (${org.group}) processes personal data.`,
  privacyInstant: [
    ["<li>On what basis: your consent, given with the optional box. It counts from when you confirm the booking; if you do not confirm it, your email address is deleted after 3 hours and does not count as consent.</li>",
     "<li>On what basis: your consent, given with the optional box. It counts from when you confirm your email, with the button or the code in the message we send you, or from the day you come to your slot, whichever happens first. If you do neither, your email address is not added to the list.</li>"],
    [`<li>For how long: ${MON.en} from that confirmation. Then it is deleted automatically.</li>`,
     `<li>For how long: ${MON.en} from that moment. Then it is deleted automatically.</li>`],
    [`Unconfirmed bookings are deleted after 2 hours. If you asked for notices about future studies, your email address and language are kept for ${MON.en} from when you confirm the booking and then deleted; if you do not confirm the booking, they are deleted after 3 hours.`,
     `If you asked for notices about future studies, your email address and language are kept for ${MON.en} from when you confirm your email or come to your slot, and then deleted; if you do neither, they are not kept for the notices.`],
  ],
  // Sentences of the terms and of the privacy policy that send the person to an e-mail; without the mail relay (relayOn false) they are replaced by these: [sentence with e-mail, sentence without].
  termsNoMail: [
    ["<p>Cancel with the link you receive when you book or under \"Manage my booking\", with your email address and your code, so that someone else can use the slot.",
     "<p>Cancel with the link on the page you see when you book, so that someone else can use the slot."],
    ["<p>If you have a question, reply to the confirmation email you receive when you book, or ask us at the lab.</p>",
     "<p>If you have a question, ask us at the lab.</p>"],
  ],
  privacyNoMail: [
    [`reply to the confirmation email of your booking or ask us in person (${h.roomEn})`, `ask us in person (${h.roomEn})`],
    [`reply to the confirmation email or ask us in person (${h.roomEn}). To cancel your booking there are two ways: the cancellation link in the confirmation email, or “Manage my booking” on the home page, with your email address and the 6-digit booking code that is also in the email. Cancelling does not delete the data: your booking data is deleted at most ${RET.en} after the date of the slot; if you want it deleted sooner, reply to the email.`,
     `ask us in person (${h.roomEn}). To cancel your booking, use the link on the page you see when you book. Cancelling does not delete the data: your booking data is deleted at most ${RET.en} after the date of the slot; if you want it deleted sooner, ask us in person.`],
  ],
  privacy: `<h1>Privacy policy</h1>
<p>This page explains which data the booking system uses and summarises how the study data are handled. The full information about the study is in the informed consent form you sign at the lab.</p>
<h2>Who handles your data</h2>
<p>The ${h.group} research group (${h.uniUnit}). Person responsible: ${h.responsible}. For any question about your data, reply to the confirmation email of your booking or ask us in person (${h.roomEn}).</p>
<h2>What for</h2>
<p>To manage your slot and send you the confirmation, a reminder and any changes that may occur. We do it with your consent, which you give when you book and can withdraw at any time, by cancelling the booking.</p>
<h2>What data</h2>
<p>Name or alias, email address, the slot you chose, the language of the page{decl} and, if you do so, when you confirmed that you receive our email. To limit abuse of the form, a code derived from the IP address is kept for one hour. It cannot be used to identify you.</p>
<h2>Services we use</h2>
<ul>
<li>Cloudflare: hosting of the website and database.</li>
<li>Google: sending of the emails from the study's Gmail account, when enabled.</li>
<li>Cloudflare Turnstile: bot check, when enabled.</li>
</ul>
<h2>Notices about future studies (optional)</h2>
<p>When you book, you can tick a box to be told by email about future studies of the group. It is optional and does not change your booking.</p>
<ul>
<li>What we keep: only your email address and the language of the page. We do not keep your name or the slot.</li>
<li>What for: to tell you about future studies of the ${h.group} group.</li>
<li>On what basis: your consent, given with the optional box. It counts from when you confirm the booking; if you do not confirm it, your email address is deleted after 3 hours and does not count as consent.</li>
<li>For how long: ${MON.en} from that confirmation. Then it is deleted automatically.</li>
<li>How to withdraw: on the <a href="{baja}">Unsubscribe from notices</a> page, or by replying to any email of the study. Cancelling the booking does not remove you from the list.</li>
</ul>
<p>The notices are sent by the person responsible from their own email account: the website sends nothing to that list.</p>
<h2>How long</h2>
<p>Booking data is deleted ${RET.en} after the slot. Unconfirmed bookings are deleted after 2 hours. If you asked for notices about future studies, your email address and language are kept for ${MON.en} from when you confirm the booking and then deleted; if you do not confirm the booking, they are deleted after 3 hours. The emails we send you, and the copies of booking notices that the person responsible receives (with your name and email address), also remain in the mail account they are sent from until the study ends, and are then deleted. The notices sent to the list and any files the person responsible downloads from it are their own copies: they are deleted when the list is cleaned and, at the latest, after ${MON.en}. The technical log of sent emails (which email went out and whether it failed, without its text) is kept for 60 days. After the booking data are deleted, the site keeps only counts per week (how many sessions were booked, attended, missed or cancelled), with no names or e-mail addresses. Someone who knows who came in a given week could still connect a count to a person.</p>
<h2>Cookies</h2>
<p>We do not use cookies or tracking for people who visit the website.</p>
<h2>Link with the study data</h2>
<p>Booking data is never linked to the study data or to participant codes.</p>
<h2>Study data</h2>
<p>Before starting you sign an informed consent form on paper and keep a copy. Your answers to the questionnaires and the researcher's notes are stored under a participant code, never with your name. Only the ${h.group} group (${h.university}) uses them. They may be published as an anonymised dataset. They are kept for five years after the end of the study and then deleted. Photos or videos are taken only if you agree in the consent form.</p>
<h2>Your rights</h2>
<p>To see, correct or delete your booking data, reply to the confirmation email or ask us in person (${h.roomEn}). To cancel your booking there are two ways: the cancellation link in the confirmation email, or “Manage my booking” on the home page, with your email address and the 6-digit booking code that is also in the email. Cancelling does not delete the data: your booking data is deleted at most ${RET.en} after the date of the slot; if you want it deleted sooner, reply to the email. To unsubscribe from notices about future studies, use the <a href="{baja}">unsubscribe page</a>: you only need to enter your email address. For the study data, write to the contact on your copy of the consent form, with your participant code.</p>
<p><a href="{home}">Back to the start</a></p>`,
}))(orgCtx("en"));

const it = (({ org, kicker, h, unitP }) => ({
  htmlLang: "it",
  brand,
  skip: "Vai al contenuto",
  switchLabel: "Lingua / Language",
  title: `Partecipa a ${aIt(SN.it)}`,
  siteName: `${brand} · ${org.university}`,
  kicker,
  chipPlace: place.short.it,
  ogDesc: `Una sessione di ${SESSION_MINUTES} minuti (${place.room.it}). Prenota il tuo turno.`,
  desc: `Partecipa a ${aIt(SN.it)} del gruppo ${org.group}. Sessione di ${SESSION_MINUTES} minuti (${place.room.it}).`,
  footTerms: "Condizioni di partecipazione",
  footPrivacy: "Informativa sulla privacy",
  footBaja: "Cancellarsi dagli avvisi",
  footUv: kicker,
  // Product credit in the footer: "<madeWith> Approdo <madeBy> nerln" (the name is a link, see src/product.js). The licence asks to keep it visible.
  madeWith: "Fatto con",
  madeBy: "di",
  footPhoto: credit("it"),
  lab: place.long.it,
  back: "Torna all'inizio",
  lead: `È uno studio di ricerca del gruppo ${org.group} (${org.university}).`,
  doesH: "Cosa farai",
  reqH: "Requisiti",
  rightsH: "I tuoi dati e i tuoi diritti",
  rights: ["Partecipare è volontario: puoi interrompere in qualsiasi momento, senza dare alcuna spiegazione e senza alcuna conseguenza. Non è previsto alcun compenso.", "I dati dello studio vengono conservati con un codice, mai con il tuo nome, e sono usati solo dal gruppo di ricerca.", "Il consenso si firma su carta in laboratorio. Ne ricevi una copia, con il contatto a cui scrivere per vedere, correggere o cancellare i tuoi dati."],
  cantComeH: "Se non puoi venire",
  cantCome: "Annulla con il link dell'e-mail di conferma o in «Gestisci la mia prenotazione», con la tua e-mail e il tuo codice. Così un'altra persona potrà prendere il tuo turno. Annullare non ha alcuna conseguenza.",
  cantComeNoMail: "Annulla con il link della pagina che vedi quando prenoti. Così un'altra persona potrà prendere il tuo turno. Annullare non ha alcuna conseguenza.",
  helpH: "Domande",
  help: `Rispondi all'e-mail di conferma oppure chiedicelo di persona (${place.room.it}).`,
  helpNoMail: `Chiedicelo di persona (${place.room.it}).`,
  factDuration: "Durata:",
  factMinutes: (n) => `${n} minuti.`,
  factWhere: "Dove:",
  factLang: "Lingua:",
  factLangText: "",
  study1: {
    lead: `Parteciperai a ${aIt(SN.it)} del gruppo ${org.group} (${org.university}). Una persona del gruppo ti spiegherà di cosa si tratta quando arrivi.`,
    does: "Vieni in laboratorio per una sessione individuale con una persona del gruppo di ricerca. Ti spieghiamo tutto quando arrivi e non serve alcuna esperienza precedente.",
    reqs: [],
  },
  study2: {
    lead: `Parteciperai al secondo studio del gruppo ${org.group} (${org.university}). Una persona del gruppo ti spiegherà di cosa si tratta quando arrivi.`,
    does: "In questo secondo studio vieni in laboratorio per un'altra sessione individuale con una persona del gruppo di ricerca. Ti spieghiamo tutto quando arrivi e non serve alcuna esperienza precedente.",
    reqs: [],
  },
  reqEpilepsy: "Non soffrire né aver mai sofferto di epilessia.",
  reqVestibular: "Non soffrire né aver mai sofferto di disturbi vestibolari (dell'orecchio interno o dell'equilibrio).",
  bookH: "Prenota il tuo turno",
  noSlots: "Al momento non ci sono turni liberi. Ricontrolla tra qualche giorno.",
  step1: "Scegli un giorno e un orario",
  step1Help: `Tocca l'orario che preferisci. Ogni sessione dura ${SESSION_MINUTES} minuti.`,
  step2: "I tuoi dati",
  step2Help: "Usiamo la tua e-mail solo per inviarti la conferma e il promemoria.",
  step2HelpNoMail: "Usiamo la tua e-mail solo per evitare due prenotazioni con lo stesso indirizzo.",
  step3: "Conferma",
  step3Help: "Controlla che il giorno e l'orario siano quelli che vuoi e spunta le dichiarazioni.",
  nameL: "Nome o pseudonimo",
  emailL: "Indirizzo e-mail",
  hpL: "Non compilare questo campo",
  noepi: "Non soffro né ho mai sofferto di epilessia",
  vest: "Non soffro né ho mai sofferto di disturbi vestibolari",
  accept: (terms, priv) => `Ho letto e accetto le <a href="${terms}" target="_blank" rel="noopener">condizioni di partecipazione<span class="sr-only"> (si apre in una nuova scheda)</span></a> e l'<a href="${priv}" target="_blank" rel="noopener">informativa sulla privacy<span class="sr-only"> (si apre in una nuova scheda)</span></a>`,
  futureL: "Desidero ricevere via e-mail avvisi sui prossimi studi del gruppo (facoltativo).",
  futureNote: `Conserveremo solo la tua e-mail per ${MON.it} da quando confermi il turno, poi la cancelleremo. Puoi cancellarti prima, quando vuoi.`,
  futureNoteInstant: `Conserveremo solo la tua e-mail per ${MON.it}. Il conteggio parte da quando la confermi o dal giorno in cui vieni al tuo turno, a seconda di quale delle due cose avviene prima; poi la cancelleremo. Se non fai né l'una né l'altra, non entrerai nella lista. Puoi cancellarti prima, quando vuoi.`,
  listLaterNoMail: "Hai chiesto gli avvisi sui prossimi studi: ti inseriremo nella lista il giorno in cui verrai al tuo turno.",
  bookedKeepNoLink: "<strong>Conserva questo link:</strong> serve per annullare o vedere i dettagli. L'e-mail che ti abbiamo inviato non contiene link: contiene un codice per «Gestisci la mia prenotazione», nella pagina iniziale.",
  bookedMailFailed: "<strong>Conserva questo link:</strong> serve per annullare o vedere i dettagli. Non siamo riusciti a inviarti l'e-mail con questi dati, quindi li hai solo in questa pagina.",
  listLater: "Hai chiesto gli avvisi sui prossimi studi: ti inseriremo nella lista quando confermerai la tua e-mail, con il pulsante o il codice del messaggio che ti abbiamo inviato, oppure il giorno in cui verrai al tuo turno.",
  verifyHint: "Ti abbiamo inviato un'e-mail con questi dati. Se premi il pulsante «Conferma la mia e-mail» che trovi al suo interno, sapremo che ti è arrivata. Non è obbligatorio: il turno è già tuo.",
  verifyHintCode: "Ti abbiamo inviato un'e-mail con questi dati e un codice. Se scrivi il codice in «Gestisci la mia prenotazione», nella pagina iniziale, sapremo che ti è arrivata. Non è obbligatorio: il turno è già tuo.",
  verifyH1: "Conferma la tua e-mail",
  verifyP: "Il tuo turno è già prenotato. Premi il pulsante per farci sapere che questa e-mail ti arriva.",
  verifyBtn: "Conferma la mia e-mail",
  verifiedDone: "E-mail confermata. Grazie.",
  twoH: "Due studi",
  twoIntro: "Svolgiamo due studi, uno dopo l'altro:",
  twoS1: "Studio 1.",
  twoS2: "Studio 2.",
  twoNow: "Turni aperti adesso.",
  twoLater: "Più avanti.",
  twoDone: "È già concluso.",
  twoNotice: "Se vuoi che ti avvisiamo quando si aprono i turni dell'altro, spunta la casella degli avvisi quando prenoti.",
  manyH: "Più studi",
  manyIntro: "Svolgiamo più studi, uno dopo l'altro:",
  manyNotice: "Se vuoi che ti avvisiamo quando se ne apre un altro, spunta la casella degli avvisi quando prenoti.",
  errPrefix: "Errore: ",
  errGo: "Vai al campo",
  requiredNote: "Tutto è obbligatorio tranne ciò che è indicato come facoltativo.",
  noscriptTs: `Per prenotare serve attivare JavaScript, per il controllo anti-robot. Se non puoi, chiedicelo di persona (${place.room.it}).`,
  footNav: "Condizioni, privacy e cancellazione dagli avvisi",
  bajaDoneTitle: "Richiesta di cancellazione ricevuta",
  bajaTitle: "Cancellarsi dagli avvisi",
  bajaLead: "Scrivi la tua e-mail e la toglieremo dalla lista degli avvisi sui prossimi studi del gruppo.",
  bajaBtn: "Cancellami",
  bajaDone: "Se quell'indirizzo era nella lista, l'abbiamo cancellato. Non riceverai altri avvisi.",
  onList: (a) => `Ti avviseremo dei prossimi studi. Per cancellarti: <a href="${a}">pagina di cancellazione</a>.`,
  cancelOnList: (a) => `Sei ancora nella lista degli avvisi sui prossimi studi. Per cancellarti: <a href="${a}">pagina di cancellazione</a>.`,
  submit: "Prenota il turno",
  summaryL: "Il tuo turno:",
  slotLabel: (day, from, to) => `${day}, dalle ${from} alle ${to}`,
  afterSubmit: "Ti invieremo un'e-mail con un link. Hai 2 ore per confermare il turno.",
  afterSubmitFlex: "Ti invieremo un'e-mail con un link. Hai 2 ore per confermare il turno (se è per oggi, fino all'ora in cui inizia).",
  afterSubmitNoMail: "Il turno è confermato subito. Conserva il link della pagina successiva: serve per annullare.",
  afterSubmitInstant: "Il turno è confermato subito. Nella pagina successiva potrai aggiungerlo al calendario e ti invieremo un'e-mail con i dati e le istruzioni per annullarlo.",
  cardDay: "Giorno", cardHour: "Orario", cardPlace: "Luogo", cardStudy: "Studio",
  hourRange: (a, b) => `dalle ${a} alle ${b}`,
  pendingTitle: "Controlla la tua e-mail",
  pendingP1: (email) => `Abbiamo tenuto da parte il turno per 2 ore. Ti abbiamo scritto a <strong>${email}</strong> con un link per confermarlo.`,
  pendingP2: "Se non trovi l'e-mail, controlla nella cartella della posta indesiderata. Se passano 2 ore senza conferma, il turno si libera e i tuoi dati vengono cancellati.",
  pendingShortP1: (email, until) => `Abbiamo tenuto da parte il turno fino alle ${until}, l'ora in cui inizia. Ti abbiamo scritto a <strong>${email}</strong> con un link per confermarlo.`,
  pendingShortP2: (until) => `Se non trovi l'e-mail, controlla nella cartella della posta indesiderata. Se alle ${until} non è confermato, il turno si libera e i tuoi dati vengono cancellati.`,
  todayTag: " (oggi)",
  yourMail: "la tua e-mail",
  bookedConfirmed: "Turno confermato",
  bookedReserved: "Turno prenotato",
  bookedThanks: (name) => `Grazie, ${name}. Ecco i dettagli:`,
  addCal: "Aggiungi al calendario (.ics)",
  addGcal: "Aggiungi a Google Calendar (nuova scheda)",
  calLead: "Aggiungilo al tuo calendario per non dimenticarlo. Il file .ics va bene per il calendario di Apple, per Outlook e per gli altri programmi.",
  bookedCancel: (a) => `Se non puoi venire, <a href="${a}">annulla il tuo turno con questo link</a>, così un'altra persona potrà prenderlo.`,
  bookedKeep: "<strong>Conserva questo link:</strong> serve per annullare o vedere i dettagli. Lo trovi anche nell'e-mail.",
  bookedKeepNoMail: "<strong>Conserva questo link:</strong> serve per annullare o vedere i dettagli.",
  bookedInstr: "Arriva con qualche minuto di anticipo.",
  manageLink: "Hai già un turno? Gestisci la mia prenotazione",
  manageTitle: "Gestisci la mia prenotazione",
  manageLead: "Scrivi l'e-mail con cui hai prenotato e il codice di 6 cifre della tua prenotazione. Se il turno è in attesa, lo confermi inviando il modulo; se è già confermato, potrai annullarlo o aggiungerlo al calendario.",
  codeL: "Codice di prenotazione (6 cifre)",
  manageBtn: "Conferma o gestisci",
  pendingCodeP1: (email) => `Ti abbiamo inviato un codice di 6 cifre a <strong>${email}</strong>. Scrivilo qui per confermare il turno.`,
  pendingCodeAlt: "Puoi anche scrivere qui il codice di 6 cifre che trovi nell'e-mail.",
  codeLine: (c) => `Il tuo codice di prenotazione: <strong>${c}</strong>`,
  bookedKeepCode: "<strong>Conserva questo codice:</strong> serve per annullare o vedere i dettagli in «Gestisci la mia prenotazione», nella pagina iniziale. Lo trovi anche nell'e-mail.",
  errCode: "L'e-mail o il codice non sono corretti.",
  errCodeRate: "Troppi tentativi. Aspetta 15 minuti.",
  confirmTitle: "Conferma turno",
  confirmH1: "Conferma il tuo turno",
  confirmBtn: "Conferma il mio turno",
  confirmCancel: "Non posso, voglio annullare",
  confirmedH1: "Il tuo turno è confermato",
  confirmedCancel: (a) => `Se non puoi venire, <a href="${a}">annulla qui</a>.`,
  confirmGone: "Questo turno non è più attivo. Puoi sceglierne un altro nella pagina iniziale.",
  cancelTitle: "Annulla turno",
  cancelH1: "Annulla il tuo turno",
  cancelP: "Se annulli, il turno torna libero per un'altra persona.",
  cancelBtn: "Annulla il mio turno",
  cancelNo: "No, torna all'inizio",
  cancelGone: "Questo turno era già stato annullato o non è più attivo.",
  doneTitle: "Turno annullato",
  doneP: "Grazie per l'avviso. Il turno è di nuovo libero.",
  doneAgain: "Scegli un altro turno",
  goneTitle: "Link non valido",
  goneH1: "Link non valido o scaduto",
  goneDefault: "Non abbiamo trovato quel turno. Potrebbe essere scaduto.",
  notFound: "Non trovato.",
  errTitle: "Errore",
  errP: "Qualcosa è andato storto. Riprova tra qualche minuto.",
  unavailTitle: "Servizio non disponibile",
  unavailP: "Manca il database.",
  unconfTitle: "Questo sito non è ancora configurato",
  unconfP: "Qui non si può ancora prenotare: la persona che gestisce il sito non ha finito di configurarlo. Riprova più tardi.",
  dayFullTitle: "Oggi non possiamo accettare altre prenotazioni",
  dayFullP: "Abbiamo ricevuto molte richieste nelle ultime ore. Riprova domani.",
  rateTitle: "Troppi tentativi",
  rateP: "Hai fatto troppe richieste. Riprova tra 10 minuti.",
  err: {
    tooFast: "Hai inviato il modulo troppo in fretta. Aspetta qualche secondo e premi di nuovo «Prenota il turno».",
    expired: "Il modulo è scaduto. Controlla i tuoi dati e invialo di nuovo.",
    human: "Non siamo riusciti a verificare che tu sia una persona. Riprova.",
    pick: "Scegli un turno dall'elenco.",
    name: "Scrivi un nome o uno pseudonimo (massimo 40 caratteri).",
    nameChars: "Usa lettere, numeri e segni di punteggiatura comuni (senza < > @ né caratteri di controllo).",
    email: "L'indirizzo e-mail non sembra valido.",
    disposable: "Usa un indirizzo e-mail non temporaneo (niente indirizzi usa e getta).",
    noepi: "Per sicurezza, non possiamo includere persone con epilessia.",
    vest: "Per sicurezza, non possiamo includere persone con disturbi vestibolari.",
    accept: "Devi accettare le condizioni di partecipazione e l'informativa sulla privacy.",
    taken: "Quel turno non è più disponibile. Scegline un altro.",
    liveEmail: "C'è già un turno prenotato con questa e-mail. Se vuoi cambiarlo, annullalo con il link dell'e-mail che hai ricevuto e prenota di nuovo.",
    liveEmailNoMail: "C'è già un turno prenotato con questa e-mail. Se vuoi cambiarlo, annullalo con il link della pagina che hai visto quando hai prenotato e prenota di nuovo; se non ce l'hai più, chiedicelo di persona.",
    raceEmail: "C'è già un turno prenotato con questa e-mail.",
    raceSlot: "Qualcuno ha appena prenotato quel turno. Scegline un altro.",
    mail: "Non siamo riusciti a inviare l'e-mail in questo momento. Riprova tra qualche minuto. Se continua a non funzionare, controlla l'indirizzo.",
    attended: "Hai già partecipato a questo studio con questa e-mail. Grazie.",
  },
  inviteSubject: `Partecipa a ${aIt(SN.it)}${unitP}`,
  invitePitch: `Cerchiamo persone per ${aIt(SN.it)} del gruppo ${org.group} (${org.university}). È una sessione individuale di ${SESSION_MINUTES} minuti (${place.room.it}). Non serve alcuna esperienza precedente. La partecipazione è volontaria e non è retribuita.`,
  termsVision: "",
  termsEpilepsy: "Che non soffrano né abbiano mai sofferto di epilessia.",
  termsVestibularStudy2: "Nel secondo studio, che inoltre non soffrano né abbiano mai sofferto di disturbi vestibolari.",
  termsVestibularAlways: "Che non soffrano né abbiano mai sofferto di disturbi vestibolari.",
  termsMaterials: "",
  termsTitle: "Condizioni di partecipazione",
  termsDesc: `Condizioni di partecipazione: ${SN.it} (${org.group}).`,
  terms: `<h1>Condizioni di partecipazione</h1>
<h2>Chi può partecipare</h2>
<ul>
{reqs}
</ul>
<h2>Cosa succede</h2>
<p>Ti aspettiamo presso: ${h.longIt}. La sessione dura ${SESSION_MINUTES} minuti ed è individuale: svolgi le attività dello studio e, se serve, compili un questionario.{materials} Il consenso informato si firma su carta in laboratorio, prima di iniziare. Le foto o i video della sessione sono facoltativi: si fanno solo se li accetti nel consenso.</p>
<h2>È volontario</h2>
<p>Puoi interrompere in qualsiasi momento, senza dare alcuna spiegazione e senza alcuna conseguenza. La partecipazione non è retribuita.</p>
<h2>Se non puoi venire</h2>
<p>Annulla con il link che ricevi quando prenoti o in «Gestisci la mia prenotazione», con la tua e-mail e il tuo codice, così un'altra persona potrà prendere il tuo turno. Non c'è alcuna penale se non vieni.</p>
<h2>Modifiche da parte del ricercatore</h2>
<p>Per motivi tecnici, il ricercatore può spostare o annullare un turno. Se succede, ti scriverà all'indirizzo e-mail che hai indicato.</p>
<h2>Domande</h2>
<p>Se hai una domanda, rispondi all'e-mail di conferma che ricevi quando prenoti oppure chiedicelo in laboratorio.</p>
<p><a href="{home}">Torna all'inizio</a></p>`,
  privDecl: {
    epiVestStudy2: ", le tue dichiarazioni sui requisiti (assenza di epilessia e, se del caso, di disturbi vestibolari)",
    epiVestAlways: ", le tue dichiarazioni sui requisiti (assenza di epilessia e di disturbi vestibolari)",
    epi: ", la tua dichiarazione sui requisiti (assenza di epilessia)",
    vestStudy2: ", la tua dichiarazione sui requisiti (se del caso, assenza di disturbi vestibolari)",
    vestAlways: ", la tua dichiarazione sui requisiti (assenza di disturbi vestibolari)",
  },
  privacyTitle: "Informativa sulla privacy",
  privacyDesc: `Informazioni sul trattamento dei dati del sistema di prenotazione (${SN.it}, ${org.group}).`,
  privacyInstant: [
    ["<li>Base giuridica: il tuo consenso, quello della casella facoltativa. Vale da quando confermi la prenotazione; se non la confermi, la tua e-mail viene cancellata dopo 3 ore e non conta come consenso.</li>",
     "<li>Base giuridica: il tuo consenso, quello della casella facoltativa. Vale da quando confermi la tua e-mail, con il pulsante o il codice del messaggio che ti inviamo, oppure dal giorno in cui vieni al tuo turno, a seconda di quale delle due cose avviene prima. Se non fai né l'una né l'altra, la tua e-mail non entra nella lista.</li>"],
    [`<li>Per quanto tempo: ${MON.it} da quella conferma. Poi viene cancellata automaticamente.</li>`,
     `<li>Per quanto tempo: ${MON.it} da quel momento. Poi viene cancellata automaticamente.</li>`],
    [`Le prenotazioni non confermate vengono cancellate dopo 2 ore. Se hai chiesto gli avvisi sui prossimi studi, la tua e-mail e la lingua vengono conservate per ${MON.it} da quando confermi la prenotazione e poi cancellate; se non confermi la prenotazione, vengono cancellate dopo 3 ore.`,
     `Se hai chiesto gli avvisi sui prossimi studi, la tua e-mail e la lingua vengono conservate per ${MON.it} da quando confermi la tua e-mail o vieni al tuo turno, e poi cancellate; se non fai né l'una né l'altra, non vengono conservate per gli avvisi.`],
  ],
  // Frasi delle condizioni e dell'informativa che mandano a un'e-mail; senza il servizio di posta (relayOn falso) si sostituiscono con queste: [frase con e-mail, frase senza].
  termsNoMail: [
    ["<p>Annulla con il link che ricevi quando prenoti o in «Gestisci la mia prenotazione», con la tua e-mail e il tuo codice, così un'altra persona potrà prendere il tuo turno.",
     "<p>Annulla con il link della pagina che vedi quando prenoti, così un'altra persona potrà prendere il tuo turno."],
    ["<p>Se hai una domanda, rispondi all'e-mail di conferma che ricevi quando prenoti oppure chiedicelo in laboratorio.</p>",
     "<p>Se hai una domanda, chiedicelo in laboratorio.</p>"],
  ],
  privacyNoMail: [
    [`rispondi all'e-mail di conferma della tua prenotazione oppure chiedicelo di persona (${h.roomIt})`, `chiedicelo di persona (${h.roomIt})`],
    [`rispondi all'e-mail di conferma oppure chiedicelo di persona (${h.roomIt}). Per annullare la prenotazione hai due strade: il link di annullamento dell'e-mail di conferma, oppure «Gestisci la mia prenotazione» nella pagina iniziale, con la tua e-mail e il codice di prenotazione di 6 cifre che si trova anche nell'e-mail. Annullare non cancella i dati: i dati della tua prenotazione vengono cancellati al più tardi ${RET.it} dopo la data del turno; se vuoi che vengano cancellati prima, scrivici rispondendo all'e-mail.`,
     `chiedicelo di persona (${h.roomIt}). Per annullare la prenotazione usa il link della pagina che vedi quando prenoti. Annullare non cancella i dati: i dati della tua prenotazione vengono cancellati al più tardi ${RET.it} dopo la data del turno; se vuoi che vengano cancellati prima, chiedicelo di persona.`],
  ],
  privacy: `<h1>Informativa sulla privacy</h1>
<p>Questa pagina spiega quali dati usa il sistema di prenotazione e riassume come vengono trattati i dati dello studio. Le informazioni complete sullo studio si trovano nel consenso informato che firmi in laboratorio.</p>
<h2>Chi tratta i tuoi dati</h2>
<p>Il gruppo di ricerca ${h.group} (${h.uniUnit}). Persona responsabile: ${h.responsible}. Per qualsiasi domanda sui tuoi dati, rispondi all'e-mail di conferma della tua prenotazione oppure chiedicelo di persona (${h.roomIt}).</p>
<h2>Finalità</h2>
<p>Per gestire il tuo turno e inviarti la conferma, un promemoria e gli eventuali cambiamenti. Lo facciamo con il tuo consenso, che dai quando prenoti e puoi ritirare quando vuoi, annullando la prenotazione.</p>
<h2>Quali dati</h2>
<p>Nome o pseudonimo, indirizzo e-mail, il turno scelto, la lingua della pagina{decl} e, se lo fai, quando hai confermato di ricevere la nostra e-mail. Per limitare gli abusi del modulo, per un'ora viene conservato un codice derivato dall'indirizzo IP, che non permette di identificarti.</p>
<h2>Servizi che usiamo</h2>
<ul>
<li>Cloudflare: hosting del sito web e database.</li>
<li>Google: invio delle e-mail dall'account Gmail dello studio, quando è attivato.</li>
<li>Cloudflare Turnstile: controllo anti-robot, quando è attivato.</li>
</ul>
<h2>Avvisi sui prossimi studi (facoltativo)</h2>
<p>Quando prenoti puoi spuntare una casella per ricevere via e-mail avvisi sui prossimi studi del gruppo. È facoltativo e non cambia la tua prenotazione.</p>
<ul>
<li>Cosa conserviamo: solo il tuo indirizzo e-mail e la lingua della pagina. Non conserviamo il tuo nome né il turno.</li>
<li>Finalità: per avvisarti dei prossimi studi del gruppo ${h.group}.</li>
<li>Base giuridica: il tuo consenso, quello della casella facoltativa. Vale da quando confermi la prenotazione; se non la confermi, la tua e-mail viene cancellata dopo 3 ore e non conta come consenso.</li>
<li>Per quanto tempo: ${MON.it} da quella conferma. Poi viene cancellata automaticamente.</li>
<li>Come ritirarlo: nella pagina <a href="{baja}">Cancellarsi dagli avvisi</a>, oppure rispondendo a una qualsiasi e-mail dello studio. Annullare la prenotazione non ti toglie dalla lista.</li>
</ul>
<p>Gli avvisi li invia la persona responsabile dal proprio indirizzo e-mail: il sito non invia nulla a quella lista.</p>
<h2>Per quanto tempo</h2>
<p>I dati della prenotazione vengono cancellati ${RET.it} dopo il turno. Le prenotazioni non confermate vengono cancellate dopo 2 ore. Se hai chiesto gli avvisi sui prossimi studi, la tua e-mail e la lingua vengono conservate per ${MON.it} da quando confermi la prenotazione e poi cancellate; se non confermi la prenotazione, vengono cancellate dopo 3 ore. Le e-mail che ti inviamo, e le copie degli avvisi di prenotazione che riceve la persona responsabile (con il tuo nome e la tua e-mail), restano anch'esse nell'account di posta da cui vengono inviate fino alla fine dello studio, e poi vengono cancellate. Le e-mail di avviso alla lista e i file che la persona responsabile scarica dall'elenco sono copie sue: vengono cancellati quando la lista viene ripulita e, al più tardi, dopo ${MON.it}. Il registro tecnico degli invii (quale e-mail è partita e se ha dato errore, senza il suo testo) viene conservato 60 giorni. Dopo la cancellazione dei dati delle prenotazioni, il sito conserva soltanto i conteggi per settimana (quanti turni sono stati prenotati, frequentati, saltati o annullati), senza nomi né indirizzi e-mail. Chi sa chi è venuto in una certa settimana potrebbe comunque collegare un conteggio a una persona.</p>
<h2>Cookie</h2>
<p>Non usiamo cookie né tracciamento per le persone che visitano il sito.</p>
<h2>Collegamento con i dati dello studio</h2>
<p>I dati della prenotazione non vengono mai collegati ai dati dello studio né ai codici dei partecipanti.</p>
<h2>Dati dello studio</h2>
<p>Prima di iniziare firmi su carta un consenso informato e ne conservi una copia. Le risposte ai questionari e le note del ricercatore vengono conservate con un codice del partecipante, mai con il tuo nome. Sono usate solo dal gruppo ${h.group} (${h.university}). Possono essere pubblicate come insieme di dati anonimizzato. Vengono conservate per cinque anni dalla fine dello studio e poi cancellate. Le foto o i video si fanno solo se li accetti nel consenso.</p>
<h2>I tuoi diritti</h2>
<p>Per vedere, correggere o cancellare i dati della tua prenotazione, rispondi all'e-mail di conferma oppure chiedicelo di persona (${h.roomIt}). Per annullare la prenotazione hai due strade: il link di annullamento dell'e-mail di conferma, oppure «Gestisci la mia prenotazione» nella pagina iniziale, con la tua e-mail e il codice di prenotazione di 6 cifre che si trova anche nell'e-mail. Annullare non cancella i dati: i dati della tua prenotazione vengono cancellati al più tardi ${RET.it} dopo la data del turno; se vuoi che vengano cancellati prima, scrivici rispondendo all'e-mail. Per cancellarti dagli avvisi sui prossimi studi, usa la <a href="{baja}">pagina di cancellazione</a>: basta scrivere la tua e-mail. Per i dati dello studio, scrivi al contatto indicato nella tua copia del consenso, con il tuo codice del partecipante.</p>
<p><a href="{home}">Torna all'inizio</a></p>`,
}))(orgCtx("it"));

// ---- registry: built-in texts + the lab's overrides -----------------------------------------------
const BUILTIN = { es, en, it };
// The built-in text sets before any override (read by the tests that compare the languages key by key).
export const BUILTIN_TEXTS = BUILTIN;
export const hasBuiltinTexts = (lang) => Object.hasOwn(BUILTIN, lang);

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Deep copy of a text object (functions are shared: they are pure).
const clone = (v) => (Array.isArray(v) ? v.map(clone) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
// A text template written as a plain string in site.config.js for a key that is a function in the built-in texts:
// "{0}", "{1}" ... are replaced by the arguments (for example pendingP1: "We wrote to {0}.").
const template = (str) => (...a) => str.replace(/\{(\d)\}/g, (_, i) => String(a[Number(i)] ?? ""));

// Path segments that would reach the prototype chain: never allowed in a text key.
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
// Writes one override into the text object. `path` is a list of keys; throws on a key that does not exist
// (a typo would otherwise be silently ignored), on a value of the wrong kind and on a key that names the prototype chain.
// Only own properties of plain objects are walked, so an override can never reach Object.prototype or a shared function.
// `trail` is only for messages.
function setPath(obj, path, value, where, trail) {
  const name = (n = path.length) => trail + path.slice(0, n).join(".");
  for (const seg of path) {
    if (FORBIDDEN_SEGMENTS.has(seg)) throw new Error(`site.config.js: ${where}: the text key "${trail}${path.join(".")}" contains "${seg}", which is not allowed in a text key`);
  }
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!Object.hasOwn(cur, path[i]) || !isPlain(cur[path[i]])) throw new Error(`site.config.js: ${where}: unknown text group "${name(i + 1)}" (see the built-in texts in src/i18n.js)`);
    cur = cur[path[i]];
  }
  const k = path[path.length - 1];
  if (!Object.hasOwn(cur, k)) throw new Error(`site.config.js: ${where}: unknown text "${name()}" (see the built-in texts in src/i18n.js)`);
  const old = cur[k];
  if (typeof old === "function") {
    if (typeof value !== "string") throw new Error(`site.config.js: ${where}: "${name()}" takes a text with {0}, {1}... where its arguments go`);
    cur[k] = template(value);
  } else if (Array.isArray(old)) {
    if (!Array.isArray(value)) throw new Error(`site.config.js: ${where}: "${name()}" must be a list`);
    cur[k] = clone(value);
  } else if (isPlain(old)) {
    if (!isPlain(value)) throw new Error(`site.config.js: ${where}: "${name()}" must be an object`);
    applyOverrides(old, value, where, name() + ".");
  } else {
    if (typeof value !== "string") throw new Error(`site.config.js: ${where}: "${name()}" must be a text`);
    cur[k] = value;
  }
}
// Both forms work: { "study1.lead": "..." } and { study1: { lead: "..." } }, mixed freely.
function applyOverrides(base, overrides, where, trail = "") {
  for (const [k, v] of Object.entries(overrides)) setPath(base, k.split("."), v, where, trail);
}

// Languages that need a text set: the public ones plus the admin language. A language without built-in texts yet is
// served with the English texts (so the site works while the translation is being written); MISSING_TEXTS lists them.
export const MISSING_TEXTS = [...new Set([...LANGS, C.adminLanguage])].filter((l) => !hasBuiltinTexts(l));
export const T = {};
// The two words of the footer credit ("Made with" ... "by") are not texts of the lab: the licence asks every site to keep that line
// (LICENSE, the display of the author's attribution), so a configuration cannot blank or reword it. Every language has its own built-in translation.
const CREDIT_KEYS = ["madeWith", "madeBy"];
for (const l of Object.keys(C.texts)) {
  if (!LANGS.includes(l)) throw new Error(`site.config.js: texts.${l}: "${l}" is not in languages (${LANGS.join(", ")})`);
}
for (const l of new Set([...LANGS, C.adminLanguage])) {
  T[l] = clone(hasBuiltinTexts(l) ? BUILTIN[l] : BUILTIN.en);
  if (!hasBuiltinTexts(l)) T[l].switchLabel = `${LANG_REGISTRY[l].label} / Language`;
  if (C.texts[l]) {
    for (const k of CREDIT_KEYS) if (Object.hasOwn(C.texts[l], k)) throw new Error(`site.config.js: texts.${l}.${k} cannot be changed: it is part of the credit line that the licence asks every site to keep (see LICENSE)`);
    applyOverrides(T[l], C.texts[l], `texts.${l}`);
  }
}

// The text of a public sentence that mentions the confirmation e-mail, for this mail setting: with the relay off, the built-in
// sentence is replaced by its `<key>NoMail` variant. A sentence the lab rewrote itself (texts.<lang>.<key>) is always kept as written.
// `key` can be a path such as "err.liveEmail".
export function mailText(lang, key, relayIsOn) {
  const path = key.split(".");
  const get = (o, last = path[path.length - 1]) => path.slice(0, -1).reduce((x, k) => (x == null ? x : x[k]), o)?.[last];
  const S = T[lang];
  if (relayIsOn || !hasBuiltinTexts(lang) || get(S) !== get(BUILTIN[lang])) return get(S);
  return get(S, `${path[path.length - 1]}NoMail`) ?? get(S);
}
