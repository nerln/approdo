// Utilidades: escape HTML, comparacion en tiempo constante, HMAC, hashes.
const enc = new TextEncoder();

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function safeEqual(a, b) {
  a = String(a ?? ""); b = String(b ?? "");
  let r = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

export const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomToken(bytes = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export async function sha256Hex(msg) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(msg)));
}

// Forma conservadora: letras, cifras y . _ % + ' - antes de la @ (y &); dominio con etiquetas ASCII. Sin ? / # ni caracteres de control o bidi.
export const EMAIL_RE = /^[A-Za-z0-9._%+&'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
// Un alias no puede llevar saltos de linea, caracteres de control, de direccion de texto, ni llevar @ ni < >. Los enlaces se desarman al ponerlo en un correo (ver nm en mail.js).
export const NAME_BAD = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}@<>]/u;
// Quita direcciones de correo de un texto de error antes de guardarlo.
export const scrubErr = (s) => String(s ?? "").replace(/[^\s<>"',;:()]+@[^\s<>"',;:()]+/g, "[correo]");

export const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "throwawaymail.com", "yopmail.com", "yopmail.fr",
  "trashmail.com", "trashmail.net", "getnada.com", "nada.email", "maildrop.cc", "dispostable.com", "fakeinbox.com",
  "mintemail.com", "mohmal.com", "emailondeck.com", "tempail.com", "burnermail.io", "spamgourmet.com", "mailnesia.com",
  "tempinbox.com", "moakt.com", "discard.email", "mytemp.email", "tmpmail.org", "tmpmail.net", "inboxkitten.com",
  "harakirimail.com", "33mail.com", "anonbox.net", "dropmail.me", "emailfake.com", "fakemail.net", "luxusmail.org",
]);
export function isDisposable(email) {
  const d = email.split("@")[1]?.toLowerCase() || "";
  return DISPOSABLE.has(d) || [...DISPOSABLE].some((x) => d.endsWith("." + x));
}

// Clave para detectar el mismo buzon: minusculas, sin +etiqueta, y sin puntos en Gmail.
export function emailKey(email) {
  let [l, d] = email.trim().toLowerCase().split("@");
  l = l.split("+")[0];
  if (d === "googlemail.com") d = "gmail.com";
  if (d === "gmail.com") l = l.replace(/\./g, "");
  return `${l}@${d}`;
}

// Evita que una hoja de calculo ejecute una celda como formula.
export function csvCell(s) {
  let v = String(s ?? "");
  if (/^\s*[=+\-@\t\r]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}
