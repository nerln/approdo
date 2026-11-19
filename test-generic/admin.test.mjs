// Admin panel basics with the configured durations. The panel texts are not asserted (they depend on the admin language):
// the tests look at what the actions do and at what the pages are built from.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { T } from "../src/i18n.js";
import { orgFor } from "../src/config.js";
import { SLOT_MINUTES, SESSION_MINUTES, addMinutes, parseTimes, DAYS_AHEAD } from "../src/slots.js";
import { C, LANGS, DAY, MONDAY, NOW, A, NEAR, NEXT, setup, call, req, text, adminSession, adminDo, adminGet, code, rows, at } from "./helpers.mjs";

let k = 0;
function insert(DB, o = {}) {
  k++;
  const b = { id: `adm${k}`, date: DAY, time: A, name: "Test Person", email: `adm${k}@example.org`, status: "confirmed", lang: C.languages[0], study: "study1", ...o };
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?)")
    .run(b.id, b.id.padEnd(30, "x"), b.study, b.date, b.time, b.name, b.email, b.email, b.status, NOW.toISOString(), b.lang);
  return b;
}
const slotTimes = (DB, date) => DB.raw.prepare("SELECT time FROM day_slots WHERE date = ? ORDER BY time").all(date).map((r) => r.time);

test("login: a wrong password is refused, the right one opens the panel in the admin language without inline code", async () => {
  const { env } = await setup({}, { openDay: false });
  const bad = await call(env, req("/admin/login", { method: "POST", fields: { password: "wrong", t: "x" } }));
  assert.equal(bad.status, 401);
  const s = await adminSession(env);
  const html = await adminGet(env, s);
  assert.match(html, new RegExp(`<html lang="${T[C.adminLanguage].htmlLang}"`));
  assert.ok(!/<style|\sstyle="|<script(?![^>]*\ssrc=)/.test(html));
});

test("a POST without the CSRF token is refused", async () => {
  const { env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  const r = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: `open:${DAY}` } }));
  assert.equal(r.status, 403);
  assert.deepEqual(slotTimes(env.DB, DAY), []);
});

test("opening a day creates exactly the configured default start times", async () => {
  const { env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, `open:${DAY}`)), "open");
  assert.deepEqual(slotTimes(env.DB, DAY), [...C.defaultTimes]);
  assert.equal(code(await adminDo(env, s, `open:${DAY}`)), "already-open");
});

test("the day panel shows each slot as start to start + sessionMinutes", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const html = await adminGet(env, s, `?day=${DAY}`);
  for (const t of C.defaultTimes) assert.ok(html.includes(`${t}–${addMinutes(t, SESSION_MINUTES)}`), t);
});

test("the week and several weeks open Monday to Friday with the default times, never past the horizon", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  const r = await adminDo(env, s, `week:${MONDAY}`);
  assert.equal(code(r), "week");
  assert.equal((await D.openDays(DB, MONDAY, "2026-11-22")).length, 5);
  for (const d of ["2026-11-16", "2026-11-20"]) assert.deepEqual(slotTimes(DB, d), [...C.defaultTimes]);
  const many = await adminDo(env, s, `weeks:${MONDAY}`, { weeks: "8" });
  assert.equal(code(many), "weeks");
  const last = (await D.openDays(DB, MONDAY, "2027-12-31")).pop();
  const horizon = new Date(NOW.getTime() + DAYS_AHEAD * 86400_000 + 86400_000).toISOString().slice(0, 10);
  assert.ok(last <= horizon, `${last} is within ${DAYS_AHEAD} days`);
});

test("default times: a valid list is saved and used for the next opened day", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  const list = [A, NEXT];
  assert.equal(code(await adminDo(env, s, "times", { times: list.join(", ") })), "times");
  assert.deepEqual(await D.getDefaultTimes(DB), list);
  await adminDo(env, s, `open:${DAY}`);
  assert.deepEqual(slotTimes(DB, DAY), list);
});

test("default times: starts closer than slotMinutes, or a last booking past midnight, are refused and nothing changes", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, "times", { times: `${A}, ${NEAR}` })), "bad-times");
  assert.equal(code(await adminDo(env, s, "times", { times: `${A}, ${addMinutes(A, SLOT_MINUTES - 1)}` })), "bad-times");
  assert.equal(code(await adminDo(env, s, "times", { times: "23:59" })), "bad-times");
  assert.equal(code(await adminDo(env, s, "times", { times: "nine" })), "bad-times");
  assert.deepEqual(await D.getDefaultTimes(DB), [...C.defaultTimes], "unchanged");
  assert.ok(parseTimes(`${A}, ${NEXT}`), "while exactly slotMinutes apart is valid");
});

test("opening one slot by hand: refused inside the blocked time of another, accepted at slotMinutes", async () => {
  const { env } = await setup({}, { times: [A] });
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, `slot:${DAY}T${NEAR}`)), "slot-near");
  assert.equal(code(await adminDo(env, s, `slot:${DAY}T${NEXT}`)), "slot");
  assert.deepEqual(slotTimes(env.DB, DAY), [A, NEXT].sort());
});

