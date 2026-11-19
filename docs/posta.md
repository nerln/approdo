# La posta: il relay su Google Apps Script, passo per passo

Il sito non spedisce le e-mail da solo. Le affida a un piccolo programma che gira nel tuo account Google (Apps Script,
gratuito): il sito gli manda il messaggio firmato con una chiave segreta, il programma lo spedisce con Gmail. Lo stesso programma
chiama una volta al giorno il sito per far partire i promemoria del giorno dopo, perché il sito, un Worker di Cloudflare, risponde solo alle richieste e non ha un orologio suo (qui il relay fa da sveglia).

Ti servono, nell'ordine: un account Google, una chiave casuale, il file `apps-script/Code.gs`, l'indirizzo del sito già
pubblicato (README, "In 4 passi") e un terminale nella cartella del progetto.

Senza relay il sito funziona lo stesso, ma conferma ogni prenotazione subito e **non invia nessuna e-mail** (né ai partecipanti
né a te): va bene per provare, non per uno studio vero. Un banner nel pannello lo ricorda finché non è acceso. Con il relay spento le pagine pubbliche non mandano a cercare un'e-mail: dicono di conservare il link della pagina e di chiedere di persona. Se hai riscritto le condizioni o l'informativa con `texts` (`terms`, `privacy`), quelle frasi sono tue: controllale.

I nomi dei pulsanti di Google qui sotto sono quelli dell'interfaccia in italiano e possono cambiare un po' nel tempo; tra
parentesi, quando serve, c'è il nome inglese.

## 0. Quale account Google usare

Usa l'account Gmail dello studio, non quello personale. Da quell'account partono i messaggi (il mittente è lui, col nome che
scegli) e lì arrivano le risposte, se non imposti `REPLY_TO` (punto 3). Un account Gmail normale spedisce circa 100 e-mail al
giorno; un account Google Workspace universitario ne ha di più, ma il sito resta calibrato su 100 (si ferma a 80 e-mail in 24 ore).
Se l'università lo permette, un account dedicato con una casella condivisa è la scelta più comoda.

## 1. Crea la chiave

Nel terminale, nella cartella del progetto:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Stampa una riga di 64 caratteri (lettere da `a` a `f` e cifre). **Questa è la chiave del relay.** Il comando è solo un modo per farla: va bene qualunque stringa casuale di almeno 32 caratteri, per esempio una generata dal tuo gestore di password. Copiala: servirà due volte,
in Apps Script e su Cloudflare. Non scriverla in nessun file e non mandarla a nessuno (nemmeno all'assistente IA, se ti sta
aiutando: la incolli tu).

## 2. Crea il progetto Apps Script

1. Apri https://script.google.com con l'account scelto.
2. Premi **Nuovo progetto** (New project). Si apre un editor con un file `Codice.gs` che contiene una funzione vuota.
3. Seleziona tutto il contenuto di quel file, cancellalo e incolla l'intero contenuto di `apps-script/Code.gs` del progetto.
   Dai un nome al progetto in alto (per esempio "Relay studio").
4. Premi l'icona del dischetto **Salva progetto** (Save project).

I nomi di alcune funzioni (per esempio `recordatorios`) sono in spagnolo: è normale, il codice non cambia.

## 3. Le proprietà dello script

Nella colonna di sinistra premi l'icona a forma di ingranaggio **Impostazioni progetto** (Project Settings), scorri fino a
**Proprietà script** (Script Properties), premi **Aggiungi proprietà script** e inserisci queste, una per riga (nome a sinistra,
valore a destra), poi **Salva proprietà script**:

| Nome | Valore | Obbligatoria |
|---|---|---|
| `RELAY_KEY` | la chiave del punto 1 | sì |
| `SITE_URL` | l'indirizzo pubblico del sito, senza `/` finale (quello con cui apri il sito; se hai scritto `baseUrl` in `site.config.js`, lo stesso). Senza `baseUrl`, i link dei promemoria usano questo indirizzo | sì (per i promemoria) |
| `TIMEZONE` | il `timeZone` di `site.config.js`, per esempio `Europe/Rome` | consigliata (altrimenti vale il fuso del progetto) |
| `SENDER_NAME` | il nome che i destinatari vedono come mittente: di solito il `brand` | consigliata |
| `REPLY_TO` | l'indirizzo cui devono arrivare le risposte: di solito il `contactEmail` | consigliata |
| `REMINDER_HOUR` | l'ora (da 0 a 23) in cui partono i promemoria del giorno dopo | no (10) |

