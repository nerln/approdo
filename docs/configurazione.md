# Configurazione: `site.config.js` chiave per chiave

Il file `site.config.js`, nella cartella principale, è l'unico da modificare. Esporta un oggetto (`export default { ... }`), senza
importare niente. Il sito lo legge all'avvio, completa i valori predefiniti e controlla tutto: se qualcosa è sbagliato si ferma
con un messaggio che inizia con `site.config.js:` e nomina la chiave. Lo stesso controllo lo fanno `node scripts/setup.mjs` e i
test (`node scripts/test.mjs site.config.js --suite test-generic`), così l'errore salta fuori prima di pubblicare.

La tabella sintetica di tutte le chiavi è nel [README](../README.it.md#configurare-tutto-da-siteconfigjs). Qui ci sono i dettagli
che nel README non stanno.

## Identità e contatti

- **`brand`**: compare nell'intestazione delle pagine, nel titolo della scheda del browser e come nome del mittente delle
  e-mail. Una o due parole ("Lab Esempio").
- **`org`**: `group` (il gruppo di ricerca) e `university` entrano nei testi pubblici e nell'informativa; `unit` (il dipartimento)
  si aggiunge all'università, e vale `""` se non vuoi indicarlo; `signature` è l'ultima riga di ogni
  e-mail ("Lab Esempio, Università di Esempio"). Ognuno dei quattro è un testo (vale per tutte le lingue) oppure un
  oggetto con un testo per ogni lingua pubblica: `university: { it: "Università di Esempio", en: "Example University" }`. Una lingua che non è pubblica
  (per esempio quella del pannello) usa il testo della prima lingua.
- **`responsible`**: la persona che l'informativa nomina come responsabile dei dati. Scrivi un nome e cognome reale solo quando
  la persona lo sa e ha accettato: nell'esempio c'è `Nome Cognome`.
- **`contactEmail`**: a questo indirizzo arrivano gli avvisi "qualcuno ha prenotato/annullato" e ci vanno a finire le risposte
  alle e-mail (se imposti la proprietà `REPLY_TO` del relay, vedi [posta.md](posta.md)). Non compare in nessuna pagina
  pubblica. Se imposti la variabile `ADMIN_EMAIL` su Cloudflare, gli avvisi vanno a quella.
- **`baseUrl`** (facoltativa, di norma lasciala fuori): l'indirizzo pubblico, con `https://` e senza `/` finale. Senza, ogni link che
  il sito scrive (e-mail, file di calendario, link di Google Calendar, tag delle anteprime, promemoria) e il nome del sito che il
  controllo Turnstile si aspetta vengono dall'indirizzo con cui è arrivata la richiesta: il sito funziona sull'indirizzo
  `workers.dev` e su un dominio tuo senza che glielo dica. Se hai un dominio tuo e vuoi che i link siano sempre quello, scrivilo
  qui (o imposta la variabile `BASE_URL`, che ha la precedenza): è anche più sicuro, perché una richiesta con un altro indirizzo
  non può far scrivere al sito link verso quell'indirizzo ([SECURITY.md](../SECURITY.md)).
- **`timeZone`**: il fuso orario del laboratorio, nel formato IANA (`Europe/Rome`, `Europe/Madrid`, `Europe/London`...). Giorni,
  orari, preavviso e promemoria sono ora locale di questo fuso; l'ora legale si gestisce da sola.

## Lingue

- **`languages`**: l'elenco delle lingue pubbliche, per esempio `["it", "en"]`. La prima è quella predefinita (si usa quando il
  browser non dice niente; un browser che chiede solo lingue non offerte riceve l'inglese, se c'è, altrimenti la prima).
  Ogni lingua elencata ha: il selettore di lingua, i tag `hreflang`, l'indirizzo corto (`/it`, `/en`: comodo per il QR del
  cartello) e le e-mail in quella lingua. Le lingue conosciute sono `es`, `en`, `it`. Per ognuna devi scrivere i testi di
  `place` e, se usi i crediti, di `hero.creditHtml`.
- **`adminLanguage`**: `"es"` o `"it"`. Cambia solo il pannello `/admin` e gli avvisi che ricevi tu.

## Sessioni e orari

