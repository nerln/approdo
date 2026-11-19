// Acceso a D1.
import { randomToken, b64url, hmacHex, scrubErr } from "./util.js";
import { DEFAULT_TIMES, addDays, TIME_RE, SLOT_MINUTES, hhmmToMin } from "./slots.js";
import { C, normLang, declarationsFor } from "./config.js";
import { parseStored, serialize, toView, configStudies } from "./studies.js";

const q = (db, sql, ...a) => db.prepare(sql).bind(...a);
const all = async (db, sql, ...a) => (await q(db, sql, ...a).all()).results;
const first = (db, sql, ...a) => q(db, sql, ...a).first();
const run = (db, sql, ...a) => q(db, sql, ...a).run();
const changes = (r) => (r && r.meta ? r.meta.changes : 0);

// ---- ajustes -------------------------------------------------------------
export async function getSetting(db, key) {
  const r = await first(db, "SELECT value FROM settings WHERE key = ?1", key);
  return r ? r.value : null;
}
export const setSetting = (db, key, value) =>
  run(db, "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));

export const deleteSetting = (db, key) => run(db, "DELETE FROM settings WHERE key = ?1", key);

// ---- disponibilidad flexible de un día: una fila en settings, clave flex:YYYY-MM-DD ----
export async function getFlex(db, date) {
  try {
    const v = JSON.parse((await getSetting(db, `flex:${date}`)) || "null");
    if (v && TIME_RE.test(v.from) && TIME_RE.test(v.until) && v.from < v.until) return { from: v.from, until: v.until };
  } catch { /* JSON roto: sin flex */ }
  return null;
}
export const setFlex = (db, date, from, until) => setSetting(db, `flex:${date}`, JSON.stringify({ from, until }));
export const clearFlex = (db, date) => deleteSetting(db, `flex:${date}`);

// ---- the daily break: one row in settings, key "break", value {"from":"HH:MM","until":"HH:MM"} ----
// Lenient on read, as the flex setting is: anything that is not two valid times with from < until counts as no break,
// so a damaged row can never hide the offered times by accident.
export async function getBreak(db) {
  try {
    const v = JSON.parse((await getSetting(db, "break")) || "null");
    if (v && typeof v.from === "string" && typeof v.until === "string" && TIME_RE.test(v.from) && TIME_RE.test(v.until) && v.from < v.until) return { from: v.from, until: v.until };
  } catch { /* broken JSON: no break */ }
  return null;
}
export const setBreak = (db, from, until) => setSetting(db, "break", JSON.stringify({ from, until }));
export const clearBreak = (db) => deleteSetting(db, "break");

// ---- día sin la antelación mínima (MIN_NOTICE_HOURS): una fila en settings, clave nonotice:YYYY-MM-DD ----
export const setNoNotice = (db, date) => setSetting(db, `nonotice:${date}`, "1");
export const clearNoNotice = (db, date) => deleteSetting(db, `nonotice:${date}`);
export async function noNoticeDays(db, from, to) {
  const rows = await all(db, "SELECT key FROM settings WHERE key >= ?1 AND key <= ?2 AND value = '1'", `nonotice:${from}`, `nonotice:${to}`);
  return new Set(rows.map((r) => r.key.slice("nonotice:".length)));
}
export const hasNoNotice = async (db, date) => (await noNoticeDays(db, date, date)).has(date);

// La persona ha demostrado que recibe el correo: pulsó el botón del mensaje o escribió su código. Solo la primera vez.
// Sin la columna (código desplegado antes de la migración): false, sin romper nada.
export async function markVerified(db, id, nowIso) {
  try { return changes(await run(db, "UPDATE bookings SET verified_at = ?2 WHERE id = ?1 AND verified_at IS NULL", id, nowIso)) > 0; } catch { return false; }
}

// ---- cómo se confirma una reserva (con el correo activado): "email" = enlace o código en 2 horas; "instant" = al momento.
export async function getConfirmMode(db) {
  return (await getSetting(db, "confirm_mode")) === "instant" ? "instant" : "email";
}

// ---- estudios ------------------------------------------------------------
// The studies of the site. While the "studies" table has no valid row (nobody ever saved a study from the panel) they are the ones
// of site.config.js and the site behaves exactly as it always did (table: false). From the first save on, the table is the source of
// truth (table: true). A row whose JSON is invalid is ignored: that study is treated as absent.
// active: the id of the study that takes the bookings: the "active_study" setting when it names a study that is not archived,
// otherwise the first study that is not archived.
export async function getRegistry(db) {
  let rows = [];
  try { rows = await all(db, "SELECT id, position, data, updated_at FROM studies ORDER BY position, id"); } catch { rows = []; }
  const list = [];
  for (const r of rows) {
    const d = parseStored(r.data);
    if (d) list.push(toView(r.id, r.position, d, r.updated_at, r.data));
  }
  const stored = await getSetting(db, "active_study");
  if (!list.length) {
    // raw: what the first save would write for the study (so an update can compare against it, see updateStudy)
    const studies = configStudies().map((x) => toView(x.id, x.position, x.data, "", serialize(x.data)));
    return { table: false, studies, active: C.twoStudies && stored === "study2" ? "study2" : "study1" };
  }
  const chosen = list.find((x) => x.id === stored && !x.archived) || list.find((x) => !x.archived) || list[0];
  return { table: true, studies: list, active: chosen.id };
}
export async function getActiveStudy(db) {
  return (await getRegistry(db)).active;
}
// The declarations the form asks for when this study is booked.
export const declarationsOf = (reg, id) => { const s = reg.studies.find((x) => x.id === id); return s ? s.declarations : declarationsFor(id); };

// Writes every study of the configuration (the first save from the panel), with empty texts and no change date (updated_at ""): the page
// keeps showing what it always showed. A row that is already there and valid is left alone; one whose JSON is not an object (what
// getRegistry ignores) is replaced.
export async function seedConfigStudies(db) {
  await db.batch(configStudies().map((x) => q(db,
    `INSERT INTO studies (id, position, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET position = excluded.position, data = excluded.data, updated_at = excluded.updated_at
     WHERE CASE WHEN json_valid(studies.data) THEN json_type(studies.data) <> 'object' ELSE 1 END`,
    x.id, x.position, serialize(x.data), "")));
}
// A compare-and-swap: the row is rewritten only if its JSON is still the one the new data was built from (expectedRaw, the `raw` of the
// view that was read). Returns true when the row was changed, false when it is gone or was changed by someone else in the meantime
// (the caller tells the two apart with studyExists). A save that changes nothing writes nothing (updated_at stays).
export async function updateStudy(db, id, data, nowIso, expectedRaw) {
  const next = serialize(data);
  // Nothing to change (the same study once both are read the same way): write nothing, so that neither the JSON nor the change date moves.
  const canon = (json) => { const d = parseStored(json); return d ? serialize(d) : null; };
  if (canon(next) !== null && canon(next) === canon(expectedRaw)) return !!(await first(db, "SELECT 1 AS x FROM studies WHERE id = ?1 AND data = ?2", id, expectedRaw));
  return changes(await run(db, "UPDATE studies SET data = ?1, updated_at = ?2 WHERE id = ?3 AND data = ?4", next, nowIso, id, expectedRaw)) > 0;
}
export const studyExists = async (db, id) => !!(await first(db, "SELECT 1 AS x FROM studies WHERE id = ?1", id));
export async function insertStudy(db, id, data, nowIso) {
  await run(db, "INSERT INTO studies (id, position, data, updated_at) SELECT ?1, coalesce(max(position), 0) + 1, ?2, ?3 FROM studies", id, serialize(data), nowIso);
}

// Numbers per study: bookings still in the table plus the counts kept when old bookings were purged (tallies).
// booked = pending or confirmed (not yet held), attended, absent (no show), cancelled; upcoming = booked from `today` on.
export async function studyCounts(db, today) {
  const out = new Map();
  const of = (id) => out.get(id) || out.set(id, { booked: 0, attended: 0, absent: 0, cancelled: 0, upcoming: 0 }).get(id);
  const add = (r) => {
    const c = of(r.study);
    if (r.status === "pending" || r.status === "confirmed") c.booked += r.n;
    else if (r.status === "attended") c.attended += r.n;
    else if (r.status === "noshow") c.absent += r.n;
    else if (r.status === "cancelled") c.cancelled += r.n;
  };
  for (const r of await all(db, "SELECT study, status, count(*) AS n FROM bookings GROUP BY study, status")) add(r);
  for (const r of await all(db, "SELECT study, status, sum(n) AS n FROM tallies GROUP BY study, status")) add(r);
  for (const r of await all(db, "SELECT study, count(*) AS n FROM bookings WHERE status IN ('pending','confirmed') AND date >= ?1 GROUP BY study", today)) of(r.study).upcoming = r.n;
  return out;
}
// One row per study, ISO week (its Monday) and kind, live bookings and tallies together, read in ONE statement: a purge that runs
// between two statements could otherwise count the same bookings twice (once live, once as a tally) or not at all.
// kind: booked (pending or confirmed, the session not held yet), attended, absent, cancelled, unmarked (confirmed, the session has
// started and nobody marked it). No personal data in either source. today / nowTime: the local date and time (a session is "held" once
// its start is not after now).
export async function weeklyCounts(db, today, nowTime) {
  const rows = await all(db, `
    SELECT study, week, kind, sum(n) AS n FROM (
      SELECT study, date(bookings.date, '-6 days', 'weekday 1') AS week, CASE
          WHEN status = 'attended' THEN 'attended' WHEN status = 'noshow' THEN 'absent' WHEN status = 'cancelled' THEN 'cancelled'
          WHEN bookings.date < ?1 OR (bookings.date = ?1 AND time <= ?2) THEN CASE WHEN status = 'confirmed' THEN 'unmarked' END
          WHEN status IN ('pending', 'confirmed') THEN 'booked' END AS kind, count(*) AS n
        FROM bookings GROUP BY study, week, kind
      UNION ALL
      SELECT study, week, CASE status WHEN 'attended' THEN 'attended' WHEN 'noshow' THEN 'absent' WHEN 'cancelled' THEN 'cancelled' WHEN 'confirmed' THEN 'unmarked' END AS kind, n FROM tallies
    ) WHERE kind IS NOT NULL AND week IS NOT NULL GROUP BY study, week, kind ORDER BY study, week`, today, nowTime);
  return rows.map((r) => ({ study: r.study, week: r.week, kind: r.kind, n: Number(r.n) || 0 }));
}
// All-time number of bookings marked as attended: the ones still in the table plus the ones the purge counted in the tallies. Read in ONE
// statement for the same reason as weeklyCounts. A number only, no personal data (it is part of the anonymous usage count, src/usage.js).
export async function attendedTotal(db) {
  const r = await first(db, `SELECT coalesce(sum(n), 0) AS n FROM (
    SELECT count(*) AS n FROM bookings WHERE status = 'attended'
    UNION ALL SELECT coalesce(sum(n), 0) AS n FROM tallies WHERE status = 'attended')`);
  return Math.max(0, Math.trunc(Number(r && r.n) || 0));
}
// Takes the right to send the usage report: writes `nowIso` in the setting `key` only when the setting is missing, older than `cutoffIso`,
// or not a time at all (or lies more than a day in the future). One statement, so of two concurrent requests only one gets true.
export async function claimDaily(db, key, nowIso, cutoffIso, futureIso) {
  const r = await run(db, `INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE settings.value < ?3 OR settings.value > ?4 OR settings.value NOT LIKE '____-__-__T%'`, key, nowIso, cutoffIso, futureIso);
  return changes(r) > 0;
}
// Deletes the bookings of days before `cutoff`, after adding them to the tallies (per study, ISO week and status): one batch, so the two
// happen together or not at all, and a second (or a concurrent) run finds nothing left to count. Returns how many bookings were deleted.
export async function purgeOldBookings(db, cutoff) {
  const r = await db.batch([
    q(db, `INSERT INTO tallies (study, week, status, n) SELECT study, date(bookings.date, '-6 days', 'weekday 1'), status, count(*) FROM bookings WHERE bookings.date < ?1 AND date(bookings.date, '-6 days', 'weekday 1') IS NOT NULL
           GROUP BY study, date(bookings.date, '-6 days', 'weekday 1'), status
           ON CONFLICT(study, week, status) DO UPDATE SET n = n + excluded.n`, cutoff),
    q(db, "DELETE FROM bookings WHERE date < ?1", cutoff),
  ]);
  return changes(r[1]);
}

export async function getDefaultTimes(db) {
  try {
    const v = JSON.parse((await getSetting(db, "slot_times")) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch { /* usa los de fabrica */ }
  return [...DEFAULT_TIMES];
}

// Clave HMAC generada por la propia app la primera vez que se necesita.
export async function getKey(db) {
  let v = await getSetting(db, "hmac_key");
  if (v) return v;
  const fresh = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await run(db, "INSERT OR IGNORE INTO settings (key, value) VALUES ('hmac_key', ?1)", fresh);
  return await getSetting(db, "hmac_key");
}
// Sal diaria derivada de la clave: el hash de IP de hoy no sirve manana.
// IPv6: se agrupa por /64 (lo normal que recibe un hogar), para que rotar dentro del prefijo no dé contadores nuevos.
export async function ipHash(db, ip, dayUtc) {
  const key = await getKey(db);
  if (String(ip).includes(":") && !String(ip).includes(".")) {
    const [head, tail = ""] = String(ip).toLowerCase().split("::");
    const g = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const full = [...g, ...Array(Math.max(0, 8 - g.length - t.length)).fill("0"), ...t];
    ip = full.slice(0, 4).map((x) => x.padStart(4, "0")).join(":") + "::/64";
  }
  return (await hmacHex(key, `ip:${dayUtc}:${ip}`)).slice(0, 32);
}

// ---- limpieza oportunista ------------------------------------------------
const lastCleanup = new WeakMap();
export async function cleanup(db, nowMs, today) {
  // Como mucho una vez por minuto y base de datos: una avalancha de GET no multiplica los DELETE.
  const prev = lastCleanup.get(db);
  if (prev !== undefined && nowMs >= prev && nowMs - prev < 60_000) return {};
  lastCleanup.set(db, nowMs);
  const iso = new Date(nowMs).toISOString();
  const hourAgo = nowMs - 3600_000;
  const out = {};
  out.pending = changes(await run(db, "DELETE FROM bookings WHERE status = 'pending' AND expires_at < ?1", iso));
  out.old = await purgeOldBookings(db, addDays(today, -C.bookingRetentionDays));
  out.rate = changes(await run(db, "DELETE FROM rate_limit WHERE ts < ?1", hourAgo));
  out.login = changes(await run(db, "DELETE FROM login_attempts WHERE ts < ?1", hourAgo));
  await run(db, "DELETE FROM day_slots WHERE date < ?1", addDays(today, -C.bookingRetentionDays));
  await run(db, "DELETE FROM days WHERE date < ?1", addDays(today, -C.bookingRetentionDays));
  await run(db, "DELETE FROM settings WHERE key LIKE 'flex:%' AND key < ?1", `flex:${today}`);
  await run(db, "DELETE FROM settings WHERE key LIKE 'nonotice:%' AND key < ?1", `nonotice:${today}`);
  await run(db, "DELETE FROM settings WHERE key LIKE 'flash:%' AND key < ?1", `flash:${String(nowMs - 600_000).padStart(15, "0")}`);
  // El registro de correos puede no existir si el codigo se despliega antes de la migracion: nunca debe romper nada.
  try { await run(db, "DELETE FROM mail_log WHERE at < ?1", new Date(nowMs - 60 * 86400_000).toISOString()); } catch { /* sin tabla */ }
  await contactCleanup(db, nowMs);
  return out;
}

// ---- limites -------------------------------------------------------------
export async function countSince(db, table, k, sinceMs) {
  const r = await first(db, `SELECT count(*) AS n FROM ${table} WHERE k = ?1 AND ts > ?2`, k, sinceMs);
  return r ? r.n : 0;
}
export const addHit = (db, table, k, ts) => run(db, `INSERT INTO ${table} (k, ts) VALUES (?1, ?2)`, k, ts);
// Quita un solo registro (el intento que acaba de salir bien).
export const dropHit = (db, table, k, ts) => run(db, `DELETE FROM ${table} WHERE rowid = (SELECT max(rowid) FROM ${table} WHERE k = ?1 AND ts = ?2)`, k, ts);

// ---- dias y franjas -------------------------------------------------------
export async function openDays(db, from, to) {
  return (await all(db, "SELECT date FROM days WHERE date >= ?1 AND date <= ?2 ORDER BY date", from, to)).map((r) => r.date);
}
export async function slotsBetween(db, from, to) {
  return all(db, "SELECT date, time FROM day_slots WHERE date >= ?1 AND date <= ?2 ORDER BY date, time", from, to);
}
export async function isSlotOpen(db, date, time) {
  return !!(await first(db, "SELECT 1 AS x FROM day_slots WHERE date = ?1 AND time = ?2", date, time));
}
export async function openDay(db, date, times) {
  await run(db, "INSERT OR IGNORE INTO days (date) VALUES (?1)", date);
  for (const t of times) await run(db, "INSERT OR IGNORE INTO day_slots (date, time) VALUES (?1, ?2)", date, t);
}
export async function closeDay(db, date) {
  await run(db, "DELETE FROM day_slots WHERE date = ?1", date);
  await run(db, "DELETE FROM days WHERE date = ?1", date);
}
export async function addSlot(db, date, time) { await run(db, "INSERT OR IGNORE INTO day_slots (date, time) VALUES (?1, ?2)", date, time); }
export async function removeSlot(db, date, time) { await run(db, "DELETE FROM day_slots WHERE date = ?1 AND time = ?2", date, time); }

// ---- reservas -------------------------------------------------------------
const ACTIVE = "('pending','confirmed','attended','noshow')";
export async function takenSlots(db, from, to) {
  const r = await all(db, `SELECT date, time FROM bookings WHERE date >= ?1 AND date <= ?2 AND status IN ${ACTIVE}`, from, to);
  return new Set(r.map((x) => `${x.date}T${x.time}`));
}
export async function liveBookingForSlot(db, date, time) {
  return first(db, "SELECT id, status FROM bookings WHERE date = ?1 AND time = ?2 AND status <> 'cancelled'", date, time);
}
export async function hasLiveEmail(db, key) {
  return !!(await first(db, "SELECT 1 AS x FROM bookings WHERE email_key = ?1 AND status IN ('pending','confirmed')", key));
}
// Una sola sentencia: no se inserta si hay una reserva viva del mismo día a menos de SLOT_MINUTES de inicio
// (con turnos flexibles dos inicios distintos pueden pisarse y el índice único no lo ve).
export async function insertBooking(db, b) {
  try {
    const r = await run(db,
      `INSERT INTO bookings (id, token, study, date, time, name, email, email_key, status, created_at, expires_at, reminded, lang)
       SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12
       WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE date = ?4 AND status <> 'cancelled'
         AND abs(CAST(substr(time,1,2) AS INTEGER) * 60 + CAST(substr(time,4,2) AS INTEGER) - ?13) < ?14)`,
      b.id, b.token, b.study, b.date, b.time, b.name, b.email, b.email_key, b.status, b.created_at, b.expires_at ?? null, normLang(b.lang),
      hhmmToMin(b.time), SLOT_MINUTES);
    return changes(r) > 0 ? { ok: true } : { ok: false, reason: "taken" };
  } catch (e) {
    const m = String(e && e.message);
    if (m.includes("UNIQUE") || m.includes("constraint")) return { ok: false, reason: m.includes("email_key") ? "email" : "taken" };
    throw e;
  }
}
export const newToken = () => randomToken(24);

// ---- codigo de reserva: 6 cifras derivadas del token con la clave de la app. No se guarda. ----
export async function codeFor(key, token) {
  const h = await hmacHex(key, "code:" + token);
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, "0");
}
export const bookingCode = async (db, b) => codeFor(await getKey(db), b.token);
export const formatCode = (code) => `${String(code).slice(0, 3)} ${String(code).slice(3)}`;
// Acepta "123456", "123 456" y "123-456". Devuelve las 6 cifras o "" si no tiene esa forma.
export const parseCode = (s) => { const d = String(s ?? "").replace(/[\s-]/g, ""); return /^\d{6}$/.test(d) ? d : ""; };
// Reserva viva de un correo (pendiente sin caducar, o confirmada), o null.
export async function liveBookingByEmail(db, key, nowIso) {
  const b = await first(db, "SELECT * FROM bookings WHERE email_key = ?1 AND status IN ('pending','confirmed') ORDER BY created_at DESC LIMIT 1", key);
  if (!b) return null;
  if (b.status === "pending" && !(b.expires_at && b.expires_at >= nowIso)) return null;
  return b;
}
export const bookingByToken = (db, token) => first(db, "SELECT * FROM bookings WHERE token = ?1", token);
export const bookingById = (db, id) => first(db, "SELECT * FROM bookings WHERE id = ?1", id);
export const setStatus = async (db, id, status, fromStatuses) => {
  const marks = fromStatuses.map((_, i) => `?${i + 3}`).join(",");
  return changes(await run(db, `UPDATE bookings SET status = ?1, expires_at = NULL WHERE id = ?2 AND status IN (${marks})`, status, id, ...fromStatuses));
};
export const deleteBooking = (db, id) => run(db, "DELETE FROM bookings WHERE id = ?1", id);
export const bookingsBetween = (db, from, to) =>
  all(db, "SELECT * FROM bookings WHERE date >= ?1 AND date <= ?2 ORDER BY date, time", from, to);
export const confirmedOn = (db, date) =>
  all(db, "SELECT * FROM bookings WHERE date = ?1 AND status = 'confirmed' AND reminded = 0 ORDER BY time", date);
export const markReminded = (db, id) => run(db, "UPDATE bookings SET reminded = 1 WHERE id = ?1", id);

// ---- recordatorios: reclamar antes de enviar --------------------------------
export const claimReminder = async (db, id) => changes(await run(db, "UPDATE bookings SET reminded = 1 WHERE id = ?1 AND reminded = 0", id)) > 0;
export const releaseReminder = (db, id) => run(db, "UPDATE bookings SET reminded = 0 WHERE id = ?1", id);

// ---- otras consultas -------------------------------------------------------
// Quien ya asistio al estudio (mismo correo normalizado) no vuelve a reservar ese estudio.
export async function hasAttended(db, key, study) {
  return !!(await first(db, "SELECT 1 AS x FROM bookings WHERE email_key = ?1 AND study = ?2 AND status = 'attended'", key, study));
}
export async function liveEmailKeys(db) {
  return new Set((await all(db, "SELECT email_key FROM bookings WHERE status IN ('pending','confirmed')")).map((r) => r.email_key));
}

// ---- registro de correos (tolerante: si falta la tabla no pasa nada) ------------
export async function logMail(db, bookingId, kind, ok, err, atIso) {
  try {
    await run(db, "INSERT INTO mail_log (booking_id, kind, ok, err, at) VALUES (?1, ?2, ?3, ?4, ?5)", String(bookingId), kind, ok ? 1 : 0, ok ? null : scrubErr(err).slice(0, 120), atIso);
    return true;
  } catch {
    return false;
  }
}
export async function mailsSince(db, kind, sinceIso) {
  try { const r = await first(db, "SELECT count(*) AS n FROM mail_log WHERE kind = ?1 AND at > ?2", kind, sinceIso); return r ? r.n : 0; } catch { return 0; }
}
// Correos de cualquier tipo desde un instante (enviados o fallidos). Sin tabla: 0.
export async function mailsAllSince(db, sinceIso) {
  try { const r = await first(db, "SELECT count(*) AS n FROM mail_log WHERE at > ?1", sinceIso); return r ? r.n : 0; } catch { return 0; }
}
// Mapa id de reserva -> filas del registro, de la mas antigua a la mas nueva. Sin tabla: mapa vacio.
export async function mailLogFor(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    // D1 admite pocos parametros por consulta: se pide por trozos de 90 y luego se ordena.
    const rowsAll = [];
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const marks = part.map((_, j) => `?${j + 1}`).join(",");
      rowsAll.push(...(await all(db, `SELECT id, booking_id, kind, ok, err, at FROM mail_log WHERE booking_id IN (${marks})`, ...part)));
    }
    rowsAll.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
    for (const { id: _id, ...r } of rowsAll) {
      if (!out.has(r.booking_id)) out.set(r.booking_id, []);
      out.get(r.booking_id).push(r);
    }
  } catch { /* sin tabla */ }
  return out;
}

