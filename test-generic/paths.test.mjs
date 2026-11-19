// English aliases of the public paths (/terms /privacy /book /manage /unsubscribe): same handlers as the Spanish originals,
// links and mails in the style of the page language, and the middleware (body limit, noindex, dynamic-path matching, rate
// limits) treating an alias exactly like its original. Expectations follow C.legacyPaths and the configured languages.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { signForm } from "../src/auth.js";
import { C } from "../src/config.js";
import { PATH_ALIASES, pathFor, icsFileName, canonicalPath } from "../src/paths.js";
import { invitation, bareHost } from "../src/mail.js";
import { BASE, LANGS, TESTED, A, DAY, NOW, RELAY, setup, call, req, text, book, bookFields, relay, rows, freshIp } from "./helpers.mjs";

const PAIRS = Object.entries(PATH_ALIASES); // [spanish, english]
const neutral = (lang) => lang !== "es" && !C.legacyPaths;
const expectedPath = (lang, es) => (neutral(lang) ? PATH_ALIASES[es] : es);

test("pathFor and canonicalPath: Spanish pages keep the Spanish paths, other languages use the aliases (unless legacyPaths)", () => {
  for (const [es, en] of PAIRS) {
    assert.equal(pathFor("es", es), es);
    assert.equal(canonicalPath(en), es);
    assert.equal(canonicalPath(es), es);
    for (const l of ["en", "it"]) assert.equal(pathFor(l, es), C.legacyPaths ? es : en);
  }
  assert.equal(pathFor("it", "/"), "/");
  assert.equal(canonicalPath("/constructor"), "/constructor", "a name from Object.prototype is not an alias");
  assert.equal(canonicalPath("/__proto__"), "/__proto__");
  assert.equal(icsFileName("es"), "turno-estudio.ics");
  assert.equal(icsFileName("it"), C.legacyPaths ? "turno-estudio.ics" : "booking.ics");
});

test("the alias pages answer exactly like the Spanish originals, in every configured language", async () => {
  const { env } = await setup();
  for (const lang of LANGS) {
    for (const [es, en] of [["/condiciones", "/terms"], ["/privacidad", "/privacy"], ["/gestionar", "/manage"], ["/baja", "/unsubscribe"]]) {
      const a = await call(env, req(`${es}?lang=${lang}`)), b = await call(env, req(`${en}?lang=${lang}`));
      assert.equal(b.status, 200, en);
      // the pages differ only in the form token (signed with the clock) and in the address they name for themselves
      const norm = (h) => h.replace(/name="t" value="[^"]*"/g, "").replace(/(?:href|action)="\/(?:[a-z-]+)(\?lang=\w+)?"/g, "");
      assert.equal(norm(await text(b)), norm(await text(a)), `${en} = ${es} (${lang})`);
    }
    const g = await call(env, req(`/book?lang=${lang}`)), o = await call(env, req(`/reservar?lang=${lang}`));
    assert.equal(g.status, o.status);
    assert.equal(g.headers.get("location"), o.headers.get("location"), "GET /book goes home like GET /reservar");
  }
});

test("links, form actions and footer use the path style of the page language", async () => {
  const { env } = await setup();
  for (const lang of LANGS) {
    const html = await text(await call(env, req(`/?lang=${lang}`)));
    for (const [es] of PAIRS) {
      const used = expectedPath(lang, es), other = used === es ? PATH_ALIASES[es] : es;
      if (es === "/reservar") assert.ok(html.includes(`action="${used}?lang=${lang}"`), `${lang}: form action ${used}`);
      if (["/condiciones", "/privacidad", "/baja", "/gestionar"].includes(es)) assert.ok(html.includes(`href="${used}?lang=${lang}"`), `${lang}: link to ${used}`);
      assert.ok(!html.includes(`href="${other}`) && !html.includes(`action="${other}`), `${lang}: no link to ${other}`);
    }
    // the manage and unsubscribe forms post to their own address, in the page's style
    const manage = await text(await call(env, req(`/manage?lang=${lang}`)));
    assert.ok(manage.includes(`action="${expectedPath(lang, "/gestionar")}?lang=${lang}"`));
    const unsub = await text(await call(env, req(`/unsubscribe?lang=${lang}`)));
    assert.ok(unsub.includes(`action="${expectedPath(lang, "/baja")}?lang=${lang}"`));
  }
});

test("the language switch and hreflang point each language to its own path style", async () => {
  if (LANGS.length < 2) return;
  const { env } = await setup();
  for (const [es] of [["/condiciones"], ["/privacidad"]]) {
    const html = await text(await call(env, req(`${es}?lang=${LANGS[0]}`)));
    for (const l of LANGS) assert.ok(html.includes(`href="${expectedPath(l, es)}?lang=${l}"`), `${es}: switch/hreflang to ${l}`);
  }
});

