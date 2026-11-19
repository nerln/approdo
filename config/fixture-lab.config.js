// Regression fixture: a complete, fictional lab (DemoLab, Universidad de Ejemplo, 45-minute sessions, two studies).
// `npm test` copies this file over site.config.js in a temporary directory and runs the whole regression suite in test/
// against it, which proves that the configurable template keeps the behaviour that the regression suite pins.
// It is not meant to be deployed; to start your own site edit site.config.js in the root of the repository.
export default {
  brand: "DemoLab VR",
  org: {
    group: "DemoLab",
    university: "Universidad de Ejemplo",
    unit: "EDI",
    signature: "DemoLab, Universidad de Ejemplo",
  },
  responsible: "Nombre Apellido",
  contactEmail: "investigacion@example.org",
  baseUrl: "https://estudio-vr-demo.workers.dev",
  // The fixture study is about virtual reality: the e-mail subjects, the calendar title and the built-in texts say so.
  studyName: { es: "estudio de realidad virtual", en: "virtual reality study" },
  // The regression suite uses short throw-away admin passwords.
  minAdminPasswordLength: 1,
  timeZone: "Europe/Madrid",
  languages: ["es", "en"],
  adminLanguage: "es",

  sessionMinutes: 45,
  slotMinutes: 45,
  defaultTimes: ["09:15", "10:00", "10:45", "11:30", "12:15", "13:50", "14:35", "15:20", "16:05"],
  minNoticeHours: 12,
  shortNoticeMinutes: 20,
  daysAhead: 56,
  flexDefaultUntil: "17:00",

  place: {
    long: {
      es: "Laboratorio 1.2.34, EDI (Escuela de Ingeniería), Universidad de Ejemplo, Avenida de la Universidad s/n, Villaejemplo",
      en: "Laboratory 1.2.34, EDI (Escuela de Ingeniería), Universidad de Ejemplo, Avenida de la Universidad s/n, Villaejemplo",
    },
    short: { es: "Laboratorio 1.2.34 · EDI, Villaejemplo", en: "Laboratory 1.2.34 · EDI, Villaejemplo" },
    room: { es: "laboratorio 1.2.34", en: "laboratory 1.2.34" },
  },

  noLinkDomains: ["unidemo.es"],
  bookingRetentionDays: 30,
  contactMonths: 24,

  // Both studies, both health declarations, a privacy text marked as reviewed, and Spanish path names
  // (/condiciones, /privacidad...) in every language.
  twoStudies: true,
  declarations: { epilepsy: true, vestibular: "study2" },
  privacyReviewed: true,
  legacyPaths: true,

  // A wine red accent, and the decorative holographic menu over the photo.
  accent: "#7a1f1f",
  palette: "theatre",
  hero: {
    art: "hologram",
    image: "/quest3.webp",
    width: 1040,
    height: 551,
    ogImage: "/og.png",
    creditHtml: {
      es: 'Foto del visor: <a href="https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg" rel="noopener">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.es" rel="noopener">CC BY-SA 4.0</a> (recortada).',
      en: 'Headset photo: <a href="https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg" rel="noopener">Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a> (cropped).',
    },
  },

  // The built-in texts are generic (they name the group, university, room and so on from the keys above). A few sentences
  // are worded differently in this fixture, so they are restated here and pinned by the regression suite.
  texts: {
    es: {
      // The built-in "rights" list does not promise photos or videos (it cannot know the consent form); this fixture does.
      rights: ["Participar es voluntario: puedes parar en cualquier momento, sin dar ninguna razón y sin ninguna consecuencia. No se paga.", "Tus datos del estudio se guardan con un código, nunca con tu nombre, y solo los usa el equipo de investigación.", "Las fotos o los vídeos de la sesión son opcionales: solo se hacen si lo aceptas en el consentimiento.", "El consentimiento se firma en papel en el laboratorio. Te llevas una copia con el contacto para ver, corregir o borrar tus datos."],
      // The materials are in English and the questionnaires can be done in Spanish (the built-in texts say nothing about it).
      factLangText: "la aplicación y los cuestionarios están en inglés. Si lo necesitas, puedes hacer los cuestionarios en español.",
      termsMaterials: " La aplicación y los cuestionarios están en inglés. Si lo necesitas, puedes hacer los cuestionarios en español.",
      invitePitch: "Buscamos personas para un estudio de realidad virtual del grupo DemoLab (Universidad de Ejemplo). Con las gafas puestas, probarás distintas formas de usar una aplicación de realidad virtual: queremos saber cómo hacer que la realidad virtual sea más fácil de usar. Es una sesión individual de 45 minutos en el laboratorio 1.2.34 de la EDI, en Villaejemplo. No hace falta experiencia previa. La participación es voluntaria y no se paga.",
      ogDesc: "Una sesión de 45 minutos en el laboratorio 1.2.34 de la EDI. Reserva tu turno.",
      desc: "Prueba distintas formas de usar una aplicación de realidad virtual y ayúdanos a que sea más fácil de usar. Sesión de 45 minutos en el laboratorio 1.2.34 de la EDI (Villaejemplo).",
      footUv: "DemoLab · Universidad de Ejemplo · EDI, Villaejemplo",
      lab: "Laboratorio 1.2.34, EDI, Universidad de Ejemplo (Villaejemplo)",
      lead: "Ayúdanos a evaluar una aplicación de realidad virtual. Es un estudio de investigación del grupo DemoLab de la Universidad de Ejemplo.",
      help: "Responde al correo de confirmación o pregúntanos en el laboratorio 1.2.34.",
      "study1.lead": "Con las gafas puestas, manejarás los menús de una aplicación de realidad virtual de distintas formas, con los mandos o con las manos según el grupo que te toque. El objetivo es saber cómo hacer que la realidad virtual sea más fácil de usar. Es un estudio de investigación del grupo DemoLab de la Universidad de Ejemplo.",
      "study2.lead": "Con las gafas puestas, probarás distintas formas de moverte por un entorno de realidad virtual. El objetivo es saber cómo hacer que la realidad virtual sea más cómoda y fácil de usar. Es un estudio de investigación del grupo DemoLab de la Universidad de Ejemplo.",
      // Restated from the built-in texts of the VR study this fixture reproduces (the built-in ones are generic now).
      "study1.does": "Con las gafas puestas y sentado, harás unas tareas con un menú dentro de la aplicación. Antes, entre y después de las tareas rellenarás unos cuestionarios en un ordenador. La sesión es individual y no hace falta experiencia previa con realidad virtual.",
      "study1.reqs": ["Ver con normalidad, con gafas o lentillas si las usas."],
      "study2.does": "Con las gafas puestas y sentado en una silla giratoria, te moverás por un entorno virtual siguiendo unos anillos. Antes, entre y después de los recorridos rellenarás unos cuestionarios en un ordenador. La sesión es individual y no hace falta experiencia previa con realidad virtual.",
      "study2.reqs": ["Ver con normalidad, con gafas o lentillas si las usas."],
      "twoIntro": "Con la misma aplicación hacemos dos estudios, uno después del otro:",
      "twoS1": "Estudio 1: usar los menús de la aplicación con las manos o con los mandos.",
      "twoS2": "Estudio 2: moverse por el espacio virtual.",
      "termsVision": "Con visión normal o corregida (gafas o lentillas).",
      "termsVestibularStudy2": "En el estudio de desplazamiento, que además no tengan ni hayan tenido nunca un trastorno vestibular.",
      noscriptTs: "Para reservar hace falta activar JavaScript, por la comprobación contra robots. Si no puedes, pregúntanos en el laboratorio 1.2.34.",
      termsDesc: "Condiciones de participación en el estudio de realidad virtual de la EDI.",
      terms: `<h1>Condiciones de participación</h1>
<h2>Quién puede participar</h2>
<ul>
<li>Con visión normal o corregida (gafas o lentillas).</li>
<li>Que no tengan ni hayan tenido nunca epilepsia.</li>
<li>En el estudio de desplazamiento, que además no tengan ni hayan tenido nunca un trastorno vestibular.</li>
</ul>
<h2>Qué ocurre</h2>
<p>Vienes al Laboratorio 1.2.34 de la EDI (Universidad de Ejemplo, Villaejemplo). La sesión dura 45 minutos: usas la aplicación de realidad virtual sentado y rellenas unos cuestionarios en un ordenador antes, entre y después de las partes con las gafas. La aplicación y los cuestionarios están en inglés. Si lo necesitas, puedes hacer los cuestionarios en español. El consentimiento informado se firma en papel en el laboratorio, antes de empezar. Las fotos o los vídeos de la sesión son opcionales: solo se hacen si lo aceptas en el consentimiento.</p>
<h2>Es voluntario</h2>
<p>Puedes parar en cualquier momento, sin dar ninguna razón y sin ninguna consecuencia. La participación no se paga.</p>
<h2>Si no puedes venir</h2>
<p>Cancela con el enlace que recibes al reservar o en «Gestionar mi reserva», con tu correo y tu código, para que otra persona pueda usar el hueco. No hay ninguna penalización si no vienes.</p>
<h2>Cambios del investigador</h2>
<p>Por motivos técnicos, el investigador puede mover o cancelar un turno. Si ocurre, te escribirá al correo que diste.</p>
<h2>Dudas</h2>
<p>Si tienes alguna pregunta, responde al correo de confirmación que recibes al reservar o pregúntanos en el laboratorio.</p>
<p><a href="{home}">Volver al inicio</a></p>`,
      privacyDesc: "Información sobre el tratamiento de datos del sistema de reservas del estudio de realidad virtual de la EDI.",
      privacy: `<h1>Política de privacidad</h1>
<p>Esta página explica qué datos usa el sistema de reservas y resume cómo se tratan los datos del estudio. La información completa del estudio está en el consentimiento informado que firmas en el laboratorio.</p>
<h2>Quién trata tus datos</h2>
<p>El grupo de investigación DemoLab de la Universidad de Ejemplo (EDI). Responsable: Nombre Apellido (investigador). Para cualquier consulta sobre tus datos, responde al correo de confirmación de tu reserva o pregúntanos en el laboratorio 1.2.34.</p>
<h2>Para qué</h2>
<p>Para gestionar tu turno y enviarte la confirmación, un recordatorio y los cambios que pudieran producirse. Lo hacemos con tu consentimiento, que das al reservar y puedes retirar cuando quieras, cancelando la reserva.</p>
<h2>Qué datos</h2>
<p>Nombre o alias, correo electrónico, el turno elegido, el idioma de la página, tus declaraciones de requisitos (ausencia de epilepsia y, en su caso, de trastorno vestibular) y, si lo haces, cuándo confirmaste que recibes nuestro correo. Para limitar el abuso del formulario se guarda durante una hora un código derivado de la dirección IP, que no permite identificarte.</p>
<h2>Servicios que usamos</h2>
<ul>
<li>Cloudflare: alojamiento de la web y base de datos en la Unión Europea.</li>
<li>Google: envío de los correos desde la cuenta de Gmail del estudio, cuando está activado.</li>
<li>Cloudflare Turnstile: comprobación contra robots, cuando está activada.</li>
</ul>
<h2>Avisos de futuros estudios (opcional)</h2>
<p>Al reservar puedes marcar una casilla para que te avisemos por correo de futuros estudios del grupo. Es opcional y no cambia tu reserva.</p>
<ul>
<li>Qué guardamos: solo tu dirección de correo y el idioma de la página. No guardamos tu nombre ni el turno.</li>
<li>Para qué: para avisarte de futuros estudios del grupo DemoLab.</li>
<li>Con qué base: tu consentimiento, el de la casilla opcional. Cuenta desde que confirmas la reserva; si no la confirmas, tu correo se borra a las 3 horas y no cuenta como consentimiento.</li>
<li>Cuánto tiempo: 24 meses desde esa confirmación. Después se borra automáticamente.</li>
<li>Cómo retirarlo: en la página <a href="{baja}">Darse de baja de avisos</a>, o respondiendo a cualquier correo del estudio. Cancelar la reserva no te quita de la lista.</li>
</ul>
<p>Los avisos los envía la persona responsable desde su propio correo: la web no envía nada a esa lista.</p>
<h2>Cuánto tiempo</h2>
<p>Los datos de la reserva se borran 30 días después del turno. Las reservas sin confirmar se borran a las 2 horas. Si pediste los avisos de futuros estudios, tu correo y el idioma se guardan 24 meses desde que confirmas la reserva y después se borran; si no confirmas la reserva, se borran a las 3 horas. Los correos que te enviamos, y las copias de los avisos de reserva que recibe la persona responsable (con tu nombre y tu correo), también quedan en la cuenta de correo desde la que se envían hasta que termina el estudio, y entonces se borran. Los correos de aviso a la lista y los ficheros que la persona responsable descargue de ella son copias suyas: se borran al limpiar la lista y, como muy tarde, a los 24 meses. El registro técnico de envíos (qué correo salió y si falló, sin su texto) se guarda 60 días.</p>
<h2>Cookies</h2>
<p>No usamos cookies ni seguimiento para las personas que visitan la web.</p>
<h2>Relación con los datos del estudio</h2>
<p>Los datos de la reserva no se vinculan nunca con los datos del estudio ni con los códigos de participante.</p>
<h2>Datos del estudio</h2>
<p>Antes de empezar firmas en papel un consentimiento informado y te llevas una copia. Las respuestas a los cuestionarios, las notas del investigador y los registros automáticos de la aplicación (por ejemplo, tiempos y movimientos de la cabeza y de las manos o los mandos) se guardan con un código de participante, nunca con tu nombre. Solo los usa el grupo DemoLab de la Universidad de Ejemplo. Pueden publicarse como conjunto de datos anonimizado, sin los registros de movimiento. Se conservan cinco años desde el final del estudio y después se borran. Las fotos o los vídeos solo se hacen si lo aceptas en el consentimiento.</p>
<h2>Tus derechos</h2>
<p>Para ver, corregir o borrar los datos de tu reserva, responde al correo de confirmación o pregúntanos en el laboratorio 1.2.34. Para cancelar tu reserva tienes dos caminos: el enlace de cancelación del correo de confirmación, o «Gestionar mi reserva» en la página de inicio, con tu correo y el código de reserva de 6 cifras que también va en el correo. Cancelar no borra los datos: tus datos de reserva se borran como máximo 30 días después de la fecha del turno; si quieres que se borren antes, escríbenos respondiendo al correo. Para darte de baja de los avisos de futuros estudios, usa la <a href="{baja}">página de baja</a>: basta con escribir tu correo. Para los datos del estudio, escribe al contacto de tu copia del consentimiento, con tu código de participante.</p>
<p><a href="{home}">Volver al inicio</a></p>`,
    },
    en: {
      // The built-in "rights" list does not promise photos or videos (it cannot know the consent form); this fixture does.
      rights: ["Taking part is voluntary and unpaid: you can stop at any time, without giving a reason and with no consequence.", "Your study data is stored under a code, never with your name, and only the research team uses it.", "Photos or videos of the session are optional: they are taken only if you agree in the consent form.", "You sign the consent form on paper at the lab. You keep a copy with the contact to see, correct or delete your data."],
      factLangText: "the application and the questionnaires are in English. If you need it, you can do the questionnaires in Spanish.",
      termsMaterials: " The application and the questionnaires are in English. If you need it, you can do the questionnaires in Spanish.",
      invitePitch: "We are looking for people to take part in a virtual reality study of the DemoLab group (Universidad de Ejemplo). Wearing the headset, you will try different ways of using a virtual reality application: we want to learn how to make virtual reality easier to use. It is a 45-minute session, one person at a time, in laboratory 1.2.34 of the EDI, in Villaejemplo. No previous experience is needed. Taking part is voluntary and unpaid.",
      ogDesc: "A session of 45 minutes in lab 1.2.34 at EDI. Book your slot.",
      desc: "Try different ways of using a virtual reality application and help us make it easier to use. A 45-minute session in laboratory 1.2.34 of the EDI (Villaejemplo).",
      footUv: "DemoLab · Universidad de Ejemplo · EDI, Villaejemplo",
      lab: "Laboratory 1.2.34, EDI, Universidad de Ejemplo (Villaejemplo)",
      lead: "Help us evaluate a virtual reality application. This is a research study of the DemoLab group at the Universidad de Ejemplo.",
      help: "Reply to the confirmation email or ask us at lab 1.2.34.",
      "study1.lead": "Wearing the headset, you will use the menus of a virtual reality application in different ways, with controllers or with your hands depending on the group you are assigned to. The aim is to learn how to make virtual reality easier to use. This is a research study of the DemoLab group at the Universidad de Ejemplo.",
      "study2.lead": "Wearing the headset, you will try different ways of moving around a virtual reality environment. The aim is to learn how to make virtual reality more comfortable and easier to use. This is a research study of the DemoLab group at the Universidad de Ejemplo.",
      // Restated from the built-in texts of the VR study this fixture reproduces (the built-in ones are generic now).
      "study1.does": "Wearing the headset and sitting down, you will do some tasks with a menu inside the application. Before, between and after the tasks you will fill in some questionnaires on a computer. The session is one person at a time and no previous experience with virtual reality is needed.",
      "study1.reqs": ["Have normal vision, with glasses or contact lenses if you wear them."],
      "study2.does": "Wearing the headset and sitting on a swivel chair, you will move around a virtual environment by following some rings. Before, between and after the paths you will fill in some questionnaires on a computer. The session is one person at a time and no previous experience with virtual reality is needed.",
      "study2.reqs": ["Have normal vision, with glasses or contact lenses if you wear them."],
      "twoIntro": "We run two studies with the same application, one after the other:",
      "twoS1": "Study 1: using the application's menus with your hands or with controllers.",
      "twoS2": "Study 2: moving through the virtual space.",
      "termsVision": "With normal or corrected vision (glasses or contact lenses).",
      "termsVestibularStudy2": "In the movement study, who also do not have a vestibular disorder and have never had one.",
      noscriptTs: "To book you need to turn on JavaScript, because of the check against robots. If you cannot, ask us at lab 1.2.34.",
      termsDesc: "Conditions for taking part in the virtual reality study at EDI.",
      terms: `<h1>Participation conditions</h1>
<h2>Who can take part</h2>
<ul>
<li>With normal or corrected vision (glasses or contact lenses).</li>
<li>Who do not have epilepsy and have never had it.</li>
<li>In the movement study, who also do not have a vestibular disorder and have never had one.</li>
</ul>
<h2>What happens</h2>
<p>You come to Laboratory 1.2.34 at EDI (Universidad de Ejemplo, Villaejemplo). The session lasts 45 minutes: you use the virtual reality application while seated and fill in some questionnaires on a computer before, between and after the parts with the headset. The application and the questionnaires are in English. If you need it, you can do the questionnaires in Spanish. You sign the informed consent form on paper at the lab, before starting. Photos or videos of the session are optional: they are taken only if you agree in the consent form.</p>
<h2>It is voluntary</h2>
<p>You can stop at any time, without giving a reason and without any consequence. Participation is unpaid.</p>
<h2>If you cannot come</h2>
<p>Cancel with the link you receive when you book or under "Manage my booking", with your email address and your code, so that someone else can use the slot. There is no penalty if you do not come.</p>
<h2>Changes made by the researcher</h2>
<p>For technical reasons, the researcher may move or cancel a slot. If that happens, we will write to the email address you gave.</p>
<h2>Questions</h2>
<p>If you have a question, reply to the confirmation email you receive when you book, or ask us at the lab.</p>
<p><a href="{home}">Back to the start</a></p>`,
      privacyDesc: "Information on how the booking system of the virtual reality study at EDI processes personal data.",
      privacy: `<h1>Privacy policy</h1>
<p>This page explains which data the booking system uses and summarises how the study data are handled. The full information about the study is in the informed consent form you sign at the lab.</p>
<h2>Who handles your data</h2>
<p>The DemoLab research group of the Universidad de Ejemplo (EDI). Person responsible: Nombre Apellido (researcher). For any question about your data, reply to the confirmation email of your booking or ask us at lab 1.2.34.</p>
<h2>What for</h2>
<p>To manage your slot and send you the confirmation, a reminder and any changes that may occur. We do it with your consent, which you give when you book and can withdraw at any time, by cancelling the booking.</p>
<h2>What data</h2>
<p>Name or alias, email address, the slot you chose, the language of the page, your declarations about the requirements (no epilepsy and, where relevant, no vestibular disorder) and, if you do so, when you confirmed that you receive our email. To limit abuse of the form, a code derived from the IP address is kept for one hour. It cannot be used to identify you.</p>
<h2>Services we use</h2>
<ul>
<li>Cloudflare: hosting of the website and database in the European Union.</li>
<li>Google: sending of the emails from the study's Gmail account, when enabled.</li>
<li>Cloudflare Turnstile: bot check, when enabled.</li>
</ul>
<h2>Notices about future studies (optional)</h2>
<p>When you book, you can tick a box to be told by email about future studies of the group. It is optional and does not change your booking.</p>
<ul>
<li>What we keep: only your email address and the language of the page. We do not keep your name or the slot.</li>
<li>What for: to tell you about future studies of the DemoLab group.</li>
<li>On what basis: your consent, given with the optional box. It counts from when you confirm the booking; if you do not confirm it, your email address is deleted after 3 hours and does not count as consent.</li>
<li>For how long: 24 months from that confirmation. Then it is deleted automatically.</li>
<li>How to withdraw: on the <a href="{baja}">Unsubscribe from notices</a> page, or by replying to any email of the study. Cancelling the booking does not remove you from the list.</li>
</ul>
<p>The notices are sent by the person responsible from their own email account: the website sends nothing to that list.</p>
<h2>How long</h2>
<p>Booking data is deleted 30 days after the slot. Unconfirmed bookings are deleted after 2 hours. If you asked for notices about future studies, your email address and language are kept for 24 months from when you confirm the booking and then deleted; if you do not confirm the booking, they are deleted after 3 hours. The emails we send you, and the copies of booking notices that the person responsible receives (with your name and email address), also remain in the mail account they are sent from until the study ends, and are then deleted. The notices sent to the list and any files the person responsible downloads from it are their own copies: they are deleted when the list is cleaned and, at the latest, after 24 months. The technical log of sent emails (which email went out and whether it failed, without its text) is kept for 60 days.</p>
<h2>Cookies</h2>
<p>We do not use cookies or tracking for people who visit the website.</p>
<h2>Link with the study data</h2>
<p>Booking data is never linked to the study data or to participant codes.</p>
<h2>Study data</h2>
<p>Before starting you sign an informed consent form on paper and keep a copy. Your answers to the questionnaires, the researcher's notes and the automatic records of the application (for example, times and movements of the head and of the hands or controllers) are stored under a participant code, never with your name. Only the DemoLab group of the Universidad de Ejemplo uses them. They may be published as an anonymised dataset, without the movement records. They are kept for five years after the end of the study and then deleted. Photos or videos are taken only if you agree in the consent form.</p>
<h2>Your rights</h2>
<p>To see, correct or delete your booking data, reply to the confirmation email or ask us at lab 1.2.34. To cancel your booking there are two ways: the cancellation link in the confirmation email, or “Manage my booking” on the home page, with your email address and the 6-digit booking code that is also in the email. Cancelling does not delete the data: your booking data is deleted at most 30 days after the date of the slot; if you want it deleted sooner, reply to the email. To unsubscribe from notices about future studies, use the <a href="{baja}">unsubscribe page</a>: you only need to enter your email address. For the study data, write to the contact on your copy of the consent form, with your participant code.</p>
<p><a href="{home}">Back to the start</a></p>`,
    },
  },
};
