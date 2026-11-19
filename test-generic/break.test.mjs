// The daily break: one rule (a session that overlaps it is not offered), used by the public list, the same-day mode,
// the check at booking time and every count of the dashboard. Times are derived from the configured durations.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { esc } from "../src/util.js";
import { AT, ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { SLOT_MINUTES, SESSION_MINUTES, FLEX_STEP_MIN, inBreak, breakMinutes, flexStarts, flexAllows, hhmmToMin, minToHhmm, addMinutes, addDays } from "../src/slots.js";
import { C, DAY, MONDAY, NOW, setup, book, call, req, text, rows, adminSession, adminDo, adminGet, code } from "./helpers.mjs";

const day2 = addDays(DAY, 1), day3 = addDays(DAY, 2);
// A break that covers the second default start time (or the first, when there is only one) and lasts one slot.
const P = C.defaultTimes[Math.min(1, C.defaultTimes.length - 1)];
const BF = P, BU = addMinutes(P, SLOT_MINUTES);
const brk = (from, until) => breakMinutes({ from, until });
const offered = (html, date) => [...html.matchAll(new RegExp(`value="${date}T(\\d\\d:\\d\\d)"`, "g"))].map((m) => m[1]);
const home = async (env) => text(await call(env, req("/")));
const slotRows = (DB) => DB.raw.prepare("SELECT date, time FROM day_slots ORDER BY date, time").all();
const wantOffered = (b) => C.defaultTimes.filter((t) => !inBreak(hhmmToMin(t), b));

test("the rule: a session that ends exactly when the break starts is offered, one minute inside is not", () => {
  const b = brk("13:00", "14:00");
  assert.equal(inBreak(hhmmToMin("13:00") - SESSION_MINUTES, b), false, "ends exactly at the start of the break");
  assert.equal(inBreak(hhmmToMin("13:00") - SESSION_MINUTES + 1, b), true, "ends one minute into the break");
  assert.equal(inBreak(hhmmToMin("13:00"), b), true);
  assert.equal(inBreak(hhmmToMin("13:59"), b), true, "starts one minute before the end of the break");
  assert.equal(inBreak(hhmmToMin("14:00"), b), false, "starts exactly when the break ends");
  assert.equal(inBreak(hhmmToMin("09:00"), b), false);
  assert.equal(inBreak(hhmmToMin("13:00"), null), false, "no break, no effect");
});

test("getBreak reads leniently: anything that is not two valid times with from before until is no break", async () => {
  const { DB } = await setup({}, { openDay: false });
  assert.equal(await D.getBreak(DB), null, "nothing stored");
  const bad = ["nope", "null", "[]", "{}", '{"from":"13:00"}', '{"from":13,"until":14}', '{"from":"25:00","until":"26:00"}', '{"from":"14:00","until":"13:00"}', '{"from":"13:00","until":"13:00"}', '{"from":"1:00","until":"2:00"}'];
  for (const v of bad) {
    await D.setSetting(DB, "break", v);
    assert.equal(await D.getBreak(DB), null, v);
  }
  await D.setBreak(DB, "13:00", "14:00");
  assert.deepEqual(await D.getBreak(DB), { from: "13:00", until: "14:00" });
  await D.clearBreak(DB);
  assert.equal(await D.getBreak(DB), null);
});

test("a broken stored break hides nothing on the public page", async () => {
  const { DB, env } = await setup();
  await D.setSetting(DB, "break", '{"from":"zz","until":"yy"}');
  assert.deepEqual(offered(await home(env), DAY), [...C.defaultTimes]);
});

test("the public page hides the fixed slots in the break on every day, keeps the rows, and shows them again without the break", async () => {
  const { DB, env } = await setup();
  for (const d of [day2, day3]) await D.openDay(DB, d, C.defaultTimes);
  const rowsBefore = slotRows(DB);
  assert.ok(wantOffered(brk(BF, BU)).length < C.defaultTimes.length, "the break covers at least one default start");
  assert.ok(wantOffered(brk(BF, BU)).length > 0, "and leaves another");
  await D.setBreak(DB, BF, BU);
  const page = await home(env);
  for (const d of [DAY, day2, day3]) assert.deepEqual(offered(page, d), wantOffered(brk(BF, BU)), d);
  assert.deepEqual(slotRows(DB), rowsBefore, "no row of day_slots is deleted");
  await D.clearBreak(DB);
  const after = await home(env);
  for (const d of [DAY, day2, day3]) assert.deepEqual(offered(after, d), [...C.defaultTimes], d);
});

test("flexStarts with a break: nothing overlaps it, and packing resumes exactly when it ends", () => {
  const b = brk("13:00", "14:00");
  const w = { nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("19:00"), brk: b };
  const s = flexStarts(w);
  assert.ok(s.length > 3);
  for (const x of s) assert.ok(!inBreak(x, b), `${minToHhmm(x)} overlaps the break`);
  assert.ok(s.some((x) => x < b.fromMin) && s.some((x) => x >= b.untilMin));
  assert.equal(s.find((x) => x >= b.untilMin), Math.ceil(b.untilMin / FLEX_STEP_MIN) * FLEX_STEP_MIN, "the first start after the break is its end");
  const before = s.filter((x) => x < b.fromMin);
  assert.ok(before[before.length - 1] + SESSION_MINUTES <= b.fromMin, "the last session before the break ends by its start");
  assert.ok(before[before.length - 1] + SLOT_MINUTES + SESSION_MINUTES > b.fromMin, "and no further one would have fitted");
  for (const x of s) assert.equal(flexAllows({ ...w, startMin: x }), true, minToHhmm(x));
  // without the break the same window offers more
  assert.ok(flexStarts({ ...w, brk: null }).length > s.length);
});

test("flexStarts and flexAllows with a break and bookings before, inside and after it", () => {
  const b = brk("13:00", "14:00");
  const cases = {
    before: [hhmmToMin("10:00")],
    inside: [hhmmToMin("13:20")],
    after: [hhmmToMin("15:00")],
    all: [hhmmToMin("10:00"), hhmmToMin("13:20"), hhmmToMin("15:00")],
  };
  for (const [name, busy] of Object.entries(cases)) {
    const w = { nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("19:00"), busy, brk: b };
    const s = flexStarts(w);
    assert.ok(s.length > 0, name);
    for (const x of s) {
      assert.ok(!inBreak(x, b), `${name}: ${minToHhmm(x)} overlaps the break`);
      for (const y of busy) assert.ok(Math.abs(x - y) >= SLOT_MINUTES, `${name}: ${minToHhmm(x)} too close to ${minToHhmm(y)}`);
      assert.equal(flexAllows({ ...w, startMin: x }), true, `${name}: ${minToHhmm(x)} offered but refused`);
    }
    // a start in the break is refused by the hard rule, whatever the bookings
    assert.equal(flexAllows({ ...w, startMin: hhmmToMin("13:00") }), false, name);
    assert.equal(flexAllows({ ...w, startMin: b.fromMin - SESSION_MINUTES + FLEX_STEP_MIN }), false, name);
  }
  // a booking inside the break keeps its own rule: the first start after the break waits for the end of its blocked time
  const inside = flexStarts({ nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("19:00"), busy: cases.inside, brk: b });
  assert.equal(inside.find((x) => x >= b.untilMin), Math.max(Math.ceil(b.untilMin / 5) * 5, Math.ceil((cases.inside[0] + SLOT_MINUTES) / 5) * 5));
  // with no booking, a start that ends exactly when the break begins is allowed
  const free = { nowMin: 0, fromMin: hhmmToMin("09:00"), untilMin: hhmmToMin("19:00"), brk: b };
  assert.equal(flexAllows({ ...free, startMin: b.fromMin - SESSION_MINUTES }), true);
  assert.equal(flexAllows({ ...free, startMin: b.untilMin }), true);
});

test("a booking submitted for a start in the break is refused and nothing is stored", async () => {
  const { DB, env } = await setup();
  await D.setBreak(DB, BF, BU);
  const r = await book(env, { slot: `${DAY}T${P}` });
  assert.equal(r.status, 409);
  assert.equal(rows(DB).length, 0);
  const other = wantOffered(brk(BF, BU))[0];
  assert.equal((await book(env, { slot: `${DAY}T${other}` })).status, 200, "a start outside the break still books");
  assert.equal(rows(DB).length, 1);
});

test("same-day mode: the public list and the hard check follow the break", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  await D.setFlex(DB, MONDAY, "10:00", "19:00");
  await D.setBreak(DB, "13:00", "14:00");
  const page = await home(env);
  const starts = offered(page, MONDAY).map(hhmmToMin);
  assert.ok(starts.length > 3);
  const b = brk("13:00", "14:00");
  for (const x of starts) assert.ok(!inBreak(x, b), minToHhmm(x));
  assert.ok(starts.includes(hhmmToMin("14:00")), "packing resumes when the break ends");
  const r = await book(env, { slot: `${MONDAY}T13:00` });
  assert.equal(r.status, 409);
  assert.equal(rows(DB).length, 0);
  assert.equal((await book(env, { slot: `${MONDAY}T14:00` })).status, 200);
});