## 4. Pubblica il programma come app web

1. In alto a destra premi **Esegui il deployment** (Deploy), poi **Nuova implementazione** (New deployment).
2. Accanto a "Seleziona il tipo" premi l'ingranaggio e scegli **App web** (Web app).
3. Descrizione a piacere ("v1").
4. **Esegui come** (Execute as): **Me**, cioè il tuo account.
5. **Chi ha accesso** (Who has access): **Chiunque** (Anyone). Non è un rischio: chi non conosce la chiave non può far spedire
   nulla (ogni richiesta è firmata e scade dopo 5 minuti).
6. Premi **Esegui il deployment**.
7. Google chiede di **Autorizzare l'accesso**. Scegli l'account. Compare "Google non ha verificato questa app": è normale, è il
   tuo programma. Premi **Avanzate** (Advanced), poi **Vai a Nome del progetto (non sicuro)**, e **Consenti** (Allow). I
   permessi chiesti sono: inviare e-mail a tuo nome e collegarsi a un servizio esterno (quest'ultimo serve a chiamare il sito
   per i promemoria).
8. Compare l'**URL dell'app web**, che finisce con `/exec`. Copialo. Se lo perdi: Esegui il deployment, Gestisci implementazioni.

Se invece di `/exec` finisce con `/dev`, hai copiato l'indirizzo di prova: serve quello della **implementazione**.

## 5. Dai al sito la chiave e l'indirizzo

Due modi, a scelta.

**Dalla dashboard di Cloudflare** (senza terminale): Workers & Pages, apri `approdo` (o il nome che hai scelto), Settings,
Variables and Secrets. Modifica `MAIL_RELAY_KEY` e `MAIL_RELAY_URL` (se sono lì con il valore di esempio, `change-me...`:
sostituiscilo; se non ci sono, Add, tipo Secret).

**Dal terminale**, nella cartella del progetto, un comando alla volta. Ognuno ti chiede il valore e non lo mostra mentre lo scrivi:

```
npx wrangler secret put MAIL_RELAY_KEY
npx wrangler secret put MAIL_RELAY_URL
```

Il primo vuole la **stessa chiave** del punto 1; il secondo l'indirizzo `/exec` del punto 4. Una password vale subito, senza
pubblicare di nuovo. Un valore che resta quello di esempio (`change-me...`) conta come non impostato: il sito resta senza e-mail.

