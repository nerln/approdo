// The values that the shipped example (config/example-lab.config.js, which site.config.js starts as a copy of) holds as
// placeholders. This is the ONE list: src/config.js uses it to compute C.unconfigured (the site refuses bookings while any
// is left), and scripts/setup.mjs imports it to stop before a deployment. The list is checked against the VALUES of the loaded
// configuration, so a comment that mentions one never counts, and every hit names its key.
// It must not match the values of the regression fixture or of the test variants: they are "configured".
export const PLACEHOLDERS = [
  /Nome Cognome/,
  /\bEsempio\b/,
  /^studio@example\.org$/i,
  /da compilare|to be filled in/i,
  /\bExample (laboratory|Department|University|Street|City)\b/i,
];
export const isExampleValue = (s) => typeof s === "string" && PLACEHOLDERS.some((re) => re.test(s));

// Walks a normalised configuration and lists `{ key, value }` for every text that is still a placeholder. The organisation
// names are read per language (orgBy) and reported once under their own key (org.unit...). `texts` (the lab's own wording),
// the credit HTML and the derived copies (org, orgBy, studyName, unconfigured) are not scanned.
export function findPlaceholders(cfg) {
  const out = [];
  const seen = new Set();
  const add = (key, value) => { if (!seen.has(key)) { seen.add(key); out.push({ key, value }); } };
  const walk = (v, path) => {
    if (typeof v === "string") { if (isExampleValue(v)) add(path, v); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  for (const [k, v] of Object.entries(cfg)) {
    if (["texts", "org", "orgBy", "studyName", "unconfigured", "hero"].includes(k)) continue;
    walk(v, k);
  }
  for (const l of cfg.languages) for (const [k, v] of Object.entries(cfg.orgBy[l])) if (isExampleValue(v)) add(`org.${k}`, v);
  return out;
}