test("an existing booking inside the break is untouched and still shown in the dashboard", async () => {
  const { DB, env } = await setup();
  assert.equal((await book(env, { slot: `${DAY}T${P}`, name: "Ada Test" })).status, 200);
  const before = rows(DB);
  const s = await adminSession(env);
  assert.equal(code(await adminDo(env, s, "break-on", { break_from: BF, break_until: BU })), "break-on");
  assert.deepEqual(rows(DB), before, "the booking is exactly as it was");
  const html = await adminGet(env, s, `?day=${DAY}`);
  assert.ok(html.includes("Ada Test"));
  assert.ok(html.includes(esc(AT.day.bookedInBreak)), "the day panel says that it is in the break");
  assert.equal(slotRows(DB).filter((r) => r.date === DAY).length, C.defaultTimes.length, "no slot row is deleted");
});

test("settings: save, change and remove the break", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  assert.ok(!(await adminGet(env, s)).includes('value="break-off"'), "no remove button without a break");
  assert.equal(code(await adminDo(env, s, "break-on", { break_from: "13:00", break_until: "14:00" })), "break-on");
  assert.deepEqual(await D.getBreak(DB), { from: "13:00", until: "14:00" });
  const page = await adminGet(env, s);
  assert.ok(page.includes('value="break-off"'));
  assert.ok(page.includes('name="break_from"') && page.includes('value="13:00"'));
  assert.equal(code(await adminDo(env, s, "break-on", { break_from: "12:30", break_until: "13:45" })), "break-on");
  assert.deepEqual(await D.getBreak(DB), { from: "12:30", until: "13:45" });
  assert.equal(code(await adminDo(env, s, "break-off")), "break-off");
  assert.equal(await D.getBreak(DB), null);
});

