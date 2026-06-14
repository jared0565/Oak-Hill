# A2 — Public Calendar: Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Predecessor:** A1 (availability management) — shipped 2026-06-14.
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

Replace the embedded Google Calendar on the public `calendar.html` with our **own rendered
calendar** driven by D1 (`slots` + `calendar_events`), making the dashboard the single source
of truth for what's on. Desktop month grid, mobile upcoming-list. The existing booking picker
(`#book`, `booking.js`) is untouched.

## Scope

**In:**
- New **public** read endpoint `GET /api/calendar-events?from=&to=` (events + closures only).
- New `public/assets/calendar.js` — renders events, closures (closed-day shading), and an
  "open slots" marker into `calendar.html`; desktop grid + mobile list.
- Edit `calendar.html`: remove the Google iframe + its surrounding copy that references it,
  add the rendered-calendar container, load `calendar.js`.
- Edit `public/_headers`: remove `https://calendar.google.com` from `frame-src` (keep the
  Google Maps frame sources used by the contact page).
- Public calendar CSS in the site's visual voice.

**Out:**
- ICS import from the owner's Google Calendar — content is re-entered manually via the A1
  dashboard. (An ICS importer is a possible later add-on, not part of A2.)
- Any change to the booking flow, `/api/book`, `/api/slots`, or the admin side.
- Showing booking/customer details publicly (privacy) — only open-slot *availability* is shown.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `functions/api/calendar-events.js` | Public `GET /api/calendar-events?from=&to=` (events + closures) |
| Create | `public/assets/calendar.js` | Render the public calendar (grid + mobile list) |
| Modify | `public/calendar.html` | Replace the iframe section with the rendered-calendar container; load `calendar.js` |
| Modify | `public/_headers` | Drop `calendar.google.com` from `frame-src` |
| Modify | `public/assets/styles.css` | Public calendar styles (`.pubcal-*`) |

No new migration; no new D1 tables. No unit-test target (pure date helpers are small and
shared conceptually with A1's already-tested logic; verification is local `wrangler pages dev`
+ screenshots, per project convention).

## Public endpoint

`functions/api/calendar-events.js`:
```
GET /api/calendar-events?from=YYYY-MM-DD&to=YYYY-MM-DD
  -> { events: [{ id, kind, title, start_date, end_date, all_day, start_time, end_time }] }
```
- Returns rows from `calendar_events` overlapping `[from, to]` (same overlap predicate as the
  admin GET: `end_date >= from AND start_date <= to`), ordered by `start_date, start_time`.
- **`notes` is NOT returned** (may hold private operational notes) — only display fields.
- Validates `from`/`to` are `YYYY-MM-DD`; if absent or malformed, returns `{ events: [] }`
  rather than erroring (public, forgiving). `Cache-Control: no-store` (content changes).
- No auth (public read of public "what's on" info).

## Client rendering — `public/assets/calendar.js`

Finds a container (e.g. `[data-public-calendar]`) in `calendar.html`; if absent, no-ops.

- Fetches, for the visible month, **both** `/api/slots` (open bookable slots; already public)
  and `/api/calendar-events?from=&to=`. Merges by date.
- **Desktop (≥ 641px): month grid**, Mon-first (reuse A1's lead-blank math
  `lead = (firstDow + 6) % 7`, UTC date strings). Each day cell shows:
  - event chips (title; timed events show the time),
  - a "Closed" treatment on closure days (shaded + a "Closed" chip),
  - an **"Slots available"** marker if that date has ≥1 open slot from `/api/slots`.
  - Clicking a day that has open slots smooth-scrolls to `#book` (the existing picker). Other
    days are non-interactive.
  - prev/next month nav; today highlighted; past days dimmed.
- **Mobile (≤ 640px): an upcoming list** instead of the grid — chronological list of the next
  events/closures and open-slot days in the visible month, each a row with date + label.
- **Empty state:** "Nothing scheduled this month." with the month nav still available.
- Renders via `createElement`/`textContent` only (CSP: `script-src 'self'`); no `innerHTML`.
- The breakpoint is decided in JS via `matchMedia("(max-width: 640px)")`, re-rendering on
  change so a resize swaps grid↔list.

## `calendar.html` changes

The page currently has two sections: `#book` (the slot picker, **kept as-is**) and an
"Events & closures" section containing the Google `<iframe class="calendar-frame">`. In A2:
- Remove the `<iframe>`.
- Keep the "Events & closures" section heading/intro (reworded so it no longer says "Google
  calendar"); place `<div data-public-calendar></div>` where the iframe was.
- Add `<script src="assets/calendar.js" defer></script>` near the existing scripts.

## CSP / `_headers`

`frame-src` currently lists `https://maps.google.com https://www.google.com
https://calendar.google.com`. Remove **only** `https://calendar.google.com` (the contact
page's map still needs the maps/google frame sources). No other directive changes — the new
calendar is same-origin `fetch` (`connect-src 'self'` already covers it).

## Edge cases & decisions

- **Transitional content:** once the iframe is gone, the owner's old Google Calendar entries
  no longer appear publicly; they re-enter the ones they want in the dashboard. The rendered
  calendar shows whatever is in D1 (closures from A1 onward + any events added). This is the
  intended single-source cutover.
- **Closure vs open slot on the same day:** A1 already suppresses bookable slots on a closed
  date in `/api/slots`, so a closed day will have no "open slots" marker — consistent by
  construction.
- **Timezone:** UTC date-string handling, identical to A1.
- **Resilience:** if either fetch fails, show a friendly line ("Couldn't load the calendar —
  please call 0208 361 1013") rather than a blank/broken grid.

## Testing / verification

Local `wrangler pages dev` (config-driven, port 8788) seeded with a few events/closures/slots
(reuse the A1 verification data), then screenshots at desktop and mobile widths confirming:
grid renders events + closures + closed shading + open-slot markers; mobile shows the list;
clicking an open-slot day scrolls to `#book`; the Google iframe is gone; CSP no longer
references `calendar.google.com`. Deploy and repeat the public health checks.

## Done =

The public `calendar.html` shows a self-rendered calendar of events, closures, and open-slot
availability from D1 — no Google embed — looking at home in the site's design on both desktop
and mobile, with the booking picker still working above it.
