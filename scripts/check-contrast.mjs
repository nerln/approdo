// Checks the contrast of the text/background pairs of both palettes ("paper" and "theatre") in both themes, for the default accent, the
// fixture accent, a light accent and the accents given as arguments (#rrggbb). Normal text needs 4.5:1, borders and graphics 3:1.
// For the theatre palette it also checks the text on the landing page band (every stop of the soft light) and the button on it.
// Exit code 1 when a pair fails.
//   node scripts/check-contrast.mjs [#rrggbb ...]
import { contrast, accentVariants, bandColors, THEATRE_TOKENS } from "../src/theme.js";
const T = {
  light: { paper: "#f5f3eb", surface: "#fffefa", subtle: "#eaece2", ink: "#203b3a", muted: "#56665f", pmuted: "#596a64", strong: "#72847b", lineStrong: "#78877d", positive: "#285c40", positiveBg: "#e4ecdf", warning: "#795014", warningBg: "#f4ead3", danger: "#993f32", dangerBg: "#f7e8df", pdanger: "#93432e", focus: "#8a4b00", pfocus: "#075d91" },
  dark: { paper: "#142724", surface: "#1c322e", subtle: "#263d35", ink: "#ecede4", muted: "#b2c3b8", pmuted: "#b6c4b9", strong: "#86a095", lineStrong: "#80988b", positive: "#b6d8b4", positiveBg: "#304936", warning: "#eacd98", warningBg: "#493e28", danger: "#f0b0a1", dangerBg: "#49362e", pdanger: "#f0b39e", focus: "#f1ce89", pfocus: "#f4d57c" },
};
// The theatre palette written with the names used above.
const th = (t) => ({ paper: t.paper, surface: t.surface, subtle: t.subtle, ink: t.ink, muted: t.muted, pmuted: t.muted, strong: t.strong, lineStrong: t.lineStrong, positive: t.ok, positiveBg: t.okBg, warning: t.warn, warningBg: t.warnBg, danger: t.danger, dangerBg: t.dangerBg, pdanger: t.danger, focus: t.adminFocus, pfocus: t.focus });
const PALETTES = { paper: T, theatre: { light: th(THEATRE_TOKENS.light), dark: th(THEATRE_TOKENS.dark) } };
let bad = 0;
const check = (label, a, b, min) => { const r = contrast(a, b); if (r < min) { bad++; console.log(`FAIL ${label}: ${a} on ${b} = ${r.toFixed(2)} (needs ${min})`); } };
for (const [palette, themes] of Object.entries(PALETTES)) for (const [theme, t] of Object.entries(themes)) {
  const name = `${palette} ${theme}`;
  for (const bg of [t.paper, t.surface]) for (const [k, fg] of [["ink", t.ink], ["muted", t.muted], ["public muted", t.pmuted], ["danger", t.danger], ["public danger", t.pdanger], ["positive", t.positive], ["warning", t.warning]]) check(`${name} ${k}`, fg, bg, 4.5);
  check(`${name} muted on subtle`, t.muted, t.subtle, 4.5);
  check(`${name} ink on subtle`, t.ink, t.subtle, 4.5);
  check(`${name} danger on subtle (weekend Sundays)`, t.danger, t.subtle, 4.5);
  check(`${name} positive on its fill`, t.positive, t.positiveBg, 4.5);
  check(`${name} warning on its fill`, t.warning, t.warningBg, 4.5);
  check(`${name} danger on its fill`, t.danger, t.dangerBg, 4.5);
  check(`${name} public danger on its fill`, t.pdanger, t.dangerBg, 4.5);
  for (const bg of [t.paper, t.surface]) { check(`${name} input border`, t.strong, bg, 3); check(`${name} dashboard border`, t.lineStrong, bg, 3); check(`${name} focus`, t.focus, bg, 3); check(`${name} public focus`, t.pfocus, bg, 3); }
  check(`${name} button text`, theme === "light" ? t.surface : t.paper, t.ink, 4.5);
}
const ACCENTS = ["#246b5c", "#7a1f1f", "#f0c040", ...process.argv.slice(2)];
for (const [palette, themes] of Object.entries(PALETTES)) for (const accent of ACCENTS) {
  const v = accentVariants(accent, palette);
  for (const [theme, col, fg] of [["light", v.light, v.lightFg], ["dark", v.dark, v.darkFg]]) {
    for (const bg of [themes[theme].paper, themes[theme].surface]) check(`${palette} ${accent} ${theme} accent line/bar`, col, bg, 3);
    check(`${palette} ${accent} ${theme} text on accent`, fg, col, 4.5);
  }
  if (palette === "theatre") {
    const b = bandColors(accent);
    for (const [k, bg] of [["base", b.base], ["light stop", b.hi], ["dark stop", b.lo]]) check(`theatre ${accent} band text on ${k}`, b.fg, bg, 4.5);
    check(`theatre ${accent} band button text`, b.base, b.fg, 4.5);
  }
}
console.log(bad ? `${bad} pair(s) fail` : "All pairs pass");
process.exit(bad ? 1 : 0);
