import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_MINUTES, SLOT_MINUTES } from "../src/slots.js";
import { T } from "../src/i18n.js";
import { setup, req, call, book, rows } from "./helpers.mjs";

const AGE = /\b18 (años|years|or)|adult|mayor[ií]a de edad|\bedad\b|older|age of majority/i;

test("F1 sin requisito de edad: ni casilla, ni textos, ni error, ni nada que se envíe", async () => {
  const { DB, env } = await setup();
  for (const lang of ["es", "en"]) {
    for (const p of ["/", "/condiciones", "/privacidad"]) {
      const h = await (await call(env, req(`${p}?lang=${lang}`))).text();
      assert.doesNotMatch(h.replace(/<svg[\s\S]*?<\/svg>/g, ""), AGE, `${p} ${lang}`);
      assert.ok(!h.includes('name="adult"'));
    }
    assert.ok(!("adult" in T[lang]) && !("adult" in T[lang].err));
    for (const k of ["study1", "study2"]) assert.ok(!T[lang][k].reqs.some((r) => AGE.test(r)));
  }
  // el servidor ya no pide ni lee ese campo: sin él la reserva sale, y con él no cambia nada
  const r = await book(env, { slot: "2026-11-18T09:30" });
  assert.equal(r.status, 200);
  assert.equal(rows(DB).length, 1);
});

test("F2 la duración que se dice son 45 minutos, la del consentimiento, y los turnos van cada 45", async () => {
  assert.equal(SESSION_MINUTES, 45);
  assert.equal(SLOT_MINUTES, 45);
  const { env } = await setup();
  const es = await (await call(env, req("/?lang=es"))).text();
  const en = await (await call(env, req("/?lang=en"))).text();
  assert.match(es, /<li>(?:<svg[^>]*>.*?<\/svg>)?45 minutos<\/li>/); assert.match(en, /<li>(?:<svg[^>]*>.*?<\/svg>)?45 minutes<\/li>/);
  assert.match(es, /Cada sesión dura 45 minutos\./); assert.match(en, /Each session lasts 45 minutes\./);
  assert.match(es, /de 09:30 a 10:15/, "el rango del turno sigue siendo de 45 minutos");
  assert.doesNotMatch(es + en, /40 (minutos|minutes)|40-minute/);
  for (const p of ["/condiciones"]) {
    assert.match(await (await call(env, req(`${p}?lang=es`))).text(), /La sesión dura 45 minutos/);
    assert.match(await (await call(env, req(`${p}?lang=en`))).text(), /The session lasts 45 minutes/);
  }
});

test("F3 banda de inicio: titular, enlace a la reserva, foto del visor con su crédito y sin estilos en línea", async () => {
  const { env } = await setup();
  for (const lang of ["es", "en"]) {
    const h = await (await call(env, req(`/?lang=${lang}`))).text();
    const label = T[lang].bookH;
    // The anchor is "reserva" on Spanish pages and "book" on the others.
    const anchor = lang === "es" ? "reserva" : "book";
    assert.match(h, new RegExp(`<a class="button secondary" href="#${anchor}">${label}</a>`));
    assert.ok(h.includes(`<h2 id="${anchor}">`), "el destino del enlace existe");
    assert.match(h, /<section class="study-intro" aria-labelledby="hero-title">/);
    assert.match(h, /<img class="hs" src="\/quest3\.webp" alt="" width="1040" height="551" decoding="async">/);
    assert.match(h, /<figcaption class="art-caption">[^<]*<a href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Meta_Quest_3_front_View\.jpg" rel="noopener">Wikimedia Commons<\/a>, <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/[^"]*" rel="noopener">CC BY-SA 4\.0<\/a>/);
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, "ids únicos en la página");
    for (const m of h.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), `referencia ${m[1]}`);
    assert.ok(!/style=|<style/.test(h), "CSP: sin estilos en línea");
    assert.ok(!/<script(?![^>]*\bsrc=)/.test(h));
  }
});

