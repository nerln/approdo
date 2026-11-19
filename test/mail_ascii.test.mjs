import test from "node:test";
import assert from "node:assert/strict";
import { sendMail, asciiJson } from "../src/mail.js";
import { hmacHex } from "../src/util.js";

test("G1 el cuerpo que va al relay es solo ASCII, se lee igual y la firma es la de ese mismo texto", async () => {
  const msg = { to: "ana@example.com", subject: "Confirma tu turno · miércoles 18/11", text: "Hola, Ángel: mañana a las 10:00. ¿Vienes? 😀", html: "<p>Señal «ok»</p>" };
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  const env = { MAIL_RELAY_URL: "https://script.example/exec", MAIL_RELAY_KEY: "k".repeat(64) };
  const r = await sendMail(env, msg, fetchFn, 1234567890);
  assert.deepEqual(r, { ok: true, error: "" });
  const body = seen.init.body;
  assert.match(body, /^[\x20-\x7e]+$/, "ni un solo carácter fuera de ASCII");
  assert.deepEqual(JSON.parse(body), { ts: 1234567890, ...msg });
  assert.equal(new URL(seen.url).searchParams.get("sig"), await hmacHex(env.MAIL_RELAY_KEY, body));
});

test("G2 asciiJson no cambia un texto que ya es ASCII y escapa pares suplentes", () => {
  assert.equal(asciiJson({ a: "plain", n: 1 }), '{"a":"plain","n":1}');
  assert.equal(asciiJson({ a: "ñ😀" }), '{"a":"\\u00f1\\ud83d\\ude00"}');
  assert.equal(JSON.parse(asciiJson({ a: "ñ😀" })).a, "ñ😀");
});
