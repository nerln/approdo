// The application: bookings for a lab study. src/index.js is the Worker entry point and only calls handle().
import * as D from "./db.js";
import { EMAIL_RE, NAME_BAD, scrubErr, isDisposable, emailKey, hmacHex, safeEqual } from "./util.js";
import { signForm, checkForm } from "./auth.js";
import { handleAdmin } from "./admin.js";
import { relayOn, sendLogged, sendReminders, tplConfirmRequest, tplConfirmed, tplAdmin, adminEmail, buildIcs, baseUrl, MAIL_DAY_MAX, MAIL_ADMIN_SKIP } from "./mail.js";
import * as P from "./pages.js";
import { T, langCtx, lk, mailText } from "./i18n.js";
import { C, LANGS, normLang } from "./config.js";
import { ownTitle, usesConfigNames } from "./studies.js";
import { requestEnv } from "./env.js";
import { maybeReport } from "./usage.js";
import { ensureSchema } from "./migrate.js";
import { canonicalPath, icsFileName } from "./paths.js";
import { themeCss } from "./theme.js";
import { nowLocal, addDays, localToMinutes, localToUtc, isRealDate, TIME_RE, DAYS_AHEAD, MIN_NOTICE_HOURS, SHORT_NOTICE_MIN, SHORT_GRACE_MIN, SLOT_MINUTES, flexStarts, flexAllows, hhmmToMin, minToHhmm, inBreak, breakMinutes } from "./slots.js";

