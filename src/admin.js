// Panel de administracion. Solo la persona responsable. Sin JavaScript: todo son enlaces y formularios.
import * as D from "./db.js";
import { esc, hmacHex, safeEqual, csvCell, EMAIL_RE, emailKey, randomToken } from "./util.js";
import { signForm, checkForm, makeSession, readSession, sessionCookie, clearCookie, revokeSessions } from "./auth.js";
import { layout, ADMIN_L, studyPreviewHtml } from "./pages.js";
import { LIMITS, FIELD, usesConfigNames, newStudyId, isStudyId, studyFromForm, parseOutside, progressOf, draftStudy, resolveTexts, dataOf, nameTaken, isSeededId, autoPublicState, PUBLIC_STATES, CONSENT_FIELDS, CONSENT_LIMITS, CONSENT_FORM, consentMax, consentFromForm } from "./studies.js";
import { consentDefaults, consentWarnings, consentSheetPage, publicFacts } from "./consent.js";
import { MAIL_DAY_MAX, MAIL_ADMIN_SKIP, relayOn, sendLogged, sendReminders, tplCancelled, tplNoShow, tplConfirmRequest, tplTest, adminEmail, baseUrl, baseUrlSource, invitation, mailLang } from "./mail.js";
import { SHORT_PASSWORD_KEY } from "./env.js";
import { maybeReport } from "./usage.js";
import { berthSvg, PRODUCT_NAME } from "./product.js";
import { C, LANGS, LANG_REGISTRY, normLang } from "./config.js";
import { AT } from "./admin_texts.js";
import {
  addDays, weekday, weekToOpen, prettyDay as prettyDayL, prettyMonth as prettyMonthL, isRealDate, TIME_RE, parseTimes, addMinutes, localToMinutes, slotStarted,
  stampLocal, clockLocal, dayMonth, DAYS_AHEAD, SLOT_MINUTES, SESSION_MINUTES, MIN_NOTICE_HOURS,
  FLEX_NOTICE_MIN, FLEX_DEFAULT_UNTIL, SHORT_NOTICE_MIN, flexStarts, hhmmToMin, minToHhmm, inBreak, breakMinutes,
} from "./slots.js";

