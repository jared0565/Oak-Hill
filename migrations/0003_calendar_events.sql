-- Migration 0003: general calendar events and closures.
-- A 'closure' row blocks bookings for every date it covers (see /api/slots, /api/book).
CREATE TABLE IF NOT EXISTS calendar_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'event',   -- 'event' | 'closure'
  title      TEXT NOT NULL,
  start_date TEXT NOT NULL,                    -- YYYY-MM-DD
  end_date   TEXT NOT NULL,                    -- YYYY-MM-DD (== start_date for one day)
  all_day    INTEGER NOT NULL DEFAULT 1,       -- 1 = all day; 0 = timed (events only)
  start_time TEXT,                             -- HH:MM when all_day = 0
  end_time   TEXT,                             -- HH:MM when all_day = 0
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calevents_dates ON calendar_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calevents_kind  ON calendar_events(kind);
