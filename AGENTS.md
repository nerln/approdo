# AGENTS.md: deploying an Approdo site, for an AI coding agent

You are an AI coding agent with a terminal in a clone of this repository, and a human (a researcher, usually not a web
developer) is next to you. Your job: take the site from a fresh clone to a working, tested, live booking site on
Cloudflare Workers, optionally with confirmation e-mails sent through a Google Apps Script relay. Follow the steps in order.
Every step says how to check whether it is already done, so you can run the whole procedure again after an interruption.

What the site is: a booking site for university user studies (people choose a slot for a lab session; the researcher
manages days, slots and attendance in an admin panel at `/admin`). A Cloudflare Worker with static assets (`wrangler.jsonc`:
`src/index.js` answers every request, `public/` is served through the `ASSETS` binding), a D1 database (the Worker creates and upgrades its own tables on the first request: `src/migrate.js`, nothing to apply),
server-rendered HTML with a strict Content-Security-Policy (no inline styles, no inline scripts), e-mail through a Google Apps
Script web app (optional). Everything specific to the lab is in `site.config.js`. The README (English; `README.it.md` in
Italian) is the human's manual; this file is yours.

## Which path? (read this first)

**The fast path is the button, and the human does it alone.** The README starts with a "Deploy to Cloudflare" button: it copies the
repository into the human's GitHub account, creates the D1 database, asks for the secrets of `.dev.vars.example`, builds
(`npm run deploy`, which is just `wrangler deploy`) and deploys, and redeploys on every push. Then the human edits `site.config.js` in the GitHub web editor. If that
is what he wants, you are not needed for the deployment: at most you help him read `site.config.js` or check the result with
**Acceptance checklist A** at the end of this file.

**Use the agent path (this file, steps 1 to 17) when:**

- he has **no GitHub account** (or does not want one): the agent path deploys from this folder with `wrangler` and needs no GitHub at all;
- his institution needs the **EU jurisdiction** for the database: the button creates the database without it, the agent path creates it
  with `wrangler d1 create <db> --jurisdiction eu` (the option exists in `wrangler d1 create --help`; it can only be chosen at creation);
- he wants you to edit `site.config.js` with him, rewrite the study texts, or run the tests first;
- the button failed or he wants a custom domain set up with you at his side.

Ask which situation he is in before starting. When you finish the agent path, run **Acceptance checklist B**.

## Hard rules

1. **Secrets never pass through you.** The secrets are `ADMIN_PASSWORD`, `MAIL_RELAY_KEY`, `MAIL_RELAY_URL`,
   `TURNSTILE_SECRET` (and the sitekey). Never ask the human to paste one into the chat, never echo one, never write one in
   a file, a commit, a log or a command line you run. The human types each one into the hidden prompt of
   `wrangler secret put` in his own terminal (in Claude Code he can type the command after `!`; otherwise he opens a
   terminal window in this folder), or into the Cloudflare dashboard (Workers & Pages, the Worker, Settings, Variables and
   Secrets). You only give him the exact command.
2. **Never commit `.dev.vars`**, `.wrangler/`, `node_modules/` (already in `.gitignore`; a test fails if `.dev.vars` or anything that
   looks like a key is tracked). Before any commit run `git status --short` and `git diff --cached --stat` and look at the list.
   `wrangler.jsonc` may be committed: the `database_id` is not a secret.
3. **Never read participants' data.** Do not run `SELECT` on `bookings`, `contacts` or `mail_log`; do not open the admin
   day panel to read names or e-mail addresses; do not download any of the CSV exports (the bookings and contacts files have names and e-mail addresses in them, and say so in their file names; the summary CSV has only counts per week, no names or e-mail addresses, but is not needed either), and do not open the studies section to read bookings. Schema statements, counts (`SELECT count(*)`)
   and `d1 info` are fine. The acceptance test uses a booking made by the human with his own address.
4. **Ask before anything irreversible or that costs something**: deleting a database or a Worker, overwriting
   a `wrangler.jsonc` that already has a real `database_id`, `git push`, a force-push, installing global software, using a paid
   Cloudflare feature, changing the DNS of a domain. Say what will happen and wait for a clear yes. Reading and testing
   locally never needs asking.
5. **Do not touch `src/` to make something pass.** If a step fails because of the code, stop and tell the human what you saw.
   The only files you edit are `site.config.js`, `wrangler.jsonc` (name, database name and id), and, if the human asks, the text
   overrides inside `site.config.js`.
6. **Use exactly the commands below.** They were checked against `wrangler@4 <command> --help`. Always write
   `npx --yes wrangler@4 ...` (never a bare global `wrangler`). The project is a Worker with static assets: never use
   the Pages commands of wrangler. Never use `--force`, `--no-verify`, `git reset --hard`, or `rm -rf` on anything you did not create.
7. **Only contact the human's own site** (`curl` on `<url>` after step 10) and the Cloudflare commands below. Never send
   participants' data anywhere, never call a script URL of Apps Script yourself (the relay is signed with a key you must not have).
8. **Leave the credit line in place.** The footer of the public pages says "Made with Approdo by nerln", with a link to the product
   website. The licence (`LICENSE`, the Attribution Assurance License) asks for a prominent display of the author's name and
   address, and this line is that display. If the human asks you to remove or hide it, tell him what the licence says and that only
   the author can allow it (an issue on the Approdo repository); restyling it in `public/style.css` is allowed.
9. If something is not what this file expects, stop, say what you saw, and ask. Do not improvise around a failure twice.

