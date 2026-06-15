-- Migration 0012: newsletter send history (one row per broadcast). Campaign-level only —
-- no per-recipient rows (the audit_log records the action; keeps personal data minimal).
CREATE TABLE IF NOT EXISTS newsletters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,             -- the plain text the owner typed
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  sent_by         INTEGER,                   -- users.id (actor)
  sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_newsletters_sent_at ON newsletters(sent_at);
