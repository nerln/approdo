# Aggiornare il sito

Aggiornare vuol dire: prendere il codice nuovo e pubblicare di nuovo. Il database si aggiorna da solo, alla prima visita dopo la
pubblicazione (paragrafo 3: non c'è nessuna migrazione da lanciare). Le tue password (su Cloudflare) e il tuo `site.config.js`
non cambiano.

Se hai un assistente IA, puoi scrivergli: "Leggi AGENTS.md, sezione Updating, e aggiorna il sito". Qui sotto ci sono gli stessi
passi, a mano.

## Che cosa cambia tra una versione e l'altra

- **0.4.0: la pausa giornaliera.** Nel pannello, in Impostazioni, c'è una sezione «Pausa (per esempio il pranzo)»: scrivi «dalle» e
  «alle» e salvi. In quell'intervallo il sito non offre nessun turno, in nessun giorno: né nei giorni già aperti né in «Disponibile
  oggi», che riprende appena la pausa finisce. Le prenotazioni già fatte nella pausa restano com'erano. Per questa novità non c'è
  niente da configurare: parte spenta, e la togli con lo stesso pannello.
- **0.4.0, licenza: la citazione.** La licenza ha una condizione in più rispetto al testo standard: una pubblicazione, una tesi o un
  rapporto su uno studio che ha usato Approdo lo cita, come indicato in `CITATION.cff`.
- **0.3.0: la licenza chiede il credito.** Da questa versione il codice è sotto la Attribution Assurance License (`LICENSE`, sigla AAL,
  approvata dalla Open Source Initiative): i termini della BSD più una condizione, un credito visibile all'autore. Nel sito è la riga
  «Fatto con Approdo di nerln» in fondo alle pagine pubbliche, con il link al sito del prodotto: resta visibile. Puoi cambiarne lo
  stile. `texts.<lingua>.madeWith` e `madeBy` in `site.config.js` non si possono più cambiare. La riga ora nomina anche l'autore. Novità del pannello: ogni studio ha un numero «Partecipanti fatti al di fuori del
  sito», che imposti a mano e si somma all'avanzamento. Per questa novità non c'è niente da configurare.
- **0.2.0: il conteggio anonimo d'uso.** Dopo l'aggiornamento il sito, una volta al giorno, manda all'autore di Approdo un rapporto con un
  identificativo casuale, la versione e il numero di sessioni con presenza (nient'altro). È attivo di default, anche se la tua
  `site.config.js` non ha la chiave `usageCount`. Se non lo vuoi, scrivi `usageCount: false` prima di pubblicare. Dettagli:
  [privacy.md](privacy.md). La riga di credito in fondo alle pagine porta ora al sito del prodotto. `wrangler.jsonc` ha una riga in più,
  `"compatibility_flags": ["global_fetch_strictly_public"]`: senza, Cloudflare rifiuta il rapporto con l'errore 1042. Se la tua
  `wrangler.jsonc` è modificata (nome, `database_id`), tieni le tue modifiche e aggiungi quella riga.

## 1. Prendi il codice nuovo

Se hai clonato il modello da GitHub:

```
git status                      # deve essere pulito, o con solo site.config.js e wrangler.jsonc modificati
git pull
```

Se hai copiato il repository e lo tieni in un tuo repository, aggiungi una volta l'originale come `upstream` e prendi da lì
(`git remote add upstream <indirizzo-del-modello>`, poi `git pull upstream main`). Se Git segnala un conflitto, quasi sempre è in
`site.config.js` (hai cambiato un valore che il modello ha riscritto o commentato in un altro modo): tieni i tuoi valori e le
chiavi nuove del modello. Una chiave nuova ha sempre un valore predefinito, quindi il tuo file continua a funzionare; i commenti
del `site.config.js` nuovo dicono che cosa fa.

## 2. Controlla la tua configurazione

```
node scripts/test.mjs site.config.js --suite test-generic
```

Deve finire con `OK: test-generic against site.config.js`. Se si ferma con un messaggio che inizia con `site.config.js:`, la
versione nuova controlla qualcosa in più: correggi il valore che nomina ([configurazione.md](configurazione.md)). Se un test
fallisce, **non** pubblicare: leggi quale e chiedi.

## 3. Il database si aggiorna da solo

Il sito crea e aggiorna le sue tabelle da solo: alla prima richiesta dopo ogni avvio, `src/migrate.js` (la funzione `ensureSchema`)
legge dalla tabella `settings` la riga `schema_version`. Se il database è vuoto (la creazione automatica di Wrangler avviene
solo mentre pubblichi, per questo le migrazioni "prima della pubblicazione" non potrebbero funzionare su un clone nuovo) esegue tutto lo
schema in un colpo solo; se la versione è più bassa di quella del codice, esegue gli aggiornamenti che mancano; poi non fa più
nessuna domanda finché quell'istanza vive. Le istruzioni sono tutte ripetibili (`CREATE ... IF NOT EXISTS`, `INSERT OR IGNORE`,
`ADD COLUMN` che ignora "la colonna c'è già"), quindi due prime richieste insieme, o due istanze che si incrociano, non fanno danni.
Non devi lanciare niente, né prima né dopo `wrangler deploy`.

**Un database creato prima di questa versione.** I database fatti con le vecchie migrazioni (`0001`...`0005`, con la tabella
`d1_migrations` di Wrangler) non hanno la riga `schema_version`: alla prima visita il sito la aggiunge, crea le tabelle che mancano
(`mail_log`, `contacts`), aggiunge le colonne `lang` e `verified_at` di `bookings` se non ci sono (e segna come verificate le
prenotazioni confermate prima che la colonna esistesse, come faceva la vecchia `0005`) e non tocca nient'altro. La tabella
`d1_migrations` resta lì, inutilizzata: puoi ignorarla.

### Per chi cambia lo schema (sviluppatori e assistenti)

Un cambiamento allo schema si fa in quattro mosse, tutte nello stesso commit:

1. Modifica `schema.sql` in modo che descriva il database **nuovo** (per esempio la colonna nuova dentro il `CREATE TABLE`) e porta
   la riga finale `INSERT OR IGNORE INTO settings ... ('schema_version', 'N')` al numero nuovo.
2. `npm run build:schema` rigenera `src/schema.js` da `schema.sql` (un test fallisce se i due file non coincidono).
3. In `src/migrate.js` aggiungi alla lista `UPGRADES` un passo `{ version: N, run: async (db) => { ... } }` che porta un database
   della versione precedente a quella nuova. Deve essere **idempotente**: per una colonna nuova usa `await addColumn(db, "bookings",
   "colonna", "TEXT")`, che esegue `ALTER TABLE ... ADD COLUMN` e ignora l'errore "duplicate column name"; per una tabella nuova
   basta il suo `CREATE TABLE IF NOT EXISTS`. Non togliere mai colonne o tabelle: il codice precedente deve poter girare su un
   database già aggiornato (è ciò che rende possibile il rollback).
4. Scrivi il test: crea un database della versione precedente (vedi `test-generic/release.test.mjs`, "an old database ... is upgraded"),
   fai girare `ensureSchema` e controlla che la forma finale sia uguale a quella di `schema.sql`.

La versione di un database è la riga `schema_version` della tabella `settings`; la versione del codice è l'ultimo numero di `UPGRADES`.

## 4. Pubblica

Se hai usato il pulsante "Deploy to Cloudflare": basta `git push` (o salvare il file dal sito di GitHub): Cloudflare compila e
pubblica da solo. Altrimenti, dal terminale:

```
npm run deploy        # è soltanto: wrangler deploy
```

Se usi il flusso facoltativo su GitHub (`.github/workflows/deploy.yml`), lo avvii da Actions, Deploy, Run workflow.

## 5. Controlla

- Apri il sito e il pannello `/admin`.
- Nelle Impostazioni, la lista "Messa in funzione" deve dire "Fatto" dappertutto. Le righe delle parti facoltative (relay di posta, promemoria, Turnstile) restano "Da fare" se non le hai attivate, e quella sulla privacy resta "Da fare" finché non hai fatto rivedere il testo e scritto `privacyReviewed: true`.
- Fai una prenotazione di prova con il tuo indirizzo e annullala.

## Se qualcosa è andato storto

Cloudflare conserva le pubblicazioni precedenti: nella dashboard, Workers & Pages, il tuo Worker, Deployments (o Versions), puoi riportare
in produzione una versione precedente (Rollback). Il database però non torna indietro da solo: per questo gli aggiornamenti del
modello sono pensati per aggiungere colonne e tabelle senza togliere niente, e il codice precedente continua a funzionare con un
database che ha qualcosa in più.
