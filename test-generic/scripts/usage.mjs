// Run by usage.test.mjs inside a scratch copy of the project, configured by the test. What the anonymous usage count does, WITHOUT the
// test bypass (ignoreUnconfigured), for the configuration of that copy: participants' pages, the admin login page, an admin page without
// waitUntil, and an admin page with waitUntil. Prints a JSON summary. The fetch it injects is a recorder: nothing reaches the network.
import { handle } from "./src/app.js";
import * as D from "./src/db.js";
import { C, setup, bookFields, adminSession, req, NOW } from "./test-generic/helpers.mjs";

const { DB, env } = await setup();
const s = await adminSession(env);
const calls = [];
const pending = [];
const fetchFn = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return new Response(null, { status: 204 }); };
const ctx = { now: NOW, fetchFn, waitUntil: (p) => pending.push(p) };
const state = async () => { await Promise.all(pending); return { calls: calls.length, stamp: await D.getSetting(DB, "usage_ping_at"), id: await D.getSetting(DB, "install_id") }; };
const out = { usageCount: C.usageCount, unconfigured: C.unconfigured.length };

for (const p of ["/", "/privacidad", "/condiciones", "/gestionar", "/baja", "/nada"]) await handle(req(p), env, ctx);
await handle(req("/reservar", { method: "POST", fields: await bookFields(DB) }), env, ctx);
out.afterParticipants = await state();
await handle(req("/admin"), env, ctx);
out.afterLoginPage = await state();
await handle(req("/admin", { cookie: s.cookie }), env, { now: NOW, fetchFn });
out.afterNoWaitUntil = await state();
const page = await handle(req("/admin", { cookie: s.cookie }), env, ctx);
out.adminStatus = page.status;
out.afterAdmin = await state();
out.body = calls[0] ? JSON.parse(calls[0].body) : null;
console.log(JSON.stringify(out));
