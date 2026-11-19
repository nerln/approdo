// Generates src/schema.js from schema.sql, the one source of truth of the database schema.
//   node scripts/build-schema.mjs           writes src/schema.js
//   node scripts/build-schema.mjs --check   exits 1 if src/schema.js is out of date (the tests do the same through generate())
// The Worker cannot read files at run time, so the statements are embedded in a module. They are split on ";" after the
// comments are removed (schema.sql has no ";" or "--" inside a string) and written one per line.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function statementsFrom(sql) {
  const bare = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  return bare.split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function generate(sql) {
  const list = statementsFrom(sql).map((x) => `  ${JSON.stringify(x)},`).join("\n");
  return `// GENERATED from schema.sql by \`npm run build:schema\`: do not edit by hand (a test fails when the two differ).
// The statements that create the whole database; src/migrate.js runs them by itself on the first request.
export const SCHEMA_STATEMENTS = Object.freeze([
${list}
]);
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = generate(readFileSync(join(root, "schema.sql"), "utf8"));
  const target = join(root, "src", "schema.js");
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(target, "utf8"); } catch { /* missing */ }
    if (current !== out) { console.error("src/schema.js is out of date: run npm run build:schema"); process.exit(1); }
    console.log("src/schema.js is up to date");
  } else {
    writeFileSync(target, out);
    console.log("wrote src/schema.js");
  }
}
