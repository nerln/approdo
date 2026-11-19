# Relay di posta (Google Apps Script)

`Code.gs` è il programma che spedisce le e-mail del sito dall'account Gmail dello studio e, una volta al giorno, chiama il sito
per far partire i promemoria del giorno dopo. Il sito gli manda ogni messaggio firmato con una chiave segreta (HMAC-SHA256), e
il programma rifiuta quello che non è firmato o è più vecchio di cinque minuti.

La procedura completa, schermata per schermata, è in [../docs/posta.md](../docs/posta.md). In breve:

1. Crea la chiave: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. script.google.com, Nuovo progetto, incolla `Code.gs`, salva.
3. Impostazioni progetto, Proprietà script: `RELAY_KEY` (la chiave), `SITE_URL` (l'indirizzo del sito, senza `/` finale), e consigliate
   `TIMEZONE` (il `timeZone`), `SENDER_NAME` (il `brand`), `REPLY_TO` (il `contactEmail`); facoltativa `REMINDER_HOUR` (0-23, 10).
4. Esegui il deployment, Nuova implementazione, App web: esegui come **Me**, accesso **Chiunque**. Copia l'URL che finisce con `/exec`.
5. Su Cloudflare (Workers & Pages, il tuo sito, Settings, Variables and Secrets) oppure nel terminale con
   `npx wrangler secret put MAIL_RELAY_KEY` (la stessa chiave) e `npx wrangler secret put MAIL_RELAY_URL` (l'URL `/exec`).
   Valgono subito.
6. In Apps Script, esegui una volta la funzione `installReminder`: installa il promemoria giornaliero.

Il file contiene solo funzioni: nessun segreto. La chiave sta nelle proprietà dello script e su Cloudflare, mai in un file.
Limite di Google: circa 100 e-mail al giorno per un account Gmail normale.
