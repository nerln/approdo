// Test variant: Spanish default language and Italian second, Italian admin panel, per-language organisation names, legacy Spanish paths.
// A complete configuration (the example lab with the changes named above), run by `npm run test:variants`.
export default {
  "brand": "Lab Prova",
  "org": {
    "group": {
      "es": "Grupo Prueba",
      "it": "Gruppo Prova"
    },
    "university": {
      "es": "Universidad de Prueba",
      "it": "Università di Prova"
    },
    "unit": "",
    "signature": {
      "es": "Grupo Prueba, Universidad de Prueba",
      "it": "Gruppo Prova, Università di Prova"
    }
  },
  "responsible": "Responsabile di Prova",
  "contactEmail": "prova@lab.example.edu",
  "baseUrl": "https://studio-prova.example.org",
  "timeZone": "Europe/Rome",
  "languages": [
    "es",
    "it"
  ],
  "adminLanguage": "it",
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
      "es": "Laboratorio Prueba, Calle Prueba 1, 00000 Ciudad de Prueba",
      "it": "Laboratorio Prova, Dipartimento di Prova, Università di Prova, Via Prova 1, 00000 Città di Prova"
    },
    "short": {
      "es": "Laboratorio Prueba · Ciudad de Prueba",
      "it": "Laboratorio Prova · Città di Prova"
    },
    "room": {
      "es": "laboratorio Prueba",
      "it": "laboratorio Prova"
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
  "privacyReviewed": false,
  "legacyPaths": true,
  "hero": {
    "image": "/quest3.webp",
    "width": 1040,
    "height": 551,
    "ogImage": null,
    "creditHtml": {
      "es": "Foto del visor: Wikimedia Commons, CC BY-SA 4.0 (recortada).",
      "it": "Foto del visore: <a href=\"https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg\" rel=\"noopener\">Wikimedia Commons</a>, <a href=\"https://creativecommons.org/licenses/by-sa/4.0/deed.it\" rel=\"noopener\">CC BY-SA 4.0</a> (ritagliata)."
    }
  },
  "texts": {
    "es": {},
    "it": {}
  }
};
