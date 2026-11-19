// The anonymous usage count. At most once a day an installation sends one tiny report to the collector of the author of Approdo
// (its source is in stats-collector/), and the product website shows the totals. It is on by default and switched off with
// `usageCount: false` in site.config.js. What is sent is exactly this, and nothing else:
//   { "id": <32 hex characters, random, made here the first time>, "v": <PRODUCT_VERSION>, "sessions": <attended bookings, all time> }
// No site address, no lab name, no study name, no participant data, no language. The identifier is NOT derived from anything
// (not from the HMAC key, not from the address of the site): it is 16 random bytes kept in the settings table as install_id.
// The report never delays or breaks the page that triggered it: the post runs in ctx.waitUntil, and every failure is swallowed.
// It is only triggered from an authenticated admin page (see handleAdmin) and from a successful /cron/remind call, never from a
// participant's request, and only when the Worker gave the request an execution context with waitUntil (src/index.js does; the tests
// and scripts/preview.mjs do not, so they never report).
import * as D from "./db.js";
import { C } from "./config.js";
import { PRODUCT_VERSION, USAGE_URL } from "./product.js";

export const USAGE_INTERVAL_MS = 20 * 3600_000; // a report is due when the last one is older than this
export const USAGE_TIMEOUT_MS = 4000;
const FUTURE_MS = 24 * 3600_000; // a stored time further ahead than this (a wrong clock) does not block reports

const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");

// The identifier of this installation: made once, from 16 random bytes, and read back so that two concurrent first reports agree.
export async function installId(db) {
  const old = await D.getSetting(db, "install_id");
  if (old && /^[0-9a-f]{32}$/.test(old)) return old;
  const fresh = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('install_id', ?1)").bind(fresh).run();
  const kept = await D.getSetting(db, "install_id");
  return kept && /^[0-9a-f]{32}$/.test(kept) ? kept : fresh;
}

// The exact body of the report.
export async function usageBody(db) {
  return JSON.stringify({ id: await installId(db), v: PRODUCT_VERSION, sessions: await D.attendedTotal(db) });
}

// Decides and, when a report is due, hands it to waitUntil. Resolves quickly and never throws. c: the request context of app.js
// (db, nowMs, fetchFn, waitUntil, unconfigured).
export async function maybeReport(c) {
  try {
    if (C.usageCount === false) return false;
    if (c.unconfigured) return false; // an installation still on the example values never reports
    if (typeof c.waitUntil !== "function") return false;
    const now = new Date(c.nowMs).toISOString();
    // The time is written BEFORE anything is sent, in one conditional statement: two requests at once cannot both win.
    const won = await D.claimDaily(c.db, "usage_ping_at", now, new Date(c.nowMs - USAGE_INTERVAL_MS).toISOString(), new Date(c.nowMs + FUTURE_MS).toISOString());
    if (!won) return false;
    const { db } = c;
    // fetch and waitUntil are called as bare functions, never as methods of `c`: in Workers a method call gives them the wrong
    // `this` ("Illegal invocation").
    const doFetch = c.fetchFn, waitUntil = c.waitUntil;
    waitUntil(send(db, doFetch));
    return true;
  } catch {
    return false;
  }
}

// The post. Everything is swallowed: the answer is never read and nothing depends on it. A Worker's fetch keeps no cookies and
// the request carries no Authorization header, so no credentials travel with it. Redirects are not followed: the mode is
// "manual" because the Workers runtime refuses redirect: "error" (with "error" the
// fetch throws before anything is sent, and the report would silently never leave).
async function send(db, doFetch) {
  try {
    const body = await usageBody(db);
    const r = await doFetch(USAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    try { await r.body?.cancel(); } catch { /* the answer is not needed */ }
  } catch {
    /* offline, refused, timed out: the next report is tried tomorrow */
  }
}
