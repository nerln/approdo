// The informed-consent sheet of a study: built-in default texts (es, en, it), how a stored consent form is resolved against them,
// the facts the public page states (so the sheet can agree with it), and the printable A4 page.
//
// Everything the researcher types is PLAIN TEXT: it is escaped here, wherever it is drawn, and a line break becomes a new paragraph.
// The defaults take the lab's name, place, session length and retention periods from site.config.js; the parts only the lab can know
// are marked with square brackets (the phrases in BRACKETS below, and nothing else: no template key can be left over).
// The sheet holds no personal data and no participant code: it is a blank form that is printed and signed on paper.
import { C, DEFAULT_LANG, LANG_REGISTRY, orgFor } from "./config.js";
import { T, BUILTIN_TEXTS } from "./i18n.js";
import { esc } from "./util.js";
import { AT } from "./admin_texts.js";
import { SESSION_MINUTES, nowLocal } from "./slots.js";
import { CONSENT_FIELDS, resolveTexts } from "./studies.js";

// The sections of the sheet, in the order of a real consent sheet. "welcome" has no heading: it opens the sheet under the title.
export const SHEET_ORDER = Object.freeze(["welcome", "description", "procedure", "duration", "risks", "exclusion", "rights", "dataCollected", "storage", "whoUses", "publication", "retention", "controller", "withdraw", "supervisors"]);

// The phrases between square brackets that the default texts contain: what only the lab can know. Used by the tests and by nobody else.
export const BRACKETS = Object.freeze({
  es: Object.freeze({
    aim: "describe en pocas líneas de qué trata el estudio y qué se quiere averiguar",
    tasks: "describe las tareas que hará la persona, el equipo que se usa y los cuestionarios, si los hay",
    risks: "describe los riesgos y molestias, si los hay, y qué se hace para reducirlos",
    who: "indica quién no puede participar, según los requisitos del estudio",
    data: "enumera los datos que se recogen, por ejemplo respuestas a cuestionarios o medidas de las tareas, e indica si se hacen fotos, audio o vídeo",
    store: "describe dónde y cómo se guardan, por ejemplo bajo un código de participante que no contiene tu nombre",
    share: "añade a quién más se dan los datos, en qué forma (anónimos o seudonimizados) y dónde",
    keep: "indica cuánto tiempo se conservan los datos del estudio y qué ocurre después",
    legal: "añade el contacto del delegado de protección de datos y la base jurídica del tratamiento, como exige tu institución",
    team: "escribe los nombres y el contacto de las personas responsables del estudio",
  }),
  en: Object.freeze({
    aim: "describe in a few lines what the study is about and what it aims to find out",
    tasks: "describe the tasks the participant will do, the equipment used and any questionnaire",
    risks: "describe the risks and discomforts, if any, and what is done to reduce them",
    who: "list who cannot take part, according to the requirements of the study",
    data: "list the data collected, for example answers to questionnaires or task measures, and say whether photos, audio or video are recorded",
    store: "describe where and how, for example under a participant code that does not contain your name",
    share: "add who else receives the data, in what form (anonymised or pseudonymised) and where",
    keep: "state for how long the study data are kept and what happens to them afterwards",
    legal: "add the contact of the data protection officer and the legal basis of the processing, as your institution requires",
    team: "write the names and contact of the people responsible for the study",
  }),
  it: Object.freeze({
    aim: "descrivi in poche righe di che cosa tratta lo studio e che cosa si vuole scoprire",
    tasks: "descrivi i compiti che la persona svolgerà, la strumentazione usata e gli eventuali questionari",
    risks: "descrivi i rischi e i disagi, se ce ne sono, e che cosa si fa per ridurli",
    who: "indica chi non può partecipare, in base ai requisiti dello studio",
    data: "elenca i dati raccolti, per esempio risposte a questionari o misure dei compiti, e indica se si fanno foto, audio o video",
    store: "descrivi dove e come, per esempio con un codice partecipante che non contiene il tuo nome",
    share: "aggiungi a chi altro vengono dati, in quale forma (anonimi o pseudonimizzati) e dove",
    keep: "indica per quanto tempo si conservano i dati dello studio e che cosa succede dopo",
    legal: "aggiungi il contatto del responsabile della protezione dei dati e la base giuridica del trattamento, come richiede la tua istituzione",
    team: "scrivi i nomi e il contatto dei responsabili dello studio",
  }),
});
const br = (lang, key) => `[${BRACKETS[lang][key]}]`;

