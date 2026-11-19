// Tokens firmados: marca de tiempo del formulario y sesion de administrador.
import { getKey, getSetting, setSetting } from "./db.js";
import { b64url, hmacHex, safeEqual, randomToken } from "./util.js";

const dec = new TextDecoder();
const enc = new TextEncoder();

// ---- marca de tiempo firmada (anti-bot: minimo 4 s entre cargar y enviar) ----
export async function signForm(db, nowMs, purpose = "form") {
  const key = await getKey(db);
  return `${nowMs}.${await hmacHex(key, `${purpose}:${nowMs}`)}`;
}
// Devuelve "ok" | "bad" | "fast" | "old".
export async function checkForm(db, token, nowMs, purpose = "form", { minMs = 4000, maxMs = 24 * 3600_000 } = {}) {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(String(token || ""));
  if (!m) return "bad";
  const key = await getKey(db);
  if (!safeEqual(await hmacHex(key, `${purpose}:${m[1]}`), m[2])) return "bad";
  const age = nowMs - Number(m[1]);
  if (age < minMs) return "fast";
  if (age > maxMs) return "old";
  return "ok";
}

// ---- sesion de administrador -------------------------------------------------
export const COOKIE = "vr_admin";
export const SESSION_SECONDS = 12 * 3600;
const material = async (db, env) => `${await getKey(db)}:${env.ADMIN_PASSWORD}`; // cambiar la clave invalida las sesiones

// Generacion de sesiones: salir la sube y las cookies anteriores dejan de valer en el servidor.
export const sessionGen = async (db) => Number(await getSetting(db, "session_gen")) || 0;
export const revokeSessions = async (db) => setSetting(db, "session_gen", (await sessionGen(db)) + 1);
export async function makeSession(db, env, nowMs) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: nowMs + SESSION_SECONDS * 1000, csrf: randomToken(18), g: await sessionGen(db) })));
  return `${payload}.${await hmacHex(await material(db, env), payload)}`;
}
export async function readSession(db, env, request, nowMs) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!m) return null;
  const v = m.slice(COOKIE.length + 1);
  const [payload, sig] = v.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(await hmacHex(await material(db, env), payload), sig)) return null;
  try {
    const p = JSON.parse(dec.decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
    if (!p || typeof p.exp !== "number" || p.exp < nowMs || typeof p.csrf !== "string") return null;
    if ((Number(p.g) || 0) !== (await sessionGen(db))) return null;
    return p;
  } catch {
    return null;
  }
}
export const sessionCookie = (value) => `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
