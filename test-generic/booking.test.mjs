// The booking flow with the configured slot length, buffer, notice and confirmation modes.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { SLOT_MINUTES, SESSION_MINUTES, SHORT_GRACE_MIN, addMinutes, localToUtc, nowLocal } from "../src/slots.js";
import { C, BASE, DAY, NOW, RELAY, A, NEAR, NEXT, setup, book, call, req, rows, relay, text, at, tokenFrom, freshIp } from "./helpers.mjs";

const slotOf = (time) => `${DAY}T${time}`;

test("booking the first start time works and shows the session length, not the buffer", async () => {
  const { env } = await setup();
  const r = await book(env, { slot: slotOf(C.defaultTimes[0]) });
  assert.equal(r.status, 200);
  const html = await text(r);
  assert.equal(rows(env.DB).length, 1);
  assert.equal(rows(env.DB)[0].status, "confirmed", "without a mail relay the booking is confirmed at once");
  assert.ok(html.includes(addMinutes(C.defaultTimes[0], SESSION_MINUTES)), "the card ends the session at start + sessionMinutes");
});

test("a booking blocks slotMinutes: a start inside them is refused, the first start at slotMinutes is accepted", async () => {
  const { env } = await setup({}, { times: [A, NEAR, NEXT] });
  assert.equal((await book(env, { slot: slotOf(A) })).status, 200);
  const refused = await book(env, { slot: slotOf(NEAR) });
  assert.equal(refused.status, 409, `${NEAR} is inside the ${SLOT_MINUTES} minutes blocked by ${A}`);
  assert.equal(rows(env.DB).length, 1);
  assert.equal((await book(env, { slot: slotOf(NEXT) })).status, 200, `${NEXT} is exactly ${SLOT_MINUTES} minutes after ${A}`);
  assert.deepEqual(rows(env.DB).map((b) => b.time), [A, NEXT]);
});

test("a start inside the blocked time is not even offered on the home page", async () => {
  const { env } = await setup({}, { times: [A, NEAR, NEXT] });
  const before = await text(await call(env, req("/")));
  assert.ok(before.includes(`value="${slotOf(NEAR)}"`));
  await book(env, { slot: slotOf(A) });
  const after = await text(await call(env, req("/")));
  assert.ok(!after.includes(`value="${slotOf(A)}"`));
  assert.ok(!after.includes(`value="${slotOf(NEAR)}"`), "the overlapping start disappears with the booking");
  assert.ok(after.includes(`value="${slotOf(NEXT)}"`));
});

test("a double submit of the same slot by two people: the second one is refused", async () => {
  const { env } = await setup();
  assert.equal((await book(env, { slot: slotOf(A) })).status, 200);
  assert.equal((await book(env, { slot: slotOf(A) })).status, 409);
});

test("notice hours: a slot closer than minNoticeHours is refused, one at exactly that distance is accepted", async () => {
  const start = localToUtc(DAY, C.defaultTimes[0]);
  const refuseAt = new Date(start.getTime() - (C.minNoticeHours * 60 - 1) * 60000);
  const okAt = new Date(start.getTime() - C.minNoticeHours * 60 * 60000);
  const a = await setup();
  assert.equal((await book(a.env, { slot: slotOf(C.defaultTimes[0]) }, { now: refuseAt })).status, 409, "one minute short of the notice");
  const b = await setup();
  assert.equal((await book(b.env, { slot: slotOf(C.defaultTimes[0]) }, { now: okAt })).status, 200, "exactly the notice");
});

test("the day exception: with it a fixed slot can be booked until shortNoticeMinutes before it starts", async (t) => {
  const T0 = C.defaultTimes[0];
  const start = localToUtc(DAY, T0);
  const ok = new Date(start.getTime() - (C.shortNoticeMinutes + 1) * 60000);
  if (nowLocal(ok).date !== DAY || C.minNoticeHours * 60 <= C.shortNoticeMinutes + 1) return t.skip("the configured times leave no room for this check");
  const plain = await setup();
  assert.equal((await book(plain.env, { slot: slotOf(T0) }, { now: ok })).status, 409, "without the exception the normal notice applies");
  const exc = await setup();
  await D.setNoNotice(exc.DB, DAY);
  assert.equal((await book(exc.env, { slot: slotOf(T0) }, { now: ok })).status, 200, "with the exception it is open");
  if (C.shortNoticeMinutes - SHORT_GRACE_MIN - 1 >= 0) {
    const late = new Date(start.getTime() - (C.shortNoticeMinutes - SHORT_GRACE_MIN - 1) * 60000);
    const exc2 = await setup();
    await D.setNoNotice(exc2.DB, DAY);
    assert.equal((await book(exc2.env, { slot: slotOf(T0) }, { now: late })).status, 409, "but not closer than the exception allows");
  }
});

