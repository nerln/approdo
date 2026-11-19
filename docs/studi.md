# Studi dal pannello: creare e modificare uno studio

Dalla sezione **Studi** del pannello (`/admin?s=studies`) gestisci gli studi senza toccare `site.config.js` e senza ripubblicare il
sito: i testi della pagina di prenotazione, le dichiarazioni sanitarie del modulo, un obiettivo di partecipanti. Tutto ciò che scrivi è
**testo semplice**: tag, link e a capo speciali non vengono interpretati, in nessuna pagina.

## Da dove vengono gli studi, e che cosa fa il primo salvataggio

- **Prima di qualunque salvataggio** la tabella `studies` è vuota e gli studi del sito sono quelli
  di `site.config.js` (Studio 1, e Studio 2 se `twoStudies` è `true`), con i testi e le dichiarazioni della configurazione, e lo studio
  attivo è quello scelto nel pannello. La sezione Studi li mostra già come modificabili, e **guardarla non cambia nulla**.
- Il **primo salvataggio** di uno studio (anche solo "Archivia", "Ripristina" o "Nuovo studio") scrive nella tabella **tutti** gli studi
  della configurazione, con gli identificativi `study1` e `study2` (così le prenotazioni già fatte continuano a corrispondere), le
  dichiarazioni della configurazione, nessun obiettivo e **nessun testo**: i testi restano quelli della configurazione e del sito, che la
  pagina continua a mostrare così come sono, senza tagliarli né cambiarne i caratteri; poi applica la modifica. **Una riga conserva solo
  ciò che è diverso dal testo di serie.** Salvare uno studio, o il suo modulo di consenso, senza cambiare niente non cambia niente: né la
  pagina di prenotazione in nessuna lingua, né le condizioni e la privacy, né le e-mail, il file del calendario, il CSV delle
  prenotazioni o il foglio da stampare (lo controlla un test su ogni configurazione del repository). Un salvataggio rifiutato (testo troppo
  lungo, obiettivo non valido) non scrive nulla, nemmeno la copia degli studi.
- **Da quel momento la tabella è la fonte**: la pagina di prenotazione dello studio attivo mostra i testi dello studio, le sue
  dichiarazioni decidono quali caselle compaiono e quali controlli fa il server, e la scheda "Più studi" della pagina iniziale
  elenca gli studi pubblici con il loro titolo e le parole "Turni aperti adesso" / "Più avanti" / "È già concluso" (solo se sono almeno due: vedi "Elenco pubblico degli studi"). Gli
  studi della configurazione non si leggono più: cambiare `twoStudies`, `declarations` o `texts` in `site.config.js` non cambia più gli
  studi già salvati.
- Una riga della tabella con JSON non valido è ignorata (lo studio si tratta come assente).

## Creare e modificare uno studio

1. **Nuovo studio** crea una bozza che mostra i testi generali di serie (quelli del primo studio, che non parlano di un "secondo" studio; la
   bozza non ne conserva nessuna copia) e ha un identificativo fatto da `s` più 10 caratteri casuali. Si chiama "Studio senza titolo 1",
   "Studio senza titolo 2"... (il primo numero libero). La bozza non è attiva e **non compare nell'elenco pubblico**: non la vede nessuno
   finché non la rendi attiva o non la inserisci nell'elenco.
2. Nel modulo di modifica:
   - **Nome interno** (al massimo 60 caratteri): lo vedi solo tu, nella lista, nell'agenda, nei CSV e nell'avviso di prenotazione che ricevi.
     **Non può essere uguale al nome di un altro studio non archiviato** (maiuscole e minuscole non contano): il salvataggio, o il
     ripristino di uno studio archiviato, viene rifiutato.
   - **Obiettivo di partecipanti**: un numero intero da 1 a 9999, oppure vuoto (nessun obiettivo).
   - **Partecipanti fatti al di fuori del sito**: un numero intero da 0 a 9999, vuoto vale 0. Si somma ai "fatti" dell'avanzamento.
   - **Dichiarazioni**: "epilessia" e "disturbi vestibolari". Quelle accese diventano caselle obbligatorie nel modulo di prenotazione, righe
     nell'elenco dei requisiti, e sono controllate anche dal server, non solo dal browser.
   - **Come compare nell'elenco pubblico** (vedi sotto): "Non compare", "Più avanti" o "Già concluso".
   - Per **ogni lingua del sito**: titolo pubblico (160 caratteri), breve descrizione e obiettivo (1200), "cosa farai" (2000) e i requisiti,
     uno per riga (al massimo 20 righe di 300 caratteri). **Ogni campo mostra il testo che vede il pubblico** (quello dello studio, altrimenti
     quello della configurazione o di serie). Se lo lasci com'è **non salva nessuna copia**: confronta il testo senza guardare i
     ritorni a capo né gli spazi attorno; se lo cambi, si salva il tuo; se lo vuoti o rimetti l'originale, si torna al testo di serie.
     **I limiti valgono solo per ciò che si salva**: un testo di serie o di configurazione più lungo del limite non dà nessun errore (non viene salvato) e
     il campo del modulo non lo taglia. Sotto ogni campo con un limite c'è una riga con il limite.