const RATE_MAX = 20; // una clase en la red del campus comparte una sola direccion
const RATE_WINDOW_MS = 10 * 60_000;
const PENDING_MS = 2 * 3600_000;
const CODE_ALL_MAX = 30; // techo por correo desde cualquier IP, contra quien reparte los intentos
const CODE_ALL_WINDOW_MS = 60 * 60_000;
const VERIFY_MAX = 3; // intentos por hora de confirmar el correo con el enlace del mensaje, por reserva y desde cualquier dirección
const VERIFY_WINDOW_MS = 60 * 60_000;
const CODE_MAX = 5; // intentos de codigo fallidos por correo en CODE_WINDOW_MS
const CODE_WINDOW_MS = 15 * 60_000;
const MAIL_BRAKE_MAX = 30; // peticiones de confirmacion por hora en todo el sitio: protege la cuota diaria del correo
const mails24h = (c) => D.mailsAllSince(c.db, new Date(c.nowMs - 86400_000).toISOString());
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function securityHeaders(env) {
  const ts = !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET);
  const cf = "https://challenges.cloudflare.com";
  return {
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'self'${ts ? " " + cf : ""}`,
      "style-src 'self'",
      "img-src 'self' data:",
      `connect-src 'self'${ts ? " " + cf : ""}`,
      ts ? `frame-src ${cf}` : "frame-src 'none'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "strict-transport-security": "max-age=31536000",
  };
}
function withHeaders(env, res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(securityHeaders(env))) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Accept-Language" } });

const BODY_MAX = 20_000; // bytes: ningun formulario publico se acerca
const SMALL_BODY = /^\/(reservar|gestionar|baja|admin\/login|cron\/remind)$/;
const NOINDEX = /^\/(admin(\/.*)?|gestionar|baja|c\/[^/]+|x\/[^/]+|ics\/[^/]+)$/;
const DYNAMIC = new RegExp(`^/(admin(/.*)?|${LANGS.join("|")}|reservar|gestionar|baja|condiciones|privacidad|cron\/remind|c\/[^/]+|x\/[^/]+|ics/[^/]+)?$`);

// ctx: now, fetchFn and ignoreUnconfigured are for the tests and the local preview only (the suites that exercise bookings with the
// shipped example values need ignoreUnconfigured, or every booking would be refused). waitUntil is the one member the Worker passes
// (src/index.js): the anonymous usage count of src/usage.js runs only when it is there, so the tests and the preview never report.
export async function handle(request, rawEnv, ctx = {}) {
  const url = new URL(request.url);
  // One copy of env per request: settings left at their placeholder removed, an admin password that is too short removed, and
  // the origin of this request, which every link falls back on when neither BASE_URL nor baseUrl is set (see baseUrl in mail.js).
  const env = requestEnv(rawEnv, url);
  const now = ctx.now || new Date();
  // Public paths have English aliases (/terms, /privacy, /book, /manage, /unsubscribe): everything below, the body limits,
  // noindex, the dynamic-path check and the router, sees the canonical (Spanish) path, so an alias is treated exactly like its original.
  const path = canonicalPath(url.pathname);
  const L = langCtx(request, url);
  let res;
  try {
    if (path === "/theme.css" && ["GET", "HEAD"].includes(request.method)) {
      // The accent colour of site.config.js as a stylesheet (the pages carry no style attribute). It changes only when the site is deployed.
      res = new Response(request.method === "HEAD" ? null : themeCss(C.accent, C.palette), { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" } });
    } else if (!DYNAMIC.test(path)) {
      res = env.ASSETS && ["GET", "HEAD"].includes(request.method) ? await env.ASSETS.fetch(request) : null;
      // No such file (the asset binding answers 404 with an empty body), or no asset binding at all: the normal "not found" page.
      if (!res || res.status === 404) res = html(P.gonePage(env, L, T[L.lang].notFound), 404);
    } else if (!env.DB) {
      res = html(P.messagePage(env, L, T[L.lang].unavailTitle, T[L.lang].unavailP), 503);
    } else {
      if (request.method === "POST" && SMALL_BODY.test(path) && Number(request.headers.get("content-length") || 0) > BODY_MAX)
        return withHeaders(env, new Response("Payload too large", { status: 413, headers: { "cache-control": "no-store" } }));
      await ensureSchema(env.DB); // a new database gets its tables here, an old one its upgrades; free after the first request
      const nowMs = now.getTime();
      const loc = nowLocal(now);
      const c = {
        db: env.DB, now, nowMs, today: loc.date, nowTime: loc.time, fetchFn: ctx.fetchFn || ((...a) => fetch(...a)),
        waitUntil: typeof ctx.waitUntil === "function" ? ctx.waitUntil : null,
        // Still holding the shipped example values: no booking is taken (the admin panel works and lists what to edit).
        unconfigured: C.unconfigured.length > 0 && !ctx.ignoreUnconfigured,
        ipKey: async (req) => D.ipHash(env.DB, req.headers.get("cf-connecting-ip") || "local", now.toISOString().slice(0, 10)),
      };
      await D.cleanup(c.db, nowMs, c.today);
      res = await route(request, env, c, url, path, L);
    }
  } catch (e) {
    console.error("error", e && e.message);
    res = html(P.messagePage(env, L, T[L.lang].errTitle, T[L.lang].errP), 500);
  }
  const out = withHeaders(env, res);
  if (NOINDEX.test(path)) out.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return out;
}

async function route(request, env, c, url, path, L) {
  const m = request.method;
  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, c);
  // Direcciones cortas para los carteles: /es, /en, /it (solo los idiomas configurados) abren el inicio en ese idioma.
  if (/^\/[a-z]{2}$/.test(path) && LANGS.includes(path.slice(1)) && (m === "GET" || m === "HEAD"))
    return new Response(null, { status: 302, headers: { location: `/?lang=${path.slice(1)}`, "cache-control": "no-store" } });
  if (path === "/" && m === "GET") return renderIndex(env, c, L);
  if (path === "/condiciones" && m === "GET") return html(P.termsPage(env, L));
  if (path === "/privacidad" && m === "GET") return html(P.privacyPage(env, L, { instant: await instantMode(env, c) }));
  if (path === "/reservar") return m === "POST" ? book(request, env, c, L) : new Response(null, { status: 303, headers: { location: lk(L, "/") } });
  if (path === "/gestionar") return manage(request, env, c, L);
  if (path === "/baja") return unsubscribe(request, env, c, L);
  if (path === "/cron/remind") return m === "POST" ? cronRemind(request, env, c) : new Response(null, { status: 405 });

  const t = path.match(/^\/(c|x|ics)\/([^/]+)$/);
  if (t) {
    const [, kind, token] = t;
    const b = TOKEN_RE.test(token) ? await D.bookingByToken(c.db, token) : null;
    if (!b) return html(P.gonePage(env, L), 404);
    if (m === "POST") {
      // Confirmar y cancelar mandan correos: tope por direccion, aparte del de reservar.
      const k = "t:" + (await c.ipKey(request));
      if ((await D.countSince(c.db, "rate_limit", k, c.nowMs - RATE_WINDOW_MS)) >= RATE_MAX * 2) return html(P.messagePage(env, L, T[L.lang].rateTitle, T[L.lang].rateP), 429);
      await D.addHit(c.db, "rate_limit", k, c.nowMs);
    }
    // Idioma de la página: el elegido con ?lang y, si no, el de la reserva.
    const BL = L.explicit ? L : { lang: normLang(b.lang), explicit: true };
    if (kind === "ics") {
      if (!["confirmed", "attended"].includes(b.status)) return html(P.gonePage(env, BL), 404);
      return new Response(buildIcs(env, { ...b, lang: BL.lang }, localToUtc), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${icsFileName(BL.lang)}"`, "cache-control": "no-store" } });
    }
    if (kind === "c") return confirm(env, c, b, m, BL, url.searchParams.get("k") || "");
    return cancel(env, c, b, m, BL);
  }
  return html(P.gonePage(env, L, T[L.lang].notFound), 404);
}

