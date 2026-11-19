// Example configuration: a fictional lab ("Lab Esempio", "Università di Esempio"), Italian and English, 50-minute sessions
// with fixed start times at 10:00, 11:00 and 12:00 and 60 minutes of calendar per booking. Every name, address and e-mail below is an
// invented example: until you replace them the site shows "This site is not configured yet" instead of the booking form.
// `npm run test:generic` runs the config-agnostic suite in test-generic/ against this file; the tests that are about the
// shipped example read this fixed copy, so they keep working after you edit your own site.config.js.
// To use it as your own, copy it to the repository root as site.config.js (site.config.js already is a copy of it).
export default {
  // ===== WHO YOU ARE ========================================================================================
  // Short name shown in the page header and in e-mail sender names.
  brand: "Lab Esempio",

  org: {
    group: "Lab Esempio",                              // name of your research group (used in the public texts)
    university: { it: "Università di Esempio", en: "Example University" }, // institution
    unit: { it: "Dipartimento di Esempio", en: "Example Department" },     // department or school; "" if you do not want one
    signature: { it: "Lab Esempio, Università di Esempio", en: "Lab Esempio, Example University" }, // the line that signs every e-mail
    // Each of group, university, unit and signature is either one text (used in every language) or an object with one
    // text per language, as university, unit and signature are here (so that the English pages are written in English).
  },

  // Name of the person responsible for the data; the privacy page names this person.
  responsible: "Nome Cognome",

  // Where replies to the confirmation e-mails go and where the "someone booked" notices are sent.
  // The ADMIN_EMAIL variable set in Cloudflare overrides it at run time.
  contactEmail: "studio@example.org",

  // The public address of the site (no trailing slash): OPTIONAL, and normally left out. Without it every link (e-mails,
  // calendar files, social preview tags) is built from the address the visitor used, so the site works on its
  // workers.dev address and on any custom domain without being told. Set it (or the BASE_URL variable in Cloudflare, which
  // takes precedence) only if you want links to always use one fixed address, for example when your lab has a custom domain.
  // baseUrl: "https://study.example.org",

  // IANA time zone of the lab. All dates and times are local time in this zone.
  timeZone: "Europe/Rome",

  // ===== LANGUAGES ==========================================================================================
  // Public languages: "es", "en" and "it". The first one is the default (it is used when the browser says nothing;
  // a browser that asks only for languages you do not offer gets English if listed, otherwise the first).
  // Only these languages get a language switch, hreflang tags and the short paths /it, /en.
  languages: ["it", "en"],

  // Language of the admin panel: "es" or "it".
  adminLanguage: "it",

  // ===== SESSIONS AND SLOTS ===================================================================================
  // How long the session lasts, as told to the participant (e-mails, pages, calendar event length).
  sessionMinutes: 50,
  // How much calendar time a booking occupies: session plus the buffer before the next one. Must be >= sessionMinutes.
  // Two bookings of the same day must start at least this far apart. Here: 50 + 10 minutes of buffer.
  slotMinutes: 60,
  // Start times of a newly opened day. Any minutes are fine, but two times must be at least slotMinutes apart and the
  // last one must end before midnight. The researcher can change this list later in the admin panel.
  defaultTimes: ["10:00", "11:00", "12:00"],

  // Minimum notice before a slot can be booked (hours). The researcher can waive it for one day in the admin panel.
  minNoticeHours: 12,
  // Notice (minutes) when that exception is on. The same figure is the minimum notice of the "available today" mode of the
  // admin panel (a person can book a same-day start this many minutes ahead), so one number rules both.
  shortNoticeMinutes: 20,
  // How many days ahead the researcher can open days (56 = 8 weeks).
  daysAhead: 56,
  // Default closing time of the "available today" mode of the admin panel.
  flexDefaultUntil: "17:00",

  // ===== PLACE ======================================================================================================
  // One text per public language. long: full address (e-mails, calendar events, booking card);
  // short: the label on the landing page; room: how running text refers to the lab.
  place: {
    long: {
      it: "Laboratorio Esempio, Dipartimento di Esempio, Università di Esempio, Via Esempio 1, 00000 Città di Esempio",
      en: "Example laboratory, Example Department, Example University, 1 Example Street, 00000 Example City, Italy",
    },
    short: { it: "Laboratorio Esempio · Città di Esempio", en: "Example laboratory · Example City" },
    room: { it: "laboratorio Esempio", en: "example laboratory" },
  },

  // ===== MAIL AND DATA ==============================================================================================
  // E-mail domains whose mail filter silently drops messages that contain links. Addresses at these domains get
  // e-mails with a booking code and no links. Leave [] if you have no such problem (the NOLINK_DOMAINS variable
  // set in Cloudflare overrides it).
  noLinkDomains: [],
  // Booking data is deleted this many days after the slot.
  bookingRetentionDays: 30,
  // People who ask to hear about future studies stay on the list this many months.
  contactMonths: 24,
  // The admin password (ADMIN_PASSWORD) must have at least this many characters. A shorter one is treated as not set: the
  // admin panel stays closed and says why. 16 is the recommended minimum; do not lower it on a real site.
  minAdminPasswordLength: 16,

  // ===== STUDY-SPECIFIC SWITCHES ====================================================================================
  // How the study is named in e-mail subjects, the calendar event, the invitation and the built-in texts, one text per
  // language (or one text for all). It must read after "a / un / uno": "a research study", "un estudio de investigación",
  // "uno studio di ricerca". Write your own: "reading study", "esperimento sulla lettura"...
  studyName: { it: "studio di ricerca", en: "research study", es: "estudio de investigación" },
  // What the booking form asks, and whether the site presents one study or two. All three keys are optional.
  //
  // twoStudies: true (default) | false. This example ships with false.
  //   true  = the site presents two studies run one after the other (the "two studies" card on the landing page, and an
  //           "active study" switch in the admin panel that chooses which one people book; texts "study1" and "study2").
  //   false = one study only: the card and the switch are hidden, the texts of "study1" are always used and no study is
  //           named in the admin panel or in the e-mails.
  twoStudies: false,
  // declarations: the health declarations the person ticks when booking.
  //   epilepsy: true (default) | false. This example ships with false. true = a checkbox "I do not have epilepsy", checked on the server too, a line in the
  //             list of requirements, in the terms and in the privacy text. false = none of these exists.
  //   vestibular: "study2" (default) | "always" | "never". This example ships with "never". "study2" = asked only when booking the second study (needs
  //             twoStudies: true, otherwise it is never asked); "always" = asked for every booking; "never" = never asked,
  //             and not mentioned in the requirements, the terms or the privacy text.
  declarations: { epilepsy: false, vestibular: "never" },
  // privacyReviewed: false (default) | true. The privacy text is a starting point and must be reviewed by your
  // institution's data protection office. While this is false the admin panel shows a to-do line in Settings > Set-up and
  // scripts/setup.mjs prints a warning. Write true only after the review (and after you have rewritten the study texts,
  // see docs/testi.md).
  privacyReviewed: false,
  // legacyPaths: false (default) | true. false = pages in a language other than Spanish use the English addresses /terms,
  // /privacy, /book, /manage, /unsubscribe; Spanish pages use /condiciones, /privacidad, /reservar, /gestionar, /baja.
  // Both spellings always work. true = the Spanish addresses everywhere (only for a site whose links already exist).
  legacyPaths: false,
  // usageCount: true (default) | false. Once a day, an administrator opening the panel (or the reminder call) makes this installation
  // send one anonymous report to the author of Approdo: a random identifier, the version and the number of attended sessions. No site
  // address, no lab name, no participant data. The totals appear on the product website. false = nothing is ever sent.
  // What is sent, and to whom, is written in docs/privacy.md. Switching it off changes nothing else.
  usageCount: true,

  // ===== LANDING PHOTO ==============================================================================================
  // No photo by default: the landing page shows a quiet line drawing (see art below) next to the title, the summary and the booking button.
  // image: a file inside public/ (with its width and height in pixels), or null for none.
  // ogImage: a 1200x630 picture for link previews (a file inside public/), or null for none.
  // creditHtml: credit line under the page, trusted HTML written by you (one per language), or null for no credit.
  // The accent colour of the site: one colour written as #rrggbb (default "#246b5c", a petroleum green). It colours the thin rules, bars
  // and selected states of the public pages and of the panel; the site serves it as /theme.css, with a variant readable on each theme.
  // art: the drawing of the landing page when there is no photo: "contour" (default, a quiet line drawing) or "hologram" (the decorative
  // menu over the photo, with its one-shot animation; it keeps its own red palette).
  accent: "#246b5c",
  // palette: "paper" (default: warm paper and marine ink) or "theatre" (cream paper, warm near-black ink, and on the landing page a
  // full-width band in the accent colour with a soft light, for a deep, stage-like look).
  palette: "paper",
  hero: {
    art: "contour",
    image: null,
    ogImage: null,
    creditHtml: null,
  },

  // ===== A VIRTUAL REALITY STUDY AS AN EXAMPLE (optional) ============================================================
  // To present a virtual reality study instead of a generic one: set twoStudies: true and declarations: { epilepsy: true, vestibular: "study2" }
  // above, replace studyName and hero, and add the texts below to the `texts` block at the end of this file (remove the
  // leading // of every line). public/quest3.webp is a headset photo licensed CC BY-SA 4.0 and needs the credit.
  //
  // studyName: { it: "studio di realtà virtuale", en: "virtual reality study", es: "estudio de realidad virtual" },
  // hero: {
  //   image: "/quest3.webp", width: 1040, height: 551, ogImage: null,
  //   creditHtml: {
  //     it: 'Foto del visore: <a href="https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg" rel="noopener">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.it" rel="noopener">CC BY-SA 4.0</a> (ritagliata).',
  //     en: 'Headset photo: <a href="https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg" rel="noopener">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> (cropped).',
  //   },
  // },
  // vrTexts (to put inside `texts`):
  //   it: {
  //     title: "Partecipa a uno studio di realtà virtuale",
  //     lead: "Aiutaci a valutare un'applicazione di realtà virtuale. È uno studio di ricerca del gruppo Lab Esempio (Università di Esempio).",
  //     study1: {
  //       lead: "Con il visore indossato, userai i menu di un'applicazione di realtà virtuale in modi diversi, con i controller o con le mani a seconda del gruppo che ti verrà assegnato. L'obiettivo è capire come rendere la realtà virtuale più facile da usare.",
  //       does: "Con il visore indossato e seduto su una sedia, svolgerai alcuni compiti con un menu all'interno dell'applicazione. Compilerai alcuni questionari al computer prima dei compiti, tra un compito e l'altro e alla fine. La sessione è individuale e non serve alcuna esperienza precedente con la realtà virtuale.",
  //       reqs: ["Vedere normalmente, con occhiali o lenti a contatto se li usi."],
  //     },
  //     study2: {
  //       lead: "Con il visore indossato, proverai diversi modi di muoverti in un ambiente di realtà virtuale. L'obiettivo è capire come rendere la realtà virtuale più comoda e facile da usare.",
  //       does: "Con il visore indossato e seduto su una sedia girevole, ti muoverai in un ambiente virtuale seguendo degli anelli. Compilerai alcuni questionari al computer prima dei percorsi, tra un percorso e l'altro e alla fine. La sessione è individuale e non serve alcuna esperienza precedente con la realtà virtuale.",
  //       reqs: ["Vedere normalmente, con occhiali o lenti a contatto se li usi."],
  //     },
  //     twoIntro: "Con la stessa applicazione svolgiamo due studi, uno dopo l'altro:",
  //     twoS1: "Studio 1: usare i menu dell'applicazione con le mani o con i controller.",
  //     twoS2: "Studio 2: muoversi nello spazio virtuale.",
  //     termsVision: "Persone con vista normale o corretta (occhiali o lenti a contatto).",
  //     invitePitch: "Cerchiamo persone per uno studio di realtà virtuale. Con il visore indossato, proverai diversi modi di usare un'applicazione di realtà virtuale: vogliamo capire come renderla più facile da usare. È una sessione individuale. Non serve alcuna esperienza precedente. La partecipazione è volontaria e non è retribuita.",
  //   },
  //   en: {
  //     title: "Take part in a virtual reality study",
  //     lead: "Help us evaluate a virtual reality application. This is a research study of the Lab Esempio group (Example University).",
  //     study1: {
  //       lead: "Wearing the headset, you will use the menus of a virtual reality application in different ways, with controllers or with your hands depending on the group you are assigned to. The aim is to learn how to make virtual reality easier to use.",
  //       does: "Wearing the headset and sitting down, you will do some tasks with a menu inside the application. Before, between and after the tasks you will fill in some questionnaires on a computer. The session is one person at a time and no previous experience with virtual reality is needed.",
  //       reqs: ["Have normal vision, with glasses or contact lenses if you wear them."],
  //     },
  //     study2: {
  //       lead: "Wearing the headset, you will try different ways of moving around a virtual reality environment. The aim is to learn how to make virtual reality more comfortable and easier to use.",
  //       does: "Wearing the headset and sitting on a swivel chair, you will move around a virtual environment by following some rings. Before, between and after the paths you will fill in some questionnaires on a computer. The session is one person at a time and no previous experience with virtual reality is needed.",
  //       reqs: ["Have normal vision, with glasses or contact lenses if you wear them."],
  //     },
  //     twoIntro: "We run two studies with the same application, one after the other:",
  //     twoS1: "Study 1: using the application's menus with your hands or with controllers.",
  //     twoS2: "Study 2: moving through the virtual space.",
  //     termsVision: "With normal or corrected vision (glasses or contact lenses).",
  //     invitePitch: "We are looking for people to take part in a virtual reality study. Wearing the headset, you will try different ways of using a virtual reality application: we want to learn how to make virtual reality easier to use. It is a one-person session. No previous experience is needed. Taking part is voluntary and unpaid.",
  //   },

  // ===== TEXT OVERRIDES =============================================================================================
  // Rewrite any public sentence without touching src/: study description, requirements, privacy policy...
  // Put the language first, then the key of the text as it appears in src/i18n.js. Both forms work:
  //   texts: { it: { "study1.lead": "...", study1: { does: "..." }, privacy: "<h1>...</h1>..." } }
  // A key whose built-in value is a function (for example pendingP1) takes a text with {0}, {1} where its
  // arguments go. A key that does not exist stops the site at load with a clear error, so typos cannot hide.
  // The legal pages (terms, privacy) are a starting point: rewrite them for your study and have them reviewed.
  // Which keys describe the study, and so must be rewritten for a different study, is explained in docs/testi.md.
  // Example (remove the // to use it; one block per language of "languages"):
  // texts: {
  //   it: {
  //     title: "Partecipa a uno studio sulla lettura su schermo",
  //     study1: {
  //       lead: "Leggerai alcuni brevi testi su uno schermo e risponderai a qualche domanda. L'obiettivo è capire come rendere la lettura più comoda. È uno studio di ricerca del gruppo Lab Esempio (Università di Esempio).",
  //       does: "Seduto davanti a un computer, leggerai alcuni testi e risponderai a un questionario. La sessione è individuale e non serve alcuna esperienza precedente.",
  //       reqs: ["Vedere normalmente, con occhiali o lenti a contatto se li usi."],
  //     },
  //     termsMaterials: "L'applicazione e i questionari sono in italiano.",
  //   },
  // },
  texts: {
    it: {},
    en: {},
  },
};
