// E-mails to the researcher (notice of a booking, test mail) follow adminLanguage, with the wording of src/admin_texts.js;
// a booking made in Italian gets Italian e-mails for the participant and an Italian subject in the compose-mail link of the
// admin panel, whatever the admin language is.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { tplAdmin, tplTest } from "../src/mail.js";
import { ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { dayMonth, prettyDay, addMinutes, SESSION_MINUTES } from "../src/slots.js";
import { C, BASE, DAY, A, RELAY, LANGS, setup, book, relay, rows, adminSession, adminGet } from "./helpers.mjs";

// The address of the links comes from BASE_URL (or baseUrl); the suite uses the one it visits.
const ENV = { NOLINK_DOMAINS: "", BASE_URL: BASE };

const AL = C.adminLanguage;
const M = ADMIN_TEXT_SETS[AL].mail;
const b = { id: "b1", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email: "test.person@example.org", lang: LANGS[0], study: "study1" };
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

test("the notice of a confirmed or cancelled booking is written in the admin language", () => {
  for (const [kind, what] of [["confirmed", M.noticeConfirmed], ["cancelled_by_participant", M.noticeCancelled]]) {
    const t = tplAdmin(ENV, kind, b);
    assert.equal(t.subject, `${what}: ${dayMonth(DAY)} ${A}`);
    assert.ok(t.text.startsWith(what), t.text);
    assert.ok(t.text.includes(`${prettyDay(DAY, AL)}, ${A}–${addMinutes(A, SESSION_MINUTES)}`), "the day in the admin language");
    assert.ok(t.text.includes(`${M.panelLine}${BASE}/admin?day=${DAY}`));
    assert.ok(unesc(t.html).includes(`>${M.panelLink}</a>`));
    assert.ok(unesc(t.html).includes(what));
  }
});

test("the test e-mail is written in the admin language", () => {
  const t = tplTest(ENV);
  assert.equal(t.subject, M.testSubject);
  assert.ok(t.text.includes(M.testBody) && t.text.includes(`${M.testPanel}${BASE}/admin`));
  assert.ok(unesc(t.html).includes(M.testBody) && unesc(t.html).includes(`>${M.testLink}</a>`));
});

test("Italian admin wording, when the admin language is Italian", (t) => {
  if (AL !== "it") return t.skip(`adminLanguage is "${AL}"`);
  const n = tplAdmin({ NOLINK_DOMAINS: "" }, "confirmed", b);
  assert.match(n.subject, /^Prenotazione confermata: \d\d\/\d\d /);
  assert.ok(n.text.includes("Giorno nel pannello: "));
  assert.match(tplAdmin({ NOLINK_DOMAINS: "" }, "cancelled_by_participant", b).subject, /^Annullata dalla persona: /);
  assert.match(tplTest({}).subject, /^E-mail di prova: /);
});

test("the notice that reaches the researcher through the relay uses the admin wording", async () => {
  const { DB, env } = await setup({ ...RELAY, ADMIN_EMAIL: "researcher@example.org" });
  await D.setSetting(DB, "confirm_mode", "instant");
  const m = relay();
  const r = await book(env, { slot: `${DAY}T${A}` }, { fetchFn: m.fn });
  assert.equal(r.status, 200);
  const toAdmin = m.calls.map((c) => c.json).filter((j) => j.to === "researcher@example.org");
  assert.equal(toAdmin.length, 1);
  assert.equal(toAdmin[0].subject, `${M.noticeConfirmed}: ${dayMonth(DAY)} ${A}`);
  assert.ok(toAdmin[0].text.includes(M.panelLine));
});

const hasIt = LANGS.includes("it");
test("a booking in Italian: Italian e-mails for the participant, Italian subject in the researcher's compose link", { skip: hasIt ? false : "Italian is not a configured language" }, async () => {
  const { DB, env } = await setup({ ...RELAY, ADMIN_EMAIL: "researcher@example.org" });
  const m = relay();
  await book(env, { slot: `${DAY}T${A}` }, { fetchFn: m.fn, lang: "it" });
  const row = rows(DB)[0];
  assert.equal(row.lang, "it");
  const mails = m.calls.map((c) => c.json).filter((j) => j.to === row.email);
  assert.ok(mails.length >= 1);
  assert.match(mails[0].subject, /^Conferma il tuo turno/, "confirmation request in Italian");
  assert.ok(/Ciao|Grazie/.test(mails[0].text), mails[0].text.slice(0, 80));
  DB.raw.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(row.id);
  const s = await adminSession(env);
  const html = await adminGet(env, s, `?day=${DAY}`);
  const subject = ADMIN_TEXT_SETS[AL].subjectOne.it(dayMonth(DAY), A);
  assert.ok(html.includes(`subject=${encodeURIComponent(subject)}`), `the compose link carries the Italian subject: ${subject}`);
  assert.match(subject, /turno/i);
});
