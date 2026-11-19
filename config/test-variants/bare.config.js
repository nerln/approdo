// Test variant: One study, no declarations at all, privacy reviewed, English only, Spanish admin panel.
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
    "en"
  ],
  "adminLanguage": "es",
  "sessionMinutes": 60,
  "slotMinutes": 60,
  "defaultTimes": [
    "09:00",
    "10:00",
    "11:00"
  ],
  "minNoticeHours": 12,
  "shortNoticeMinutes": 20,
  "daysAhead": 56,
  "flexDefaultUntil": "17:00",
  "place": {
    "long": {
      "en": "Test laboratory, Test Department, Test University, 1 Test Street, 00000 Test City, Italy"
    },
    "short": {
      "en": "Test laboratory · Test City"
    },
    "room": {
      "en": "Test laboratory"
    }
  },
  "noLinkDomains": [
    "example.edu"
  ],
  "bookingRetentionDays": 30,
  "contactMonths": 24,
  "twoStudies": false,
  "declarations": {
    "epilepsy": false,
    "vestibular": "never"
  },
  "privacyReviewed": true,
  "legacyPaths": false,
  "hero": {
    "image": "/quest3.webp",
    "width": 1040,
    "height": 551,
    "ogImage": null,
    "creditHtml": {
      "en": "Headset photo: <a href=\"https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg\" rel=\"noopener\">Wikimedia Commons</a>, <a href=\"https://creativecommons.org/licenses/by-sa/4.0/\" rel=\"noopener\">CC BY-SA 4.0</a> (cropped)."
    }
  },
  "texts": {
    "en": {}
  }
};
