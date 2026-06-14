# A1 — Availability Management (Dashboard): Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

Give the owner one place in the dashboard to manage everything that drives the calendar:
**bookable party slots** (with bulk/recurring add, edit, and status changes) and **general
events + closures**, shown in a **visual month-grid editor**. A **closure** automatically
stops a day's slots being bookable. Ships standalone — the public site keeps working exactly
as it does today; A2 later renders a public calendar from this data.

## Scope

**In:**
- New `calendar_events` table (events + closures) with admin CRUD.
- Closure → booking suppression rule applied to the existing public `/api/slots` and `/api/book`.
- Bulk/recurring slot generation; single-slot add (kept); slot edit; slot status change.
- Month-grid availability editor in `admin.html`, replacing the current single "Add a party
  slot" form and the flat "Slots" table (both subsumed by the grid).
- CI step to apply D1 migrations on deploy (decision D5).
- Unit tests for the pure logic (recurrence expansion, closure check, validation).

**Out (explicitly):**
- Public calendar rendering / retiring the Google embed → **A2**.
- `contacts`/backfill (→ D), `settings` store (→ B), multi-section dashboard nav refactor.
- Online payments, per-slot capacity (a slot stays one exclusive party), partial-day closures.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0003_calendar_events.sql` | `calendar_events` table + indexes |
| Create | `functions/api/_lib/availability-core.mjs` | Pure, unit-tested helpers (no Workers globals) |
| Create | `functions/api/admin/calendar-events.js` | Admin CRUD for events/closures |
| Modify | `functions/api/admin/slots.js` | Add bulk-generate (POST) + edit (PUT) |
| Modify | `functions/api/slots.js` | Exclude slots on closed dates |
| Modify | `functions/api/book.js` | Reject booking a slot on a closed date |
| Create | `public/assets/admin-availability.js` | Month-grid editor + bulk-add UI |
| Modify | `public/admin.html` | Availability section container; load the new script |
| Modify | `public/assets/styles.css` | Calendar-grid styles |
| Modify | `.github/workflows/deploy.yml` | `d1 migrations apply` step before deploy |
| Create | `tests/availability-core.test.mjs` | `node --test` for the pure helpers |

## Data model

```sql
-- migrations/0003_calendar_events.sql
CREATE TABLE IF NOT EXISTS calendar_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'event',   -- 'event' | 'closure'
  title      TEXT NOT NULL,
  start_date TEXT NOT NULL,                    -- YYYY-MM-DD
  end_date   TEXT NOT NULL,                    -- YYYY-MM-DD (== start_date for one day)
  all_day    INTEGER NOT NULL DEFAULT 1,       -- 1 = all day; 0 = timed (events only)
  start_time TEXT,                             -- HH:MM when all_day = 0
  end_time   TEXT,                             -- HH:MM when all_day = 0
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calevents_dates ON calendar_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calevents_kind  ON calendar_events(kind);
```

- `slots` is **unchanged structurally** — bulk-add and edit reuse the existing columns.
- **Closures are day-level.** A closure blocks the whole day regardless of any time fields;
  `all_day`/times are meaningful only for `kind='event'`. (Partial-day closures are out of scope.)
- Migrations use `CREATE TABLE IF NOT EXISTS`, so the new CI apply step (below) is **idempotent**
  and safe even if `0001`/`0002` were first applied by hand (no migrations-tracking table yet).

## The closure → booking suppression rule (the one real piece of logic)

A date `D` is **closed** iff a `calendar_events` row exists with `kind='closure'` and
`start_date <= D <= end_date`. Computed at query time (no slot mutation), so closures can be
added/removed freely.

- **`GET /api/slots`** adds:
  `AND NOT EXISTS (SELECT 1 FROM calendar_events c WHERE c.kind='closure' AND c.start_date <= slots.date AND c.end_date >= slots.date)`
- **`POST /api/book`** re-checks at booking time (a closure may be added after the list loaded):
  if the chosen slot's date is closed, return **409** `{ error: "Sorry, that date is now closed. Please choose another." }`.
- **A closure never cancels an existing confirmed or pending booking.** It only suppresses
  *new* bookings. Where a closure overlaps a confirmed/held booking, the dashboard shows a
  warning marker so the owner resolves it by hand. (Don't auto-cancel someone's paid party.)

## Pure helpers — `availability-core.mjs` (unit-tested)

```
expandRecurrence({ startDate, endDate, weekdays, times }) -> [{ date, start_time, end_time, label }]
```
- `weekdays`: array of 0–6 (0 = Sunday, matching `Date.getUTCDay`).
- `times`: array of `{ start, end, label }` (HH:MM).
- For each date from `startDate`..`endDate` inclusive whose weekday ∈ `weekdays`, emit one
  row per time template. **Skips past dates** (< today). Caller dedupes against existing
  slots (same `date`+`start_time`+`end_time` is not re-inserted).
- Throws on: `endDate < startDate`, empty `weekdays`, empty `times`, any `end <= start`.
- Sanity cap: refuse to generate more than **500** slots in one call (guards a fat range).

```
isDateClosed(date, closures) -> boolean        // closures = [{start_date, end_date}]
validateCalendarEvent(body) -> { ok, error? }  // kind, title, dates, optional times
validateSlotEdit(body) -> { ok, error? }       // editable fields + formats
normalizeWeekdays / parseTimes                 // small input coercers
```

## API surface

All `/api/admin/*` stay behind the existing `ADMIN_TOKEN` Bearer middleware.

**`functions/api/admin/slots.js`** (extend):
- `GET` — unchanged (slots + `holds`).
- `POST` — **backward compatible**: if `body.recurrence` is present
  (`{ start_date, end_date, weekdays, times }`) → expand via `expandRecurrence`, insert all
  new (deduped) rows in one `DB.batch`, return `{ ok, added, skipped }`. Otherwise behaves as
  today (single slot).
- `PUT` — **new** `{ id, start_time?, end_time?, label?, status? }`:
  - `label` may change any time.
  - `start_time`/`end_time`/`status` changes are **rejected if the slot has a confirmed
    booking** (`status='booked'`) — same guard style as the existing `DELETE`.
  - `status` may be set to `closed` (manually take a single slot off) or back to `available`
    (only if not booked). Validate `end_time > start_time`.
- `DELETE` — unchanged.

**`functions/api/admin/calendar-events.js`** (new): `GET` (optionally `?from=&to=` to bound a
month), `POST` (create), `PUT` (update by `id`), `DELETE` (`?id=`). Validates via
`validateCalendarEvent`. `end_date` defaults to `start_date`.

**Public:** `functions/api/slots.js` + `functions/api/book.js` gain the closure rule above.
No public endpoint for `calendar_events` in A1 (that arrives with A2).

## Dashboard: month-grid editor

`admin.html` gains an **Availability** section (`[data-availability]`) loaded by a new
`admin-availability.js`; the old "Add a party slot" form and "Slots" table are removed
(subsumed). Bookings + Messages sections are untouched.

- **Grid:** a 7-column month view. Header shows the month with prev/next nav. Each day cell
  shows the date and a chip per slot, colour-coded by status — **available** (green),
  **held** (amber, available + ≥1 pending hold), **booked** (red), **closed** (grey) — plus a
  marker for any event/closure. Today is highlighted; past days dimmed; closed days tinted.
- **Interactions:** click a day → a panel for that date with: its slots (each with
  edit/delete), an **Add slot** mini-form (start, end, label), and an **Add event / closure**
  mini-form (kind, title, all-day or times, notes). Click an existing slot/event chip →
  edit or delete it.
- **Bulk-add tool:** a form with start date, end date, weekday checkboxes, and a repeatable
  list of time templates (`start`–`end`–`label`, add/remove rows) → `POST /api/admin/slots`
  with `recurrence` → toast `added/skipped` → refresh.
- **Data:** loads `/api/admin/slots` and `/api/admin/calendar-events`; renders the visible
  month. Re-fetches after every mutation. Renders via `createElement`/`textContent` only
  (no `innerHTML`), consistent with the existing admin code and the strict CSP.
- **Responsive:** the grid scales down on narrow screens (cells stack to a scrollable column
  below ~560px). A polished public mobile view is an A2 concern.

## CI — apply migrations on deploy (D5)

Add a step to `.github/workflows/deploy.yml` **before** the Pages deploy, using the same
token (already scoped for D1: Edit):

```yaml
- name: Apply D1 migrations
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    wranglerVersion: "4.100.0"
    command: d1 migrations apply oak-hill-bookings --remote
```

Idempotent (see Data model). If it ever fails, the deploy step still runs separately — but we
keep them ordered so schema lands before code that needs it.

## Edge cases & decisions

- **Closure over a booked slot:** suppress new bookings only; never auto-cancel; dashboard
  warns. **Editing a booked slot's time:** rejected. **Editing a slot with only pending
  holds:** allowed (holds reference `slot_id`, not the time).
- **Bulk-add dedupe:** identical `date`+`start_time`+`end_time` is skipped, reported in
  `skipped`. **Past dates** are skipped by `expandRecurrence`.
- **Timezone:** keep the existing UTC date-string approach (`new Date().toISOString().slice(0,10)`
  for "today"; lexicographic `YYYY-MM-DD` comparisons). The known midnight-UTC boundary nuance
  is unchanged in A1 and noted for a later pass.
- **Validation everywhere server-side** (dates `^\d{4}-\d{2}-\d{2}$`, times `^\d{2}:\d{2}$`,
  `kind ∈ {event,closure}`), mirroring the current endpoints' style.

## Testing

`tests/availability-core.test.mjs` (`node --test`), covering: recurrence expansion (weekday
filter, range bounds, multiple times, past-date skip, the 500 cap, error throws); `isDateClosed`
(inside range, boundaries, none); `validateCalendarEvent` and `validateSlotEdit` (good +
each rejection). DB-touching endpoints are exercised by hand on a real deploy (the project's
convention), with race-safety preserved by the existing conditional-write patterns.

## Done = 

Owner can, in the dashboard: see a month grid, add a single slot, bulk-add recurring slots,
edit/close/delete a slot, and add/edit/delete events and closures. A closure immediately
stops that day's slots being bookable on the live public page and via the API. Migrations
apply automatically on deploy. Pure logic is covered by passing `node --test`.
