// The admin panel in Italian. Meant for a configuration whose adminLanguage is "it" (config/example-lab.config.js);
// under any other admin language the panel tests are registered as skipped, and only the parity check of the two text
// sets still runs.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { ADMIN_TEXT_SETS } from "../src/admin_texts.js";
import { addMinutes, SESSION_MINUTES, dayMonth } from "../src/slots.js";
import { C, DAY, NOW, RELAY, A, NEXT, setup, call, req, text, adminSession, adminDo, adminGet, code, rows, at } from "./helpers.mjs";

const IT = C.adminLanguage === "it";
const itTest = (name, fn) => (IT ? test(name, fn) : test(name, { skip: `adminLanguage is "${C.adminLanguage}"` }, fn));

// Words that give away a Spanish panel. Case-insensitive; none of them is an Italian word.
const SPANISH = ["Reservas", "Cerrar", "Abrir", "Ajustes", "Asistió", "Hoy y mañana", "franja", "correo", "Cancelar la reserva", "Guardar", "Entrar", "Salir"];
// Words the Italian panel must not use for a slot: the slot is a "turno" everywhere.
const NOT_SLOT = ["fascia", "fasce"];
const noSpanish = (html, where) => {
  const visible = html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'");
  for (const w of SPANISH) assert.ok(!new RegExp(w, "i").test(visible), `${where}: the Spanish word "${w}" is in the panel`);
  for (const w of NOT_SLOT) assert.ok(!new RegExp(`\\b${w}\\b`, "i").test(visible), `${where}: "${w}" in the panel: a slot is a "turno"`);
};
const plain = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");
// The text of the flash message the last action redirected to.
async function flash(env, s, r, now = NOW) {
  assert.equal(r.status, 303, "an action redirects");
  // The panel is split in sections: the page after an action is read as "s=all" (every section on one page) unless it names one.
  const loc = r.headers.get("location");
  const html = await text(await call(env, req(/[?&]s=/.test(loc) ? loc : `${loc}&s=all`, { cookie: s.cookie }), now));
  const m = /<p class="(?:flash|error)" role="status">([^<]*)<\/p>/.exec(html);
  assert.ok(m, "the redirect page carries a message");
  return { msg: m[1].replace(/&#39;/g, "'"), html };
}

let k = 0;
function insert(DB, o = {}) {
  k++;
  const b = { id: `it${k}`, date: DAY, time: A, name: "Test Person", email: `it${k}@example.org`, status: "confirmed", lang: C.languages[0], study: "study1", ...o };
  DB.raw.prepare("INSERT INTO bookings (id,token,study,date,time,name,email,email_key,status,created_at,expires_at,reminded,lang) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?)")
    .run(b.id, b.id.padEnd(30, "x"), b.study, b.date, b.time, b.name, b.email, b.email, b.status, NOW.toISOString(), b.lang);
  return b;
}

// ---- the two text sets are the same shape, so a missing translation cannot reach production -------------------
const shape = (v) => (typeof v === "function" ? "fn" : Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k2, x]) => [k2, shape(x)])) : typeof v);
test("the Spanish and the Italian admin texts have exactly the same keys, in every nested object", () => {
  assert.deepEqual(shape(ADMIN_TEXT_SETS.it), shape(ADMIN_TEXT_SETS.es));
});
test("the Italian admin texts contain no Spanish telltale words", () => {
  const flat = JSON.stringify(ADMIN_TEXT_SETS.it, (_k, v) => (typeof v === "function" ? String(v) : v));
  for (const w of ["Reservas", "Cerrar", "Abrir", "Ajustes", "Asistió", "Hoy y mañana", "franja", "correo"]) assert.ok(!new RegExp(w, "i").test(flat), w);
});