// ---- recordatorios automáticos ----------------------------------------------
// A Worker could use a cron trigger, but the mail relay (Apps Script) already runs daily: el Apps Script del relay llama aquí una vez al día (función recordatorios),
// firmado con la misma clave del relay. Manda los recordatorios de mañana que falten.
async function cronRemind(request, env, c) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!relayOn(env)) return json({ ok: false, error: "no relay" }, 503);
  const raw = await request.text();
  const sig = (new URL(request.url).searchParams.get("sig") || "").toLowerCase();
  if (!sig || !safeEqual(await hmacHex(env.MAIL_RELAY_KEY, raw), sig)) return json({ ok: false, error: "bad signature" }, 403);
  let ts = 0;
  try { ts = Number(JSON.parse(raw).ts) || 0; } catch { ts = 0; }
  if (!ts || Math.abs(c.nowMs - ts) > 5 * 60_000) return json({ ok: false, error: "stale" }, 403);
  const { sent, failed } = await sendReminders(env, c);
  await D.setSetting(c.db, "cron_result", JSON.stringify({ at: c.now.toISOString(), sent, failed }));
  await maybeReport(c); // the signed daily call of the relay is the other trigger of the anonymous usage count (never a participant's request)
  return json({ ok: true, sent, failed });
}

// ---- inicio ---------------------------------------------------------------
// Datos del turno flexible de hoy (null si no está activado): ventana, hora actual y reservas vivas de hoy.
export async function flexToday(c) {
  const f = await D.getFlex(c.db, c.today);
  if (!f) return null;
  const busy = (await D.bookingsBetween(c.db, c.today, c.today)).filter((b) => b.status !== "cancelled").map((b) => hhmmToMin(b.time));
  return { nowMin: hhmmToMin(c.nowTime), fromMin: hhmmToMin(f.from), untilMin: hhmmToMin(f.until), busy, brk: breakMinutes(await D.getBreak(c.db)) };
}

// `grace`: minutos de margen al validar un envío (la página que la persona tiene abierta puede tener unos minutos).
async function loadDays(c, { grace = 0 } = {}) {
  const { db, today } = c;
  const to = addDays(today, DAYS_AHEAD);
  const slots = await D.slotsBetween(db, today, to);
  // A slot is not offered when a live booking of the same day starts less than SLOT_MINUTES from it (the same rule
  // insertBooking enforces), so with a buffer between sessions a booked slot also hides its neighbours that overlap it.
  const busyBy = new Map();
  for (const b of await D.bookingsBetween(db, today, to)) {
    if (b.status === "cancelled") continue;
    if (!busyBy.has(b.date)) busyBy.set(b.date, []);
    busyBy.get(b.date).push(hhmmToMin(b.time));
  }
  const clash = (date, time) => (busyBy.get(date) || []).some((m) => Math.abs(hhmmToMin(time) - m) < SLOT_MINUTES);
  const nowMin = localToMinutes(today, c.nowTime);
  const minMin = nowMin + MIN_NOTICE_HOURS * 60;
  // Días con la excepción activada en el panel: sin las 12 h, hasta SHORT_NOTICE_MIN minutos antes de cada franja.
  // Las 12 h solo alcanzan a hoy y mañana.
  const short = await D.noNoticeDays(db, today, addDays(today, 1));
  const shortMin = nowMin + SHORT_NOTICE_MIN - grace;
  // The daily break: a fixed slot whose session overlaps it is not offered (the row stays in day_slots).
  const brk = breakMinutes(await D.getBreak(db));
  const map = new Map();
  for (const s of slots) {
    if (clash(s.date, s.time) || inBreak(hhmmToMin(s.time), brk) || localToMinutes(s.date, s.time) < (short.has(s.date) ? shortMin : minMin)) continue;
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push(s.time);
  }
  // `short`: hoy con la excepción, para que la página diga que el plazo de confirmación acaba al empezar el turno.
  const days = [...map].map(([date, slots]) => (date === today && short.has(date) ? { date, slots, short: true } : { date, slots }));
  // Hoy con "Disponible hoy": solo los inicios flexibles, y hoy va el primero aunque no esté en `days`.
  const fx = await flexToday(c);
  const starts = fx ? flexStarts(fx) : [];
  // Con flex activado nunca se ofrecen las franjas fijas de hoy: book() solo acepta los inicios flexibles.
  if (fx) {
    const rest = days.filter((d) => d.date !== today);
    return starts.length ? [{ date: today, slots: starts.map(minToHhmm), flex: true }, ...rest] : rest;
  }
  return days;
}

