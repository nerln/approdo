# Il foglio di consenso informato di uno studio

Dalla sezione **Studi** del pannello, per ogni studio, puoi scrivere il contenuto del **foglio di consenso informato** che chi partecipa
firma **su carta** prima della sessione, e stamparlo. Il
contenuto sta accanto allo studio, per ogni lingua del sito, e il sito produce la pagina da stampare. Il sito **non raccoglie** il consenso:
non c'è nessuna firma, nessuna casella e nessun dato di partecipanti nel sito. La firma resta sulla carta.

## Un punto di partenza, da far rivedere

Il testo di serie è un foglio di consenso **generico e prudente** per uno studio di laboratorio. **È un punto di partenza, non un testo
legale**: prima di usarlo con persone vere deve essere rivisto dal **comitato etico** o dall'**ufficio per la protezione dei dati** (DPO)
della tua istituzione, che può chiedere di cambiare, aggiungere o togliere parti. Lo stesso vale per i testi che scrivi tu. Il pannello lo
ricorda in cima all'editor.

Il testo di serie prende dalla configurazione (`site.config.js`) il nome del gruppo e dell'università, il luogo, la durata della sessione
(`sessionMinutes`), i giorni di conservazione delle prenotazioni (`bookingRetentionDays`), i mesi dell'elenco contatti (`contactMonths`), la
persona responsabile e l'indirizzo di contatto. Le parti che **solo il tuo laboratorio può sapere** sono scritte **fra parentesi quadre**,
per esempio *[descrivi i compiti che la persona svolgerà…]*. Il sito non le riempie: **sostituiscile tutte** prima di stampare. Un foglio
stampato con le parentesi quadre ancora dentro non è pronto; la striscia sullo schermo conta le **parentesi quadre che restano**.

Due campi si riempiono da soli dal tuo studio quando c'è qualcosa di tuo: **"Che cosa farà la persona"** riprende il "cosa farai" dello studio
(se l'hai scritto tu nel modulo dello studio, o l'ha scritto `site.config.js`; il testo generale di serie non conta) al posto della frase fra
parentesi, e **"Chi non può partecipare"** riprende i requisiti dello studio e le frasi delle dichiarazioni (epilessia, disturbi vestibolari)
quando ce ne sono. Senza niente di tuo, resta la frase fra parentesi quadre.

Il testo di serie dice anche, nella parte sulla conservazione, che **le copie degli avvisi di prenotazione restano nella casella di posta del
ricercatore fino alla fine dello studio e che si conservano conteggi per settimana senza nomi**. Il testo in italiano non usa articoli davanti
al nome dell'università ("dal gruppo X (Università di Y)"), così funziona con qualunque nome; l'inglese dice "The session is individual and
takes place at: <luogo>".

## Come si compila

1. Apri **Studi**, scegli lo studio e premi **Formulario di consenso informato** (in italiano: "Modulo di consenso informato"). È una
   vista a parte, con il link per tornare allo studio.
