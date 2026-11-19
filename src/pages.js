// Public pages, in the configured languages. Sin cookies y sin scripts en línea.
// Un único archivo propio (/booking.js) mejora el resumen del turno; todo funciona sin él.
import { esc } from "./util.js";
import { prettyDate, prettyDay, addMinutes, SESSION_MINUTES, shortHold, clockLocal, localToUtc } from "./slots.js";
import { C, LANGS, DEFAULT_LANG, LANG_REGISTRY, declarationsFor } from "./config.js";
import { pathFor } from "./paths.js";
import { baseUrl, relayOn, noLinks, googleCalUrl } from "./mail.js";
import { formatCode } from "./db.js";
import { T, lk, LOCALE_OG, mailText } from "./i18n.js";
import { resolveTexts, ownTitle, publicStudies, publicStateOf, isSeededId } from "./studies.js";
import { accentVariants } from "./theme.js";
import { PRODUCT_AUTHOR, PRODUCT_NAME, PRODUCT_SITE, berthSvg } from "./product.js";

// An internal link to a public path (written with its Spanish name), in the path style of the page language.
const pp = (L, p) => lk(L, pathFor(L.lang, p));

// Language context of the admin panel (it has no language switch).
export const ADMIN_L = { lang: C.adminLanguage, explicit: false };
export const ES = ADMIN_L; // old name
export const TITLE = T[DEFAULT_LANG].title;

// Common structure. With admin:true the page is a dashboard page: it loads the dashboard stylesheet only and brings its own <main>.
// main: the class of <main> on public pages ("page" for a single-purpose page); credit: the photo credit goes in the footer
// (the landing page shows it with the photo instead).
export function layout(env, L, { title, ogTitle = "", path = "/", body, description, noindex = false, turnstile = false, scripts = [], admin = false, home = false, css = [], noSwitch = false, main = "page", credit = true }) {
  const S = T[L.lang];
  const base = baseUrl(env);
  const own = L.explicit ? `${pathFor(L.lang, path)}?lang=${L.lang}` : pathFor(L.lang, path);
  const alt = (lang) => `<link rel="alternate" hreflang="${lang}" href="${esc(base + pathFor(lang, path) + "?lang=" + lang)}">`;
  const sw = (lang) =>
    `<a href="${esc(pathFor(lang, path) + "?lang=" + lang)}" lang="${lang}" hreflang="${lang}"${L.lang === lang ? ' aria-current="true"' : ""}>${LANG_REGISTRY[lang].label}</a>`;
  // Language switch and hreflang only exist when the site has more than one public language.
  const multi = LANGS.length > 1;
  const og = C.hero.ogImage;
  const head = admin || noSwitch
    ? ""
    : `${multi ? LANGS.map(alt).join("\n") + "\n" : ""}<link rel="alternate" hreflang="x-default" href="${esc(base + pathFor(DEFAULT_LANG, path))}">
<meta property="og:title" content="${esc(ogTitle || S.title)}">
<meta property="og:description" content="${esc(S.ogDesc)}">
${og ? `<meta property="og:image" content="${esc(base + og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
` : ""}<meta property="og:url" content="${esc(base + own)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${LOCALE_OG[L.lang]}">
${LANGS.filter((l) => l !== L.lang).map((l) => `<meta property="og:locale:alternate" content="${LOCALE_OG[l]}">\n`).join("")}<meta property="og:site_name" content="${esc(S.siteName)}">
<meta name="twitter:card" content="${og ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(ogTitle || S.title)}">
<meta name="twitter:description" content="${esc(S.ogDesc)}">
${og ? `<meta name="twitter:image" content="${esc(base + og)}">\n` : ""}`;
  // The main stylesheet, then the page's own, then the accent of the lab (/theme.css), which must come last.
  const sheets = [...(admin ? [] : ["/style.css"]), ...css, "/theme.css"].map((h) => `<link rel="stylesheet" href="${h}">`).join("\n");
  const top = admin
    ? ""
    : `<header class="site-header"><div class="header-inner"><a class="wordmark" href="${esc(lk(L, "/"))}">${esc(S.brand)}</a>
${noSwitch || !multi ? "" : `<nav class="languages" aria-label="${esc(S.switchLabel)}">${LANGS.map(sw).join("")}</nav>`}</div></header>
`;
  const foot = admin
    ? ""
    : `<footer class="site-footer"><div class="footer-text">
<nav aria-label="${esc(S.footNav)}"><p><a href="${esc(pp(L, "/condiciones"))}">${esc(S.footTerms)}</a><a href="${esc(pp(L, "/privacidad"))}">${esc(S.footPrivacy)}</a><a href="${esc(pp(L, "/baja"))}">${esc(S.footBaja)}</a></p></nav>
<p>${esc(S.footUv)}</p>
${credit && S.footPhoto ? `<p class="credit">${S.footPhoto}</p>\n` : ""}</div>
<p class="made">${berthSvg()}<span>${esc(S.madeWith)} <a href="${esc(PRODUCT_SITE)}" rel="noopener">${esc(PRODUCT_NAME)}</a> ${esc(S.madeBy)} ${esc(PRODUCT_AUTHOR)}</span></p></footer>
`;
  const accent = accentVariants(C.accent, C.palette).light;
  return `<!doctype html>
<html lang="${S.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || (admin ? S.title : `${S.title} · ${S.brand}`))}</title>
<meta name="description" content="${esc(description || S.desc)}">
<meta name="theme-color" content="${accent}">
${noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ""}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${sheets}
${head}${turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n' : ""}${scripts.map((s) => `<script src="${s}" defer></script>\n`).join("")}</head>
<body${C.palette === "theatre" ? ' class="pal-stage"' : ""}>
<a class="skip-link" href="#main">${esc(S.skip)}</a>
${top}${admin ? body : `<main id="main" class="${home ? (C.palette === "theatre" ? "stage-page" : "booking-layout") : main}">
${body}
</main>`}
${foot}</body>
</html>`;
}

