// Recordatorios automáticos (/cron/remind), propuesta de otro turno a quien no vino, y detalles del panel.
import test from "node:test";
import assert from "node:assert/strict";
import { setup, RELAY, NOW, DAY, call, mockFetch, adminSession, adminDo, req } from "./helpers.mjs";
import { hmacHex } from "../src/util.js";
import * as D from "../src/db.js";
import { buildIcs } from "../src/mail.js";
import { localToUtc } from "../src/slots.js";

const PW = "clave-de-prueba-larga-123";
const TOMORROW_RUN = new Date("2026-11-17T09:00:00Z"); // en hora local es el 17: mañana es DAY (18)
const ins = (DB, id, status, email = `${id}@unidemo.es`, time = "09:30", lang = "es") =>
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES (?,?,'study1',?,?,?,?,?,?,?,0,?)")
    .run(id, id.padEnd(30, "x"), DAY, time, "Ana", email, email, status, NOW.toISOString(), lang);

async function cron(env, { ts = TOMORROW_RUN.getTime(), key = RELAY.MAIL_RELAY_KEY, now = TOMORROW_RUN, fetchFn, method = "POST", sig } = {}) {
  const body = JSON.stringify({ ts });
  const s = sig ?? (await hmacHex(key, body));
  const init = method === "POST" ? { method, headers: { "content-type": "application/json" }, body } : { method };
  return call(env, new Request(`https://estudio-vr-demo.workers.dev/cron/remind?sig=${s}`, init), now, fetchFn);
}

test("cron: con firma válida manda los recordatorios de mañana una sola vez y deja constancia", async () => {
  const { DB, env } = await setup({ ...RELAY });
  ins(DB, "c1", "confirmed");
  ins(DB, "p1", "pending", "p1@unidemo.es", "10:30");
  const m = mockFetch();
  const r = await cron(env, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, sent: 1, failed: 0 });
  assert.equal(m.calls.mail.length, 1);
  assert.equal(m.calls.mail[0].json.to, "c1@unidemo.es");
  assert.match(m.calls.mail[0].json.subject, /Mañana/);
  const stored = JSON.parse(await D.getSetting(DB, "cron_result"));
  assert.deepEqual([stored.sent, stored.failed, stored.at], [1, 0, TOMORROW_RUN.toISOString()]);
  const again = await cron(env, { fetchFn: m.fn });
  assert.deepEqual(await again.json(), { ok: true, sent: 0, failed: 0 }, "no repite");
  assert.equal(m.calls.mail.length, 1);
});

test("cron: firma mala, petición vieja, sin relay o con GET no hace nada", async () => {
  const { DB, env } = await setup({ ...RELAY });
  ins(DB, "c1", "confirmed");
  const m = mockFetch();
  assert.equal((await cron(env, { fetchFn: m.fn, key: "otra-clave" })).status, 403);
  assert.equal((await cron(env, { fetchFn: m.fn, sig: "" })).status, 403);
  assert.equal((await cron(env, { fetchFn: m.fn, ts: TOMORROW_RUN.getTime() - 10 * 60_000 })).status, 403);
  assert.equal((await cron(env, { fetchFn: m.fn, method: "GET" })).status, 405);
  const { env: noRelay } = await setup({});
  assert.equal((await cron(noRelay, { fetchFn: m.fn })).status, 503);
  assert.equal(m.calls.mail.length, 0);
  assert.equal(await D.getSetting(DB, "cron_result"), null);
});

test("panel: a quien no vino se le puede proponer otro turno; a los demás no", async () => {
  const { DB, env } = await setup({ ADMIN_PASSWORD: PW, ...RELAY });
  ins(DB, "n1", "noshow", "n1@unidemo.es", "09:30", "en");
  ins(DB, "c1", "confirmed", "c1@unidemo.es", "10:30");
  const s = await adminSession(env);
  const day = await (await call(env, req(`/admin?day=${DAY}&month=2026-11`, { cookie: s.cookie }))).text();
  assert.match(day, /value="rebook:n1"/);
  assert.doesNotMatch(day, /value="rebook:c1"/);
  const m = mockFetch();
  const r = await adminDo(env, s, "rebook:n1", { day: DAY }, NOW, m.fn);
  assert.match(r.headers.get("location"), /m=rebook/);
  assert.equal(m.calls.mail.length, 1);
  assert.equal(m.calls.mail[0].json.to, "n1@unidemo.es");
  assert.match(m.calls.mail[0].json.subject, /another slot/);
  assert.match(m.calls.mail[0].json.text, /estudio-vr-demo\.workers\.dev\/\?lang=en/);
  const bad = await adminDo(env, s, "rebook:c1", { day: DAY }, NOW, m.fn);
  assert.match(bad.headers.get("location"), /m=state/);
  assert.equal(m.calls.mail.length, 1);
});

test("panel: dos columnas independientes y estado de la puesta en marcha", async () => {
  const { env } = await setup({ ADMIN_PASSWORD: PW, ...RELAY });
  const s = await adminSession(env);
  const h = await (await call(env, req("/admin?s=all", { cookie: s.cookie }))).text();
  for (const c of ['class="adm-col"', 'class="o-cal"', 'class="o-panel"', 'class="o-upc"', 'class="o-set"']) assert.ok(h.includes(c), c);
  assert.doesNotMatch(h, /adm-below/);
  assert.match(h, /Listo: dirección pública: https:\/\/estudio-vr-demo\.workers\.dev/);
  assert.match(h, /Pendiente: recordatorios automáticos/);
});

test("calendario en inglés: lugar en inglés", () => {
  const ics = buildIcs({}, { token: "t".repeat(30), date: DAY, time: "09:15", lang: "en" }, localToUtc);
  assert.match(ics, /LOCATION:Laboratory 1\.2\.34\\, EDI/);
  assert.match(ics, /DTEND:20261118T090000Z/);
});
