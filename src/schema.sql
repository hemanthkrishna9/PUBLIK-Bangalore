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
-- "I went here" visits: three optional tap answers that help first-timers. Kept 365 days.
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  place TEXT NOT NULL,
  ts INTEGER NOT NULL,
  who TEXT,
  entry TEXT,
  feel TEXT,
  first TEXT
);
CREATE INDEX IF NOT EXISTS visits_place_ts ON visits (place, ts);
CREATE INDEX IF NOT EXISTS visits_who_ts ON visits (who, ts);
CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts);
-- 2026-10-11: playground safety answers. Run once on the live database.
ALTER TABLE visits ADD COLUMN equip TEXT;
ALTER TABLE visits ADD COLUMN ground TEXT;
ALTER TABLE visits ADD COLUMN toddler TEXT;
-- 2026-10-12: user photos. Run once on the live database.
-- status: live, hidden, rejected, pending (check failed, owner looks), failed (storage error or timeout) or deleted.
-- who is the daily-salted IP hash (cleared after 24 hours). device is a random id from the browser.
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  who TEXT,
  device TEXT,
  text TEXT,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  reports INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_place_status ON photos (place, status, ts);
CREATE INDEX IF NOT EXISTS photos_who_ts ON photos (who, ts);
CREATE INDEX IF NOT EXISTS photos_device_ts ON photos (device, ts);
CREATE INDEX IF NOT EXISTS photos_ts ON photos (ts);
-- One report per photo per who. Rows are deleted after 30 days.
CREATE TABLE IF NOT EXISTS photo_reports (
  photo TEXT NOT NULL,
  who TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (photo, who)
);
CREATE INDEX IF NOT EXISTS photo_reports_who_ts ON photo_reports (who, ts);