// ---- contactos para futuros estudios (tolerante: si falta la tabla no pasa nada) ------------
export const CONTACT_MONTHS = C.contactMonths;
export const CONTACT_PENDING_MS = 3 * 3600_000; // sin confirmar la reserva, la fila se borra a las 3 horas
// Suma meses de calendario a una fecha ISO (UTC); el dia 31 + 1 mes cae en el ultimo dia del mes siguiente.
export function addMonthsIso(iso, n) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
// Pide el aviso al reservar: fila sin confirmar ligada a la reserva. Un contacto ya confirmado no se toca.
// untilIso: hasta cuándo puede esperar la fila sin confirmar (reserva confirmada al momento: hasta que la persona viene).
export async function contactRequest(db, key, email, lang, bookingId, nowIso, untilIso = null) {
  try {
    await run(db,
      `INSERT INTO contacts (email_key, email, lang, consent_at, expires_at, confirmed, booking_id) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
       ON CONFLICT(email_key) DO UPDATE SET email = excluded.email, lang = excluded.lang, consent_at = excluded.consent_at, expires_at = excluded.expires_at, booking_id = excluded.booking_id
       WHERE contacts.confirmed = 0`,
      key, email, normLang(lang), nowIso, untilIso || new Date(Date.parse(nowIso) + CONTACT_PENDING_MS).toISOString(), bookingId);
    return true;
  } catch { return false; }
}
// Al confirmarse la reserva, el contacto queda confirmado y empiezan a contar los CONTACT_MONTHS meses.
export async function contactConfirm(db, bookingId, nowIso) {
  try {
    return changes(await run(db, "UPDATE contacts SET confirmed = 1, booking_id = NULL, consent_at = ?1, expires_at = ?2 WHERE booking_id = ?3 AND confirmed = 0", nowIso, addMonthsIso(nowIso, CONTACT_MONTHS), bookingId)) > 0;
  } catch { return false; }
}
// La reserva se borro sin llegar a existir (fallo del correo): su contacto sin confirmar tambien.
export async function contactDropPending(db, bookingId) {
  try { await run(db, "DELETE FROM contacts WHERE booking_id = ?1 AND confirmed = 0", bookingId); } catch { /* sin tabla */ }
}
// Fila del contacto (confirmado o pendiente) o null.
export async function contactByKey(db, key) {
  try { return (await first(db, "SELECT * FROM contacts WHERE email_key = ?1", key)) || null; } catch { return null; }
}
export async function contactRemove(db, key) {
  try { return changes(await run(db, "DELETE FROM contacts WHERE email_key = ?1", key)) > 0; } catch { return false; }
}
export async function contactCleanup(db, nowMs) {
  try {
    // Una fila sin confirmar espera 3 horas (reserva pendiente de confirmar por correo) o, si su reserva está confirmada
    // o marcada como asistida, hasta que el panel la confirme al marcar «Asistió». Sin esa reserva viva, se borra.
    await run(db, `DELETE FROM contacts WHERE confirmed = 0 AND consent_at < ?1
      AND (booking_id IS NULL OR booking_id NOT IN (SELECT id FROM bookings WHERE status IN ('confirmed', 'attended')))`, new Date(nowMs - CONTACT_PENDING_MS).toISOString());
    await run(db, "DELETE FROM contacts WHERE expires_at < ?1", new Date(nowMs).toISOString());
  } catch { /* sin tabla */ }
}
// Contactos confirmados, o null si la tabla no existe.
// Sin las filas ya caducadas aunque la limpieza (una vez por minuto) aun no las haya borrado.
export async function contactsConfirmed(db, nowIso = new Date().toISOString()) {
  try { return await all(db, "SELECT email_key, email, lang, consent_at, expires_at FROM contacts WHERE confirmed = 1 AND expires_at >= ?1 ORDER BY consent_at, email_key", nowIso); } catch { return null; }
}
