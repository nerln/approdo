// The accent colour of the site as a tiny stylesheet (/theme.css). site.config.js holds one colour, "accent" (#rrggbb, validated in
// src/config.js); the pages cannot carry it in a style attribute (the Content-Security-Policy forbids them), so the Worker serves
// these few lines and the main stylesheets read the custom properties --lab-accent and --lab-accent-fg.
// A second built-in palette, "theatre" (config key palette), changes the papers, the inks and the landing page: its tokens are written
// into the same stylesheet and switched on by the class "pal-stage" on <body>.
// The colour of a lab may be pale, dark or bright: each theme gets a variant that is readable on that theme's paper (at least 4.5:1,
// so it can also be drawn as a thin line or a bar), and a text colour (white or near black) readable on top of it.
import { DEFAULT_ACCENT } from "./config.js";

// The accent of the design in the dark theme. The light one is the default accent itself.
const DEFAULT_ACCENT_DARK = "#91c8b7";
// The papers and surfaces the accent is drawn on (public and dashboard use the same four).
export const PAPERS = { light: ["#f5f3eb", "#fffefa"], dark: ["#142724", "#1c322e"] };
// The same for the theatre palette: warm cream paper by day, a warm near-black by night (no green in either).
export const THEATRE_PAPERS = { light: ["#f6efe1", "#fffaf0"], dark: ["#1c1512", "#271d19"] };
export const PAPERS_OF = { paper: PAPERS, theatre: THEATRE_PAPERS };

export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const mix = (hex, toward, t) => rgbToHex(hexToRgb(hex).map((v, i) => v + (hexToRgb(toward)[i] - v) * t));
// Moves the colour toward `toward` in small steps until it reaches `min` contrast against every background.
function reach(hex, toward, backgrounds, min) {
  let c = hex;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    c = mix(hex, toward, Math.min(t, 1));
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return toward;
}
// The text colour that reads best on top of a colour.
export const readableOn = (bg, dark = "#14201d") => (contrast("#ffffff", bg) >= contrast(dark, bg) ? "#ffffff" : dark);

export function accentVariants(accent, palette = "paper") {
  const papers = PAPERS_OF[palette] || PAPERS;
  const same = accent === DEFAULT_ACCENT && palette === "paper";
  const light = same ? accent : reach(accent, "#000000", papers.light, 4.5);
  const dark = same ? DEFAULT_ACCENT_DARK : reach(accent, "#ffffff", papers.dark, 4.5);
  // The theatre palette has no green anywhere, so its dark text colour is the warm near black too.
  const ink = palette === "theatre" ? "#1c1310" : undefined;
  return { light, dark, lightFg: readableOn(light, ink), darkFg: readableOn(dark, ink) };
}

// The band of the theatre landing page: the accent colour itself (the same in both themes, it is a stage, not a page), a lighter
// stop for the soft light and a darker one for the edges. The text on it is cream when the colour is deep and near black when it is
// light; every stop keeps at least 4.5:1 with that text, so the stops are only as light or as dark as that allows.
export const BAND_CREAM = "#fff7ea";
export const BAND_DARK = "#1c1310";
export function bandColors(accent) {
  let base = accent;
  let fg = contrast(BAND_CREAM, base) >= contrast(BAND_DARK, base) ? BAND_CREAM : BAND_DARK;
  // A mid-tone colour that neither text reads on: it is darkened until the cream does.
  if (contrast(fg, base) < 4.5) { base = reach(accent, "#000000", [BAND_CREAM], 4.6); fg = BAND_CREAM; }
  const stop = (toward, max) => { for (let t = max; t > 0; t -= 0.01) { const c = mix(base, toward, t); if (contrast(fg, c) >= 4.6) return c; } return base; };
  return { base, fg, hi: stop("#ffdcb8", 0.22), lo: stop("#1a0606", 0.4) };
}

// The tokens of the theatre palette, for the two themes. They use the names of both stylesheets (style.css and admin.css).
const THEATRE = {
  light: { paper: "#f6efe1", surface: "#fffaf0", subtle: "#ece2d0", ink: "#271c18", muted: "#5f5047", line: "#d9cbb4", strong: "#8a7867", lineStrong: "#85735f",
    ok: "#2f5a2e", okBg: "#ebeed9", warn: "#7a5013", warnBg: "#f3e6c6", danger: "#9a3b2a", dangerBg: "#f7e4d8", focus: "#075d91", adminFocus: "#8a4b00" },
  dark: { paper: "#1c1512", surface: "#271d19", subtle: "#33261f", ink: "#f4ebdb", muted: "#c6b7a5", line: "#52433a", strong: "#9d8c7b", lineStrong: "#9d8c7b",
    ok: "#c2dba9", okBg: "#34402a", warn: "#eacd98", warnBg: "#493e28", danger: "#f2b4a0", dangerBg: "#4b352c", focus: "#f4d57c", adminFocus: "#f1ce89" },
};
export const THEATRE_TOKENS = THEATRE;
const theatreVars = (t) => `--paper:${t.paper};--surface:${t.surface};--subtle:${t.subtle};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--strong-line:${t.strong};--line-strong:${t.lineStrong};--action:${t.ink};--action-text:${t.surface};--focus:${t.focus};--ok:${t.ok};--ok-bg:${t.okBg};--warn:${t.warn};--warn-bg:${t.warnBg};--positive:${t.ok};--positive-bg:${t.okBg};--warning:${t.warn};--warning-bg:${t.warnBg};--danger:${t.danger};--danger-bg:${t.dangerBg};--accent-strong:var(--lab-accent);--accent-wash:color-mix(in srgb,var(--lab-accent) 10%,${t.surface})`;

export function themeCss(accent, palette = "paper") {
  const v = accentVariants(accent, palette);
  let css = `/* Accent colour of the site, built from "accent" in site.config.js. */
:root{--lab-accent:${v.light};--lab-accent-fg:${v.lightFg}}
@media (prefers-color-scheme:dark){:root{--lab-accent:${v.dark};--lab-accent-fg:${v.darkFg}}}
`;
  if (palette === "theatre") {
    const b = bandColors(accent);
    css += `/* Palette "theatre": cream paper, warm near-black ink, the accent for active items; the band of the landing page is the same in both themes. */
body.pal-stage{${theatreVars(THEATRE.light)};--accent-soft:color-mix(in srgb,var(--lab-accent) 10%,${THEATRE.light.surface});--band:${b.base};--band-hi:${b.hi};--band-lo:${b.lo};--band-fg:${b.fg}}
@media (prefers-color-scheme:dark){body.pal-stage{${theatreVars(THEATRE.dark)};--accent-soft:color-mix(in srgb,var(--lab-accent) 22%,${THEATRE.dark.surface})}}
`;
  }
  return css;
}
