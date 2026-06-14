-- Migration 0006: contacts CRM backbone + backfill from existing bookings/enquiries.
CREATE TABLE IF NOT EXISTS contacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT,
  phone            TEXT,
  name             TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen        TEXT NOT NULL DEFAULT (datetime('now')),
  notes            TEXT
);
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id INTEGER NOT NULL,
  tag        TEXT NOT NULL
);

ALTER TABLE bookings  ADD COLUMN contact_id INTEGER;
ALTER TABLE enquiries ADD COLUMN contact_id INTEGER;

INSERT INTO contacts (email, phone, name, first_seen, last_seen)
SELECT LOWER(TRIM(email)), MAX(phone), MAX(name), MIN(created_at), MAX(created_at)
FROM (
  SELECT email, phone, name, created_at FROM bookings
  UNION ALL
  SELECT email, phone, name, created_at FROM enquiries
)
WHERE email IS NOT NULL AND TRIM(email) <> ''
GROUP BY LOWER(TRIM(email));

UPDATE bookings  SET contact_id = (SELECT id FROM contacts WHERE contacts.email = LOWER(TRIM(bookings.email)))  WHERE email IS NOT NULL AND TRIM(email) <> '';
UPDATE enquiries SET contact_id = (SELECT id FROM contacts WHERE contacts.email = LOWER(TRIM(enquiries.email))) WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email      ON contacts(email);
CREATE INDEX        IF NOT EXISTS idx_contacts_lastseen   ON contacts(last_seen);
CREATE INDEX        IF NOT EXISTS idx_contact_tags_cid    ON contact_tags(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_tags_unique ON contact_tags(contact_id, tag);
