import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { handle } from "../src/app.js";

// No test may reach the network: the global fetch is replaced by a function that throws. A test that needs a fetch injects its own
// (fetchFn of handle(), see call() below); the code under test never calls the global one when it is given a fetchFn.
// The anonymous usage count (src/usage.js) is covered by the same rule: it posts through that injected fetch.
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("network access is not allowed in tests: inject a fetchFn"); };
// The one exception: a test that talks to a server it started itself on this computer (the preview script) uses this, which refuses any other host.
export const loopbackFetch = (url, init) => {
  const host = new URL(String(url)).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error(`network access is not allowed in tests: ${host}`);
  return nativeFetch(url, init);
};

// Adaptador minimo que imita la API de D1 sobre SQLite en memoria.
export function makeDB() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    // Like D1, a prepared statement can be run as it is or after bind(); db.batch() runs a list of them in order.
    // Like D1, nothing is compiled before the statement runs (a batch may create a table and an index on it).
    prepare(sql) {
      let compiled;
      const st = { run: (...a) => (compiled ??= db.prepare(sql)).run(...a), all: (...a) => (compiled ??= db.prepare(sql)).all(...a), get: (...a) => (compiled ??= db.prepare(sql)).get(...a) };
      const bound = (a) => ({
        async run() { const r = st.run(...a); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { return { results: st.all(...a).map((x) => ({ ...x })) }; },
        async first() { const x = st.get(...a); return x ? { ...x } : null; },
      });
      return { sql, bind: (...a) => bound(a), ...bound([]) };
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

// Lunes 16/11/2026, 10:00 en hora local (09:00 UTC)
export const NOW = new Date("2026-11-16T09:00:00Z");
export const later = (ms) => new Date(NOW.getTime() + ms);
export const DAY = "2026-11-18"; // miercoles abierto en los tests

export const RELAY = { MAIL_RELAY_URL: "https://script.example/exec", MAIL_RELAY_KEY: "k".repeat(64) };
// Los tests viejos reservan con direcciones @unidemo.es y esperan los correos con enlaces: por defecto ningun dominio va sin enlaces.
// Para probar el comportamiento real: NOLINK_DOMAINS: undefined (usa la lista de fabrica) o una lista propia.
export const ENV = (DB, extra = {}) => ({ DB, NOLINK_DOMAINS: "sin-enlaces.invalid", ...extra });

export async function setup(extra = {}, { openDay = true } = {}) {
  const DB = makeDB();
  if (openDay) await D.openDay(DB, DAY, ["09:30", "10:30", "11:30", "15:00"]);
  return { DB, env: ENV(DB, extra) };
}

// Simula fetch: relay de correo y Turnstile.
export function mockFetch({ turnstile = { success: true, hostname: "estudio-vr-demo.workers.dev", action: "reserva" }, relayOk = true } = {}) {
  const calls = { mail: [], turnstile: [] };
  const fn = async (url, init) => {
    if (String(url).includes("siteverify")) { calls.turnstile.push(Object.fromEntries(init.body)); return new Response(JSON.stringify(turnstile)); }
    calls.mail.push({ url: String(url), body: init.body, sig: new URL(url).searchParams.get("sig"), json: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: relayOk }));
  };
  return { fn, calls };
}

export function req(path, { method = "GET", fields, ip = "1.2.3.4", cookie } = {}) {
  const headers = { "cf-connecting-ip": ip };
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (fields) { init.body = new URLSearchParams(fields); headers["content-type"] = "application/x-www-form-urlencoded"; }
  return new Request("https://estudio-vr-demo.workers.dev" + path, init);
}

export const call = (env, r, now = NOW, fetchFn) => handle(r, env, { now, fetchFn });

// Cuerpo valido de /reservar con un token de formulario de hace 10 s.
export async function goodFields(DB, o = {}, now = NOW) {
  return {
    slot: `${DAY}T09:30`, name: "Ana", email: "ana@unidemo.es", noepi: "1", vestibular: "1", accept: "1", web: "",
    t: await signForm(DB, now.getTime() - 10_000), ...o,
  };
}
export async function book(env, o = {}, opts = {}) {
  const { now = NOW, ip, fetchFn } = opts;
  return call(env, req("/reservar", { method: "POST", fields: await goodFields(env.DB, o, now), ip }), now, fetchFn);
}

export const tokenFrom = (html) => /\/(?:c|x|ics)\/([A-Za-z0-9_-]{20,})/.exec(html)?.[1];
export const rows = (DB) => DB.raw.prepare("SELECT * FROM bookings").all();

export async function login(env, password, { ip = "9.9.9.9", now = NOW } = {}) {
  const t = await signForm(env.DB, now.getTime(), "login");
  return call(env, req("/admin/login", { method: "POST", fields: { password, t }, ip }), now);
}
export async function adminSession(env, now = NOW) {
  const r = await login(env, env.ADMIN_PASSWORD, { now });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const dash = await call(env, req("/admin", { cookie }), now);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await dash.text())[1];
  return { cookie, csrf };
}
export const adminDo = (env, s, action, extra = {}, now = NOW, fetchFn) =>
  call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: action, ...extra } }), now, fetchFn);
