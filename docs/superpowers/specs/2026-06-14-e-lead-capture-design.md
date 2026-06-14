# E — Lead Capture : Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning. The final sub-project.
> **Date:** 2026-06-14

## Goal

Let visitors opt in to "cafe news & party offers by email" via a footer signup on every public
page. Each signup becomes a CRM contact with **explicit marketing consent** recorded, a
`newsletter` tag, and a `lead_captured` analytics event — visible in Contacts and Reports.

## Compliance (UK GDPR / PECR) — marketing requires consent

- **Lawful basis = consent.** The signup form's *only* purpose is opting in; submitting it is
  the clear affirmative act. The copy states exactly what they're agreeing to. **No
  pre-ticked boxes** (there is no secondary box — the act itself is the opt-in).
- **Consent evidence:** record **`marketing_opt_in_at`** (when) + the `newsletter` tag (how);
  the contact's email is the who.
- **Withdrawable:** the policy says you can unsubscribe / be erased anytime; withdrawal today
  = owner sets `marketing_opt_in = 0` or erases the contact (D's erase). A one-click
  unsubscribe link is a future add for **when email sending is enabled** (Resend is currently
  off — no `ENQUIRY_FROM`).
- **Single opt-in** is used (no confirmation email, since email isn't configured) — valid
  under PECR; double-opt-in noted as a future enhancement.
- **No new tracking concerns:** `lead_captured` is the existing cookieless, no-PII analytics
  event (C) — it carries no identifier.

## Scope

**In:** `marketing_opt_in_at` column (migration); `POST /api/lead` (spam-gated, upsert contact
+ consent + tag + event); footer signup injected site-wide via `script.js`; `lead_captured`
added to the analytics allowlist + a Leads count in Reports; privacy/cookie wording.

**Out:** the offer popup (owner-chosen offer + brand call — offered as a follow-up); double
opt-in / unsubscribe email (needs email infra, currently off); any new PII fields.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0007_marketing_consent.sql` | `ALTER TABLE contacts ADD COLUMN marketing_opt_in_at TEXT` |
| Create | `functions/api/_lib/lead-core.mjs` | `validateLead` + tests (reuses enquiry-core `spamReason`) |
| Create | `functions/api/lead.js` | `POST /api/lead` |
| Modify | `functions/api/_lib/analytics-core.mjs` | add `lead_captured` to `TRACK_NAMES` (+ test) |
| Modify | `functions/api/admin/reports.js` | add `leads` count (contacts opted-in within the period) |
| Modify | `public/assets/admin-reports.js` | show a "Leads" stat |
| Modify | `public/assets/script.js` | inject footer signup form + submit handler + fire `lead_captured` |
| Modify | `public/assets/styles.css` | footer signup styles |
| Modify | `public/privacy.html`, `public/cookies.html` | marketing-consent wording |
| Create | `tests/lead-core.test.mjs` | `node --test` |

## Data model

```sql
-- migrations/0007_marketing_consent.sql
ALTER TABLE contacts ADD COLUMN marketing_opt_in_at TEXT;   -- when consent was given (evidence)
```
Additive, runs once via migration tracking (consistent with 0003–0006).

## Pure helper — `lead-core.mjs` (unit-tested)

```
validateLead(body) -> { ok, value?: { email, name }, error? }
```
- `email` required + must contain `@` and `.` (mirrors enquiry validation); `name` optional
  (≤ 100). Returns normalized `{ email: trimmed, name: trimmed|null }`.
- Spam is handled separately by **reusing `spamReason` from `enquiry-core.mjs`** (honeypot
  `company` + `elapsed_ms` timing) — not reimplemented.

## Endpoint — `POST /api/lead`

Body: `{ email, name?, company?, elapsed_ms? }`.
1. `if (spamReason(body)) return { ok: true }` (silent discard — same as enquiry).
2. `validateLead`; on failure → 400.
3. `cid = await upsertContact(env.DB, { email, name })` (D helper; dedups by email).
4. If `cid`: `UPDATE contacts SET marketing_opt_in = 1, marketing_opt_in_at = datetime('now')
   WHERE id = ?`; `INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, 'newsletter')`.
5. Return `{ ok: true }`. All wrapped so a failure returns a friendly error, never throws.
   (No IP stored; no cookie set.)

## Client — footer signup (in `script.js`)

A self-contained block (like the C tracker), runs on public pages only (script.js isn't on
`admin.html`):
- On load, find `.site-footer`; **prepend** a `.footer-signup` region:
  heading "Cafe news & party offers", a short line ("Get occasional emails about the cafe and
  party offers. Unsubscribe anytime.") **with a "See our privacy policy" link** (informed
  consent), an `email` input, a hidden honeypot (`company`, off-screen), and a "Sign me up"
  button + a status line. Record a load timestamp for `elapsed_ms`.
- Submit → `POST /api/lead` with `{ email, company, elapsed_ms }` → on `ok`, replace the form
  with "Thanks — you're on the list." and call `window.OHPTrack('lead_captured')`.
- Built with `createElement`/`textContent` (CSP). Sets no cookie/storage. Failures show a
  friendly message and never break the page.

## Analytics + Reports

- `analytics-core.mjs`: add `"lead_captured"` to `TRACK_NAMES` (so `/api/track` accepts it).
- `reports.js`: add `leads` = `COUNT(*) FROM contacts WHERE marketing_opt_in = 1 AND
  marketing_opt_in_at >= datetime('now', ?)`. `admin-reports.js`: show a "Leads" stat card.

## Legal

- `cookies.html` / `privacy.html`: state that newsletter signups are an **explicit opt-in
  (consent)** to receive cafe news/offers by email, that we record when consent was given,
  and that it can be withdrawn at any time (we'll stop emailing / erase on request; a
  one-click unsubscribe arrives when email is enabled). Marketing is **never** done without
  this opt-in.

## CRM integration

Leads are ordinary `contacts` with `marketing_opt_in = 1` + the `newsletter` tag, so they
appear in the **Contacts** dashboard (filterable by the `newsletter` tag via the existing
`?tag=` support), are CSV-exportable, and are erasable — no separate "leads" store.

## Edge cases & decisions

- **Re-signup / already a contact:** `upsertContact` dedups by email; re-submitting just
  refreshes `last_seen` and re-affirms opt-in (`marketing_opt_in_at` updated). Idempotent.
- **An existing booking/enquiry contact who signs up** becomes opted-in + tagged — correct
  (same person, now consented to marketing).
- **Spam:** honeypot + timing via shared `spamReason`; silent OK response to bots.
- **No footer on admin:** `script.js` isn't loaded there, so no signup form in the dashboard.

## Testing / verification

- `node --test tests/lead-core.test.mjs` (validateLead good/bad) + `analytics-core` test still
  passes with `lead_captured` added.
- Local `wrangler pages dev`: the footer form appears on a public page (not admin); submitting
  a valid email creates/updates a contact with `marketing_opt_in = 1`, `marketing_opt_in_at`
  set, and the `newsletter` tag (query D1); the contact shows in the Contacts dashboard with
  the tag and opt-in on; honeypot/instant submit is silently ignored; `lead_captured` is
  accepted by `/api/track`; Reports shows a Leads count. **Regression:** nav/share/contact
  form/page-view tracker still work after the `script.js` change.
- After deploy: `POST /api/lead` 204/200 publicly (no token), sets no cookie; policy pages
  mention consent/unsubscribe; migration `0007` applied.

## Done =

A visitor can sign up in the footer; their consent is recorded with a timestamp; they appear
as a tagged, opted-in contact in the CRM and in the Reports Leads count — fully consent-based
and withdrawable, completing the platform.
