# Newsletter one-click unsubscribe — design (2026-06-15)

Backlog item **P3#8**. Builds the unsubscribe **handling** (endpoint + opt-out
state + token + public page) so it is ready the moment marketing email is
turned on. **Email/Resend stays OFF this session** — no send code, no API key.

## Why now / compliance basis

- **PECR reg. 22** requires a simple, free way to refuse/stop marketing email,
  available in every message — this is the launch-gate that must exist *before*
  any newsletter send.
- **RFC 8058** one-click unsubscribe: providers POST to the `List-Unsubscribe`
  URL (with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) — must succeed
  without further interaction.
- **UK GDPR Art. 7(3)** withdrawal of consent must be as easy as giving it, and
  recorded — we stamp `marketing_opt_out_at` as withdrawal evidence (mirrors the
  existing `marketing_opt_in_at`).

The prior lead-capture spec (`2026-06-14-e-lead-capture-design.md`) explicitly
deferred the unsubscribe link to "when email sending is enabled". This builds
everything except the send.

## Token scheme — stored random capability token

Each newsletter contact carries a 128-bit `unsub_token` (`lower(hex(randomblob(16)))`).
The link carries `?token=…`; the endpoint resolves the contact by token via a
unique index. Chosen over HMAC because it is **self-contained — works the instant
it deploys with no new Cloudflare secret for the owner to set** (an unset secret
would silently break a compliance feature), and the token is per-contact
revocable. 128 bits of entropy makes the capability URL unguessable; lookups are
indexed (no timing-oracle of consequence for a low-stakes, reversible action).

## Data model — migration `0011`

```sql
ALTER TABLE contacts ADD COLUMN marketing_opt_out_at TEXT;  -- withdrawal evidence
ALTER TABLE contacts ADD COLUMN unsub_token TEXT;           -- 128-bit capability token
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsub_token ON contacts(unsub_token);
-- backfill existing opted-in contacts so their links work the moment email is on
UPDATE contacts SET unsub_token = lower(hex(randomblob(16)))
  WHERE marketing_opt_in = 1 AND unsub_token IS NULL;
```

Additive only. The unique index tolerates many NULLs (SQLite treats NULLs as
distinct), so non-subscribers without a token are fine.

## API — `/api/unsubscribe` (public, token-gated, JSON)

Lives at `functions/api/unsubscribe.js`. Public (not under `/api/admin`, so the
session middleware never applies); the token is the authorization.

- `GET ?token=T` → `{ ok:true, subscribed:<bool>, emailMasked:"j***@x.com" }`.
  Lets the page show the right action. Unknown token → `404 {error}`.
- `POST ?token=T` → withdraw: `marketing_opt_in=0`, `marketing_opt_out_at=datetime('now')`.
  Idempotent (already-out stays out). Returns `{ ok:true, subscribed:false }`.
  **This is the RFC 8058 one-click target** — any POST with the token unsubscribes;
  the body is not required.
- `POST ?token=T&action=resubscribe` → `marketing_opt_in=1`,
  `marketing_opt_in_at=COALESCE(existing, now)`, `marketing_opt_out_at=NULL`.
  Escape hatch for accidental/ prefetched unsubscribes. Returns `{ ok:true, subscribed:true }`.
- Audited via `recordAudit`: `marketing.unsubscribe` / `marketing.resubscribe`,
  `target_type:"contact"`, `target_id:<id>`, `detail:"self-service"`. Actor is
  null (public, no session).
- Pure helper `maskEmail(email)` in a small core module (`unsubscribe-core.mjs`),
  unit-tested.

Email-scanner safety: state only changes on **POST**. A `GET` (which link
prefetchers/scanners issue) never unsubscribes — it only reports state — so
automated link-following can't opt people out. The human acts via the page's
button (a POST); automated clients use the RFC 8058 POST.

## Public page — `public/unsubscribe.html` + `assets/unsubscribe.js`

On-brand static page (full site CSP from `public/_headers`, links `styles.css`),
matching the existing static-page + small-JS-module pattern (cf. `consent.js`).

Flow: read `token` from the query → `GET /api/unsubscribe?token=…` → if subscribed,
show the masked email + an **Unsubscribe** button; if already out, show a
**Re-subscribe** button. The button POSTs to the API and the page swaps to a
confirmation ("You've been unsubscribed — changed your mind? Re-subscribe").
Missing/invalid token → friendly "This link is invalid or has expired." No
external JS; CSP `script-src 'self'` covers the module.

The email body's human link points here (`/unsubscribe.html?token=…`); the
`List-Unsubscribe` header points at the API (`/api/unsubscribe?token=…`).

## Signup path — `functions/api/lead.js`

On opt-in, also mint a token and clear any prior opt-out, so a re-signup is a
clean re-subscribe and every subscriber has a working link:

```sql
UPDATE contacts
   SET marketing_opt_in = 1,
       marketing_opt_in_at = datetime('now'),
       marketing_opt_out_at = NULL,
       unsub_token = COALESCE(unsub_token, lower(hex(randomblob(16))))
 WHERE id = ?
```

(`COALESCE` keeps a stable token across re-signups so previously-sent links keep working.)

## Admin — `functions/api/admin/contacts.js`

- PUT: when `marketing_opt_in` is set to `0`, also set
  `marketing_opt_out_at = datetime('now')`; when set to `1`, clear it (mirrors the
  existing `marketing_opt_in_at` handling). Manual opt-out stays consistent with
  self-service.
- Detail GET selects `marketing_opt_out_at`; the contact detail panel shows
  "Opted out on …" when present (read-only line in `admin-contacts.js`).

## Out of scope (email off) — documented for the future send path

- No Resend / `ENQUIRY_FROM`, no newsletter send, no `List-Unsubscribe` header
  injection. When send is wired, each message sets:
  - `List-Unsubscribe: <https://oak-hill-park-cafe.pages.dev/api/unsubscribe?token=T>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  - body link: `https://oak-hill-park-cafe.pages.dev/unsubscribe.html?token=T`
  using each recipient's `unsub_token` (mint via `COALESCE(...)` if null).

## Testing

- **Unit:** `maskEmail` (normal, no-local-part, short, non-email) in `tests/`.
- **Local (API + browser, 0 console errors):**
  1. migration `0011` applies; an opted-in contact gets a backfilled token.
  2. signup via `/api/lead` mints a token + clears opt-out.
  3. `GET /api/unsubscribe?token=T` → `subscribed:true`, masked email.
  4. `POST …?token=T` → opt-in `0`, `opt_out_at` set; idempotent on repeat.
  5. `POST …&action=resubscribe` → opt-in `1`, `opt_out_at` cleared.
  6. bad token → 404; audit rows written for both actions.
  7. `unsubscribe.html?token=T` renders on-brand, button works, confirmation shows.
  8. admin detail shows "Opted out on …".
- **Deploy:** push → CI green → migration `0011` applied to prod → live smoke
  (`/unsubscribe.html` renders; `/api/unsubscribe` 404s an unknown token).

## Success criteria

A subscriber (or an RFC 8058 one-click POST) can withdraw consent with a single
token-gated request that records the withdrawal, with a reversible on-brand page,
all without email being enabled — leaving only the header/link injection for the
day Resend is turned on.