3. **Salva studio.** Un testo troppo lungo non viene tagliato: il salvataggio viene rifiutato, **la pagina torna con lo stesso modulo
   compilato con ciò che avevi scritto**, un avviso in cima e l'errore accanto al campo (che dice quale campo e quale lingua).
   Su uno studio non attivo c'è anche **Salva e attiva questo studio**: salva e lo rende lo studio attivo in un colpo solo. Dopo un
   salvataggio si ritorna al modulo (ancora `#studies-edit`) e la lingua dell'anteprima resta quella scelta; i link della lingua
   dell'anteprima restano sull'anteprima.
   **Se lo studio è cambiato nel frattempo** (in un'altra scheda, o da un'altra richiesta contemporanea) il salvataggio non scrive nulla: ogni
   scrittura confronta il JSON salvato con quello che ha letto (`UPDATE ... WHERE id = ? AND data = ?`) e, se è diverso, risponde con lo
   stesso modulo, con ciò che hai scritto ancora dentro, e il messaggio "è cambiato nel frattempo". Lo stesso vale per Archivia,
   Ripristina e per il salvataggio del modulo di consenso (Archivia e Ripristina rispondono con un avviso e non cambiano nulla).
4. A fianco c'è l'**anteprima**: come apparirà la parte dello studio nella pagina di prenotazione, con l'ultimo salvataggio, in una lingua
   alla volta (i link cambiano la lingua dell'anteprima). Nella pagina pubblica "Cosa farai" e i requisiti vengono **dopo** il modulo di
   prenotazione, nelle schede a fianco; nell'anteprima sono mostrati insieme (c'è una nota che lo dice).
5. **Attiva questo studio** lo rende quello che il pubblico vede e a cui si riferiscono le nuove prenotazioni. Un solo studio è attivo. I
   pulsanti con i nomi degli studi, in cima all'elenco, fanno lo stesso.

## Elenco pubblico degli studi (`publicState`)

La scheda "Più studi" della pagina iniziale non dipende dalla posizione: ogni studio ha un campo `publicState`, che si sceglie nel
modulo ("Come compare nell'elenco pubblico degli studi") con una riga di spiegazione:

- **Nascosto** (`hidden`): lo studio non compare. È lo stato di ogni **nuova bozza**.
- **Più avanti** (`later`) e **Già concluso** (`done`): lo studio compare nella scheda con quella parola.
- Lo studio **attivo** compare sempre come "Turni aperti adesso", qualunque sia il suo stato.

La scheda compare **solo se gli studi pubblici sono almeno due** (l'attivo più almeno uno inserito nell'elenco); gli studi archiviati non
compaiono mai. Gli studi della configurazione (`study1`, `study2`) che nessuno ha toccato riproducono la scheda di sempre: con lo studio 1
attivo lo studio 2 è "più avanti", con lo studio 2 attivo lo studio 1 è "già concluso", e continuano a farlo quando cambi lo studio attivo fra i due,
finché non cambi uno stato a mano (un valore uguale a quello mostrato non conta come cambiamento). Con due studi della configurazione senza titolo proprio il testo
della scheda resta quello originale (`twoH`, `twoIntro`, `twoS1`, `twoS2`, `twoNotice`); appena uno ha un titolo suo, o c'è un altro studio
pubblico, la scheda è quella "Più studi".

## Il titolo dello studio

Se lo studio attivo ha un **titolo pubblico proprio** in una lingua, quel titolo è anche il titolo della scheda del browser, dell'anteprima dei
link (`og:title`, `twitter:title`), compare con "Studio:" nelle pagine della prenotazione, della conferma e dell'annullamento, e nell'avviso che
ricevi. L'evento di calendario conserva il `studyName` della configurazione. Uno studio senza titolo proprio produce le pagine di sempre.
Anche il CSV delle prenotazioni e l'avviso continuano a chiamare gli studi come sempre ("1", "2", "Studio 1") finché sono quelli della
configurazione con i loro nomi: se ne rinomini uno o ne aggiungi un altro, usano i nomi.

Solo i campi elencati vengono salvati: ogni altra chiave del modulo viene scartata, e niente di ciò che scrivi diventa un nome di
chiave, un indirizzo o un'intestazione.

## Obiettivo e avanzamento

Con un obiettivo, in cima all'**Agenda** compare per lo studio attivo "N di M partecipanti", una barra, "ancora prenotati per i prossimi
giorni" e "mancano K". Nell'elenco degli studi vedi gli stessi numeri per ognuno.

