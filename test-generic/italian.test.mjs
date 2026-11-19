// Italian for everything a participant sees: complete text set, no Spanish or English leftovers in pages, e-mails and
// calendar files, natural Italian dates. Runs only when "it" is a configured language (the shipped example config is).
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { BUILTIN_TEXTS } from "../src/i18n.js";
import { tplConfirmRequest, tplConfirmed, tplReminder, tplCancelled, tplNoShow, tplAdmin, tplTest, buildIcs, googleCalUrl, invitation, mailLang } from "../src/mail.js";
import { prettyDate, prettyDay, localToUtc } from "../src/slots.js";
import { C, BASE, LANGS, DAY, A, setup, book, call, req, text, relay, RELAY, tokenFrom } from "./helpers.mjs";

// ---- every text key of one language exists in the others (the built-in sets, before any lab override) ----------
const shape = (v, path = "") => {
  if (typeof v === "function") return [[path, "function"]];
  if (Array.isArray(v)) return [[path, `array:${v.length}`], ...v.flatMap((x, i) => (x !== null && typeof x === "object" ? shape(x, `${path}[${i}]`) : []))];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => shape(x, path ? `${path}.${k}` : k));
  return [[path, typeof v]];
};
test("every text key of the Spanish set exists in the Italian and English sets, with the same kind of value", () => {
  const es = new Map(shape(BUILTIN_TEXTS.es));
  for (const lang of ["it", "en"]) {
    const other = new Map(shape(BUILTIN_TEXTS[lang]));
    assert.deepEqual([...es.keys()].filter((k) => !other.has(k)), [], `keys missing in ${lang}`);
    assert.deepEqual([...other.keys()].filter((k) => !es.has(k)), [], `keys of ${lang} that es does not have`);
    for (const [k, kind] of es) assert.equal(other.get(k), kind, `${lang}.${k} has another kind of value than es.${k}`);
  }
});

// Empty on purpose: the credit line of the photo, the two sentences about the language of the study materials, and the vision
// requirement of the terms, which a lab writes only if it has something to say (a built-in text must not claim a fact about
// a study it cannot know).
const EMPTY_BY_DEFAULT = ["footPhoto", "factLangText", "termsMaterials", "termsVision"];
test("no built-in Italian text is empty, except the ones that are empty on purpose", () => {
  for (const [k, kind] of shape(BUILTIN_TEXTS.it)) if (kind === "string") {
    const v = k.split(".").reduce((o, p) => o[p], BUILTIN_TEXTS.it);
    assert.ok(String(v).trim() || EMPTY_BY_DEFAULT.includes(k), `it.${k} is empty`);
  }
});

const hasIt = LANGS.includes("it");
const opts = { skip: hasIt ? false : "Italian is not a configured language of this configuration" };

test("Italian dates read naturally", opts, () => {
  assert.equal(prettyDate("2026-11-18", "it"), "mercoledì 18 novembre 2026");
  assert.equal(prettyDay("2026-11-18", "it"), "mercoledì 18 novembre");
  assert.equal(prettyDay("2026-12-01", "it"), "martedì 1 dicembre");
  const b = { id: "b1", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email: "test.person@example.org", lang: "it", study: "study1", expires_at: "2026-11-18T07:00:00.000Z", created_at: "2026-11-18T05:00:00.000Z" };
  const t = tplConfirmed({ NOLINK_DOMAINS: "", BASE_URL: BASE }, b);
  assert.ok(t.text.includes("mercoledì 18 novembre 2026, dalle "), t.text);
  assert.match(t.subject, /^Turno confermato: 18\/11 /);
});

