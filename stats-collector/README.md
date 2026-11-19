# Approdo stats collector

A tiny Cloudflare Worker that counts how many installations of Approdo are in use. The product website shows the totals ("N labs use Approdo").

This is not part of the booking site. A lab never deploys it. It runs once, under the author's account, at `https://approdo-stats.nerln.workers.dev`. It lives in this repository only so that anyone can read what it does. A fork that wants its own count can deploy its own copy (see below).

## What it receives

Each installation sends at most one report a day:

```
POST /ping
content-type: application/json

{"id":"<32 lowercase hex chars>","v":"0.2.0","sessions":123}
```

- `id` is a random identifier the installation creates the first time it reports. It is not derived from the site address, the lab name or any key.
- `v` is the product version.
- `sessions` is the all-time number of bookings marked as attended in that installation.

Nothing else is sent: no site address, no lab name, no study names, no participant data, no language.

The collector answers 204 to every ping, valid or not, and never says why a report was ignored. A request without `content-type: application/json`, a body over 300 bytes, a body with other fields, or values outside the expected format are dropped without being stored. The content-type check means a web page cannot make its visitors' browsers send pings: a browser cannot send that header to another site without a preflight, which this Worker never answers.

## What it stores

One row per identifier, six columns (see `schema.sql`):

| column | content |
|---|---|
| `id` | the random identifier |
| `first_seen` | day of the first report, `YYYY-MM-DD`, UTC |
| `last_seen` | day of the latest report |
| `version` | the version string |
| `sessions` | the attended count |
| `days_seen` | the number of different days with a report |

Days only, never a time of day.

## What it never stores

It never reads, stores or logs the IP address, the user agent, any other request header, or the `CF-Worker` header. That header deserves a plain statement: Cloudflare adds `CF-Worker`, naming the sender's zone (for example its `workers.dev` subdomain), to requests that one Worker makes to another site. It is therefore present on every ping, and the collector ignores it. The only header the code looks at is `content-type`, to compare it with `application/json`; it does not log request data, and `test/collector.test.mjs` checks both. Logging and observability are switched off in `wrangler.jsonc`, but note that Cloudflare itself sees the connection metadata of any request it carries; the collector simply does not use it.

## Abuse limits

These need no personal data:

- An identifier is updated at most once per UTC day; a second ping the same day changes nothing.
- `sessions` never drops and grows by at most 2000 a day, the first report included (a first value above 2000 is stored as 2000 and catches up over the following days).
- An installation is counted once it has reported on at least 2 different days: a deploy that was tried once and thrown away is not a lab that uses the product.
- Its sessions enter the published sum only once it has reported on at least 7 different days and its first report is at least 7 days old ("established"). New identifiers are cheap to make, a week of history is not, and the sum is the one figure that could say something about a single lab.
- Identifiers that are not established yet are kept to the newest 5000. A flood of new identifiers can push out other new ones, never an established installation, and a new identifier is always admitted.

## How the totals are computed

`GET /stats.json`:

```
{"updated":"<ISO time>","installs":{"active":3,"total":5},"sessions":42,"minInstallsForSessions":3}
```

- `active` counts the installations seen on at least 2 different days whose `last_seen` falls within the last 30 days.
- `total` counts every installation ever seen on at least 2 different days.
- `sessions` is the sum of `sessions` over the active established installations, rounded down to a multiple of 10 so that comparing it on two days does not give one lab's growth.

The response is public, allows any origin, and is cached for five minutes.

## The three-installation rule

While fewer than 3 established installations are active, `sessions` is `null`. One lab's number is never published alone.

## Other routes

`GET /` redirects to the product site. Any other path or method gets a 404 or 405 with an empty body.

## Deploy your own

For a fork that wants its own count:

1. Edit `wrangler.jsonc` if you want another Worker name.
2. From this folder run `npx wrangler deploy`. Cloudflare creates the D1 database `approdo-stats` at the first deploy. The Worker creates its table on the first request, so there is no migration.
3. Point your fork's installations at your collector address: change `USAGE_URL` in `src/product.js` of the booking site. Until you do, every lab that deploys your fork reports to the author's collector at `approdo-stats.nerln.workers.dev` (unless it sets `usageCount: false`). Change the redirect target (`HOME`) in `stats-collector/src/index.js` to your own site.

## Tests

```
node --test "stats-collector/test/*.test.mjs"
```

Node 22 or later. The tests use the in-memory D1 shim from `test/helpers.mjs` and need no network.
