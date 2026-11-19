// Run by origin.test.mjs inside a scratch copy of the project. Everything the site writes into e-mails, calendar files, pages and checks,
// for requests that arrive on ORIGIN (argv[2]). Prints a JSON summary. A real booking flow with the mail relay switched on.
import { handle } from "./src/app.js";
import * as D from "./src/db.js";
import { hmacHex } from "./src/util.js";
import { C, setup, bookFields, adminSession, rows, NOW, DAY, RELAY, PW, MONDAY, at } from "./test-generic/helpers.mjs";

const ORIGIN = process.argv[2];
const HOST = new URL(ORIGIN).hostname;
const { DB, env } = await setup({ ...RELAY, TURNSTILE_SITEKEY: "0xSITE", TURNSTILE_SECRET: "0xSECRET" });
const sent = [];
let verifyHost = HOST; // what the (fake) bot-check service answers as the page's host name
const fetchFn = async (url, init) => {
  if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true, hostname: verifyHost, action: "reserva" }));
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ ok: true }));
};
const ctx = (now = NOW) => ({ now, fetchFn, ignoreUnconfigured: true });
const get = (path, headers = {}) => new Request(ORIGIN + path, { headers: { "cf-connecting-ip": "1.2.3.4", ...headers } });
const post = (path, fields, ip = "1.2.3.4") => new Request(ORIGIN + path, { method: "POST", headers: { "cf-connecting-ip": ip, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
const out = { origin: ORIGIN, configured: C.baseUrl };

// the bot check blocks only after one success: record one, then a wrong host name must be refused and the right one accepted
await D.setSetting(DB, "ts_ok_last", JSON.stringify({ at: NOW.toISOString(), why: "" }));
verifyHost = "elsewhere.example.net";
const refused = await handle(post("/reservar", { ...(await bookFields(DB)), "cf-turnstile-response": "tok" }, "5.5.5.5"), env, ctx());
out.turnstileWrongHost = { status: refused.status, rows: rows(DB).length };
verifyHost = HOST;
const accepted = await handle(post("/reservar", { ...(await bookFields(DB)), "cf-turnstile-response": "tok" }), env, ctx());
out.turnstileRightHost = { status: accepted.status, rows: rows(DB).length };
// with a fixed address the visited (attacker's) host is refused above; book once more with the host the site expects, to carry on
if (!rows(DB).length) {
  verifyHost = new URL(C.baseUrl || ORIGIN).hostname;
  out.turnstileExpectedHost = (await handle(post("/reservar", { ...(await bookFields(DB)), "cf-turnstile-response": "tok" }, "6.6.6.6"), env, ctx())).status;
}
const b = rows(DB)[0];

// pages: hreflang, canonical-style tags
const home = await (await handle(get("/?lang=" + C.languages[0]), env, ctx())).text();
// the head tags (<link> and <meta>); the links inside the page, such as a photo credit, are the lab's own
out.homeTags = [...home.matchAll(/<(?:link|meta)\b[^>]*?(?:href|content)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);

// confirm with the link, then the person's confirmation mail, the calendar file and the Google Calendar link
const confirmed = await (await handle(post("/c/" + b.token, {}), env, ctx())).text();
out.mails = sent.map((m) => m.text);
out.ics = await (await handle(get("/ics/" + b.token), env, ctx())).text();
const gc = /href="(https:\/\/calendar\.google\.com\/calendar\/render\?[^"]+)"/.exec(confirmed);
out.google = gc ? new URL(gc[1].replace(/&amp;/g, "&")).searchParams.get("details") : null;

// the reminder endpoint: the Apps Script calls it the day before
sent.length = 0;
const tuesday = at(MONDAY, "10:00", 24 * 60);
const body = JSON.stringify({ ts: tuesday.getTime() });
const sig = await hmacHex(RELAY.MAIL_RELAY_KEY, body);
const rem = await handle(new Request(ORIGIN + "/cron/remind?sig=" + sig, { method: "POST", body, headers: { "cf-connecting-ip": "1.2.3.4" } }), env, ctx(tuesday));
out.reminder = { status: rem.status, mails: sent.map((m) => m.text) };

// the admin checklist names the address in use
const s = await adminSession(env);
const panel = await (await handle(get("/admin?s=all", { cookie: s.cookie }), env, ctx())).text();
out.adminLine = (/<li class="[a-z]+">[^<]*(?:dirección pública|indirizzo pubblico)[^<]*<\/li>/.exec(panel) || [""])[0];
console.log(JSON.stringify(out));