// The admin panel is written in one language (C.adminLanguage); every visible word comes from src/admin_texts.js.
const LANG_NAME = AT.langName;
const ADMIN_LANG = C.adminLanguage;
const STATUS = AT.status;
const FLASH = AT.flash;
const ERR = new Set(["has-bookings", "bad-times", "slot-booked", "bad-date", "denied", "no-relay", "already-open", "not-started", "gone", "state", "past-day", "bad-flex", "bad-break", "slot-near", "study-name", "study-target", "study-reqs", "study-gone", "study-archive-active", "consent-perms", "study-name-dup", "study-changed", "study-outside-bad"]);
// Messages that carry data in the URL (name a, address x, error e, counts n, f, w). Always escaped when drawn.
const DYN = AT.dyn;
const EXPIRED = AT.expired;
// Dates are written in the locale of the admin language.
const prettyDay = (d) => prettyDayL(d, ADMIN_LANG);
const prettyMonth = (m) => prettyMonthL(m, ADMIN_LANG);
const page = (env, body, title = AT.title) => layout(env, ADMIN_L, { title, path: "/admin", noindex: true, body, admin: true, css: ["/admin.css"] });
// The word-mark of the product: the berth glyph and "approdo." (the lab's own name sits beside it, never replaced by it).
const wordmark = (href = "/admin") => `<a class="brand" href="${esc(href)}" aria-label="${esc(PRODUCT_NAME)}">${berthSvg("brand-mark")}<span>${esc(PRODUCT_NAME.toLowerCase())}<span class="brand-dot">.</span></span></a>`;
// A short page without the sidebar (login, errors): the word-mark, then the content in a card.
const plainPage = (env, inner, title) => page(env, `<div class="login-page"><main id="main" class="login-card">${wordmark()}
${inner}</main></div>`, title);
const html = (b, status = 200, headers = {}) => new Response(b, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
const redirect = (loc, headers = {}) => new Response(null, { status: 303, headers: { location: loc, "cache-control": "no-store", ...headers } });
// Parametros extra de una redireccion, codificados.
const qp = (o) => Object.entries(o).map(([k, v]) => `&${k}=${encodeURIComponent(String(v ?? "").slice(0, 160))}`).join("");

const badRequest = (env, status = 400) => html(plainPage(env, `<h1>${esc(AT.badRequestTitle)}</h1><p>${esc(AT.badRequestText)}</p>`), status);
// The form of a request, or null when the body is not a form (a request that is not one answers 400, never 500).
const formOf = async (request) => { try { return await request.formData(); } catch { return null; } };

function loginPage(env, token, msg) {
  return plainPage(env, `<h1>${esc(AT.title)}</h1><p class="lab-name">${esc(C.brand)}</p>${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ""}
<form method="post" action="/admin/login">
<p class="field"><label for="pw">${esc(AT.login.password)}</label><input id="pw" name="password" type="password" required autocomplete="current-password"></p>
<input type="hidden" name="t" value="${esc(token)}">
<p><button type="submit" class="big">${esc(AT.login.enter)}</button></p></form>`);
}

export async function handleAdmin(request, env, c) {
  const { db, nowMs } = c;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  // No password, or one shorter than minAdminPasswordLength (requestEnv removed it): the panel stays closed, and says why.
  if (!env.ADMIN_PASSWORD) return html(plainPage(env, `<h1>${esc(AT.login.disabledTitle)}</h1><p>${esc(env[SHORT_PASSWORD_KEY] ? AT.login.tooShortText(C.minAdminPasswordLength) : AT.login.disabledText)}</p>`), 503);

  const session = await readSession(db, env, request, nowMs);

  if (path === "/admin/login" && request.method === "POST") {
    const f = await formOf(request);
    if (!f) return badRequest(env);
    const k = await c.ipKey(request);
    // El intento se anota ANTES de mirar la contraseña: ráfagas en paralelo ya se ven unas a otras.
    await D.addHit(db, "login_attempts", k, nowMs);
    const fails = await D.countSince(db, "login_attempts", k, nowMs - 15 * 60_000);
    if (fails > 5) {
      await D.dropHit(db, "login_attempts", k, nowMs); // el bloqueo no se alarga por seguir insistiendo
      return html(loginPage(env, await signForm(db, nowMs, "login"), AT.login.tooMany), 429);
    }
    const given = String(f.get("password") || "");
    const key = await D.getKey(db);
    const ok = safeEqual(await hmacHex(key, "pw:" + given), await hmacHex(key, "pw:" + env.ADMIN_PASSWORD));
    const formOk = (await checkForm(db, f.get("t"), nowMs, "login", { minMs: 0 })) === "ok";
    if (ok && !formOk) {
      // Contraseña buena con un formulario viejo: no es un intento fallido.
      await D.dropHit(db, "login_attempts", k, nowMs);
      return html(loginPage(env, await signForm(db, nowMs, "login"), AT.login.formExpired), 401);
    }
    if (!ok) {
      return html(loginPage(env, await signForm(db, nowMs, "login"), AT.login.wrong), 401);
    }
    await D.dropHit(db, "login_attempts", k, nowMs); // entrar bien no gasta uno de los cinco intentos
    return redirect("/admin", { "set-cookie": sessionCookie(await makeSession(db, env, nowMs)) });
  }

  if (!session) {
    if (request.method !== "GET") {
      if (path === "/admin/logout") return redirect("/admin");
      return html(loginPage(env, await signForm(db, nowMs, "login"), EXPIRED), 401);
    }
    if (path !== "/admin") return redirect("/admin");
    return html(loginPage(env, await signForm(db, nowMs, "login")));
  }

  if (path === "/admin/csv" && request.method === "GET") {
    const rows = await D.bookingsBetween(db, "0000-01-01", "9999-12-31");
    const head = AT.csv.bookingsHead;
    // The column "study": 1 or 2 while the studies are the ones of the configuration, the study's own name once they come from the panel.
    const reg = await D.getRegistry(db);
    const legacy = !reg.table || usesConfigNames(reg);
    const studyCell = (id) => (legacy ? (id === "study2" ? "2" : "1") : (reg.studies.find((x) => x.id === id) || { name: id }).name);
    const line = (r) => [r.name, r.email, studyCell(r.study), r.date, r.time, STATUS[r.status] || r.status, normLang(r.lang), r.reminded ? AT.yes : AT.no, r.verified_at ? AT.yes : AT.no].map(csvCell).join(",");
    const body = "﻿" + head + "\r\n" + rows.map(line).join("\r\n") + "\r\n";
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${AT.csv.bookingsFile}-${c.today}.csv"`, "cache-control": "no-store" } });
  }

  if (path === "/admin/csv-resumen" && request.method === "GET") {
    // Counts per study and ISO week, no names and no e-mail addresses. Study names are typed by the researcher: csvCell protects against formulas.
    const lines = [];
    for (const st of await summaryData(db, c)) {
      for (const w of st.weeks) lines.push([st.name, st.id, w.week, w.booked, w.attended, w.absent, w.cancelled, w.unmarked, ""]);
      lines.push([st.name, st.id, AT.data.totalLabel, st.total.booked, st.total.attended, st.total.absent, st.total.cancelled, st.total.unmarked, st.target]);
    }
    const body = "\ufeff" + AT.csv.summaryHead + "\r\n" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${AT.csv.summaryFile}-${c.today}.csv"`, "cache-control": "no-store" } });
  }

  if (path === "/admin/csv-contactos" && request.method === "GET") {
    const list = (await D.contactsConfirmed(db, c.now.toISOString())) || [];
    const head = AT.csv.contactsHead;
    const line = (r) => [r.email, normLang(r.lang), r.consent_at, r.expires_at].map(csvCell).join(",");
    const body = "\ufeff" + head + "\r\n" + list.map(line).join("\r\n") + "\r\n";
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${AT.csv.contactsFile}-${c.today}.csv"`, "cache-control": "no-store" } });
  }

  if (path === "/admin/consent" && request.method === "GET") {
    // The printable consent sheet of one study in one language. Both come from the query and are checked against what exists.
    const qs = new URL(request.url).searchParams;
    const study = qs.get("study"), lang = qs.get("lang");
    const view = isStudyId(study) ? (await D.getRegistry(db)).studies.find((x) => x.id === study) : null;
    if (!view || !LANGS.includes(lang)) return html(plainPage(env, `<h1>${esc(AT.notFound)}</h1>`), 404);
    return html(consentSheetPage(lang, view, `/admin?s=studies&st=${view.id}&c=consent#consent-edit`, c.today));
  }

  if (request.method === "POST") {
    const f = await formOf(request);
    if (!f) return badRequest(env);
    if (!safeEqual(String(f.get("csrf") || ""), session.csrf)) return badRequest(env, 403);
    if (path === "/admin/logout") {
      await revokeSessions(db); // la cookie copiada también deja de valer en el servidor
      return redirect("/admin", { "set-cookie": clearCookie() });
    }
    if (path === "/admin/do") {
      const r = await doAction(env, c, String(f.get("do") || ""), f, session);
      return typeof r === "string" ? redirect(await flashify(db, r, nowMs)) : r;
    }
    return redirect("/admin");
  }

  if (path === "/admin" && request.method === "GET") {
    const page = html(await dashboard(env, c, session, new URL(request.url).searchParams));
    await maybeReport(c); // the anonymous usage count: at most once a day, after the page is ready, never able to fail it (src/usage.js)
    return page;
  }
  return html(plainPage(env, `<h1>${esc(AT.notFound)}</h1>`), 404);
}

// Nombre, correo y error de un mensaje no viajan en la URL: se guardan un momento en el servidor y se leen una sola vez.
async function flashify(db, loc, nowMs) {
  const u = new URL(loc, "https://x.invalid");
  const data = {};
  for (const k of ["a", "x", "e"]) if (u.searchParams.has(k)) { data[k] = u.searchParams.get(k); u.searchParams.delete(k); }
  if (!Object.keys(data).length) return loc;
  const id = `${String(nowMs).padStart(15, "0")}:${randomToken(12)}`;
  await D.setSetting(db, `flash:${id}`, JSON.stringify(data));
  u.searchParams.set("k", id);
  return u.pathname + u.search + u.hash;
}
async function takeFlash(db, id) {
  if (!/^\d{15}:[A-Za-z0-9_-]{16}$/.test(id || "")) return {};
  const v = await D.getSetting(db, `flash:${id}`);
  if (v === null) return {};
  await D.deleteSetting(db, `flash:${id}`);
  try { const o = JSON.parse(v); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
const ctxOf = (f) => {
  const day = String(f.get("day") || "");
  return isRealDate(day) ? day : "";
};
// Mensaje opcional para la persona: texto plano, 500 caracteres como maximo.
const noteOf = (f, id) => String(f.get("note_" + id) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 500);

// Devuelve la direccion a la que redirigir, o una Response (la preparacion de invitaciones responde con la propia pagina).
async function doAction(env, c, action, f, session) {
  const { db, today, nowMs } = c;
  const i = action.indexOf(":");
  const verb = i < 0 ? action : action.slice(0, i);
  const arg = i < 0 ? "" : action.slice(i + 1);
  const horizon = addDays(today, DAYS_AHEAD);
  const ctxDay = ctxOf(f);
  // Back to the section the form came from (no "s" in the form: the agenda, as ever), the chosen day, and a message.
  const hasS = f.get("s") !== null && f.get("s") !== undefined;
  const sec = sectionOf(String(f.get("s") ?? ""));
  const back = (m, d, extra = "") => `/admin?m=${m}${sq(sec)}${d || ctxDay ? `&day=${d || ctxDay}` : ""}${extra}`;
  const nowIso = c.now.toISOString();
  const liveOn = async (date) => (await D.bookingsBetween(db, date, date)).filter((x) => x.status === "pending" || x.status === "confirmed");
  const who = (b) => qp({ a: b.name, x: b.email });

  if (verb === "confirm-mode") {
    if (arg !== "instant" && arg !== "email") return back("denied");
    await D.setSetting(db, "confirm_mode", arg);
    return back(`confirm-${arg}`);
  }
  if (verb === "study") {
    // Make a study the active one. While the studies are the ones of the configuration that is study1 or study2 (and only with
    // twoStudies); once they come from the panel it is any study that is not archived.
    const reg = await D.getRegistry(db);
    if (reg.table ? !isStudyId(arg) || !reg.studies.some((x) => x.id === arg && !x.archived) : !C.twoStudies || (arg !== "study1" && arg !== "study2")) return back("denied");
    await D.setSetting(db, "active_study", arg);
    return back("study", "", reg.table ? `&st=${arg}` : "");
  }
  if (verb === "consent-save") return consentAction(env, c, session, arg, f, nowIso, back, hasS ? sec : "studies");
  if (verb === "study-save" || verb === "study-save-activate" || verb === "study-new" || verb === "study-archive" || verb === "study-restore" || verb === "study-outside" || verb === "study-outside-plus") return studyAction(env, c, session, verb, arg, f, nowIso, back, hasS ? sec : "studies");
  if (verb === "day" || verb === "open" || verb === "close") {
    if (!isRealDate(arg) || arg < today || arg > horizon) return back("bad-date");
    const isOpen = (await D.openDays(db, arg, arg)).length > 0;
    const wantOpen = verb === "open" ? true : verb === "close" ? false : !isOpen;
    if (wantOpen) {
      if (isOpen) return back("already-open", arg);
      await D.openDay(db, arg, await D.getDefaultTimes(db));
      return back("open", arg);
    }
    if ((await liveOn(arg)).length) return back("has-bookings", arg);
    await D.closeDay(db, arg);
    return back("closed", arg);
  }
  if (verb === "week" || verb === "weeks") {
    // Lunes a viernes de la semana del día indicado (y de las siguientes, con "weeks"), con las horas por defecto.
    // Solo abre días cerrados, desde hoy y dentro del horizonte (DAYS_AHEAD).
    if (!isRealDate(arg)) return back("bad-date");
    const weeks = verb === "weeks" && [1, 2, 4, 8].includes(Number(f.get("weeks"))) ? Number(f.get("weeks")) : 1;
    // "This week" is the week of the day shown; on a Saturday or a Sunday it is the coming one.
    const monday = weekToOpen(arg);
    const times = await D.getDefaultTimes(db);
    const alreadyOpen = new Set(await D.openDays(db, monday, addDays(monday, 7 * weeks - 1)));
    let n = 0;
    for (let w = 0; w < weeks; w++) {
      for (let k = 0; k < 5; k++) {
        const d = addDays(monday, w * 7 + k);
        if (d < today || d > horizon || alreadyOpen.has(d)) continue;
        await D.openDay(db, d, times);
        n++;
      }
    }
    return verb === "week" ? back("week", arg, qp({ n })) : back("weeks", arg, qp({ n, w: weeks }));
  }
  if (verb === "slot") {
    const [date, time] = arg.split("T");
    if (!isRealDate(date) || !TIME_RE.test(time || "")) return back("bad-date");
    if (await D.isSlotOpen(db, date, time)) {
      if (await D.liveBookingForSlot(db, date, time)) return back("slot-booked", date);
      await D.removeSlot(db, date, time);
    } else {
      if (!(await D.openDays(db, date, date)).length) return back("denied");
      // Dos franjas a menos de SLOT_MINUTES se pisarían: al reservar una, la otra dejaría de caber.
      const t0 = hhmmToMin(time);
      if ((await D.slotsBetween(db, date, date)).some((s) => Math.abs(hhmmToMin(s.time) - t0) < SLOT_MINUTES)) return back("slot-near", date);
      await D.addSlot(db, date, time);
    }
    return back("slot", date);
  }
  if (verb === "notice-off" || verb === "notice-on") {
    // Excepción a las 12 h de antelación, día a día: solo de hoy en adelante y dentro del horizonte.
    if (!isRealDate(arg) || arg < today || arg > horizon) return back("bad-date");
    if (verb === "notice-off") await D.setNoNotice(db, arg);
    else await D.clearNoNotice(db, arg);
    return back(verb, arg);
  }
  if (verb === "flex-on") {
    // "Disponible hoy": solo el día de hoy. Dos horas HH:MM con desde < hasta.
    const from = String(f.get("flex_from") || "").trim(), until = String(f.get("flex_until") || "").trim();
    if (!TIME_RE.test(from) || !TIME_RE.test(until) || from >= until) return back("bad-flex");
    await D.setFlex(db, today, from, until);
    return back("flex-on", today);
  }
  if (verb === "flex-off") {
    await D.clearFlex(db, today);
    return back("flex-off", today);
  }
  if (verb === "break-on") {
    // The daily break, for every day. Two HH:MM times with from < until, validated like the flex window.
    const from = String(f.get("break_from") || "").trim(), until = String(f.get("break_until") || "").trim();
    if (!TIME_RE.test(from) || !TIME_RE.test(until) || from >= until) return back("bad-break");
    await D.setBreak(db, from, until);
    return back("break-on");
  }
  if (verb === "break-off") {
    await D.clearBreak(db);
    return back("break-off");
  }
  if (verb === "times") {
    const list = parseTimes(f.get("times"));
    if (!list) return back("bad-times");
    await D.setSetting(db, "slot_times", JSON.stringify(list));
    return back("times");
  }
  if (verb === "cancel" || verb === "attended" || verb === "noshow") {
    const b = await D.bookingById(db, arg);
    if (!b) return back("gone");
    if (verb === "cancel") {
      if (b.date < today) return back("past-day", b.date);
      if (!(await D.setStatus(db, b.id, "cancelled", ["pending", "confirmed"]))) return back("state", b.date);
      // El aviso al administrador no se manda: la cancelacion la hace el propio investigador.
      if (!relayOn(env)) return back("cancel-off", b.date, who(b));
      const res = await sendLogged(env, c, b.id, "cancelled", { to: b.email, ...tplCancelled(env, b, noteOf(f, b.id)) });
      return res.ok ? back("cancel-ok", b.date, who(b)) : back("cancel-fail", b.date, who(b) + qp({ e: res.error }));
    }
    if (!slotStarted(b.date, b.time, today, c.nowTime)) return back("not-started", b.date);
    const to = verb === "attended" ? "attended" : "noshow";
    if (!(await D.setStatus(db, b.id, to, ["confirmed", "attended", "noshow"]))) return back("state", b.date);
    // Quien pidió los avisos de futuros estudios al reservar entra en la lista el día que viene (reservas confirmadas al momento).
    if (to === "attended") await D.contactConfirm(db, b.id, c.now.toISOString());
    return back("marked", b.date);
  }
  if (verb === "rebook") {
    // A quien no vino se le puede proponer, una vez y a mano, elegir otro turno.
    const b = await D.bookingById(db, arg);
    if (!b) return back("gone");
    if (b.status !== "noshow") return back("state", b.date);
    if (!relayOn(env)) return back("no-relay", b.date);
    const res = await sendLogged(env, c, b.id, "noshow", { to: b.email, ...tplNoShow(env, b, noteOf(f, b.id)) });
    return res.ok ? back("rebook", b.date, qp({ a: b.name })) : back("mail-fail", b.date, who(b) + qp({ e: res.error }));
  }
  if (verb === "resend") {
    // Reenvia el correo de confirmacion de una reserva pendiente. No alarga el plazo.
    const b = await D.bookingById(db, arg);
    if (!b) return back("gone");
    if (b.status !== "pending" || !b.expires_at || b.expires_at < c.now.toISOString()) return back("state", b.date);
    if (!relayOn(env)) return back("no-relay", b.date);
    const res = await sendLogged(env, c, b.id, "confirm_request", { to: b.email, ...tplConfirmRequest(env, b, { code: await D.bookingCode(c.db, b) }) });
    return res.ok ? back("resend", b.date, qp({ a: b.name })) : back("mail-fail", b.date, who(b) + qp({ e: res.error }));
  }
  if (verb === "remind") {
    if (!relayOn(env)) return back("no-relay");
    const r = await sendReminders(env, c);
    if (!r.total) return back("reminders-none");
    return back("reminders", "", qp({ n: r.sent, f: r.failed }));
  }
  if (verb === "testmail") {
    if (!relayOn(env)) return back("no-relay");
    const to = adminEmail(env);
    const res = await sendLogged(env, c, "test", "test", { to, ...tplTest(env) });
    return res.ok ? back("testmail", "", qp({ x: to })) : back("testmail-fail", "", qp({ e: res.error }));
  }
  if (verb === "invite") {
    // Prepara la invitacion: no guarda las direcciones y no envia nada. Responde con la propia pagina.
    const result = await prepareInvite(env, c, f);
    const qs = new URLSearchParams({ m: "invite", ...(ctxDay ? { day: ctxDay } : {}) });
    // Answers with the page itself: the section the form came from, or everything when the form names none.
    return html(await dashboard(env, c, session, qs, { invite: result, s: hasS ? sec : "all" }));
  }
  if (verb === "invite-contacts") {
    // Prepara la invitacion para los contactos de avisos, un texto por idioma. No envia nada ni guarda direcciones.
    const list = (await D.contactsConfirmed(db, c.now.toISOString())) || [];
    const results = [];
    for (const lang of LANGS) {
      const mine = list.filter((r) => normLang(r.lang) === lang).map((r) => r.email);
      if (mine.length) results.push(await prepareInvite(env, c, new Map([["invlang", lang], ["addresses", mine.join("\n")]]), { unsub: true }));
    }
    const qs = new URLSearchParams({ m: "invite", ...(ctxDay ? { day: ctxDay } : {}) });
    return html(await dashboard(env, c, session, qs, { inviteContacts: results, s: hasS ? sec : "all" }));
  }
  if (verb === "contact-remove") {
    return back(await D.contactRemove(db, arg) ? "contact-removed" : "contact-gone", "", "#contactos");
  }
  return back("denied");
}

// ---- estudios: guardar, crear, archivar ---------------------------------------------------------
// The first of these actions (the "studies" table is still empty) writes every study of the configuration to the table, with empty
// texts (the page keeps showing the configuration's), and then does what was asked. A refused edit writes nothing, not even that copy.
async function ensureTable(db) {
  let reg = await D.getRegistry(db);
  if (!reg.table) { await D.seedConfigStudies(db); reg = await D.getRegistry(db); }
  return reg;
}
// The name of a new draft: "Estudio sin título N" with the smallest N that no study uses.
function draftName(reg) {
  const taken = new Set(reg.studies.map((x) => String(x.name).toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(AT.studies.newName(n).toLowerCase())) return AT.studies.newName(n);
}
// The language of the preview that was open, kept across the save (a language of the site, or nothing).
const plQs = (f) => (LANGS.includes(String(f.get("pl") ?? "")) ? `&pl=${f.get("pl")}` : "");
const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// What a refused study form says: the message for the field (by the name of its form field) and the one for the top of the page.
function studyRefusal(r) {
  const R = AT.refuse;
  const [name, lang] = String(r.field).split(":");
  const label = cap1(AT.studies.fieldLabel[name] || name);
  const where = lang ? R.where(label, LANG_NAME[lang]) : label;
  let msg;
  if (r.error === "name") msg = R.name;
  else if (r.error === "name-dup") msg = R.nameDup;
  else if (r.error === "target") msg = R.target;
  else if (r.error === "outside") msg = R.outside;
  else if (r.error === "reqs") msg = R.tooMany(LIMITS.reqs, LIMITS.req);
  else msg = R.tooLong(LIMITS[name === "reqs" ? "req" : name]);
  return { errors: { [lang ? FIELD(name, lang) : name]: msg }, alert: `${where}: ${msg} ${R.kept}` };
}
function consentRefusal(r) {
  const R = AT.refuse;
  const [name, lang] = String(r.field).split(":");
  const label = name === "perms" ? AT.consent.fPerms : AT.consent.fields[name];
  const msg = r.error === "perms" ? R.tooMany(CONSENT_LIMITS.perms, CONSENT_LIMITS.perm) : R.tooLong(name === "perms" ? CONSENT_LIMITS.perm : consentMax(name));
  return { errors: { [CONSENT_FORM(name, lang)]: msg }, alert: `${R.where(cap1(label), LANG_NAME[lang])}: ${msg} ${R.kept}` };
}
// A refused save answers 200 with the page of the same form, filled with what was typed, the error next to the field and an alert at the top.
async function refusedPage(env, c, session, refused, sec) {
  const qs = new URLSearchParams({ s: sec, st: refused.id, ...(refused.kind === "consent" ? { c: "consent" } : {}) });
  const pl = String(refused.f.get("pl") ?? "");
  if (LANGS.includes(pl)) qs.set("pl", pl);
  return html(await dashboard(env, c, session, qs, { s: sec, refused }));
}

// Where a quick-form save goes back to: the block it came from (ids are per place, the agenda and the list can be on one page), and the
// study that was selected in the list.
function ctxAnchor(f, id) {
  const at = String(f.get("at") ?? "");
  const sel = String(f.get("sel") ?? "");
  return { hash: `#${at === "st" ? "st-out" : "ag-out"}-${id}`, st: at === "st" && isStudyId(sel) ? `&st=${sel}` : "", qs: at === "st" ? plQs(f) : "" };
}

async function studyAction(env, c, session, verb, arg, f, nowIso, back, sec) {
  const { db } = c;
  if (verb === "study-new") {
    const reg = await ensureTable(db);
    const name = draftName(reg);
    for (let i = 0; i < 3; i++) {
      const id = newStudyId();
      try { await D.insertStudy(db, id, draftStudy(name), nowIso); return back("study-new", "", `&st=${id}${plQs(f)}#studies-edit`); } catch (e) { if (!/UNIQUE|constraint/i.test(String((e && e.message) || e))) throw e; }
    }
    return back("denied");
  }
  const reg0 = await D.getRegistry(db);
  const cur0 = isStudyId(arg) ? reg0.studies.find((x) => x.id === arg) : null;
  if (!cur0) return back("study-gone");
  const st = `&st=${arg}${plQs(f)}`;
  // Every write below compares the stored JSON with the one this request read (cur0.raw): if somebody changed it in the meantime
  // nothing is written. A save answers with its own form, filled with what was typed; the other actions redirect with a message.
  const lost = async () => ((await D.studyExists(db, arg)) ? null : back("study-gone"));
  if (verb === "study-save" || verb === "study-save-activate") {
    const r = studyFromForm(f, cur0, reg0);
    if (r.error) { const x = studyRefusal(r); return refusedPage(env, c, session, { kind: "study", id: arg, f, ...x }, sec); }
    await ensureTable(db);
    if (!(await D.updateStudy(db, arg, r.data, nowIso, cur0.raw))) return (await lost()) || refusedPage(env, c, session, { kind: "study", id: arg, f, errors: {}, alert: AT.refuse.changed }, sec);
    if (verb === "study-save-activate" && !cur0.archived) {
      await D.setSetting(db, "active_study", arg);
      return back("study-saved-active", "", `${st}#studies-edit`);
    }
    return back("study-saved", "", `${st}#studies-edit`);
  }
  if (verb === "study-outside" || verb === "study-outside-plus") {
    // The quick form of the progress block. Only for studies saved from the panel (the others have no such block). The page it came
    // from carries the change date of the study it showed ("rev"): if the study changed since, nothing is written.
    const to = ctxAnchor(f, arg);
    const keep = `${to.st}${to.qs}`;
    if (!reg0.table) return back("denied");
    let n;
    if (verb === "study-outside-plus") n = Math.min(LIMITS.outside, (cur0.outside || 0) + 1);
    else {
      n = parseOutside(f.get("outside"));
      if (n === null) return back("study-outside-bad", "", `${keep}${to.hash}`);
    }
    if (String(f.get("rev") ?? "") !== String(cur0.updatedAt)) return back("study-changed", "", `${keep}${to.hash}`);
    if (!(await D.updateStudy(db, arg, dataOf(cur0, { outside: n }), nowIso, cur0.raw))) return (await lost()) || back("study-changed", "", `${keep}${to.hash}`);
    return back("study-outside", "", `${keep}${to.hash}`);
  }
  if (verb === "study-archive") {
    if (arg === reg0.active) return back("study-archive-active", "", st);
    await ensureTable(db);
    if (!(await D.updateStudy(db, arg, dataOf(cur0, { archived: true }), nowIso, cur0.raw))) return (await lost()) || back("study-changed", "", st);
    return back("study-archived", "", st);
  }
  // study-restore: it becomes a listed study again, so its name must not be one of another study that is not archived
  if (nameTaken(reg0, arg, String(cur0.name).toLowerCase())) return back("study-name-dup", "", st);
  await ensureTable(db);
  if (!(await D.updateStudy(db, arg, dataOf(cur0, { archived: false }), nowIso, cur0.raw))) return (await lost()) || back("study-changed", "", st);
  return back("study-restored", "", st);
}

// The consent form of a study (its own sub-view). A refused edit writes nothing, not even the copy of the configured studies.
async function consentAction(env, c, session, arg, f, nowIso, back, sec) {
  const { db } = c;
  const reg0 = await D.getRegistry(db);
  const cur0 = isStudyId(arg) ? reg0.studies.find((x) => x.id === arg) : null;
  if (!cur0) return back("study-gone");
  const st = `&st=${arg}&c=consent`;
  const r = consentFromForm(f, (l) => consentDefaults(l, cur0));
  if (r.error) { const x = consentRefusal(r); return refusedPage(env, c, session, { kind: "consent", id: arg, f, ...x }, sec); }
  await ensureTable(db);
  if (!(await D.updateStudy(db, arg, dataOf(cur0, { consent: r.consent }), nowIso, cur0.raw))) {
    return (await D.studyExists(db, arg)) ? refusedPage(env, c, session, { kind: "consent", id: arg, f, errors: {}, alert: AT.refuse.consentChanged }, sec) : back("study-gone");
  }
  return back("consent-saved", "", `${st}#consent-edit`);
}

// ---- invitaciones ----------------------------------------------------------
const encAddr = (e) => encodeURIComponent(e).replace(/%40/g, "@");
// Un valor es texto (se codifica entero) o una lista de direcciones (cada una se codifica y se unen con comas).
const mailtoUrl = (to, params) => `mailto:${Array.isArray(to) ? to.map(encAddr).join(",") : to ? encAddr(to) : ""}?${params.map(([k, v]) => `${k}=${Array.isArray(v) ? v.map(encAddr).join(",") : encodeURIComponent(v)}`).join("&")}`;
const BLOCK = 40;

async function prepareInvite(env, c, f, { unsub = false } = {}) {
  const lang = normLang(f.get("invlang"));
  const raw = String(f.get("addresses") || "").slice(0, 50_000);
  const live = await D.liveEmailKeys(c.db);
  const seen = new Set();
  const valid = [], invalid = [], withBooking = [];
  let repeated = 0;
  for (const t of raw.split(/[\s,;]+/).map((x) => x.replace(/^[<"']+|[>"']+$/g, "")).filter(Boolean)) {
    if (t.length > 120 || !EMAIL_RE.test(t)) { invalid.push(t); continue; }
    const key = emailKey(t);
    if (seen.has(key)) { repeated++; continue; }
    seen.add(key);
    if (live.has(key)) withBooking.push(t);
    else valid.push(t);
  }
  const inv = invitation(env, lang, { unsub });
  const links = [];
  for (let i = 0; i < valid.length; i += BLOCK) {
    const part = valid.slice(i, i + BLOCK);
    links.push({ from: i + 1, to: i + part.length, href: mailtoUrl("", [["bcc", part], ["subject", inv.subject], ["body", inv.body.replace(/\n/g, "\r\n")]]) });
  }
  return { raw, lang, valid, repeated, invalid, withBooking, inv, links, unsub };
}

const plainList = (xs) => (xs.length ? `<ul class="plain-list">${xs.slice(0, 60).map((x) => `<li>${esc(x)}</li>`).join("")}${xs.length > 60 ? `<li>${esc(AT.andMore(xs.length - 60))}</li>` : ""}</ul>` : "");
// Resultado de preparar una invitacion. suffix distingue los bloques cuando hay varios en la pagina.
function inviteResult(r, suffix = "", title = AT.invite.resultTitle) {
  const list = plainList;
  return `<div class="invite-result" id="invitacion${suffix}"><h3>${esc(title)}</h3>
<ul class="counts"><li>${esc(AT.invite.valid)}<strong>${r.valid.length}</strong></li>
<li>${esc(AT.invite.repeated)}<strong>${r.repeated}</strong></li>
<li>${esc(AT.invite.invalid)}<strong>${r.invalid.length}</strong>${list(r.invalid)}</li>
<li>${esc(AT.invite.withBooking)}<strong>${r.withBooking.length}</strong>${list(r.withBooking)}</li></ul>
<p class="note">${esc(AT.invite.note)}</p>
<p class="field"><label for="inv-subject${suffix}">${esc(AT.invite.subject)}</label><input id="inv-subject${suffix}" type="text" readonly value="${esc(r.inv.subject)}"></p>
<p class="field"><label for="inv-body${suffix}">${esc(AT.invite.body)}</label><textarea id="inv-body${suffix}" readonly rows="12">${esc(r.inv.body)}</textarea></p>
${r.links.length ? `<p class="btnrow">${r.links.map((l) => `<a class="btn-link" href="${esc(l.href)}">${esc(AT.invite.openIn(l.from, l.to))}</a>`).join("")}</p>` : `<p class="note">${esc(AT.invite.noValid)}</p>`}</div>`;
}

function inviteBlock(csrf, view, r) {
  const result = r ? inviteResult(r) : "";
  return `<details class="surface settings" id="invitar"${r || view.s === "contacts" ? " open" : ""}><summary>${esc(AT.invite.summary)}</summary>
<div class="set-body"><form method="post" action="/admin/do">${hid(csrf, view)}
<p class="note">${esc(AT.invite.intro)}</p>
<p class="field"><label for="inv-addr">${esc(AT.invite.addresses)}</label><textarea id="inv-addr" name="addresses" rows="5">${esc(r ? r.raw : "")}</textarea></p>
<p class="field"><label for="inv-lang">${esc(AT.invite.language)}</label><select id="inv-lang" name="invlang">${LANGS.map((l) => `<option value="${l}"${r && r.lang === l ? " selected" : ""}>${LANG_REGISTRY[l].label}</option>`).join("")}</select></p>
<p><button name="do" value="invite" class="plain">${esc(AT.invite.prepare)}</button></p></form>
${result}</div></details>`;
}

// ---- contactos para futuros estudios ---------------------------------------------------------
const dateOnly = (iso) => String(iso || "").slice(0, 10);
function contactsBlock(csrf, view, list, results) {
  if (list === null) return `<details class="surface settings" id="contactos"><summary>${esc(AT.contacts.summary)}</summary><div class="set-body"><p class="note">${esc(AT.contacts.noTable)}</p></div></details>`;
  const n = (lang) => list.filter((r) => normLang(r.lang) === lang).length;
  const shown = list.slice(0, 300);
  const rows = shown.map((r) => `<li class="now-row"><span class="addr">${esc(r.email)}</span> ${AT.contacts.metaHtml(esc(LANG_NAME[normLang(r.lang)]), esc(dateOnly(r.expires_at)))} <button name="do" value="contact-remove:${esc(r.email_key)}" class="plain">${esc(AT.contacts.remove)}</button></li>`).join("");
  const res = (results || []).map((r) => inviteResult(r, `-${r.lang}`, AT.contacts.invitationTo(LANG_NAME[r.lang]))).join("");
  return `<details class="surface settings" id="contactos"${results || view.s === "contacts" ? " open" : ""}><summary>${esc(AT.contacts.summary)}</summary>
<div class="set-body"><form method="post" action="/admin/do">${hid(csrf, view)}
<p class="note">${esc(AT.contacts.intro)}</p>
<ul class="counts"><li>${esc(AT.contacts.confirmed)}<strong>${list.length}</strong></li>${LANGS.map((l) => `<li>${esc(AT.contacts.inLang(LANG_NAME[l]))}<strong>${n(l)}</strong></li>`).join("")}</ul>
<p class="btnrow"><button name="do" value="invite-contacts" class="plain"${list.length ? "" : " disabled"}>${esc(AT.contacts.prepare)}</button>
<a class="btn-link" href="/admin/csv-contactos">${esc(AT.contacts.exportCsv)}</a></p>
<p class="note">${esc(AT.contacts.note2)}</p>
${res}
<details class="confirm"><summary>${esc(AT.contacts.seeList(list.length))}</summary><div class="confirm-box">${rows ? `<ul class="now-list">${rows}</ul>${list.length > shown.length ? `<p class="note">${esc(AT.contacts.shown(shown.length))}</p>` : ""}` : `<p class="note">${esc(AT.contacts.empty)}</p>`}</div></details>
</form></div></details>`;
}

// ---- vista ------------------------------------------------------------------
// The sections of the panel, chosen with ?s= ("all" shows every one of them on one page). Every form carries the section it is in.
const SECTIONS = ["agenda", "studies", "contacts", "data", "settings"];
export const sectionOf = (v) => (v === "all" || SECTIONS.includes(v) ? v : "agenda");
const sq = (sec) => (sec && sec !== "agenda" ? `&s=${sec}` : "");
const hid = (csrf, view) => `<input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="day" value="${esc(view.day)}">${view.s && view.s !== "agenda" ? `<input type="hidden" name="s" value="${esc(view.s)}">` : ""}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const range = (t) => `${t}–${addMinutes(t, SESSION_MINUTES)}`;
const LIVE = new Set(["pending", "confirmed", "attended", "noshow"]);
const STATUS_LABEL = AT.statusLabel;
const WEEKDAYS = AT.weekdays;

// Enlaces mailto: cada valor se codifica con encodeURIComponent y despues se escapa para el HTML.
// The message to a person is written in that person's language; the e-mail templates do not cover every language yet,
// so Italian is handled here and the others follow mailLang.
const subjLang = (l) => (normLang(l) === "it" ? "it" : mailLang(l));
const subjectFor = (b) => AT.subjectOne[subjLang(b.lang)](dayMonth(b.date), b.time);
const writeLink = (b) => `<a class="lnk" href="${esc(mailtoUrl(b.email, [["subject", subjectFor(b)]]))}">${esc(AT.write)}</a>`;
const writeAll = (list, dm) => {
  const langs = ["es", "en", "it"].filter((l) => list.some((b) => subjLang(b.lang) === l));
  const subject = langs.length > 1 ? `${langs.map((l) => AT.subjectName[l]).join(" / ")}: ${dm}` : AT.subjectAll[langs[0]](dm);
  return `<a class="lnk" href="${esc(mailtoUrl("", [["bcc", [...new Set(list.map((b) => b.email))]], ["subject", subject]]))}">${esc(AT.writeAll)}</a>`;
};
const KIND_LABEL = AT.mailKinds;
function mailLine(rows) {
  const parts = (rows || []).filter((r) => KIND_LABEL[r.kind]).map((r) => {
    const [label, sent] = KIND_LABEL[r.kind];
    return AT.mailLogItem(label, sent, stampLocal(r.at), r.ok, r.err);
  });
  return parts.length ? `<div class="mail">${esc(AT.mailLog(parts.join(" · ")))}</div>` : "";
}

// Mes y día que se ven, a partir de ?month= y ?day= (valores no válidos se ignoran).
export function viewOf(qs, today) {
  const okMonth = (m) => /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(m || "");
  let day = qs.get("day");
  let month = qs.get("month");
  if (!(isRealDate(day || "") && okMonth((day || "").slice(0, 7)))) day = null;
  if (!okMonth(month)) month = null;
  if (day) month = day.slice(0, 7);
  else if (!month) month = today.slice(0, 7);
  if (!day) day = today.slice(0, 7) === month ? today : `${month}-01`;
  return { month, day };
}
const monthShift = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const monthLast = (month) => addDays(monthShift(month, 1) + "-01", -1);
// Links of the calendar open the agenda (the addresses are pinned by the regression suite).
const hrefOf = (month, day) => `/admin?month=${month}${day ? `&day=${day}` : ""}`;

// The icons of the navigation (24x24, presentation attributes come from the .icon class).
const NAV_ICON = {
  agenda: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h3"/>',
  studies: '<path d="M12 6c-3-3-7-3-9-2v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 2Zm0 0v15"/>',
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.500 2.700-6 6-6s6 2.500 6 6M16 5.500a3.500 3.500 0 0 1 0 6.500M18 14c2 .8 3 3 3 6"/>',
  data: '<path d="M5 20V10m7 10V4m7 16v-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.600 5.600l2.100 2.100m8.600 8.600 2.100 2.100m0-12.800-2.100 2.100M7.700 16.300l-2.100 2.100"/>',
  all: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
};

// A page of the panel. ?s= picks the section (agenda, studies, contacts, data, settings); s=all draws every section one after another.
async function dashboard(env, c, session, qs, extra = {}) {
  const { db } = c;
  const csrf = session.csrf;
  const view = { ...viewOf(qs, c.today), s: extra.s || sectionOf(qs.get("s")) };
  const want = (name) => view.s === "all" || view.s === name;
  // ---- mensaje de la acción anterior ----
  const code = qs.get("m");
  const lim = (s, n) => String(s ?? "").slice(0, n);
  const fl = await takeFlash(db, qs.get("k"));
  const P = { a: lim(fl.a, 60), x: lim(fl.x, 140), e: lim(fl.e, 140), n: Number(qs.get("n")) || 0, f: Number(qs.get("f")) || 0, w: Number(qs.get("w")) || 0 };
  let msg = "", isErr = false;
  if (Object.hasOwn(DYN, code || "")) [msg, isErr] = DYN[code](P);
  else if (Object.hasOwn(FLASH, code || "")) { msg = FLASH[code]; isErr = ERR.has(code); }
  // A refused save: the page of the same form, with the error at the top as well as next to the field.
  if (extra.refused) { msg = extra.refused.alert; isErr = true; }
  const relay = relayOn(env);

  const x = { env, c, qs, view, csrf, relay, extra };
  const navItem = (key) => `<a href="${key === "agenda" ? "/admin" : `/admin?s=${key}`}"${view.s === key ? ' aria-current="page"' : ""}><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${NAV_ICON[key]}</svg><span>${esc(AT.nav[key])}</span></a>`;
  const nav = `<nav class="main-nav" aria-label="${esc(AT.nav.label)}">${[...SECTIONS, "all"].map(navItem).join("")}</nav>`;
  const parts = [];
  if (want("agenda")) parts.push(await agendaSection(x));
  if (want("studies")) parts.push(await studiesSection(x));
  if (want("contacts")) parts.push(await contactsSection(x));
  if (want("data")) parts.push(await dataSection(x));
  if (want("settings")) parts.push(await settingsSection(x));
  const banner = relay ? "" : `<p class="banner" role="note">${AT.bannerHtml}</p>`;
  const body = `<div class="admin-shell"><aside class="sidebar">${wordmark()}<p class="lab-name">${esc(C.brand)}</p>
${nav}</aside>
<div class="workspace"><header class="workspace-top"><a href="/" class="top-link">${esc(AT.viewSite)} <span aria-hidden="true">&#8599;</span></a>
<form method="post" action="/admin/logout" class="inline">${hid(csrf, view)}<button type="submit" class="plain">${esc(AT.logout)}</button></form></header>
<main id="main" class="admin-main"><header class="page-heading"><div><p class="eyebrow">${esc(C.brand)}</p><h1>${esc(AT.title)}</h1><p class="page-subtitle">${esc(cap(prettyDay(c.today)))} · ${esc(c.nowTime)}</p></div></header>
${banner}${msg ? `<p class="${isErr ? "error" : "flash"}" role="${extra.refused ? "alert" : "status"}">${esc(msg)}</p>` : ""}
${parts.join("\n")}
</main>
<footer class="admin-footer"><span>${esc(PRODUCT_NAME)} <span aria-hidden="true">/</span> ${esc(C.brand)}</span><span>${esc(C.timeZone)}</span></footer></div></div>`;
  return page(env, body);
}

// The study of a booking, named in the day panel: by its own name when the studies come from the panel (only if there are several),
// "Estudio 1" / "Estudio 2" while they are the ones of the configuration (only with twoStudies).
const studyTagOf = (reg) => (b) => {
  if (reg.table && !usesConfigNames(reg)) return reg.studies.length > 1 ? `${esc((reg.studies.find((y) => y.id === b.study) || { name: b.study }).name)} · ` : "";
  return C.twoStudies ? `${esc(AT.day.study(b.study === "study2"))} · ` : "";
};

// ---- progress of a study: "<done> of <target> participants", a bar, what is still booked and what remains ----
// The line with the two parts of the total, only when some participants were done outside the site.
const partsLine = (p) => (p.outside > 0 ? `<p class="prog-parts note">${esc(AT.progress.parts(p.site, p.outside))}</p>` : "");
// The quick form: a number and its save button, and "+1". It carries the change date of the study it shows, so a stale page is refused.
// ctx: { csrf, view, at: "ag" | "st", sel, pl }. Only a study saved from the panel has it (the others have no row to write to).
function outsideForm(v, p, ctx) {
  if (!ctx || !ctx.table) return "";
  const id = `${ctx.at}-out-${v.id}`;
  return `<form class="out-form" method="post" action="/admin/do" id="${esc(id)}">${hid(ctx.csrf, ctx.view)}<input type="hidden" name="at" value="${ctx.at}"><input type="hidden" name="rev" value="${esc(v.updatedAt)}">${ctx.at === "st" ? `<input type="hidden" name="sel" value="${esc(ctx.sel)}"><input type="hidden" name="pl" value="${esc(ctx.pl)}">` : ""}
<p class="field"><label for="${esc(id)}-n">${esc(AT.progress.outsideLabel)}</label><input id="${esc(id)}-n" name="outside" type="number" inputmode="numeric" min="0" max="${LIMITS.outside}" step="1" value="${p.outside}"></p>
<p class="btnrow"><button name="do" value="study-outside:${esc(v.id)}" class="plain" aria-label="${esc(AT.progress.outsideSaveLabel(v.name))}">${esc(AT.progress.outsideSave)}</button><button name="do" value="study-outside-plus:${esc(v.id)}" class="plain" aria-label="${esc(AT.progress.outsidePlusLabel(v.name))}">+1</button></p></form>`;
}
function progressHtml(v, counts, ctx) {
  const p = progressOf(v, counts);
  if (!p.target) return "";
  return `<p class="prog-line"><strong>${esc(AT.progress.of(p.done, p.target))}</strong></p>
${partsLine(p)}<progress class="prog" max="${p.target}" value="${Math.min(p.done, p.target)}" aria-label="${esc(AT.progress.barLabel(v.name))}">${p.pct}%</progress>
<ul class="counts"><li>${esc(AT.progress.booked(p.upcoming))}</li><li>${esc(p.remaining ? AT.progress.remaining(p.remaining) : AT.progress.reached)}</li></ul>
${outsideForm(v, p, ctx)}`;
}

// ---- section: agenda ---------------------------------------------------------------------------------------------
async function agendaSection({ env, c, view, csrf, relay }) {
  const { db, today } = c;
  const href = hrefOf;
  const horizon = addDays(today, DAYS_AHEAD);
  const tomorrow = addDays(today, 1);
  const first = `${view.month}-01`;
  const last = monthLast(view.month);
  const times = await D.getDefaultTimes(db);
  const openSet = new Set(await D.openDays(db, first, last));
  const slotRows = await D.slotsBetween(db, first, last);
  const bookings = await D.bookingsBetween(db, first, last);
  const info = new Map(); // fecha -> { open, slots:Set, bookings:[] }
  const of = (d) => info.get(d) || info.set(d, { open: openSet.has(d), slots: new Set(), bookings: [] }).get(d);
  for (const s of slotRows) of(s.date).slots.add(s.time);
  for (const b of bookings) of(b.date).bookings.push(b);
  // The daily break: its slots are not offered, so they count neither as free nor as part of the total (the rows stay).
  const brk0 = await D.getBreak(db);
  const brk = breakMinutes(brk0);
  const inBrk = (t) => inBreak(hhmmToMin(t), brk);
  const sum = (d) => {
    const v = of(d);
    const taken = new Set(v.bookings.filter((b) => LIVE.has(b.status)).map((b) => b.time));
    const offered = [...v.slots].filter((t) => !inBrk(t));
    const total = offered.length;
    const free = offered.filter((t) => !taken.has(t)).length;
    const live = v.bookings.filter((b) => b.status !== "cancelled").length;
    const pc = v.bookings.filter((b) => b.status === "pending" || b.status === "confirmed").length;
    let kind = "closed";
    // Slots that all sit in the break are not "no slots": the rows are there and come back when the break is removed.
    if (v.open) kind = v.slots.size === 0 ? "empty" : total === 0 ? "pause" : free === 0 ? "full" : "open";
    return { ...v, total, free, live, pc, kind };
  };
  const stateText = (x) => (x.kind === "closed" ? AT.cal.closed : x.kind === "empty" ? AT.cal.empty : x.kind === "pause" ? AT.cal.allBreak : x.kind === "full" ? AT.cal.full : AT.cal.freeOf(x.free, x.total));

  const reg = await D.getRegistry(db);
  const studyTag = studyTagOf(reg);
  // The progress of the active study, above today, when it has a target (only studies saved from the panel have one).
  const active = reg.studies.find((y) => y.id === reg.active);
  const prog = active && active.target
    ? `<div class="overview-block recruitment o-prog"><h3 id="prog-title">${esc(AT.progress.title)}: ${esc(active.name)}</h3>${progressHtml(active, (await D.studyCounts(db, today)).get(active.id), { csrf, view, at: "ag", table: reg.table })}<p class="note">${esc(AT.progress.note)}</p></div>`
    : "";
  // ---- hoy y mañana ----
  const nowList = (await D.bookingsBetween(db, today, tomorrow)).filter((b) => b.status !== "cancelled");
  const nowSection = (day, label) => {
    const list = nowList.filter((b) => b.date === day);
    const head = `<h3>${label}: ${esc(prettyDay(day))} <span class="count">${list.length ? `${list.length} ${esc(AT.resBook(list.length))}` : esc(AT.now.noBookings)}</span></h3>`;
    const links = [`<a class="lnk" href="${esc(href(day.slice(0, 7), day))}">${esc(AT.now.openDay)}</a>`];
    if (list.length >= 2) links.push(writeAll(list, dayMonth(day)));
    const rows = list.map((b) => `<li class="now-row"><span class="now-time">${range(b.time)}</span> <strong>${esc(b.name)}</strong> <span class="tag t-${esc(b.status)}">${esc(STATUS_LABEL[b.status] || b.status)}</span><div class="mail"><span class="addr">${esc(b.email)}</span> · ${writeLink(b)}</div></li>`).join("");
    return `${head}${rows ? `<ul class="now-list">${rows}</ul>` : ""}<p class="btnrow">${links.join(" ")}</p>`;
  };
  // "Disponible hoy": formulario propio (el bloque está fuera de los demás formularios).
  const flex = await D.getFlex(db, today);
  let flexInfo = "";
  if (flex) {
    const busy = nowList.filter((b) => b.date === today).map((b) => hhmmToMin(b.time));
    const starts = flexStarts({ nowMin: hhmmToMin(c.nowTime), fromMin: hhmmToMin(flex.from), untilMin: hhmmToMin(flex.until), busy, brk }).map(minToHhmm);
    const shownStarts = starts.slice(0, 8);
    flexInfo = `<p class="flash">${AT.now.flexInfoHtml(esc(flex.from), esc(flex.until))}</p>
<p class="note">${starts.length ? esc(AT.now.nextStarts(shownStarts.join(", "), starts.length - shownStarts.length)) : esc(AT.now.noneFits)}</p>`;
  }
  const flexForm = `<form method="post" action="/admin/do" class="flex-form">${hid(csrf, view)}${flexInfo}
<p class="field"><label for="flex-from">${esc(AT.now.flexFrom)}</label><input id="flex-from" name="flex_from" type="time" required value="${esc(flex ? flex.from : c.nowTime)}">
<label for="flex-until">${esc(AT.now.flexUntil)}</label><input id="flex-until" name="flex_until" type="time" required value="${esc(flex ? flex.until : FLEX_DEFAULT_UNTIL)}">
<button name="do" value="flex-on" class="plain">${esc(flex ? AT.now.change : AT.now.activate)}</button>${flex ? ` <button name="do" value="flex-off" class="plain">${esc(AT.now.deactivate)}</button>` : ""}</p>
${flex ? "" : `<p class="note">${esc(AT.now.flexNote)}</p>`}</form>`;
  // Where the researcher looks every day: the break, when there is one, with the way to change it.
  // Shown also when no break is set: so the option is in plain sight.
  const breakLine = `<div class="overview-block overview-wide"><p class="note">${esc(brk0 ? AT.now.breakLine(brk0.from, brk0.until) : AT.now.breakNone)} <a class="lnk" href="/admin?s=settings">${esc(brk0 ? AT.now.breakLink : AT.now.breakAdd)}</a></p></div>`;
  const nowBlock = `<section class="overview" aria-labelledby="now-title"><h2 id="now-title">${esc(AT.now.title)}</h2>
<div class="overview-block">${nowSection(today, AT.now.today)}</div><div class="overview-block">${nowSection(tomorrow, AT.now.tomorrow)}</div>
${prog}${breakLine}<div class="overview-block overview-wide">${flexForm}</div></section>`;

  // ---- calendario del mes ----
  const offset = (weekday(first) + 6) % 7;
  const nDays = Number(last.slice(8));
  let rowsHtml = "";
  let cells = [];
  for (let k = 0; k < offset; k++) cells.push('<td class="blank"></td>');
  for (let dn = 1; dn <= nDays; dn++) {
    const d = `${view.month}-${String(dn).padStart(2, "0")}`;
    const x = sum(d);
    const wd = weekday(d); // 0 = Sunday, 6 = Saturday
    const cls = ["cell", `c-${x.kind}`, wd === 6 ? "c-sat" : "", wd === 0 ? "c-sun" : "", d < today ? "c-past" : "", d === today ? "c-today" : "", d === view.day ? "c-sel" : ""].filter(Boolean).join(" ");
    const bk = x.live ? `<span class="bk"><b>${x.live}</b><span class="lg"> ${esc(AT.resBook(x.live))}</span></span>` : "";
    const stShort = x.kind === "open" ? `${x.free}/${x.total}` : stateText(x);
    const st = x.kind === "open" ? `<span class="lg">${esc(stateText(x))}</span><span class="sh">${esc(stShort)}</span>` : esc(stateText(x));
    const dayName = WEEKDAYS[(wd + 6) % 7][1];
    const label = `${prettyDay(d).toLowerCase().includes(dayName.toLowerCase()) ? prettyDay(d) : `${dayName} ${prettyDay(d)}`}${d === today ? AT.cal.today : ""}${d < today ? AT.cal.past : ""}, ${stateText(x)}${x.live ? `, ${x.live} ${AT.resBook(x.live)}` : ""}${d === view.day ? AT.cal.selected : ""}`;
    cells.push(`<td><a class="${cls}" href="${esc(href(view.month, d))}" aria-label="${esc(label)}"${d === today ? ' aria-current="date"' : ""}><span class="dn">${dn}</span><span class="stt">${st}</span>${bk}</a></td>`);
    if (cells.length === 7) { rowsHtml += `<tr>${cells.join("")}</tr>`; cells = []; }
  }
  if (cells.length) { while (cells.length < 7) cells.push('<td class="blank"></td>'); rowsHtml += `<tr>${cells.join("")}</tr>`; }
  const prev = monthShift(view.month, -1);
  const next = monthShift(view.month, 1);
  const cal = `<section class="surface" aria-labelledby="cal-title">
<div class="cal-head"><h2 id="cal-title">${esc(cap(prettyMonth(view.month)))}</h2>
<nav class="cal-nav" aria-label="${esc(AT.cal.changeMonth)}"><a class="btn-link" href="${esc(href(prev))}" aria-label="${esc(AT.cal.prevAria)}">&larr; ${esc(AT.cal.prev)}</a><a class="btn-link" href="/admin">${esc(AT.cal.todayLink)}</a><a class="btn-link" href="${esc(href(next))}" aria-label="${esc(AT.cal.nextAria)}">${esc(AT.cal.next)} &rarr;</a></nav></div>
<table class="cal"><thead><tr>${WEEKDAYS.map(([a, f], k) => `<th scope="col"${k === 6 ? ' class="h-sun"' : k === 5 ? ' class="h-sat"' : ""}><abbr title="${esc(f)}">${esc(a)}</abbr></th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody></table>
<ul class="legend" aria-label="${esc(AT.cal.legendLabel)}">
${AT.cal.legend.map(([cls, sw, txt]) => `<li><span class="sw ${cls}">${sw === "<b>2</b>" ? sw : esc(sw)}</span>${esc(txt)}</li>`).join("\n")}
</ul></section>`;

  // ---- panel del día ----
  const d = view.day;
  const x = sum(d);
  const past = d < today;
  const canEdit = !past && d <= horizon;
  const pill = x.kind === "closed" ? ["p-closed", AT.day.pillClosed] : x.kind === "full" ? ["p-full", AT.day.pillFull] : x.kind === "empty" ? ["p-closed", AT.day.pillEmpty] : x.kind === "pause" ? ["p-closed", AT.day.pillBreak] : ["p-open", AT.day.pillOpen(x.free, x.total)];
  let act = "";
  if (past) act = `<p class="note">${esc(AT.day.past)}</p>`;
  else if (!canEdit) act = `<p class="note">${esc(AT.day.beyond)}</p>`;
  else if (!x.open) act = `<p><button name="do" value="open:${d}" class="big">${esc(AT.day.open)}</button></p><p class="note">${esc(AT.day.willCreate(times.length, times.map(range).join(", ")))}</p>`;
  else if (x.pc) act = `<p class="why" role="note">${esc(AT.day.cannotClose(x.pc))}</p>`;
  else act = `<p><button name="do" value="close:${d}" class="big secondary">${esc(AT.day.close)}</button></p>`;

  const bookingBy = new Map();
  for (const b of x.bookings.filter((b) => LIVE.has(b.status))) bookingBy.set(b.time, b);
  const cancelled = x.bookings.filter((b) => b.status === "cancelled");
  const logs = await D.mailLogFor(db, [...bookingBy.values(), ...cancelled].map((b) => b.id));
  const dayKey = await D.getKey(db);
  const codes = new Map();
  for (const b of bookingBy.values()) codes.set(b.id, D.formatCode(await D.codeFor(dayKey, b.token)));
  const allTimes = x.open ? [...new Set([...times, ...x.slots, ...bookingBy.keys()])].sort() : [...bookingBy.keys()].sort();
  // Excepción a las 12 h en el día elegido: se decide aquí, día a día.
  const short = canEdit && (await D.hasNoNotice(db, d));
  const minOpenMin = localToMinutes(today, c.nowTime) + (short ? SHORT_NOTICE_MIN : MIN_NOTICE_HOURS * 60);
  const lateText = AT.day.lateText(short);
  const flexClash = d === today && flex ? AT.day.flexClash : "";
  const noticeAct = !canEdit || !x.open ? "" : short
    ? `<p class="flash">${esc(AT.day.noticeOn(flexClash))}</p><p><button name="do" value="notice-on:${d}" class="plain">${esc(AT.day.noticeBack)}</button></p>`
    : `<p><button name="do" value="notice-off:${d}" class="plain">${esc(AT.day.noticeOffBtn)}</button></p><p class="note">${esc(AT.day.noticeOffNote)}</p>`;
  // ¿Ha demostrado que recibe el correo? (botón o código del mensaje; al confirmar por correo queda hecho)
  const verifiedLine = (b) => !relay || b.status === "pending" || b.status === "cancelled" ? "" : `<div class="mail">${b.verified_at ? esc(AT.day.verified(stampLocal(b.verified_at))) : esc(AT.day.unverified)}</div>`;
  const noteBox = (b) => `<p class="field"><label for="note-${esc(b.id)}">${AT.day.noteFor(esc(b.name))}</label><textarea id="note-${esc(b.id)}" name="note_${esc(b.id)}" maxlength="500" rows="3"></textarea></p>`;
  const row = (t) => {
    const b = bookingBy.get(t);
    const isOpen = x.slots.has(t);
    if (b) {
      const mark = ["confirmed", "attended", "noshow"].includes(b.status);
      const started = slotStarted(b.date, b.time, today, c.nowTime);
      const btns = [];
      if (mark && started) btns.push(`<button name="do" value="attended:${esc(b.id)}" class="${b.status === "attended" ? "on" : "plain"}" aria-pressed="${b.status === "attended"}">${esc(AT.day.attended)}</button>`, `<button name="do" value="noshow:${esc(b.id)}" class="${b.status === "noshow" ? "on" : "plain"}" aria-pressed="${b.status === "noshow"}">${esc(AT.day.noshow)}</button>`);
      else if (mark) btns.push(`<span class="wait">${esc(AT.day.notStarted)}</span>`);
      if (b.status === "noshow" && relay)
        btns.push(`<details class="confirm"><summary>${esc(AT.day.rebookSummary)}</summary><div class="confirm-box"><p>${AT.day.rebookTextHtml(esc(b.name))}</p>${noteBox(b)}<button name="do" value="rebook:${esc(b.id)}" class="plain">${esc(AT.day.rebookSend)}</button></div></details>`);
      if (b.status === "pending" && relay) btns.push(`<button name="do" value="resend:${esc(b.id)}" class="plain">${esc(AT.day.resend)}</button>`);
      if ((b.status === "pending" || b.status === "confirmed") && b.date >= today)
        btns.push(`<details class="confirm"><summary>${esc(AT.day.cancelSummary)}</summary><div class="confirm-box"><p>${AT.day.cancelAskHtml(esc(b.name), relay)}</p>${noteBox(b)}<button name="do" value="cancel:${esc(b.id)}" class="danger">${esc(AT.day.cancelYes)}</button></div></details>`);
      const expiry = b.status === "pending" && b.expires_at ? `<div class="mail">${esc(AT.day.expires(clockLocal(b.expires_at)))}</div>` : "";
      const breakTag = inBrk(t) ? ` <span class="wait">${esc(AT.day.bookedInBreak)}</span>` : "";
      return `<li class="slot-row s-booked"><div class="sr-time">${range(t)}</div><div class="sr-state"><strong>${esc(b.name)}</strong> <span class="tag t-${esc(b.status)}">${esc(STATUS_LABEL[b.status] || b.status)}</span>${breakTag}<div class="mail"><span class="addr">${esc(b.email)}</span> · ${writeLink(b)} · ${studyTag(b)}${esc(AT.day.code)}${esc(codes.get(b.id))}</div>${verifiedLine(b)}${expiry}${mailLine(logs.get(b.id))}</div><div class="sr-act">${btns.join("")}</div></li>`;
    }
    const toggle = canEdit ? `<button name="do" value="slot:${d}T${t}" class="plain">${esc(isOpen ? AT.day.closeSlot : AT.day.openSlot)}</button>` : "";
    const tooLate = isOpen && localToMinutes(d, t) < minOpenMin;
    const inPause = isOpen && inBrk(t);
    const freeText = inPause ? AT.day.freeInBreak : tooLate ? (d === today && flex ? AT.day.freeNotOffered : AT.day.freeTooLate(lateText)) : AT.day.free;
    return `<li class="slot-row ${isOpen ? "s-free" : "s-off"}"><div class="sr-time">${range(t)}</div><div class="sr-state"><span class="tag ${isOpen ? "t-free" : "t-off"}">${esc(isOpen ? freeText : AT.day.slotClosed)}</span></div><div class="sr-act">${toggle}</div></li>`;
  };
  // A closed day with "available today" on: the public sees the hours of "available today", so the generic closed note would mislead.
  const flexClosed = !x.open && d === today && flex ? `<p class="note">${esc(AT.day.flexClosed(flex.from, flex.until))}</p>` : "";
  const slotList = x.open
    ? `<h3>${esc(AT.day.slots)}</h3><ul class="slot-list">${allTimes.map(row).join("")}</ul>`
    : allTimes.length
      ? `${flexClosed}<h3>${esc(AT.day.bookings)}</h3><ul class="slot-list">${allTimes.map(row).join("")}</ul>`
      : flexClosed || `<p class="note">${esc(past ? AT.day.noneThen : AT.day.closedNote)}</p>`;
  const cancelledNote = cancelled.length
    ? `<details class="cancelled"><summary>${esc(AT.day.cancelledSummary(cancelled.length))}</summary><ul class="now-list">${cancelled.map((b) => `<li class="now-row"><span class="now-time">${range(b.time)}</span> <strong>${esc(b.name)}</strong> ${writeLink(b)}${mailLine(logs.get(b.id))}</li>`).join("")}</ul></details>`
    : "";
  // "This week" is the week of the day shown, and on a Saturday or a Sunday the coming one; the buttons say which dates they open.
  const weekend = weekday(d) === 0 || weekday(d) === 6;
  const wk = weekToOpen(d);
  const weekBtn = `<form method="post" action="/admin/do" class="week">${hid(csrf, view)}<button name="do" value="week:${d}" class="plain">${esc(AT.day.openWeek(prettyDay(wk), prettyDay(addDays(wk, 4)), weekend))}</button><p class="note">${esc(AT.day.openWeekNote)}${weekend ? ` ${esc(AT.day.openWeekendNote)}` : ""}</p>
<p class="note">${esc(AT.day.openWeeks(prettyDay(wk)))}</p>
<p class="field weeks"><label for="weeks">${esc(AT.day.weeksLabel)}</label><select id="weeks" name="weeks">${[1, 2, 4, 8].map((n) => `<option value="${n}">${n}</option>`).join("")}</select> <button name="do" value="weeks:${d}" class="plain">${esc(AT.day.openWeeksBtn)}</button></p></form>`;
  const panel = `<section class="surface panel" aria-labelledby="day-title">
<div class="panel-head"><h2 id="day-title">${esc(prettyDay(d))}</h2><span class="pill ${pill[0]}">${esc(pill[1])}</span></div>
<form method="post" action="/admin/do">${hid(csrf, view)}${act}${noticeAct}${slotList}${cancelledNote}</form>
${weekBtn}</section>`;

  // ---- próximas reservas (a partir de pasado mañana) ----
  const upc = (await D.bookingsBetween(db, addDays(today, 2), addDays(today, 15))).filter((b) => b.status !== "cancelled");
  const shown = upc.slice(0, 30);
  const upcoming = `<section class="surface" aria-labelledby="up-title"><h2 id="up-title">${esc(AT.upcoming.title)}</h2>
${upc.length ? `<ul class="upc">${shown.map((b) => `<li><a href="${esc(href(b.date.slice(0, 7), b.date))}"><span class="u-day">${esc(prettyDay(b.date))}</span><span class="u-time">${range(b.time)}</span><span class="u-name">${esc(b.name)}</span><span class="tag t-${esc(b.status)}">${esc(STATUS_LABEL[b.status] || b.status)}</span></a></li>`).join("")}</ul>${upc.length > shown.length ? `<p class="note">${esc(AT.upcoming.more(upc.length - shown.length))}</p>` : ""}` : `<p class="note">${esc(AT.upcoming.none)}</p>`}</section>`;

  return `<div class="o-now">${nowBlock}</div>
<div class="adm-grid"><div class="adm-col"><div class="o-cal">${cal}</div><div class="o-upc">${upcoming}</div></div><div class="o-panel">${panel}</div></div>`;
}

// ---- section: studies ---------------------------------------------------------------------------------------------
// A field of the studies and consent forms: label, control, the limit as a short hint under it and, when a refused save marked it, the error.
// value: what the control holds (the text the page shows, or what was typed when a save was refused). The limit goes in the control only
// when the value fits: a text that is longer (a long text of the configuration) must not be cut by the browser.
function fieldHtml({ id, name, label, hint, tag = "input", type = "text", value, max, rows, required = false, err = "", attrs = "" }) {
  const hintId = `${id}-hint`, errId = `${id}-err`;
  const lim = max && value.length <= max ? ` maxlength="${max}"` : "";
  const aria = `${err ? ' aria-invalid="true"' : ""} aria-describedby="${hintId}${err ? ` ${errId}` : ""}"`;
  const ctl = tag === "textarea"
    ? `<textarea id="${id}" name="${esc(name)}" rows="${rows}"${lim}${aria}>${esc(value)}</textarea>`
    : `<input id="${id}" name="${esc(name)}" type="${type}"${attrs || lim}${required ? " required" : ""}${aria} value="${esc(value)}">`;
  return `<div class="field-block"><p class="field"><label for="${id}">${esc(label)}</label>${ctl}</p><p class="note" id="${hintId}">${esc(hint)}</p>${err ? `<p class="error field-error" id="${errId}">${esc(err)}</p>` : ""}</div>`;
}

async function studiesSection({ c, qs, view, csrf, extra }) {
  const { db, today } = c;
  const reg = await D.getRegistry(db);
  const counts = await D.studyCounts(db, today);
  const wanted = String(qs.get("st") || "");
  const sel = (isStudyId(wanted) && reg.studies.find((y) => y.id === wanted)) || reg.studies.find((y) => y.id === reg.active) || reg.studies[0];
  const pl = LANGS.includes(qs.get("pl")) ? qs.get("pl") : LANGS[0];
  const stHref = (id, lang, anchor = "studies-edit") => `/admin?s=${view.s}&st=${id}${lang ? `&pl=${lang}` : ""}#${anchor}`;
  const form = (inner) => `<form method="post" action="/admin/do">${hid(csrf, view)}<input type="hidden" name="pl" value="${esc(pl)}">${inner}</form>`;
  const isActive = (y) => y.id === reg.active;
  // A refused save of this study: the form is filled with what was typed, and the fields it marked show their error.
  const rf = extra.refused && extra.refused.kind === "study" && extra.refused.id === sel.id ? extra.refused : null;
  if (view.s === "studies" && qs.get("c") === "consent") return consentEditor(sel, view, csrf, stHref, extra.refused && extra.refused.kind === "consent" && extra.refused.id === sel.id ? extra.refused : null);
  const val = (key, effective) => (rf ? String(rf.f.get(key) ?? "") : effective);
  const on = (key, effective) => (rf ? rf.f.get(key) === "1" : effective);
  const errOf = (key) => (rf && rf.errors[key]) || "";

  // Which study takes the bookings.
  const choices = reg.studies.filter((y) => !y.archived);
  const switchBlock = choices.length >= 2 && (reg.table || C.twoStudies)
    ? form(`<h3>${esc(AT.set.studyTitle)}</h3>
<p class="note">${esc(AT.set.studyNote)}</p>
<p class="btnrow">${choices.map((y) => `<button name="do" value="study:${esc(y.id)}" class="${isActive(y) ? "on" : "plain"}" aria-pressed="${isActive(y)}">${esc(y.name)}</button>`).join("\n")}</p>`)
    : "";

  const row = (y) => {
    const cnt = counts.get(y.id) || { attended: 0, upcoming: 0 };
    const p = progressOf(y, cnt);
    const tags = `${isActive(y) ? ` <span class="tag t-confirmed">${esc(AT.studies.activeMark)}</span>` : ""}${y.archived ? ` <span class="tag t-off">${esc(AT.studies.archivedMark)}</span>` : ""}`;
    const ctx = { csrf, view, at: "st", sel: sel.id, pl, table: reg.table };
    const nums = p.target ? progressHtml(y, cnt, ctx) : `<p class="mail">${esc(AT.studies.doneNoTarget(p.done, p.upcoming))}</p>${partsLine(p)}${outsideForm(y, p, ctx)}`;
    return `<li class="study-row${y.id === sel.id ? " is-sel" : ""}"><div class="st-head"><a class="lnk" href="${esc(stHref(y.id, pl))}"${y.id === sel.id ? ' aria-current="true"' : ""}>${esc(y.name)}</a>${tags}</div>
<p class="mail">${esc(p.target ? AT.studies.targetOf(p.target) : AT.studies.noTarget)}</p>${nums}</li>`;
  };

  // The edit form of the selected study: every text shows what the public page shows (the study's own, else the configuration's or the
  // built-in one); a text left as it is is not stored.
  const langBox = (l) => {
    const r = resolveTexts(l, sel);
    const id = (k) => `st-${k}-${l}`;
    const one = (k, label, max, value) => fieldHtml({ id: id(k), name: FIELD(k, l), label, hint: AT.studies.max(max), value: val(FIELD(k, l), value), max, err: errOf(FIELD(k, l)) });
    const many = (k, label, max, rows, value) => fieldHtml({ id: id(k), name: FIELD(k, l), label, hint: AT.studies.max(max), tag: "textarea", rows, value: val(FIELD(k, l), value), max, err: errOf(FIELD(k, l)) });
    return `<fieldset class="lang-box"><legend>${esc(AT.studies.langTitle(LANG_NAME[l]))}</legend>
<p class="note">${esc(AT.studies.langNote)}</p>
${one("title", AT.studies.fTitle, LIMITS.title, r.title)}
${many("lead", AT.studies.fLead, LIMITS.lead, 4, r.lead)}
${many("does", AT.studies.fDoes, LIMITS.does, 5, r.does)}
${fieldHtml({ id: id("reqs"), name: FIELD("reqs", l), label: AT.studies.fReqs, hint: AT.studies.maxReqs(LIMITS.reqs, LIMITS.req), tag: "textarea", rows: 5, value: val(FIELD("reqs", l), r.reqs.join("\n")), err: errOf(FIELD("reqs", l)) })}</fieldset>`;
  };
  // The public list: how this study is listed beside the active one. A seeded study nobody has set shows the state the page gives it.
  const effState = sel.publicState || (isSeededId(sel.id) ? autoPublicState(sel, reg) : "hidden");
  const stateNow = rf ? String(rf.f.get("public_state") ?? effState) : effState;
  const stateField = `<div class="field-block"><p class="field"><label for="st-state">${esc(AT.studies.fState)}</label><select id="st-state" name="public_state" aria-describedby="st-state-hint">${PUBLIC_STATES.map((k) => `<option value="${k}"${k === stateNow ? " selected" : ""}>${esc(AT.studies.stateOpts[k])}</option>`).join("")}</select></p>
<p class="note" id="st-state-hint">${esc(AT.studies.stateNote)}${isActive(sel) ? ` ${esc(AT.studies.stateActive)}` : ""}</p></div>`;
  const canActivate = !isActive(sel) && !sel.archived && (reg.table || (C.twoStudies && (sel.id === "study1" || sel.id === "study2")));
  const edit = form(`<h3 id="studies-edit">${esc(AT.studies.editTitle)}: ${esc(sel.name)}</h3>
<p class="note">${esc(AT.studies.plainNote)}</p>
${fieldHtml({ id: "st-name", name: "name", label: AT.studies.fName, hint: AT.studies.max(LIMITS.name), value: val("name", sel.name), max: LIMITS.name, required: true, err: errOf("name") })}
${fieldHtml({ id: "st-target", name: "target", label: AT.studies.fTarget, hint: AT.studies.targetRange, type: "number", attrs: ` min="1" max="${LIMITS.target}" step="1"`, value: val("target", sel.target ? String(sel.target) : ""), err: errOf("target") })}
${fieldHtml({ id: "st-outside", name: "outside", label: AT.studies.fOutside, hint: AT.studies.outsideHint, type: "number", attrs: ` min="0" max="${LIMITS.outside}" step="1"`, value: val("outside", String(sel.outside || 0)), err: errOf("outside") })}
<input type="hidden" name="outside_was" value="${esc(String(sel.outside || 0))}">
${stateField}
<fieldset class="lang-box"><legend>${esc(AT.studies.declTitle)}</legend>
<p class="check"><label><input type="checkbox" name="epilepsy" value="1"${on("epilepsy", sel.declarations.epilepsy) ? " checked" : ""}> <span>${esc(AT.studies.fEpilepsy)}</span></label></p>
<p class="check"><label><input type="checkbox" name="vestibular" value="1"${on("vestibular", sel.declarations.vestibular) ? " checked" : ""}> <span>${esc(AT.studies.fVestibular)}</span></label></p></fieldset>
${LANGS.map(langBox).join("\n")}
<p class="btnrow"><button name="do" value="study-save:${esc(sel.id)}" class="big">${esc(AT.studies.save)}</button>${canActivate ? ` <button name="do" value="study-save-activate:${esc(sel.id)}" class="plain">${esc(AT.studies.saveActivate)}</button>` : ""}</p>`);

  const archive = sel.archived
    ? form(`<p><button name="do" value="study-restore:${esc(sel.id)}" class="plain">${esc(AT.studies.restore)}</button></p>`)
    : isActive(sel)
      ? `<p><button class="plain" disabled>${esc(AT.studies.archive)}</button></p><p class="note">${esc(AT.studies.cannotArchive)}</p>`
      : form(`<p><button name="do" value="study-archive:${esc(sel.id)}" class="plain">${esc(AT.studies.archive)}</button></p>`);
  // "Make active": the study the public page offers. Only a study that is not archived, and only when there is another one to switch from.
  const activate = canActivate ? form(`<p><button name="do" value="study:${esc(sel.id)}" class="plain">${esc(AT.studies.makeActive)}</button></p><p class="note">${esc(AT.set.studyNote)}</p>`) : "";
  const fresh = form(`<p><button name="do" value="study-new" class="plain">${esc(AT.studies.newStudy)}</button></p><p class="note">${esc(AT.studies.newNote)}</p>`);

  const consentLink = `<section class="surface" aria-labelledby="cs-open"><h3 id="cs-open">${esc(AT.consent.open)}: ${esc(sel.name)}</h3><p class="note">${esc(AT.consent.openNote)}</p>
<p class="btnrow"><a class="btn-link" href="${esc(`/admin?s=studies&st=${sel.id}&c=consent#consent-edit`)}">${esc(AT.consent.open)}</a></p></section>`;
  // The preview links change its language and stay on the preview.
  const preview = `<section class="surface" id="studies-preview" aria-labelledby="pv-title"><h3 id="pv-title">${esc(AT.studies.preview)}: ${esc(sel.name)}</h3>
<p class="note">${esc(AT.studies.previewNote)}</p><p class="note">${esc(AT.studies.previewOrder)}</p>
<p class="btnrow"><span class="note">${esc(AT.studies.previewIn)}:</span> ${LANGS.map((l) => `<a class="btn-link" href="${esc(stHref(sel.id, l, "studies-preview"))}" lang="${l}"${l === pl ? ' aria-current="true"' : ""}>${esc(LANG_REGISTRY[l].label)}</a>`).join(" ")}</p>
${studyPreviewHtml(pl, sel)}</section>`;

  return `<h2 class="sec-title" id="sec-studies">${esc(AT.sectionTitle.studies)}</h2>
<div class="adm-stack">
<section class="surface" aria-labelledby="st-list"><p>${esc(AT.studies.intro)}</p>${reg.table ? "" : `<p class="note">${esc(AT.studies.firstNote)}</p>`}
${switchBlock}
<h3 id="st-list">${esc(AT.studies.listTitle)}</h3><ul class="study-list">${reg.studies.map(row).join("")}</ul>${fresh}</section>
<section class="surface">${edit}<hr>${activate}${archive}<p class="note">${esc(AT.studies.archiveNote)}</p></section>
${consentLink}
${preview}
</div>`;
}

// The consent form of one study: a field per text, per configured language, showing the text that would print (the stored one, else the
// default); what the public page states for the study (read-only, with every promise it makes about the consent); a warning when the sheet
// and the booking form disagree about epilepsy; and the links to the sheets.
function consentEditor(sel, view, csrf, stHref, rf) {
  const t = AT.consent;
  const stored = (l) => (sel.consent && sel.consent[l]) || null;
  const val = (key, effective) => (rf ? String(rf.f.get(key) ?? "") : effective);
  const on = (key, effective) => (rf ? rf.f.get(key) === "1" : effective);
  const errOf = (key) => (rf && rf.errors[key]) || "";
  const langBox = (l) => {
    const c = stored(l);
    const d = consentDefaults(l, sel);
    const facts = publicFacts(l, sel);
    const warn = consentWarnings(l, sel).includes("epilepsy") ? `<p class="banner consent-warn" role="alert">${esc(t.warnEpilepsy)}</p>` : "";
    const field = (f) => {
      const key = CONSENT_FORM(f, l);
      const one = f === "heading" || f === "duration";
      return fieldHtml({ id: `cs-${f}-${l}`, name: key, label: t.fields[f], hint: t.max(consentMax(f)), tag: one ? "input" : "textarea", rows: 4, value: val(key, (c && c[f]) || d[f]), max: consentMax(f), err: errOf(key) });
    };
    const pkey = CONSENT_FORM("perms", l);
    return `<fieldset class="lang-box"><legend>${esc(t.langTitle(LANG_NAME[l]))}</legend>
<p class="note">${esc(t.langNote)}</p>
<div class="consent-facts"><p><strong>${esc(t.factsTitle)}</strong> <span class="note">${esc(t.factsNote)}</span></p>
<ul><li>${esc(t.factMinutes(facts.minutes))}</li><li>${esc(t.factDecl(facts.epilepsy, facts.vestibular))}</li>
<li>${esc(t.factReqs)}: ${facts.reqs.length ? `<ul>${facts.reqs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : esc(t.factNoReqs)}</li>
<li>${esc(t.promisesTitle)} <span class="note">(${esc(t.promisesNote)})</span>: ${facts.promises.length ? `<ul>${facts.promises.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : esc(t.promisesNone)}</li></ul></div>
${warn}
${CONSENT_FIELDS.map(field).join("\n")}
${fieldHtml({ id: `cs-perms-${l}`, name: pkey, label: t.fPerms, hint: t.permsHint(CONSENT_LIMITS.perms, CONSENT_LIMITS.perm), tag: "textarea", rows: 4, value: val(pkey, c ? c.perms.join("\n") : ""), err: errOf(pkey) })}
<p class="check"><label><input type="checkbox" name="${CONSENT_FORM("researcher", l)}" value="1"${on(CONSENT_FORM("researcher", l), !c || c.researcher) ? " checked" : ""}> <span>${esc(t.fResearcher)}</span></label></p>
<p class="check"><label><input type="checkbox" name="${CONSENT_FORM("researcherFirst", l)}" value="1"${on(CONSENT_FORM("researcherFirst", l), !!(c && c.researcherFirst)) ? " checked" : ""}> <span>${esc(t.fResearcherFirst)}</span></label></p>
<p class="check"><label><input type="checkbox" name="${CONSENT_FORM("adult", l)}" value="1"${on(CONSENT_FORM("adult", l), !c || c.adult) ? " checked" : ""}> <span>${esc(t.fAdult)}</span></label></p></fieldset>`;
  };
  const sheets = `<section class="surface" aria-labelledby="cs-sheets"><h3 id="cs-sheets">${esc(t.sheetsTitle)}</h3><p class="note">${esc(t.sheetsNote)}</p>
<p class="btnrow">${LANGS.map((l) => `<a class="btn-link" href="${esc(`/admin/consent?study=${sel.id}&lang=${l}`)}" lang="${l}">${esc(t.openSheet(LANG_REGISTRY[l].label))}</a>`).join(" ")}</p></section>`;
  return `<h2 class="sec-title" id="sec-studies">${esc(AT.sectionTitle.studies)}</h2>
<div class="adm-stack">
<section class="surface"><p class="btnrow"><a class="btn-link" href="${esc(stHref(sel.id))}">${esc(t.back)}</a></p>
<h3 id="consent-edit">${esc(t.title)}: ${esc(sel.name)}</h3>
<p class="banner" role="note">${esc(t.ethics)}</p>
<p>${esc(t.intro)}</p>
<form method="post" action="/admin/do">${hid(csrf, view)}
${LANGS.map(langBox).join("\n")}
<p><button name="do" value="consent-save:${esc(sel.id)}" class="big">${esc(t.save)}</button></p></form></section>
${sheets}
</div>`;
}

// ---- section: contacts (future studies) ------------------------------------------------------------------------------------
async function contactsSection({ c, view, csrf, extra }) {
  const list = await D.contactsConfirmed(c.db, c.now.toISOString());
  return `<h2 class="sec-title" id="sec-contacts">${esc(AT.sectionTitle.contacts)}</h2>
<div class="adm-stack">${inviteBlock(csrf, view, extra.invite)}${contactsBlock(csrf, view, list, extra.inviteContacts)}</div>`;
}

// ---- section: data (exports) ---------------------------------------------------------------------------------------------------
// Counts per study and ISO week (the Monday): the bookings still in the table and the tallies that the purge left, read in one statement
// (see weeklyCounts in src/db.js). Studies of the registry first (archived ones too), then any study id that only the bookings know.
// No names and no e-mail addresses.
async function summaryData(db, c) {
  const reg = await D.getRegistry(db);
  const zero = () => ({ booked: 0, attended: 0, absent: 0, cancelled: 0, unmarked: 0 });
  const by = new Map();
  for (const r of await D.weeklyCounts(db, c.today, c.nowTime)) {
    if (!by.has(r.study)) by.set(r.study, new Map());
    const weeks = by.get(r.study);
    if (!weeks.has(r.week)) weeks.set(r.week, zero());
    weeks.get(r.week)[r.kind] += r.n;
  }
  const known = new Set(reg.studies.map((y) => y.id));
  const ids = [...reg.studies.map((y) => y.id), ...[...by.keys()].filter((id) => !known.has(id)).sort()];
  return ids.map((id) => {
    const v = reg.studies.find((y) => y.id === id);
    const weeks = [...(by.get(id) || new Map())].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([week, n]) => ({ week, ...n }));
    const total = weeks.reduce((t, w) => ({ booked: t.booked + w.booked, attended: t.attended + w.attended, absent: t.absent + w.absent, cancelled: t.cancelled + w.cancelled, unmarked: t.unmarked + w.unmarked }), zero());
    return { id, name: v ? v.name : id, target: v ? v.target : null, weeks, total };
  });
}
const SUMMARY_ROWS_MAX = 200;
async function dataSection({ c, view }) {
  const data = await summaryData(c.db, c);
  const col = AT.data.cols;
  let shown = 0;
  const lines = [];
  for (const st of data) {
    for (const w of st.weeks) {
      if (shown++ < SUMMARY_ROWS_MAX) lines.push(`<tr><td>${esc(st.name)}</td><td>${esc(w.week)}</td><td>${w.booked}</td><td>${w.attended}</td><td>${w.absent}</td><td>${w.cancelled}</td><td>${w.unmarked}</td><td></td></tr>`);
    }
    lines.push(`<tr class="sum-total"><th scope="row">${esc(st.name)}</th><th scope="row">${esc(AT.data.totalLabel)}</th><td>${st.total.booked}</td><td>${st.total.attended}</td><td>${st.total.absent}</td><td>${st.total.cancelled}</td><td>${st.total.unmarked}</td><td>${st.target === null ? "" : st.target}</td></tr>`);
  }
  const hidden = shown - SUMMARY_ROWS_MAX;
  const table = lines.length
    ? `<div class="table-wrap"><table class="sum"><thead><tr>${["study", "week", "booked", "attended", "absent", "cancelled", "unmarked", "target"].map((k) => `<th scope="col">${esc(col[k])}</th>`).join("")}</tr></thead><tbody>${lines.join("")}</tbody></table></div>${hidden > 0 ? `<p class="note">${esc(AT.data.more(SUMMARY_ROWS_MAX))}</p>` : ""}`
    : `<p class="note">${esc(AT.data.empty)}</p>`;
  return `<h2 class="sec-title" id="sec-data">${esc(AT.sectionTitle.data)}</h2>
<div class="adm-stack">
<p>${esc(AT.data.intro)}</p>
<section class="surface data-block" id="datos-resumen" aria-labelledby="dt-sum"><h3 id="dt-sum">${esc(AT.data.summaryTitle)}</h3>
<p><strong class="pd pd-no">${esc(AT.data.noPersonal)}</strong></p><p class="note">${esc(AT.data.summaryNote)}</p>${table}
<p class="btnrow"><a class="btn-link" href="/admin/csv-resumen">${esc(AT.data.summaryCsv)}</a></p><p class="note">${esc(AT.data.csvNote)}</p></section>
<section class="surface data-block" id="datos-reservas" aria-labelledby="dt-book"><h3 id="dt-book">${esc(AT.data.bookingsTitle)}</h3>
<p><strong class="pd pd-yes">${esc(AT.data.personal)}</strong></p><p class="note">${esc(AT.data.bookingsNote(C.bookingRetentionDays))}</p>
<p class="btnrow"><a class="btn-link" href="/admin/csv">${esc(AT.data.bookingsCsv)}</a></p></section>
<section class="surface data-block" id="datos-contactos" aria-labelledby="dt-con"><h3 id="dt-con">${esc(AT.data.contactsTitle)}</h3>
<p><strong class="pd pd-yes">${esc(AT.data.personal)}</strong></p><p class="note">${esc(AT.data.contactsNote(C.contactMonths))}</p>
<p class="btnrow"><a class="btn-link" href="/admin/csv-contactos">${esc(AT.data.contactsCsv)}</a></p></section>
</div>`;
}

// ---- section: settings ----------------------------------------------------------------------------------------------------------
async function settingsSection({ env, c, view, csrf, relay }) {
  const { db } = c;
  const times = await D.getDefaultTimes(db);
  const brk = await D.getBreak(db);
  // ---- ajustes ----
  const ts = !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET);
  let cron = null;
  try { cron = JSON.parse((await D.getSetting(db, "cron_result")) || "null"); } catch { cron = null; }
  const cronAt = cron && typeof cron.at === "string" ? Date.parse(cron.at) : NaN;
  const cronOk = relay && Number.isFinite(cronAt) && c.nowMs - cronAt < 26 * 3600_000;
  let fail = null;
  try { fail = JSON.parse((await D.getSetting(db, "mail_fail_last")) || "null"); } catch { fail = null; }
  const tsNote = async (k) => { try { const v = JSON.parse((await D.getSetting(db, k)) || "null"); return v && typeof v.at === "string" && Number.isFinite(Date.parse(v.at)) ? v : null; } catch { return null; } };
  const tsOk = ts ? await tsNote("ts_ok_last") : null, tsFail = ts ? await tsNote("ts_fail_last") : null;
  const instantOn = relay && (await D.getConfirmMode(db)) === "instant";
  const mails24 = relay ? await D.mailsAllSince(db, new Date(c.nowMs - 86400_000).toISOString()) : 0;
  const li = (ok, t) => `<li class="${ok ? "ok" : "todo"}">${esc(ok ? AT.set.ready : AT.set.todo)}: ${esc(t)}</li>`;
  // The anonymous usage count (src/usage.js): on or off, what is sent, when it was last sent, how to switch it off.
  const pingAt = await D.getSetting(db, "usage_ping_at");
  const usageText = AT.set.usage(C.usageCount, Number.isFinite(Date.parse(pingAt || "")) ? stampLocal(pingAt) : null);
  const cronText = AT.set.cron(Number.isFinite(cronAt) ? stampLocal(cron.at) : null, Number(cron && cron.sent) || 0, Number(cron && cron.failed) || 0);
  const settings = `<details class="surface settings"${C.unconfigured.length || view.s === "settings" ? " open" : ""}><summary>${esc(AT.set.summary)}</summary>
<div class="set-body">
<form method="post" action="/admin/do">${hid(csrf, view)}
<h3>${esc(AT.set.confirmTitle)}</h3>
<p class="note">${esc(AT.set.confirmNote)}</p>
<p class="btnrow"><button name="do" value="confirm-mode:instant" class="${instantOn ? "on" : "plain"}" aria-pressed="${instantOn}"${relay ? "" : " disabled"}>${esc(AT.set.instant)}</button>
<button name="do" value="confirm-mode:email" class="${relay && !instantOn ? "on" : "plain"}" aria-pressed="${relay && !instantOn}"${relay ? "" : " disabled"}>${esc(AT.set.byMail)}</button></p>
${relay ? "" : `<p class="note">${esc(AT.set.noRelayConfirm)}</p>`}
<h3>${esc(AT.set.timesTitle)}</h3>
<p class="field"><label for="times">${esc(AT.set.timesLabel)}</label>
<input id="times" name="times" type="text" value="${esc(times.join(", "))}"></p>
<p><button name="do" value="times" class="plain">${esc(AT.set.timesSave)}</button></p>
<p class="note">${esc(AT.set.noticeNote)}</p>
</form>
<form method="post" action="/admin/do" class="break-form">${hid(csrf, view)}
<h3>${esc(AT.set.breakTitle)}</h3>
<p class="field"><label for="break-from">${esc(AT.set.breakFrom)}</label><input id="break-from" name="break_from" type="time" required value="${esc(brk ? brk.from : "")}">
<label for="break-until">${esc(AT.set.breakUntil)}</label><input id="break-until" name="break_until" type="time" required value="${esc(brk ? brk.until : "")}"></p>
<p class="btnrow"><button name="do" value="break-on" class="plain">${esc(AT.set.breakSave)}</button>${brk ? ` <button name="do" value="break-off" class="plain" formnovalidate>${esc(AT.set.breakRemove)}</button>` : ""}</p>
<p class="note">${esc(AT.set.breakNote)}</p>
</form>
<form method="post" action="/admin/do">${hid(csrf, view)}
<h3>${esc(AT.set.toolsTitle)}</h3>
<p class="btnrow"><a class="btn-link" href="/admin/csv">${esc(AT.set.exportCsv)}</a>
<button name="do" value="remind" class="plain"${relay ? "" : " disabled"}>${esc(AT.set.remind)}</button>
<button name="do" value="testmail" class="plain"${relay ? "" : " disabled"}>${esc(AT.set.testMail)}</button></p>
<p class="note">${esc(AT.set.retention)}</p>
${relay ? "" : `<p class="note">${esc(AT.set.needRelayTools)}</p>`}
</form>
<h3>${esc(AT.set.usageTitle)}</h3>
<p class="note" id="usage-count">${esc(usageText)}</p>
<h3>${esc(AT.set.setupTitle)}</h3><ul class="check-list">
${li(String(env.ADMIN_PASSWORD).length >= 16, AT.set.password)}
${li(relay, AT.set.relay)}
${fail && fail.at ? `<li class="todo">${esc(AT.set.lastFailure(stampLocal(fail.at), fail.error))}</li>` : ""}
${relay ? `<li class="${mails24 < MAIL_DAY_MAX ? "ok" : "todo"}">${esc(AT.set.mails24(mails24, MAIL_DAY_MAX, MAIL_ADMIN_SKIP))}</li>` : ""}
${li(ts, AT.set.turnstile(ts, !!tsOk, tsOk ? stampLocal(tsOk.at) : null, tsFail ? `${stampLocal(tsFail.at)} (${AT.set.tsReason(tsFail.why)})` : null))}
${li(cronOk, cronText)}
${li(true, AT.set.publicUrl(baseUrl(env), baseUrlSource(env)))}${C.unconfigured.map((k) => `\n${li(false, AT.set.unconfigured(k))}`).join("")}${C.privacyReviewed ? "" : `\n${li(false, AT.set.privacyReview)}`}
</ul></div></details>`;

  return `<div class="o-set">${settings}</div>`;
}
