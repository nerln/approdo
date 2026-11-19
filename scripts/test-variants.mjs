// Runs the config-agnostic suite (test-generic/) under every variant configuration in config/test-variants/, one after the
// other, and prints one line per variant. Exit code 0 only if every variant passes.
//   node scripts/test-variants.mjs [--verbose]
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "config", "test-variants");
const files = readdirSync(dir).filter((f) => f.endsWith(".config.js")).sort();
if (!files.length) { console.error(`No *.config.js files in ${dir}`); process.exit(2); }
const extra = process.argv.includes("--verbose") ? ["--verbose"] : [];
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "test.mjs"), join(dir, f), "--suite", "test-generic", ...extra], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const n = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, "m")) || [])[1] ?? "?";
  console.log(`${r.status === 0 ? "OK    " : "FAILED"} ${f}: tests ${n("tests")}, pass ${n("pass")}, fail ${n("fail")}, skipped ${n("skipped")}`);
  if (r.status !== 0) { failed.push(f); process.stdout.write(out); }
}
console.log(failed.length ? `\nFAILED variants: ${failed.join(", ")}` : `\nAll ${files.length} variants passed.`);
process.exit(failed.length ? 1 : 0);