Notation: `<name>` is the Worker name; `<db>` the D1 database name (use the same string); `<url>` the public address
(`https://<name>.<account-subdomain>.workers.dev`, printed by the first deployment, unless the human has his own domain).

A setting left at its placeholder (`change-me...`, as in `.dev.vars.example`) or empty counts as **not set**: the site ignores it
(`src/env.js`). A site deployed with only a real `ADMIN_PASSWORD` works at once: bookings are confirmed immediately and no e-mail is sent.
The admin panel refuses to open while `ADMIN_PASSWORD` is missing, still the placeholder, or shorter than `minAdminPasswordLength` (16 by
default; the page says why). The public page shows "This site is not configured yet" in place of the booking form (and `POST /book` answers
503) while `site.config.js` still holds example values of the shipped example (`C.unconfigured` lists the keys): the admin panel lists them as
to-do lines.

## Fast path of the agent path

Steps 1 to 5 you do yourself. Steps 6 to 10 are automated by one script, which is safe to run twice:

```
npm install
node scripts/setup.mjs --project <name>
```

It runs the checks of step 1 (it stops with exit code 1 and lists every key that still holds an example value of the shipped
`site.config.js`, the same list the site uses to decide it is "not configured yet"; and it prints a warning while `privacyReviewed` is
false), the generic tests on the human's config, the login, creates the database **with `--jurisdiction eu`** and writes
`wrangler.jsonc`, deploys the Worker (`wrangler deploy`; there is no migration step: the Worker creates its tables itself on the first
request), and prints the exact secret commands. If you use it, skip to
step 11. `node scripts/setup.mjs --dry-run --project <name>` prints every command without running it. The manual commands for steps 6
to 10 follow, for when the script stops or you want to see each command.

---

## Step 1. Prerequisites

```
node -v
npm -v
git --version
npx --yes wrangler@4 --version
git status --short
```

Expected: Node `v22.x` or newer (wrangler 4 requires Node 22; the tests use `node:sqlite`, also Node 22), an npm version, a
git version, a wrangler version such as `4.125.0` (any `4.x`), and an empty or harmless `git status`.

If `git status` says `fatal: not a git repository` the folder was downloaded as an archive instead of cloned. Nothing in the
deployment needs git (wrangler, the tests and `scripts/setup.mjs` run without it): skip every git command in this file, and
in step 4 offer to start a repository (`git init -b main`) if the human wants to keep the code. Do not run `git init` unasked,
and never inside a folder that is part of a larger repository (check with `git rev-parse --show-toplevel` from a parent).

If Node is older: tell the human to install Node 22 LTS from https://nodejs.org (or with his version manager) and open a new
terminal. Do not install it system-wide yourself. If `npx` cannot download wrangler, check the Internet connection and any
proxy before anything else.

`npm install` (or `npm ci`) installs Wrangler locally (and `qrcode`, needed only for `npm run qr`). The commands below use
`npx --yes wrangler@4`, which works with or without it.

## Step 2. Ask the human, then edit `site.config.js`

`site.config.js` is the ONLY file with the lab's details. It starts as a copy of `config/example-lab.config.js` (a fictional lab) and is
full of invented example values (`Lab Esempio`, `Università di Esempio`, `Dipartimento di Esempio`, `Example University`, `Nome Cognome`,
`studio@example.org`, `Via Esempio`, `Example Street`...); `src/placeholders.js` is the one list of them. **Ask the human for every value; do not invent, guess or keep any of them**, and do not
fill a value from what you know about the person or his institution. Read the file, then ask these questions (one message,
wait for the answers) and write the answers in:

| Ask | Key |
|---|---|
| Short name of the study site for the header (e.g. "Reading Lab") | `brand` |
| Research group, university, department/school, and the line that signs every e-mail | `org.group`, `org.university`, `org.unit`, `org.signature` (each a text, or an object with one text per language) |
| Name of the person responsible for the data (shown in the privacy text) | `responsible` |
| E-mail where participants' replies and "someone booked" notices go (a lab address, not personal if possible; it is visible in the repository if the repository is public) | `contactEmail` |
| Time zone | `timeZone` (IANA, e.g. `Europe/Rome`) |
| Languages offered, the first is the default | `languages` (any of `"es"`, `"en"`, `"it"`) |
| Language of the admin panel | `adminLanguage` (`"es"` or `"it"`) |
| How long the session lasts as told to the participant, and how much calendar time one booking takes (session plus buffer) | `sessionMinutes`, `slotMinutes` (>= `sessionMinutes`, at most 720) |
| **The start times of a normal day: ask for the exact times, and write only those** | `defaultTimes` (HH:MM, any minutes, at least `slotMinutes` apart, last one ends before midnight) |
| Minimum notice before a slot can be booked, in hours; and the notice (minutes) when he waives it for a day or opens "available today" | `minNoticeHours` (default 12), `shortNoticeMinutes` (default 20) |
| Where the lab is: full address, short label, how running text calls it, in each language | `place.long`, `place.short`, `place.room` |
| **The anonymous usage count: tell him what it is first (the paragraph below), then ask whether to keep it on** | `usageCount` (`true`, the default, or `false`) |
| What does he call the study in one phrase (it reads after "a / un / uno")? | `studyName` (per language, e.g. `{ it: "studio sulla lettura", en: "reading study" }`; default "studio di ricerca" / "research study" / "estudio de investigación") |
| Does the site present two studies one after the other, or one? | `twoStudies` (default `true`, shipped example `false`; `false` hides the "two studies" card and the active-study switch) |
| Which health declarations does the booking form ask? | `declarations.epilepsy` (default `true`, shipped example `false`), `declarations.vestibular` (`"study2"` default, `"always"`, `"never"`; shipped example `"never"`) |
| A photo on the landing page? (rare) | `hero.image` (`null` = no photo, the default of the shipped example: the page shows the line drawing set by `hero.art`) |
| University mail domains that drop messages with links (see README, "If something is wrong") | `noLinkDomains` (default `[]`) |
| How long booking data is kept after the session | `bookingRetentionDays` (default 30) |
| Public address: **do not ask, do not write it**. `baseUrl` is optional: without it every link is built from the address the visitor used. Only if the lab has its own domain and wants fixed links: `baseUrl` (or the `BASE_URL` secret) | `baseUrl` (usually absent) |

