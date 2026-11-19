// The tooling around the site: the Apps Script relay (apps-script/Code.gs) against everything that names its functions, and
// scripts/setup.mjs (placeholders, the privacy warning), exercised only with --dry-run: nothing here touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const gs = read("apps-script/Code.gs");

// ---- Apps Script function names ---------------------------------------------------------------------------------------
const gsFunctions = new Set([...gs.matchAll(/^function\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]));
const files = ["README.md", "AGENTS.md", "apps-script/README.md", "scripts/setup.mjs", "src/admin_texts.js", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

test("Code.gs defines installReminder as the real function and keeps instalaRecordatorio as a one-line alias", () => {
  assert.ok(gsFunctions.has("installReminder") && gsFunctions.has("instalaRecordatorio") && gsFunctions.has("recordatorios") && gsFunctions.has("doPost"));
  assert.match(gs, /^function instalaRecordatorio\(\) \{ installReminder\(\); \}$/m, "the alias is one line that calls the real function");
  assert.match(gs, /^function installReminder\(\) \{$/m);
  assert.ok(gs.indexOf("function installReminder") < gs.indexOf("function instalaRecordatorio"));
  // the real function installs the trigger, the alias must not carry a second copy of that code
  assert.equal(gs.split("ScriptApp.newTrigger").length - 1, 1);
});

// Names that the docs and scripts give as Apps Script functions: "the function X", "funzione X", "función X", "run X once",
// "esegui una volta X", "ejecuta una vez X", a backticked name on a line about Apps Script, "the log of X".
function mentionedFunctions(text) {
  const out = new Set();
  const id = "[`'\"«]?([A-Za-z_][A-Za-z0-9_]{3,})[`'\"»]?";
  for (const re of [new RegExp(`(?:function|funzione|función|funcion)\\s+${id}`, "gi"), new RegExp(`(?:ejecuta|esegui|run|pick)\\s+(?:una vez|una volta|once|the function)?\\s*${id}`, "gi"), new RegExp(`(?:log of|registro di)\\s+${id}`, "gi")]) {
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  for (const line of text.split("\n")) {
    if (!/Apps Script|funzion[ei]|función|function/i.test(line)) continue;
    for (const m of line.matchAll(/`([A-Za-z_]\w*)(?:\(\))?`/g)) out.add(m[1]);
    for (const m of line.matchAll(/\*\*`?([A-Za-z_]\w*)`?\*\*/g)) out.add(m[1]);
  }
  return out;
}
// Words that follow those phrases without being function names (property names, file names, ordinary words).
const NOT_FUNCTIONS = new Set(["once", "the", "function", "this", "that", "with", "from", "your", "node", "npm", "npx", "name", "script", "scripts", "code", "project", "document", "rete", "which", "when", "after", "before", "does", "also", "only", "just", "each", "every", "first", "last", "next", "then", "into", "creates", "leaves", "calls", "sends", "keeps", "makes", "runs", "using", "returns", "wrangler", "deploy", "login", "secret", "pages", "true", "false", "null", "undefined", "const", "async", "await", "export", "import", "return"]);

test("every Apps Script function named in the docs, scripts/setup.mjs and src/admin_texts.js exists in Code.gs", () => {
  let checked = 0;
  for (const f of files) {
    if (!existsSync(join(root, f))) continue;
    for (const name of mentionedFunctions(read(f))) {
      if (NOT_FUNCTIONS.has(name.toLowerCase()) || /^[A-Z0-9_]+$/.test(name)) continue;
      if (!/^(install|instal|record|doPost|same_|out_)/i.test(name) && !gsFunctions.has(name)) continue; // only names that look like this relay's functions are held to it
      checked++;
      assert.ok(gsFunctions.has(name), `${f} names the Apps Script function "${name}", which Code.gs does not define (it defines: ${[...gsFunctions].join(", ")})`);
    }
  }
  assert.ok(checked >= 4, `the scan found only ${checked} mentions: the extraction is broken`);
});

test("the misspelt names of the reminder function are gone from the documentation", () => {
  for (const f of files) {
    const t = read(f);
    assert.ok(!/installaRecordatorio/.test(t), `${f}: "installaRecordatorio" is not a function of Code.gs`);
    if (f !== "src/admin_texts.js") assert.ok(!/instalaRecordatorio/.test(t), `${f}: use installReminder (the Spanish admin text alone names the alias)`);
  }
  // the Spanish admin text names the alias, which exists; the Italian one and setup.mjs name the real function
  assert.match(read("src/admin_texts.js"), /ejecuta una vez instalaRecordatorio/);
  assert.match(read("src/admin_texts.js"), /esegui una volta installReminder/);
  assert.match(read("scripts/setup.mjs"), /run the function installReminder once/);
});

// ---- scripts/setup.mjs, --dry-run only --------------------------------------------------------------------------------
// These tests never read the site.config.js of the folder (it is the lab's own and may be completely filled in): they start from the
// fixed shipped example (config/example-lab.config.js), where every example value is still there, and from a copy of it that has real-looking
// values instead.
const EXAMPLE = "config/example-lab.config.js";
const exampleCfg = async () => (await import(`../${EXAMPLE}`)).default;
// The example with every value that the site calls a placeholder replaced by a plausible real one (a lab at an invented institution).
async function configured() {
  const c = JSON.parse(JSON.stringify(await exampleCfg()));
  c.brand = "Reading Lab"; c.responsible = "Responsabile del laboratorio"; c.contactEmail = "reading@lab.example.org";
  c.org = { group: "Reading Lab", university: { it: "Università di Testopoli", en: "University of Testopoli" }, unit: { it: "Dipartimento di Lettere", en: "Department of Letters" }, signature: { it: "Reading Lab, Università di Testopoli", en: "Reading Lab, University of Testopoli" } };
  c.place = { long: { it: "Aula 3, Via Roma 10, 12345 Testopoli", en: "Room 3, 10 Roma Street, 12345 Testopoli, Italy" }, short: { it: "Aula 3 · Testopoli", en: "Room 3 · Testopoli" }, room: { it: "aula 3", en: "room 3" } };
  return c;
}
function runSetup(cfg, args = [], source) {
  const dir = mkdtempSync(join(tmpdir(), "approdo-setup-"));
  try {
    for (const p of ["src", "scripts", "schema.sql", "wrangler.jsonc", "package.json", "public"]) if (existsSync(join(root, p))) cpSync(join(root, p), join(dir, p), { recursive: true });
    writeFileSync(join(dir, "site.config.js"), source ?? `export default ${JSON.stringify(cfg)};\n`);
    const r = spawnSync(process.execPath, ["scripts/setup.mjs", "--dry-run", "--project", "test-project", "--no-tests", ...args], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    return { status: r.status, out: (r.stdout || "") + (r.stderr || ""), conf: readFileSync(join(dir, "wrangler.jsonc"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("setup refuses to go on while a placeholder of the shipped example is present, and lists each one with its key", async () => {
  const base = await configured();
  const cases = [
    ["responsible", (c) => { c.responsible = "Nome Cognome"; }, /responsible: "Nome Cognome"/],
    ["contactEmail", (c) => { c.contactEmail = "studio@example.org"; }, /contactEmail: "studio@example\.org"/],
    ["unit", (c) => { c.org.unit = { it: "Dipartimento di Esempio", en: "Example Department" }; }, /org\.unit: "Dipartimento di Esempio"/],
    ["place", (c) => { c.place.long.it = "Via Esempio 1, Altrove"; }, /place\.long\.it: "Via Esempio 1/],
  ];
  // the example exactly as it ships: setup must refuse it
  const shipped = runSetup(null, [], read(EXAMPLE));
  assert.equal(shipped.status, 1, shipped.out);
  for (const key of ["brand:", "responsible:", "contactEmail:", "org.unit:", "org.group:", "place.long."]) assert.ok(shipped.out.includes(key), `the shipped example's ${key} is listed`);
  const ok = runSetup(base);
  assert.equal(ok.status, 0, ok.out);
  assert.ok(!/placeholder/i.test(ok.out), "a clean configuration passes");
  for (const [name, edit, re] of cases) {
    const c = JSON.parse(JSON.stringify(base));
    edit(c);
    const r = runSetup(c);
    assert.equal(r.status, 1, `${name}: exit code 1`);
    assert.match(r.out, /still contains placeholders/, name);
    assert.match(r.out, re, name);
    assert.ok(!/\[dry-run\] npx/.test(r.out), `${name}: nothing was run`);
  }
  // baseUrl is not needed at all: the dry run goes on without it, and says nothing about the address being an example
  const noUrl = runSetup(base);
  assert.equal(noUrl.status, 0, noUrl.out);
  assert.ok(!/baseUrl is the example one/.test(noUrl.out));
  // several at once are all listed
  const c = JSON.parse(JSON.stringify(base)); c.responsible = "Nome Cognome"; c.contactEmail = "studio@example.org";
  const r = runSetup(c);
  assert.match(r.out, /responsible:/); assert.match(r.out, /contactEmail:/);
  // the escape hatch for a trial site lists them and goes on
  const t = runSetup(c, ["--allow-placeholders"]);
  assert.equal(t.status, 0, t.out);
  assert.match(t.out, /2 placeholder\(s\) left/);
});

test("setup has no migration step and no baseUrl rewrite, and reads its list of placeholders from src/placeholders.js", () => {
  const setup = read("scripts/setup.mjs");
  assert.ok(!/migrations|baseIsExample/.test(setup), "no migration step, no baseUrl rewrite");
  assert.match(setup, /src\/placeholders\.js/);
  assert.ok(!/PLACEHOLDERS\s*=\s*\[/.test(setup), "one list only, in src/placeholders.js");
});

test("setup prints a clear warning while privacyReviewed is false, and the right function name at the end", async () => {
  for (const reviewed of [false, true]) {
    const c = await configured(); c.privacyReviewed = reviewed;
    const r = runSetup(c);
    assert.equal(r.status, 0, r.out);
    assert.equal(/WARNING: privacyReviewed is false/.test(r.out), !reviewed);
    if (!reviewed) assert.match(r.out, /data protection office/);
    assert.match(r.out, /run the function installReminder once/);
    assert.ok(!/instal+a?Recordatorio/.test(r.out));
  }
});

test("the placeholders of the shipped example are exactly the ones the site and setup look for (one list)", async () => {
  const { PLACEHOLDERS, findPlaceholders } = await import("../src/placeholders.js");
  const { normalizeConfig } = await import("../src/config.js");
  const shipped = read(EXAMPLE);
  const values = [...shipped.matchAll(/^\s*[\w"]+:\s*"([^"]*)"/gm)].map((m) => m[1]).filter((v) => PLACEHOLDERS.some((re) => re.test(v)));
  assert.ok(values.length >= 6, "the shipped example has placeholders to find");
  assert.deepEqual(findPlaceholders(normalizeConfig(await exampleCfg())).map((p) => p.key).sort(), [...normalizeConfig(await exampleCfg()).unconfigured].sort(), "the site and setup list the same keys");
  assert.equal(findPlaceholders(normalizeConfig(await configured())).length, 0);
});

// ---- scripts/preview.mjs: the simplest way to look at the site ---------------------------------------------------------
test("preview.mjs starts, prints its address and admin password in English, serves the site and the panel, and stops", async () => {
  const { spawn } = await import("node:child_process");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["scripts/preview.mjs", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes("Stop with Ctrl+C"); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, new RegExp(`Preview running at http://localhost:${port}\\n`));
    assert.match(out, new RegExp(`Admin panel:\\s+http://localhost:${port}/admin`));
    const pw = /Admin password:\s+(\S+)/.exec(out)?.[1];
    assert.ok(pw && pw.length >= 16, "a random admin password of at least 16 characters is printed");
    assert.notEqual(pw, "preview-only-password", "the old fixed password is gone");
    assert.ok(!read("scripts/preview.mjs").includes("preview-only-password"));
    assert.match(read("scripts/preview.mjs"), /randomBytes/);
    assert.match(out, /In-memory database, no e-mail is sent/);
    assert.ok(!/vista previa|solo-para/i.test(out), "no Spanish in the output");
    for (const p of ["/", "/admin"]) assert.equal((await fetch(`http://127.0.0.1:${port}${p}`)).status, 200, p);
  } finally {
    child.kill();
  }
});

test("preview.mjs prints a different random admin password at every start", async () => {
  const { spawn } = await import("node:child_process");
  const start = async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["scripts/preview.mjs", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    try {
      for (let i = 0; i < 100 && !out.includes("Stop with Ctrl+C"); i++) await new Promise((r) => setTimeout(r, 100));
      return /Admin password:\s+(\S+)/.exec(out)?.[1];
    } finally { child.kill(); }
  };
  const [a, b] = [await start(), await start()];
  assert.ok(a && b && a.length >= 16 && b.length >= 16);
  assert.notEqual(a, b);
});
