// Run by unconfigured.test.mjs inside a scratch copy of the project. What a visitor and the researcher see, without the test bypass
// (ignoreUnconfigured), for the configuration of that copy. Prints a JSON summary.
import { handle } from "./src/app.js";
import { T } from "./src/i18n.js";
import { AT } from "./src/admin_texts.js";
import { esc } from "./src/util.js";
import { C, setup, bookFields, adminSession, adminGet, rows, NOW, BASE } from "./test-generic/helpers.mjs";

const { DB, env } = await setup();
const hit = (r) => handle(r, env, { now: NOW });
const get = (path) => new Request(BASE + path, { headers: { "cf-connecting-ip": "1.2.3.4" } });
const out = { unconfigured: [...C.unconfigured], pages: {} };
for (const l of C.languages) {
  const r = await hit(get("/?lang=" + l));
  const h = await r.text();
  out.pages[l] = { status: r.status, form: h.includes("<form"), bookForm: h.includes('id="book-form"'), submit: h.includes(T[l].submit), title: h.includes(T[l].unconfTitle), text: h.includes(T[l].unconfP), lang: /<html lang="(\w+)"/.exec(h)[1] };
}
const l0 = C.languages[0];
const post = await hit(new Request(BASE + "/reservar?lang=" + l0, { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(await bookFields(DB)) }));
const ph = await post.text();
out.post = { status: post.status, notice: ph.includes(T[l0].unconfTitle), rows: rows(DB).length };
const alias = await hit(new Request(BASE + "/book", { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(await bookFields(DB)) }));
out.postAlias = alias.status;
// the other public pages still work
out.terms = (await hit(get("/condiciones?lang=" + l0))).status;
// the admin panel works and lists each key as a to-do line, in the admin language
const s = await adminSession(env);
const panel = await adminGet(env, s);
out.admin = { lines: C.unconfigured.map((k) => panel.includes(`<li class="todo">${esc(AT.set.todo)}: ${esc(AT.set.unconfigured(k))}</li>`)), open: panel.includes('<details class="surface settings" open>') };
console.log(JSON.stringify(out));
