-- One row per installation. Days only (YYYY-MM-DD, UTC), never a time of day.
-- The collector creates this table by itself on first use; this file is the same statement for reading.
CREATE TABLE IF NOT EXISTS installs (
  id         TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  version    TEXT NOT NULL,
  sessions   INTEGER NOT NULL,
  days_seen  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);
CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen);
