# C — Analytics & Reporting: Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

Give the owner a **Reports** dashboard over their own data: visits and traffic sources
(first-party, cookieless), plus enquiry and booking conversions (from existing tables) — one
business view GA4 can't provide. First-party traffic is **cookieless and always-on** per the
owner's decision.

## Compliance (UK GDPR / PECR) — NON-NEGOTIABLE

The owner's standing instruction is "let's be compliant always." Cookieless first-party
counting is consent-exempt **only** if ALL of these hold; they are hard requirements, not
guidance:

1. **No cookies and no `localStorage`/`sessionStorage`** written by the tracker. (Writing to
   the device is what triggers PECR consent.)
2. **No IP address persisted.** `/api/track` must never read/store `cf-connecting-ip` or any
   client IP. Cloudflare may see it in transit; we do not record it.
3. **No unique-visitor identifier or fingerprint.** We count page views, not identified
   people. (We therefore do not report "unique visitors".)
4. **Source is a host or campaign token only** — the referrer **hostname** (e.g.
   `google.com`) or `utm_source`. Never store the full referrer URL (its query string can
   carry personal data).
5. **No free-form payload.** Stored fields are exactly `name, path, source, ts`. No `meta`/
   JSON blob in v1, so nothing personal can be captured by accident.
6. **Accurate policies.** `cookies.html` + `privacy.html` state that anonymous, cookieless
   visit counting runs without consent (nothing stored on device, no personal data), and that
   the optional GA4 path (via B) is separate and consent-gated.

Anything that would store on-device or identify a person must instead be consent-gated.

## Scope

**In:** `analytics_events` table; public cookieless `POST /api/track`; a page-view tracker
folded into `script.js` (loaded on all 9 public pages) + one `slot_selected` hook in
`booking.js`; an admin `GET /api/admin/reports`; a dashboard Reports section; cookie/privacy
notes.

**Out:** unique-visitor counts, sessions, IP/geo, dwell time, any on-device storage; `contact_id`
linkage (→ D). No change to booking/calendar/tags.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0005_analytics_events.sql` | `analytics_events` table |
| Create | `functions/api/_lib/analytics-core.mjs` | Pure helpers (deriveSource, validateTrackName, sanitizeDays) + tests |
| Create | `functions/api/track.js` | Public cookieless `POST /api/track` |
| Create | `functions/api/admin/reports.js` | Admin `GET /api/admin/reports?days=N` aggregation |
| Modify | `public/assets/script.js` | Page-view beacon on load + `window.OHPTrack(name)` |
| Modify | `public/assets/booking.js` | Fire `slot_selected` on slot choose |
| Create | `public/assets/admin-reports.js` | Reports dashboard UI |
| Modify | `public/admin.html` | Reports section; load the script |
| Modify | `public/assets/admin.js` | `refresh()` also calls `window.OHPReports.render()` |
| Modify | `public/assets/styles.css` | Report styles |
| Modify | `public/cookies.html`, `public/privacy.html` | Anonymous cookieless-counting note |
| Create | `tests/analytics-core.test.mjs` | `node --test` for the pure helpers |

## Data model

```sql
-- migrations/0005_analytics_events.sql
-- First-party, cookieless, anonymous events. No IP, no user-id, no full URLs (see Compliance).
CREATE TABLE IF NOT EXISTS analytics_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,                       -- page_view | slot_selected
  path   TEXT,                                -- page path, e.g. /parties
  source TEXT,                                -- referrer host or utm_source ('direct' if none)
  ts     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts   ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name);
