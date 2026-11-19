// A lab that is not the fixture lab must never see the fixture lab's names anywhere: not in a page, an e-mail, a
// calendar file, the admin panel, the source, the deployment files or the mail relay script.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import * as D from "../src/db.js";
import { tplConfirmRequest, tplConfirmed, tplReminder, tplCancelled, tplNoShow, tplAdmin, tplTest, buildIcs, googleCalUrl, invitation } from "../src/mail.js";
import { localToUtc } from "../src/slots.js";
import { C, LANGS, DAY, A, setup, book, call, req, text, relay, rows, RELAY, adminSession, adminDo, adminGet } from "./helpers.mjs";

const FIXTURE = /demolab|\bEDI\b|villaejemplo|1\.2\.34|unidemo\.es/i;
const configIsFixture = FIXTURE.test(JSON.stringify(C));
const opts = { skip: configIsFixture ? "this configuration IS the fixture lab" : false };
const root = new URL("../", import.meta.url);
const clean = (what, s) => assert.ok(!FIXTURE.test(s), `${what}: ${(FIXTURE.exec(s) || [""])[0]} found near "${s.slice(Math.max(0, (FIXTURE.exec(s) || { index: 0 }).index - 40), (FIXTURE.exec(s) || { index: 0 }).index + 40).replace(/\s+/g, " ")}"`);

test("public pages in every language, with and without a booking", opts, async () => {
  const { env } = await setup(RELAY);
  for (const lang of LANGS) {
    for (const path of ["/", "/condiciones", "/privacidad", "/baja", "/gestionar", "/nada", "/c/" + "a".repeat(30)]) {
      clean(`${lang} ${path}`, await text(await call(env, req(`${path}?lang=${lang}`))));
    }
  }
  for (const lang of LANGS) {
    const { env: e2 } = await setup();
    const html = await text(await book(e2, {}, { lang }));
    clean(`${lang} booked page`, html);
    const token = /\/x\/([A-Za-z0-9_-]{20,})/.exec(html)[1];
    clean(`${lang} cancel page`, await text(await call(e2, req(`/x/${token}?lang=${lang}`))));
    clean(`${lang} confirm page`, await text(await call(e2, req(`/c/${token}?lang=${lang}`))));
    clean(`${lang} ics`, await text(await call(e2, req(`/ics/${token}?lang=${lang}`))));
  }
});

test("every e-mail template, the calendar file and the invitation", opts, () => {
  const env = { NOLINK_DOMAINS: "" };
  for (const lang of LANGS) {
    const b = { id: "b", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email: "tp@example.org", lang, study: "study2", expires_at: "2026-11-18T08:00:00.000Z", created_at: "2026-11-18T06:00:00.000Z" };
    for (const email of ["tp@example.org", "tp@" + (C.noLinkDomains[0] || "other.example")]) {
      const x = { ...b, email };
      for (const [k, t] of Object.entries({ request: tplConfirmRequest(env, x, { code: "123456" }), confirmed: tplConfirmed(env, x, { code: "123456", instant: true }), reminder: tplReminder(env, x, { code: "123456" }), cancelled: tplCancelled(env, x, "note"), noshow: tplNoShow(env, x, "note") }))
        clean(`${lang} ${k}`, t.subject + t.text + t.html);
    }
    const a = tplAdmin(env, "confirmed", b);
    clean(`${lang} admin notice`, a.subject + a.text + a.html);
    clean(`${lang} ics`, buildIcs(env, b, localToUtc));
    clean(`${lang} google calendar`, decodeURIComponent(googleCalUrl(env, b, localToUtc)));
    for (const unsub of [false, true]) { const i = invitation(env, lang, { unsub }); clean(`${lang} invitation`, i.subject + i.body); }
  }
  const t = tplTest(env);
  clean("test mail", t.subject + t.text + t.html);
});

test("mails really sent through the relay by the booking, confirmation and cancellation flows", opts, async () => {
  const { DB, env } = await setup(RELAY);
  const m = relay();
  await D.setSetting(DB, "confirm_mode", "instant");
  for (const lang of LANGS) await book(env, { slot: `${DAY}T${C.defaultTimes[LANGS.indexOf(lang)] || A}` }, { fetchFn: m.fn, lang });
  assert.ok(m.calls.length >= 2);
  for (const c of m.calls) clean("relay " + c.json.to, c.json.subject + c.json.text + c.json.html);
});

test("the admin panel: login, dashboard with an open day and bookings, settings, invitation and the exports", opts, async () => {
  const { DB, env } = await setup(RELAY);
  await book(env, { slot: `${DAY}T${A}` }, { fetchFn: relay().fn });
  const login = await call(env, req("/admin"));
  clean("login page", await text(login));
  const s = await adminSession(env);
  clean("dashboard", await adminGet(env, s));
  clean("day panel", await adminGet(env, s, `?day=${DAY}`));
  for (const l of LANGS) clean(`invite ${l}`, await text(await adminDo(env, s, "invite", { addresses: "a@example.org", invlang: l })));
  clean("csv", await text(await call(env, req("/admin/csv", { cookie: s.cookie }))));
  assert.equal(rows(DB).length, 1);
});

test("the source, the mail relay script and the deployment files", opts, () => {
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(new URL(dir, root), { withFileTypes: true })) { if (f.isDirectory()) walk(`${dir}${f.name}/`); else files.push(`${dir}${f.name}`); } };
  walk("src/"); walk("apps-script/");
  for (const f of ["wrangler.jsonc", "setup.sh", ".dev.vars.example", "schema.sql"]) if (existsSync(new URL(f, root))) files.push(f);
  assert.ok(files.length > 8);
  for (const f of files) clean(f, readFileSync(new URL(f, root), "utf8"));
});

test("no personal e-mail address and no personal name is left in the source, the deployment files or the example config", opts, () => {
  const files = ["src/config.js", "src/i18n.js", "src/mail.js", "src/pages.js", "src/admin.js", "src/index.js", "src/app.js", "src/env.js", "src/db.js", "apps-script/Code.gs", "wrangler.jsonc", "setup.sh", ".dev.vars.example", "config/example-lab.config.js"];
  for (const f of files) {
    if (!existsSync(new URL(f, root))) continue;
    const s = readFileSync(new URL(f, root), "utf8");
    const mails = (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []).filter((a) => !/@(example\.(org|net|com|edu)|sin-enlaces\.invalid)$/i.test(a));
    assert.deepEqual(mails, [], `${f}: only example addresses are allowed`);
  }
});