// ---- no Spanish or English leftovers, no name of the fixture lab --------------------------------------------------
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
// What a person reads: no scripts, styles, tags or attributes; no addresses (the paths /baja, /reservar are Spanish words in a URL).
const visible = (html) => decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\b(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/g, " ");
const TELLTALE = new RegExp([
  "turno confirmado", "\\breservas?\\b", "reservar", "\\bcorreo\\b", "booking", "\\bslots?\\b", "slot confirmed", "your email", "\\byour\\b", "\\bthe\\b", "\\bwith\\b",
  "\\bhola\\b", "\\bhello\\b", "\\bgracias\\b", "thank you", "cancelar", "cancelled", "gestionar", "estudio de", "realidad virtual", "virtual reality",
  "darse de baja", "\\bplease\\b", "\\bunsubscribe\\b", "participaci[oó]n", "pol[ií]tica", "\\bpara\\b", "\\bmanage\\b", "\\bconfirm\\b",
].join("|"), "i");
const FIXTURE = /demolab|\bEDI\b|villaejemplo|1\.2\.34|\bunidemo\.es\b/i;
const clean = (what, s) => {
  // The name of the study is the lab's own wording (studyName.it): whatever it says is not a leftover.
  const v = visible(s).split(C.studyName.it).join(" ");
  const m = TELLTALE.exec(v) || FIXTURE.exec(v);
  assert.ok(!m, `${what}: "${m && m[0]}" found near "${m && v.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, " ")}"`);
  assert.ok(!/undefined|\[object|NaN/.test(s), `${what}: unfilled value`);
};

test("Italian pages have no Spanish or English leftovers", opts, async () => {
  const { DB, env } = await setup(RELAY);
  for (const mode of ["email", "instant"]) {
    if (mode === "instant") await D.setSetting(DB, "confirm_mode", "instant");
    for (const path of ["/", "/condiciones", "/privacidad", "/baja", "/gestionar", "/nada", "/c/" + "a".repeat(30), "/x/" + "a".repeat(30)]) {
      clean(`${mode} ${path}`, await text(await call(env, req(`${path}?lang=it`))));
    }
  }
  // booked pages (pending and instant), the token pages, the page of a failed booking and of a wrong code
  for (const mode of ["email", "instant"]) {
    const { DB: db2, env: e2 } = await setup(RELAY);
    if (mode === "instant") await D.setSetting(db2, "confirm_mode", "instant");
    const m = relay();
    const page = await text(await book(e2, {}, { lang: "it", fetchFn: m.fn }));
    clean(`${mode} booked page`, page);
    const token = tokenFrom(page);
    for (const k of ["c", "x"]) clean(`${mode} /${k}/ page`, await text(await call(e2, req(`/${k}/${token}?lang=it`))));
    const bad = await text(await book(e2, { name: "" }, { lang: "it" }));
    clean(`${mode} error page`, bad);
    assert.ok(/nome o uno pseudonimo/i.test(bad), "the Italian error message");
    const wrong = await text(await call(e2, req("/gestionar?lang=it", { method: "POST", fields: { email: "nobody@example.org", code: "123456" } })));
    clean(`${mode} wrong code page`, wrong);
    // the e-mails the site sent for this booking
    // (the notice to the researcher is in the admin language, which may be Spanish: it is not a participant's e-mail)
    for (const c of m.calls) if (c.json.to !== C.contactEmail) clean(`${mode} sent e-mail (${c.json.subject})`, `${c.json.subject}\n${c.json.text}\n${c.json.html}`);
  }
});

const booking = (email = "test.person@example.org") => ({ id: "b1", token: "t".repeat(30), date: DAY, time: A, name: "Test Person", email, lang: "it", study: "study1", expires_at: new Date(localToUtc(DAY, A).getTime() - 3600_000).toISOString(), created_at: new Date(localToUtc(DAY, A).getTime() - 3 * 3600_000).toISOString() });

test("every Italian e-mail, with and without links, is in Italian", opts, () => {
  const all = [];
  for (const [env, email] of [[{ NOLINK_DOMAINS: "", BASE_URL: BASE }, "test.person@example.org"], [{ NOLINK_DOMAINS: "example.org", BASE_URL: BASE }, "test.person@example.org"]]) {
    const b = booking(email);
    for (const code of [undefined, "123456"]) {
      all.push(["request", tplConfirmRequest(env, b, { code })], ["request (short hold)", tplConfirmRequest(env, { ...b, created_at: new Date(localToUtc(DAY, A).getTime() - 3600_000).toISOString(), expires_at: new Date(localToUtc(DAY, A).getTime() - 60_000).toISOString() }, { code })]);
      all.push(["confirmed", tplConfirmed(env, b, { code })], ["confirmed instant", tplConfirmed(env, b, { code, instant: true })], ["reminder", tplReminder(env, b, { code })]);
    }
    all.push(["cancelled", tplCancelled(env, b, "Ci dispiace davvero.")], ["no-show", tplNoShow(env, b, "A presto.")]);
  }
  assert.ok(all.length >= 20);
  for (const [name, t] of all) {
    assert.ok(t.subject && t.text && t.html, name);
    clean(`e-mail ${name}`, `${t.subject}\n${t.text}\n${t.html}`);
    assert.ok(/\bCiao\b/.test(t.text) || name === "request", name);
  }
  assert.equal(tplConfirmRequest({ NOLINK_DOMAINS: "", BASE_URL: BASE }, booking()).subject, `Conferma il tuo turno: ${C.studyName.it}`);
  assert.equal(tplReminder({ NOLINK_DOMAINS: "", BASE_URL: BASE }, booking()).subject, `Domani alle ${A}: ${C.studyName.it}`);
  assert.equal(mailLang("it"), "it");
});

test("the notice to the researcher and the test e-mail are written in the admin language", opts, () => {
  const env = { NOLINK_DOMAINS: "", BASE_URL: BASE };
  const kinds = ["confirmed", "cancelled_by_participant"].map((k) => tplAdmin(env, k, booking()));
  const t = tplTest(env);
  if (C.adminLanguage === "it") {
    for (const x of [...kinds, t]) clean("admin e-mail", `${x.subject}\n${x.text}\n${x.html}`);
    assert.match(kinds[0].subject, /^Prenotazione confermata: /);
    assert.match(kinds[1].subject, /^Annullata dalla persona: /);
  } else {
    assert.match(kinds[0].subject, /^Reserva confirmada: /);
  }
});

test("the Italian calendar file and the Google Calendar link are in Italian", opts, () => {
  const env = { NOLINK_DOMAINS: "", BASE_URL: BASE };
  const b = booking();
  const ics = buildIcs(env, b, localToUtc);
  const SN = C.studyName.it;
  assert.ok(ics.includes(`SUMMARY:${SN.charAt(0).toUpperCase() + SN.slice(1)}`), ics);
  assert.match(ics, /DESCRIPTION:Sessione individuale di \d+ minuti\. Arriva con qualche minuto di anticipo\./);
  assert.ok(ics.includes(`DESCRIPTION:Domani: ${SN}`));
  assert.ok(ics.includes(`DESCRIPTION:Tra 2 ore: ${SN}`));
  assert.match(ics, /PRODID:[^\r\n]*\/\/IT\r\n/);
  const unfolded = ics.replace(/\\n/g, "\n").replace(/\\,/g, ",");
  clean("calendar file", unfolded.split("\r\n").filter((l) => !/^(PRODID|UID|URL)/.test(l)).join("\n"));
  const q = new URL(googleCalUrl(env, b, localToUtc)).searchParams;
  clean("Google Calendar link", `${q.get("text")}\n${q.get("details")}\n${q.get("location")}`);
});

test("the Italian invitation, with and without the unsubscribe paragraph, is in Italian", opts, () => {
  for (const unsub of [false, true]) {
    const inv = invitation({ NOLINK_DOMAINS: "", BASE_URL: BASE }, "it", { unsub });
    clean(`invitation (unsub ${unsub})`, `${inv.subject}\n${inv.body}`);
    assert.ok(inv.body.startsWith("Ciao,") && inv.body.includes("Puoi prenotare un turno qui:"));
    if (unsub) assert.ok(inv.body.includes("Per non riceverne più"));
  }
});

// ---- vocabulary: one word per thing, as a person writing for students and researchers would use it ----------------
const strings = (v, path = "") => (typeof v === "string" ? [[path, v]] : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${path}[${i}]`)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => strings(x, path ? `${path}.${k}` : k)) : []);
test("Italian vocabulary: the slot is always a «turno», the headset a «visore», no «fascia», «posto» or «casco»", async () => {
  const { ADMIN_TEXT_SETS } = await import("../src/admin_texts.js");
  const BAD = [[/\bfasc(?:ia|ce)\b/i, "fascia"], [/\bposto\b/i, "posto (the slot is a turno)"], [/\bcasco\b/i, "casco (use visore)"], [/\bheadset\b/i, "headset (use visore)"], [/\bannullamento della prenotazione\b/i, "annullamento della prenotazione (use annullare)"]];
  for (const [where, set] of [["i18n", BUILTIN_TEXTS.it], ["admin", ADMIN_TEXT_SETS.it]]) {
    for (const [k, v] of strings(set)) for (const [re, what] of BAD) assert.ok(!re.test(v), `${where}.${k}: "${what}" in "${v.slice(0, 80)}"`);
  }
});