// The words of the printed sheet, in the language of the sheet.
export const SHEET = Object.freeze({
  es: {
    titleDefault: "Consentimiento informado",
    sections: { description: "De qué trata el estudio", procedure: "Qué vas a hacer", duration: "Cuánto dura", risks: "Riesgos y molestias", exclusion: "Quién no puede participar", rights: "Tus derechos", dataCollected: "Qué datos se recogen", storage: "Cómo se guardan los datos", whoUses: "Quién usa los datos", publication: "Publicación de los resultados", retention: "Cuánto tiempo se conservan los datos", controller: "Responsable del tratamiento", withdraw: "Ver, corregir o borrar tus datos, o retirar tu consentimiento", supervisors: "Investigadores y supervisores" },
    consentTitle: "Consentimiento",
    researcher: "Investigador/a", name: "Nombre", printedName: "Nombre y apellidos (en letra clara)", signature: "Firma", date: "Fecha", participant: "Participante",
    reqIntro: "Solo pueden participar las personas que cumplan estos requisitos:", version: (d) => `versión del ${d}`,
    stmtPre: "Yo,", stmtAdult: ", he leído este documento, he podido hacer preguntas, soy mayor de edad y acepto participar en este estudio.", stmtNoAdult: ", he leído este documento, he podido hacer preguntas y acepto participar en este estudio.",
    permsTitle: "Permisos opcionales (marca solo los que aceptes)",
    copies: "Se firman dos copias: una para la persona participante y otra para el equipo.",
  },
  en: {
    titleDefault: "Informed consent",
    sections: { description: "What the study is about", procedure: "What you will do", duration: "How long it lasts", risks: "Risks and discomforts", exclusion: "Who cannot take part", rights: "Your rights", dataCollected: "What data are collected", storage: "How the data are stored", whoUses: "Who uses the data", publication: "Publication of the results", retention: "How long the data are kept", controller: "Data controller", withdraw: "See, correct or delete your data, or withdraw your consent", supervisors: "Researchers and supervisors" },
    consentTitle: "Consent",
    researcher: "Researcher", name: "Name", printedName: "Name (printed)", signature: "Signature", date: "Date", participant: "Participant",
    reqIntro: "Only people who meet these requirements can take part:", version: (d) => `version of ${d}`,
    stmtPre: "I,", stmtAdult: ", have read this document, have been able to ask questions, am of legal age, and agree to take part in this study.", stmtNoAdult: ", have read this document, have been able to ask questions, and agree to take part in this study.",
    permsTitle: "Optional permissions (tick only the ones you agree to)",
    copies: "Two copies are signed: one for the participant and one for the research team.",
  },
  it: {
    titleDefault: "Consenso informato",
    sections: { description: "Di che cosa tratta lo studio", procedure: "Che cosa farai", duration: "Quanto dura", risks: "Rischi e disagi", exclusion: "Chi non può partecipare", rights: "I tuoi diritti", dataCollected: "Quali dati si raccolgono", storage: "Come si conservano i dati", whoUses: "Chi usa i dati", publication: "Pubblicazione dei risultati", retention: "Per quanto tempo si conservano i dati", controller: "Titolare del trattamento", withdraw: "Vedere, correggere o cancellare i tuoi dati, o ritirare il consenso", supervisors: "Ricercatori e supervisori" },
    consentTitle: "Consenso",
    researcher: "Ricercatore/ricercatrice", name: "Nome", printedName: "Nome e cognome (in stampatello)", signature: "Firma", date: "Data", participant: "Partecipante",
    reqIntro: "Possono partecipare solo le persone che soddisfano questi requisiti:", version: (d) => `versione del ${d}`,
    stmtPre: "Io,", stmtAdult: ", ho letto questo documento, ho potuto fare domande, sono maggiorenne e accetto di partecipare a questo studio.", stmtNoAdult: ", ho letto questo documento, ho potuto fare domande e accetto di partecipare a questo studio.",
    permsTitle: "Permessi facoltativi (spunta solo quelli che accetti)",
    copies: "Si firmano due copie: una per la persona che partecipa e una per il gruppo di ricerca.",
  },
});

const placeLong = (lang) => C.place.long[lang] ?? C.place.long[DEFAULT_LANG];

