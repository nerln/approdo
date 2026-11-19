# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue.

On GitHub, open the **Security** tab of the repository and choose **Report a vulnerability** (private vulnerability
reporting). Describe what you found, how to reproduce it and what you think the impact is. You will get an answer as soon as
a maintainer can read it; please allow a few days. Do not test against a site that is not yours, and never touch other
people's bookings.

If you run your own copy and the reporting button is not visible, the repository owner has to switch it on: Settings >
Code security > Private vulnerability reporting.

## What the site stores

All of it lives in the D1 database of your own Cloudflare account; there is no central server and the authors see nothing.

- Per booking: the name or alias the person typed, the e-mail address, the chosen day and time, the status (pending, confirmed,
  cancelled, attended, no-show), the language, the creation time, and when the person proved that they receive the e-mail.
  A secret link token and a 6-digit booking code let the person confirm, cancel or fetch the calendar file.
  Bookings are deleted `bookingRetentionDays` days after the slot (30 by default); unconfirmed ones after 2 hours.
- Optional list for future studies: only the e-mail address and the language, for `contactMonths` months (24 by default).
- A log of the e-mails sent (which kind, ok or failed, no text), kept for 60 days.
- For rate limiting: a hash of the network address salted with the current date, kept for one hour. No raw IP address is stored.
- Site settings (open days, times, switches, the signing key of the forms).
- No cookies for people who book. The admin panel sets one session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, 12 hours).

Secrets (admin password, mail relay address and key, bot-check keys) are Cloudflare Worker secrets. They are not in the
repository, and a secret left at its placeholder counts as not set.

## Protections

- A strict Content-Security-Policy with no inline script or style, `frame-ancestors 'none'`, HSTS, `nosniff`, no referrer.
- Every value written into a page is escaped; every SQL statement uses bound parameters.
- Forms carry a signed timestamp (at least 4 seconds between opening and sending, at most 24 hours), a hidden trap field, and
  disposable e-mail domains are refused. Optional Cloudflare Turnstile check.
- Rate limits: requests per network, wrong codes per address, mail volume per hour and per day, admin sign-in attempts (blocked
  after 5 failures in 15 minutes).
- The admin panel needs a password of at least 16 characters (`minAdminPasswordLength`, 16 by default): a shorter `ADMIN_PASSWORD`
  is treated as not set, so the panel stays closed and says why. It is also closed while the password is a placeholder, and every
  admin action carries a CSRF token. Passwords and signatures are compared in constant time. Signing out revokes every session.
- The mail relay request is signed with HMAC-SHA256 and a timestamp; the daily reminder call is signed and refused if stale.
- Admin, token and calendar pages are marked `noindex`.
- A site that still holds the example values of the shipped `site.config.js` takes no booking (it says "not configured yet"), so a
  fresh deployment cannot be mistaken for a real study.
- The local preview (`node scripts/preview.mjs`) uses a new random admin password at every start; no fixed password exists.

## Known limitations (accepted, and stated honestly)

- **Anyone who knows an e-mail address can learn whether it has a live booking.** Trying to book with an address that already
  has one answers "there is already a booking with this address". The site does not hide this, because hiding it would leave
  people unable to understand why they cannot book. The booking details (name, day) are not shown.
- **Instant confirmation does not prove ownership of the address.** When the mail relay is off, or the admin panel is set to
  "instant", a booking is confirmed as soon as it is made. Someone can book with an e-mail address that is not theirs. The
  confirmation e-mail (when the relay is on) carries a button that records proof of receipt, and the panel shows it; use the
  "by e-mail" mode if false bookings start to appear.
- **Shared networks share a rate limit.** The limit is per network address (20 requests in 10 minutes), so a class or an office
  behind one address can lock itself out for a while, and one abusive user on a shared network affects the others.
- **The address in links comes from the request unless you fix it.** `baseUrl` (or the `BASE_URL` variable) is optional. Without it,
  every link the site writes (e-mails, calendar files, link-preview tags) and the host name that the bot check expects are built
  from the origin of the request URL, as routed by Cloudflare. Cloudflare only delivers a request to your Worker for a host name
  that is set up for it (your workers.dev address or a custom domain you attached), but if your lab has a custom domain, set
  `baseUrl` (or `BASE_URL`) explicitly: then the links are the same whatever address a request arrives with, and a forged
  request cannot make the site mail a link to another address.
- There is one shared admin password and no second factor or per-user audit trail. Use a long random password, and change it
  (`wrangler secret put ADMIN_PASSWORD`) when someone leaves the group.
- The CSV export and the invitation helper produce personal data on the researcher's computer; protecting those copies is up to you.
- The privacy policy and terms are a starting point, not legal advice: your institution has to review them.
- The site depends on Cloudflare (hosting, database) and, if you enable e-mail, Google Apps Script. Their availability, quotas and
  data location are theirs. The "Deploy to Cloudflare" button creates the database without the EU jurisdiction option; use
  `node scripts/setup.mjs` (it creates it with `--jurisdiction eu`) if you need that guarantee.
