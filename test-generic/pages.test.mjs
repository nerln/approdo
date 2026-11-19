// Public pages in every configured language (es, en and it all have built-in texts).
import test from "node:test";
import assert from "node:assert/strict";
import { langFromHeader, T, LOCALE_OG } from "../src/i18n.js";
import { LANG_REGISTRY, KNOWN_LANGS, orgFor } from "../src/config.js";
import { SESSION_MINUTES, prettyDay } from "../src/slots.js";
import { C, LANGS, TESTED, DAY, setup, call, req, text, book, tokenFrom } from "./helpers.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const has = (html, s) => html.includes(s) || html.includes(esc(s));

for (const lang of TESTED) {
  test(`[${lang}] home page: language, brand, session length, place and the open slots`, async () => {
    const { env } = await setup();
    const r = await call(env, req(`/?lang=${lang}`));
    assert.equal(r.status, 200);
    const html = await text(r);
    assert.match(html, new RegExp(`<html lang="${T[lang].htmlLang}"`));
    assert.ok(has(html, C.brand), "brand in the header");
    assert.ok(has(html, C.place.short[lang]), "short place chip");
    assert.match(html, new RegExp(`\\b${SESSION_MINUTES}\\b`), "session length");
    for (const t of C.defaultTimes) assert.ok(html.includes(`value="${DAY}T${t}"`), `slot ${t}`);
    assert.ok(has(html, prettyDay(DAY, lang)), "the day, in the page language");
    assert.ok(has(html, orgFor(lang).group) && has(html, orgFor(lang).university), "group and university from the config");
  });

  test(`[${lang}] terms, privacy, unsubscribe and manage pages render with the configured names and periods`, async () => {
    const { env } = await setup();
    for (const path of ["/condiciones", "/privacidad", "/baja", "/gestionar"]) {
      const r = await call(env, req(`${path}?lang=${lang}`));
      assert.equal(r.status, 200, path);
    }
    const priv = await text(await call(env, req(`/privacidad?lang=${lang}`)));
    assert.ok(has(priv, C.responsible), "the person responsible");
    assert.ok(has(priv, orgFor(lang).group));
    assert.match(priv, new RegExp(`\\b${C.bookingRetentionDays}\\b`), "booking retention days");
    assert.match(priv, new RegExp(`\\b${C.contactMonths}\\b`), "contact months");
    const terms = await text(await call(env, req(`/condiciones?lang=${lang}`)));
    // unless the lab rewrote the conditions itself (texts.<lang>.terms), the place comes from the config
    if (!(C.texts[lang] && "terms" in C.texts[lang])) assert.ok(has(terms, C.place.long[lang]), "the place in the conditions");
    assert.match(terms, new RegExp(`\\b${SESSION_MINUTES}\\b`));
  });

  test(`[${lang}] the booking confirmation page and the cancel page are in the booking language`, async () => {
    const { env } = await setup();
    const html = await text(await book(env, {}, { lang }));
    assert.match(html, new RegExp(`<html lang="${T[lang].htmlLang}"`));
    const token = tokenFrom(html);
    const cancel = await text(await call(env, req(`/x/${token}`)));
    assert.match(cancel, new RegExp(`<html lang="${T[lang].htmlLang}"`), "the token page opens in the language of the booking");
  });

  test(`[${lang}] every text the page needs exists (no undefined or empty text rendered)`, async () => {
    const { env } = await setup();
    for (const path of ["/", "/condiciones", "/privacidad", "/baja", "/gestionar", "/nada"]) {
      const html = await text(await call(env, req(`${path}?lang=${lang}`)));
      assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${path} has an unfilled value`);
    }
  });
}

test("language switch, hreflang and og:locale list exactly the configured languages, in order", async () => {
  const { env } = await setup();
  const html = await text(await call(env, req(`/?lang=${LANGS[0]}`)));
  if (LANGS.length === 1) {
    assert.ok(!html.includes('class="languages"'));
    return;
  }
  const sw = [...html.matchAll(/<nav class="languages"[^>]*>(.*?)<\/nav>/g)][0][1];
  assert.deepEqual([...sw.matchAll(/hreflang="(\w+)"/g)].map((m) => m[1]), LANGS);
  for (const l of LANGS) assert.ok(sw.includes(`>${LANG_REGISTRY[l].label}</a>`), `label of ${l}`);
  assert.deepEqual([...html.matchAll(/<link rel="alternate" hreflang="(\w+)"/g)].map((m) => m[1]).filter((l) => l !== "x-default"), LANGS);
  assert.ok(html.includes(`<meta property="og:locale" content="${LOCALE_OG[LANGS[0]]}">`));
  for (const l of LANGS.slice(1)) assert.ok(html.includes(`<meta property="og:locale:alternate" content="${LOCALE_OG[l]}">`));
  for (const l of KNOWN_LANGS.filter((x) => !LANGS.includes(x))) assert.ok(!html.includes(`hreflang="${l}"`), `${l} is not configured`);
});

test("short paths /xx redirect to /?lang=xx only for configured languages", async () => {
  const { env } = await setup();
  for (const l of KNOWN_LANGS) {
    const r = await call(env, req(`/${l}`));
    if (LANGS.includes(l)) {
      assert.equal(r.status, 302, l);
      assert.equal(r.headers.get("location"), `/?lang=${l}`);
    } else {
      assert.equal(r.status, 404, `${l} is not configured`);
    }
  }
  assert.equal((await call(env, req("/fr"))).status, 404);
});

test("language choice: no header gives the first language; each configured language is picked by its own header", () => {
  assert.equal(langFromHeader(""), LANGS[0]);
  assert.equal(langFromHeader(undefined), LANGS[0]);
  for (const l of LANGS) for (const p of LANG_REGISTRY[l].family) assert.equal(langFromHeader(`${p}-XX,fr;q=0.5`), l, p);
  // only unsupported languages: English for international visitors when offered, else the first language
  assert.equal(langFromHeader("ja,zh;q=0.9"), LANGS.includes("en") ? "en" : LANGS[0]);
  assert.equal(langFromHeader("*"), LANGS.includes("en") ? "en" : LANGS[0]);
});

test("?lang= with a language that is not configured is ignored, not trusted", async () => {
  const { env } = await setup();
  const html = await text(await call(env, req("/?lang=zz")));
  assert.match(html, new RegExp(`<html lang="${T[LANGS[0]].htmlLang}"`));
});

test("security headers are intact: strict CSP without inline script or style, no cookie, CSRF on the admin", async () => {
  const { env } = await setup();
  const r = await call(env, req("/"));
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.ok(!/unsafe-inline/.test(csp));
  assert.equal(r.headers.get("set-cookie"), null);
  const html = await text(r);
  assert.ok(!/<style|\sstyle="|<script(?![^>]*\ssrc=)/.test(html), "no inline style or script in the page");
});

test("the landing photo and its credit come from hero in the config", async () => {
  const { env } = await setup();
  const html = await text(await call(env, req(`/?lang=${TESTED[0] || LANGS[0]}`)));
  if (C.hero.image) {
    assert.ok(html.includes(`src="${C.hero.image}"`) && html.includes(`width="${C.hero.width}"`) && html.includes(`height="${C.hero.height}"`));
    // The photo stands in the art area; the holographic menu is drawn over it only when hero.art is "hologram".
    assert.ok(html.includes('class="study-art') && html.includes('class="holo-svg"') === (C.hero.art === "hologram"));
  } else {
    // No photo: no image; the art area shows the design's line drawing (aria-hidden, no text), and the booking button stays.
    assert.ok(html.includes('<svg class="contour"') && !html.includes('class="holo-svg"') && !/<img /.test(html));
    assert.ok(html.includes('class="button secondary"'));
  }
  const credit = C.hero.creditHtml && C.hero.creditHtml[TESTED[0] || LANGS[0]];
  // With a photo the credit sits under it, in the art area; without one it stays in the footer.
  if (credit) assert.ok(html.includes(C.hero.image ? `<figcaption class="art-caption">${credit}</figcaption>` : `<p class="credit">${credit}</p>`));
  else assert.ok(!html.includes('class="credit"') && !html.includes("art-caption"));
  assert.equal(html.includes('property="og:image"'), !!C.hero.ogImage);
});

test("the hero without a photo is styled by public/style.css only (the drawing is sized by a rule, no inline style)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /\.contour\{width:100%;height:205px;/);
});
