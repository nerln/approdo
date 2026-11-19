// Entry point of the Worker (wrangler.jsonc: "main"). The Workers runtime only accepts handlers as exports of this module,
// so everything else (handle, flexToday, TURNSTILE_ACTION, used by the tests and by scripts/preview.mjs) lives in app.js.
// The one thing taken from the execution context is waitUntil, for the anonymous usage count (src/usage.js); it is passed as an arrow
// function because waitUntil called as a loose function loses its `this` in Workers.
import { handle, httpsRedirect } from "./app.js";

// A request that arrives over plain HTTP is sent to HTTPS before the application sees it (httpsRedirect in src/app.js says why).
export default {
  fetch: (request, env, ctx) => httpsRedirect(request) || handle(request, env, ctx && typeof ctx.waitUntil === "function" ? { waitUntil: (p) => ctx.waitUntil(p) } : {}),
};
