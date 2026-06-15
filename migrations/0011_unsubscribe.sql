-- Migration 0011: newsletter unsubscribe handling (PECR reg.22 / UK GDPR Art.7(3)).
-- Additive. opt-out timestamp = withdrawal evidence (mirrors marketing_opt_in_at);
-- unsub_token = 128-bit per-contact capability token carried in the unsubscribe link.
ALTER TABLE contacts ADD COLUMN marketing_opt_out_at TEXT;
ALTER TABLE contacts ADD COLUMN unsub_token TEXT;

-- Unique, but tolerant of the many NULLs on non-subscribers (SQLite treats NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsub_token ON contacts(unsub_token);

-- Backfill existing opted-in contacts so their links work the moment email is enabled.
UPDATE contacts SET unsub_token = lower(hex(randomblob(16)))
  WHERE marketing_opt_in = 1 AND unsub_token IS NULL;