**Tell the human about the anonymous usage count before you ask, in your own words and without softening it.** Approdo is free; in
return it counts how many labs use it. Once a day, when the researcher opens the admin panel (or when the daily reminder call
arrives), the installation sends the author of Approdo one report with three values: a random identifier that the installation
makes for itself, the version of Approdo, and the number of sessions marked as attended. It sends no site address, no lab name, no
study name, no participant data and no language. The product website shows the totals, and the total of sessions only while at
least three installations that have reported for a week or more are active. Say also that Cloudflare adds a `CF-Worker` header, naming the sender's zone (for example the
`workers.dev` subdomain), to every request a Worker makes, and that the collector's code (`stats-collector/`) never reads, logs or
stores it, nor the IP address, nor the user agent. It is on by default and the human decides: if he wants it off, write
`usageCount: false` in `site.config.js`; if he keeps it, leave the key as it is. Write down his answer in your report. Never switch it
off or on without asking. It changes nothing else about the site, and the admin panel (Settings) always shows its state.

Do not write `privacyReviewed: true` yourself: only the human can say that his institution's data protection office reviewed
the privacy text. While it is `false` the admin panel shows a to-do line and the setup script prints a warning; that is correct.

Worked example of the point most people get wrong: a 50-minute session with a 10-minute break between participants, starting
at 10:00, 11:00 and 12:00, means `sessionMinutes: 50`, `slotMinutes: 60`, `defaultTimes: ["10:00", "11:00", "12:00"]`: exactly the three start
times he stated, not a longer list that happens to contain them. A 45-minute session back to back every 45 minutes:
`sessionMinutes: 45`, `slotMinutes: 45`, `defaultTimes` the start times he lists.

**Read `defaultTimes` back and show it to him** (the file may have kept the shipped list if an edit failed):

```
node -e "import('./src/config.js').then(m => console.log(JSON.stringify(m.C.defaultTimes)))"
```

Expected: exactly the times he stated, sorted, for example `["10:00","11:00","12:00"]`. If it differs, fix the file and read it again.

**Check that no placeholder is left, and do not continue while this fails:**

```
node scripts/setup.mjs --dry-run --no-tests --project <name>
echo "exit status $?"
```

Expected: exit status `0` and no line starting `STOP`. A `STOP: site.config.js still contains placeholders` lists each key and
its value (the same keys that make the live site say "This site is not configured yet"): ask the human for that value, write it in and
run the check again. (`--dry-run` runs nothing and changes nothing; the
`<name>` is only used in the printed commands. Never add `--allow-placeholders` for a real site.)

Also ask: **do the built-in public texts fit his study?** The shipped texts (study description, the terms and the privacy policy) are
generic: they speak of "a research study" (his `studyName`) and an individual session in the lab, with no requirement and no health
declaration. The human must rewrite what does not describe his study, in `texts` (the format is in the comments of `site.config.js`;
the keys are in `src/i18n.js`). A configuration with a photo, two studies and health declarations can be switched on with the commented block near the end of `config/example-lab.config.js`. Do the rewriting with him, sentence by sentence; never invent legal text. `docs/testi.md` lists which keys describe the study
and gives a block to copy. Tell him the privacy text must be checked by his data protection office before the site goes public.

Check the file loads:

```
node -e "import('./src/config.js').then(m => console.log('config ok:', m.C.brand, m.C.languages.join(','), m.C.sessionMinutes + '/' + m.C.slotMinutes))"
```

Expected: one line `config ok: <brand> <languages> <session>/<slot>`. A wrong value stops with
`Error: site.config.js: <key> ...`: fix that key and run again. Do not weaken the validation in `src/config.js`.

Look at the site without Cloudflare (the simplest way: an in-memory database, no e-mail, nothing online):

```
node scripts/preview.mjs
```

(`node scripts/preview.mjs --now 2026-11-16T10:00:00+01:00` runs it with a FIXED clock, an ISO instant with its offset: the days that open, the
slots offered, the attendance buttons, the purge of old bookings and the weekly summary all follow that time, so they can be tried without waiting.)

Expected, in English, at start-up:

```
Preview running at http://localhost:8799
Admin panel:       http://localhost:8799/admin
Admin password:    <a random password, new at every start>
In-memory database, no e-mail is sent. Stop with Ctrl+C.
```

The password is random at every start and is for this throwaway preview only (it protects an in-memory database), so it is fine to show it
to the human. While `site.config.js` still has example values the preview, like the live site, shows "This site is not configured yet"
instead of the booking form.
He opens the address, reads the landing page, the booking form, the terms and the privacy page (`/terms`, `/privacy`; in Spanish
`/condiciones`, `/privacidad`) in every language and says what to change. Repeat the edits until he is happy. Start it in the
background (your tool's background mode) and note the process id of what YOU started; stop it afterwards with that id (with Ctrl+C
if it runs in his terminal), never by looking up a port. Port busy? `node scripts/preview.mjs <another port>`.

