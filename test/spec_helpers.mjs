// Ayudas comunes de las pruebas.
import { NOW, DAY, RELAY, setup, req, call, adminSession } from "./helpers.mjs";

export const PW = "una-contrasena-larga-123";
export const text = (r) => r.text();

// Relay falso con respuesta decidida por una funcion (o por un valor fijo).
export function relay(decide = () => ({ ok: true })) {
  const calls = [];
  const fn = async (url, init) => {
    const json = JSON.parse(init.body);
    calls.push({ url: String(url), json });
    const r = typeof decide === "function" ? decide(json, calls.length) : decide;
    if (r === "throw") throw new Error("boom");
    if (r && r.status) return new Response("x", { status: r.status });
    return new Response(JSON.stringify(r));
  };
  return { fn, calls };
}

let n = 0;
// Inserta una reserva directamente en la base.
export function ins(DB, o = {}) {
  n++;
  const b = { id: `bk${n}`, date: DAY, time: "09:30", name: "Ana", email: `u${n}@unidemo.es`, status: "confirmed", lang: "es", study: "study1", expires_at: null, reminded: 0, ...o };
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(b.id, (b.token || b.id).padEnd(30, "x"), b.study, b.date, b.time, b.name, b.email, b.email.toLowerCase(), b.status, NOW.toISOString(), b.expires_at, b.reminded, b.lang);
  return b;
}

export async function admin(extra = {}, opts) {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...extra }, opts);
  const s = await adminSession(env);
  return { DB, env, s };
}
// The panel is split in sections (?s=). The helper asks for every section on one page ("s=all") unless the query names a section,
// so that the assertions see the whole panel as they always did.
const allSections = (qs) => (/[?&]s=/.test(qs) ? qs : `${qs}${qs.includes("?") ? "&" : "?"}s=all`);
export const get = async (env, s, qs = "", now = NOW) => text(await call(env, req(`/admin${allSections(qs)}`, { cookie: s.cookie }), now));
export { RELAY };