test("settings: invalid times are refused and nothing is saved", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  await D.setBreak(DB, "13:00", "14:00");
  for (const f of [{ break_from: "14:00", break_until: "13:00" }, { break_from: "13:00", break_until: "13:00" }, { break_from: "noon", break_until: "14:00" }, { break_from: "13:00" }, {}, { break_from: "24:00", break_until: "25:00" }]) {
    const r = await adminDo(env, s, "break-on", f);
    assert.equal(code(r), "bad-break", JSON.stringify(f));
    assert.deepEqual(await D.getBreak(DB), { from: "13:00", until: "14:00" }, "unchanged");
  }
  const page = await adminGet(env, s, "?m=bad-break");
  assert.ok(page.includes(esc(AT.flash["bad-break"])), "the error is shown");
});

test("settings: without the CSRF token, or without a session, nothing is saved", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  const noCsrf = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { do: "break-on", break_from: "13:00", break_until: "14:00" } }));
  assert.equal(noCsrf.status, 403);
  const noLogin = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: "break-on", break_from: "13:00", break_until: "14:00" } }));
  assert.equal(noLogin.status, 401);
  assert.equal(await D.getBreak(DB), null);
  await D.setBreak(DB, "13:00", "14:00");
  const offLogin = await call(env, req("/admin/do", { method: "POST", fields: { csrf: s.csrf, do: "break-off" } }));
  assert.equal(offLogin.status, 401);
  assert.deepEqual(await D.getBreak(DB), { from: "13:00", until: "14:00" });
});

test("the dashboard counts equal what the public page offers", async () => {
  const { DB, env } = await setup();
  await D.setBreak(DB, BF, BU);
  const n = offered(await home(env), DAY).length;
  assert.equal(n, wantOffered(brk(BF, BU)).length);
  const s = await adminSession(env);
  const html = await adminGet(env, s, `?month=${DAY.slice(0, 7)}&day=${DAY}`);
  assert.ok(html.includes(esc(AT.cal.freeOf(n, n))), "the month calendar");
  assert.ok(html.includes(esc(AT.day.pillOpen(n, n))), "the day panel");
  assert.ok(html.includes(esc(AT.day.freeInBreak)), "the slot in the break is labelled");
  assert.ok(!html.includes(esc(AT.cal.freeOf(C.defaultTimes.length, C.defaultTimes.length))) || n === C.defaultTimes.length);
});