itTest("login page, wrong password and the dashboard are in Italian, in Italian dates, with no Spanish", async () => {
  const { env } = await setup({}, { openDay: false });
  const login = await text(await call(env, req("/admin")));
  assert.match(plain(login), /Amministrazione/);
  assert.match(plain(login), /Password/);
  noSpanish(login, "login");
  const bad = await call(env, req("/admin/login", { method: "POST", fields: { password: "wrong", t: "x" } }));
  assert.equal(bad.status, 401);
  const badHtml = await text(bad);
  assert.match(plain(badHtml), /Il modulo era scaduto|Password errata/);
  noSpanish(badHtml, "wrong password");

  const s = await adminSession(env);
  const html = await adminGet(env, s, `?day=${DAY}`);
  noSpanish(html, "dashboard");
  const t = plain(html);
  for (const w of ["Oggi e domani", "Impostazioni", "Prossime prenotazioni", "Apri questo giorno", "Esci"]) assert.ok(t.includes(w), w);
  assert.match(t, /mercoledì 18 novembre/i, "the day is written in Italian");
  assert.match(html, /<html lang="it"/);
  assert.ok(html.includes('aria-label="Legenda"'));
  assert.match(html, /<abbr title="lunedì">lun<\/abbr>/);
  assert.ok(!/<style|\sstyle="|<script(?![^>]*\ssrc=)/.test(html), "no inline code");
});

itTest("opening and closing a day, and opening and closing one slot, answer in Italian", async () => {
  const { DB, env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  let r = await flash(env, s, await adminDo(env, s, `open:${DAY}`));
  assert.equal(r.msg, "Giorno aperto con gli orari predefiniti.");
  noSpanish(r.html, "after opening");
  const t = plain(r.html);
  assert.ok(t.includes("Chiudi questo giorno"));
  assert.ok(t.includes("Chiudi il turno"));
  assert.ok(t.includes("Libero"));
  for (const x of C.defaultTimes) assert.ok(r.html.includes(`${x}–${addMinutes(x, SESSION_MINUTES)}`));

  r = await flash(env, s, await adminDo(env, s, `slot:${DAY}T${C.defaultTimes[0]}`));
  assert.equal(r.msg, "Turno aggiornato.");
  assert.ok(plain(r.html).includes("Apri il turno"));
  assert.ok(plain(r.html).includes("Chiuso"));

  insert(DB, { time: C.defaultTimes[1] });
  r = await flash(env, s, await adminDo(env, s, `close:${DAY}`));
  assert.match(r.msg, /prenotazioni in attesa o confermate/);
  assert.match(plain(r.html), /Non si può chiudere questo giorno: ha 1 prenotazione in attesa o confermata/);
  assert.equal((await D.openDays(DB, DAY, DAY)).length, 1, "still open");
  DB.raw.prepare("DELETE FROM bookings").run();
  r = await flash(env, s, await adminDo(env, s, `close:${DAY}`));
  assert.equal(r.msg, "Giorno chiuso.");
  assert.ok(plain(r.html).includes("Apri questo giorno"));
  assert.ok(plain(r.html).includes("Questo giorno è chiuso"));
  noSpanish(r.html, "after closing");
});

itTest("changing the default times: the confirmation and the refusal are in Italian", async () => {
  const { env } = await setup({}, { openDay: false });
  const s = await adminSession(env);
  let r = await flash(env, s, await adminDo(env, s, "times", { times: `${A}, ${NEXT}` }));
  assert.equal(r.msg, "Orari predefiniti salvati.");
  assert.ok(r.html.includes(`value="${A}, ${NEXT}"`));
  r = await flash(env, s, await adminDo(env, s, "times", { times: `${A}, ${addMinutes(A, 5)}` }));
  assert.match(r.msg, /^Orari non validi\. Usa HH:MM/);
  noSpanish(r.html, "bad times");
});

itTest("marking attendance: Presente / Assente, the tags and the CSV status", async () => {
  const { DB, env } = await setup();
  const b = insert(DB, { time: A });
  const later = at(DAY, A, 30);
  const s = await adminSession(env, later);
  const before = await adminGet(env, s, `?day=${DAY}`, later);
  const t0 = plain(before);
  assert.ok(t0.includes("Presente") && t0.includes("Assente"), "both buttons are offered once the slot has started");
  assert.ok(t0.includes("Confermata"));
  noSpanish(before, "day with a booking");

  let r = await flash(env, s, await adminDo(env, s, `attended:${b.id}`, {}, later), later);
  assert.equal(r.msg, "Stato aggiornato.");
  assert.match(r.html, /class="on" aria-pressed="true">Presente</);
  assert.match(plain(r.html), /Presente/);
  r = await flash(env, s, await adminDo(env, s, `noshow:${b.id}`, {}, later), later);
  assert.match(r.html, /class="on" aria-pressed="true">Assente</);
  assert.equal(rows(DB)[0].status, "noshow");

  // The booking is not started yet one hour earlier: the panel says so, in Italian.
  const early = at(DAY, A, -60);
  const s2 = await adminSession(env, early);
  const t1 = plain(await adminGet(env, s2, `?day=${DAY}`, early));
  assert.ok(t1.includes("Non è ancora iniziato"));
  const refused = await flash(env, s2, await adminDo(env, s2, `attended:${b.id}`, {}, early), early);
  assert.equal(refused.msg, "Quel turno non è ancora iniziato.");
});

itTest("the confirmation mode switch and the set-up checklist are in Italian", async () => {
  const { env } = await setup({ ...RELAY });
  const s = await adminSession(env);
  let r = await flash(env, s, await adminDo(env, s, "confirm-mode:email"));
  assert.equal(r.msg, "D'ora in poi le prenotazioni vengono confermate via e-mail, con link o codice, entro 2 ore.");
  assert.match(r.html, /value="confirm-mode:email" class="on" aria-pressed="true">Via e-mail</);
  r = await flash(env, s, await adminDo(env, s, "confirm-mode:instant"));
  assert.equal(r.msg, "D'ora in poi le prenotazioni vengono confermate subito.");
  assert.match(r.html, /value="confirm-mode:instant" class="on" aria-pressed="true">Subito</);
  const t = plain(r.html);
  assert.ok(t.includes("Messa in funzione"));
  assert.match(t, /Fatto: relay di posta/);
  assert.match(t, /Da fare: promemoria automatici il giorno prima/);
  noSpanish(r.html, "settings");

  // Without the relay the banner explains it, in Italian.
  const { env: env2 } = await setup({}, { openDay: false });
  const s2 = await adminSession(env2);
  const html2 = await adminGet(env2, s2);
  assert.match(plain(html2), /Le e-mail sono disattivate\. Le prenotazioni vengono confermate subito/);
  noSpanish(html2, "no relay");
});

itTest("the bookings CSV and the contacts CSV have Italian headers and values; the file names are Italian", async () => {
  const { DB, env } = await setup();
  insert(DB, { time: A, status: "attended", name: "Nome Prova" });
  insert(DB, { time: NEXT, status: "noshow", name: "Altra Prova" });
  const s = await adminSession(env);
  const r = await call(env, req("/admin/csv", { cookie: s.cookie }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="prenotazioni-con-dati-personali-\d{4}-\d{2}-\d{2}\.csv"/);
  const body = await text(r);
  const lines = body.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "alias,email,studio,data,ora,stato,lingua,promemoria,email_confermata");
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.includes(',"presente",')), "attended is written as presente");
  assert.ok(lines.some((l) => l.includes(',"assente",')), "no-show is written as assente");
  assert.ok(!/asistió|no vino|"sí"/.test(body));
  const c = await call(env, req("/admin/csv-contactos", { cookie: s.cookie }));
  assert.match(c.headers.get("content-disposition"), /filename="contatti-con-dati-personali-/);
  assert.equal((await text(c)).replace(/^﻿/, "").split("\r\n")[0], "email,lingua,consenso,scadenza");
});

itTest("cancelling, the invitation block and the contacts block are in Italian", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const b = insert(DB, { time: NEXT, status: "confirmed" });
  const s = await adminSession(env);
  const html = await adminGet(env, s, `?day=${DAY}`);
  const t = plain(html);
  assert.ok(t.includes("Annulla") && /Annullare la prenotazione di Test Person \?/.test(t));
  assert.ok(t.includes("Messaggio per Test Person (facoltativo)"));
  assert.ok(t.includes("Invita") && t.includes("Contatti per studi futuri"));
  // The subject of the message to a person is in that person's language: the booking is in the first configured language,
  // whatever it is (the panel is Italian, the booking may be Spanish or English).
  const bookingLang = C.languages[0];
  const expectedSubject = ADMIN_TEXT_SETS.it.subjectOne[bookingLang](dayMonth(DAY), NEXT);
  assert.ok(html.includes(`subject=${encodeURIComponent(expectedSubject)}`), `the message to a ${bookingLang} participant is written in ${bookingLang}`);
  noSpanish(html, "booking day");

  const inv = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: "invite", addresses: "a@example.org, b@example.org, not-an-address", invlang: C.languages[0] } }));
  assert.equal(inv.status, 200);
  const it2 = plain(await text(inv));
  assert.match(it2, /Valide, nell'invito: 2/);
  assert.match(it2, /Non valide: 1/);
  assert.ok(it2.includes("Non è stato inviato nulla"));
});

itTest("a failed action keeps its Italian message with the data escaped", async () => {
  const { DB, env } = await setup({ ...RELAY });
  insert(DB, { time: NEXT, name: "<b>Nome</b>" });
  const s = await adminSession(env);
  const r = await call(env, req("/admin/do", { method: "POST", cookie: s.cookie, fields: { csrf: s.csrf, do: `cancel:it${k}` } }), NOW, async () => { throw new Error("rete"); });
  const f = await flash(env, s, r);
  assert.match(f.msg, /^Prenotazione di &lt;b&gt;Nome&lt;\/b&gt; annullata, ma l'e-mail NON è stata inviata/);
  assert.ok(!f.html.includes("<b>Nome</b>"));
  assert.equal(code(await adminDo(env, s, "does-not-exist")), "denied");
});
