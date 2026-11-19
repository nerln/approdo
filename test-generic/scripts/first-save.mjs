// Run by first_save.test.mjs inside a scratch copy of the project configured with ONE configuration. The same scenario runs twice on two
// fresh databases: once untouched, once after the researcher saved every study and every consent form without changing anything (the
// forms are read from the panel's own HTML and posted back, as a browser would). Prints a JSON summary: the surfaces that differ (none
// expected) and what the second database stored.
import { setup, call, req, text, adminSession, adminDo, adminGet, book, relay, RELAY, DAY, NOW, LANGS, C, at, MONDAY } from "./test-generic/helpers.mjs";
import * as D from "./src/db.js";
import { formFields } from "./test-generic/forms.mjs";

// The pieces of a page that are random on purpose (tokens, codes, ids, the time stamp of a calendar file).
const norm = (t) => String(t)
  .replace(/(\/|%2F)(c|x|ics)(\/|%2F)[A-Za-z0-9_-]{20,}/g, "$1$2$3TOKEN").replace(/\b\d{3} \d{3}\b/g, "NNN NNN").replace(/k=\d{6}/g, "k=NNNNNN")
  .replace(/name="t" value="[^"]*"/g, 'name="t" value="T"').replace(/UID:[^\r\n]*@/g, "UID:ID@").replace(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:X")
  .replace(/id%3D[A-Za-z0-9-]+/g, "id");

async function scenario(doSave) {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  const s = await adminSession(env);
  const studyIds = C.twoStudies ? ["study1", "study2"] : ["study1"];
  for (const d of ["2026-11-19", "2026-11-20"]) await D.openDay(DB, d, C.defaultTimes);
  const saved = {};
  if (doSave) {
    for (const id of studyIds) {
      // the study form and the consent form of every study, posted back as they are
      const page = await adminGet(env, s, `?s=studies&st=${id}`);
      const f = formFields(page, `study-save:${id}`);
      const r = await adminDo(env, s, `study-save:${id}`, f);
      saved[`study:${id}`] = r.status;
      const cpage = await adminGet(env, s, `?s=studies&st=${id}&c=consent`);
      const cf = formFields(cpage, `consent-save:${id}`);
      const r2 = await adminDo(env, s, `consent-save:${id}`, cf);
      saved[`consent:${id}`] = r2.status;
    }
  }
  const out = {};
  const snap = async (name, r) => { out[name] = norm(await text(r)); };
  await adminDo(env, s, "confirm-mode:instant", {}, undefined, m.fn);
  for (const id of studyIds) {
    await adminDo(env, s, `study:${id}`, {});
    for (const l of LANGS) await snap(`landing ${id} ${l}`, await call(env, req(`/?lang=${l}`)));
    // a booking in this study (the confirmation e-mail, the notice to the researcher, the booked page, the calendar file)
    const slot = `${id === "study1" ? DAY : "2026-11-19"}T${C.defaultTimes[0]}`;
    const res = await book(env, { slot, name: `Person ${id}`, email: `person-${id}@example.org` }, { fetchFn: m.fn, lang: LANGS[0] });
    await snap(`booked ${id}`, res);
    const b = DB.raw.prepare("SELECT * FROM bookings WHERE email = ?").get(`person-${id}@example.org`);
    if (b) {
      await snap(`ics ${id}`, await call(env, req(`/ics/${b.token}`)));
      await snap(`confirm page ${id}`, await call(env, req(`/c/${b.token}`)));
      await snap(`cancel page ${id}`, await call(env, req(`/x/${b.token}`)));
    }
  }
  // the e-mail with a confirmation request, then its confirmation; the reminder (the day before); a cancellation by the researcher
  await adminDo(env, s, "confirm-mode:email", {}, undefined, m.fn);
  const slot2 = `2026-11-20T${C.defaultTimes[0]}`;
  await book(env, { slot: slot2, name: "Person Email", email: "person-email@example.org" }, { fetchFn: m.fn, lang: LANGS[LANGS.length - 1] });
  const pe = DB.raw.prepare("SELECT * FROM bookings WHERE email = 'person-email@example.org'").get();
  if (pe) await snap("confirmed by link", await call(env, req(`/c/${pe.token}`, { method: "POST" }), NOW, m.fn));
  const tuesday = at(MONDAY, "10:00", 24 * 60);
  const s2 = await adminSession(env, tuesday);
  await adminDo(env, s2, "remind", {}, tuesday, m.fn);
  if (pe) await adminDo(env, s2, `cancel:${pe.id}`, { note_x: "" }, tuesday, m.fn);
  out.mails = m.calls.map((c) => norm(JSON.stringify(c.json)));
  // the terms, the privacy text, the bookings CSV, the printable sheet of every study in every language
  for (const l of LANGS) {
    await snap(`terms ${l}`, await call(env, req(`/condiciones?lang=${l}`)));
    await snap(`privacy ${l}`, await call(env, req(`/privacidad?lang=${l}`)));
  }
  out.csv = norm(await text(await call(env, req("/admin/csv", { cookie: s.cookie }))));
  for (const id of studyIds) for (const l of LANGS) out[`sheet ${id} ${l}`] = norm(await text(await call(env, req(`/admin/consent?study=${id}&lang=${l}`, { cookie: s.cookie }))));
  // what the panel stores
  const rows = DB.raw.prepare("SELECT id, data, updated_at FROM studies ORDER BY position").all().map((r) => ({ id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at }));
  return { out, rows, saved, registry: (await D.getRegistry(DB)).table };
}

const before = await scenario(false);
const after = await scenario(true);
const keys = new Set([...Object.keys(before.out), ...Object.keys(after.out)]);
const differ = [...keys].filter((k) => JSON.stringify(before.out[k]) !== JSON.stringify(after.out[k]));
// the first place where the two texts differ, with a little around it
function firstDifference(key) {
  const a = JSON.stringify(before.out[key]), b = JSON.stringify(after.out[key]);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { key, at: i, before: a.slice(Math.max(0, i - 120), i + 200), after: b.slice(Math.max(0, i - 120), i + 200) };
}
const empty = (t) => t && !t.title && !t.lead && !t.does && !t.reqs.length;
console.log(JSON.stringify({
  surfaces: keys.size,
  differ,
  firstDiff: differ.length ? firstDifference(differ[0]) : null,
  tableBefore: before.registry, tableAfter: after.registry,
  saveStatus: after.saved,
  rows: after.rows.map((r) => ({ id: r.id, texts: Object.values(r.data.texts).every(empty), noConsent: !("consent" in r.data), publicState: r.data.publicState ?? null, updatedAt: r.updated_at })),
  mails: before.out.mails.length,
}));
