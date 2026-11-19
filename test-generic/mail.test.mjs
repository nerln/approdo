// E-mail contents, calendar files and the invitation: place, signature, duration and addresses come from the config.
import test from "node:test";
import assert from "node:assert/strict";
import { tplConfirmRequest, tplConfirmed, tplReminder, tplCancelled, tplNoShow, tplAdmin, buildIcs, googleCalUrl, invitation, mailLang, noLinks, bareHost } from "../src/mail.js";
import { SESSION_MINUTES, SLOT_MINUTES, addMinutes, localToUtc } from "../src/slots.js";
import { C, BASE, LANGS, TESTED, DAY, NOW, A, setup, book, call, req, text, relay, rows, RELAY, tokenFrom } from "./helpers.mjs";
import { orgFor } from "../src/config.js";
import { pathFor } from "../src/paths.js";
import * as D from "../src/db.js";

// BASE_URL: the address the links are built on (the configured baseUrl, or an invented origin when the configuration has none).
const ENV = { NOLINK_DOMAINS: "", BASE_URL: BASE };
const booking = (lang) => ({ id: "b1", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email: "test.person@example.org", lang, study: "study1", expires_at: new Date(localToUtc(DAY, A).getTime() - 3600_000).toISOString(), created_at: new Date(localToUtc(DAY, A).getTime() - 3 * 3600_000).toISOString() });
const placeOf = (lang) => C.place.long[mailLang(lang)] ?? C.place.long[LANGS[0]];
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const endSession = addMinutes(A, SESSION_MINUTES), endSlot = addMinutes(A, SLOT_MINUTES);

for (const lang of TESTED) {
  test(`[${lang}] every e-mail is signed with the configured signature (text and html)`, () => {
    const b = booking(lang);
    const all = { confirmRequest: tplConfirmRequest(ENV, b, { code: "123456" }), confirmed: tplConfirmed(ENV, b, { code: "123456" }), reminder: tplReminder(ENV, b), cancelled: tplCancelled(ENV, b), noshow: tplNoShow(ENV, b) };
    for (const [k, t] of Object.entries(all)) {
      assert.ok(t.text.endsWith(orgFor(lang).signature), `${k} text ends with the signature`);
      assert.ok(unesc(t.html).includes(`<p>${orgFor(lang).signature}</p>`), `${k} html carries the signature`);
    }
  });

  test(`[${lang}] confirmation, reminder and request name the configured place and the session length`, () => {
    const b = booking(lang);
    for (const [k, t] of Object.entries({ request: tplConfirmRequest(ENV, b), confirmed: tplConfirmed(ENV, b), reminder: tplReminder(ENV, b) })) {
      assert.ok(t.text.includes(placeOf(lang)), `${k}: place`);
      assert.ok(unesc(t.html).includes(placeOf(lang)), `${k}: place in html`);
    }
    const c = tplConfirmed(ENV, b);
    assert.match(c.text, new RegExp(`\\b${SESSION_MINUTES}\\b`), "duration line");
    assert.ok(c.text.includes(`${A}`) && c.text.includes(endSession), "the slot is told as start to start + session");
    if (SLOT_MINUTES !== SESSION_MINUTES) assert.ok(!c.text.includes(endSlot), "the buffer is not told to the person");
  });

  test(`[${lang}] the e-mail links are built on the site address and carry the booking language`, () => {
    const t = tplConfirmed(ENV, booking(lang), { code: "123456" });
    assert.ok(t.text.includes(`${BASE}/ics/${"t".repeat(30)}?lang=${mailLang(lang)}`));
    assert.ok(t.text.includes(`${BASE}/x/${"t".repeat(30)}?lang=${mailLang(lang)}`));
    assert.equal(bareHost(ENV), new URL(BASE).host);
  });

  test(`[${lang}] the calendar file lasts sessionMinutes in the configured zone, with the configured place`, () => {
    const b = booking(lang);
    const ics = buildIcs(ENV, b, localToUtc);
    const stamp = (name) => /(\d{8})T(\d{6})Z/.exec(new RegExp(`${name}:(.*)`).exec(ics)[1]);
    const toMs = (m) => Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2].slice(0, 2), +m[2].slice(2, 4));
    const s = toMs(stamp("DTSTART")), e = toMs(stamp("DTEND"));
    assert.equal((e - s) / 60000, SESSION_MINUTES, "event length");
    assert.equal(s, localToUtc(DAY, A).getTime(), "start is the local time in the configured zone");
    const loc = /LOCATION:(.*)/.exec(ics)[1].replace(/\\,/g, ",");
    assert.equal(loc, placeOf(lang));
    if (orgFor(lang).unit) assert.ok(/SUMMARY:(.*)/.exec(ics)[1].includes(orgFor(lang).unit.replace(/,/g, "\\,")));
    const q = new URL(googleCalUrl(ENV, b, localToUtc)).searchParams;
    const [gs, ge] = q.get("dates").split("/");
    assert.equal(gs, `${DAY.replace(/-/g, "")}T${new Date(s).toISOString().slice(11, 19).replace(/:/g, "")}Z`);
    assert.ok(ge > gs);
    assert.equal(q.get("location"), placeOf(lang));
  });

  test(`[${lang}] a booking made through the site produces a confirmation mail with the configured values`, async () => {
    const { DB, env } = await setup(RELAY);
    await D.setSetting(DB, "confirm_mode", "instant");
    const m = relay();
    await book(env, { slot: `${DAY}T${A}` }, { fetchFn: m.fn, lang });
    const b = rows(DB)[0];
    assert.equal(b.lang, lang);
    const sent = m.calls.find((c) => c.json.to === b.email).json;
    assert.ok(sent.text.includes(placeOf(lang)) && sent.text.endsWith(orgFor(lang).signature));
    assert.match(sent.text, new RegExp(`\\b${SESSION_MINUTES}\\b`));
    assert.ok(!/undefined|NaN|\[object/.test(sent.text + sent.html + sent.subject));
  });

  test(`[${lang}] the invitation text uses the configured group, session length, responsible person and address`, () => {
    for (const unsub of [false, true]) {
      const inv = invitation(ENV, lang, { unsub });
      assert.ok(inv.subject.length > 5);
      assert.ok(inv.body.includes(orgFor(lang).group) && inv.body.includes(orgFor(lang).university), "group and university");
      assert.match(inv.body, new RegExp(`\\b${SESSION_MINUTES}\\b`));
      assert.ok(inv.body.includes(`${BASE}/?lang=${lang}`));
      assert.ok(inv.body.includes(C.responsible) && inv.body.endsWith(unsub ? `${bareHost(ENV)}${pathFor(lang, "/baja")}` : orgFor(lang).signature));
    }
  });
}

