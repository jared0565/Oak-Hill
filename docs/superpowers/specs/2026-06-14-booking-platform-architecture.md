# Oak Hill Park Cafe — Booking & Growth Platform: Architecture Map

> **Status:** Top-level architecture for review. This is the *map*, not the build.
> Each sub-project below gets its own design → plan → build → deploy cycle and its
> own detailed spec. This doc fixes the **boundaries, shared data model, cross-cutting
> concerns, open decisions, and build order** — and deliberately stops there.

**Date:** 2026-06-14
**Scope reality check:** This is for **one family cafe in Barnet**, not a SaaS product.
"CRM" means a contacts table plus dashboard views; "lead capture" means a form plus
maybe one offer popup. We design for that size and resist gold-plating.

---

## 1. Principles

1. **Extend, don't replace.** The existing booking engine (soft-hold, race-safe slot
   locking) is well-built. We grow the schema and dashboard around it.
2. **One person, one record.** A unified `contacts` table is the backbone. Bookings,
   enquiries, and leads all link to it. This is the load-bearing decision (§4).
3. **D1 is the source of truth.** Owner settings — including pasted tracking snippets —
   live in D1, so the owner changes them from the dashboard, not from code.
4. **Consent first.** Tracking does not run before the visitor consents. The existing
   Consent Mode v2 banner is the gate.
5. **Ship one subsystem at a time.** Every piece deploys independently and is usable on
   its own.

---

## 2. The six sub-projects (boundaries)

| # | Sub-project | Owns | Depends on |
|---|---|---|---|
| **A** | **Advanced booking + availability dashboard** | Recurring/bulk slot creation, day templates, blackout dates, optional per-slot capacity, a calendar-grid editor in the dashboard | Foundation (settings, dashboard shell) |
| **B** | **Tracking-code manager** | Free-text **Head/Body** code snippets the owner pastes (any tag), scoped **global or per-page**; parsed, consent-gated, injected so they execute; CSP allowlist; legal updates | Foundation, consent layer |
| **C** | **Analytics & reporting** | First-party event capture (`events` table) + a reporting view (booking funnel, conversions, sources); pasted GA4/Ads tags receive the same key events | Foundation, A, B |
| **D** | **CRM** | Unified `contacts` + timeline (bookings + enquiries + leads), tags, notes, simple segments, CSV export, right-to-erasure | Foundation |
| **E** | **Lead capture** | Newsletter/lead form + one optional offer popup, feeding `contacts` as leads | Foundation, D |
| **F** | **Platform foundation** *(folded into whichever starts first)* | `contacts` backbone + backfill, `settings` store, expanded dashboard shell, migration discipline | — |

**Foundation (F) is not built alone** — it rides along with the first feature so the first
deliverable is something visible, not plumbing.

---

## 3. Dashboard structure

Today: `admin.html` + `admin.js` — token sign-in, add-slot, slots/bookings/messages tables.

Target: the same single owner area grows into a **multi-section dashboard** (tabs or a
side nav), one section per subsystem:

```
Booking admin
├── Availability   (A: calendar editor, recurring/bulk slots, blackouts)
├── Bookings       (existing: confirm/cancel)
├── Messages       (existing: enquiries)
├── Contacts       (D: CRM — people, timeline, tags, notes, export)
├── Reports        (C: funnel, conversions, sources)
└── Settings       (B: Head/Body tracking snippets; general config)
```

Auth stays the **`ADMIN_TOKEN` Bearer** model for now (sessionStorage on the client,
`_middleware.js` on the server). A future upgrade to per-user logins is noted as
out-of-scope until the owner needs more than one account.

---

## 4. Shared data model (the backbone)

### 4.1 `contacts` — one record per person *(load-bearing)*

```
contacts(
  id            INTEGER PK,
  email         TEXT,            -- normalized: trim + lowercase
  phone         TEXT,            -- normalized: digits only
  name          TEXT,
  marketing_opt_in INTEGER DEFAULT 0,   -- explicit consent for marketing email
  first_seen    TEXT DEFAULT (datetime('now')),
  last_seen     TEXT DEFAULT (datetime('now')),
  notes         TEXT
)
```

