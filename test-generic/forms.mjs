// Reads a form of the panel's HTML the way a browser would submit it (used by the tests that save a form without editing it).
export const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };

// What a browser would submit for the form that holds the button `do=<action>`: text inputs, hidden inputs, checked checkboxes, the
// text of every textarea (a newline right after the opening tag is dropped, line breaks are sent as CRLF) and the selected option.
export function formFields(html, action) {
  const forms = html.split("<form ").slice(1).map((f) => f.slice(0, f.indexOf("</form>")));
  const form = forms.find((f) => f.includes(`name="do" value="${action}"`));
  if (!form) throw new Error(`no form with ${action}`);
  const out = {};
  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const t = m[0], name = attr(t, "name"), type = attr(t, "type") || "text";
    if (!name) continue;
    if (type === "checkbox") { if (/\schecked(\s|>|=)/.test(t)) out[name] = attr(t, "value") ?? "on"; } else out[name] = attr(t, "value") ?? "";
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) out[attr(m[1], "name")] = unesc(m[2]).replace(/^\n/, "").replace(/\r?\n/g, "\r\n");
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const sel = /<option\b[^>]*\sselected[^>]*>/.exec(m[2]) || /<option\b[^>]*>/.exec(m[2]);
    if (sel) out[attr(m[1], "name")] = attr(sel[0], "value");
  }
  delete out.do;
  return out;
}

