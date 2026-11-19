// The product this site is made with. The footer of the public pages says "Made with Approdo by nerln" and links to PRODUCT_SITE.
// That line is the display of the author's name and address that the licence asks for (LICENSE, the Attribution Assurance License).
// It may be restyled; it is not to be removed or hidden.
// `node scripts/set-owner.mjs <account>` replaces the placeholder account of PRODUCT_URL (the repository address) together
// with the ones of the README files. It does NOT touch PRODUCT_SITE and USAGE_URL: those two addresses belong to the author
// of Approdo, whoever publishes a copy of the repository.
export const PRODUCT_NAME = "Approdo";
// The author named in the credit line. It stays the same in every copy of the repository.
export const PRODUCT_AUTHOR = "nerln";
export const PRODUCT_URL = "https://github.com/nerln/approdo";
// The product website, the target of the "Made with Approdo" link.
export const PRODUCT_SITE = "https://nerln.github.io/approdo/";
// The version of this copy. Keep it equal to the version of package.json (a test checks it).
export const PRODUCT_VERSION = "0.4.0";
// Where the anonymous usage count goes (see src/usage.js and the section "Anonymous usage count" of docs/privacy.md).
export const USAGE_URL = "https://approdo-stats.nerln.workers.dev/ping";

// The berth glyph of the word-mark: one continuous line, drawn with presentation attributes only (no style attribute, no class needed).
export const berthSvg = (cls = "berth") => `<svg class="${cls}" viewBox="0 0 48 32" fill="none" aria-hidden="true" focusable="false"><path d="M3 5v12c0 6 3 9 9 9h14c6 0 9-3 9-9v-3h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/></svg>`;
