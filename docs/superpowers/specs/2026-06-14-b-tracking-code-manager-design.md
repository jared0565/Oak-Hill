# B — Tracking-Code Manager: Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

Let the owner paste arbitrary **Head/Body tracking snippets** (Google tag, Meta Pixel, etc.)
from the dashboard — scoped **global or to one page** — which the site then injects and
**executes**, **consent-gated**, on the public pages. The conventional "insert headers &
footers" model.

## Decisions already locked (architecture map)

- **Snippet model**, not structured per-provider ID fields; not a GTM container.
- **CSP: curated provider allowlist + `'unsafe-inline'`** (a static `_headers` change).
- **Consent-gated** per snippet (category `necessary` runs immediately; `analytics` /
  `advertising` wait for the existing Consent Mode banner).
- **`settings` k/v store is deferred** (B doesn't need it; tracking lives in `code_snippets`).

## Scope

**In:** `code_snippets` table; admin CRUD; a public read endpoint; a consent-gated client
**injector** (folded into the existing `consent.js`, replacing its hardcoded GA loader); a
dashboard "Tracking code" manager; the CSP allowlist; cookie/privacy policy updates.

**Out:** structured provider fields, GTM-container support, server-side injection, an ICS-like
import. No change to booking/calendar/CRM.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0004_code_snippets.sql` | `code_snippets` table |
| Create | `functions/api/_lib/snippet-core.mjs` | Pure validators + scope matcher (unit-tested) |
| Create | `functions/api/admin/code-snippets.js` | Admin CRUD (auth via `_middleware.js`) |
| Create | `functions/api/code.js` | Public `GET /api/code` — enabled snippets for injection |
| Modify | `public/assets/consent.js` | Replace hardcoded GA loader with the generic, consent-gated snippet injector |
| Create | `public/assets/admin-tracking.js` | Dashboard "Tracking code" manager UI |
| Modify | `public/admin.html` | Add the Tracking-code section; load the script |
| Modify | `public/assets/admin.js` | `refresh()` also calls `window.OHPTracking.render()` |
| Modify | `public/assets/styles.css` | Minor manager styles (reuse form/table styles) |
| Modify | `public/_headers` | CSP: curated allowlist + `'unsafe-inline'` |
| Modify | `public/cookies.html`, `public/privacy.html` | Legal: owner-managed, consent-gated tags incl. Meta Pixel |
| Create | `tests/snippet-core.test.mjs` | `node --test` for the pure helpers |

## Data model

```sql
-- migrations/0004_code_snippets.sql
CREATE TABLE IF NOT EXISTS code_snippets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  label            TEXT NOT NULL,                         -- owner's name, e.g. "Meta Pixel"
  code             TEXT NOT NULL,                         -- raw snippet, pasted verbatim
  placement        TEXT NOT NULL DEFAULT 'head',          -- head | body_start | body_end
  scope            TEXT NOT NULL DEFAULT 'global',        -- 'global' or a page path e.g. '/parties.html'
  consent_category TEXT NOT NULL DEFAULT 'advertising',   -- necessary | analytics | advertising
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_snippets_enabled ON code_snippets(enabled);
```

## Endpoints

**Admin** `functions/api/admin/code-snippets.js` (Bearer `ADMIN_TOKEN`):
`GET` (all rows), `POST` (create), `PUT` (`{id, ...}`), `DELETE` (`?id=`). Validates via
`validateSnippet`. `PUT` sets `updated_at = datetime('now')`.

**Public** `functions/api/code.js`: `GET /api/code` → `{ snippets: [{ id, code, placement,
scope, consent_category }] }` for `enabled = 1` only. No auth — the code runs on public pages,
so it is inherently public (tag IDs are not secrets; **no field here is sensitive**). `label`
is omitted (owner-facing only). `Cache-Control: no-store`.

## Pure helpers — `snippet-core.mjs` (unit-tested)

```
validateSnippet(body) -> { ok, value?: {label, code, placement, scope, consent_category, enabled}, error? }
```
- `placement ∈ {head, body_start, body_end}`; `consent_category ∈ {necessary, analytics, advertising}`.
- `scope` is `'global'` or a path matching `^/[a-z0-9-]*\.html$` or `'/'`.
- `code` non-empty, ≤ 10000 chars; `label` non-empty ≤ 80; `enabled` coerced to 0/1.

```
pageMatchesScope(scope, pathname) -> boolean
```
- `true` if `scope === 'global'`. Otherwise normalize both sides for Cloudflare's clean URLs:
  strip a trailing `/`, treat `'/'` and `'/index.html'` as equal, and compare `pathname`
  against `scope` both with and without the `.html` suffix. (CF serves `/parties.html` but
  redirects to `/parties`, so the injector must match either form.)

## The injector (in `consent.js`)

`consent.js` already runs on every **public** page (not the admin page), sets Consent Mode v2
defaults, and renders the consent banner. We **remove its hardcoded `GA_MEASUREMENT_ID`
loader** and add a generic injector:

1. On first `applyConsent(consent)` (stored choice on load, or after the user decides), `fetch('/api/code')` **once** and cache the list.
2. For each snippet where `pageMatchesScope(scope, location.pathname)` **and** the category is
   granted — `necessary` always; `analytics` if `consent.analytics`; `advertising` if
   `consent.advertising` — and which hasn't been injected yet, **inject and execute** it.
3. **Execution mechanism (no `innerHTML`):** parse the snippet with
   `new DOMParser().parseFromString(code, 'text/html')` (inert — scripts don't auto-run), then
   walk `head`+`body` child nodes: for each `<script>`, create a fresh `document.createElement('script')`,
   copy its attributes and `textContent`, and append (this is what actually executes it, now
   permitted by `'unsafe-inline'` + the host allowlist); other nodes (`<noscript>`, `<img>`,
   `<meta>`) are `importNode`'d and appended.
4. **Placement:** `head` → `document.head`; `body_start` → prepend to `document.body`;
   `body_end` → append to `document.body`.
5. Re-runs on consent change (the banner's save/accept), injecting newly-granted snippets;
   a `Set` of injected ids prevents duplicates. Keeps the Consent Mode v2 `gtag` defaults so
   Google tags that load post-consent still behave correctly.

## Dashboard — "Tracking code" manager

New section in `admin.html` (`[data-tracking]`), driven by `admin-tracking.js`, wired into
`admin.js`'s `refresh()` like the availability module. Lists snippets (label, scope,
placement, category, enabled) with edit/delete/enable-toggle, and an add form: **Label**,
**Code** (textarea), **Placement** (head / body start / body end), **Scope** (Global, or a
dropdown of the public pages → their `/x.html` path), **Consent category** (Necessary /
Analytics / Advertising), **Enabled** (checkbox). A short warning line notes that pasted code
runs on the live site and only known ad/analytics providers are permitted by the CSP.

## CSP — curated allowlist (`_headers`)

`script-src` gains `'unsafe-inline'` (required to execute pasted inline JS) plus the provider
script hosts; `connect-src`, `img-src`, and `frame-src` gain the matching beacon/pixel/frame
hosts. Providers covered out of the box: **Google** (Analytics, Ads, gtag/GTM loader),
**Meta/Facebook Pixel**, **Microsoft** (Bing UET, Clarity), **TikTok**, **LinkedIn**,
**Hotjar**. Concretely the new CSP is:

```
default-src 'self';
img-src 'self' data: https://oak-hill-park-cafe.pages.dev https://maps.gstatic.com https://maps.googleapis.com https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://www.google.co.uk https://googleads.g.doubleclick.net https://www.facebook.com https://px.ads.linkedin.com https://analytics.tiktok.com https://t.tiktok.com https://bat.bing.com https://*.clarity.ms https://*.hotjar.com;
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://connect.facebook.net https://snap.licdn.com https://analytics.tiktok.com https://bat.bing.com https://www.clarity.ms https://*.clarity.ms https://static.hotjar.com https://script.hotjar.com;
style-src 'self' 'unsafe-inline';
frame-src https://maps.google.com https://www.google.com https://td.doubleclick.net https://www.facebook.com;
connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://www.facebook.com https://px.ads.linkedin.com https://analytics.tiktok.com https://t.tiktok.com https://bat.bing.com https://*.clarity.ms https://*.hotjar.com https://*.hotjar.io wss://*.hotjar.com;
base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

A brand-new provider not in this list needs one line added to `_headers` (documented in the
dashboard warning). `'unsafe-inline'` is an accepted, documented trade-off here (the site has
near-zero XSS surface — static HTML, DOM built via `textContent`/`createElement`).

## Legal (`cookies.html`, `privacy.html`)

- `cookies.html`: keep the strictly-necessary + analytics sections; broaden "Advertising" to
  say optional marketing/analytics tags are **owner-managed and set only with consent**, may
  include **Google, Meta/Facebook Pixel, Microsoft, TikTok, LinkedIn or similar**, and are
  listed here when active. Reflect that "off by default unless you allow it" still holds.
- `privacy.html`: note third-party tags (incl. Meta Pixel) may process data under consent,
  with the providers' own policies, withdrawable via Cookie settings.

## Edge cases & decisions

- **Admin page excluded:** `consent.js` isn't loaded on `admin.html`, so tracking never runs
  in the dashboard. Good by construction.
- **Bad/garbage snippet:** a malformed paste simply does nothing (DOMParser is lenient); it
  can't break the page (parsing is inert; only rebuilt `<script>`s run). The CSP still
  constrains external loads to allowlisted hosts.
- **Consent withdrawal mid-session:** already-injected scripts can't be "unloaded"; document
  that withdrawal stops *future* injection and clears Consent Mode signals (standard for tag
  managers). The banner copy already frames consent as forward-looking.
- **Scope clean-URL matching:** handled by `pageMatchesScope` (see above); unit-tested.

## Testing / verification

- `node --test tests/snippet-core.test.mjs`: `validateSnippet` (each field + rejections) and
  `pageMatchesScope` (global, exact, `.html`↔clean, home `/`↔`/index.html`, non-match).
- Local `wrangler pages dev`: add a harmless **inline test snippet** (e.g. a `<script>` that
  sets `window.__ohpTest`) as `necessary`+`global`, confirm it executes on a public page;
  add an `analytics` snippet, confirm it does NOT run until analytics consent is given, then
  does after Accept. Confirm `/api/code` returns enabled snippets without a token. Confirm the
  admin page never injects. Screenshot the dashboard manager.
- After deploy: re-check CSP header on the live site; confirm a real GA4 snippet (if the owner
  provides one) loads post-consent with no CSP violations in the console.

## Done =

The owner can paste a Head or Body tracking snippet in the dashboard, scope it global or to a
page, set its consent category, and see it execute on the live site only after the matching
consent — with the CSP permitting the major ad/analytics providers and the cookie/privacy
policies updated to match.