### Optional: run the real Cloudflare runtime locally

Only when the human wants to see the site on the same runtime as the live one (a local D1 database, no network, no login). It writes
`.dev.vars` and `.wrangler/`, both ignored by git. Skip the `.dev.vars` command if the file already exists (it may hold the human's own values).

```
npm install
node -e "require('fs').writeFileSync('.dev.vars', 'ADMIN_PASSWORD=' + require('crypto').randomBytes(12).toString('hex') + '\n', { flag: 'wx' })"
node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
npm run dev -- --port <port>
```

1. `npm install` fetches Wrangler (the one command here that uses the network).
2. The second command writes a random throwaway admin password (24 characters, so it passes the 16-character minimum) into `.dev.vars`
   without printing it (the human can read it in that file). The `wx` flag makes it fail instead of overwriting an existing file.
3. The third command prints a free port: **you choose the port, never assume 8787** (another session or project may be using it).
4. `npm run dev -- --port <port>` runs `wrangler dev` (there is no database step: the local database starts empty and the site creates its
   tables on the first request). Start it with your tool's background mode and keep the process id of the process YOU started. Read the
   address from wrangler's own output (`Ready on http://localhost:<port>`, and a table listing `env.DB ... D1 Database local`); use the
   address it prints, not the one you expected.
5. Verify: `curl -s -o /dev/null -w "%{http_code}\n" <address>/` prints `200` on the very first request (that request created the tables),
   `<address>/admin` prints `200` (the login page) and `<address>/nothing-here` prints `404`. While `site.config.js` has example values the
   home page shows "This site is not configured yet" and a booking answers `503`; with the human's own values the page shows the booking
   card (no day is open yet, so it says there are no free slots), and after he opens a day in `/admin` a booking works.
6. Stop it by the process id you started (`kill <pid>`; if a `workerd` child outlives it, `pkill -P <pid>` before killing the parent),
   or Ctrl+C in his terminal. **Never stop it by port** (`kill $(lsof -ti tcp:<port>)` can kill someone else's process). Nothing was sent
   to Cloudflare.

## Studies managed from the panel (what to tell the human, nothing to configure)

`site.config.js` defines the studies the site starts with (`twoStudies`, `declarations`, `texts`). Once the researcher saves a study in the
admin panel (section "Studies": texts per language, declarations, participant target, participants done outside the site, make active, archive, new study; `docs/studi.md`,
in Italian), the `studies` table becomes the source and those three keys no longer change the saved studies. Until then nothing differs from a
site without the feature (the table is empty, and every page and e-mail comes from the configuration). Do not write to the `studies` or `tallies` tables
yourself, and do not copy texts into them: the panel's first save seeds the studies from the configuration with EMPTY texts (a study row stores
only what differs from the built-in or configured text, so a save that changes nothing changes nothing). The optional key `outside` of a study (participants done outside the site, 0 to 9999, written only when above 0) adds to the done count of the progress but never to the usage report, and every rewrite of a study carries it through `dataOf`. Old bookings are counted into `tallies`
(per ISO week, no names or e-mail addresses, though somebody who knows who came in a given week could still connect a count to a person; never
purged) before the purge deletes them. Every write of a study is a compare-and-swap on its stored JSON, and a refused save answers with the same form filled with what was typed. The panel has five sections chosen with `?s=` (`agenda`, `studies`,
`contacts`, `data`, `settings`; `s=all` shows every section on one page). The same panel also offers a daily break (Settings, the "Pausa" form, for a lunch hour): tell him it exists and nothing needs configuring; it hides the slots that overlap it on every day and in "available today", and never touches existing bookings.

### The informed-consent sheet (what to tell the human, nothing to configure)

Each study also holds a consent sheet per configured language (panel: Studies, then "Informed consent form"; `docs/consenso.md`, in
Italian). The researcher fills plain-text fields (empty = built-in default from `src/consent.js`, which takes the lab name, place, session
length and retention periods from `site.config.js` and leaves bracketed phrases for what only the lab knows) and prints
`/admin/consent?study=<id>&lang=<lang>` (session required, A4, black on white, no script) with the browser's print command. The stored
JSON of a study gets a `consent` key only after a consent form that differs from the defaults is saved. Tell the human the sheet is a
starting point that his ethics committee or data protection office must review, and that every bracketed phrase must be replaced before
printing. Never write the text for him and never mark it as reviewed. The sheet holds no personal data and no participant code. On paper the
participant's block (printed name, date, signature) comes before the researcher's, unless the sheet has the switch "researcher's lines first"; every
sheet ends with a footer line (study name, "version of <date of the last change>"); the strip on the screen counts the bracketed gaps that remain.

## Step 3. Tests

```
npm test
npm run test:generic
node scripts/test.mjs site.config.js --suite test-generic
```

Expected for each: an `ℹ tests N` / `ℹ pass N` / `ℹ fail 0` summary and a last line `OK: ...`:
`OK: test against config/fixture-lab.config.js`, `OK: test-generic against config/example-lab.config.js`,
`OK: test-generic against site.config.js`. The third line is the one that proves the human's own configuration works.
The first two prove that the template itself is intact. The third is config-agnostic on purpose: the tests that are about the shipped
example read `config/example-lab.config.js`, so it stays green after the human edits `site.config.js`; if it fails, his file is at fault (or the
template is, and the first two say so). They take a few seconds and use a temporary copy: your
`site.config.js` is not touched. Any `FAILED:` stops the procedure: show the failing test names to the human.

`npm run test:variants` runs the generic suite once more under each small configuration in `config/test-variants/` (declarations
off, one study, other language combinations, `realistic-edit.config.js`: the example with real-looking values typed in, and `own-address.config.js`: the same with the lab's own e-mail address at a university domain), and `npm run test:all` runs all three commands of the template in a row
(`npm test`, `npm run test:generic`, `npm run test:variants`). They are for whoever changes the code, not needed to deploy.

**What a healthy run looks like.** The number of tests changes whenever tests are added, so do not compare it with anything. `fail` and `cancelled` must always be 0. Check three things in each run:
`ℹ fail 0`, `ℹ cancelled 0`, and the final line, which starts with `OK:`:

| Command | Final line |
|---|---|
| `npm test` | `OK: test against config/fixture-lab.config.js` |
| `npm run test:generic` | `OK: test-generic against config/example-lab.config.js` |
| `node scripts/test.mjs site.config.js --suite test-generic` (the file as shipped) | `OK: test-generic against site.config.js` |
| `npm run test:variants` | `All <n> variants passed.` (n is the number of files in `config/test-variants/`) |

`npm run test:variants` prints one line per variant and each must start with `OK` and say `fail 0`:

```
OK     bare.config.js: tests <n>, pass <n>, fail 0, skipped <n>
```

The one skipped test (in the shipped example and the shipped file) is `noLinkDomains of the configuration decide which addresses get e-mails without links`: it checks the
e-mail of an address at a link-filtering domain, and `config/example-lab.config.js` (like a new `site.config.js`) has
`noLinkDomains: []`, so there is no such domain to test; the test reports itself as skipped on purpose. With `noLinkDomains`
filled in, as in the variants that have it, it runs. Under `site.config.js` the count of skipped tests depends on the file
(the Italian tests are skipped when `it` is not a language, the Italian-panel tests when `adminLanguage` is not `"it"`).

## Step 4. Git (optional but recommended)

If `git status` failed in step 1 (not a git repository), ask whether he wants to keep the code in a repository at all. If yes:
`git init -b main`, then the commands below; if no, skip this step.

If the clone has no remote of his own, ask whether he wants to keep the code in a GitHub repository (optional; the hosting
is Cloudflare, not GitHub, and GitHub Pages cannot host this site). If yes, he creates an empty private repository and gives you its address; then:

```
git remote -v
git add -A && git status --short
git commit -m "Configure the site for <lab>"
```

Check the `git status` list for `.dev.vars` (must not appear) before committing. Push only after he says yes
(`git push -u origin main`; the branch must be named `main`: `git branch --show-current`, and `git branch -M main` if not).

## Step 5. Choose the Worker name

Ask: "Choose a name for the site; it becomes `<name>.<your-subdomain>.workers.dev`. Lowercase letters, digits and hyphens, at most 58
characters; for example `studio-vr-unisede`." If he has his own domain, say it can be attached later in the Cloudflare
dashboard (Workers & Pages, the Worker, Settings, Domains & Routes); `baseUrl` can then be set to it if he wants fixed links.

`baseUrl` is not needed: every link the site writes is built from the address the visitor used (the workers.dev address, or the custom domain
once attached). Set `baseUrl` (or the `BASE_URL` secret) only for a custom domain whose links must never change (SECURITY.md explains
why that is the safer choice).

## Step 6. Log in to Cloudflare

Check:

```
npx --yes wrangler@4 whoami
```

Expected when logged in: a table with the account name and id. When not: a message saying you are not authenticated
(with `--json` the exit status is non-zero). Then ask the human to be ready at his browser, and run:

```
npx --yes wrangler@4 login
```

A browser window opens at dash.cloudflare.com; the human logs in (creating the free account first if needed) and clicks
Allow. Expected in the terminal: a message that the login succeeded. Run `whoami` again to confirm. If the browser cannot open on
this machine (remote shell, container), use `npx --yes wrangler@4 login --device`. If he has several accounts, `whoami`
lists them: ask which one, and pass it as `CLOUDFLARE_ACCOUNT_ID=<id>` before the commands below.

## Step 7. Create the D1 database in the EU

Check whether it exists:

```
npx --yes wrangler@4 d1 list --json
```

If an entry with name `<db>` is there, reuse its `uuid` and go to step 8. Otherwise:

```
npx --yes wrangler@4 d1 create <db> --jurisdiction eu
```

Expected: a message that the database was created and a snippet containing `"database_id": "<uuid>"`. If it asks
whether to add the binding to the configuration file, answer no (step 8 does it). `--jurisdiction eu` keeps the data in
the EU; it cannot be changed later, so confirm with the human that EU is right for his institution. (If he does not need the
guarantee, the button path is simpler: go back to "Which path?".)

## Step 8. Write the names into `wrangler.jsonc`

Open `wrangler.jsonc` and set three values, leaving everything else as it is (the file has comments: keep them):

```
"name": "<name>",
...
"database_name": "<db>",
"database_id": "<uuid from step 7>",      (a new line after database_name; the shipped file has none)
```

If `database_id` is already a real id different from the one you have, stop and ask (rule 4). Check:
`grep -nE '"(name|database_name|database_id)"' wrangler.jsonc`.

## Step 9. The tables (nothing to do)

There is no command here. Wrangler's automatic provisioning creates a D1 database only while it deploys, so "create the tables, then deploy"
cannot work on a new database. Instead the Worker creates its own tables on the first request (`src/migrate.js`: `ensureSchema` runs the
statements of `schema.sql`, all `CREATE ... IF NOT EXISTS`, in one `db.batch`, once per isolate) and upgrades an older database by itself.
The step-10 request to `<url>/` is that first request. Verify after it, with names only:

```
npx --yes wrangler@4 d1 execute <db> --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --yes
```

Expected tables, among others Cloudflare adds: `bookings`, `contacts`, `day_slots`, `days`, `login_attempts`, `mail_log`, `rate_limit`,
`settings`, `studies`, `tallies` (the last two start empty and stay empty until the researcher saves a study or the first old booking is purged). If `bookings` is missing after a request answered `200`, read the error and do not continue.

## Step 10. First deployment

```
npx --yes wrangler@4 deploy
```

Expected: the number of uploaded assets (6), the bindings it found (`env.DB (<db>) D1 Database`, `env.ASSETS Assets`), and
`Deployed <name> triggers` with the address `https://<name>.<subdomain>.workers.dev`. (`npm run deploy` is the same command.) The very first
deployment of an account without a workers.dev subdomain asks the human to choose one: let him answer. Take `<url>` from that output.

No second deployment is needed for the address: the site builds its links from the address of each request (unless he set `baseUrl`;
if he did and it differs from `<url>`, ask him whether that is a custom domain).

Verify:

```
curl -s -o /dev/null -w "%{http_code}\n" <url>/
curl -s -o /dev/null -w "%{http_code}\n" <url>/admin
curl -s -o /dev/null -w "%{http_code}\n" <url>/robots.txt
curl -s -o /dev/null -w "%{http_code}\n" <url>/no-such-page
```

Expected: `200`, `503`, `200`, `404`. The first request also created the tables. The 503 on `/admin` is correct now: there is no `ADMIN_PASSWORD` yet. (If the home page says "This site is not configured yet", `site.config.js` still has example values: see step 2.) (If `/` answers 503 with the text
about the missing database, the D1 binding did not reach the deployment: see "If something fails", "Database binding".)
If the first request returns `522`, `1101` or `404` right after the deploy, wait 30 seconds and try again.

## Step 11. The admin password

Tell the human:

> In your own terminal, in this folder, run: `npx --yes wrangler@4 secret put ADMIN_PASSWORD --name <name>`.
> Type a password of at least 16 characters when it asks (a shorter one counts as not set and `/admin` stays closed) (nothing is shown; a long sentence is fine) and press Enter.
> Do not tell me the password.

Expected on his side: a prompt that asks for the value, then a success message. A secret applies at once, with no new deployment.
Check from yours (names only, values are never shown):

```
npx --yes wrangler@4 secret list --name <name>
```

Expected: `ADMIN_PASSWORD` in the list. Then `curl -s -o /dev/null -w "%{http_code}\n" <url>/admin` prints `200` (the login page).

## Step 12. The mail relay (Google Apps Script)

Without the relay the site still works, but confirms every booking at once and sends no e-mail at all: no confirmation, no
reminder, no notice to the researcher. Offer to skip only if the human is testing. `docs/posta.md` has every screen; read it
and guide him, one action at a time. The human does the clicking, logged in to the Google account that will send the mail
(a dedicated study account, not a personal one: replies and the 100-per-day quota belong to it).

1. The human makes a random key in his terminal and keeps it copied: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   (He runs it, not you: the key must never appear in your output.)
2. script.google.com > New project > paste the whole of `apps-script/Code.gs` (you can open it for him; it contains no
   secret) > Save.
3. Project settings (gear) > Script properties > add:
   `RELAY_KEY` = the key; `SITE_URL` = `<url>` (the address the site is visited at, no trailing slash; the same as `baseUrl` if he set one); `TIMEZONE` = the `timeZone` of
   `site.config.js`; `SENDER_NAME` = the `brand`; `REPLY_TO` = the `contactEmail`; optional `REMINDER_HOUR` (0 to 23, default 10).
4. Deploy > New deployment > type Web app > Execute as: **Me** > Who has access: **Anyone** > Deploy > authorize
   (the screen "Google hasn't verified this app" is normal for his own script: Advanced > Go to project > Allow).
5. He copies the **web app URL ending in `/exec`**.
6. In his terminal, one at a time (the values are pasted at the hidden prompt):
   ```
   npx --yes wrangler@4 secret put MAIL_RELAY_KEY --name <name>
   npx --yes wrangler@4 secret put MAIL_RELAY_URL --name <name>
   ```
   `MAIL_RELAY_KEY` gets the same key as `RELAY_KEY`; `MAIL_RELAY_URL` gets the `/exec` address.
7. Optionally `npx --yes wrangler@4 secret put ADMIN_EMAIL --name <name>` to send the researcher's notices
   somewhere other than `contactEmail`.

Check: `secret list --name <name>` shows `ADMIN_PASSWORD`, `MAIL_RELAY_KEY`, `MAIL_RELAY_URL`. They are live at once.

## Step 13. Optional bot check (Cloudflare Turnstile)

Ask whether he wants it. The site already has a honeypot, a minimum fill-in time and per-address rate limits; Turnstile
adds a challenge. It needs JavaScript in the participant's browser. If yes: Cloudflare dashboard > Turnstile > Add widget >
name it, Hostname = the host of `<url>` (e.g. `<name>.<subdomain>.workers.dev`), mode Managed > Create. He gets a **Site key** and a
**Secret key**. In his terminal:

```
npx --yes wrangler@4 secret put TURNSTILE_SITEKEY --name <name>
npx --yes wrangler@4 secret put TURNSTILE_SECRET --name <name>
```

Both are needed; with only one, the check stays off. (The site key is public, but entering it the same way is simplest.)

## Step 14. Check the secrets are live

Secrets of a Worker apply at once, so there is no redeploy here. `curl -s -o /dev/null -w "%{http_code}\n" <url>/admin` prints `200`.
If you changed `site.config.js` in the meantime, deploy it: `npx --yes wrangler@4 deploy`.

## Step 15. The reminder trigger

Reminders for the next day are sent by a trigger inside Apps Script (the Worker has no scheduler of its own in this design). The human
opens his Apps Script project, picks the function `installReminder` in the toolbar and presses Run, once, authorizing if
asked. It deletes any older trigger of this script, installs one daily trigger at `REMINDER_HOUR` in `TIMEZONE`, and
calls the site once. In the Execution log he must see a line such as `200 {"ok":true,"sent":0,"failed":0}`.

Possible results: `403 bad signature` means `RELAY_KEY` in Apps Script and `MAIL_RELAY_KEY` in Cloudflare differ (set
both again to the same key); `503 no relay` means the relay secrets are not set (step 12); an error `Missing script property SITE_URL`
means the script property is missing. Check the trigger exists: in Apps Script, the clock icon (Triggers) lists `recordatorios`,
time-driven, day timer.

## Step 16. Optional: keep the code in GitHub

Only if he wants it (see step 4). To redeploy automatically on every push without the button, use the optional manual workflow
`.github/workflows/deploy.yml` (instructions in the file) or connect the repository in the Cloudflare dashboard (Workers & Pages >
the Worker > Settings > Builds), with build command empty and deploy command `npm run deploy` (which is just `wrangler deploy`).

## Step 17. Acceptance checklists

### Checklist A: the button path (the human deployed with "Deploy to Cloudflare")

- [ ] The Cloudflare dashboard (Workers & Pages) lists the Worker, and the build of the new repository succeeded.
- [ ] `curl -s -o /dev/null -w "%{http_code}\n" <url>/` prints `200`, and `<url>/no-such-page` prints `404`.
- [ ] `<url>/admin` shows the login page and accepts the password he typed in the button's form. (If it says the administration is
      disabled, the password field was left at its placeholder or is shorter than 16 characters: set it in the dashboard, Settings > Variables and Secrets.)
- [ ] The home page no longer says "This site is not configured yet" (it did until he replaced the example values of `site.config.js`; if it still
      does, the Set-up list in the admin Settings names each key that is left, and the build log in the dashboard names a wrong value).
- [ ] After he opens a week in the panel, each default time of `site.config.js` appears as a slot; he checks they are the times he wants.
- [ ] He booked a test slot with his own address from `<url>`: with no e-mail relay the booking page appears at once with the calendar
      links (confirmed immediately, no e-mail); he cancelled it from the page's link or from the panel.
- [ ] The "Puesta en marcha" / "Messa in funzione" list in Settings shows the lines still to do (relay, privacy review): he knows them.
- [ ] A committed edit of `site.config.js` in GitHub produced a new deployment (the page changed).
- [ ] He knows that the database has no EU jurisdiction (SECURITY.md, README) and that the privacy text must be reviewed.

### Checklist B: the agent path (steps 1 to 16)

Do all of it, in this order, and report each line as done or not done to the human:

- [ ] `curl -s -o /dev/null -w "%{http_code}\n" <url>/` prints `200`, and the page shows the booking card, not "This site is not configured yet".
- [ ] Same for `<url>/terms` and `<url>/privacy` (the Spanish pages are `/condiciones` and `/privacidad`; both spellings answer
      in every language), and `<url>/<lang>` for each configured language: it prints `302` (a redirect to the home in that language).
- [ ] `<url>/no-such-page` prints `404`.
- [ ] `<url>/admin` prints `200`. The human opens it in his browser and logs in with the password. The panel is in
      `adminLanguage`.
- [ ] The database is in the EU: `npx --yes wrangler@4 d1 info <db>` shows the jurisdiction (or the setup script printed `--jurisdiction eu`).
- [ ] In the panel the human opens a week (button to open the next days with the default times). Each default time of
      `site.config.js` appears as a slot. He checks the times are the ones he wants.
- [ ] In the panel, Impostazioni > the "Messa in funzione" checklist (Spanish panel: Ajustes > "Puesta en marcha"): every line says "Fatto" ("Listo") (the line about the
      daily reminders turns "Fatto" after the first call of step 15). The lines of the optional parts (mail relay, daily reminders,
      Turnstile) show "Da fare" ("Pendiente") for whatever he chose not to set up, and the privacy line stays "Da fare" until his
      data protection office has reviewed the policy and he has written `privacyReviewed: true`.
- [ ] **A test booking, end to end, by the human with his own address**: he opens `<url>`, books an open slot, waits for the
      e-mail (check the spam folder), presses the confirmation button, and checks the confirmation e-mail arrives with the
      right day, time, place and signature. Then he cancels it with the link in the e-mail. You do not read the
      booking; you ask him. (Without the relay: the booking is confirmed at once and the page links the calendar file.)
- [ ] The "someone booked" notice arrived at `contactEmail` (or `ADMIN_EMAIL`).
- [ ] If any of his addresses is at a university that drops mail with links, the test with such an address works with the
      code flow (README, "If something is wrong"); otherwise add the domain to `noLinkDomains`.
- [ ] `git status --short` shows no `.dev.vars` and no secret in any file; `grep -rn "RELAY_KEY\|ADMIN_PASSWORD" --include=*.jsonc --include=*.js .`
      shows only names, never values.
- [ ] The human was told about the anonymous usage count and chose: the panel (Settings, "Conteggio anonimo d'uso" / "Recuento anónimo de uso") says whether it is on or off, and that matches his choice.
- [ ] The human has the README, knows where the admin password is stored (his password manager), and has been told that the
      privacy and terms texts must be checked by his data protection office before the site is announced (and that `docs/testi.md`
      lists the texts that describe the study and must be rewritten for his own study).

Only then say the site is live.

---

## Updating later

```
git pull
node scripts/test.mjs site.config.js --suite test-generic
npm run deploy
```

`npm run deploy` is just `wrangler deploy`. There is no migration to apply: the Worker upgrades its own database on the first request after the
deployment (`docs/aggiornare.md` explains how, and how a schema change is written). Secrets and `site.config.js` are kept as they are. A database created with the
old `d1_migrations` files is recognised and brought up to date by that same first request. With the button, or with the
Cloudflare Git integration, `git push` is enough. With the optional workflow (`.github/workflows/deploy.yml`), run it from the Actions tab.

## Tearing down

Only when the human asks, and after saying what will be lost (the site, and all bookings and contacts in the database, which
cannot be recovered):

```
npx --yes wrangler@4 delete --name <name>
npx --yes wrangler@4 d1 delete <db>
```

`d1 delete` asks for confirmation (do not use `--skip-confirmation`); `delete --name` also asks, and has no flag to skip it (`--force` only overrides dependent Workers: do not use it). Check the name you pass. Also tell him to delete the Apps
Script project (script.google.com > the project > Delete), which stops the reminder trigger, and to revoke the API token if he
made one for GitHub.

## If something fails

| Symptom | Cause and remedy |
|---|---|
| `Error: site.config.js: ...` when loading, or in the tests | The message names the key. Fix the value. The most common: `slotMinutes` smaller than `sessionMinutes`, two `defaultTimes` closer than `slotMinutes`, a language missing in `place.*` or in `hero.creditHtml`, an unknown key in `texts`. |
| `Unknown argument` from wrangler | A flag was mistyped, or you used another wrangler major version. Use `npx --yes wrangler@4`, and `... <command> --help` to look at the real flags. |
| `You are not authenticated`, `Authentication error [code: 10000]` | Run step 6 again. With a long-idle login, `npx --yes wrangler@4 logout` then `login`. |
| `d1 create` says the name exists | Reuse it: `d1 list --json`, take its `uuid` (step 7). |
| `d1 execute` says it cannot find the database or the binding | `database_name` or `database_id` in `wrangler.jsonc` differs from `<db>`, or the account is not the one that created it: `whoami`, `d1 list`. Without a `database_id` the remote commands cannot find the database (only the button and `wrangler deploy` provision one). |
| `wrangler deploy` asks about a workers.dev subdomain | First deployment of the account: let the human choose one. |
| `deploy` prints an address different from the one you expected | The name was taken and Cloudflare added a suffix. Nothing to correct in the site (the links follow the address of the request); tell the human the real address. |
| The home page says "This site is not configured yet" | `site.config.js` still holds example values: the Set-up list in `/admin` (or `node scripts/setup.mjs --dry-run --no-tests`) lists each key. Replace them (step 2). |
| `/admin` says the administration is disabled and names a length | `ADMIN_PASSWORD` is shorter than `minAdminPasswordLength` (16): set a longer one (step 11). |
| `/` shows a "database missing" 503 | **Database binding.** The D1 binding did not reach the deployment. Check `d1_databases` is in `wrangler.jsonc` with `"binding": "DB"` and a real `database_id`, and deploy again. If it persists, the human adds it in the dashboard: Workers & Pages > the Worker > Settings > Bindings > Add > D1 database, variable name `DB`, choose `<db>`, then deploy again. |
| `/admin` says the administration is disabled | `ADMIN_PASSWORD` is missing or still the placeholder from `.dev.vars.example`: `secret list --name <name>` must show it; set it with step 11 (it applies at once). |
| A variable set in the dashboard disappeared after a deployment | Plain variables not in `wrangler.jsonc` are removed by each `wrangler deploy`; secrets are kept. Put `noLinkDomains` (and `baseUrl`, if any) in `site.config.js`, and create the others as secrets. |
| E-mail does not arrive | See README "If something is wrong". In the admin panel the day panel shows, under each booking, what was sent. A message `bad signature` means the keys differ; `quota` means the day's Gmail limit; `http 302`/`http 401` or `network` usually means the web app was not deployed as "Execute as Me, access Anyone", or the `/exec` URL is wrong. After changing Apps Script code, Deploy > Manage deployments > edit > New version (the URL stays the same). |
| Participants cannot book: "Too many attempts" or the bot check fails | README "If something is wrong". For Turnstile, the hostname of the widget must match the site's host exactly. |
| A test fails after editing `texts` | A key name that does not exist stops the site on purpose. Check the spelling against `src/i18n.js`. |

When you finish, write the human a short summary: the address, where the admin is, which secrets are set (names only),
what is still to do on his side (privacy check, announcing the site), and the commands for updating. Do not include any
secret in it.