// ¿Las reservas se confirman al momento? Solo cuenta con el correo activado (sin correo siempre es al momento).
const instantMode = async (env, c) => relayOn(env) && (await D.getConfirmMode(c.db)) === "instant";

async function renderIndex(env, c, L, { error, errorField, values, status = 200 } = {}) {
  const reg = await D.getRegistry(c.db);
  const study = reg.active;
  const days = await loadDays(c);
  const formToken = await signForm(c.db, c.nowMs);
  return html(P.indexPage(env, L, { study, days, formToken, error, errorField, values, instant: await instantMode(env, c), turnstileKey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY : "", unconfigured: c.unconfigured, reg }), status);
}

// ---- reservar -------------------------------------------------------------
// Comprobación contra robots. Cierra en falso: sin respuesta del widget, con error de red o con una respuesta que no
// sea de este formulario (acción) y de esta web (hostname), no se reserva.
export const TURNSTILE_ACTION = "reserva";
// Deja en ajustes la hora de la última comprobación correcta y del último fallo con su motivo (sin datos de nadie),
// para ver en el panel si a la gente le está funcionando.
async function verifyTurnstile(env, c, token, ip) {
  const note = async (ok, why = "") => {
    try { await D.setSetting(c.db, ok ? "ts_ok_last" : "ts_fail_last", JSON.stringify({ at: c.now.toISOString(), why: String(why).slice(0, 80) })); } catch { /* solo diagnóstico */ }
    return ok;
  };
  if (typeof token !== "string" || token.length === 0) return note(false, "sin respuesta del widget");
  if (token.length > 2048) return note(false, "respuesta demasiado larga");
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    // fetch se llama suelto, nunca como método de `c`: en Workers, fetch con otro `this` lanza «Illegal invocation».
    const doFetch = c.fetchFn;
    const r = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return note(false, `http ${r.status}`);
    const j = await r.json();
    if (!j || j.success !== true) return note(false, Array.isArray(j && j["error-codes"]) ? j["error-codes"].join(",") : "rechazada");
    if (j.action !== TURNSTILE_ACTION) return note(false, "otra acción");
    if (j.hostname !== new URL(baseUrl(env)).hostname) return note(false, "otro dominio");
    return note(true);
  } catch {
    return note(false, "sin conexión con Cloudflare");
  }
}

