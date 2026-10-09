-- Anonymous visitor reports. "who" is a daily-salted hash of the IP, cleared after 24 hours.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  place TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  who TEXT
);
CREATE INDEX IF NOT EXISTS reports_place_ts ON reports (place, ts);
CREATE INDEX IF NOT EXISTS reports_who_ts ON reports (who, ts);
CREATE INDEX IF NOT EXISTS reports_ts ON reports (ts);
-- One random salt per UTC day. Old salts are deleted, so old hashes cannot be reversed.
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
