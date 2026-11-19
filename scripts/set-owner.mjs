// Replaces the account in the repository address, github.com/<account>/approdo, with your GitHub account, everywhere it appears.
// The account it finds can be the placeholder OWNER or the account of whoever published the copy you started from. If the
// "for whoever publishes this repository" comment is still at the top of README.md and README.it.md, it is removed.
//   node scripts/set-owner.mjs <github-account>
// Run it in your own copy of the repository, before you make it public. It changes README.md, README.it.md and
// package.json and the product address in src/product.js (the footer link "Made with Approdo") only; running it again, with the
// same account or with another one, just writes the account you give.
// It does NOT touch PRODUCT_SITE (the product website) and USAGE_URL (the collector of the anonymous usage count) in src/product.js:
// those two addresses belong to the author of Approdo, whoever publishes a copy of the repository.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const account = process.argv[2];
// GitHub user and organisation names: letters, digits and single hyphens, at most 39 characters, not starting or ending with a hyphen.
if (!account || process.argv.length > 3 || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(account)) {
  console.error("Usage: node scripts/set-owner.mjs <github-account>   (your GitHub user or organisation name, for example: my-lab)");
  process.exit(2);
}
let changed = 0;
for (const f of ["README.md", "README.it.md", "package.json", "src/product.js"]) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, "utf8");
  const after = before
    .replace(/<!--\s*(?:PER CHI PUBBLICA QUESTO REPOSITORY|FOR WHOEVER PUBLISHES THIS REPOSITORY)[\s\S]*?-->\s*\n/, "")
    .replace(/github\.com\/[A-Za-z0-9_.-]+\/approdo/g, `github.com/${account}/approdo`);
  if (after !== before) { writeFileSync(p, after); changed++; console.log(`updated ${f}`); }
}
console.log(changed ? `Done: the repository is github.com/${account}/approdo.` : `Nothing to change: the repository is already github.com/${account}/approdo.`);
