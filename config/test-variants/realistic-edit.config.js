// Test variant: a realistic edit of the shipped example. A lab that typed its own values into site.config.js: a real-looking name,
// an e-mail address at a non-example domain, the 50-minute sessions with 10:00, 11:00 and 12:00 starts, Italian and English, a fixed
// baseUrl for its own domain, and its own study name. `node scripts/test.mjs site.config.js --suite test-generic` must stay green for
// a file like this one: no generic test may assume the values of the shipped example. (All names and addresses are invented.)
export default {
  brand: "Laboratorio di Lettura",
  org: {
    group: "Laboratorio di Lettura Digitale",
    university: { it: "Università di Testopoli", en: "University of Testopoli" },
    unit: { it: "Dipartimento di Lettere e Scienze Umane", en: "Department of Letters and Human Sciences" },
    signature: { it: "Laboratorio di Lettura Digitale, Università di Testopoli", en: "Digital Reading Lab, University of Testopoli" },
  },
  responsible: "Responsabile del Laboratorio di Lettura",
  contactEmail: "lettura@lab.example.org",
  baseUrl: "https://prenota.lab.example.org",
  timeZone: "Europe/Rome",
  languages: ["it", "en"],
  adminLanguage: "it",
  sessionMinutes: 50,
  slotMinutes: 60,
  defaultTimes: ["10:00", "11:00", "12:00"],
  minNoticeHours: 12,
  shortNoticeMinutes: 20,
  daysAhead: 56,
  flexDefaultUntil: "17:00",
  place: {
    long: {
      it: "Aula 12, Palazzo delle Lettere, Via Garibaldi 7, 31000 Testopoli",
      en: "Room 12, Palazzo delle Lettere, Via Garibaldi 7, 31000 Testopoli, Italy",
    },
    short: { it: "Aula 12 · Testopoli", en: "Room 12 · Testopoli" },
    room: { it: "aula 12", en: "room 12" },
  },
  noLinkDomains: ["lab.example.org"],
  bookingRetentionDays: 30,
  contactMonths: 24,
  minAdminPasswordLength: 16,
  studyName: { it: "studio sulla lettura su schermo", en: "study on reading on screen" },
  twoStudies: false,
  declarations: { epilepsy: false, vestibular: "never" },
  privacyReviewed: true,
  legacyPaths: false,
  hero: { image: null, ogImage: null, creditHtml: null },
  texts: {
    it: {
      study1: {
        lead: "Leggerai alcuni brevi testi su uno schermo e risponderai a qualche domanda, per capire come rendere la lettura più comoda.",
        does: "Seduto davanti a un computer, leggerai alcuni testi e risponderai a un questionario. La sessione è individuale e non serve alcuna esperienza precedente.",
        reqs: ["Vedere normalmente, con occhiali o lenti a contatto se li usi."],
      },
    },
    en: {
      study1: {
        lead: "You will read a few short texts on a screen and answer some questions, to learn how to make reading more comfortable.",
        does: "Sitting at a computer, you will read some texts and fill in a questionnaire. The session is one person at a time and no previous experience is needed.",
        reqs: ["Have normal vision, with glasses or contact lenses if you wear them."],
      },
    },
  },
};
