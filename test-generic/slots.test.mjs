// Slot rules with the configured durations, time zone and horizon.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { SLOT_MINUTES, SESSION_MINUTES, TZ, parseTimes, flexStarts, flexAllows, hhmmToMin, minToHhmm, addMinutes, localToUtc, nowLocal, localToMinutes, DEFAULT_TIMES, DAYS_AHEAD } from "../src/slots.js";
import { C, DAY, A, NEAR, NEXT, makeDB } from "./helpers.mjs";

test("slots.js constants come from the configuration", () => {
  assert.equal(SLOT_MINUTES, C.slotMinutes);
  assert.equal(SESSION_MINUTES, C.sessionMinutes);
  assert.equal(TZ, C.timeZone);
  assert.equal(DAYS_AHEAD, C.daysAhead);
  assert.deepEqual([...DEFAULT_TIMES], [...C.defaultTimes]);
});

test("parseTimes: any minutes, exactly slotMinutes apart is fine, one minute less is refused", () => {
  const a = "08:07";
  assert.deepEqual(parseTimes(`${a}, ${addMinutes(a, SLOT_MINUTES)}`), [a, addMinutes(a, SLOT_MINUTES)]);
  assert.equal(parseTimes(`${a}, ${addMinutes(a, SLOT_MINUTES - 1)}`), null);
  assert.deepEqual(parseTimes("08:00; 08:00"), ["08:00"], "duplicates collapse to one time");
});

test("parseTimes: the last booking may not run past midnight, however long the slot is", () => {
  const last = minToHhmm(1440 - SLOT_MINUTES);
  assert.deepEqual(parseTimes(last), [last]);
  assert.equal(parseTimes(minToHhmm(1440 - SLOT_MINUTES + 1)), null);
});

test("parseTimes accepts the default times of the configuration as they are", () => {
  assert.deepEqual(parseTimes(C.defaultTimes.join(", ")), [...C.defaultTimes]);
});

test("the overlap guard of insertBooking: inside the blocked time refused, at exactly slotMinutes accepted", async () => {
  const DB = makeDB();
  const b = (id, time) => ({ id, token: id.padEnd(30, "x"), study: "study1", date: DAY, time, name: "X", email: `${id}@example.org`, email_key: `${id}@example.org`, status: "confirmed", created_at: "2026-11-16T09:00:00.000Z", expires_at: null, lang: C.languages[0] });
  assert.deepEqual(await D.insertBooking(DB, b("a1", A)), { ok: true });
  assert.deepEqual(await D.insertBooking(DB, b("a2", NEAR)), { ok: false, reason: "taken" });
  // the earlier side counts too
  const before = addMinutes(A, -(SLOT_MINUTES - 1));
  if (hhmmToMin(A) - (SLOT_MINUTES - 1) >= 0) assert.deepEqual(await D.insertBooking(DB, b("a3", before)), { ok: false, reason: "taken" });
  assert.deepEqual(await D.insertBooking(DB, b("a4", NEXT)), { ok: true });
});

test("a cancelled booking frees the whole blocked time again", async () => {
  const DB = makeDB();
  const b = (id, time) => ({ id, token: id.padEnd(30, "x"), study: "study1", date: DAY, time, name: "X", email: `${id}@example.org`, email_key: `${id}@example.org`, status: "confirmed", created_at: "2026-11-16T09:00:00.000Z", expires_at: null, lang: C.languages[0] });
  await D.insertBooking(DB, b("c1", A));
  await D.setStatus(DB, "c1", "cancelled", ["confirmed"]);
  assert.deepEqual(await D.insertBooking(DB, b("c2", NEAR)), { ok: true });
});

test("flexStarts: starts are slotMinutes apart and the last session ends by `until`", () => {
  const from = hhmmToMin("09:00"), until = hhmmToMin("17:00");
  const s = flexStarts({ nowMin: 0, fromMin: from, untilMin: until });
  assert.ok(s.length >= 2);
  for (let i = 1; i < s.length; i++) assert.equal(s[i] - s[i - 1], SLOT_MINUTES);
  assert.ok(s[s.length - 1] + SESSION_MINUTES <= until, "last session ends by until");
  assert.ok(s[s.length - 1] + SLOT_MINUTES + SESSION_MINUTES > until || s[s.length - 1] + SESSION_MINUTES + SLOT_MINUTES > until, "and no further start would fit");
  assert.equal(s[0], from);
});

test("flexStarts: around a live booking every offered start keeps slotMinutes from it", () => {
  const busy = [hhmmToMin("12:00")];
  const s = flexStarts({ nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("17:00"), busy });
  assert.ok(s.length > 2);
  for (const x of s) assert.ok(Math.abs(x - busy[0]) >= SLOT_MINUTES, `${minToHhmm(x)} too close to the booking`);
  assert.ok(s.some((x) => x > busy[0]), "starts after the booking are offered too");
});

test("flexAllows: the hard rule agrees with flexStarts and refuses starts inside the blocked time", () => {
  const w = { nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("17:00"), busy: [hhmmToMin("12:00")] };
  for (const s of flexStarts(w)) assert.equal(flexAllows({ ...w, startMin: s }), true, minToHhmm(s));
  assert.equal(flexAllows({ ...w, startMin: hhmmToMin("12:00") + SLOT_MINUTES - 5 }), false);
  assert.equal(flexAllows({ ...w, startMin: hhmmToMin("17:00") - SESSION_MINUTES + 5 }), false, "would end after until");
});

test("time zone: local time goes through the configured zone, including around a clock change", () => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  for (const iso of ["2026-01-15T12:00:00Z", "2026-03-29T00:30:00Z", "2026-06-30T22:30:00Z", "2026-10-25T00:30:00Z", "2026-12-31T23:30:00Z"]) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    const want = `${parts.year}-${parts.month}-${parts.day} ${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
    const got = nowLocal(new Date(iso));
    assert.equal(`${got.date} ${got.time}`, want, iso);
  }
  // local -> UTC -> local round trip on ordinary days of every season
  for (const date of ["2026-01-20", "2026-04-15", "2026-07-15", "2026-11-18"]) {
    for (const time of ["00:30", "09:15", "14:00", "23:10"]) {
      const l = nowLocal(localToUtc(date, time));
      assert.deepEqual(l, { date, time }, `${date} ${time}`);
    }
  }
  assert.equal(typeof localToMinutes(DAY, "10:00"), "number");
});

test("the notice of the same-day mode follows shortNoticeMinutes", async () => {
  const { FLEX_NOTICE_MIN } = await import("../src/slots.js");
  assert.equal(FLEX_NOTICE_MIN, C.shortNoticeMinutes);
  // the first start offered is the first 5-minute step that is at least that far from now
  const now = hhmmToMin("09:00");
  const first = flexStarts({ nowMin: now, fromMin: now, untilMin: hhmmToMin("12:00") })[0];
  assert.equal(first, Math.ceil((now + C.shortNoticeMinutes) / 5) * 5);
  assert.ok(first - now >= C.shortNoticeMinutes);
});