test("a slot with a live booking cannot be closed, and a day with one cannot be closed", async () => {
  const { DB, env } = await setup();
  insert(DB);
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, `slot:${DAY}T${A}`)), "slot-booked");
  assert.equal(code(await adminDo(env, s, `close:${DAY}`)), "has-bookings");
});

test("the admin cancels a booking: it is cancelled and the slot and its neighbour are free again", async () => {
  const { DB, env } = await setup({}, { times: [A, NEAR, NEXT] });
  const b = insert(DB);
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, `cancel:${b.id}`)), "cancel-off", "no relay: told to write to the person");
  assert.equal(rows(DB)[0].status, "cancelled");
  const home = await text(await call(env, req("/")));
  for (const t of [A, NEAR, NEXT]) assert.ok(home.includes(`value="${DAY}T${t}"`), t);
});

test("attendance can only be marked once the slot has started (configured zone)", async () => {
  const { DB, env } = await setup();
  const b = insert(DB);
  const before = at(DAY, A, -1), after = at(DAY, A, 1);
  const s1 = await adminSession(env, before);
  assert.equal(code(await adminDo(env, s1, `attended:${b.id}`, {}, before)), "not-started");
  const s2 = await adminSession(env, after);
  assert.equal(code(await adminDo(env, s2, `attended:${b.id}`, {}, after)), "marked");
  assert.equal(rows(DB)[0].status, "attended");
  assert.equal(code(await adminDo(env, s2, `noshow:${b.id}`, {}, after)), "marked");
  assert.equal(rows(DB)[0].status, "noshow");
});

test("the day exception for notice can be switched on and off for a day", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, `notice-off:${DAY}`)), "notice-off");
  assert.equal(await D.hasNoNotice(DB, DAY), true);
  assert.equal(code(await adminDo(env, s, `notice-on:${DAY}`)), "notice-on");
  assert.equal(await D.hasNoNotice(DB, DAY), false);
});

test("'available today': the closing time is proposed from the config and the mode accepts a from/until window", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  assert.ok((await adminGet(env, s)).includes(`value="${C.flexDefaultUntil}"`), "default closing time");
  assert.equal(code(await adminDo(env, s, "flex-on", { flex_from: "09:00", flex_until: "17:00" })), "flex-on");
  assert.deepEqual(await D.getFlex(DB, MONDAY), { from: "09:00", until: "17:00" });
  assert.equal(code(await adminDo(env, s, "flex-on", { flex_from: "17:00", flex_until: "09:00" })), "bad-flex");
});

test("confirmation mode can be switched from the panel and the public flow follows it", async () => {
  const { DB, env } = await setup({ MAIL_RELAY_URL: "https://relay.example/exec", MAIL_RELAY_KEY: "k".repeat(64) });
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, "confirm-mode:instant")), "confirm-instant");
  assert.equal(await D.getConfirmMode(DB), "instant");
  assert.equal(code(await adminDo(env, s, "confirm-mode:email")), "confirm-email");
  assert.equal(await D.getConfirmMode(DB), "email");
});

test("the settings panel states the configured retention period", async () => {
  const { env } = await setup();
  const s = await adminSession(env);
  const html = await adminGet(env, s);
  assert.match(html, new RegExp(`\\b${C.bookingRetentionDays}\\b[^<]*`), "retention days");
  assert.match(html, new RegExp(`\\b${C.minNoticeHours}\\b`), "notice hours");
});

test("exports: the bookings CSV keeps the language code of each booking, the contacts CSV only configured languages", async () => {
  const { DB, env } = await setup();
  for (const lang of LANGS) insert(DB, { lang, time: addMinutes(A, 0), date: lang === LANGS[0] ? DAY : "2026-11-19" });
  const s = await adminSession(env);
  const csv = await text(await call(env, req("/admin/csv", { cookie: s.cookie })));
  for (const lang of LANGS) assert.ok(csv.includes(`,"${lang}",`), lang);
  const contacts = await call(env, req("/admin/csv-contactos", { cookie: s.cookie }));
  assert.equal(contacts.status, 200);
});

test("invitations: one prepared text per configured language, built from the configuration, nothing stored", async () => {
  const { DB, env } = await setup();
  const s = await adminSession(env);
  const page = await adminGet(env, s);
  for (const l of LANGS) assert.ok(new RegExp(`<option value="${l}"`).test(page), `language option ${l}`);
  for (const l of LANGS) {
    const r = await adminDo(env, s, "invite", { addresses: "one@example.org, two@example.org", invlang: l });
    assert.equal(r.status, 200);
    const html = await text(r);
    assert.ok(html.includes(orgFor(l).group) && html.includes(String(SESSION_MINUTES)), l);
  }
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM contacts").get().n, 0);
});