async function book(request, env, c, L) {
  const S = T[L.lang];
  if (c.unconfigured) return html(P.messagePage(env, L, S.unconfTitle, S.unconfP), 503);
  const { db, nowMs } = c;
  const k = await c.ipKey(request);
  if ((await D.countSince(db, "rate_limit", k, nowMs - RATE_WINDOW_MS)) >= RATE_MAX)
    return html(P.messagePage(env, L, S.rateTitle, S.rateP), 429);
  await D.addHit(db, "rate_limit", k, nowMs);

  const f = await request.formData();
  const get = (x) => String(f.get(x) ?? "").trim();
  // Honeypot: un robot rellena este campo. Respuesta como si todo fuera bien, sin guardar nada.
  if (get("web") !== "") return html(P.pendingPage(env, L, get("email")));

  const values = { slot: get("slot"), name: get("name"), email: get("email"), noepi: get("noepi"), vestibular: get("vestibular"), accept: get("accept"), future: get("future") };
  // Solo "1" (lo que manda la casilla) cuenta como consentimiento: cualquier otro valor se ignora.
  values.future = values.future === "1" ? "1" : "";
  const redo = (msg, status = 400, field = "") => renderIndex(env, c, L, { error: msg, errorField: field, values, status });

  const tf = await checkForm(db, get("t"), nowMs, "form");
  if (tf === "fast") return redo(S.err.tooFast);
  if (tf !== "ok") return redo(S.err.expired);

  // La comprobación contra robots solo bloquea cuando ya ha funcionado al menos una vez en esta web (ts_ok_last):
  // si algo de la integración falla para todo el mundo, nadie se queda sin poder reservar; el motivo queda en ajustes.
  if (env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET) {
    const human = await verifyTurnstile(env, c, get("cf-turnstile-response"), request.headers.get("cf-connecting-ip"));
    if (!human && (await D.getSetting(db, "ts_ok_last"))) return redo(S.err.human);
  }

  const reg = await D.getRegistry(db);
  const study = reg.active;
  const [date, time] = values.slot.split("T");
  if (!isRealDate(date || "") || !TIME_RE.test(time || "")) return redo(S.err.pick, 400, "slot");
  if (values.name.length < 1 || values.name.length > 40) return redo(S.err.name, 400, "name");
  if (NAME_BAD.test(values.name)) return redo(S.err.nameChars, 400, "name");
  if (values.email.length > 120 || !EMAIL_RE.test(values.email)) return redo(S.err.email, 400, "email");
  if (isDisposable(values.email)) return redo(S.err.disposable, 400, "email");
  // The declarations asked by the form (site.config.js: declarations, twoStudies) are checked here as well, not only in the browser.
  const decl = D.declarationsOf(reg, study);
  if (decl.epilepsy && !values.noepi) return redo(S.err.noepi, 400, "noepi");
  if (decl.vestibular && !values.vestibular) return redo(S.err.vest, 400, "vestibular");
  if (!values.accept) return redo(S.err.accept, 400, "accept");

  // Hoy con turnos flexibles: regla dura con datos frescos. Cualquier otra franja, la validación de siempre.
  const fx = date === c.today ? await flexToday(c) : null;
  const free = fx ? flexAllows({ startMin: hhmmToMin(time), ...fx }) : (await loadDays(c, { grace: SHORT_GRACE_MIN })).some((d) => d.date === date && d.slots.includes(time));
  if (!free) return redo(S.err.taken, 409, "slot");

  const key = emailKey(values.email);
  if (await D.hasLiveEmail(db, key)) return redo(mailText(L.lang, "err.liveEmail", relayOn(env)), 409, "email");
  if (await D.hasAttended(db, key, study)) return redo(S.err.attended, 409, "email");

  const useRelay = relayOn(env);
  // Con el correo activado hay dos maneras de confirmar (ajuste del panel): por correo, con enlace o código en 2 horas,
  // o al momento. Al momento, la reserva nace confirmada y el único correo es el de «turno confirmado».
  const instant = useRelay && (await D.getConfirmMode(db)) === "instant";
  // Freno global: cuantos correos de reserva salieron en la ultima hora, vengan de donde vengan.
  if (useRelay && (await D.mailsSince(db, instant ? "confirmed" : "confirm_request", new Date(nowMs - 3600_000).toISOString())) >= MAIL_BRAKE_MAX)
    return html(P.messagePage(env, L, S.rateTitle, S.rateP), 429);
  if (useRelay && (await mails24h(c)) >= MAIL_DAY_MAX) return html(P.messagePage(env, L, S.dayFullTitle, S.dayFullP), 429);
  const b = {
    id: crypto.randomUUID(), token: D.newToken(), study, date, time, name: values.name, email: values.email, email_key: key,
    status: useRelay && !instant ? "pending" : "confirmed", created_at: c.now.toISOString(), lang: L.lang,
    // Una reserva sin confirmar nunca retiene el hueco más allá del inicio del turno (turnos de hoy con poca antelación).
    expires_at: useRelay && !instant ? new Date(Math.min(nowMs + PENDING_MS, localToUtc(date, time).getTime())).toISOString() : null,
  };
  const r = await D.insertBooking(db, b);
  if (!r.ok) return redo(r.reason === "email" ? S.err.raceEmail : S.err.raceSlot, 409, r.reason === "email" ? "email" : "slot");
  // Casilla opcional de avisos: fila sin confirmar; con el correo apagado la reserva ya esta confirmada y la fila tambien.
  // Confirmada al momento: nadie ha comprobado el correo, así que la fila espera a que la persona venga (el panel la
  // confirma al marcar «Asistió»); si cancela o no viene, la limpieza la borra.
  if (values.future === "1") {
    await D.contactRequest(db, key, values.email, L.lang, b.id, c.now.toISOString(), instant ? `${addDays(date, 31)}T00:00:00.000Z` : null);
    if (!useRelay) await D.contactConfirm(db, b.id, c.now.toISOString());
  }

  if (instant) {
    const code = await D.bookingCode(db, b);
    // Si el correo falla la reserva sigue confirmada: la página siguiente tiene todo lo necesario.
    const res = await sendLogged(env, c, b.id, "confirmed", { to: b.email, ...tplConfirmed(env, b, { code, instant: true }) });
    if (!res.ok) await D.setSetting(db, "mail_fail_last", JSON.stringify({ at: c.now.toISOString(), error: scrubErr(res.error) }));
    if ((await mails24h(c)) < MAIL_ADMIN_SKIP) await sendLogged(env, c, b.id, "admin", { to: adminEmail(env), ...tplAdmin(env, "confirmed", await withStudyLabel(c.db, b)) });
    const listed = await onList(db, b);
    // Sin el código en la página: solo va en el correo, para que escribirlo o pulsar su botón demuestre que el correo llega.
    return html(P.bookedPage(env, L, b, { justConfirmed: true, mailFailed: !res.ok, onList: listed, listLater: values.future === "1" && !listed, verifyHint: res.ok, instant: true, studyTitle: await studyTitleFor(db, b, L.lang) }));
  }

  if (useRelay) {
    const code = await D.bookingCode(db, b);
    const res = await sendLogged(env, c, b.id, "confirm_request", { to: b.email, ...tplConfirmRequest(env, b, { code }) });
    if (!res.ok) {
      await D.deleteBooking(db, b.id);
      await D.contactDropPending(db, b.id);
      await D.setSetting(db, "mail_fail_last", JSON.stringify({ at: c.now.toISOString(), error: scrubErr(res.error) }));
      return redo(S.err.mail, 502);
    }
    return html(P.pendingPage(env, L, b.email, b, { formToken: await signForm(db, nowMs, "manage") }));
  }
  return html(P.bookedPage(env, L, b, { code: await D.bookingCode(db, b), onList: await onList(db, b), studyTitle: await studyTitleFor(db, b, L.lang) }));
}

