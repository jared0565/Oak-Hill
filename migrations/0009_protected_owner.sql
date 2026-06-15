-- Migration 0009: protected (break-glass) owner.
-- A protected account can't be deleted, disabled, or demoted from owner — no
-- matter how many other owners exist. The flag is set when the first owner is
-- created (bootstrap). It is never exposed by the API as an editable field.
ALTER TABLE users ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;

-- Safety net: if an owner was already bootstrapped before this shipped, protect
-- the first one so the rule holds regardless of timing. No-op on an empty table
-- (MIN over zero rows is NULL, which matches nothing).
UPDATE users SET protected = 1 WHERE id = (SELECT MIN(id) FROM users WHERE role = 'owner');
