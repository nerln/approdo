// The accent colour: validated as #rrggbb, served as /theme.css under the same strict Content-Security-Policy, linked last on every page.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/config.js";
import raw from "../site.config.js";
import { themeCss, accentVariants, contrast, bandColors, THEATRE_TOKENS } from "../src/theme.js";
import { C, setup, call, req, text } from "./helpers.mjs";

test("accent: only #rrggbb is accepted, a missing one is the design's green", () => {
  assert.equal(normalizeConfig({ ...raw, accent: undefined }).accent, "#246b5c");
  assert.equal(normalizeConfig({ ...raw, accent: "#AABBCC" }).accent, "#aabbcc");
  for (const bad of ["red", "#abc", "#12345g", "#1234567", "rgb(0,0,0)", "#fff;}body{display:none", "", 5, null, "url(x)"]) assert.throws(() => normalizeConfig({ ...raw, accent: bad }), /accent must be a colour written as #rrggbb/, String(bad));
});

test("hero.art: contour or hologram", () => {
  assert.equal(normalizeConfig({ ...raw, hero: { ...(raw.hero || {}), art: undefined } }).hero.art, "contour");
  assert.throws(() => normalizeConfig({ ...raw, hero: { ...(raw.hero || {}), art: "x" } }), /hero\.art/);
});

test("/theme.css: the accent for both themes, readable variants, strict CSP, cacheable, and it is the last stylesheet of every page", async () => {
  const { env } = await setup();
  const r = await call(env, req("/theme.css"));
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/css/);
  assert.match(r.headers.get("content-security-policy"), /style-src 'self'/);
  assert.match(r.headers.get("cache-control"), /max-age=\d+/);
  const css = await text(r);
  assert.equal(css, themeCss(C.accent, C.palette));
  assert.match(css, /--lab-accent:#[0-9a-f]{6};--lab-accent-fg:#[0-9a-f]{6}/);
  assert.match(css, /prefers-color-scheme:dark/);
  assert.ok(!/[<{]\s*script|url\(|@import/i.test(css));
  const home = await text(await call(env, req("/")));
  const links = [...home.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ["/style.css", "/theme.css"]);
  assert.ok(!/style=|<style/.test(home));
});

test("accent variants reach 4.5:1 on the papers of both themes, whatever the colour", () => {
  for (const a of ["#ffeb3b", "#0000ff", "#000000", "#ffffff", "#7a1f1f", "#246b5c"]) {
    const v = accentVariants(a);
    for (const bg of ["#f5f3eb", "#fffefa"]) assert.ok(contrast(v.light, bg) >= 4.5, `${a} light`);
    for (const bg of ["#142724", "#1c322e"]) assert.ok(contrast(v.dark, bg) >= 4.5, `${a} dark`);
    assert.ok(contrast(v.lightFg, v.light) >= 4.5 && contrast(v.darkFg, v.dark) >= 4.5, `${a} text on accent`);
  }
});

test("palette: paper (default) or theatre; the body class and /theme.css follow it, with no inline style", async () => {
  assert.equal(normalizeConfig({ ...raw, palette: undefined }).palette, "paper");
  assert.equal(normalizeConfig({ ...raw, palette: "theatre" }).palette, "theatre");
  for (const bad of ["Theatre", "dark", "", 1, null]) assert.throws(() => normalizeConfig({ ...raw, palette: bad }), /palette must be one of/, String(bad));
  assert.ok(!themeCss("#7a1f1f", "paper").includes("pal-stage"), "the paper palette adds no rules");
  const th = themeCss("#7a1f1f", "theatre");
  assert.match(th, /body\.pal-stage\{/);
  assert.match(th, /--band:#7a1f1f;--band-hi:#[0-9a-f]{6};--band-lo:#[0-9a-f]{6};--band-fg:#fff7ea/);
  assert.ok(!/url\(|@import|<script/i.test(th));
  const { env } = await setup();
  for (const p of ["/", "/terms", "/privacy"]) {
    const h = await text(await call(env, req(p)));
    assert.equal(/<body class="pal-stage">/.test(h), C.palette === "theatre", p);
    assert.equal(/<body>/.test(h), C.palette !== "theatre", p);
    assert.ok(!/style=|<style/.test(h));
  }
  const home = await text(await call(env, req("/")));
  assert.equal(home.includes('class="stage"'), C.palette === "theatre");
  assert.equal(home.includes('class="booking-layout"'), true);
});

test("theatre palette: warm inks, readable accent in both themes, and a band whose text reads on every stop of its light", () => {
  // no green in the inks of the theatre palette: red is never smaller than green by more than a little, and blue stays below red
  for (const t of Object.values(THEATRE_TOKENS)) for (const k of ["paper", "surface", "ink", "muted", "line"]) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t[k].slice(i, i + 2), 16));
    assert.ok(r >= g && g >= b, `${k} ${t[k]} is warm`);
  }
  for (const a of ["#7a1f1f", "#f0c040", "#246b5c", "#808080", "#b05a00", "#ffffff", "#000000"]) {
    const v = accentVariants(a, "theatre");
    for (const bg of ["#f6efe1", "#fffaf0"]) assert.ok(contrast(v.light, bg) >= 4.5, `${a} light`);
    for (const bg of ["#1c1512", "#271d19"]) assert.ok(contrast(v.dark, bg) >= 4.5, `${a} dark`);
    assert.ok(contrast(v.lightFg, v.light) >= 4.5 && contrast(v.darkFg, v.dark) >= 4.5, `${a} text on accent`);
    const b = bandColors(a);
    for (const bg of [b.base, b.hi, b.lo]) assert.ok(contrast(b.fg, bg) >= 4.5, `${a} band text on ${bg}`);
  }
  assert.equal(bandColors("#7a1f1f").fg, "#fff7ea", "cream text on the deep red");
  assert.equal(bandColors("#f0c040").fg, "#1c1310", "the text switches to dark on a light accent");
});
