// The optional settings arrive as Worker secrets or variables. The "Deploy to Cloudflare" button asks for every name listed in
// .dev.vars.example and leaves the placeholder there when the person types nothing, so a value that is still a placeholder
// (or empty) must behave exactly like a value that was never set: no mail relay, no bot check, no admin password.
import { C } from "./config.js";

export const SETTING_NAMES = ["ADMIN_PASSWORD", "MAIL_RELAY_URL", "MAIL_RELAY_KEY", "ADMIN_EMAIL", "TURNSTILE_SITEKEY", "TURNSTILE_SECRET", "BASE_URL", "NOLINK_DOMAINS"];
// NOLINK_DOMAINS is the one setting where an empty string is a real value ("no domain is link-free"), so it is left alone.
const KEEP_EMPTY = new Set(["NOLINK_DOMAINS"]);
const PLACEHOLDER = /^change-?me|paste-your|^studio@example\.org$/i;

export const isPlaceholder = (v) => typeof v === "string" && (v.trim() === "" || PLACEHOLDER.test(v.trim()));

// A copy of env in which the placeholder values of the settings are removed. Bindings (DB, ASSETS) are untouched.
export function cleanEnv(env) {
  let out = env;
  for (const k of SETTING_NAMES) {
    if (!(k in env)) continue;
    if (KEEP_EMPTY.has(k) && env[k] === "") continue;
    if (isPlaceholder(env[k])) {
      if (out === env) out = { ...env };
      delete out[k];
    }
  }
  return out;
}

// The origin (scheme and host) of the request being served, and the note that the admin password was too short. Both travel in
// the per-request copy of env built by requestEnv, so concurrent requests never see each other's value.
export const ORIGIN_KEY = "__requestOrigin";
export const SHORT_PASSWORD_KEY = "__adminPasswordTooShort";

// The env that one request works with: the settings without their placeholders, the origin of the request (the last resort
// for every link when neither BASE_URL nor baseUrl is set) and an ADMIN_PASSWORD that is long enough or no password at all.
export function requestEnv(rawEnv, url) {
  const env = { ...cleanEnv(rawEnv), [ORIGIN_KEY]: url.origin };
  if (env.ADMIN_PASSWORD !== undefined && String(env.ADMIN_PASSWORD).length < C.minAdminPasswordLength) {
    delete env.ADMIN_PASSWORD;
    env[SHORT_PASSWORD_KEY] = true;
  }
  return env;
}