// The notice to the researcher names the study only when the studies come from the panel and there is more than one: by its own public
// title in the language of the booking when it has one, else by its name.
async function withStudyLabel(db, b) {
  const reg = await D.getRegistry(db);
  if (!reg.table) return b;
  const x = reg.studies.find((y) => y.id === b.study);
  const own = x ? ownTitle(x, normLang(b.lang)) : "";
  // Studies still as the configuration defines them, with no title of their own: the notice says what it always said ("Study 1").
  if (usesConfigNames(reg) && !own) return b;
  return { ...b, studyLabel: x && reg.studies.length > 1 ? own || x.name : own };
}
// The study's own public title, to name the study on the booking pages ("" when it has none: those pages say nothing of the study).
async function studyTitleFor(db, b, lang) {
  const reg = await D.getRegistry(db);
  const x = reg.table ? reg.studies.find((y) => y.id === b.study) : null;
  return x ? ownTitle(x, lang) : "";
}

// ¿Esta persona esta (o esta a punto de estar) en la lista de avisos? Sin tabla: no.
// Solo cuenta el contacto confirmado: la fila pendiente se borra sola y aun no es un consentimiento.
const onList = async (db, b) => { const r = await D.contactByKey(db, b.email_key); return !!(r && r.confirmed === 1); };

// ---- confirmar y cancelar (el GET solo muestra; el POST cambia) ------------
// Confirma una reserva pendiente y manda los correos. Lo usan el enlace (/c/<token>) y el codigo (/gestionar):
// los dos caminos hacen exactamente lo mismo. Devuelve null si ya no estaba pendiente o caduco.
async function confirmNow(env, c, b) {
  if (!(b.status === "pending" && b.expires_at >= c.now.toISOString() && (await D.setStatus(c.db, b.id, "confirmed", ["pending"])))) return null;
  const fresh = { ...b, status: "confirmed", verified_at: b.verified_at || c.now.toISOString() };
  // Confirmar por correo ya demuestra que el correo llega.
  await D.markVerified(c.db, b.id, c.now.toISOString());
  await D.contactConfirm(c.db, b.id, c.now.toISOString());
  const code = await D.bookingCode(c.db, b);
  let mailFailed = false;
  if (relayOn(env)) {
    // Si el correo falla la reserva sigue confirmada: el fallo queda en el registro de correos.
    mailFailed = !(await sendLogged(env, c, b.id, "confirmed", { to: b.email, ...tplConfirmed(env, fresh, { code }) })).ok;
    if ((await mails24h(c)) < MAIL_ADMIN_SKIP) await sendLogged(env, c, b.id, "admin", { to: adminEmail(env), ...tplAdmin(env, "confirmed", await withStudyLabel(c.db, fresh)) });
  }
  return { fresh, mailFailed, code };
}

// Una reserva confirmada al momento puede, si la persona quiere, confirmar su correo: demuestra que el mensaje le llega
// presentando el código, que solo viaja por correo (en el enlace del mensaje o escrito en «Gestionar mi reserva»).
// Devuelve true si ha quedado confirmado ahora. También apunta a la lista de avisos a quien lo pidió al reservar.
async function verifyNow(c, b) {
  if (!["confirmed", "attended"].includes(b.status) || b.verified_at) return false;
  if (!(await D.markVerified(c.db, b.id, c.now.toISOString()))) return false;
  await D.contactConfirm(c.db, b.id, c.now.toISOString());
  return true;
}