// What the study says about itself, when it says something of its own: the text the researcher stored, or one the configuration gives
// that the built-in texts do not have. The built-in generic text does not count (it says nothing about this study), so the sheet keeps
// its bracketed gap for what the person will do. { does: "", reqs: [] } when there is nothing.
export function ownStudyTexts(lang, view) {
  if (!view) return { does: "", reqs: [] };
  const r = resolveTexts(lang, view);
  const t = (view.texts && view.texts[lang]) || {};
  const base = (BUILTIN_TEXTS[lang] || BUILTIN_TEXTS.en)[view.id === "study2" ? "study2" : "study1"];
  return {
    does: t.does || (r.does !== base.does ? r.does : ""),
    reqs: t.reqs && t.reqs.length ? t.reqs : JSON.stringify(r.reqs) !== JSON.stringify(base.reqs) ? r.reqs : [],
  };
}

// The built-in text of every field, for one language and one study (view: a study of the registry). The study decides two things: the
// title that heads the sheet and, when the booking form asks for the epilepsy or vestibular declaration, the matching sentence of
// "who cannot take part", so that the default sheet agrees with the public page.
export function consentDefaults(lang, view) {
  const org = orgFor(lang);
  const uni = [org.university, org.unit].filter(Boolean).join(", ");
  const days = C.bookingRetentionDays, months = C.contactMonths;
  const title = view ? resolveTexts(lang, view).title : "";
  const decl = (view && view.declarations) || { epilepsy: false, vestibular: false };
  const own = ownStudyTexts(lang, view);
  const SH = SHEET[lang];
  // "Who cannot take part": the requirements of the study and the declarations of the booking form when there are any, else a gap.
  const excl = (who, epi, vest) => (own.reqs.length ? [SH.reqIntro, ...own.reqs, ...[epi, vest]] : epi || vest ? [epi, vest] : [who]).filter(Boolean).join("\n");
  const D = {};
  if (lang === "es") {
    D.heading = `${SHEET.es.titleDefault}${title ? `: ${title}` : ""}`;
    D.welcome = `Gracias por plantearte participar en este estudio del grupo ${org.group} (${org.university}). Lee esta hoja con calma y pregunta al investigador todo lo que no entiendas antes de decidir: puedes tomarte el tiempo que necesites.`;
    D.description = `Este estudio lo realiza el grupo ${org.group} de ${org.university}. ${br("es", "aim")}`;
    D.procedure = `Vendrás a ${placeLong("es")} para una sesión individual. ${own.does || br("es", "tasks")}`;
    D.duration = `La sesión dura unos ${SESSION_MINUTES} minutos.`;
    D.risks = `${br("es", "risks")}\nSi en algún momento te sientes mal o incómodo/a, díselo al investigador: la sesión se interrumpe.`;
    D.exclusion = excl(br("es", "who"), decl.epilepsy ? "No pueden participar las personas que tengan o hayan tenido epilepsia." : "", decl.vestibular ? "No pueden participar las personas que tengan o hayan tenido un trastorno vestibular (del oído interno o del equilibrio)." : "");
    D.rights = "Participar es voluntario y no se paga. Puedes negarte a participar o parar en cualquier momento, sin dar ninguna razón y sin ninguna consecuencia para ti.";
    D.dataCollected = br("es", "data");
    D.storage = `Los datos de la sesión se guardan así: ${br("es", "store")}\nEl nombre y el correo que diste al reservar sirven solo para organizar la sesión, se borran ${days} ${days === 1 ? "día" : "días"} después y no se vinculan con los datos recogidos durante el estudio.`;
    D.whoUses = `Solo el equipo de investigación del grupo ${org.group} tendrá acceso a los datos. ${br("es", "share")}`;
    D.publication = "Los resultados pueden presentarse en artículos científicos, congresos e informes, siempre de forma agregada o anónima, de modo que nadie pueda identificarte.";
    D.retention = `${br("es", "keep")}\nLos datos de la reserva (nombre y correo) se borran ${days} ${days === 1 ? "día" : "días"} después de la sesión. Si aceptaste que te avisemos de futuros estudios, tu correo se guarda como máximo ${months} ${months === 1 ? "mes" : "meses"}, o hasta que pidas que se borre.\nLas copias de los avisos de reserva se quedan en el buzón de correo del investigador hasta que termine el estudio, y se conservan recuentos por semana, sin nombres.`;
    D.controller = `Responsable del tratamiento: ${uni}. Equipo de investigación: ${org.group}. Persona responsable: ${C.responsible}. Contacto: ${C.contactEmail}.\n${br("es", "legal")}`;
    D.supervisors = br("es", "team");
    D.withdraw = `Puedes pedir en cualquier momento ver, corregir o borrar tus datos, o retirar tu consentimiento, escribiendo a ${C.contactEmail}. También tienes derecho a presentar una reclamación ante la autoridad de protección de datos.`;
  } else if (lang === "it") {
    D.heading = `${SHEET.it.titleDefault}${title ? `: ${title}` : ""}`;
    D.welcome = `Grazie per aver pensato di partecipare a questo studio del gruppo ${org.group} (${org.university}). Leggi con calma questo foglio e chiedi al ricercatore tutto ciò che non ti è chiaro prima di decidere: puoi prenderti il tempo che ti serve.`;
    D.description = `Questo studio è condotto dal gruppo ${org.group} (${org.university}). ${br("it", "aim")}`;
    D.procedure = `Verrai presso ${placeLong("it")} per una sessione individuale. ${own.does || br("it", "tasks")}`;
    D.duration = `La sessione dura circa ${SESSION_MINUTES} minuti.`;
    D.risks = `${br("it", "risks")}\nSe in qualsiasi momento ti senti male o a disagio, dillo al ricercatore: la sessione viene interrotta.`;
    D.exclusion = excl(br("it", "who"), decl.epilepsy ? "Non possono partecipare le persone che soffrono o hanno sofferto di epilessia." : "", decl.vestibular ? "Non possono partecipare le persone che soffrono o hanno sofferto di disturbi vestibolari (dell'orecchio interno o dell'equilibrio)." : "");
    D.rights = "Partecipare è volontario e non è retribuito. Puoi rifiutarti di partecipare o fermarti in qualsiasi momento, senza dare alcuna spiegazione e senza alcuna conseguenza per te.";
    D.dataCollected = br("it", "data");
    D.storage = `I dati della sessione si conservano così: ${br("it", "store")}\nIl nome e l'e-mail che hai dato prenotando servono solo a organizzare la sessione, vengono cancellati ${days} ${days === 1 ? "giorno" : "giorni"} dopo e non vengono collegati ai dati raccolti durante lo studio.`;
    D.whoUses = `Solo il gruppo di ricerca ${org.group} avrà accesso ai dati. ${br("it", "share")}`;
    D.publication = "I risultati possono essere presentati in articoli scientifici, convegni e rapporti, sempre in forma aggregata o anonima, in modo che nessuno possa identificarti.";
    D.retention = `${br("it", "keep")}\nI dati della prenotazione (nome ed e-mail) vengono cancellati ${days} ${days === 1 ? "giorno" : "giorni"} dopo la sessione. Se hai accettato di essere avvisato dei prossimi studi, la tua e-mail si conserva al massimo ${months} ${months === 1 ? "mese" : "mesi"}, o finché non chiedi di cancellarla.\nLe copie degli avvisi di prenotazione restano nella casella di posta del ricercatore fino alla fine dello studio, e si conservano conteggi per settimana, senza nomi.`;
    D.controller = `Titolare del trattamento: ${uni}. Gruppo di ricerca: ${org.group}. Responsabile: ${C.responsible}. Contatto: ${C.contactEmail}.\n${br("it", "legal")}`;
    D.supervisors = br("it", "team");
    D.withdraw = `Puoi chiedere in qualsiasi momento di vedere, correggere o cancellare i tuoi dati, o di ritirare il consenso, scrivendo a ${C.contactEmail}. Hai anche il diritto di presentare un reclamo all'autorità per la protezione dei dati.`;
  } else {
    D.heading = `${SHEET.en.titleDefault}${title ? `: ${title}` : ""}`;
    D.welcome = `Thank you for considering taking part in this study of the ${org.group} group (${org.university}). Please read this sheet carefully and ask the researcher anything that is not clear before you decide: you can take as long as you need.`;
    D.description = `This study is carried out by the ${org.group} group at ${org.university}. ${br("en", "aim")}`;
    D.procedure = `The session is individual and takes place at: ${placeLong("en")}. ${own.does || br("en", "tasks")}`;
    D.duration = `The session lasts about ${SESSION_MINUTES} minutes.`;
    D.risks = `${br("en", "risks")}\nIf at any moment you feel unwell or uncomfortable, tell the researcher: the session will be stopped.`;
    D.exclusion = excl(br("en", "who"), decl.epilepsy ? "People who have, or have ever had, epilepsy cannot take part." : "", decl.vestibular ? "People who have, or have ever had, a vestibular disorder (inner ear or balance) cannot take part." : "");
    D.rights = "Taking part is voluntary and is not paid. You may refuse to take part, or stop at any moment, without giving any reason and without any consequence for you.";
    D.dataCollected = br("en", "data");
    D.storage = `The data of the session are stored as follows: ${br("en", "store")}\nThe name and e-mail address you gave when booking are used only to organise the session, are deleted ${days} ${days === 1 ? "day" : "days"} after it, and are not linked to the data collected during the study.`;
    D.whoUses = `Only the research team of the ${org.group} group will have access to the data. ${br("en", "share")}`;
    D.publication = "The results may be presented in scientific articles, conferences and reports, always in aggregated or anonymous form, so that nobody can identify you.";
    D.retention = `${br("en", "keep")}\nThe booking data (name and e-mail) are deleted ${days} ${days === 1 ? "day" : "days"} after the session. If you agreed to be told about future studies, your e-mail is kept for ${months} ${months === 1 ? "month" : "months"} at most, or until you ask for it to be removed.\nCopies of the booking notices stay in the researcher's mailbox until the study ends, and counts per week without names are kept.`;
    D.controller = `Data controller: ${uni}. Research team: ${org.group}. Person responsible: ${C.responsible}. Contact: ${C.contactEmail}.\n${br("en", "legal")}`;
    D.supervisors = br("en", "team");
    D.withdraw = `You may ask at any moment to see, correct or delete your data, or to withdraw your consent, by writing to ${C.contactEmail}. You also have the right to lodge a complaint with the data protection authority.`;
  }
  return D;
}