- **Dedup key:** **normalized email is primary**; fall back to **normalized phone** when
  email is missing. (Email-or-phone "match either" is intentionally avoided — it merges
  unrelated people on shared/typo'd numbers.) Upsert on write: match → update `last_seen`;
  no match → insert.
- **Tags:** a small join table `contact_tags(contact_id, tag)` rather than a column, so a
  contact can carry several (e.g. `party-lead`, `repeat`, `newsletter`).

### 4.2 Existing tables evolve (not replaced)

- `bookings` → add `contact_id` (FK, nullable).
- `enquiries` → add `contact_id` (FK, nullable).
- **Backfill migration** (named, not hand-waved): walk existing `bookings` + `enquiries`,
  upsert a `contact` per person by the dedup key, set the FK. New writes upsert the
  contact in the same request that creates the booking/enquiry.

### 4.3 `settings` — owner-editable general config (key/value)

```
settings(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)
```

General flags/config (e.g. deposit amount, business hours). **Tracking snippets are NOT
here** — they get their own table (§4.4) because they are multi-row and scoped.

### 4.4 `code_snippets` — pasted Head/Body tracking code (sub-project B)

```
code_snippets(
  id               INTEGER PK,
  label            TEXT,           -- owner's name, e.g. "Meta Pixel", "GA4"
  code             TEXT NOT NULL,  -- the raw snippet, pasted verbatim
  placement        TEXT NOT NULL,  -- head | body_start | body_end
  scope            TEXT NOT NULL DEFAULT 'global',  -- 'global' or a page path e.g. '/parties.html'
  consent_category TEXT NOT NULL DEFAULT 'advertising', -- necessary | analytics | advertising
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at TEXT, updated_at TEXT
)
```

This is the "insert headers & footers" model: the owner pastes a snippet, picks where it
goes (Head / start or end of Body), whether it applies everywhere or to one page, and which
consent category controls it. See §6.2 for how snippets are served and executed.

### 4.5 `events` — first-party analytics (sub-project C)

```
events(
  id INTEGER PK,
  name TEXT,            -- page_view | slot_selected | booking_started | booking_submitted | enquiry_submitted | lead_captured
  contact_id INTEGER,   -- nullable; set when known
  path TEXT, source TEXT, ts TEXT DEFAULT (datetime('now')),
  meta TEXT             -- small JSON blob
)
```

Cheap, owned, survives ad-blockers. Pasted GA4/Ads tags receive the same key conversions in
parallel (§ Open decision D1).

### 4.6 `leads` — folded into `contacts`

A "lead" is a `contact` with a `party-lead`/`newsletter` tag and an `enquiries`/`events`
row — no separate table. Keeps the model small.

### 4.7 Migration strategy

Migrations are currently applied by hand (`deploy.yml` only runs `pages deploy`). As the
schema grows we add a **`wrangler d1 migrations apply --remote` step to CI** so schema and
deploy move together (Open decision D5).

---

## 5. How it interconnects (data flow)

```
 Visitor → public site
   │  page_view / slot_selected / booking_submitted / enquiry / lead
   ▼
 Pages Functions (/api/*)
   │  upsert contact (§4.1) ── writes ──► D1: contacts, bookings, enquiries, events
   │  GET /api/code ─── pasted snippets ──► consent-gated injector ──► GA4 / Ads / Pixel / any tag
   ▼
 Owner → /admin (Bearer ADMIN_TOKEN)
   reads/writes ──► D1 (availability, bookings, contacts, reports, settings, code_snippets)
```

---

## 6. Cross-cutting concerns

### 6.1 CSP — relaxed to a curated allowlist *(decided)*
To let the owner paste and run arbitrary Head/Body tags, the strict CSP must be relaxed
(`script-src 'self'` blocks all inline + third-party scripts today). The decision:
- **`'unsafe-inline'` is added to `script-src`** — unavoidable to execute pasted inline JS.
- **A curated provider allowlist** is baked into static `_headers` across **every** needed
  directive — not just `script-src`: e.g. Google → `script-src https://www.googletagmanager.com`,
  `connect-src https://*.google-analytics.com https://*.googletagmanager.com`,
  `img-src ...`; Meta → `script-src https://connect.facebook.net`,
  `connect-src https://www.facebook.com`, `img-src https://www.facebook.com`; plus
  Microsoft/Bing, TikTok, LinkedIn, Hotjar. A brand-new provider needs one line added.
- **Why this is acceptable here:** the site has almost no XSS surface — static HTML, admin
  and booking UIs render via `textContent`/`createElement` (never `innerHTML`), forms POST
  to APIs. And the allowlist doubles as a guardrail: even pasted code can only pull external
  scripts from known ad/analytics hosts, not an arbitrary attacker domain. Residual risk is
  the ordinary header/footer-tool one: a leaked `ADMIN_TOKEN` could inject site-wide code —
  mitigated by a strong token.

### 6.2 Tracking-code injector (sub-project B)
- Snippets live in `code_snippets`; a public **`GET /api/code`** returns the enabled ones
  (short cache TTL since the owner edits them). The code is public anyway — it's injected
  into public pages — so it must contain no secrets (tag snippets don't).
- A client-side injector (extending `consent.js`) runs on public pages only (the admin page
  doesn't load it). For each snippet whose `scope` is `global` or matches
  `location.pathname`, it waits for the snippet's `consent_category` to be granted (or runs
  immediately if `necessary`), then **parses the snippet and re-creates executing
  `<script>` elements** (scripts set via `innerHTML` don't run; they must be rebuilt) into
  the chosen Head/Body location. Non-script nodes (`<noscript>`, `<img>`, `<meta>`) are
  appended as-is.
- Free-text means we can't regex-validate the contents (that's the point). Protection comes
  from admin-only access + the curated allowlist constraining where scripts can load from.
  Server-side validation is limited to a length cap.

### 6.3 Consent
Extend the existing Consent Mode v2 banner: `analytics` gates analytics-category snippets,
`advertising` gates advertising-category snippets, `necessary` runs immediately. The banner
already has both toggles. This keeps the site's "nothing tracks unless you allow it" promise
honest even with arbitrary pasted code.

### 6.4 Payments
**Keep the phone-deposit soft-hold** (it works and the state machine is clean). Document
Stripe (take the £100 deposit online → auto-confirm) as an **opt-in future extension**, and
keep the booking state machine payment-ready so it slots in without a rewrite.

### 6.5 Legal / UK-GDPR (one pass, when the relevant subsystem lands)
Adding marketing tags + CRM + lead capture triggers a single privacy pass: lawful basis for
marketing = **consent**; a stated **retention** period for contacts/events; and
**right-to-erasure** (delete-a-contact in the CRM removes their PII). `cookies.html` already
covers GA4 + Google Ads; because the owner can now paste **any** tag (incl. Facebook Pixel),
the cookie + privacy policies must state that optional tags are owner-managed and
consent-gated, and list the active ones.

### 6.6 Testing
Keep the `node --test` convention for pure helpers (dedup/normalize, snippet scope/category
matching, slot-recurrence expansion, funnel aggregation). Race-safe DB paths get the same
conditional-write treatment the current booking code uses.

---

## 7. Decisions

### Decided (this review)
- **D2 — Tag mechanism:** free-text **Head/Body code snippets** ("insert headers & footers"
  model), scoped global or per-page — *not* structured per-provider ID fields and *not* a
  GTM container.
- **D4 — CSP:** **curated provider allowlist + `'unsafe-inline'`** baked into static
  `_headers` (see §6.1).

### Open — my recommendation on each, please redline
| # | Decision | Recommendation | Why |
|---|---|---|---|
| **D1** | Analytics: first-party vs pasted tags vs both | **Both** | First-party `events` = owned, ad-blocker-proof reporting you control; pasted GA4/Ads still get conversions for ad optimisation. |
| **D3** | Online deposit payments now? | **No — keep phone-deposit**, design Stripe-ready | Current flow works; Stripe is a self-contained future add-on, not a blocker. |
| **D5** | D1 migrations in CI | **Add `d1 migrations apply --remote` to `deploy.yml`** | Schema and deploy stay in lockstep as tables grow. |
| **D6** | Contacts dedup key | **Normalized email primary, phone fallback** | Avoids merging unrelated people on shared/typo'd phone numbers. |
| **D7** | First build target | **A (Booking + availability), foundation folded in** | Your headline ask; delivers visible value while laying the `contacts`/`settings` backbone. |
| **D8** | Do pasted snippets respect consent, or fire immediately? | **Respect consent** (per-snippet category; owner can mark `necessary` to fire early) | Keeps the legal promise + cookie policy honest; matches the existing banner. |

---

## 8. Recommended build sequence

1. **A + Foundation** — advanced booking + availability dashboard, introducing `contacts`
   (with backfill), `settings`, and the dashboard shell.
2. **B — Tracking-code manager** — Head/Body snippet injector (CSP allowlist + consent + legal).
3. **C — Analytics & reporting** — first-party events + reporting view; pasted tags get the
   same conversions.
4. **D — CRM** — contacts timeline, tags, notes, segments, export, erasure.
5. **E — Lead capture** — lead form + optional offer popup → contacts.

Each step ends with a deploy and a working increment. We re-confirm scope at the start of
each subsystem's own design.
