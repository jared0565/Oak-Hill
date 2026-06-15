# Admin Dashboard Redesign — Design Spec

**Date:** 2026-06-15
**Status:** Approved direction (sidebar + Overview home), pending spec review.

## Goal

Replace the admin dashboard's single long page of stacked sections with a modern,
properly-separated dashboard: a persistent **left sidebar** of sections, a slim
**top bar**, and a **content area that shows one section at a time**, fronted by an
**Overview home page** with at-a-glance KPI cards.

## Background — current state

`public/admin.html` renders one `<main>` containing, inside `[data-admin-app]`, eight
`<section class="admin-block" data-perm="…">` blocks (Availability, Reports, Bookings,
Messages, Contacts, Tracking, Users, Activity) stacked vertically. Each block is rendered
by its own vanilla-JS module (`OHPAvailability`, `OHPTracking`, `OHPReports`,
`OHPContacts`, `OHPUsers`, `OHPAudit`, plus bookings/messages handled inline in
`admin.js`). `admin.js` switches between setup / login / app views, applies permissions by
hiding `[data-perm]` blocks the user lacks, and eager-loads every section on sign-in.

Problems: everything loads at once; no separation; long scroll; doesn't read as a dashboard.

## Constraints (locked)

- **100% vanilla JS + CSS. No framework, no build step.** Fits the Cloudflare Pages static
  + Functions setup. Existing section modules keep working unchanged — only the shell
  around them changes and how/when they're invoked.
- **Server-enforced RBAC is unchanged.** The redesign is presentation + a read-only summary
  endpoint. Permission checks on every existing endpoint stay exactly as they are.
- **Keep the brand**, but give the admin a calmer, more app-like surface than the public
  site (data density over decoration).

## Design overview

A three-region shell replaces the stacked layout inside `[data-admin-app]`:

```
┌───────────────────────────────────────────────────────┐
│  ☕ Oak Hill · Admin                  Jared (owner) ▾   │  top bar
├──────────────┬────────────────────────────────────────┤
│  ▸ Overview   │  Overview                              │
│    Bookings   │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│    Messages   │  │  2   │ │  5   │ │  12  │ │  87  │   │  KPI cards
│    Availability│ │pend. │ │unread│ │ open │ │views │   │
│    Contacts   │  │books │ │ msgs │ │slots │ │ 7d   │   │
│    Reports    │  └──────┘ └──────┘ └──────┘ └──────┘   │
│    Tracking   │  Recent bookings  ·  Quick actions     │
│    Users      │                                        │
│    Activity   │  (selecting a nav item swaps this      │
│  ───────────  │   panel to that section, loaded lazily)│
│    Sign out   │                                        │
└──────────────┴────────────────────────────────────────┘
```

The setup (first-owner) and login views are untouched in behaviour; they get a light
restyle only so they sit on the same surface.

## Layout & navigation

- **Sidebar** (`<nav>`): brand wordmark at top, then one link per section, then a divider
  and **Sign out** at the bottom. Each item is an inline **SVG icon + label** (no icon
  font/library — small hand-written SVGs to stay build-free and CSP-clean).
- **Nav order:** Overview · Bookings · Messages · Availability · Contacts · Reports ·
  Tracking · Users · Activity. (Existing section H2 labels are kept; "Availability" stays
  "Availability", not "Calendar".)
- **Permission-filtered:** each item except Overview carries the section's permission key
  (`bookings`, `messages`, `availability`, `contacts`, `reports`, `tracking`, `users`,
  `audit`). Items the signed-in user lacks permission for are not rendered. Reuses the
  existing permission set on `currentUser.permissions`. Overview is always shown (it self-
  filters its cards). Result: Staff sees Overview + Bookings + Messages; a Manager sees all
  but Tracking/Users/Activity; an Owner sees everything.
- **Active state:** the current section's nav item is highlighted and carries
  `aria-current="page"`.
- **Top bar:** the brand/section title on the left; on the right the signed-in identity
  ("Jared (owner)") and a **Sign out** affordance. On mobile it also holds the hamburger
  that toggles the sidebar drawer.

## Overview home page

A new landing panel (`[data-perm]`-free; always the default route) with three parts:

1. **KPI cards** — each card is permission-gated and only renders if the user has the
   matching permission, so the Overview never shows a number the user couldn't otherwise
   see:
   - **Pending bookings** — count of `bookings.status = 'pending'` (awaiting deposit;
     actionable). Permission: `bookings`.
   - **Unread messages** — count of new/unread enquiries. Permission: `messages`.
   - **Open slots (next 14 days)** — upcoming availability slots not yet booked.
     Permission: `availability`.
   - **Visits (7 days)** — `page_view` analytics count over 7 days. Permission: `reports`.
   A user who only has `bookings` + `messages` sees exactly two cards, cleanly laid out.
2. **Recent bookings** — a compact list of the latest 5 bookings (ref, date, name, status),
   shown only with the `bookings` permission. Each row links into the Bookings section.
3. **Quick actions** — a small row of buttons that route to common tasks the user is
   permitted to do, e.g. "Manage availability" (`availability`), "View messages"
   (`messages`). Purely navigational (set the route); no new behaviour.

### Data source — new `GET /api/admin/overview`

One round-trip powers the Overview. A new endpoint
`functions/api/admin/overview.js` returns a summary object containing **only** the fields
the caller is permitted to see, computed server-side using the existing `can(role, perm)`
helper:

