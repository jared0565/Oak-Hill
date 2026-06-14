# D — CRM (Contacts) : Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

One record per person. A `contacts` backbone that bookings and enquiries link to, with a
dashboard to see each person's history (bookings + enquiries), tag and annotate them, export,
and **erase** them. This is the foundation (F) deferred from A1, landing now with the CRM.

## Compliance (UK GDPR) — built in

- **Lawful basis:** keeping a contact record of people who book/enquire = **legitimate
  interest / performance of a contract**. Any *marketing* use = **consent** (`marketing_opt_in`,
  default off; only E/lead-capture or a manual toggle sets it).
- **Right to erasure:** an **Erase** action deletes the contact (+ tags + notes) and **scrubs
  PII** from their linked `bookings`/`enquiries`, matched by **`contact_id = N` OR normalized
  `email` = the contact's email** (so a row that never got linked can't retain the person's
  data). Booking scrub covers `name`, `email`, `phone`, `notes`, `child_age`, `children`;
  enquiry scrub covers `name`, `email`, `phone`, `message`, `child_age`, `children`. Keeps only
  non-identifying operational data (slot/status, enquiry type/date). One D1 `batch`,
  all-or-nothing. (`analytics_events` is deliberately out of scope — it holds no PII by design.)
- **Retention:** policy states a *criteria-based* retention (kept while needed for the
  booking relationship; erasable on request) — no invented fixed number. (Owner can specify a
  period later; auto-purge is a possible scheduled job, not in v1.)
- **Data minimization:** no new personal fields beyond what the forms already collect.
- **Access:** all `/api/admin/*` stay behind `ADMIN_TOKEN`. No contact PII is ever exposed on
  a public endpoint.

## Scope

**In:** `contacts` + `contact_tags` tables; `contact_id` on bookings/enquiries + backfill;
best-effort contact upsert on new booking/enquiry; admin contacts API (list/search, detail+
timeline, notes, marketing toggle, tags, CSV export, erase); dashboard Contacts section;
privacy-policy update.

**Out:** marketing email sending (→ E), automated segments beyond tag-filtering, auto-purge
cron, phone-only contacts (every form requires email, so email is the dedup key; phone is
stored for display only).

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0006_contacts.sql` | contacts + contact_tags, `contact_id` columns, **backfill**, indexes |
| Create | `functions/api/_lib/contacts-core.mjs` | Pure: normalizeEmail/Phone, csvCell, validateTag + tests |
| Create | `functions/api/_lib/contacts-db.mjs` | `upsertContact(db, {email,phone,name})` (uses contacts-core) |
| Modify | `functions/api/book.js` | Best-effort: upsert contact + set `bookings.contact_id` |
| Modify | `functions/api/enquiry.js` | Best-effort: upsert contact + set `enquiries.contact_id` |
| Create | `functions/api/admin/contacts.js` | List/detail/patch/tags/erase/CSV |
| Create | `public/assets/admin-contacts.js` | Contacts dashboard UI |
| Modify | `public/admin.html` | Contacts section; load script |
| Modify | `public/assets/admin.js` | `refresh()` calls `window.OHPContacts.render()` |
| Modify | `public/assets/styles.css` | Contacts styles |
| Modify | `public/privacy.html` | CRM record + retention + erasure wording |
| Create | `tests/contacts-core.test.mjs` | `node --test` |

## Data model + backfill

```sql
-- migrations/0006_contacts.sql
CREATE TABLE IF NOT EXISTS contacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT,                  -- normalized: trim + lowercase (dedup key)
  phone            TEXT,                  -- stored for display
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

