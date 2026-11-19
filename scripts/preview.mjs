// Local preview without Cloudflare: the real app (src/app.js) on an in-memory SQLite database, serving the files of public/.
// Usage: node scripts/preview.mjs [port] [--now <ISO date-time>]   (default port 8799). It never touches a production database and
// never sends e-mail. Six upcoming weekdays are opened with the default times of site.config.js. Needs Node 22 or newer (node:sqlite).
// --now runs the whole site with a FIXED clock, for example --now 2026-11-16T10:00:00+01:00 (an instant with its offset, or "Z"):
// the days that open, the slots that are offered, the attendance buttons ("the session has started"), the purge of old bookings
// and the weekly summary all follow that time, so those can be tried without waiting. Without it the clock is the real one.
// It never reports to the anonymous usage count either: it gives handle() no waitUntil (src/usage.js needs one) and runs on an in-memory
// database. test/helpers.mjs, imported below for its database adapter, also replaces the global fetch with a function that throws.
// Stop it with Ctrl+C (or, if you started it in the background, by stopping that process).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "../src/db.js";
import { handle } from "../src/app.js";
import { makeDB } from "../test/helpers.mjs";
import { nowLocal, addDays, weekday } from "../src/slots.js";

// Arguments: an optional port, and --now <ISO date-time> for a fixed clock.
const argv = process.argv.slice(2);
let PORT = 8799;
let NOW = null; // a Date, or null for the real clock
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--now") {
    const v = argv[++i];
    // an instant written with its zone (Z or +hh:mm): without one the text would depend on the time zone of the computer
    const t = v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
    if (!Number.isFinite(t)) { console.error(`--now needs an ISO date-time with its offset, for example 2026-11-16T10:00:00+01:00 (got ${JSON.stringify(v)})`); process.exit(2); }
    NOW = new Date(t);
  } else if (/^\d+$/.test(argv[i])) PORT = Number(argv[i]);
  else { console.error(`Unexpected argument: ${argv[i]}\nUsage: node scripts/preview.mjs [port] [--now <ISO date-time>]`); process.exit(2); }
}
const clock = () => NOW || new Date();
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };

// The admin password of the preview: a new random one at every start (printed below), so no fixed password is ever known. It only
// exists in this process and protects nothing but an in-memory database.
const PREVIEW_PASSWORD = randomBytes(18).toString("base64url");
const DB = makeDB();
const today = nowLocal(clock()).date;
for (let i = 1, n = 0; n < 6; i++) {
  const d = addDays(today, i);
  if (weekday(d) === 0 || weekday(d) === 6) continue;
  await D.openDay(DB, d, await D.getDefaultTimes(DB));
  n++;
}
const ASSETS = {
  async fetch(request) {
    const p = normalize(decodeURIComponent(new URL(request.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(PUBLIC, p));
      return new Response(body, { headers: { "content-type": TYPES[extname(p)] || "application/octet-stream", "cache-control": "no-store" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
};
const env = { DB, ASSETS, BASE_URL: `http://localhost:${PORT}`, ADMIN_PASSWORD: PREVIEW_PASSWORD };

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === "string"));
  headers.set("cf-connecting-ip", "127.0.0.1");
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method)) init.body = Buffer.concat(chunks);
  const r = await handle(new Request(`http://localhost:${PORT}${req.url}`, init), env, NOW ? { now: NOW } : {});
  const out = {};
  r.headers.forEach((v, k) => { if (k !== "strict-transport-security") out[k] = v; });
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Preview running at http://localhost:${PORT}`);
  console.log(`Admin panel:       http://localhost:${PORT}/admin`);
  console.log(`Admin password:    ${PREVIEW_PASSWORD}`);
  console.log("In-memory database, no e-mail is sent. Stop with Ctrl+C.");
  if (NOW) console.log(`Fixed clock: ${NOW.toISOString()} (--now); the site believes it is always that moment.`);
});