test("without a mail relay: no mail is attempted and the page links the calendar file", async () => {
  const { env } = await setup();
  const m = relay();
  const html = await text(await book(env, { slot: slotOf(A) }, { fetchFn: m.fn }));
  assert.equal(m.calls.length, 0);
  assert.match(html, /\/ics\/[A-Za-z0-9_-]{20,}/);
});

test("e-mail confirmation mode: pending for 2 hours, a mail with the link, and confirming sends the confirmation and the notice", async () => {
  const { DB, env } = await setup(RELAY);
  const m = relay();
  const r = await book(env, { slot: slotOf(A) }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const b = rows(DB)[0];
  assert.equal(b.status, "pending");
  assert.equal(Date.parse(b.expires_at) - NOW.getTime(), 2 * 3600_000);
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].json.to, b.email);
  assert.ok(m.calls[0].json.text.includes(`${BASE}/c/${b.token}`), "the mail carries the confirmation link built on the site address (configured, or the origin of the request)");
  // confirm with the link
  const conf = await call(env, req(`/c/${b.token}`, { method: "POST" }), NOW, m.fn);
  assert.equal(conf.status, 200);
  assert.equal(rows(DB)[0].status, "confirmed");
  assert.equal(m.calls.length, 3, "confirmation to the person and notice to the researcher");
  assert.equal(m.calls[2].json.to, C.contactEmail, "the notice goes to contactEmail by default");
});

test("ADMIN_EMAIL overrides contactEmail for the notices", async () => {
  const { env } = await setup({ ...RELAY, ADMIN_EMAIL: "someone-else@example.net" });
  await D.setSetting(env.DB, "confirm_mode", "instant");
  const m = relay();
  await book(env, { slot: slotOf(A) }, { fetchFn: m.fn });
  assert.deepEqual(m.calls.map((c) => c.json.to).sort(), [rows(env.DB)[0].email, "someone-else@example.net"].sort());
});

test("instant confirmation mode: confirmed at once, one mail to the person with the calendar and cancel links", async () => {
  const { DB, env } = await setup(RELAY);
  await D.setSetting(DB, "confirm_mode", "instant");
  const m = relay();
  const r = await book(env, { slot: slotOf(A) }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const b = rows(DB)[0];
  assert.equal(b.status, "confirmed");
  assert.equal(b.expires_at, null);
  const toPerson = m.calls.find((c) => c.json.to === b.email).json;
  assert.ok(toPerson.text.includes(`${BASE}/ics/${b.token}`) && toPerson.text.includes(`${BASE}/x/${b.token}`));
  assert.ok(!/\/c\/[A-Za-z0-9_-]{20,}\?/.test(toPerson.text) || toPerson.text.includes("&k="), "the optional verify link carries the code");
});

test("cancelling frees the slot and the neighbouring start becomes bookable again", async () => {
  const { env } = await setup({}, { times: [A, NEAR, NEXT] });
  const html = await text(await book(env, { slot: slotOf(A) }));
  const token = tokenFrom(html);
  assert.equal((await book(env, { slot: slotOf(NEAR) })).status, 409);
  const done = await call(env, req(`/x/${token}`, { method: "POST" }));
  assert.equal(done.status, 200);
  assert.equal((await book(env, { slot: slotOf(NEAR) })).status, 200);
});

test("retention: bookings older than bookingRetentionDays are purged, newer ones stay", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const ins = (id, date) => DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)")
    .run(id, id.padEnd(30, "x"), "study1", date, "10:00", "X", `${id}@example.org`, `${id}@example.org`, "attended", NOW.toISOString(), C.languages[0]);
  const day = (n) => { const d = new Date(Date.UTC(2026, 10, 16 + n)); return d.toISOString().slice(0, 10); };
  ins("old", day(-C.bookingRetentionDays - 1));
  ins("keep", day(-C.bookingRetentionDays));
  await call(env, req("/"));
  assert.deepEqual(rows(DB).map((b) => b.id), ["keep"]);
});

test("the horizon: days beyond daysAhead are not offered", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const day = (n) => new Date(Date.UTC(2026, 10, 16 + n)).toISOString().slice(0, 10);
  await D.openDay(DB, day(C.daysAhead), [C.defaultTimes[0]]);
  await D.openDay(DB, day(C.daysAhead + 1), [C.defaultTimes[0]]);
  const html = await text(await call(env, req("/")));
  assert.ok(html.includes(`value="${day(C.daysAhead)}T`));
  assert.ok(!html.includes(`value="${day(C.daysAhead + 1)}T`));
});
