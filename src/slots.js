// Dates and times. Everything is local time of the configured zone (C.timeZone) as text "YYYY-MM-DD" and "HH:MM".
import { C, LANG_REGISTRY } from "./config.js";
export const TZ = C.timeZone;
const pad = (n) => String(n).padStart(2, "0");

export function localToMinutes(date, time = "00:00") {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
}
export function minutesToLocal(min) {
  const d = new Date(min * 60000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
export function nowLocal(date = new Date(), tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}
export const addDays = (date, n) => minutesToLocal(localToMinutes(date) + n * 1440).date;
export const weekday = (date) => new Date(localToMinutes(date) * 60000).getUTCDay(); // 0 = domingo
// The Monday (ISO week) of the week that holds `date`. A Sunday belongs to the week that ends on it.
export const weekMonday = (date) => addDays(date, -((weekday(date) + 6) % 7));
// The Monday a "this week" action refers to: the week of `date`, except on a Saturday or a Sunday, when it is the coming one.
export const weekToOpen = (date) => (weekday(date) === 6 ? addDays(date, 2) : weekday(date) === 0 ? addDays(date, 1) : weekMonday(date));

// UTC instant (Date) of a local time in the configured zone.
export function localToUtc(date, time) {
  const asUtc = localToMinutes(date, time);
  let guess = asUtc * 60000;
  for (let i = 0; i < 2; i++) {
    const l = nowLocal(new Date(guess));
    guess -= (localToMinutes(l.date, l.time) - asUtc) * 60000;
  }
  return new Date(guess);
}
export const addMinutes = (time, n) => {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + n;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// How much calendar a booking occupies: the session plus the buffer before the next one. Two bookings of one day
// must start at least SLOT_MINUTES apart.
export const SLOT_MINUTES = C.slotMinutes;
// What the person is told the session lasts (the figure in the consent sheet); also the length of the calendar event.
// SLOT_MINUTES - SESSION_MINUTES is the buffer.
export const SESSION_MINUTES = C.sessionMinutes;
export const MIN_NOTICE_HOURS = C.minNoticeHours;
// Excepción de un día concreto (la decide quien investiga en el panel): ese día las franjas fijas se pueden
// reservar hasta SHORT_NOTICE_MIN minutos antes de empezar. Al validar el envío hay SHORT_GRACE_MIN de margen.
export const SHORT_NOTICE_MIN = C.shortNoticeMinutes;
export const SHORT_GRACE_MIN = 5;
export const DAYS_AHEAD = C.daysAhead;
// Start times of a newly opened day (any minutes; at least SLOT_MINUTES apart, validated in config.js).
export const DEFAULT_TIMES = C.defaultTimes;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isRealDate = (s) => DATE_RE.test(s) && minutesToLocal(localToMinutes(s)).date === s;

// Horas de inicio de un dia. Se rechazan dos turnos que se pisan (menos de SLOT_MINUTES entre inicios)
// y un ultimo turno que acabe despues de medianoche.
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export function parseTimes(str) {
  const list = [...new Set(String(str).split(/[\s,;]+/).filter(Boolean))];
  if (!list.length || list.length > 12 || !list.every((t) => TIME_RE.test(t))) return null;
  list.sort();
  for (let i = 1; i < list.length; i++) if (toMin(list[i]) - toMin(list[i - 1]) < SLOT_MINUTES) return null;
  if (toMin(list[list.length - 1]) + SLOT_MINUTES > 1440) return null;
  return list;
}

// ISO (UTC) timestamp in the configured zone: "dd/mm HH:MM" and "HH:MM".
export const stampLocal = (iso) => {
  const l = nowLocal(new Date(iso));
  return `${l.date.slice(8)}/${l.date.slice(5, 7)} ${l.time}`;
};
export const clockLocal = (iso) => nowLocal(new Date(iso)).time;
export const dayMonth = (date) => `${date.slice(8)}/${date.slice(5, 7)}`;
// A slot has started when its date and time (configured zone) are equal to or before now.
export const slotStarted = (date, time, today, nowTime) => date < today || (date === today && time <= nowTime);

const fmt = (opts) => {
  const m = {};
  return (lang) => (m[lang] ||= new Intl.DateTimeFormat((LANG_REGISTRY[lang] || LANG_REGISTRY.es).locale, { ...opts, timeZone: "UTC" }));
};
const longDate = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = fmt({ weekday: "long", day: "numeric", month: "long" });
const monthYear = fmt({ month: "long", year: "numeric" });
const at = (date) => new Date(localToMinutes(date) * 60000);
export const prettyDate = (date, lang = "es") => longDate(lang).format(at(date));
export const prettyDay = (date, lang = "es") => shortDate(lang).format(at(date));
export const prettyMonth = (month, lang = "es") => monthYear(lang).format(at(month + "-01"));

// ---- disponibilidad flexible del mismo día ("Disponible hoy") ----------------
// Todo en minutos desde las 00:00 del día. Nunca se cruza la medianoche (until <= 1440).
// Minimum notice (minutes) of the same-day mode: the same figure as the day exception, shortNoticeMinutes in site.config.js.
export const FLEX_NOTICE_MIN = C.shortNoticeMinutes;
export const FLEX_GRACE_MIN = 5; // margen extra al validar el envío (la página puede tener unos minutos)
export const FLEX_STEP_MIN = 5; // los inicios van en múltiplos de 5 minutos
export const FLEX_DEFAULT_UNTIL = C.flexDefaultUntil;
export const hhmmToMin = toMin;
// ¿La reserva pendiente retiene el hueco menos de las 2 h de siempre (turno de hoy que empieza antes)?
export const shortHold = (b) => !!(b && b.expires_at && b.created_at && Date.parse(b.expires_at) - Date.parse(b.created_at) < 2 * 3600_000 - 1000);
export const minToHhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const ceilStep = (m) => Math.ceil(m / FLEX_STEP_MIN) * FLEX_STEP_MIN;

// The daily break (a lunch hour, say). A start time is "in the break" when the session it starts, [s, s + SESSION_MINUTES),
// overlaps [fromMin, untilMin). So a session may end exactly when the break begins, and one may start exactly when it ends.
// `brk` is { fromMin, untilMin } in minutes from midnight, or null when there is no break. This one rule serves the public
// list, the same-day mode, the hard check at booking time and the counts of the dashboard, so they cannot disagree.
export const inBreak = (startMin, brk) => !!brk && startMin < brk.untilMin && startMin + SESSION_MINUTES > brk.fromMin;
// The stored break ({ from, until } as "HH:MM") in minutes, or null.
export const breakMinutes = (b) => (b ? { fromMin: toMin(b.from), untilMin: toMin(b.until) } : null);

// Inicios que se ofrecen: lo que queda de [earliest, until) sin las reservas vivas (cada una ocupa [b, b + SLOT_MINUTES)),
// empaquetado desde el principio de cada hueco para que quepan cuantas más sesiones mejor. Los inicios van separados
// SLOT_MINUTES; antes de una reserva ya existente el siguiente inicio debe distar SLOT_MINUTES de ella, y la última
// sesión del día solo tiene que ACABAR (SESSION_MINUTES) antes de `until`: el margen final no hace falta.
// With a break the day is packed in two parts: up to the start of the break, and again from its end, so the first start
// after the break is exactly its end (rounded up to the step). Existing bookings keep their own rule, also inside the break.
export function flexStarts({ nowMin, fromMin, untilMin, busy = [], brk = null }) {
  const until = Math.min(untilMin, 1440);
  const first = ceilStep(Math.max(fromMin, nowMin + FLEX_NOTICE_MIN));
  if (!brk) return pack(first, until, busy);
  return [...pack(first, Math.min(until, brk.fromMin), busy), ...pack(Math.max(first, ceilStep(brk.untilMin)), until, busy)];
}
// Packs starts into [start, until) around the live bookings.
function pack(start, until, busy) {
  const out = [];
  let cursor = start;
  const fill = (a, end, need) => {
    for (let s = ceilStep(a); s + need <= end; s += SLOT_MINUTES) out.push(s);
  };
  for (const b of [...busy].sort((x, y) => x - y)) {
    if (b + SLOT_MINUTES <= cursor) continue; // reserva ya pasada o antes del primer hueco
    if (b <= until) fill(cursor, b, SLOT_MINUTES);
    // A booking after the end of this part still needs its SLOT_MINUTES from the last session (the hard rule checks it too).
    else fill(cursor, Math.min(until, b - SLOT_MINUTES + SESSION_MINUTES), SESSION_MINUTES);
    cursor = Math.max(cursor, b + SLOT_MINUTES);
  }
  fill(cursor, until, SESSION_MINUTES);
  return out;
}

// Regla dura al enviar el formulario: algo más ancha que lo que se enseña.
export function flexAllows({ startMin, nowMin, fromMin, untilMin, busy = [], brk = null }) {
  if (!Number.isInteger(startMin) || startMin % FLEX_STEP_MIN !== 0) return false;
  if (startMin < nowMin + FLEX_NOTICE_MIN - FLEX_GRACE_MIN) return false;
  if (startMin < fromMin) return false;
  if (startMin + SESSION_MINUTES > Math.min(untilMin, 1440)) return false;
  if (inBreak(startMin, brk)) return false;
  return busy.every((b) => Math.abs(startMin - b) >= SLOT_MINUTES);
}