// The lab's photo of the landing page (hero.image in site.config.js). Decorative. Without a photo there is none.
export const HEADSET = C.hero.image ? `<img class="hs" src="${esc(C.hero.image)}" alt="" width="${C.hero.width}" height="${C.hero.height}" decoding="async">` : "";
// The design's own decorative drawing for a site without a photo: contour lines and a dashed route. Presentation attributes only,
// no text, no style attribute (the policy forbids them); it takes its colours from the page through currentColor.
export const CONTOUR = `<svg class="contour" viewBox="0 0 540 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<g fill="none" stroke="currentColor" stroke-width="1" opacity=".65">
<path d="M-20 42C65 83 43-18 123-12S193 45 207 73s57 39 83 2 17-84 85-77 45 54 103 44 72-32 82-6"/>
<path d="M-20 58C72 99 57-2 124 4s73 51 83 83 55 49 91 6 17-81 78-77 42 57 102 43 72-25 82-5"/>
<path d="M-20 75C78 116 68 17 126 21s74 52 81 80 57 59 97 16 18-87 75-84 39 59 99 45 72-23 82-8"/>
<path d="M-20 94C85 138 78 33 126 37s76 51 81 80 58 70 102 24 25-90 72-92 39 63 97 48 72-15 82-7"/>
<path d="M-20 114C88 161 80 58 129 54s76 47 78 76 57 75 106 34 26-97 72-99 36 65 93 51 72-11 82-7"/>
<path d="M-20 134C95 181 82 83 133 71s76 47 76 76 51 78 105 44 34-106 73-109 41 67 92 53 72-8 82-7"/>
<path d="M-20 157C103 199 87 106 136 89s69 44 75 76 47 77 103 52 39-117 76-118 40 68 89 55 72-8 82-7"/>
<path d="M-20 181C109 223 97 131 138 108s63 40 76 78 42 75 97 58 44-129 80-127 42 70 90 55 72-5 82-5"/>
<path d="M-20 205C109 241 102 159 140 126s56 43 78 81 47 61 89 63 54-137 87-136 42 68 88 56 72-4 82-5"/>
</g>
<path d="M-6 224C75 202 112 161 156 172s50 55 90 40 70-48 93-84 34-26 65-9 67 2 142-29" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 5"/>
<circle cx="339" cy="128" r="5" fill="currentColor"/><path d="M329 128h20m-10-10v20" stroke="currentColor" stroke-width="1"/>
</svg>`;
// The art area of the landing page: the hologram over the photo (hero.art "hologram"), the photo, or the line drawing.
function artArea(S) {
  const credit = HEADSET && S.footPhoto ? `<figcaption class="art-caption">${S.footPhoto}</figcaption>` : "";
  if (C.hero.art === "hologram") return `<figure class="study-art study-art-holo"><div class="scene">${HEADSET}${HOLO}</div>${credit}</figure>`;
  if (HEADSET) return `<figure class="study-art">${HEADSET.replace(' class="hs"', "")}${credit}</figure>`;
  return `<figure class="study-art">${CONTOUR}</figure>`;
}
// Menú «holográfico» sobre las gafas: un dibujo abstracto (sin texto) de lo que se hace en la prueba, pulsar botones de
// un menú flotante. Decorativo (aria-hidden). Sin estilos en línea: la política de seguridad no los permite; todo el
// aspecto y la animación (una sola vez, menos de 5 segundos) están en style.css.
export const HOLO = `<svg class="holo-svg" viewBox="0 0 1040 800" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="hg-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8ee" stop-opacity=".02"/><stop offset="1" stop-color="#fff8ee" stop-opacity=".34"/></linearGradient>
<linearGradient id="hg-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff8ee" stop-opacity=".28"/><stop offset="1" stop-color="#fff8ee" stop-opacity=".1"/></linearGradient>
<filter id="hg-blur" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
</defs>
<polygon class="h-cone" points="186,311 854,311 676,412 436,426" fill="url(#hg-cone)"/>
<g class="h-panel">
<g transform="translate(520 160) scale(1.2)">
<rect x="-296" y="-131" width="592" height="262" rx="34" fill="#fff8ee" fill-opacity=".18" filter="url(#hg-blur)"/>
<rect x="-274" y="-139" width="580" height="250" rx="30" fill="#fff8ee" fill-opacity=".05" stroke="#fff8ee" stroke-opacity=".3" stroke-width="2"/>
<rect x="-290" y="-125" width="580" height="250" rx="30" fill="#7a1f1f" fill-opacity=".35"/>
<rect x="-290" y="-125" width="580" height="250" rx="30" fill="url(#hg-glass)" stroke="#fff8ee" stroke-opacity=".85" stroke-width="2.5"/>
<circle cx="-250" cy="-88" r="12" fill="#fff8ee" fill-opacity=".92"/>
<rect x="-226" y="-96" width="150" height="16" rx="8" fill="#fff8ee" fill-opacity=".6"/>
<rect x="196" y="-99" width="66" height="22" rx="11" fill="none" stroke="#fff8ee" stroke-opacity=".6" stroke-width="2"/>
<line x1="-262" y1="-62" x2="262" y2="-62" stroke="#fff8ee" stroke-opacity=".3" stroke-width="2"/>
<rect x="-262" y="-37" width="128" height="14" rx="7" fill="#fff8ee" fill-opacity=".55"/><rect x="-72" y="-43" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".8" stroke-width="2"/><rect x="-72" y="-43" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".92"/><circle cx="-29" cy="-30" r="9" fill="#7a1f1f"/>
<rect x="-262" y="5" width="156" height="14" rx="7" fill="#fff8ee" fill-opacity=".55"/><rect x="-72" y="-1" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".8" stroke-width="2"/><rect class="h-track" x="-72" y="-1" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".92"/><circle class="h-knob" cx="-59" cy="12" r="9" fill="#7a1f1f"/>
<rect x="-262" y="47" width="104" height="14" rx="7" fill="#fff8ee" fill-opacity=".55"/><rect x="-72" y="41" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".8" stroke-width="2"/><circle cx="-59" cy="54" r="9" fill="#fff8ee" fill-opacity=".9"/>
<rect x="-262" y="89" width="140" height="14" rx="7" fill="#fff8ee" fill-opacity=".55"/><rect x="-72" y="83" width="58" height="26" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".8" stroke-width="2"/><circle cx="-59" cy="96" r="9" fill="#fff8ee" fill-opacity=".9"/>
<rect x="40" y="-42" width="222" height="66" rx="33" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".85" stroke-width="2.5"/>
<rect class="h-btn" x="40" y="-42" width="222" height="66" rx="33" fill="#fff8ee"/>
<path class="h-ico" d="M118 -27 L118 9 L148 -9 Z" fill="#7a1f1f"/>
<rect class="h-ico" x="160" y="-17" width="62" height="16" rx="8" fill="#7a1f1f"/>
<rect class="h-t1" x="40" y="46" width="48" height="56" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".7" stroke-width="2"/><rect x="98" y="46" width="48" height="56" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".7" stroke-width="2"/><rect x="156" y="46" width="48" height="56" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".7" stroke-width="2"/><rect class="h-t3" x="156" y="46" width="48" height="56" rx="13" fill="#fff8ee" fill-opacity=".92"/><rect x="214" y="46" width="48" height="56" rx="13" fill="#fff8ee" fill-opacity=".1" stroke="#fff8ee" stroke-opacity=".7" stroke-width="2"/>
<rect class="h-ring" x="40" y="-42" width="222" height="66" rx="33" fill="none" stroke="#fff8ee" stroke-width="3"/>
<g class="h-cur"><circle r="17" fill="#fff8ee" fill-opacity=".3" stroke="#7a1f1f" stroke-width="7"/><circle r="17" fill="none" stroke="#fff8ee" stroke-width="3.5"/><circle r="5" fill="#fff8ee" stroke="#7a1f1f" stroke-width="2"/></g>
</g>
</g>
</svg>`;


