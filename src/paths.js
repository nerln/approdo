// Public paths. The canonical paths are in Spanish (/condiciones, /privacidad, /reservar, /gestionar, /baja). Pages in
// any other language use English aliases served by the same handlers, so an Italian or English visitor does not see
// Spanish words in the address bar. Spanish pages keep the Spanish paths. Both spellings always work, whatever the language.
// `legacyPaths: true` in site.config.js keeps the Spanish paths in every language (for a site whose links already exist).
import { C } from "./config.js";

// canonical (Spanish) path -> English alias
export const PATH_ALIASES = { "/condiciones": "/terms", "/privacidad": "/privacy", "/reservar": "/book", "/gestionar": "/manage", "/baja": "/unsubscribe" };
const ALIAS_TO_CANONICAL = Object.fromEntries(Object.entries(PATH_ALIASES).map(([c, a]) => [a, c]));

// The canonical path of a request path: an alias becomes its Spanish original, anything else stays as it is.
export const canonicalPath = (path) => (Object.hasOwn(ALIAS_TO_CANONICAL, path) ? ALIAS_TO_CANONICAL[path] : path);
const neutral = (lang) => lang !== "es" && !C.legacyPaths;
// The path to write in a link, a form action or a mail, for a page or mail in `lang`; `canonical` is the Spanish path.
export const pathFor = (lang, canonical) => (neutral(lang) && Object.hasOwn(PATH_ALIASES, canonical) ? PATH_ALIASES[canonical] : canonical);
// File name of the calendar download.
export const icsFileName = (lang) => (neutral(lang) ? "booking.ics" : "turno-estudio.ics");