test("booking, managing and unsubscribing work through the aliases", async () => {
  const { DB, env } = await setup({ ...RELAY });
  const m = relay();
  const lang = LANGS[0];
  const fields = await bookFields(DB, { slot: `${DAY}T${A}` });
  const r = await call(env, req(`/book?lang=${lang}`, { method: "POST", fields, ip: freshIp() }), NOW, m.fn);
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 1, "POST /book booked");
  const mg = await call(env, req(`/manage?lang=${lang}`, { method: "POST", fields: { email: "a@example.org", code: "000000", t: await signForm(DB, NOW.getTime() - 10_000, "manage") }, ip: freshIp() }), NOW, m.fn);
  assert.ok([200, 400].includes(mg.status), "POST /manage is handled");
  const ub = await call(env, req(`/unsubscribe?lang=${lang}`, { method: "POST", fields: { email: "a@example.org", t: await signForm(DB, NOW.getTime() - 10_000, "baja") }, ip: freshIp() }), NOW, m.fn);
  assert.equal(ub.status, 200);
  assert.ok((await text(ub)).includes(`<html lang="${lang}"`), "answered in the language asked for");
});

test("the calendar download has the file name of the booking's language", async () => {
  const { DB, env } = await setup();
  for (const lang of TESTED) {
    DB.raw.exec("DELETE FROM bookings");
    await D.setSetting(DB, "confirm_mode", "instant");
    const r = await book(env, { slot: `${DAY}T${A}` }, { lang });
    assert.ok([200, 303].includes(r.status), `booking in ${lang}`);
    const b = rows(DB)[0];
    DB.raw.prepare("UPDATE bookings SET status = 'confirmed', lang = ? WHERE id = ?").run(lang, b.id);
    const ics = await call(env, req(`/ics/${b.token}?lang=${lang}`));
    assert.equal(ics.status, 200);
    assert.match(ics.headers.get("content-disposition"), new RegExp(`filename="${icsFileName(lang).replace(".", "\\.")}"`));
    assert.equal(icsFileName(lang), neutral(lang) ? "booking.ics" : "turno-estudio.ics");
  }
});

test("the unsubscribe address in the invitation follows the language of the mail", () => {
  for (const lang of LANGS) {
    const inv = invitation({ NOLINK_DOMAINS: "" }, lang, { unsub: true });
    assert.ok(inv.body.endsWith(`${bareHost({})}${expectedPath(lang, "/baja")}`), `${lang}: ${inv.body.slice(-60)}`);
  }
});

// ---- the middleware sees aliases as the originals ---------------------------------------------------------------
test("body limit: an oversized POST to an alias is refused with 413 like the original", async () => {
  const { env } = await setup();
  for (const [es, en] of [["/reservar", "/book"], ["/gestionar", "/manage"], ["/baja", "/unsubscribe"]]) {
    for (const p of [es, en]) {
      const r = await call(env, new Request(BASE + p, { method: "POST", headers: { "content-length": "20001", "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": freshIp() }, body: "x=1" }));
      assert.equal(r.status, 413, p);
    }
  }
});

test("noindex: the pages that are noindex under their Spanish name are noindex under the alias, and the others are indexable", async () => {
  const { env } = await setup();
  for (const [es, en] of PAIRS) {
    const a = await call(env, req(`${es}`)), b = await call(env, req(`${en}`));
    assert.equal(b.headers.get("x-robots-tag"), a.headers.get("x-robots-tag"), `${en} vs ${es}`);
  }
  assert.ok((await call(env, req("/unsubscribe"))).headers.get("x-robots-tag"), "unsubscribe is noindex");
  assert.ok((await call(env, req("/manage"))).headers.get("x-robots-tag"), "manage is noindex");
  assert.equal((await call(env, req("/terms"))).headers.get("x-robots-tag"), null, "terms stay indexable");
});

test("dynamic-path matching: the aliases never reach the static assets, other paths still do", async () => {
  const { DB } = await setup();
  const seen = [];
  const env = { DB, ADMIN_PASSWORD: "x".repeat(20), NOLINK_DOMAINS: "", ASSETS: { fetch: async (r) => { seen.push(new URL(r.url).pathname); return new Response("asset", { status: 200 }); } } };
  for (const [es, en] of PAIRS) { await call(env, req(es)); await call(env, req(en)); }
  assert.deepEqual(seen, [], "no public path was served as a file");
  assert.equal(await text(await call(env, req("/style.css"))), "asset");
  assert.equal(await text(await call(env, req("/book/"))), "asset", "a trailing slash is not the alias");
  assert.equal(await text(await call(env, req("/booking"))), "asset");
  assert.deepEqual(seen, ["/style.css", "/book/", "/booking"]);
});

test("rate limits: an alias spends the same allowance as its original, and stops at the same request", async () => {
  const { env } = await setup();
  const post = (p, ip) => call(env, req(p, { method: "POST", fields: { email: "x@example.org", code: "000000", t: "bad", slot: "", web: "" }, ip }));
  const firstBlocked = async (p) => { const ip = freshIp(); for (let i = 1; i <= 60; i++) if ((await post(p, ip)).status === 429) return i; return 0; };
  for (const [es, en] of [["/reservar", "/book"], ["/gestionar", "/manage"], ["/baja", "/unsubscribe"]]) {
    const a = await firstBlocked(es), b = await firstBlocked(en);
    assert.ok(a > 1 && a <= 60, `${es} is rate limited (${a})`);
    assert.equal(b, a, `${en} blocks at the same request as ${es}`);
    // one shared allowance: spend most of it on the original, the alias runs out at once
    const ip = freshIp();
    for (let i = 1; i < a; i++) assert.notEqual((await post(es, ip)).status, 429);
    assert.equal((await post(en, ip)).status, 429, `${en} shares the allowance of ${es}`);
  }
});
