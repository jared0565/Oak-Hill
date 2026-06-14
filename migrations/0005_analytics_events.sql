-- Migration 0005: first-party, cookieless, anonymous events. No IP, no user-id, no full URLs.
CREATE TABLE IF NOT EXISTS analytics_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,                       -- page_view | slot_selected
  path   TEXT,                                -- page path, e.g. /parties
  source TEXT,                                -- referrer host or utm_source ('direct' if none)
  ts     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts   ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name);