2. Per **ogni lingua del sito** trovi un gruppo di campi, tutti **testo semplice** (tag e link non vengono interpretati; un a capo diventa
   un nuovo paragrafo):
   - titolo del foglio (160 caratteri), benvenuto, di che cosa tratta lo studio, che cosa farà la persona, durata (200), rischi e disagi,
     chi non può partecipare, diritti, dati raccolti, come si conservano i dati (per esempio con un codice partecipante), chi usa i dati,
     pubblicazione, per quanto tempo si conservano i dati, titolare del trattamento e responsabili con un contatto, supervisori, come
     vedere, correggere o cancellare i dati o ritirare il consenso: 1500 caratteri ciascuno, salvo dove indicato;
   - i **permessi facoltativi**: uno per riga, al massimo 6 righe di 300 caratteri (per esempio il permesso di fare foto o video);
   - tre interruttori: le **righe per nome, data e firma del ricercatore**, **prima le righe del ricercatore** (spento di norma: alcuni fogli
     approvati le mettono per prime, e così si ripristina quell'ordine) e la **dichiarazione di essere maggiorenne** nella frase di accettazione.
3. **Ogni campo mostra il testo che verrebbe stampato** (il tuo, altrimenti quello di serie). Se lo lasci com'è non si salva nessuna copia: un
   campo uguale al testo di serie (senza guardare i ritorni a capo né gli spazi attorno) viene salvato vuoto e segue le modifiche future
   dello studio. Un testo troppo lungo non viene tagliato: il salvataggio viene rifiutato e **la pagina torna con lo stesso modulo compilato con ciò che
   avevi scritto**, l'errore accanto al campo (che dice quale campo e quale lingua) e un avviso in cima; non scrive nulla. I limiti valgono per ciò che si salva.
   Se il modulo è cambiato nel frattempo, il salvataggio non scrive nulla e ti rimette davanti ciò che avevi scritto.
4. **Salva**. Solo allora il foglio mostra le modifiche.

Il primo salvataggio, come per gli altri campi dello studio, copia nella tabella `studies` gli studi della configurazione. Finché non salvi
nulla, il sito (pagine pubbliche, e-mail, esportazioni) non cambia: guardare l'editor o il foglio non scrive niente.

## Stampare

Nell'editor, "Apri il foglio da stampare" c'è per ogni lingua. L'indirizzo è `/admin/consent?study=<identificativo>&lang=<lingua>`: serve la
sessione del pannello, e uno studio o una lingua che non esistono danno "non trovato". La pagina è fatta per la carta:

- **A4, nero su bianco** (anche se il tuo computer è in tema scuro), con il nome del laboratorio come piccola intestazione;
- le sezioni nell'ordine di un foglio vero: titolo, benvenuto, di che cosa tratta, che cosa farai, durata, rischi, chi non può partecipare,
  diritti, dati raccolti, conservazione e uso dei dati, pubblicazione, titolare e diritti sui dati, supervisori;
- in fondo il blocco del consenso, in quest'ordine: la frase *"Io, ______, ho letto questo documento, ho potuto fare domande, sono
  maggiorenne e accetto di partecipare a questo studio."*, i permessi facoltativi come **caselle vuote** da spuntare, il blocco della persona
  che partecipa (**nome in stampatello**, data, firma) e poi il blocco del ricercatore (nome, data, firma; se acceso). Con l'interruttore
  **prima le righe del ricercatore** l'ordine è: ricercatore, frase, permessi, persona;
- **in fondo a ogni foglio una riga** con il nome dello studio e "versione del <data dell'ultima modifica>" (la data dell'ultima modifica dello
  studio, nel fuso configurato; per uno studio della configurazione che nessuno ha mai modificato, il giorno in cui stampi);
- sullo schermo, una striscia ti ricorda a parole di **usare il comando Stampa del browser** (menu, oppure Ctrl+P o Cmd+P), **dice quante frasi
  tra parentesi quadre restano da sostituire** (nella lingua del pannello) e ha un link per tornare all'editor. **Non c'è nessuno script**. Quella striscia, la navigazione e gli sfondi non vengono stampati; ogni sezione evita di
  spezzarsi fra due pagine e il blocco delle firme resta unito.

## Farlo concordare con la pagina pubblica

Il foglio e la pagina di prenotazione non devono contraddirsi. In cima a ogni lingua l'editor mostra, **in sola lettura**, che cosa dice la
pagina pubblica per questo studio: la durata della sessione (da `sessionMinutes`), le dichiarazioni che il modulo chiede (epilessia,
disturbi vestibolari), i requisiti elencati e **tutto ciò che il testo pubblico promette sul consenso**, frase per frase (diritti, condizioni,
privacy: per esempio che foto e video si fanno solo se la persona li accetta nel consenso: il testo di serie dei diritti non lo promette, ma
una configurazione che lo scrive, o le condizioni di serie, sì). Il foglio **promette** lo stesso solo se lo scrivi tu. Se il modulo di prenotazione chiede la dichiarazione di **epilessia** e la parte "Chi non
può partecipare" del foglio (di serie o modificata) **non nomina l'epilessia** in quella lingua, compare un **avviso** ben visibile. Il testo
di serie la nomina da solo quando la dichiarazione è accesa.

## Privacy

- Il foglio **è in bianco**: non contiene dati personali, e il sito non salva e non mostra nessun codice partecipante né collega una
  prenotazione ai dati dello studio. La frase di serie sulla conservazione lo dice ai partecipanti.
- I fogli **firmati** sono dati personali: conservali come richiede la tua istituzione.
- Tutto ciò che scrivi nel foglio è testo semplice, ed è protetto dappertutto (pagine, foglio da stampare); non compare nelle pagine
  pubbliche, nelle e-mail né nelle esportazioni.