async function confirm(env, c, b, method, L, k = "") {
  // El enlace del mensaje trae el código de la reserva. Mostrar la página (GET) no depende de que el código sea el bueno,
  // para que no sirva de oráculo; el código solo se comprueba al pulsar el botón (POST), con los intentos contados por reserva.
  const typed = D.parseCode(k);
  const confirmed = b.status === "confirmed" || b.status === "attended";
  if (method === "POST") {
    const r = await confirmNow(env, c, b);
    if (r) return html(P.bookedPage(env, L, r.fresh, { justConfirmed: true, mailFailed: r.mailFailed, code: r.code, onList: await onList(c.db, b), studyTitle: await studyTitleFor(c.db, b, L.lang) }));
    if (typed && confirmed && !b.verified_at) {
      const vk = "cv:" + (await hmacHex(await D.getKey(c.db), "verify:" + b.token)).slice(0, 32);
      await D.addHit(c.db, "rate_limit", vk, c.nowMs);
      if ((await D.countSince(c.db, "rate_limit", vk, c.nowMs - VERIFY_WINDOW_MS)) > VERIFY_MAX) return html(P.messagePage(env, L, T[L.lang].rateTitle, T[L.lang].errCodeRate), 429);
      if (safeEqual(typed, await D.bookingCode(c.db, b)) && (await verifyNow(c, b)))
        return html(P.bookedPage(env, L, { ...b, verified_at: c.now.toISOString() }, { justConfirmed: true, verifiedNow: true, code: typed, onList: await onList(c.db, b), studyTitle: await studyTitleFor(c.db, b, L.lang) }));
    }
  } else if (method !== "GET") {
    return new Response(null, { status: 405 });
  }
  const live = b.status === "pending" && b.expires_at >= c.now.toISOString() ? "pending" : confirmed ? (typed && !b.verified_at && method === "GET" ? "verify" : "confirmed") : "gone";
  return html(P.confirmPage(env, L, b, live, { k: typed || "", studyTitle: await studyTitleFor(c.db, b, L.lang) }), live === "gone" ? 410 : 200);
}

// ---- gestionar con el codigo de 6 cifras -------------------------------------------
// Para quien no recibe el enlace (el filtro de la universidad lo descarta) y para quien perdio el correo.
async function manage(request, env, c, L) {
  const S = T[L.lang];
  const { db, nowMs } = c;
  const formPage = async (opts, status = 200) => html(P.managePage(env, L, { ...opts, formToken: await signForm(db, nowMs, "manage") }), status);
  if (request.method === "GET") return formPage({});
  if (request.method !== "POST") return new Response(null, { status: 405 });

  // (a) mismo tope por direccion IP que reservar, pero con su propia cuenta para que gestionar no gaste el cupo de reservas.
  // El intento se reserva antes de evaluarlo (insertar y luego contar): asi las peticiones simultaneas no se cuelan.
  const k = "m:" + (await c.ipKey(request));
  await D.addHit(db, "rate_limit", k, nowMs);
  if ((await D.countSince(db, "rate_limit", k, nowMs - RATE_WINDOW_MS)) > RATE_MAX) return html(P.messagePage(env, L, S.rateTitle, S.rateP), 429);

  let f;
  try {
    f = await request.formData();
  } catch {
    return formPage({ error: S.err.expired }, 400);
  }
  const get = (x) => String(f.get(x) ?? "").trim();
  const email = get("email").slice(0, 120);
  // (b) marca de tiempo firmada, sin la espera minima: escribir un codigo es rapido
  const tf = await checkForm(db, get("t"), nowMs, "manage", { minMs: 0 });
  if (tf !== "ok") return formPage({ email, error: S.err.expired }, 400);

  // (c) intentos por correo, sin revelar si el correo tiene reserva. Dos cuentas:
  // por (correo, IP), para que un desconocido no pueda dejar fuera al dueno, y un techo mas amplio por correo.
  const key = email.includes("@") ? emailKey(email) : "";
  const hk = await D.getKey(db);
  const ck = "code:" + (await hmacHex(hk, "codekey:" + key + ":" + k)).slice(0, 32);
  const ca = "codeall:" + (await hmacHex(hk, "codekey:" + key)).slice(0, 32);
  await D.addHit(db, "rate_limit", ck, nowMs);
  await D.addHit(db, "rate_limit", ca, nowMs);
  if (
    (await D.countSince(db, "rate_limit", ck, nowMs - CODE_WINDOW_MS)) > CODE_MAX ||
    (await D.countSince(db, "rate_limit", ca, nowMs - CODE_ALL_WINDOW_MS)) > CODE_ALL_MAX
  ) return html(P.messagePage(env, L, S.rateTitle, S.errCodeRate), 429);

  // (d) misma respuesta para correo desconocido, codigo malo, reserva caducada o sin reserva
  const b = key && EMAIL_RE.test(email) ? await D.liveBookingByEmail(db, key, c.now.toISOString()) : null;
  const typed = D.parseCode(get("code"));
  const real = b ? await D.bookingCode(db, b) : "";
  if (!b || !typed || !safeEqual(typed, real)) return formPage({ email, error: S.errCode }, 400);
  // Acierto: se devuelve el intento reservado.
  await D.dropHit(db, "rate_limit", ck, nowMs);
  await D.dropHit(db, "rate_limit", ca, nowMs);

  // Idioma: el elegido con ?lang y, si no, el de la reserva (como en las paginas con token).
  const BL = L.explicit ? L : { lang: normLang(b.lang), explicit: true };
  // (e) pendiente: se confirma igual que con el enlace
  if (b.status === "pending") {
    const r = await confirmNow(env, c, b);
    if (r) return html(P.bookedPage(env, BL, r.fresh, { justConfirmed: true, mailFailed: r.mailFailed, code: r.code, onList: await onList(db, b), studyTitle: await studyTitleFor(db, b, BL.lang) }));
    return formPage({ email, error: S.errCode }, 400); // caduco o se cancelo justo ahora
  }
  // (f) confirmada: escribir el código demuestra que el correo llega; después, la reserva con sus enlaces
  const verifiedNow = await verifyNow(c, b);
  return html(P.bookedPage(env, BL, verifiedNow ? { ...b, verified_at: c.now.toISOString() } : b, { justConfirmed: true, verifiedNow, code: real, onList: await onList(db, b), studyTitle: await studyTitleFor(db, b, BL.lang) }));
}