- **`sessionMinutes`** è la durata che il partecipante legge (pagine, e-mail, durata dell'evento nel calendario).
- **`slotMinutes`** è lo spazio di calendario che una prenotazione occupa: la sessione più la pausa prima della successiva. Non può
  essere più piccolo di `sessionMinutes` né più grande di 720 (12 ore). Regola applicata ovunque: due inizi dello stesso giorno distano almeno `slotMinutes`;
  un orario non si offre se un'altra prenotazione viva inizia a meno di `slotMinutes` da lì.
- **`defaultTimes`**: gli orari di inizio di un giorno appena aperto. Formato `HH:MM` con minuti qualsiasi (`09:00`, `13:45`,
  `10:20`), al massimo 12, senza ripetizioni. Vengono ordinati. Controlli: due orari più vicini di `slotMinutes` sono un errore
  (si sovrapporrebbero); l'ultimo turno non può finire dopo mezzanotte. Il ricercatore può cambiare l'elenco dal pannello
  (Impostazioni): quello nel file è il punto di partenza di un sito nuovo.
- **`minNoticeHours`** (12): le ore di anticipo minimo.
- **`shortNoticeMinutes`** (20): l'anticipo quando, dal pannello, concedi l'eccezione per un giorno. È anche il preavviso minimo
  della modalità "Disponibile oggi" (chi prenota oggi deve farlo almeno tra tanti minuti): un solo numero governa le due cose.
- **`daysAhead`** (56): fino a quanti giorni in avanti si possono aprire giorni nel pannello.
- **`flexDefaultUntil`** (`"17:00"`): l'ora di chiusura che la modalità "Disponibile oggi" propone.

Esempi completi nel [README](../README.it.md#esempio-1-sessioni-da-50-minuti-un-inizio-ogni-60-minuti).

## Luogo

`place` ha tre parti, ognuna con un testo per ogni lingua configurata:

```js
place: {
  long:  { it: "Laboratorio ..., Dipartimento di ..., Università ..., Via ... 1, CAP Città", en: "Laboratory ..., ..., City, Italy" },
  short: { it: "Laboratorio ... · Città",  en: "Laboratory ... · City" },
  room:  { it: "laboratorio ...",          en: "laboratory ..." },
},
```

`long` è l'indirizzo completo (e-mail, evento di calendario, scheda della prenotazione); `short` è la etichetta della pagina
iniziale; `room` è come le frasi lunghe chiamano il posto ("Rispondi all'e-mail o chiedici di persona nel *laboratorio Esempio*").

## Posta e dati

- **`noLinkDomains`**: elenco di domini, per esempio `["example.edu"]`, i cui filtri antispam eliminano i messaggi con link. A chi ha
  un indirizzo in quei domini (o in un loro sottodominio: `example.edu` vale anche per `studenti.example.edu`) il sito manda un'e-mail con un codice di sei
  cifre e senza link. La variabile `NOLINK_DOMAINS` su Cloudflare (domini separati da virgole) sostituisce questa chiave per intero.
- **`bookingRetentionDays`** (30) e **`contactMonths`** (24): vedi [privacy.md](privacy.md). Se li cambi, cambiano anche le
  frasi dell'informativa che li nominano.

- **`usageCount`** (`true`): il conteggio anonimo d'uso. `true`: una volta al giorno l'installazione manda all'autore di Approdo un
  rapporto con un identificativo casuale, la versione e il numero di sessioni con presenza (niente indirizzo del sito, nome del
  laboratorio, dati di partecipanti o lingua). `false`: non viene mai inviato nulla. Un valore diverso da `true` o `false` ferma il
  caricamento con un errore chiaro. Che cosa parte e perché: [privacy.md](privacy.md), sezione "Il conteggio anonimo d'uso". Il
  pannello (Impostazioni) dice se è attivo e quando è stato fatto l'ultimo tentativo di invio.

## Foto della pagina iniziale

```js
hero: {
  image: null,              // nessuna foto (predefinito); oppure un file dentro public/, per esempio "/foto.webp"
  width: 1040, height: 551, // le sue misure in pixel (contano solo con una foto)
  ogImage: null,            // 1200x630 per le anteprime dei link (file in public/), o null
  creditHtml: { it: 'Foto: <a href="https://...">Autore</a>, CC BY-SA 4.0', en: '...' }, // o null
},
```

Senza foto (`image: null`) la pagina iniziale mostra il disegno a linee scelto da `hero.art` (`"contour"`, predefinito) accanto al titolo, al riassunto e al pulsante per prenotare. Per usare una tua foto, copiala in `public/` (meglio `.webp`, qualche decina di kilobyte), poi scrivi il percorso e le misure.
`image` e `ogImage` sono percorsi locali che iniziano con una sola `/` e hanno solo lettere, cifre, `.`, `-`, `_` e `/` (niente
spazi, niente `..`, niente indirizzi web): un valore diverso ferma il sito all'avvio. Se
la foto ha una licenza che richiede un credito, scrivilo in `creditHtml`: è HTML tuo, non viene riscritto. La foto inclusa nel
modello (un visore) richiede il credito che trovi già scritto nell'esempio.

## Aspetto: colore e disegno

- `accent`: un colore scritto `#rrggbb` (predefinito `"#246b5c"`, un verde petrolio). Colora filetti, barre e stati selezionati delle pagine pubbliche e del pannello. Il sito lo serve come foglio di stile `/theme.css` (nessuno stile in linea), con una variante leggibile per il tema chiaro e una per il tema scuro, e un colore del testo calcolato per il contrasto. Un valore diverso da `#rrggbb` ferma il caricamento con un errore chiaro. `node scripts/check-contrast.mjs "#rrggbb"` controlla i contrasti con il tuo colore.
- `palette`: `"paper"` (predefinita) o `"theatre"`. `"paper"` è carta calda con inchiostro blu-verde. `"theatre"` è per un laboratorio il cui studio e i cui cartelli hanno un'identità rosso scuro, da palcoscenico: carta color crema, inchiostro nero caldo per testi e titoli (nessuna sfumatura verde), il tuo `accent` per le voci attive. Nella pagina iniziale una fascia a tutta larghezza nel colore `accent`, con una luce morbida al centro come un sipario sotto un faro, contiene titolo, introduzione, dati e pulsante in testo color crema, con la foto accanto (sotto, sul telefono) posata direttamente sulla fascia: la foto deve essere un ritaglio trasparente. La fascia è uguale nel tema chiaro e nel tema scuro; il testo diventa scuro se `accent` è un colore chiaro. Il pannello usa gli stessi inchiostri e la stessa carta. Tutto passa da `/theme.css` e da una classe sull'elemento `body`. `node scripts/check-contrast.mjs "#rrggbb"` controlla anche questa tavolozza.
- `hero.art`: il disegno della pagina iniziale. `"contour"` (predefinito) mostra un disegno a linee, oppure la tua foto (`hero.image`) con il suo credito; `"hologram"` disegna sopra la foto il menu olografico decorativo con la sua animazione unica (usa una sua tavolozza rossa).

## Uno studio o due, dichiarazioni, revisione della privacy

Quattro chiavi facoltative adattano il sito allo studio. Le prime tre hanno un valore predefinito.

- **`twoStudies`** (`true`): `true` presenta due studi eseguiti di seguito con la stessa applicazione (scheda "Due studi" nella
  pagina iniziale; interruttore dello studio attivo nel pannello, in Impostazioni; "Studio 1/2" accanto a ogni prenotazione e
  negli avvisi che ricevi). `false`: un solo studio. La scheda e l'interruttore non ci sono più, i testi sono sempre quelli di
  `study1` (anche se nel database è rimasto "studio 2") e nessuno studio è nominato nel pannello o nelle e-mail.
- **`declarations.epilepsy`** (`true`): la casella "non soffro né ho mai sofferto di epilessia". `false`: niente casella, il server
  non la controlla, la riga sparisce dai requisiti, dalle condizioni e dall'informativa.
- **`declarations.vestibular`** (`"study2"`): la dichiarazione sui disturbi vestibolari. `"study2"` la chiede solo a chi prenota il
  secondo studio (se `twoStudies` è `false` non si chiede mai); `"always"` la chiede a tutti; `"never"` non la chiede e non la nomina
  da nessuna parte.
- **`privacyReviewed`** (`false`): vedi sotto "Privacy".
- **`legacyPaths`** (`false`): gli indirizzi delle pagine. Le pagine spagnole usano `/condiciones`, `/privacidad`, `/reservar`,
  `/gestionar`, `/baja`; le altre lingue `/terms`, `/privacy`, `/book`, `/manage`, `/unsubscribe` (link, azioni dei moduli,
  indirizzo per cancellarsi nell'invito, nome del file di calendario `booking.ics`). Entrambi i modi funzionano sempre: un link
  vecchio non si rompe. Con `true` si usano gli indirizzi spagnoli in ogni lingua.
- **`studyName`**: come si chiama lo studio nelle frasi del sito che non sono in `texts`: gli oggetti delle e-mail ("Conferma il tuo
  turno: *studio di ricerca*"), il titolo dell'evento di calendario, l'invito e gli oggetti dei messaggi che prepari dal pannello. Un
  testo per tutte le lingue o uno per lingua (`{ it: "studio sulla lettura", en: "reading study", es: "estudio sobre la lectura" }`; una
  lingua che manca usa il nome generico). Deve stare dopo "un / uno" in italiano, "un" in spagnolo, "a / an" in inglese: l'articolo lo
  sceglie il sito. Predefinito: "studio di ricerca", "research study", "estudio de investigación".
- **`minAdminPasswordLength`** (`16`): la lunghezza minima di `ADMIN_PASSWORD`. Una password più corta conta come non impostata: `/admin`
  resta chiuso e la pagina dice quanti caratteri servono. Non abbassarla su un sito vero.

La casella e le righe dei requisiti dipendono dalle dichiarazioni accese: se le spegni, ricontrolla anche le frasi che le
nominano nei testi che hai riscritto (`study1.reqs`, `terms`, `privacy`).

## Privacy: `privacyReviewed`

L'informativa e le condizioni incluse sono un testo di partenza, scritto in modo generale. Finché `privacyReviewed` è
`false` (il valore predefinito): la lista "Messa in funzione" del pannello ha una riga "Da fare" che dice di far rivedere
l'informativa all'ufficio per la protezione dei dati della tua istituzione, e `node scripts/setup.mjs` stampa un avviso. Quando
l'informativa è rivista (e i testi dello studio sono riscritti, [testi.md](testi.md)), scrivi `privacyReviewed: true`: la riga sparisce.
Non cambia nessun testo del sito: è un promemoria.

## Riscrivere i testi pubblici: `texts`

Il sito ha una raccolta di testi per lingua in `src/i18n.js`. Per cambiare una frase non si tocca `src/`: si scrive in `texts`,
prima la lingua, poi la chiave del testo. Valgono due forme, anche mescolate:

```js
texts: {
  it: {
    "study1.lead": "Durante la sessione proverai ...",          // percorso con il punto
    study1: { does: "Resterai seduto e svolgerai alcuni compiti." }, // oggetto annidato
    help: "Per dubbi scrivi a Nome Cognome.",
  },
},
```

Regole che il controllo applica:

- Una chiave che **non esiste** ferma il sito all'avvio con `unknown text "..."`, così un refuso non passa inosservato. Il
  nome giusto lo trovi cercando la frase nel blocco della lingua (`it`) di `src/i18n.js`.
- Un testo semplice si sostituisce con un testo. Un elenco (per esempio `study1.reqs`, i requisiti, o `rights`) si sostituisce
  con un elenco di testi.
- Alcune chiavi sono in realtà funzioni che compongono una frase con dei valori (per esempio `pendingP1`, che riceve l'indirizzo
  e-mail). Per quelle scrivi un testo con `{0}`, `{1}`... al posto dei valori: `pendingP1: "Abbiamo scritto a <strong>{0}</strong>."`.
- Le pagine "Condizioni" e "Informativa" (`terms`, `privacy`) sono HTML scritto a mano nella chiave: puoi sostituirle per intero. Le
  frasi che cambiano quando le prenotazioni si confermano subito stanno in `privacyInstant` (un elenco di coppie: frase per la
  conferma via e-mail, frase per la conferma immediata): se riscrivi `privacy`, controlla anche quella.
- Le e-mail e il pannello hanno le loro frasi nei file `src/mail.js` e `src/admin_texts.js` e **non** si riscrivono da `texts`:
  usano i nomi e i numeri della configurazione (firma, luogo, durata, preavviso) e il nome dello studio (`studyName`).

### Che cosa riscrivere sempre

I testi di partenza sono generici: parlano di "uno studio di ricerca" (o come lo chiami in `studyName`), di una sessione individuale
in laboratorio, senza requisiti. Descrivono nel modo giusto il tuo studio solo se lo riscrivi. L'elenco preciso delle chiavi che descrivono lo studio, con un blocco da
copiare e riempire, è in [testi.md](testi.md). Poi apri il sito con `node scripts/preview.mjs`, in ogni lingua, e rileggi ogni
pagina come la leggerebbe un partecipante.

## Errori frequenti

| Messaggio (dopo `site.config.js:`) | Che cosa fare |
|---|---|
| `slotMinutes (40) must be at least sessionMinutes (50)` | `slotMinutes` va portato almeno a `sessionMinutes` |
| `defaultTimes: 10:00 and 10:30 are closer than slotMinutes` | Distanzia gli orari di almeno `slotMinutes` minuti |
| `defaultTimes: "9:00" is not a time in HH:MM format` | Scrivi `"09:00"`, con due cifre |
| `unknown language "fr" in languages` | Le lingue possibili sono `es`, `en`, `it` |
| `place.long.en must be a non-empty text` | Manca il testo di quella lingua in `place` (o in `hero.creditHtml`) |
| `unknown key "..."` | Un refuso nel nome di una chiave di primo livello |
| `unknown text "study1.lede"` | Un refuso in `texts`: cerca la chiave giusta in `src/i18n.js` |
| `the text key "..." contains "__proto__", which is not allowed` | Una chiave di `texts` contiene `__proto__`, `constructor` o `prototype`: non sono testi, scegli la chiave vera |
| `texts.es: "es" is not in languages` | Hai scritto testi per una lingua che il sito non offre: aggiungila a `languages` o cancella quel blocco |
| `hero.image must be a local path inside public/` | Il percorso deve essere come `/foto.webp`, senza spazi, `..` o indirizzi web |
| `slotMinutes must be a whole number between 1 and 720` | Un turno non può durare più di 12 ore |
| `declarations.vestibular must be "study2", "always" or "never"` | Scrivi uno dei tre valori, tra virgolette |
| `timeZone "Roma" is not an IANA time zone` | Usa `Europe/Rome` |