**"Fatti"** = prenotazioni con stato "Presente" più i «Partecipanti fatti al di fuori del sito» (li imposti nel modulo dello studio o nel piccolo modulo sotto l'avanzamento, con anche «+1»), **comprese quelle che il sito ha già cancellato**: la pulizia automatica (a ogni richiesta, al
massimo una volta al minuto) cancella le prenotazioni più vecchie di `bookingRetentionDays` giorni, ma prima il sito ne
aggiunge i conteggi alla tabella `tallies`, per studio, **settimana ISO** (la data del lunedì) e stato, nello stesso `db.batch` della cancellazione. I
conteggi non contengono né nomi né e-mail e non si cancellano mai; due pulizie contemporanee non contano due volte. Per settimana e non
per giorno, perché un conteggio per giorno conservato per sempre potrebbe individuare una persona (schema versione 3: i conteggi giornalieri
di un database esistente vengono sommati nel lunedì della loro settimana, una sola volta e in un solo `db.batch`).

## Archiviare

Uno studio **non si cancella mai**, perché le prenotazioni e i conteggi lo nominano. Si **archivia**: sparisce dalle scelte (non si può
rendere attivo e non compare nella scheda della pagina iniziale) ma la sua riga, le sue prenotazioni e i suoi conteggi restano, e
"Ripristina" lo riporta. **Lo studio attivo non si può archiviare**: attiva prima un altro studio.

## Dati e download

La sezione **Dati** ha tre blocchi, ognuno con scritto a parole se contiene dati personali: il riepilogo per studio e per settimana
(senza nomi né e-mail), le prenotazioni con nomi ed e-mail (dati personali, per il tuo uso: il sito le cancella dopo
`bookingRetentionDays` giorni e tu le cancelli dal tuo computer alla fine dello studio), e i contatti che hanno accettato gli avvisi. Nei
CSV un nome che inizia con `=`, `+`, `-` o `@` è preceduto da un apostrofo, perché un foglio di calcolo non lo esegua come formula.

Il **riepilogo** (pagina e CSV `riepilogo`) ha **una riga per studio e per settimana** con: prenotati (confermati, o in attesa, con la sessione
non ancora svolta), presenti, assenti, annullati e **non segnati** (turni confermati già iniziati che nessuno ha segnato "Presente" o "Assente":
non contano più come prenotati), più una riga **Totale** per studio con l'obiettivo. Il CSV ha anche l'identificativo dello studio accanto al
nome. Le prenotazioni di adesso e i conteggi si leggono **con una sola istruzione**, perché una pulizia che passa fra due letture non possa
contare due volte le stesse prenotazioni. Il riepilogo non ha né nomi né e-mail, ma **chi sa chi è venuto in una certa settimana potrebbe
comunque collegare un conteggio a una persona**: trattalo con cautela, soprattutto per gli studi piccoli. I file con nomi ed e-mail dicono
di averli nel nome: `prenotazioni-con-dati-personali-<data>.csv` e `contatti-con-dati-personali-<data>.csv` (con `adminLanguage: "es"`
`reservas-con-datos-personales-<fecha>.csv` e `contactos-con-datos-personales-<fecha>.csv`; con `legacyPaths: true` il pannello spagnolo
mantiene i nomi originali `reservas` e `contactos`).

Nel pannello, "Esporta CSV" delle Impostazioni dice che contiene nomi ed e-mail delle prenotazioni.

## Il foglio di consenso informato

Ogni studio ha anche un editor del **foglio di consenso informato** da stampare e firmare su carta, per lingua: vedi [consenso.md](consenso.md).

## Cose da sapere

- Una prenotazione tiene l'identificativo dello studio (`study1`, `study2` o `s…`): "una sola partecipazione per studio" vale per
  identificativo.
- Le pagine "Condizioni" e "Privacy" restano quelle di `site.config.js`: non dipendono dallo studio. Se cambi le dichiarazioni di uno studio,
  controlla che le Condizioni dicano ancora la cosa giusta (vedi [testi.md](testi.md)).
- L'informativa di serie contiene una frase sui conteggi per settimana; se la tua istituzione ha un testo suo, aggiungila (vedi [privacy.md](privacy.md)).
- Le settimane del pannello (agenda): il pulsante "Abrir/Apri lunedì a venerdì di questa settimana" dice le date; di sabato e di domenica "questa
  settimana" è quella che inizia lunedì. Il menu "Settimane da aprire" dice che si tratta di settimane (1, 2, 4 o 8).
- Con `node scripts/preview.mjs --now <istante ISO con fuso>` (per esempio `--now 2026-11-16T10:00:00+01:00`) l'anteprima gira con un orologio fisso: si possono
  provare le presenze, la pulizia e il riepilogo senza aspettare.