test("the notice to the researcher shows the session range and names the day panel on the site address", () => {
  const t = tplAdmin(ENV, "confirmed", booking(LANGS[0]));
  assert.ok(t.text.includes(`${A}–${endSession}`));
  assert.ok(t.text.includes(`${BASE}/admin?day=${DAY}`));
});

test("noLinkDomains of the configuration decide which addresses get e-mails without links", (t) => {
  if (!C.noLinkDomains.length) return t.skip("this configuration has no noLinkDomains");
  const d = C.noLinkDomains[0];
  assert.equal(noLinks({}, `someone@${d}`), true);
  assert.equal(noLinks({}, "someone@example.org"), false);
  const b = { ...booking(LANGS[0]), email: `someone@${d}` };
  assert.ok(!/https?:\/\//.test(tplConfirmed({}, b, { code: "123456" }).text), "no URL in a link-free e-mail");
});

test("the NOLINK_DOMAINS variable overrides the configured list", () => {
  assert.equal(noLinks({ NOLINK_DOMAINS: "example.net, other.example" }, "a@other.example"), true);
  assert.equal(noLinks({ NOLINK_DOMAINS: "example.net" }, "a@example.org"), false);
  assert.equal(noLinks({ NOLINK_DOMAINS: "" }, "a@example.org"), false);
});

test("the reminder run mails tomorrow's confirmed bookings once", async () => {
  const { DB, env } = await setup(RELAY);
  await D.setSetting(DB, "confirm_mode", "instant");
  const mm = relay();
  await book(env, { slot: `${DAY}T${A}` }, { fetchFn: mm.fn });
  const before = mm.calls.length;
  const { sendReminders } = await import("../src/mail.js");
  const c = { db: DB, fetchFn: mm.fn, nowMs: NOW.getTime(), today: "2026-11-17" }; // the day before DAY
  const r = await sendReminders(env, c);
  assert.deepEqual([r.total, r.sent], [1, 1]);
  assert.equal(mm.calls.length, before + 1);
  assert.equal((await sendReminders(env, c)).total, 0, "not twice");
});
