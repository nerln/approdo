// Usage: node scripts/make-qr.mjs https://your-site.example/ [output-folder]
// Writes qr.png and poster.html (A4, ready to print) to the output folder (default: poster/). Everything runs offline.
// Needs the qrcode package: run `npm ci` once.
import QRCode from "qrcode";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { T } from "../src/i18n.js";
import { DEFAULT_LANG } from "../src/config.js";
import { SESSION_MINUTES } from "../src/slots.js";

const url = process.argv[2];
const out = process.argv[3] || new URL("../poster", import.meta.url).pathname;
if (!url || !/^https:\/\//.test(url)) {
  console.error("Usage: node scripts/make-qr.mjs https://your-site.example/ [output-folder]\nThe address must start with https://");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const png = await QRCode.toBuffer(url, { width: 900, margin: 2, errorCorrectionLevel: "M" });
writeFileSync(join(out, "qr.png"), png);
const dataUri = "data:image/png;base64," + png.toString("base64");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The poster text comes from the configuration and the built-in texts of the default language (site.config.js).
const S = T[DEFAULT_LANG];
writeFileSync(join(out, "poster.html"), `<!doctype html>
<html lang="${esc(S.htmlLang)}"><head><meta charset="utf-8"><title>${esc(S.title)}</title>
<style>
@page{size:A4;margin:0}
body{margin:0;font-family:system-ui,-apple-system,Arial,sans-serif;color:#1b1b1b}
.p{width:210mm;height:297mm;box-sizing:border-box;padding:18mm;display:flex;flex-direction:column;align-items:center;text-align:center}
h1{font-size:34pt;line-height:1.1;margin:0 0 8mm;color:#7a1f1f}
p{font-size:17pt;margin:0 0 5mm}
img{width:110mm;height:110mm;margin:6mm 0}
.ph{background:#ffe9a8;padding:0 2mm}
.u{font-size:13pt;word-break:break-all}
.f{margin-top:auto;font-size:11pt;color:#444}
</style></head><body><div class="p">
<h1>${esc(S.title)}</h1>
<p>${esc(S.kicker)}<br>
${esc(S.factMinutes(SESSION_MINUTES).replace(/\.$/, ""))} · ${esc(S.chipPlace)}</p>
<img src="${dataUri}" alt="QR">
<p><b>${esc(S.bookH)}</b></p>
<p class="u">${esc(url)}</p>
</div></body></html>`);
console.log(`Written: ${join(out, "qr.png")} and ${join(out, "poster.html")}`);
