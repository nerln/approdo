// The Worker creates and upgrades its own database: there is no migration command to run, before or after a deployment.
// (Wrangler's automatic D1 provisioning creates the EMPTY database only while it deploys, so "apply migrations, then deploy"
// cannot work on a fresh clone; the first request does the work instead.)
//
//   - Once per isolate, ensureSchema() reads the schema_version row of the settings table. That is one cheap query; after it
//     the isolate remembers the answer and runs no query at all.
//   - "no such table": the database is new. The whole schema (src/schema.js, generated from schema.sql) is run in one
//     db.batch of CREATE ... IF NOT EXISTS statements, which also writes the schema_version row.
//   - A database without the row (made before versions existed) or with a lower version is upgraded by the steps of UPGRADES
//     that are newer than it. Every step is idempotent, so two requests (or two isolates) racing on a new database are safe.
//   - Any other error is not ours to hide: it propagates and the next request tries again.
import { SCHEMA_STATEMENTS } from "./schema.js";

// The statements that create tables and indexes, without the one that writes the version.
const DDL = SCHEMA_STATEMENTS.filter((s) => !/^INSERT\b/i.test(s));

// Adds a column unless it is already there (SQLite has no ADD COLUMN IF NOT EXISTS). True when it was added.
async function addColumn(db, table, column, definition) {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    return true;
  } catch (e) {
    if (/duplicate column name/i.test(String((e && e.message) || e))) return false;
    throw e;
  }
}
const batch = (db, statements) => db.batch(statements.map((s) => db.prepare(s)));

// One entry per schema version, in order. `run(db)` brings a database of the PREVIOUS version to this one and must be
// idempotent. The schema_version row of schema.sql must name the last version here (a test checks it).
export const UPGRADES = [
  {
    version: 1,
    // The schema as it stands. Covers databases made before the schema had a version row: the tables that were
    // added later are created, and the columns that were added later are added if they are missing.
    async run(db) {
      await batch(db, DDL);
      await addColumn(db, "bookings", "lang", "TEXT NOT NULL DEFAULT 'es'");
      // Until verified_at existed every confirmed booking had been confirmed by e-mail (link or code): the e-mail was proven.
      if (await addColumn(db, "bookings", "verified_at", "TEXT")) {
        await db.prepare("UPDATE bookings SET verified_at = created_at WHERE status IN ('confirmed', 'attended', 'noshow') AND verified_at IS NULL").run();
      }
    },
  },
  {
    version: 2,
    // The studies managed from the admin panel and the counts that survive the purge of old bookings. Both tables are new and
    // empty, so nothing is copied: while "studies" is empty the site keeps using the studies of site.config.js.
    async run(db) {
      await batch(db, DDL.filter((s) => /^CREATE TABLE IF NOT EXISTS (studies|tallies)\b/.test(s)));
    },
  },
  {
    version: 3,
    // Tallies per ISO week instead of per day (a count per day kept for ever could single out one person). The old rows are summed
    // into the Monday of their week, in ONE batch (all or nothing). Idempotent: a table that already has a "week" column (a new
    // database, or a step that already ran) is left alone.
    async run(db) {
      const cols = (await db.prepare("SELECT name FROM pragma_table_info('tallies')").all()).results.map((r) => r.name);
      if (!cols.includes("date")) return;
      await batch(db, [
        "DROP TABLE IF EXISTS tallies_week",
        "CREATE TABLE tallies_week (study TEXT NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (study, week, status))",
        "INSERT INTO tallies_week (study, week, status, n) SELECT study, date(tallies.date, '-6 days', 'weekday 1'), status, sum(n) FROM tallies WHERE date(tallies.date, '-6 days', 'weekday 1') IS NOT NULL GROUP BY study, date(tallies.date, '-6 days', 'weekday 1'), status",
        "DROP TABLE tallies",
        "ALTER TABLE tallies_week RENAME TO tallies",
      ]);
    },
  },
];
export const SCHEMA_VERSION = UPGRADES[UPGRADES.length - 1].version;

async function readVersion(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first();
  return r ? Number(r.value) || 0 : 0;
}

async function prepareDatabase(db) {
  let version;
  try {
    version = await readVersion(db);
  } catch (e) {
    if (!/no such table/i.test(String((e && e.message) || e))) throw e;
    // A new database: the whole schema in one batch, then the version it describes.
    await batch(db, SCHEMA_STATEMENTS);
    version = await readVersion(db);
  }
  for (const step of UPGRADES) {
    if (step.version <= version) continue;
    await step.run(db);
    await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(step.version)).run();
    version = step.version;
  }
}

// One promise per database binding: concurrent first requests wait for the same work, and a request that comes after it is
// done only awaits an already-settled promise (no query). A failure is forgotten so that the next request tries again.
const ready = new WeakMap();
export function ensureSchema(db) {
  if (!db || (typeof db !== "object" && typeof db !== "function")) return prepareDatabase(db); // not a binding we can remember (cannot happen on Cloudflare)
  let p = ready.get(db);
  if (!p) {
    p = prepareDatabase(db).catch((e) => { ready.delete(db); throw e; });
    ready.set(db, p);
  }
  return p;
}