-- Backfill: every existing booking/enquiry has an email, so dedup by normalized email.
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
```

- The unique email index is created **after** the GROUP-BY backfill (which already yields one
  row per email), so there's no conflict. It then powers `ON CONFLICT(email)` upserts.
- Runs exactly once (wrangler's migration tracking), so the non-idempotent `ALTER`/`INSERT`
  are safe. Consistent with how 0003–0005 already apply in CI.

## Pure + db helpers

`contacts-core.mjs` (tested): `normalizeEmail(e)` (trim+lowercase), `normalizePhone(p)`
(digits only), `csvCell(v)` (CSV-escape: wrap in quotes, double internal quotes, strip CR/LF),
`validateTag(t)` (1–30 chars, lowercased, `[a-z0-9-]` → ok/normalized).

`contacts-db.mjs`: `upsertContact(db, {email, phone, name})` →
- `nemail = normalizeEmail(email)`; if empty → return `null` (no contact without email).
- `INSERT INTO contacts (email,phone,name) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET
  last_seen=datetime('now'), name=COALESCE(contacts.name, excluded.name),
  phone=COALESCE(contacts.phone, excluded.phone)` then `SELECT id WHERE email=?` → return id.

## Write-path integration (best-effort — never breaks a booking/enquiry)

In `book.js` and `enquiry.js`, **after** the existing successful insert, wrap in try/catch:
`const cid = await upsertContact(env.DB, {email, phone, name}); if (cid) await env.DB.prepare("UPDATE <table> SET contact_id=? WHERE id=?").bind(cid, rowId).run();`
Any failure is swallowed (logged) — the booking/enquiry already succeeded; `contact_id` stays
null and is backfillable. The race-safe booking insert is untouched. (`book.js` currently uses
a conditional insert without returning the row id via a simple handle — capture
`insert.meta.last_row_id` for the update.)

## Admin API — `functions/api/admin/contacts.js`

- `GET /api/admin/contacts` → list: `{contacts:[{id,name,email,phone,marketing_opt_in,last_seen,
  tags:[...],bookings_n,enquiries_n}]}`. Optional `?q=` (LIKE on name/email/phone), `?tag=`
  (filter by tag). `?format=csv` → `text/csv` download (id,name,email,phone,opt_in,first_seen,
  last_seen,tags), each cell via `csvCell`.
- `GET /api/admin/contacts?id=N` → detail: the contact + `tags` + a **timeline** = their
  `bookings` (ref,slot date/time,status,created_at) and `enquiries` (type,message,party_date,
  status,created_at), each tagged with a `kind`, sorted by date desc.
- `PUT /api/admin/contacts` `{id, notes?, marketing_opt_in?}` → update those fields.
- `POST /api/admin/contacts` `{id, action:'tag_add'|'tag_remove', tag}` → validated via
  `validateTag`; `tag_add` is `INSERT OR IGNORE` (unique index dedupes).
- `DELETE /api/admin/contacts?id=N` → **erase**: first `SELECT email FROM contacts WHERE id=N`
  to capture the normalized email, then run one `batch`:
  scrub `bookings` SET name='(erased)', email='(erased)', phone='(erased)', notes=NULL,
  child_age=NULL, children=NULL, contact_id=NULL `WHERE contact_id=N OR LOWER(TRIM(email))=?`;
  scrub `enquiries` SET name='(erased)', email='(erased)', phone=NULL, message=NULL,
  child_age=NULL, children=NULL, contact_id=NULL `WHERE contact_id=N OR LOWER(TRIM(email))=?`;
  `DELETE FROM contact_tags WHERE contact_id=N`; `DELETE FROM contacts WHERE id=N`. Returns
  `{ok:true}`. (Matching by email OR contact_id ensures no unlinked row keeps the person's PII.)

## Dashboard — Contacts section

`[data-contacts]` + `admin-contacts.js` (`window.OHPContacts.render`), wired into `refresh()`.
- A search box + tag filter + **Export CSV** link (`/api/admin/contacts?format=csv` with the
  token — fetched then offered as a Blob download).
- A list of contacts (name, email, last seen, booking/enquiry counts, tag chips). Click → a
  detail panel: contact info; **timeline** of bookings + enquiries; **tags** (chips with
  remove + an add input); **notes** (textarea + save); **marketing opt-in** toggle; and an
  **Erase** button with a strong typed/explicit confirm ("This permanently removes this
  person's personal data from contacts, bookings and enquiries and can't be undone.").
- `createElement`/`textContent` only (CSP). CSV download built client-side from the fetched
  text as a `Blob` + temporary `<a download>`.

## Legal — `privacy.html`

Extend the existing "How we use your information" / lawful-basis content to state: we keep a
**contact record** of people who book or enquire (to manage bookings and our relationship —
legitimate interest/contract); we do **not** use it for marketing unless you opt in; we keep
it only as long as needed for that relationship; and you can ask us to **erase** your details
at any time (which removes your personal data from our records). No fixed number invented.

## Edge cases & decisions

- **Erasure keeps operational rows anonymized**, not deleted — a defensible balance (right to
  erasure vs. keeping a non-identifying record that a slot was booked). Documented; owner can
  request full-delete behavior instead if preferred.
- **Backfill safety:** every existing row has an email (both forms require it), so the
  email-keyed backfill links everything; rows with a blank email (shouldn't exist) are left
  `contact_id` NULL, harmlessly.
- **Upsert never blocks** a booking/enquiry (try/catch; revenue path protected).
- **Tag input** normalized + validated; duplicates ignored by the unique index.
- **CSV injection:** `csvCell` strips CR/LF and quotes; additionally prefix a leading
  `=,+,-,@` cell with a space to neutralize spreadsheet formula injection.

## Testing / verification

- `node --test tests/contacts-core.test.mjs`: normalizeEmail/Phone, csvCell (quotes, commas,
  newlines, formula-injection prefix), validateTag (good + rejects).
- Local `wrangler pages dev`: confirm backfill created contacts from the seeded bookings/
  enquiries and linked them; submit a NEW enquiry → a contact is upserted and linked;
  dashboard lists contacts, opens a detail with timeline, add/remove a tag, save a note,
  toggle opt-in, export CSV (opens/parses), and **Erase** a test contact → verify its PII is
  gone from `contacts`, `bookings`, and `enquiries` (query D1). Regression: booking + enquiry
  still succeed even though they now upsert a contact.
- After deploy: `/api/admin/contacts` 401 without token; migration `0006` applied; privacy
  page mentions erasure.

## Done =

The owner opens Contacts, sees every person who's booked or enquired (backfilled), can search/
tag/annotate them, export to CSV, and erase someone's personal data on request — with bookings
and enquiries now tied to a single contact record, and the privacy policy reflecting it.