// What the sheet prints for one language: every field (the stored text, or the default when it is empty), the optional permissions
// and the two switches. view.consent is undefined until somebody saves a consent form.
export function resolveConsent(lang, view) {
  const c = (view && view.consent && view.consent[lang]) || null;
  const d = consentDefaults(lang, view);
  const fields = {};
  for (const f of CONSENT_FIELDS) fields[f] = (c && c[f]) || d[f];
  return { fields, perms: c ? c.perms : [], researcher: c ? c.researcher : true, adult: c ? c.adult : true, researcherFirst: c ? c.researcherFirst === true : false, defaults: d };
}

// ---- consistency with the public page -------------------------------------------------------------------------------------------
// The facts the public page states for this study, so that the researcher can make the sheet agree with it.
export function publicFacts(lang, view) {
  const S = T[lang];
  const r = resolveTexts(lang, view);
  const reqs = [...r.reqs, ...(view.declarations.epilepsy ? [S.reqEpilepsy] : []), ...(view.declarations.vestibular ? [S.reqVestibular] : [])];
  return { minutes: SESSION_MINUTES, epilepsy: !!view.declarations.epilepsy, vestibular: !!view.declarations.vestibular, reqs, promises: consentPromises(lang) };
}
// What the public pages promise about the consent, sentence by sentence: the sentences of the "rights" list, the terms and the privacy
// text that mention the consent (the lab's texts, as they are served). The researcher reads them next to the consent form so that the
// sheet keeps every one of them. Plain text (tags and the {placeholders} are taken out).
const CONSENT_WORD = /consent|consenso|consentimiento/i;
export function consentPromises(lang) {
  const S = T[lang];
  const plain = (h) => String(h).replace(/<h[1-6][^>]*>[^<]*<\/h[1-6]>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\{[a-z]+\}/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const pieces = [...(Array.isArray(S.rights) ? S.rights : []), S.terms, S.privacy].filter((x) => typeof x === "string").map(plain);
  const out = [];
  for (const piece of pieces) {
    for (const sent of piece.split(/(?<=[.!?])\s+/)) {
      const t = sent.trim();
      if (t && CONSENT_WORD.test(t) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}
// The bracketed gaps that are left in the text of a sheet (fields and optional permissions): "[describe ...]".
export function countGaps(fields, perms = []) {
  return [...Object.values(fields), ...perms].reduce((n, t) => n + (String(t).match(/\[[^\[\]\n]*\]/g) || []).length, 0);
}
// "epilepsy" in es, en and it (epilepsia, epilepsy, epilessia), also in its adjective forms.
const EPILEPSY = /epilep|epiless/i;
// The problems of the sheet of one language, as keys: "epilepsy" when the booking form asks for the epilepsy declaration and the
// "who cannot take part" text (the default or the edited one) does not mention epilepsy.
export function consentWarnings(lang, view) {
  const out = [];
  if (view.declarations.epilepsy && !EPILEPSY.test(resolveConsent(lang, view).fields.exclusion)) out.push("epilepsy");
  return out;
}

// ---- the printable page ---------------------------------------------------------------------------------------------------------
// Paragraphs: every line of a field is one <p>, escaped.
const paras = (text) => String(text).split("\n").filter((l) => l.trim() !== "").map((l) => `<p>${esc(l)}</p>`).join("");
// A drawn line to write on (a CSS border, not a form control).
const line = (label) => `<span class="sheet-line"><span class="sheet-line-label">${esc(label)}</span><span class="sheet-rule"></span></span>`;

// The date of the last change of the study (its row), in the configured zone and the language of the sheet; today's date for a study
// that was never changed (nothing to date).
const versionDate = (lang, view, today) => {
  const iso = view && view.updatedAt && !Number.isNaN(Date.parse(view.updatedAt)) ? nowLocal(new Date(view.updatedAt)).date : today;
  return new Intl.DateTimeFormat(LANG_REGISTRY[lang].locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
};

// A complete page (it does not use the layout of the site: it is a sheet to print, black on white in both themes, with no navigation).
// backHref: the link back to the editor (admin language). The study and the language have been validated by the caller.
// today: the local date, for a study that was never changed.
export function consentSheetPage(lang, view, backHref, today = "") {
  const S = SHEET[lang];
  const R = resolveConsent(lang, view);
  const org = orgFor(lang);
  const f = R.fields;
  const sections = SHEET_ORDER.filter((k) => k !== "welcome").map((k) => `<section class="sheet-sec" id="s-${k}"><h2>${esc(S.sections[k])}</h2>${paras(f[k])}</section>`);
  const perms = R.perms.length
    ? `<div class="sheet-perms"><h3>${esc(S.permsTitle)}</h3><ul>${R.perms.map((p) => `<li><span class="sheet-box" aria-hidden="true"></span><span>${esc(p)}</span></li>`).join("")}</ul></div>`
    : "";
  // The signature blocks: the participant's (printed name, date, signature), then the researcher's, unless the sheet puts the researcher's
  // lines first (some approved sheets do) or has none.
  const block = (who) => `<p class="sheet-who">${esc(who)}</p><div class="sheet-sign-row">${line(S.printedName)}${line(S.date)}${line(S.signature)}</div>`;
  const researcher = R.researcher ? block(S.researcher) : "";
  const statement = `<p class="sheet-statement">${esc(S.stmtPre)} <span class="sheet-blank"></span>${esc(R.adult ? S.stmtAdult : S.stmtNoAdult)}</p>`;
  const body = R.researcherFirst ? `${researcher}${statement}${perms}${block(S.participant)}` : `${statement}${perms}${block(S.participant)}${researcher}`;
  const consent = `<section class="sheet-sec sheet-consent" id="s-consent"><h2>${esc(S.consentTitle)}</h2>${body}<p class="sheet-copies">${esc(S.copies)}</p></section>`;
  const t = AT.consent;
  const lab = [org.group, org.university, org.unit].filter(Boolean).join(" · ");
  const gaps = countGaps(f, R.perms);
  return `<!doctype html>
<html lang="${esc(LANG_REGISTRY[lang].htmlLang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex, nofollow">
<title>${esc(f.heading)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/admin.css">
</head>
<body class="sheet-page">
<div class="sheet-screen"><p><strong>${esc(t.printHintTitle)}</strong> ${esc(t.printHint)}</p><p class="note">${esc(t.sheetNote)}</p><p class="${gaps ? "sheet-gaps" : "note"}" role="status">${esc(t.gapsLeft(gaps))}</p><p><a href="${esc(backHref)}">${esc(t.backToEditor)}</a></p></div>
<main class="sheet" id="main">
<header class="sheet-head"><p class="sheet-lab">${esc(lab)}</p><h1>${esc(f.heading)}</h1></header>
<section class="sheet-sec sheet-welcome">${paras(f.welcome)}</section>
${sections.join("\n")}
${consent}
<footer class="sheet-foot"><p>${esc(view.name)} · ${esc(S.version(versionDate(lang, view, today)))}</p></footer>
</main>
</body>
</html>`;
}
