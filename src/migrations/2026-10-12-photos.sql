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