test("the flex info line of the dashboard lists the same starts as the public page", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  await D.setFlex(DB, MONDAY, "10:00", "19:00");
  await D.setBreak(DB, "13:00", "14:00");
  const s = await adminSession(env);
  const b = brk("13:00", "14:00");
  const starts = flexStarts({ nowMin: hhmmToMin("10:00"), fromMin: hhmmToMin("10:00"), untilMin: hhmmToMin("19:00"), brk: b }).map(minToHhmm);
  const shown = starts.slice(0, 8);
  const page = await adminGet(env, s);
  assert.ok(page.includes(esc(AT.now.nextStarts(shown.join(", "), starts.length - shown.length))));
  for (const x of shown) assert.ok(!inBreak(hhmmToMin(x), b), x);
});

test("the agenda says that there is a break, with its hours and a link to the settings; nothing without one", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  const plain = await adminGet(env, s, "?s=agenda");
  assert.ok(!plain.includes(esc(AT.now.breakLink)), "nothing to change while no break is set");
  // the option is in plain sight before a break exists: one line that says there is none, with the link to add one
  assert.ok(plain.includes(`${esc(AT.now.breakNone)} <a class="lnk" href="/admin?s=settings">${esc(AT.now.breakAdd)}</a>`), "the agenda offers to add a break");
  await D.setBreak(DB, "13:00", "14:00");
  const page = await adminGet(env, s, "?s=agenda");
  assert.ok(page.includes(esc(AT.now.breakLine("13:00", "14:00"))));
  assert.ok(page.includes(`${esc(AT.now.breakLine("13:00", "14:00"))} <a class="lnk" href="/admin?s=settings">`));
  assert.ok(!page.includes(esc(AT.now.breakNone)), "and no longer says there is none");
});

test("both dashboard languages have every text of the break", () => {
  const keys = { flash: ["break-on", "break-off", "bad-break"], now: ["breakLine", "breakLink", "breakNone", "breakAdd"], cal: ["allBreak"], day: ["freeInBreak", "bookedInBreak", "pillBreak"], set: ["breakTitle", "breakFrom", "breakUntil", "breakSave", "breakRemove", "breakNote"] };
  for (const [lang, set] of Object.entries(ADMIN_TEXT_SETS)) {
    for (const [group, list] of Object.entries(keys)) for (const k of list) assert.ok(set[group][k], `${lang}.${group}.${k}`);
  }
});

test("flexStarts keeps SLOT_MINUTES from a live booking that falls just after the part before the break", () => {
  // A booking inside [from, from + SLOT - SESSION) is beyond the end of the first part, yet it still blocks the last start
  // before it: what is offered must pass the hard rule, with a break and without one.
  const b = brk("13:00", "14:00");
  const busy = [b.fromMin + FLEX_STEP_MIN];
  const w = { nowMin: 0, fromMin: b.fromMin - SESSION_MINUTES, untilMin: hhmmToMin("19:00"), busy, brk: b };
  for (const x of flexStarts(w)) assert.equal(flexAllows({ ...w, startMin: x }), true, `${minToHhmm(x)} offered but refused`);
  const plain = { ...w, brk: null, untilMin: b.fromMin };
  for (const x of flexStarts(plain)) assert.equal(flexAllows({ ...plain, startMin: x }), true, `no break: ${minToHhmm(x)} offered but refused`);
  if (SLOT_MINUTES - SESSION_MINUTES > FLEX_STEP_MIN) {
    assert.ok(!flexStarts(w).includes(b.fromMin - SESSION_MINUTES), "too close to the booking, so not offered");
    assert.ok(!flexStarts(plain).includes(b.fromMin - SESSION_MINUTES), "same without a break");
  }
});

test("a day whose slots are all in the break is not shown as a day without slots", async () => {
  const { DB, env } = await setup();
  await D.setBreak(DB, "00:00", "23:59");
  const s = await adminSession(env);
  const html = await adminGet(env, s, `?month=${DAY.slice(0, 7)}&day=${DAY}`);
  assert.ok(html.includes(esc(AT.cal.allBreak)), "the calendar cell");
  assert.ok(html.includes(esc(AT.day.pillBreak)), "the day panel");
  assert.ok(!html.includes(esc(AT.day.pillEmpty)), "not the pill of a day without slots");
});

test("the remove button of the break skips the validation of the time fields", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  await D.setBreak(DB, "13:00", "14:00");
  const page = await adminGet(env, await adminSession(env));
  assert.match(page, /<button name="do" value="break-off"[^>]*formnovalidate/);
});

test("the Italian list of starts says one more start in correct Italian", () => {
  const it = ADMIN_TEXT_SETS.it.now.nextStarts;
  assert.ok(!it("11:00", 1).includes("altri 1"));
  assert.ok(it("11:00", 3).includes("altri 3"));
  assert.equal(it("11:00", 0).includes(" e "), false);
});
