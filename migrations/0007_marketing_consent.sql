-- Migration 0007: record when marketing consent was given (consent evidence).
ALTER TABLE contacts ADD COLUMN marketing_opt_in_at TEXT;
