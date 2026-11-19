// Runs a test suite against a chosen configuration, by COPYING (never by switching at run time):
//   node scripts/test.mjs [path-to-config] [--suite test|test-generic] [--verbose]
// Default config: config/fixture-lab.config.js (the regression fixture); default suite: test.
// The project is copied into a fresh temporary directory, the chosen config is written there as site.config.js and
// `node --test` runs on the copy, so your own site.config.js is never touched and no test can leave anything behind.
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let suite = "test", verbose = false, configArg = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--suite") suite = args[++i];
  else if (args[i] === "--verbose") verbose = true;
  else if (!configArg) configArg = args[i];
  else { console.error(`Unexpected argument: ${args[i]}`); process.exit(2); }
}
if (!["test", "test-generic"].includes(suite)) { console.error(`Unknown suite "${suite}" (use test or test-generic)`); process.exit(2); }
const config = existsSync(resolve(configArg || "x")) && configArg ? resolve(configArg) : resolve(root, configArg || "config/fixture-lab.config.js");
if (!existsSync(config)) { console.error(`Config not found: ${config}`); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "approdo-test-"));
let status = 1;
try {
  // README.md, AGENTS.md, docs/, scripts/, apps-script/, stats-collector/ (the source of the usage collector; its own tests are not run here),
  // the licence files and the deployment files are copied too: some tests read or scan them.
  for (const p of ["src", "test", "test-generic", "public", "schema.sql", "config", "scripts", "docs", "package.json", "package-lock.json", "README.md", "AGENTS.md", "apps-script", "wrangler.jsonc", "setup.sh", ".dev.vars.example", ".gitignore", ".github", "LICENSE", "CITATION.cff", "SECURITY.md", "CREDITS.md", "README.it.md", "PUBLISHING.md", "stats-collector"]) {
    if (existsSync(join(root, p))) cpSync(join(root, p), join(dir, p), { recursive: true });
  }
  mkdirSync(dir, { recursive: true });
  copyFileSync(config, join(dir, "site.config.js"));
  const files = readdirSync(join(dir, suite)).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join(dir, suite, f));
  if (!files.length) { console.error(`No *.test.mjs files in ${suite}/`); process.exit(2); }
  const label = `${suite} against ${config.startsWith(root) ? config.slice(root.length + 1) : config}`;
  console.log(`Running ${label} (${files.length} files) in ${dir}`);
  const r = spawnSync(process.execPath, ["--no-warnings", "--test", "--test-reporter=spec", ...files], { cwd: dir, env: { ...process.env, APPRODO_REPO: root }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  status = r.status ?? 1;
  if (verbose || status !== 0) process.stdout.write(out);
  else process.stdout.write(out.split("\n").filter((l) => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration)/.test(l)).join("\n") + "\n");
  console.log(status === 0 ? `OK: ${label}` : `FAILED: ${label}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
