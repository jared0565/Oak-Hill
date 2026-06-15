# Newsletter send — design (2026-06-15)

The send half of **P3#8**: an admin compose-and-send for marketing email, on top
of the unsubscribe mechanism already shipped (`51615a0`/`0656fba`). Flips the
standing "email off" constraint — the owner has authorised enabling marketing
email and will provide a Resend key. Reuses the existing Resend-over-fetch
pattern (`functions/api/_lib/notify.mjs` / `buildEmailPayload`).

## Hard dependencies (owner / DNS — not code)

1. `RESEND_API_KEY` — Cloudflare Worker secret (reuse the same one the enquiry
   notifier uses). For local dev only, in gitignored `.dev.vars`.
2. `NEWSLETTER_FROM` — e.g. `Oak Hill Park Cafe <hello@oakhillparkcafe…>`. A
   marketing sender, separate from `ENQUIRY_FROM` (transactional) so they can differ.
3. **Resend sending-domain verification (SPF/DKIM DNS records)** — the owner's
   lane; the agent never touches DNS. Until verified, Resend only delivers from
   its test sender to the account's own address, so real broadcast is gated on this.

The endpoint **no-ops cleanly** without key/from (mirrors `sendEnquiryEmail`),
so shipping the code changes nothing until the owner configures it.

## Permission

New `newsletter` permission, **owner-only** (added to `auth-core.mjs` `ALL` →
owner; not manager/staff). Mass external email is the highest-stakes action,
on par with `tracking` (site-wide script injection) — owner-gated.

## Data model — migration `0012`

```sql
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
```

Campaign-level history only — no per-recipient rows (privacy + simplicity); the
`audit_log` records the action. A new row per send → no silent re-send.

## Pure core — `functions/api/_lib/newsletter-core.mjs` (unit-tested)

- `escapeHtml(s)` — HTML-escape owner text (no injection into the template).
- `renderNewsletter({ subject, bodyText, unsubUrl, cafeName, cafeAddress })` →
  `{ html, text }`. Body newlines → paragraphs; light inline-styled template
  (cafe header, escaped paragraphs, footer with cafe name + address + an
  `Unsubscribe` link to `unsubUrl`); plain-text version = body + unsubscribe URL
  + address. Footer (sender identity + unsubscribe) is always present.
- `buildBatchEmail({ from, to, subject, html, text, unsubUrl })` → a Resend email
  object including `headers: { "List-Unsubscribe": "<unsubUrl>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }` (RFC 8058).
  (Verified against the Resend docs: `/emails/batch` supports per-email `headers`
  and up to 100 emails/call; only `attachments`/`scheduled_at` are unsupported in
  batch — neither needed here.)
- `chunk(arr, n)` — for batching.
- `validateNewsletter({ subject, body })` — non-empty, length caps.

## Endpoint — `functions/api/admin/newsletter.js`

`requirePermission(ctx, "newsletter")` on every method.

- `GET` → `{ recipientCount, history: [...], configured: <bool>, fromConfigured }`.
  `recipientCount` = opted-in contacts; `configured` = key + from both present
  (so the UI can warn when sending would no-op).
- `POST { mode, subject, body }`:
  - `validateNewsletter`; reject empty.
  - **`mode:"dryrun"`** → build recipient list + per-recipient payloads, **send
    nothing**, return `{ recipientCount, sample: <first email, body redacted to
    headers+subject+unsubUrl>, sent:0 }`. Safe testing without hitting Resend.
  - **`mode:"test"`** → render once, send a single email to the acting owner's
    address (`ctx.data.user.email`) via Resend, subject prefixed `[TEST] `. The
    unsubscribe link uses the owner's own contact token if present, else a demo
    token with a "test" note. No campaign row. Lets the owner check formatting +
    inbox placement before broadcasting.
  - **`mode:"send"`** → query opted-in recipients (`marketing_opt_in=1`), `id`,
    `email`, `unsub_token`; **mint a token for any opted-in contact missing one**
    (`UPDATE … unsub_token = COALESCE(…, lower(hex(randomblob(16))))`); build one
    personalised email per recipient (their own `unsubUrl`); send via Resend
    `POST /emails/batch` in chunks of 100; tally `sent`/`failed`; insert a
    `newsletters` row; `audit_log` `newsletter.send` (detail = counts). Returns
    `{ recipientCount, sent, failed }`. Refuses when recipientCount is 0 or not
    `configured`.

Sending is synchronous + batched (a cafe list is small — hundreds at most, a few
batch calls within the request). If the list ever outgrows a single request,
revisit with a queue — out of scope now, noted.

## Admin UI — `public/assets/admin-newsletter.js` + `admin.html`

New nav item + panel "Newsletter" (gated `data-perm="newsletter"`), registered in
`admin.js` SECTIONS. Compose: subject input + body textarea, live opted-in
recipient count, a **"Send test to me"** button, and a **"Send to N subscribers"**
button behind a `confirm()`. A warning banner when not `configured`. Send history
list (subject · date · sent/failed) below. Built with `createElement`/`textContent`
like the other admin modules; uses `window.OHPAdmin.api`.

## Compliance / safety

- Owner-only; **opted-in recipients only**; opted-out never receive.
- Every email: `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` (RFC 8058)
  + body unsubscribe link (PECR reg.22) + cafe name & postal address (sender
  identity). Reuses the shipped `/api/unsubscribe` + `unsub_token`.
- Test-send-to-self + explicit count confirm + dryrun → guards against mis-sends
  (marketing email is irreversible). New campaign row per send (no resend button).
- Audited. Key never committed (CF secret / gitignored `.dev.vars`).

## Testing

- **Unit:** `escapeHtml` (injection), `renderNewsletter` (paragraphs, unsubscribe
  link + address present in both html & text), `buildBatchEmail` (List-Unsubscribe
  headers), `validateNewsletter`, `chunk`.
- **Local (no key needed):** seed 2–3 opted-in + 1 opted-out contact; `dryrun`
  → correct recipient count, opted-out excluded, each payload carries that
  recipient's unsubscribe link + the one-click header; campaign **not** recorded.
  Admin section renders (count, history, not-configured warning), 0 console errors.
- **Local (with key in `.dev.vars`):** one real `test` send to a reachable address
  via Resend's test sender; confirm List-Unsubscribe header present and the link
  resolves to the live unsubscribe page.
- **Deploy:** push → CI green → migration `0012` applied. Real broadcast stays
  gated on the owner setting the CF secret + `NEWSLETTER_FROM` + verifying the
  Resend domain (DNS).

## Success criteria

The owner can compose a message, preview it via a test-send, and broadcast it to
opted-in subscribers — each email carrying a working one-click unsubscribe and the
cafe's identity — with the send recorded, opted-out contacts excluded, and the
whole path no-opping safely until the Resend key + verified domain are in place.
