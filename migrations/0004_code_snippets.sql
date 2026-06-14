-- Migration 0004: owner-pasted tracking snippets (Head/Body), consent-gated on the client.
CREATE TABLE IF NOT EXISTS code_snippets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  label            TEXT NOT NULL,
  code             TEXT NOT NULL,
  placement        TEXT NOT NULL DEFAULT 'head',          -- head | body_start | body_end
  scope            TEXT NOT NULL DEFAULT 'global',        -- 'global' or a page path e.g. '/parties.html'
  consent_category TEXT NOT NULL DEFAULT 'advertising',   -- necessary | analytics | advertising
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_snippets_enabled ON code_snippets(enabled);
