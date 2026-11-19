// The first save must change nothing the researcher did not change. For EVERY configuration of config/ and config/test-variants/ (and
// the one this suite runs against), in a scratch copy configured with it: the same scenario on two fresh databases, one untouched and
// one where every study and every consent form was saved from the panel without editing anything (the forms are read from the panel's
// HTML and posted back as a browser would). The landing page (every language, each study active in turn), the terms, the privacy text,
// the booked, confirmation and cancellation pages, every e-mail, the calendar file, the bookings CSV and the printable sheet must be
// byte-identical (random ids, codes and tokens aside), and the rows must hold no text, no consent and no public state of their own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { withConfig } from "./helpers.mjs";

const root = new URL("..", import.meta.url);
const configs = [
  ...readdirSync(new URL("config/", root)).filter((f) => f.endsWith(".config.js")).map((f) => `config/${f}`),
  ...readdirSync(new URL("config/test-variants/", root)).filter((f) => f.endsWith(".config.js")).map((f) => `config/test-variants/${f}`),
  "site.config.js",
];
const script = readFileSync(new URL("./scripts/first-save.mjs", import.meta.url), "utf8");

for (const file of configs) {
  test(`saving every study and every consent form unedited changes nothing the public, the e-mails, the exports or the sheet show (${file})`, () => {
    const r = withConfig(null, script, readFileSync(new URL(file, root), "utf8"));
    assert.equal(r.status, 0, `${file}: ${r.err.slice(-1500)}`);
    const o = JSON.parse(r.out.trim().split("\n").pop());
    assert.ok(o.surfaces > 10, `${file}: ${o.surfaces} surfaces compared`);
    assert.deepEqual(o.differ, [], `${file}: ${o.firstDiff ? `${o.firstDiff.key} at ${o.firstDiff.at}\nBEFORE ${o.firstDiff.before}\nAFTER  ${o.firstDiff.after}` : ""}`);
    assert.ok(o.mails >= 4, `${file}: the e-mails of a booking were compared (${o.mails})`);
    assert.equal(o.tableBefore, false, "before the save the configuration is the source");
    assert.equal(o.tableAfter, true, "after it the table is");
    for (const [k, status] of Object.entries(o.saveStatus)) assert.equal(status, 303, `${file}: ${k} was saved`);
    assert.ok(o.rows.length >= 1);
    for (const row of o.rows) {
      assert.equal(row.texts, true, `${file}: ${row.id} stores no text of its own`);
      assert.equal(row.noConsent, true, `${file}: ${row.id} stores no consent form`);
      assert.equal(row.publicState, null, `${file}: ${row.id} stores no public state (a seeded study follows the automatic one)`);
      assert.equal(row.updatedAt, "", `${file}: ${row.id} has no change date: nothing was changed`);
    }
  });
}