test("F4 la hoja de estilo: banda burdeos igual en oscuro, foco visible y altura del visor en el móvil", () => {
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /radial-gradient\(120% 70% at 50% 40%,#9a2a2e 0%,#7a1f1f 38%,#561316 78%,#43090c 100%\)/);
  assert.match(css, /\.study-art-holo :focus-visible\{outline:3px solid #fff8ee/);
  assert.match(css, /\.scene\{position:relative;width:100%;max-width:34rem;margin:0 auto\}/);
  // El dibujo (en flujo, con su viewBox) da la altura a la escena; la foto va debajo, anclada abajo.
  assert.match(css, /\.holo-svg\{position:relative;display:block;width:100%;height:auto;overflow:visible;pointer-events:none\}/);
  assert.match(css, /\.scene \.hs\{position:absolute;left:0;bottom:0;display:block;height:auto;width:100%/);
  const hero = css.slice(css.indexOf(".study-art-holo{"), css.indexOf(".info-block{"));
  assert.ok(!/var\(--/.test(hero), "la banda no depende del tema claro/oscuro");
});

test("F5 menú holográfico de la banda: decorativo, sin estilos en línea, y animado una sola vez menos de 5 segundos", async () => {
  const { env } = await setup();
  const h = await (await call(env, req("/?lang=es"))).text();
  const svg = /<svg class="holo-svg"[\s\S]*?<\/svg>/.exec(h)?.[0] ?? "";
  assert.match(svg, /^<svg class="holo-svg" viewBox="0 0 1040 800" aria-hidden="true" focusable="false">/);
  assert.ok(h.includes('<figure class="study-art study-art-holo"><div class="scene"><img class="hs"'), "la foto va debajo del dibujo, en la misma escena");
  assert.ok(!/<text|<title|<a /.test(svg), "sin texto ni enlaces: nada que leer ni que enfocar");
  assert.ok(!/style=|<style|<script|href=|on[a-z]+=/.test(svg));
  for (const cls of ["h-panel", "h-cone", "h-cur", "h-track", "h-knob", "h-t1", "h-t3", "h-btn", "h-ico", "h-ring"]) assert.ok(svg.includes(`class="${cls}"`), cls);
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  const hero = css.slice(css.indexOf(".scene{"), css.indexOf(".info-block{"));
  assert.ok(!/infinite/.test(hero), "nada se mueve sin parar");
  const anims = [...hero.matchAll(/animation:[a-z0-9-]+ ([\d.]+)s ([\d.]+)s /g)].map((m) => Number(m[1]) + Number(m[2]));
  assert.equal(anims.length, 10);
  assert.ok(Math.max(...anims) < 5, "la animación entera dura menos de 5 segundos (WCAG 2.2.2)");
  // Todas las animaciones están dentro de la consulta de movimiento: con «reducir movimiento» se ve el estado final, quieto.
  const guarded = /@media \(prefers-reduced-motion:no-preference\)\{([\s\S]*?)\n\}/.exec(hero)?.[1] ?? "";
  assert.equal((guarded.match(/animation:/g) || []).length, 10);
  assert.equal((hero.replace(guarded, "").match(/animation:/g) || []).length, 0);
  // Una sola vez: sin número de repeticiones, sin reinicio al pasar el ratón o al enfocar.
  assert.ok(!/animation-iteration-count|animation:[^;}]*\sboth\s+\S/.test(hero));
  assert.ok(!/:(hover|focus)[^{]*\{[^}]*animation/.test(hero));
  // Cada animación tiene sus fotogramas, y el estado sin animación es el último fotograma.
  const names = [...guarded.matchAll(/animation:([a-z0-9-]+) /g)].map((m) => m[1]);
  for (const n of names) assert.ok(css.includes(`@keyframes ${n}{`), n);
  const last = (n) => new RegExp(`@keyframes ${n}\\{.*?(?:,|\\})100%\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  assert.ok(last("h-cur").includes("transform:translate(226px,22px)") && css.includes(".h-cur{transform:translate(226px,22px)}"));
  assert.ok(last("h-knob").includes("transform:translateX(30px)") && css.includes(".h-knob{transform:translateX(30px)}"));
  assert.ok(last("h-t1").includes("fill-opacity:.1") && css.includes(".h-t1{fill-opacity:.1}"));
  assert.ok(last("h-ring").includes("opacity:0") && /\.h-ring\{opacity:0;/.test(css));
  // Decorativo: se oculta con colores forzados y al imprimir.
  assert.match(css, /@media \(forced-colors:active\)\{\.holo-svg\{visibility:hidden\}\}/);
  assert.match(css, /@media print\{[^@]*\.holo-svg\{visibility:hidden\}\}/);
});
