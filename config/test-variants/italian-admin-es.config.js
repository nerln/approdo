// Test variant: Italian and English public pages with the Spanish admin panel (the researcher reads Spanish, the participants Italian).
// A complete configuration (the example lab with the changes named above), run by `npm run test:variants`.
export default {
  "brand": "Lab Prova",
  "org": {
    "group": "Lab Prova",
    "university": "Università di Prova",
    "unit": "Dipartimento di Prova",
    "signature": "Lab Prova, Università di Prova"
  },
  "responsible": "Responsabile di Prova",
  "contactEmail": "prova@lab.example.edu",
  "baseUrl": "https://studio-prova.example.org",
  "timeZone": "Europe/Rome",
  "languages": [
    "it",
    "en"
  ],
  "adminLanguage": "es",
  "sessionMinutes": 50,
  "slotMinutes": 60,
  "defaultTimes": [
    "09:00",
    "10:00",
    "11:00",
    "12:00"
  ],
  "minNoticeHours": 12,
  "shortNoticeMinutes": 20,
  "daysAhead": 56,
  "flexDefaultUntil": "17:00",
  "place": {
    "long": {
      "it": "Laboratorio Prova, Dipartimento di Prova, Università di Prova, Via Prova 1, 00000 Città di Prova",
      "en": "Test laboratory, Test Department, Test University, 1 Test Street, 00000 Test City, Italy"
    },
    "short": {
      "it": "Laboratorio Prova · Città di Prova",
      "en": "Test laboratory · Test City"
    },
    "room": {
      "it": "laboratorio Prova",
      "en": "Test laboratory"
    }
  },
  "noLinkDomains": [],
  "bookingRetentionDays": 30,
  "contactMonths": 24,
  "twoStudies": true,
  "declarations": {
    "epilepsy": true,
    "vestibular": "study2"
  },
  "privacyReviewed": true,
  "legacyPaths": false,
  "hero": {
    "image": "/quest3.webp",
    "width": 1040,
    "height": 551,
    "ogImage": null,
    "creditHtml": {
      "it": "Foto del visore: <a href=\"https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg\" rel=\"noopener\">Wikimedia Commons</a>, <a href=\"https://creativecommons.org/licenses/by-sa/4.0/deed.it\" rel=\"noopener\">CC BY-SA 4.0</a> (ritagliata).",
      "en": "Headset photo: <a href=\"https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg\" rel=\"noopener\">Wikimedia Commons</a>, <a href=\"https://creativecommons.org/licenses/by-sa/4.0/\" rel=\"noopener\">CC BY-SA 4.0</a> (cropped)."
    }
  },
  "texts": {
    "it": {},
    "en": {}
  }
};
