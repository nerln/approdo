// Test variant: a lab with its own real-looking contact address at a university domain that is not an example domain (invented: ateneo-prova.it),
// in contactEmail and inside its own texts. The generic tests must accept the lab own addresses in site.config.js and nothing else.
// Based on realistic-edit.config.js, with the contact address changed as described above.
export default {
  brand: "Laboratorio di Lettura",
  org: {
    group: "Laboratorio di Lettura Digitale",
    university: { it: "Università di Testopoli", en: "University of Testopoli" },
    unit: { it: "Dipartimento di Lettere e Scienze Umane", en: "Department of Letters and Human Sciences" },
    signature: { it: "Laboratorio di Lettura Digitale, Università di Testopoli", en: "Digital Reading Lab, University of Testopoli" },
  },
  responsible: "Responsabile del Laboratorio di Lettura",
  contactEmail: "lab@ateneo-prova.it",
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
        reqs: ["Vedere normalmente, con occhiali o lenti a contatto se li usi.", "Per chiarimenti scrivi a segreteria@ateneo-prova.it."],
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