Non serve scrivere l'indirizzo del sito in `site.config.js`: i link delle e-mail partono dall'indirizzo con cui il sito è stato
visitato (nell'e-mail di conferma, quello della prenotazione). Se hai un dominio tuo e vuoi fissarlo, scrivilo in `baseUrl`.

Facoltativo: se vuoi che gli avvisi "qualcuno ha prenotato" arrivino a un indirizzo diverso da `contactEmail`, imposta allo stesso
modo `ADMIN_EMAIL`.

## 6. Installa i promemoria

Torna nell'editor di Apps Script. Nella barra in alto scegli dal menù delle funzioni **`installReminder`** e premi **Esegui**
(Run), una volta sola. Fa tre cose: toglie eventuali attivatori vecchi di questo programma, ne crea uno che ogni giorno, all'ora
`REMINDER_HOUR` e nel fuso `TIMEZONE`, chiama il sito; e lo chiama subito una volta per prova. Premi **Registro
dell'esecuzione** (Execution log): deve comparire una riga come

```
200 {"ok":true,"sent":0,"failed":0}
```

(`sent` è il numero di promemoria partiti: 0 se domani non hai prenotazioni.) Per controllare che l'attivatore esista: l'icona a
forma di sveglia **Attivatori** (Triggers) nella colonna di sinistra deve elencare la funzione `recordatorios`, "basato sul
tempo", "timer giornaliero".

## 7. Prova

1. Apri `https://<il-tuo-sito>/admin`, entra, e in **Impostazioni** premi **Invia e-mail di prova**: arriva a `ADMIN_EMAIL` se l'hai impostata, altrimenti a `contactEmail`.
2. Nella lista **Messa in funzione** (Impostazioni) ogni riga deve dire "Fatto": password, relay, promemoria.
3. Apri un giorno nel pannello, prenota un turno dal sito con il tuo indirizzo, conferma dal pulsante dell'e-mail, controlla la
   e-mail di conferma e annulla con il link.

## Se non funziona

Nel pannello del giorno, sotto ogni prenotazione, la riga "E-mail:" dice cosa è partito e cosa no, con l'errore. Dopo un errore
al momento di prenotare, l'ultimo errore resta nella lista "Messa in funzione".

| Errore | Significato e rimedio |
|---|---|
| `bad signature` | La chiave in Apps Script (`RELAY_KEY`) e quella su Cloudflare (`MAIL_RELAY_KEY`) non sono uguali, o c'è uno spazio in più. Reimposta tutte e due con la stessa chiave |
| `no key` | Manca la proprietà `RELAY_KEY` in Apps Script |
| `stale` | L'orologio del sito e quello di Google differiscono di più di 5 minuti: riprova; se si ripete, segnalalo |
| `quota` | Il limite giornaliero dell'account Google è esaurito (circa 100 e-mail per Gmail). Riparte il giorno dopo |
| `bad recipient` | L'indirizzo del destinatario non è valido |
| `http 401`, `http 403`, `http 404` o `http 302`, `network` | Il sito non raggiunge il programma: l'URL in `MAIL_RELAY_URL` non è quello `/exec`, o l'implementazione non è "Esegui come: Me, Chi ha accesso: Chiunque", o non l'hai autorizzata. Rifai il punto 4 e aggiorna `MAIL_RELAY_URL` |
| Nel registro di `installReminder`: `Missing script property SITE_URL` | Manca la proprietà `SITE_URL` |
| Lo stesso registro dice `403` o `bad signature` | `RELAY_KEY` e `MAIL_RELAY_KEY` sono diverse (vedi sopra) |
| Lo stesso registro dice `503` e `no relay` | Il sito non ha ancora `MAIL_RELAY_KEY` e `MAIL_RELAY_URL` pubblicate: punto 5 (vale subito, senza ripubblicare) |
| Le e-mail partono ma non arrivano | Cartella della posta indesiderata; poi, se l'indirizzo è universitario, `noLinkDomains` (sotto) |
| Ho cambiato `Code.gs` ma non cambia niente | Un'implementazione resta ferma alla versione in cui l'hai creata: Esegui il deployment, **Gestisci implementazioni**, la matita, **Versione: Nuova versione**, Esegui il deployment. L'URL non cambia |

### Le e-mail non arrivano agli indirizzi universitari

Alcuni sistemi di posta universitari scartano in silenzio, senza nemmeno la cartella della posta indesiderata, i messaggi che
contengono link. Se i tuoi partecipanti hanno indirizzi in un dominio così, aggiungi il dominio in `site.config.js`:

```js
noLinkDomains: ["example.edu"],
```

e pubblica di nuovo. Chi ha un indirizzo in quel dominio (o in un suo sottodominio) riceve e-mail con un codice di sei cifre al
posto dei link: lo scrive nella pagina "Gestisci la mia prenotazione" del sito per confermare o annullare. Gli altri
continuano a ricevere i pulsanti.

### Cambiare account o ricominciare

Per usare un altro account Google: ripeti dal punto 1 con un nuovo progetto (nuova chiave, nuovo indirizzo `/exec`), aggiorna
`MAIL_RELAY_KEY` e `MAIL_RELAY_URL` e pubblica di nuovo il sito. Nel vecchio progetto Apps Script elimina l'attivatore (o il
progetto), altrimenti continua a chiamare il sito ogni giorno con una chiave ormai sbagliata.
