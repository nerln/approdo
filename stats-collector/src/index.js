// Approdo usage collector: a tiny Worker that counts installations, nothing else.
// It never reads the IP address, the CF-Worker header, the user agent or any request header other than content-type
// (which it only compares with application/json), and it never logs request data. The only input it uses is the JSON body of POST /ping.

const HOME = "https://nerln.github.io/approdo/";
const MAX_BODY = 300;
// Rows that are not established yet (see isEstablished) are kept to the newest PENDING_CAP, so the table stays bounded and
// a flood of new identifiers can only push out other new ones, never an established installation or the chance of a new one to enter.
const PENDING_CAP = 5000;
// An installation is counted once it reported on at least COUNT_DAYS different days: a deploy that was tried once and thrown
// away is not a lab that uses the product.
const COUNT_DAYS = 2;
// Its sessions enter the published sum only once it is established: it reported on at least MIN_DAYS different days and its first
// report is at least MIN_DAYS days old. Fresh identifiers are cheap to make, a week of history is not, and the sum is the one
// figure that could say something about a single lab.
const MIN_DAYS = 7;
// The published sum is rounded down to a multiple of this, so that comparing it on two days does not give one lab's growth.
const SESSIONS_STEP = 10;
const MAX_GROWTH = 2000;
const MAX_SESSIONS = 1_000_000;
const ACTIVE_DAYS = 30;
const MIN_INSTALLS_FOR_SESSIONS = 3;

const ID_RE = /^[0-9a-f]{32}$/;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const TABLE = `CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  version TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  days_seen INTEGER NOT NULL DEFAULT 1
)`;
const INDEXES = [
  "CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen)",
  "CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen)",
];

const ready = new WeakSet();
async function ensureTable(DB) {
  if (ready.has(DB)) return;
  await DB.prepare(TABLE).run();
  // A table made by an earlier version has no days_seen column.
  try { await DB.prepare("ALTER TABLE installs ADD COLUMN days_seen INTEGER NOT NULL DEFAULT 1").run(); } catch {}
  for (const sql of INDEXES) await DB.prepare(sql).run();
  ready.add(DB);
}

const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (now, n) => day(new Date(now.getTime() - n * 86_400_000));
// Established: reported on MIN_DAYS different days, first report at least MIN_DAYS days ago.
const ESTABLISHED = "days_seen >= ? AND first_seen <= ?";
const empty = (status, headers) => new Response(null, { status, headers });

// Reads at most MAX_BODY bytes. Returns null when the body is larger.
async function readSmallBody(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      try { await reader.cancel(); } catch {}
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

function parsePing(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const keys = Object.keys(j);
  if (keys.length !== 3 || !["id", "v", "sessions"].every((k) => keys.includes(k))) return null;
  if (typeof j.id !== "string" || !ID_RE.test(j.id)) return null;
  if (typeof j.v !== "string" || !VERSION_RE.test(j.v)) return null;
  if (!Number.isInteger(j.sessions) || j.sessions < 0 || j.sessions > MAX_SESSIONS) return null;
  return { id: j.id, v: j.v, sessions: j.sessions };
}

async function ping(request, env, now, pendingCap) {
  // A browser cannot send application/json to another site without a preflight, which this Worker never answers,
  // so a web page cannot make its visitors' browsers send pings.
  const ct = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") return empty(204);
  const text = await readSmallBody(request);
  if (text === null) return empty(204);
  const p = parsePing(text);
  if (!p) return empty(204);
  const DB = env.DB;
  await ensureTable(DB);
  const today = day(now);
  const known = await DB.prepare("SELECT sessions, last_seen FROM installs WHERE id = ?").bind(p.id).first();
  if (known) {
    // One update per UTC day: a repeated ping the same day changes nothing, so an identifier grows at most MAX_GROWTH a day.
    if (known.last_seen >= today) return empty(204);
    const sessions = Math.max(known.sessions, Math.min(p.sessions, known.sessions + MAX_GROWTH));
    await DB.prepare("UPDATE installs SET last_seen = ?, version = ?, sessions = ?, days_seen = days_seen + 1 WHERE id = ?")
      .bind(today, p.v, sessions, p.id).run();
    return empty(204);
  }
  // The first value is clamped like every later one.
  await DB.prepare("INSERT OR IGNORE INTO installs (id, first_seen, last_seen, version, sessions, days_seen) VALUES (?, ?, ?, ?, ?, 1)")
    .bind(p.id, today, today, p.v, Math.min(p.sessions, MAX_GROWTH)).run();
  // Keep the newest pendingCap rows that are not established; the most recently seen, and among those the most days seen, stay.
  await DB.prepare(`DELETE FROM installs WHERE id IN (SELECT id FROM installs WHERE NOT (${ESTABLISHED}) ORDER BY last_seen DESC, days_seen DESC LIMIT -1 OFFSET ?)`)
    .bind(MIN_DAYS, daysAgo(now, MIN_DAYS), pendingCap).run();
  return empty(204);
}

async function stats(request, env, now) {
  const DB = env.DB;
  await ensureTable(DB);
  const cutoff = daysAgo(now, ACTIVE_DAYS), old = daysAgo(now, MIN_DAYS);
  // Installations: every identifier seen on at least COUNT_DAYS different days. Sessions: established installations only.
  const total = await DB.prepare("SELECT COUNT(*) AS n FROM installs WHERE days_seen >= ?").bind(COUNT_DAYS).first();
  const act = await DB.prepare("SELECT COUNT(*) AS n FROM installs WHERE days_seen >= ? AND last_seen >= ?").bind(COUNT_DAYS, cutoff).first();
  const est = await DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(sessions), 0) AS s FROM installs WHERE ${ESTABLISHED} AND last_seen >= ?`).bind(MIN_DAYS, old, cutoff).first();
  const active = act?.n ?? 0;
  const body = JSON.stringify({
    updated: now.toISOString(),
    installs: { active, total: total?.n ?? 0 },
    sessions: (est?.n ?? 0) >= MIN_INSTALLS_FOR_SESSIONS ? Math.floor(est.s / SESSIONS_STEP) * SESSIONS_STEP : null,
    minInstallsForSessions: MIN_INSTALLS_FOR_SESSIONS,
  });
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=300",
  };
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

export async function handle(request, env, { now = new Date(), pendingCap = PENDING_CAP } = {}) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  try {
    if (path === "/ping") {
      if (method !== "POST") return empty(405, { allow: "POST" });
      return await ping(request, env, now, pendingCap);
    }
    if (path === "/stats.json") {
      if (method !== "GET" && method !== "HEAD") return empty(405, { allow: "GET, HEAD" });
      return await stats(request, env, now);
    }
    if (path === "/") {
      if (method !== "GET" && method !== "HEAD") return empty(405, { allow: "GET, HEAD" });
      return empty(302, { location: HOME });
    }
    return empty(404);
  } catch {
    // Nothing about the request is logged or echoed. A failed ping looks like any other ping.
    return path === "/ping" ? empty(204) : empty(503);
  }
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