```
{
  "bookings":   { "pending": 2, "recent": [ {ref,date,name,status}, … ] },   // if can(bookings)
  "messages":   { "unread": 5 },                                             // if can(messages)
  "availability": { "openSlots14d": 12 },                                    // if can(availability)
  "reports":    { "visits7d": 87 }                                           // if can(reports)
}
```

Each block is omitted entirely when the user lacks that permission (server-enforced, not
just hidden in the UI). Queries reuse the same tables/patterns the existing endpoints use
(`bookings`, `enquiries`, availability slots, `analytics_events`). No new tables, no
migration. The endpoint is authenticated by the existing `admin/_middleware.js`; it adds no
new permission of its own — it gates each field by the corresponding section permission.

## Client-side routing & data loading

- **Hash router.** Each section panel has a stable id (`overview`, `bookings`, `messages`,
  `availability`, `contacts`, `reports`, `tracking`, `users`, `audit`). The route is
  `location.hash` (e.g. `#bookings`), so refresh and bookmarks work and the back button
  moves between sections.
- **Show one panel at a time.** A `hashchange` handler hides all panels, shows the matching
  one, and marks the matching nav item active.
- **Lazy load.** Section data loads on **first** navigation to it (tracked by a `loaded`
  set), not on sign-in — so the dashboard opens fast. The Overview loads when the app first
  shows. Each section reuses its existing module entry point (`OHPContacts.render()`,
  `loadBookings()`, etc.) — no change to those modules' internals.
- **Default & guards.** On entering the app (or with an empty/unknown/forbidden hash) the
  route defaults to `#overview`. If a hash names a section the user lacks permission for
  (e.g. a Staff user typing `#users`), the router redirects to `#overview`. The nav never
  shows forbidden items in the first place.

## Responsive behaviour

- **Desktop (≥ ~880px):** fixed sidebar (~240px) on the left; content fills the rest.
- **Mobile (< ~880px):** sidebar is off-canvas. A hamburger in the top bar toggles a
  slide-in drawer (`aria-expanded` on the toggle); selecting a nav item closes the drawer.
  Tables and cards reflow to full width.

## Visual design / theming

- New stylesheet **`public/assets/admin.css`**, loaded by `admin.html` **in addition to**
  `styles.css` (the admin still reuses `:root` brand tokens, `.button`, `.admin-table`,
  form styles). Keeping the shell styles in a dedicated admin file avoids bloating the
  shared public stylesheet.
- **Palette:** park-green (`--park`) as the accent for the active nav item, icons, and
  focus rings; a light sidebar surface (cream/paper or a soft neutral); white content area.
- **Type:** Inter throughout the admin (drop the Georgia serif used on the public site) for
  a denser, more utilitarian feel. Headings smaller and tighter than the public pages.
- **Cards:** white surface, `--line` border, `--radius`, subtle shadow; a large number and
  a muted caption.

## Architecture & files

| File | Change |
|------|--------|
| `public/admin.html` | Restructure `[data-admin-app]` into sidebar + top bar + content panels (one wrapper per section, each holding the existing `[data-*]` mount point). Add `admin.css`. Setup/login markup unchanged. |
| `public/assets/admin.js` | Build the permission-filtered nav; add the hash router (show-one-panel, active state, lazy-load, default/guard); invoke section modules on first visit; integrate Overview; keep setup/login/logout logic. |
| `public/assets/admin-overview.js` *(new)* | `OHPOverview` module: fetch `/api/admin/overview`, render permission-gated KPI cards, recent bookings, quick actions. |
| `public/assets/admin.css` *(new)* | Dashboard shell: sidebar, top bar, nav, content, cards, responsive drawer. |
| `functions/api/admin/overview.js` *(new)* | `GET` summary endpoint; per-field permission gating via `can()`. |

The six existing `admin-*.js` modules and every existing API endpoint are unchanged.

## Accessibility

- Sidebar is a `<nav aria-label="Sections">` of links/buttons; active item has
  `aria-current="page"`.
- Drawer toggle is a `<button aria-expanded>` with an accessible label.
- Routing keeps keyboard focus sensible (move focus to the panel heading on section change).
- Colour contrast for active/hover states meets WCAG AA against the chosen surfaces.

## Non-goals / out of scope

- No framework, bundler, or TypeScript.
- No changes to authn/authz, the section modules' internal rendering, or any existing
  endpoint's behaviour.
- No real-time/auto-refresh; data loads on navigation. (A manual refresh control per
  section can come later.)
- No redesign of the public website. No new metrics beyond the four Overview cards.

## Testing

- **Pure logic:** the nav/route permission filter (which sections a permission set may see,
  and the forbidden-hash → `#overview` guard) is extracted as a small pure function and
  unit-tested with `node --test`, mirroring the existing `auth-core` test style.
- **Overview endpoint:** verify each summary field appears only with its permission (Staff
  response has no `reports`/`availability` blocks; Owner has all).
- **Browser smoke (Playwright MCP / pages dev):** sign in as Owner → all nav items, routing
  swaps panels, lazy-load fires once, Overview shows four cards; sign in as Staff → only
  Overview + Bookings + Messages, Overview shows two cards, `#users` redirects to
  `#overview`; mobile width → drawer toggles; **zero CSP/console errors**.
