// GENERATED from schema.sql by `npm run build:schema`: do not edit by hand (a test fails when the two differ).
// The statements that create the whole database; src/migrate.js runs them by itself on the first request.
export const SCHEMA_STATEMENTS = Object.freeze([
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS day_slots ( date TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (date, time) )",
  "CREATE TABLE IF NOT EXISTS bookings ( id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, study TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, email_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, reminded INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'es', verified_at TEXT )",
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_slot ON bookings(date, time) WHERE status <> 'cancelled'",
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_email ON bookings(email_key) WHERE status IN ('pending','confirmed')",
  "CREATE INDEX IF NOT EXISTS ix_booking_date ON bookings(date)",
  "CREATE TABLE IF NOT EXISTS rate_limit (k TEXT NOT NULL, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ix_rate ON rate_limit(k, ts)",
  "CREATE TABLE IF NOT EXISTS login_attempts (k TEXT NOT NULL, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ix_login ON login_attempts(k, ts)",
  "CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, err TEXT, at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ix_mail_booking ON mail_log(booking_id, at)",
  "CREATE TABLE IF NOT EXISTS contacts (email_key TEXT PRIMARY KEY, email TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'es', consent_at TEXT NOT NULL, expires_at TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, booking_id TEXT)",
  "CREATE TABLE IF NOT EXISTS studies (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS tallies (study TEXT NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (study, week, status))",
  "INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '3')",
]);
