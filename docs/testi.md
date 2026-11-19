# Testi dello studio: che cosa riscrivere per il tuo studio

I testi pubblici di partenza (`src/i18n.js`) sono generici: parlano di «uno studio di ricerca» (il nome è `studyName` in
`site.config.js`), di una sessione individuale in laboratorio, senza requisiti. Le parti che dipendono dal laboratorio (nomi, luogo,
durata, firma, nome dello studio) vengono già dalla configurazione; **le parti che descrivono che cosa fa la persona no**, e vanno
riscritte da te in `texts` di `site.config.js`. (Una configurazione con due studi di seguito, una foto e le dichiarazioni di salute
si riattiva con il blocco commentato in fondo a `config/example-lab.config.js`.) Come funziona `texts` (percorsi con il punto, oggetti annidati, funzioni con `{0}`):
[configurazione.md](configurazione.md).

Regola d'oro: **non inventare testo legale**. Le condizioni di partecipazione e l'informativa sulla privacy le scrive, o almeno le
rivede, l'ufficio per la protezione dei dati della tua istituzione. Quando l'informativa è rivista, scrivi `privacyReviewed: true`.

## Le chiavi che descrivono lo studio

Dove non è scritto altro, la chiave esiste in ogni lingua e si riscrive per ogni lingua che offri.

