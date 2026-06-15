-- Migration 0010: account & security (self-service profile, avatar, TOTP 2FA).
-- Additive. Avatar is a small image data URL (personal data → erased with the account row).
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- Backup codes for 2FA recovery. Codes are high-entropy → stored as SHA-256, single-use.
CREATE TABLE IF NOT EXISTS backup_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  code_sha256 TEXT NOT NULL,      -- SHA-256 of the code (codes are high-entropy)
  used_at     TEXT                -- NULL = unused
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON backup_codes(user_id);