// ---- darse de baja de los avisos ---------------------------------------------------------------
// La respuesta es la misma conozcamos la direccion o no: no se revela quien esta en la lista.
async function unsubscribe(request, env, c, L) {
  const S = T[L.lang];
  const { db, nowMs } = c;
  const formPage = async (opts, status = 200) => html(P.unsubscribePage(env, L, { ...opts, formToken: await signForm(db, nowMs, "baja") }), status);
  if (request.method === "GET") return formPage({});
  if (request.method !== "POST") return new Response(null, { status: 405 });
  // Tope propio por IP, como /gestionar: el intento se anota antes de evaluarlo.
  const k = "u:" + (await c.ipKey(request));
  await D.addHit(db, "rate_limit", k, nowMs);
  if ((await D.countSince(db, "rate_limit", k, nowMs - RATE_WINDOW_MS)) > RATE_MAX) return html(P.messagePage(env, L, S.rateTitle, S.rateP), 429);
  let f;
  try { f = await request.formData(); } catch { return formPage({ error: S.err.expired }, 400); }
  const get = (x) => String(f.get(x) ?? "").trim();
  const email = get("email").slice(0, 120);
  if ((await checkForm(db, get("t"), nowMs, "baja", { minMs: 0 })) !== "ok") return formPage({ email, error: S.err.expired }, 400);
  if (!EMAIL_RE.test(email)) return formPage({ email, error: S.err.email }, 400);
  await D.contactRemove(db, emailKey(email));
  return html(P.unsubscribedPage(env, L));
}

async function cancel(env, c, b, method, L) {
  if (method === "POST") {
    if (await D.setStatus(c.db, b.id, "cancelled", ["pending", "confirmed"])) {
      await D.contactDropPending(c.db, b.id); // la peticion de aviso sin confirmar muere con la reserva; un contacto confirmado se queda
      if (relayOn(env)) await sendLogged(env, c, b.id, "admin", { to: adminEmail(env), ...tplAdmin(env, "cancelled_by_participant", await withStudyLabel(c.db, b)) });
      return html(P.cancelledDone(env, L, { onList: await onList(c.db, b) }));
    }
  } else if (method !== "GET") {
    return new Response(null, { status: 405 });
  }
  const live = b.status === "pending" || b.status === "confirmed" ? "live" : "gone";
  return html(P.cancelPage(env, L, b, live, { studyTitle: await studyTitleFor(c.db, b, L.lang) }), live === "gone" ? 410 : 200);
}

// ---- HTTPS only ---------------------------------------------------------------
// A site on *.workers.dev answers on plain HTTP too (without a redirect), and a booking form carries a
// name and an e-mail address. So a request that arrives over HTTP is sent to the same address over HTTPS before the application
// sees it. Local development (wrangler dev on localhost) stays on HTTP.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function httpsRedirect(request) {
  const u = new URL(request.url);
  if (u.protocol !== "http:" || LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith(".localhost")) return null;
  u.protocol = "https:";
  return new Response(null, { status: 301, headers: { location: u.href, "cache-control": "no-store" } });
}
