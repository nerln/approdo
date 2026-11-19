-- Database schema of the booking site. No IP address and no participant code are stored.
-- This is the ONE source of truth. src/schema.js is generated from it (`npm run build:schema`; a test fails when they differ)
-- and the Worker runs it by itself on the first request (src/migrate.js: ensureSchema), so there is no migration step to run.
-- Every statement is CREATE ... IF NOT EXISTS (or INSERT OR IGNORE), so running it twice changes nothing.
-- When you change the schema later: edit this file so it describes the NEW database, run `npm run build:schema`, add the
-- upgrade for existing databases to UPGRADES in src/migrate.js and set the schema_version row at the bottom to that
-- version (docs/aggiornare.md explains it step by step).
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Open days and, per day, the open start times (a row exists = open).
CREATE TABLE IF NOT EXISTS days (date TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS day_slots (
  date TEXT NOT NULL, time TEXT NOT NULL,
  PRIMARY KEY (date, time)
);
CREATE TABLE IF NOT EXISTS bookings (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,      -- secret link: confirm, cancel, .ics
  study      TEXT NOT NULL,             -- study1 | study2
  date       TEXT NOT NULL,             -- YYYY-MM-DD, local time (time zone of site.config.js)
  time       TEXT NOT NULL,             -- HH:MM
  name       TEXT NOT NULL,             -- name or alias
  email      TEXT NOT NULL,
  email_key  TEXT NOT NULL,             -- normalised e-mail, to detect duplicates
  status     TEXT NOT NULL,             -- pending | confirmed | cancelled | attended | noshow
  created_at TEXT NOT NULL,
  expires_at TEXT,                      -- pending only: ISO UTC, 2 h
  reminded   INTEGER NOT NULL DEFAULT 0,
  lang       TEXT NOT NULL DEFAULT 'es', -- language of the booking: es | en | it
  verified_at TEXT                      -- when the person proved they receive the e-mail (button or code in the message); NULL = not proven
);
-- One live booking per slot and one per e-mail address.
CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_slot ON bookings(date, time) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_email ON bookings(email_key) WHERE status IN ('pending','confirmed');
CREATE INDEX IF NOT EXISTS ix_booking_date ON bookings(date);
-- Rate limit: only a salted daily hash of the IP address, deleted after an hour.
CREATE TABLE IF NOT EXISTS rate_limit (k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_rate ON rate_limit(k, ts);
CREATE TABLE IF NOT EXISTS login_attempts (k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_login ON login_attempts(k, ts);
-- Log of e-mails per booking (kind: confirm_request | confirmed | reminder | cancelled | noshow | admin | test). Deleted after 60 days.
CREATE TABLE IF NOT EXISTS mail_log (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT NOT NULL, kind TEXT NOT NULL, ok INTEGER NOT NULL, err TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_mail_booking ON mail_log(booking_id, at);
-- People who asked to hear about future studies (optional consent, 24 months by default). Only e-mail and language.
CREATE TABLE IF NOT EXISTS contacts (email_key TEXT PRIMARY KEY, email TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'es', consent_at TEXT NOT NULL, expires_at TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0, booking_id TEXT);
-- Studies managed from the admin panel. Empty until the first study is saved there: while it is empty the studies are the ones of
-- site.config.js. data is JSON (name, target, archived, declarations, texts per language); see src/studies.js.
CREATE TABLE IF NOT EXISTS studies (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
-- Counts of the bookings that the purge deleted, per study, ISO week (week = the Monday, YYYY-MM-DD) and status. No names and no
-- e-mail addresses; it is never purged. Per week, not per day: a count per day could point at one person.
CREATE TABLE IF NOT EXISTS tallies (study TEXT NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (study, week, status));
-- The schema version of this file: databases at a lower version are upgraded by src/migrate.js. Keep it equal to the
-- last version in UPGRADES (a test checks it).
INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '3');
