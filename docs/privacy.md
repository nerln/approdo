# Privacy: che cosa conserva il sito, per quanto tempo, e come cancellare

Questa pagina descrive che cosa fa il **codice**. Non è una consulenza legale e non sostituisce l'informativa della tua
istituzione: **l'informativa e le condizioni di partecipazione che il sito mostra sono un punto di partenza**, scritte in modo
generale. Ogni istituzione deve farle controllare dal proprio responsabile della protezione dei dati
(DPO) e adattarle ai propri studi prima di annunciare il sito. Si modificano da `texts` in `site.config.js` (chiavi `terms`,
`privacy`, `privacyInstant`, vedi [configurazione.md](configurazione.md)). Le cifre dell'informativa (giorni di conservazione,
mesi dell'elenco contatti) seguono `bookingRetentionDays` e `contactMonths`.
Finché non hai scritto `privacyReviewed: true` in `site.config.js`, il pannello (Impostazioni, "Messa in funzione") ricorda con una riga "Da fare" che
l'informativa va rivista, e `node scripts/setup.mjs` stampa un avviso. Quali testi riscrivere per un altro studio: [testi.md](testi.md).

**Se la tua istituzione sostituisce il testo dell'informativa** (`texts.<lingua>.privacy` in `site.config.js`), aggiungi alla parte sulla
conservazione una frase come questa (il testo di serie ce l'ha in spagnolo, inglese e italiano): *dopo la cancellazione dei dati delle
prenotazioni, il sito conserva soltanto i conteggi per settimana (quanti turni sono stati prenotati, frequentati, saltati o annullati),
senza nomi né indirizzi e-mail. Chi sa chi è venuto in una certa settimana potrebbe comunque collegare un conteggio a una persona.* Il sito
la conserva davvero: vedi la tabella `tallies` qui sotto e [studi.md](studi.md). Non dire "nessun dato personale": un conteggio per
settimana non ha nomi, ma in uno studio piccolo, per chi sa chi è venuto, può ancora indicare qualcuno.

## Che cosa si conserva

| Dato | Dove | Quanto tempo |
|---|---|---|
| Per ogni prenotazione: nome o alias, e-mail, giorno e ora, stato (in attesa, confermata, annullata, presente, assente), lingua, data di creazione, data in cui la persona ha confermato di ricevere l'e-mail, se il promemoria è partito | tabella `bookings` | fino a `bookingRetentionDays` giorni dopo il giorno del turno (30 per impostazione predefinita), anche se annullata; se non viene confermata, 2 ore |
| Registro delle e-mail inviate per ogni prenotazione: tipo, esito, errore, ora. **Non** il testo né l'indirizzo | `mail_log` | 60 giorni |
| Elenco per studi futuri (solo se la persona ha spuntato la casella facoltativa): e-mail, lingua, data del consenso | `contacts` | `contactMonths` mesi dalla conferma, oppure finché la persona non esce dall'elenco; se la prenotazione non viene confermata, 3 ore |
| Un'impronta dell'indirizzo di rete (un codice derivato dall'IP con un sale che cambia ogni giorno, da cui non si risale alla persona) per limitare le richieste, e i tentativi di accesso al pannello | `rate_limit`, `login_attempts` | 1 ora |
| Quando le prenotazioni vengono cancellate, il sito ne conserva i **conteggi**: quante prenotazioni, per studio, **settimana ISO** (la data del lunedì) e stato (prenotata, presente, assente, annullata, confermata e mai segnata). Nessun nome, e-mail o codice. Per settimana e non per giorno, perché un conteggio per giorno conservato per sempre potrebbe individuare una persona | `tallies` | senza scadenza: senza nomi né e-mail, ma vedi sopra: chi sa chi è venuto in quella settimana potrebbe collegare un conteggio a una persona |
| Giorni e orari aperti, impostazioni del pannello, il risultato dell'ultima chiamata dei promemoria, l'identificativo casuale del conteggio d'uso (`install_id`) e l'ora dell'ultimo tentativo di invio (`usage_ping_at`) | `days`, `day_slots`, `settings` | giorni e orari passati: come le prenotazioni; impostazioni: finché servono |

Non si conservano: indirizzi IP, codici partecipante (i dati di prenotazione non si collegano mai ai dati dello studio), le
risposte ai questionari, le dichiarazioni spuntate sul modulo (servono solo a poter inviare il modulo), cookie per chi
prenota. Il pannello di amministrazione usa un cookie di sessione, firmato, solo per te.

La cancellazione automatica non ha un orologio: avviene "a ogni richiesta" al sito (al massimo una volta al minuto), quindi
funziona anche con poco traffico, ma un sito che nessuno apre per giorni non cancella finché qualcuno non lo apre.

## Il conteggio anonimo d'uso

Approdo è gratuito e, in cambio, conta quanti laboratori lo usano. Il conteggio è **attivo di default**, è descritto qui e nel README, e si
spegne con una riga: `usageCount: false` in `site.config.js`. Spento, l'installazione non invia nulla e non cambia nient'altro.

- **Che cosa parte.** Un solo messaggio, `POST https://approdo-stats.nerln.workers.dev/ping`, con questo corpo e nient'altro:
  `{"id":"<32 caratteri esadecimali>","v":"<versione, per esempio 0.2.0>","sessions":<numero intero>}`. `id` è un identificativo
  casuale (16 byte casuali) che l'installazione crea la prima volta che invia e conserva nella tabella `settings` con la chiave
  `install_id`: non deriva dalla chiave HMAC, dall'indirizzo del sito né dal nome del laboratorio. `v` è la versione di Approdo.
  `sessions` è il numero di prenotazioni segnate come presenti dall'inizio, comprese quelle i cui dati personali sono già stati
  cancellati e che sopravvivono solo nei conteggi per settimana (`tallies`). **Non partono**: indirizzo del sito, nome del laboratorio,
  nomi degli studi, dati di partecipanti, lingua, altri conteggi.
- **Quando.** Al massimo una volta ogni 20 ore, e solo quando il ricercatore apre la pagina principale del pannello (`/admin`, già autenticato) o arriva la
  chiamata firmata dei promemoria del relay. Mai per la richiesta di un partecipante. L'ora dell'ultimo tentativo sta in `settings`
  (`usage_ping_at`) ed è scritta prima di inviare, quindi due richieste insieme non inviano due volte; se l'invio fallisce non si
  riprova prima che siano passate 20 ore. Il messaggio parte in secondo piano, con un limite di 4 secondi, senza seguire reindirizzamenti e senza
  credenziali: la pagina del pannello non aspetta, e un raccoglitore spento o lento non cambia nulla di ciò che vedi. Un'installazione
  ancora con i valori di esempio non invia mai.
- **A chi.** A un piccolo Worker gestito da `nerln`, l'autore di Approdo. Il suo codice è in [`stats-collector/`](../stats-collector/) di
  questo repository. Pubblica su `https://approdo-stats.nerln.workers.dev/stats.json` i totali: installazioni attive negli ultimi 30
  giorni, installazioni viste in tutto (un'installazione è contata dal secondo giorno in cui invia), e la somma delle sessioni.
  **La somma delle sessioni si pubblica solo quando sono attive almeno tre installazioni che inviano da almeno una settimana** (altrimenti il valore è `null`), così il numero di un solo laboratorio non compare mai da solo. Il
  sito del prodotto, <https://nerln.github.io/approdo/>, mostra questi totali ("N laboratori usano Approdo").
- **Un fatto che va detto.** Cloudflare aggiunge un'intestazione `CF-Worker` a ogni richiesta fatta da un Worker, e l'intestazione
  nomina la zona di chi invia (per esempio il sottodominio `workers.dev` della tua installazione). Quel nome arriva quindi al
  raccoglitore insieme al messaggio. Il raccoglitore non lo legge, non lo registra e non lo conserva, e lo stesso vale per
  l'indirizzo IP e per lo user agent: puoi verificarlo nel suo codice.
- **Come spegnerlo.** `usageCount: false` in `site.config.js`, poi pubblica di nuovo. Il pannello (Impostazioni) dice sempre se è
  attivo o spento e quando è stato fatto l'ultimo tentativo di invio. Se la tua istituzione lo vieta, spegnilo prima di pubblicare il sito.

Il conteggio non riguarda i partecipanti: nessuno dei loro dati lo tocca. Se lo lasci attivo, scrivilo al DPO insieme al resto
(vedi "Che cosa dire al DPO").

## Chi tratta i dati

- **Cloudflare**: ospita le pagine e il database (D1). Dove stanno i dati dipende da come hai creato il database: con
  `node scripts/setup.mjs` (o il percorso con un assistente) si crea con giurisdizione UE (`--jurisdiction eu`) e i dati stanno
  nell'Unione Europea; con il pulsante "Deploy to Cloudflare" il database nasce **senza** quell'opzione (Cloudflare lo colloca
  vicino a chi lo usa, di solito in Europa se i visitatori sono europei, ma senza la garanzia). Il testo predefinito
  dell'informativa non promette una sede dei dati: se hai la giurisdizione UE, scrivilo tu in `texts` (vedi [testi.md](testi.md)).
  La giurisdizione si sceglie solo alla creazione: per averla dopo, crea un nuovo database con `--jurisdiction eu` e spostaci i dati.
- **Google**: spedisce le e-mail dall'account Gmail dello studio, solo se il relay è acceso. Le e-mail contengono nome, giorno,
  ora e luogo del turno.
- **Cloudflare Turnstile**, se lo attivi: il controllo anti-bot parla con i server di Cloudflare dal browser di chi prenota.

Sono tre servizi di terzi che l'informativa nomina e che il DPO deve valutare (contratti, trasferimenti, nomina a responsabile
del trattamento dove serve).

## Dati di chi chiede di essere cancellato (o di vedere i suoi)

La persona può **annullare** la prenotazione dal link nell'e-mail, ma annullare non cancella i dati prima del termine. Per
cancellarli subito su richiesta, lo fa chi gestisce il sito, con questi comandi nel terminale della cartella del progetto
(`nome-del-database` è il nome scritto in `wrangler.jsonc`, alla riga `database_name`). Servono l'indirizzo della persona in forma
normalizzata: tutto minuscolo, senza la parte dopo un `+` (`nome+prova@example.org` diventa `nome@example.org`), e, per gli indirizzi Gmail, senza i punti nella
parte prima della chiocciola (`n.ome@gmail.com` e `nome@gmail.com` sono lo stesso indirizzo; `googlemail.com` vale `gmail.com`).

Controlla prima quante righe ci sono (solo il conteggio):

```
npx --yes wrangler@4 d1 execute nome-del-database --remote --yes --command "SELECT count(*) AS prenotazioni FROM bookings WHERE email_key = 'nome@example.org'"
npx --yes wrangler@4 d1 execute nome-del-database --remote --yes --command "SELECT count(*) AS contatti FROM contacts WHERE email_key = 'nome@example.org'"
```

Poi cancella (non si può annullare):

```
npx --yes wrangler@4 d1 execute nome-del-database --remote --yes --command "DELETE FROM bookings WHERE email_key = 'nome@example.org'"
npx --yes wrangler@4 d1 execute nome-del-database --remote --yes --command "DELETE FROM contacts WHERE email_key = 'nome@example.org'"
npx --yes wrangler@4 d1 execute nome-del-database --remote --yes --command "DELETE FROM mail_log WHERE booking_id NOT IN (SELECT id FROM bookings)"
```

La tabella `tallies` (conteggi per studio, settimana e stato) non contiene né nomi né e-mail: non serve cancellare nulla. Una riga di `bookings`
cancellata così, a mano, non entra nei conteggi: se era una partecipazione conclusa e vuoi che conti per l'obiettivo, il suo posto non è più
recuperabile dal sito.

Il terzo comando toglie anche le righe del registro delle e-mail rimaste orfane. Per i **contatti per studi futuri** la persona può
anche uscire da sola dalla pagina "Cancellarsi dagli avvisi" (il collegamento è in fondo a ogni pagina del sito; il testo cambia con la lingua) scrivendo la sua
e-mail.

Chi chiede **copia dei propri dati** riceve quello che le tabelle sopra contengono per il suo indirizzo: lo estrai con un
`SELECT` sul suo `email_key`, oppure dal CSV del pannello filtrando la riga. Le e-mail già spedite restano nelle caselle di chi
le ha ricevute e nell'account Gmail dello studio: se è un problema, cancellale anche da lì.

**Chi usa un assistente IA per gestire il sito non deve fargli leggere questi dati.** Le istruzioni di `AGENTS.md` dicono
all'assistente di non leggere le tabelle delle persone; per cancellare i dati di qualcuno fai tu i comandi qui sopra.

## Il CSV e l'invito per studi futuri

Il CSV delle prenotazioni del pannello contiene alias, e-mail, stato e orari: sono dati personali, e il nome del file lo dice
(`prenotazioni-con-dati-personali-<data>.csv`, `contatti-con-dati-personali-<data>.csv`; in spagnolo `reservas-con-datos-personales-...`).
Il riepilogo (`riepilogo-<data>.csv`) ha solo conteggi per settimana. Scaricalo solo quando serve, tienilo in un posto
protetto della tua istituzione e cancellalo quando hai finito. Il sito non invia i messaggi per gli studi futuri: ti prepara il
testo e i link che si aprono nel tuo programma di posta, con gli indirizzi in copia nascosta e, in fondo, come uscire
dall'elenco. L'invio e il suo contenuto sono sotto la tua responsabilità.

## Che cosa dire al DPO

Un elenco da portare all'incontro: titolare e responsabile indicati (`org`, `responsible`); finalità (gestire la prenotazione, inviare
conferma e promemoria, facoltativamente avvisare di studi futuri); base giuridica (consenso, ritirabile cancellando la prenotazione);
dati e tempi di conservazione (tabella sopra); fornitori (Cloudflare, Google, Turnstile se attivo) e dove stanno i dati;
l'assenza di cookie per i partecipanti; il conteggio anonimo d'uso (che cosa parte, a chi, come si spegne: sezione sopra); l'impronta dell'indirizzo di rete per un'ora; come si esercitano i diritti (si risponde
all'e-mail di conferma o si chiede in laboratorio) e chi cancella. L'informativa del sito è scritta in modo breve e semplice di
proposito: il DPO può chiedere di allungarla o di nominare le norme, e si riscrive da `texts`.