```

## Pure helpers — `analytics-core.mjs` (unit-tested)

```
deriveSource(referrer, utm, selfHost) -> string
```
- If `utm` non-empty → return it (lowercased, ≤ 60 chars).
- Else if `referrer` parses to a hostname that is NOT `selfHost` → return that hostname (≤ 120).
- Else → `"direct"`. (Internal/self referrers and empty referrers count as direct.)
- Never returns a full URL or query string.

```
TRACK_NAMES = { page_view, slot_selected }      // allowlist
validateTrackName(name) -> boolean
sanitizeDays(d) -> 7 | 30 | 90                  // default 30 on anything else
```

## Public endpoint — `POST /api/track`

- Body: `{ name, path, referrer, utm }`. Reject (silently, `204`) if `name` not in the
  allowlist. **Never reads `cf-connecting-ip`.** Server computes
  `source = deriveSource(referrer, utm, <request host>)`, clamps `path` (≤ 200) and `source`,
  inserts `{name, path, source}`, returns **`204 No Content`** (lightweight; nothing to read).
- Idempotency/abuse: name allowlist + length clamps. (For a cafe this is sufficient; no IP
  means no IP-based rate-limit — acceptable; events are cheap and the report tolerates noise.)

## Client tracker (in `script.js`)

A self-contained block, no consent check (cookieless, always-on), **sets nothing on the device**:
- On load: `navigator.sendBeacon('/api/track', JSON.stringify({ name:'page_view',
  path: location.pathname, referrer: document.referrer, utm: <utm_source from location.search> }))`
  with a `fetch(..., {method:'POST', keepalive:true})` fallback. Wrapped in try/catch; failure
  is silent (never affects the page).
- Exposes `window.OHPTrack(name)` that POSTs `{name, path: location.pathname}` the same way,
  for funnel events.
- `booking.js` calls `window.OHPTrack('slot_selected')` inside its `choose()` handler.

## Admin endpoint — `GET /api/admin/reports?days=N`

`days` via `sanitizeDays`. With `cutoff = datetime('now','-N days')`, returns:
```
{
  days, 
  visits,                       // COUNT page_view since cutoff
  slotSelected,                 // COUNT slot_selected since cutoff
  topPages: [{path, n}],        // page_view GROUP BY path, top 8
  topSources: [{source, n}],    // page_view GROUP BY source, top 8
  enquiries,                    // COUNT enquiries since cutoff
  bookings: { pending, confirmed, cancelled }  // COUNT bookings since cutoff GROUP BY status
}
```
Conversions come straight from the `bookings`/`enquiries` tables, so they're complete and
accurate regardless of tracking.

## Dashboard — Reports section

New section in `admin.html` (`[data-reports]`), `admin-reports.js` exposing
`window.OHPReports.render`, wired into `admin.js` `refresh()`. A period switch (7 / 30 / 90
days) re-fetches. Renders headline numbers (Visits, Enquiries, Bookings: pending/confirmed),
a simple funnel (Visits → Slot selected → Bookings), and Top pages / Top sources lists. All
via `createElement`/`textContent`.

## Legal

- `cookies.html`: add a short "Counting visits (no cookies)" note in/near Strictly-necessary:
  we count anonymous page visits with **no cookies and no personal data** to see which pages
  help families; this needs no consent because nothing is stored on your device. Leave the
  consent-gated GA4 "Analytics" section as-is.
- `privacy.html`: one sentence that anonymous, cookieless visit counts are kept with no IP or
  identifying data.

## Edge cases & decisions

- **Tracker never breaks the page:** all sends are try/caught and fire-and-forget; a blocked
  or failed beacon is ignored.
- **Bots/prefetch** may inflate page views slightly; acceptable for a cafe (no IP to filter
  on, by design). Documented, not "fixed".
- **`script.js` coverage:** confirmed on all 9 public pages (not `admin.html`), so the admin
  dashboard is never counted.
- **Timezone:** SQL `datetime('now','-N days')` (UTC), consistent with the rest of the app.

## Testing / verification

- `node --test tests/analytics-core.test.mjs`: `deriveSource` (utm wins; external referrer →
  host; self/empty → direct; full URL never leaks), `validateTrackName`, `sanitizeDays`.
- Local `wrangler pages dev`: load a public page → confirm a `POST /api/track` page_view fires
  and **no cookie/localStorage is set** (check `document.cookie` empty + `localStorage` has no
  analytics key); choose a slot on `calendar.html` → `slot_selected` recorded; confirm
  `/api/track` works with **no** token and stores no IP (inspect a row — only name/path/source/ts).
  Then `GET /api/admin/reports?days=30` returns sensible aggregates; the dashboard renders.
- After deploy: confirm `POST /api/track` 204 publicly; reports endpoint 401 without token,
  works with token; cookie/privacy pages mention cookieless counting.

## Done =

The owner opens Reports in the dashboard and sees, for the chosen period: visits, top pages,
top traffic sources, enquiries, and bookings (pending/confirmed) with a simple funnel — backed
by cookieless, no-PII first-party tracking that needs no consent, plus their real booking data.
