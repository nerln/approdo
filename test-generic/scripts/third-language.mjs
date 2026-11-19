// Run by config.test.mjs inside a scratch copy configured with three languages (it, es, en). Prints a JSON summary.
import { setup, call, req, text } from "./test-generic/helpers.mjs";
import { langFromHeader } from "./src/i18n.js";

const { env } = await setup();
const html = await text(await call(env, req("/?lang=es")));
const nav = /<nav class="languages"[^>]*>(.*?)<\/nav>/.exec(html)[1];
const out = {
  nav: [...nav.matchAll(/hreflang="(\w+)"/g)].map((m) => m[1]),
  alt: [...html.matchAll(/<link rel="alternate" hreflang="([\w-]+)"/g)].map((m) => m[1]),
  locales: [...html.matchAll(/og:locale(?::alternate)?" content="(\w+)"/g)].map((m) => m[1]),
  short: await Promise.all(["it", "es", "en", "fr"].map(async (l) => (await call(env, req("/" + l))).status)),
  def: [langFromHeader(""), langFromHeader("it-IT"), langFromHeader("es-ES"), langFromHeader("en-GB"), langFromHeader("ja")],
  itPage: (await call(env, req("/?lang=it"))).status,
};
console.log(JSON.stringify(out));