// The "several studies" card when the studies come from the admin panel. It appears only when at least two studies are public: the
// active one (always "now") and one the researcher listed (state "later" or "done"; a hidden study is not shown). Two untouched studies of
// the configuration (no title of their own in this language) keep the card built from the configuration, word for word.
function studiesCard(S, lang, reg) {
  const listed = publicStudies(reg);
  if (listed.length < 2) return "";
  const word = (x) => { const st = publicStateOf(x, reg); return st === "now" ? S.twoNow : st === "done" ? S.twoDone : S.twoLater; };
  const ul = (xs) => `<ul>${xs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  if (C.twoStudies && listed.length === 2 && listed.every((x) => isSeededId(x.id) && !ownTitle(x, lang)))
    return `<section class="info-block"><h2>${esc(S.twoH)}</h2><p>${esc(S.twoIntro)}</p>${ul(listed.map((x) => `${x.id === "study1" ? S.twoS1 : S.twoS2} ${word(x)}`))}<p>${esc(S.twoNotice)}</p></section>
`;
  const items = listed.map((x) => {
    const t = ownTitle(x, lang) || (x.id === "study1" ? S.twoS1.replace(/\.$/, "") : x.id === "study2" ? S.twoS2.replace(/\.$/, "") : S.title);
    return `${t}${/[.!?:]$/.test(t) ? "" : "."} ${word(x)}`;
  });
  return `<section class="info-block"><h2>${esc(S.manyH)}</h2><p>${esc(S.manyIntro)}</p>${ul(items)}<p>${esc(S.manyNotice)}</p></section>
`;
}

// How one study looks on the landing page, in one language (the preview of the admin panel). `view` is a study of the registry.
export function studyPreviewHtml(lang, view) {
  const S = T[lang];
  const r = resolveTexts(lang, view);
  const reqs = [...r.reqs, ...(view.declarations.epilepsy ? [S.reqEpilepsy] : []), ...(view.declarations.vestibular ? [S.reqVestibular] : [])];
  return `<div class="pv" lang="${esc(LANG_REGISTRY[lang].htmlLang)}"><h4 class="pv-title">${esc(r.title)}</h4><p class="lead">${esc(r.lead)}</p>
<h5>${esc(S.doesH)}</h5><p>${esc(r.does)}</p>${reqs.length ? `\n<h5>${esc(S.reqH)}</h5><ul>${reqs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
}

// reg: the registry of the studies (src/db.js getRegistry). While the studies come from site.config.js (reg.table false, or no reg)
// the page is built from the configuration alone; once they come from the panel, their texts, declarations and list replace the built-in ones.
export function indexPage(env, L, { study, days, formToken, error, errorField = "", values = {}, turnstileKey, instant = false, unconfigured = false, reg = null }) {
  const S = T[L.lang];
  const sv = reg && reg.table ? reg.studies.find((x) => x.id === study) : null;
  const rt = sv ? resolveTexts(L.lang, sv) : null;
  // The study's own public title (not the generic one) also names the page in the browser tab and in link previews.
  const own = sv ? ownTitle(sv, L.lang) : "";
  const s = rt || S[study] || S.study1;
  const decl = sv ? sv.declarations : declarationsFor(study);
  const v = (k) => esc(values[k] ?? "");
  const chk = (k) => (values[k] ? " checked" : "");
  // Campo con el fallo: aria-invalid y aria-describedby apuntan al mensaje; el resumen de arriba enlaza al campo.
  const inv = (k) => (error && errorField === k ? ' aria-invalid="true" aria-describedby="err"' : "");
  const target = { slot: "s1", name: "name", email: "email", noepi: "noepi", vestibular: "vestibular", accept: "accept" }[errorField] || "book-form";
  const errBox = error ? `<div class="error" role="alert" id="err"><p><strong>${esc(error)}</strong></p><p><a href="#${target}">${esc(S.errGo)}</a></p></div>\n` : "";
  let chosen = "";
  const slotsHtml = days
    .map((d) => {
      const day = prettyDay(d.date, L.lang);
      return `<fieldset class="day"><legend>${esc(day + (d.flex || d.short ? S.todayTag : ""))}</legend><div class="slots">${d.slots
        .map((t) => {
          const val = `${d.date}T${t}`;
          const label = S.slotLabel(day, t, addMinutes(t, SESSION_MINUTES));
          if (values.slot === val) chosen = label;
          return `<label class="slot"><input type="radio" name="slot" value="${val}" data-label="${esc(label)}" aria-label="${esc(label)}" required${values.slot === val ? " checked" : ""}><span>${t}</span></label>`;
        })
        .join("")}</div></fieldset>`;
    })
    .join("");
  const form = days.length
    ? `<form method="post" action="${esc(pp(L, "/reservar"))}" id="book-form" novalidate>
<p class="note">${esc(S.requiredNote)}</p>
<div class="step"><h3 class="step-title" id="s1"><span class="num">1</span>${esc(S.step1)}</h3><p class="note">${esc(S.step1Help)}</p>
${slotsHtml}</div>
<div class="step"><h3 class="step-title" id="s2"><span class="num">2</span>${esc(S.step2)}</h3><p class="note">${esc(mailText(L.lang, "step2Help", relayOn(env)))}</p>
<p class="field"><label for="name">${esc(S.nameL)}</label><input id="name" name="name" type="text" maxlength="40" required autocomplete="nickname" value="${v("name")}"${inv("name")}></p>
<p class="field"><label for="email">${esc(S.emailL)}</label><input id="email" name="email" type="email" maxlength="120" required autocomplete="email" value="${v("email")}"${inv("email")}></p>
<div class="hp" aria-hidden="true"><label>${esc(S.hpL)}<input name="web" type="text" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" name="t" value="${esc(formToken)}"></div>
<div class="step"><h3 class="step-title" id="s3"><span class="num">3</span>${esc(S.step3)}</h3><p class="note">${esc(S.step3Help)}</p>
<div aria-live="polite"><div class="summary" id="summary"${chosen ? "" : " hidden"}><strong>${esc(S.summaryL)}</strong> <span id="summary-text">${esc(chosen)}</span></div></div>
${decl.epilepsy ? `<p class="check"><label><input type="checkbox" id="noepi" name="noepi" value="1" required${chk("noepi")}${inv("noepi")}> <span>${esc(S.noepi)}</span></label></p>
` : ""}${decl.vestibular ? `<p class="check"><label><input type="checkbox" id="vestibular" name="vestibular" value="1" required${chk("vestibular")}${inv("vestibular")}> <span>${esc(S.vest)}</span></label></p>` : ""}
<p class="check"><label><input type="checkbox" id="accept" name="accept" value="1" required${chk("accept")}${inv("accept")}> <span>${S.accept(esc(pp(L, "/condiciones")), esc(pp(L, "/privacidad")))}</span></label></p>
<div class="optional"><p class="check"><label><input type="checkbox" name="future" value="1"${values.future === "1" ? " checked" : ""}> <span>${esc(S.futureL)}</span></label></p><p class="note">${esc(instant ? S.futureNoteInstant : S.futureNote)}</p></div>
${turnstileKey ? `<div class="cf-turnstile" data-sitekey="${esc(turnstileKey)}" data-action="reserva" data-language="${L.lang}"></div><noscript><p class="note">${esc(S.noscriptTs)}</p></noscript>` : ""}
<p><button type="submit" class="big">${esc(S.submit)}</button></p>
<p class="submit-note">${esc(relayOn(env) ? (instant ? S.afterSubmitInstant : days.some((d) => d.flex || d.short) ? S.afterSubmitFlex : S.afterSubmit) : S.afterSubmitNoMail)}</p></div>
</form>`
    : `<p class="note">${esc(S.noSlots)}</p>`;

  const chips = [[S.factMinutes(SESSION_MINUTES).replace(/\.$/, ""), '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'], [S.chipPlace, '<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.800-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/>']];
  const list = (xs) => `<ul>${xs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  // The booking section has the Spanish anchor "reserva" on Spanish pages (links that may already exist) and "book" on the others.
  const anchor = L.lang === "es" ? "reserva" : "book";
  const reqList = [...s.reqs, ...(decl.epilepsy ? [S.reqEpilepsy] : []), ...(decl.vestibular ? [S.reqVestibular] : [])];
  const title = rt ? rt.title : S.title;
  // A site that still holds the shipped example values takes no bookings: a short notice page takes the place of the form.
  if (unconfigured)
    return layout(env, L, { body: `${errBox}${berthSvg("berth state-glyph")}
<h1 id="hero-title">${esc(title)}</h1><p class="lede">${esc(s.lead || S.lead)}</p>
<div class="state-note"><h2>${esc(S.unconfTitle)}</h2><p>${esc(S.unconfP)}</p></div>`, path: "/", main: "page state-page", title: own ? `${own} · ${S.brand}` : undefined, ogTitle: own });
  const theatre = C.palette === "theatre";
  const factsHtml = `<ul class="facts">${chips.map(([c, ic]) => `<li><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ic}</svg>${esc(c)}</li>`).join("")}</ul>`;
  const panel = `<section class="booking-panel" aria-labelledby="${anchor}"><h2 id="${anchor}">${esc(S.bookH)}</h2>
<p class="panel-note"><a href="${esc(pp(L, "/gestionar"))}">${esc(S.manageLink)}</a></p>
${form}</section>`;
  // The information blocks next to the form; the art area belongs to them, except under the theatre palette (it stands on the band).
  const details = (art) => `<section class="study-details" aria-label="${esc(S.doesH)}">
${art}<section class="info-block"><h2>${esc(S.doesH)}</h2><p>${esc(s.does)}</p></section>
${reqList.length ? `<section class="info-block"><h2>${esc(S.reqH)}</h2>${list(reqList)}</section>` : ""}
${reg && reg.table ? studiesCard(S, L.lang, reg) : C.twoStudies ? `<section class="info-block"><h2>${esc(S.twoH)}</h2><p>${esc(S.twoIntro)}</p>${list([`${S.twoS1} ${study === "study2" ? S.twoDone : S.twoNow}`, `${S.twoS2} ${study === "study2" ? S.twoNow : S.twoLater}`])}<p>${esc(S.twoNotice)}</p></section>
` : ""}
<section class="info-block"><h2>${esc(S.rightsH)}</h2>${list(S.rights)}</section>
<section class="info-block"><h2>${esc(S.cantComeH)}</h2><p>${esc(mailText(L.lang, "cantCome", relayOn(env)))}</p><h2 class="h-next">${esc(S.helpH)}</h2><p>${esc(mailText(L.lang, "help", relayOn(env)))}</p></section>
</section>`;
  const body = theatre
    ? `${errBox}<div class="stage"><div class="stage-inner">
<section class="study-intro" aria-labelledby="hero-title"><h1 id="hero-title">${esc(title)}</h1>
<p class="lede">${esc(s.lead || S.lead)}</p>
${factsHtml}
<p class="stage-cta"><a class="button secondary" href="#${anchor}">${esc(S.bookH)}</a></p></section>
<div class="stage-art">${artArea(S)}</div>
</div></div>
<div class="booking-layout">
${panel}
${details("")}</div>`
    : `${errBox}<section class="study-intro" aria-labelledby="hero-title">
<h1 id="hero-title">${esc(title)}</h1>
<p class="lede">${esc(s.lead || S.lead)}</p>
${factsHtml}
<p class="jump"><a class="button secondary" href="#${anchor}">${esc(S.bookH)}</a></p>
</section>
${panel}
${details(artArea(S))}`;
  return layout(env, L, { body, path: "/", home: true, credit: !(HEADSET && S.footPhoto), title: error ? S.errPrefix + (own || S.title) + " · " + S.brand : own ? `${own} · ${S.brand}` : undefined, ogTitle: own, turnstile: !!turnstileKey, scripts: days.length ? ["/booking.js"] : [] });
}

// The booking as a ticket: study, day, hour and place, each with its label.
function bookingCard(L, b, studyTitle = "") {
  const S = T[L.lang];
  const it = (label, text, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`;
  return `<div class="ticket"><dl>${studyTitle ? it(S.cardStudy, studyTitle) : ""}${it(S.cardDay, prettyDate(b.date, L.lang), "when")}${it(S.cardHour, S.hourRange(b.time, addMinutes(b.time, SESSION_MINUTES)))}${it(S.cardPlace, S.lab)}</dl></div>`;
}

// A page about one booking: the title and the ticket, then what the person can do. Two columns on a wide screen.
const bookingPage = (title, intro, card, content) => `<section class="confirmation-title"><h1>${esc(title)}</h1>${intro}</section>
${card}
<section class="confirmation-content">${content}</section>`;

// Formulario para escribir el codigo de reserva. Con hiddenEmail el correo va oculto (pagina de "revisa tu correo").
function manageForm(L, { email = "", formToken, error, hiddenEmail = false, button }) {
  const S = T[L.lang];
  return `<form method="post" action="${esc(pp(L, "/gestionar"))}" class="form-card manage-form">
${error ? `<p class="error" role="alert" id="m-err">${esc(error)}</p>` : ""}
${hiddenEmail ? `<input type="hidden" name="email" value="${esc(email)}">` : `<p class="field"><label for="m-email">${esc(S.emailL)}</label><input id="m-email" name="email" type="email" maxlength="120" required autocomplete="email" value="${esc(email)}"${error ? ' aria-invalid="true" aria-describedby="m-err"' : ""}></p>`}
<p class="field"><label for="m-code">${esc(S.codeL)}</label><input id="m-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required${error ? ' aria-invalid="true" aria-describedby="m-err"' : ""}></p>
<input type="hidden" name="t" value="${esc(formToken)}">
<p><button type="submit" class="big">${esc(button || S.manageBtn)}</button></p>
</form>`;
}
const backLink = (L, text) => `<p><a class="back-link" href="${esc(lk(L, "/"))}">${esc(text)}</a></p>`;

export function managePage(env, L, { email = "", formToken, error } = {}) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, title: (error ? S.errPrefix : "") + S.manageTitle, path: "/gestionar", body: `<h1>${esc(S.manageTitle)}</h1>
<p>${esc(S.manageLead)}</p>
${manageForm(L, { email, formToken, error })}
${backLink(L, S.back)}` });
}

// Baja de los avisos de futuros estudios: un campo de correo y un boton.
export function unsubscribePage(env, L, { email = "", formToken, error } = {}) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, title: (error ? S.errPrefix : "") + S.bajaTitle, path: "/baja", body: `<h1>${esc(S.bajaTitle)}</h1>
<p>${esc(S.bajaLead)}</p>
<form method="post" action="${esc(pp(L, "/baja"))}" class="form-card manage-form">
${error ? `<p class="error" role="alert" id="b-err">${esc(error)}</p>` : ""}
<p class="field"><label for="b-email">${esc(S.emailL)}</label><input id="b-email" name="email" type="email" maxlength="120" required autocomplete="email" value="${esc(email)}"${error ? ' aria-invalid="true" aria-describedby="b-err"' : ""}></p>
<input type="hidden" name="t" value="${esc(formToken)}">
<p><button type="submit" class="big">${esc(S.bajaBtn)}</button></p>
</form>
${backLink(L, S.back)}` });
}
// Respuesta unica: no depende de que la direccion estuviera en la lista.
export function unsubscribedPage(env, L) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, title: S.bajaDoneTitle, path: "/baja", main: "page state-page", body: `${berthSvg("berth state-glyph")}<h1>${esc(S.bajaDoneTitle)}</h1><p>${esc(S.bajaDone)}</p>${backLink(L, S.back)}` });
}

export function pendingPage(env, L, email, b, { formToken = "" } = {}) {
  const S = T[L.lang];
  const code = !!(b && formToken);
  const nl = !!(b && noLinks(env, b.email));
  const form = code ? manageForm(L, { email: b.email, formToken, hiddenEmail: true, button: S.confirmBtn }) : "";
  const em = esc(email || S.yourMail);
  if (shortHold(b)) {
    const until = clockLocal(b.expires_at);
    return layout(env, L, { noindex: true, noSwitch: true, title: S.pendingTitle, path: "/reservar", body: `<h1>${esc(S.pendingTitle)}</h1>
<p>${nl ? S.pendingCodeP1(em) : S.pendingShortP1(em, esc(until))}</p>
${code && !nl ? `<p>${esc(S.pendingCodeAlt)}</p>` : ""}${form}
<p>${esc(S.pendingShortP2(until))}</p>
${backLink(L, S.back)}` });
  }
  return layout(env, L, { noindex: true, noSwitch: true, title: S.pendingTitle, path: "/reservar", body: `<h1>${esc(S.pendingTitle)}</h1>
<p>${nl ? S.pendingCodeP1(em) : S.pendingP1(em)}</p>
${code && !nl ? `<p>${esc(S.pendingCodeAlt)}</p>` : ""}${form}
<p>${esc(S.pendingP2)}</p>
${backLink(L, S.back)}` });
}

// Botones de calendario: Google Calendar (enlace con el evento rellenado) y el archivo .ics (Apple, Outlook y los demás).
function calendarButtons(env, L, b) {
  const S = T[L.lang];
  return `<p>${esc(S.calLead)}</p>
<p class="calendar-actions btnrow"><a class="button" href="${esc(googleCalUrl(env, b, localToUtc))}" rel="noopener noreferrer" target="_blank">${esc(S.addGcal)}</a> <a class="button" href="${esc(lk(L, `/ics/${b.token}`))}">${esc(S.addCal)}</a></p>`;
}

// verifyHint: reserva recién hecha y confirmada al momento (se explica que confirmar el correo es opcional).
// verifiedNow: la persona acaba de confirmar su correo.
// instant: reserva recién hecha en modo «al momento» (la página no lleva el código; el correo puede no llevar enlaces o no haber salido).
export function bookedPage(env, L, b, { justConfirmed = false, mailFailed = false, code = "", onList = false, listLater = false, verifyHint = false, verifiedNow = false, instant = false, studyTitle = "" } = {}) {
  const S = T[L.lang];
  const t = b.token;
  const h = justConfirmed ? S.bookedConfirmed : S.bookedReserved;
  const intro = `${verifiedNow ? `<p class="flash" role="status">${esc(S.verifiedDone)}</p>
` : ""}<p class="lede">${esc(S.bookedThanks(b.name))}</p>`;
  const content = `${calendarButtons(env, L, b)}
<p>${S.bookedCancel(esc(lk(L, `/x/${t}`)))}</p>
${code ? `<p class="code-line">${S.codeLine(esc(formatCode(code)))}</p>` : ""}
<p class="note">${relayOn(env) && !mailFailed ? (noLinks(env, b.email) ? (code ? S.bookedKeepCode : instant ? S.bookedKeepNoLink : S.bookedKeep) : S.bookedKeep) : (instant && mailFailed ? S.bookedMailFailed : S.bookedKeepNoMail)}</p>
<p>${esc(S.bookedInstr)}</p>
${verifyHint ? `<div class="message-note"><p>${esc(noLinks(env, b.email) ? S.verifyHintCode : S.verifyHint)}</p></div>` : ""}${onList ? `<p class="note">${S.onList(esc(pp(L, "/baja")))}</p>` : ""}${listLater ? `<p class="note">${esc(mailFailed ? S.listLaterNoMail : S.listLater)}</p>` : ""}`;
  return layout(env, L, { noindex: true, noSwitch: true, title: h, path: "/reservar", main: "confirmation-layout", body: bookingPage(h, intro, bookingCard(L, b, studyTitle), content) });
}

export function confirmPage(env, L, b, state, { k = "", studyTitle = "" } = {}) {
  const S = T[L.lang];
  const t = b.token;
  const card = bookingCard(L, b, studyTitle);
  const opts = { noindex: true, main: "confirmation-layout", path: `/c/${t}` };
  // Reserva ya confirmada, enlace del correo con su código: un botón para confirmar que el correo llega (opcional).
  if (state === "verify")
    return layout(env, L, { ...opts, title: S.verifyH1, body: bookingPage(S.verifyH1, `<p class="lede">${esc(S.verifyP)}</p>`, card, `<form method="post" action="${esc(lk(L, `/c/${t}?k=${encodeURIComponent(k)}`))}"><p><button type="submit" class="big">${esc(S.verifyBtn)}</button></p></form>
${calendarButtons(env, L, b)}
<p>${S.confirmedCancel(esc(lk(L, `/x/${t}`)))}</p>`) });
  if (state === "pending")
    return layout(env, L, { ...opts, title: S.confirmTitle, body: bookingPage(S.confirmH1, "", card, `<form method="post" action="${esc(lk(L, `/c/${t}`))}"><p><button type="submit" class="big">${esc(S.confirmBtn)}</button></p></form>
<p><a href="${esc(lk(L, `/x/${t}`))}">${esc(S.confirmCancel)}</a></p>`) });
  if (state === "confirmed")
    return layout(env, L, { ...opts, title: S.bookedConfirmed, body: bookingPage(S.confirmedH1, "", card, `${calendarButtons(env, L, b)}
<p>${S.confirmedCancel(esc(lk(L, `/x/${t}`)))}</p>`) });
  return gonePage(env, L, S.confirmGone);
}

export function cancelPage(env, L, b, state, { studyTitle = "" } = {}) {
  const S = T[L.lang];
  const t = b.token;
  if (state === "live")
    return layout(env, L, { noindex: true, title: S.cancelTitle, path: `/x/${t}`, main: "confirmation-layout", body: bookingPage(S.cancelH1, `<p class="lede">${esc(S.cancelP)}</p>`, bookingCard(L, b, studyTitle), `<form method="post" action="${esc(lk(L, `/x/${t}`))}"><p><button type="submit" class="danger">${esc(S.cancelBtn)}</button></p></form>
<p><a class="back-link" href="${esc(lk(L, "/"))}">${esc(S.cancelNo)}</a></p>`) });
  return gonePage(env, L, S.cancelGone);
}
export function cancelledDone(env, L, { onList = false } = {}) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, noSwitch: true, title: S.doneTitle, path: "/x", main: "page state-page", body: `${berthSvg("berth state-glyph")}<h1>${esc(S.doneTitle)}</h1><p>${esc(S.doneP)}</p>${onList ? `<p>${S.cancelOnList(esc(pp(L, "/baja")))}</p>` : ""}<p><a class="button" href="${esc(lk(L, "/"))}">${esc(S.doneAgain)}</a></p>` });
}
export function gonePage(env, L, msg) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, title: S.goneTitle, path: "/", main: "page state-page", body: `${berthSvg("berth state-glyph")}<h1>${esc(S.goneH1)}</h1><p>${esc(msg || S.goneDefault)}</p>${backLink(L, S.back)}` });
}
export function messagePage(env, L, title, msg) {
  const S = T[L.lang];
  return layout(env, L, { noindex: true, title, path: "/", main: "page state-page", body: `${berthSvg("berth state-glyph")}<h1>${esc(title)}</h1><p>${esc(msg)}</p>${backLink(L, S.back)}` });
}

// The lines of the list "who can take part" in the terms: vision plus the declarations that are switched on in the configuration.
function termsReqs(S) {
  const d = C.declarations;
  const items = [S.termsVision];
  if (d.epilepsy) items.push(S.termsEpilepsy);
  if (d.vestibular === "always") items.push(S.termsVestibularAlways);
  else if (d.vestibular === "study2" && C.twoStudies) items.push(S.termsVestibularStudy2);
  return items.filter(Boolean).map((t) => `<li>${t}</li>`).join("\n");
}
// What the privacy text says about the declarations ("" when none is asked).
function privacyDecl(S) {
  const d = C.declarations;
  const vest = d.vestibular === "always" ? "Always" : d.vestibular === "study2" && C.twoStudies ? "Study2" : "";
  if (d.epilepsy && vest) return S.privDecl["epiVest" + vest];
  if (d.epilepsy) return S.privDecl.epi;
  return vest ? S.privDecl["vest" + vest] : "";
}
// {home} and {baja} are links; {reqs}, {materials} and {decl} are filled from the texts and the configuration (function
// replacers: a "$" in a text must stay a "$"). {materials} is the sentence termsMaterials with one space in front, or nothing.
const prose = (L, html) => {
  const S = T[L.lang];
  // No requirement at all: the heading "who can take part" and its empty list are left out.
  if (!termsReqs(S)) html = html.replace(/<h2>[^<]*<\/h2>\s*<ul>\s*\{reqs\}\s*<\/ul>\s*/, "");
  return html.replace(/\{home\}/g, () => esc(lk(L, "/"))).replace(/\{baja\}/g, () => esc(pp(L, "/baja")))
    .replace(/\{reqs\}/g, () => termsReqs(S)).replace(/\{materials\}/g, () => (S.termsMaterials.trim() ? " " + S.termsMaterials.trim() : "")).replace(/\{decl\}/g, () => privacyDecl(S));
};
export function termsPage(env, L) {
  const S = T[L.lang];
  // Without the mail relay nobody receives a confirmation e-mail: the sentences that send the person to it are replaced.
  const text = relayOn(env) ? S.terms : S.termsNoMail.reduce((x, [a, b]) => x.replace(a, b), S.terms);
  return layout(env, L, { main: "page prose", title: S.termsTitle, path: "/condiciones", description: S.termsDesc, body: prose(L, text) });
}
// El texto tiene tres frases que dependen de cómo se confirman las reservas (por correo o al momento).
export function privacyPage(env, L, { instant = false } = {}) {
  const S = T[L.lang];
  let text = instant ? S.privacyInstant.reduce((t, [a, b]) => t.replace(a, b), S.privacy) : S.privacy;
  if (!relayOn(env)) text = S.privacyNoMail.reduce((t, [a, b]) => t.replace(a, b), text);
  return layout(env, L, { main: "page prose", title: S.privacyTitle, path: "/privacidad", description: S.privacyDesc, body: prose(L, text) });
}