| Chiave | Dove compare | Che cosa descrive |
|---|---|---|
| `title`, `desc`, `ogDesc` | titolo della scheda del browser, descrizione per i motori di ricerca, anteprima dei link | di che studio si tratta («Partecipa a uno studio di ricerca»: il nome viene da `studyName`) |
| `lead` | frase sotto il titolo | lo scopo, in una riga |
| `study1.lead`, `study1.does`, `study1.reqs` | pagina iniziale: introduzione, «Cosa farai», «Requisiti» | lo studio (con `twoStudies: false` è l'unico che si vede) |
| `study2.lead`, `study2.does`, `study2.reqs` | come sopra, per il secondo studio | solo se `twoStudies` è `true` |
| `twoH`, `twoIntro`, `twoS1`, `twoS2`, `twoNow`, `twoLater`, `twoDone`, `twoNotice` | la scheda «Due studi» | solo se `twoStudies` è `true` (con `false` la scheda non c'è) |
| `reqEpilepsy`, `reqVestibular` | righe dei requisiti, aggiunte da `declarations` | requisiti di salute (spegni con `declarations`) |
| `noepi`, `vest`, `err.noepi`, `err.vest` | caselle di dichiarazione del modulo e messaggi di errore | dichiarazioni di salute (spegni con `declarations`) |
| `rights` | scheda «I tuoi dati e i tuoi diritti» (elenco) | volontarietà, compenso, foto e video, consenso, dove stanno i dati |
| `futureL`, `futureNote`, `futureNoteInstant` | casella facoltativa «avvisi sui prossimi studi» | l'elenco per studi futuri e per quanto tempo si conserva l'e-mail |
| `termsVision`, `termsEpilepsy`, `termsVestibularStudy2`, `termsVestibularAlways` | righe di «Chi può partecipare» nelle condizioni | chi può partecipare |
| `termsMaterials` | una frase nelle condizioni, dopo la durata della sessione (vuota di partenza: non compare) | la lingua dell'applicazione e dei questionari, o qualunque cosa sul materiale |
| `termsTitle`, `termsDesc`, `terms` | pagina «Condizioni di partecipazione» | tutto il testo delle condizioni |
| `privDecl` | frase dell'informativa che nomina le dichiarazioni di salute | segue `declarations`: se riscrivi `privacy` interamente non serve |
| `privacyTitle`, `privacyDesc`, `privacy`, `privacyInstant` | pagina «Informativa sulla privacy» | trattamento dei dati: scopi, basi, conservazione, servizi usati |
| `inviteSubject`, `invitePitch` | l'invito che prepari dal pannello per i prossimi studi | come presenti lo studio a chi non lo conosce |
| `factLangText` | non è mostrata da nessuna pagina del modello | lasciala vuota |

Le frasi dell'informativa che dipendono da come si confermano le prenotazioni (via e-mail o subito) stanno in `privacyInstant`:
è un elenco di coppie «frase per la conferma via e-mail», «frase per la conferma immediata». Se riscrivi `privacy`, riscrivi
anche quelle.

### I segnaposto dentro `terms` e `privacy`

`terms` e `privacy` sono HTML scritto nella chiave. Dentro puoi usare:

- `{home}` e `{baja}`: gli indirizzi della pagina iniziale e di quella per cancellarsi dagli avvisi, già corretti per la lingua;
- `{reqs}` (solo in `terms`): le righe dell'elenco «Chi può partecipare», composte da `termsVision` e dalle dichiarazioni accese;
- `{materials}` (solo in `terms`): la frase `termsMaterials`, con uno spazio davanti, oppure niente se è vuota;
- `{decl}` (solo in `privacy`): la frase sulle dichiarazioni di salute, oppure niente se non ce ne sono.

Se scrivi `terms` o `privacy` per intero puoi non usare nessuno di questi, e fare a meno anche di `termsVision`, `privDecl` e simili.
Il testo che scrivi non viene modificato, quindi è tuo anche il compito di mettere i nomi giusti (`{home}` serve per i link).

## Che cosa NON si riscrive da `texts`

Le e-mail ai partecipanti, l'evento di calendario e il pannello hanno i loro testi in `src/mail.js` e `src/admin_texts.js`, non in
`texts`. Usano i nomi e i numeri della configurazione (firma, luogo, durata, preavviso) e il nome dello studio: gli oggetti delle
e-mail, il titolo dell'evento di calendario e l'oggetto dei messaggi che prepari dal pannello dicono «studio di ricerca» (in
inglese «research study», in spagnolo «estudio de investigación») finché non scrivi il tuo in `studyName` (per esempio
`studyName: { it: "studio sulla lettura", en: "reading study" }`). Le altre frasi di quei messaggi non si cambiano da `texts`.

## Un blocco da copiare

Incolla questo blocco al posto di `texts` in `site.config.js` (una lingua per ogni lingua di `languages`: togli quella che non
offri), poi sostituisci ogni frase tra virgolette. Tutte le chiavi qui esistono: se ne scrivi una che non esiste il sito si ferma
all'avvio con il suo nome. Le righe `reqEpilepsy`, `reqVestibular`, `noepi`, `vest` servono solo se le dichiarazioni sono accese;
`study2` e le chiavi `two*` solo con `twoStudies: true`.

```js
texts: {
  it: {
    title: "DA RISCRIVERE: titolo, per esempio «Partecipa a uno studio sulla lettura su schermo»",
    desc: "DA RISCRIVERE: due frasi per i motori di ricerca.",
    ogDesc: "DA RISCRIVERE: una frase per l'anteprima dei link.",
    lead: "DA RISCRIVERE: lo scopo dello studio in una riga.",
    study1: {
      lead: "DA RISCRIVERE: che cosa farà la persona e a che scopo. È uno studio di ricerca del gruppo Lab Esempio.",
      does: "DA RISCRIVERE: la sessione passo per passo, e se serve un'esperienza precedente.",
      reqs: ["DA RISCRIVERE: un requisito per riga, per esempio «Vedere normalmente, con occhiali o lenti a contatto se li usi.»"],
    },
    reqEpilepsy: "DA RISCRIVERE: requisito di salute (solo con declarations.epilepsy: true).",
    reqVestibular: "DA RISCRIVERE: requisito di salute (solo con una dichiarazione vestibolare accesa).",
    noepi: "DA RISCRIVERE: la dichiarazione che la persona spunta (solo con declarations.epilepsy: true).",
    vest: "DA RISCRIVERE: la dichiarazione che la persona spunta (solo con una dichiarazione vestibolare accesa).",
    rights: [
      "DA RISCRIVERE: volontarietà e compenso.",
      "DA RISCRIVERE: come si conservano i dati dello studio e chi li usa.",
      "DA RISCRIVERE: foto, video, consenso.",
    ],
    termsVision: "DA RISCRIVERE: per esempio «Persone con vista normale o corretta.»",
    termsMaterials: "DA RISCRIVERE oppure lascia vuoto: per esempio «L'applicazione e i questionari sono in italiano.»",
    inviteSubject: "DA RISCRIVERE: oggetto dell'invito ai prossimi studi.",
    invitePitch: "DA RISCRIVERE: il testo dell'invito, in poche frasi.",
    // terms e privacy: copiali da src/i18n.js (blocco "it"), riscrivili con l'ufficio per la protezione dei dati e incollali qui:
    // terms: `<h1>...</h1> ... <ul>{reqs}</ul> ... <p><a href="{home}">Torna all'inizio</a></p>`,
    // privacy: `<h1>...</h1> ... <p><a href="{baja}">pagina per cancellarsi</a></p> ... <p><a href="{home}">Torna all'inizio</a></p>`,
  },
  en: {
    title: "TO REWRITE: title, for example “Take part in a study on reading on screen”",
    desc: "TO REWRITE: two sentences for search engines.",
    ogDesc: "TO REWRITE: one sentence for link previews.",
    lead: "TO REWRITE: the aim of the study in one line.",
    study1: {
      lead: "TO REWRITE: what the person will do and why. This is a research study of the Lab Esempio group.",
      does: "TO REWRITE: the session step by step, and whether previous experience is needed.",
      reqs: ["TO REWRITE: one requirement per line, for example “Have normal vision, with glasses or contact lenses if you wear them.”"],
    },
    reqEpilepsy: "TO REWRITE: health requirement (only with declarations.epilepsy: true).",
    reqVestibular: "TO REWRITE: health requirement (only with a vestibular declaration on).",
    noepi: "TO REWRITE: the declaration the person ticks (only with declarations.epilepsy: true).",
    vest: "TO REWRITE: the declaration the person ticks (only with a vestibular declaration on).",
    rights: [
      "TO REWRITE: voluntary taking part and payment.",
      "TO REWRITE: how the study data is kept and who uses it.",
      "TO REWRITE: photos, videos, consent.",
    ],
    termsVision: "TO REWRITE: for example “With normal or corrected vision.”",
    termsMaterials: "TO REWRITE or leave empty: for example “The application and the questionnaires are in English.”",
    inviteSubject: "TO REWRITE: subject of the invitation to future studies.",
    invitePitch: "TO REWRITE: the text of the invitation, in a few sentences.",
  },
},
```

Il blocco è esattamente quello controllato dai test (`test-generic/docs.test.mjs` lo carica): se un giorno una chiave cambia nome, il test
lo segnala. Dopo averlo riempito: `node scripts/preview.mjs`, e leggi ogni pagina in ogni lingua come la leggerebbe un partecipante;
poi `node scripts/test.mjs site.config.js --suite test-generic`.
