# Handover — BytesFX Café & Bookings

**Date:** 21 October 2026
**Branch:** `feature/bytesfx-rebrand`
**Base:** `610763c` on `master`
**Status:** complete and ready for review. **Not pushed, not merged, not deployed.**

---

## 1. What this is now

A static Cloudflare Pages site that demonstrates a café website with a soft
play area and a party booking flow, made by BytesFX. The café is fictional.
Every photograph is an AI-generated illustration. Every price, age band,
session length, capacity and package is a sample figure. No booking, enquiry,
payment, reservation, calendar event, marketing email or analytics record is
possible.

The booking workflow underneath is **real and reusable**. It is not a set of
screens; it is the original code, with an explicit boundary wrapped around it.

## 2. What changed

### The brand

- New mark, drawn as vector artwork in `tools/brand/logo.svg`, wordmark-free so
  it stays legible at 16 pixels. Rasterised to five icon sizes, the favicon
  and the header.
- New name everywhere: **BytesFX Café & Bookings**. The old name, the old
  sub-brand, the old address, postcode, phone number, opening hours, founding
  year, food-hygiene claim, Facebook page, Google Maps links and every
  customer review are gone.
- Every photograph replaced — 19 new images, no people, no children, no
  lettering, no watermarks, no real premises. See `docs/BRAND-ASSETS.md`.
- The five social previews re-rendered from a photograph plus **real HTML
  text**, so the wording is editable rather than pixels.

### The demonstration boundary

New: `functions/api/_lib/demo.mjs` and `functions/api/_lib/demo-store.mjs`.

| Setting | Where | Effect |
|---|---|---|
| `DEMO_MODE` | `wrangler.jsonc` → `vars` | `"true"` = demonstration. |
| `LIVE_MODE_ACK` | not set | Required with `DEMO_MODE="false"` before the live path arms. |

An unrecognised or missing `DEMO_MODE` is **not** live: the site reports that
it is unconfigured and writes nothing. A visitor can reach neither setting.

In demonstration mode:

| Path | What happens |
|---|---|
| `POST /api/book` | Validates exactly as the live path does, creates **no reservation**, returns a synthetic `DEMO-` reference. |
| `POST /api/enquiry` | Validates, then **discards**. No row, no contact, no email. |
| `POST /api/lead` | Validates, then **discards**. No marketing consent. |
| `POST /api/track` | Records **nothing**. |
| `GET /api/code` | Serves **no** third-party snippets. |
| `GET /api/slots` | The isolated demo store: the owner's own slots if there are any, otherwise a deterministic synthetic list for the next 28 days. |
| `GET /api/calendar-events` | Synthetic closures and events. |
| `POST /api/unsubscribe` | Reports state, changes **nothing**. |
| `sendEnquiryEmail` | Returns before the Resend call. No email can leave the site. |
| Turnstile | Switched off. No visitor solves a captcha for a fiction. |
| `/api/admin/*` | **Unchanged and still authenticated.** Sign-in, TOTP two-factor and the permission model are untouched. |

The live path is intact behind the two-setting rule, so the same code can be
pointed at a real café.

### The staff sign-in

The foot of every public page carries a **Staff sign in** form — the way in to
the owner dashboard, which until now had no link from the public site at all.

- It posts to the site's existing `/api/auth/login` endpoint and stores the
  session token in `sessionStorage` under `bfx-admin-token` — the same key the
  dashboard reads. So signing in at the foot of a page and clicking **Open the
  dashboard** lands you already authenticated. There is one session, not two.
- It **does not re-implement the captcha or the second factor**. When either is
  required, the form says so and points at `/admin.html`, which handles both.
  The server-side protections are untouched: the bot gate, the five-strike
  fifteen-minute lockout and the 2FA requirement all still apply to this
  endpoint exactly as they did to the dashboard's own form.
- It is injected by `public/assets/script.js`, the same way the footer
  newsletter block is, so all ten public pages get it consistently. `admin.html`
  has its own shell and its own login form and is unaffected.
- Wrong credentials return the endpoint's generic message — the same one for
  an unknown address, so the form does not reveal which accounts exist.
- **This is the one form on the site that creates records**, so the legal
  pages were updated to say so: a successful sign-in creates a session record,
  writes to the activity log and records the last-signed-in time; a failed
  attempt is logged too. See `public/privacy.html` ("The staff sign-in") and
  the storage table in `public/cookies.html`.



All twelve rewritten: `index`, `menu`, `soft-play`, `parties`, `calendar`,
`contact`, `admin`, `privacy`, `terms`, `cookies`, `unsubscribe`, and the
`proposal` page **removed from `public/`**.

- A standing demo banner is on every page, with short in-context variants:
  *"Sample menu and prices."* · *"AI-generated illustration"* · *"Demo booking
  — no reservation will be made."* · *"Demo enquiry — no message will be sent."*
  · *"Demo signup — no email will be sent."*
- The menu is new: six categories, 39 items, each with a name, a short
  ingredient-led description and an illustrative price. Eleven dishes have a
  matching photograph. A sticky category navigation makes it scannable on a
  phone. A dietary note says the labels are illustrative, not verified
  allergen advice. There are no reviews, popularity counts or bestseller
  claims.
- The legal pages were rewritten around what the code actually does. They say
  the request *is* sent and may appear in hosting-provider logs; they do not
  claim "no data is collected", do not claim compliance, and do not claim a
  solicitor has reviewed them. Each ends with the questions a real café would
  still have to answer.
- The design was reworked: type scale and measure, contrast on every surface,
  a visible focus ring that inverts on the dark bands, `prefers-reduced-motion`
  honoured, and the decorative gradient blobs, the pill-shaped eyebrows and
  the tilted certificate badge removed.
- Every form is prefilled with fictional sample details — `Alex Sample`,
  `alex@example.com`, `020 0000 0000` — so the flow can be seen without
  entering anything, and the copy says where the submission goes (nowhere).

### The assets

| Removed | Why |
|---|---|
| `public/assets/images/oak-hill-logo.png` | The old logo, carrying two brands. |
| `public/assets/images/food-hygiene-rating.jpg` | A photograph of the real Food Standards Agency 5-star certificate. |
| `public/assets/images/{park,soft-play,party-room,party-cake,party-table,party-toddler,breakfast,hot-chocolate}.jpg` | Photographs of the real premises, the real park, real food and real parties — several showing recognisable children. |
| `public/assets/OHP-cafe-menu-November-2023.pdf`, `public/assets/OHP-kids-menu-2023.pdf` | Rasterised exports of the old café's real menu, with no text layer and no way to rebrand. |
| `public/proposal.html`, `public/UPGRADE_PROPOSAL.pdf`, `public/UPGRADE_PROPOSAL_1PAGE.pdf` | Live, publicly reachable files describing the old café's upgrade, including the 5-star claim. `proposal.html` had no `noindex`. Identical copies remain in `deliverables/`, so nothing was lost. |
| `og-templates.html` | The source of the old social cards. Replaced by `tools/build-brand-assets.mjs`. |
| The Google Maps embed and every `maps.google.com` link | The demonstration café has no location, and the old link pointed at the real premises. |

Added: `public/assets/bytesfx-cafe-sample-menu.pdf`, a printable A4 sample menu
generated from `public/menu.html` itself.

### Code and configuration

- `window.OHP*` → `window.BFX*`; `ohpc-consent` → `bytesfx-consent`;
  `ohpc-admin-token` → `bfx-admin-token`; booking references `OHP-` → `BFX-`
  (live) or `DEMO-` (demonstration); the two-factor issuer → `BytesFX Admin`.
- `wrangler.jsonc` gained the `DEMO_MODE` var, with a comment explaining that
  the project name, the D1 name and the D1 id are infrastructure rather than
  branding and are deliberately unchanged.
- `public/_headers` lost the old domain and the map hosts from the
  content-security policy.
- `public/sitemap.xml`, `public/robots.txt` and `public/site.webmanifest` use
  the new origin and the new name.
- `package.json` / `package-lock.json` renamed to `bytesfx-cafe-bookings`.

## 3. The pages, reviewed and updated

| Page | Reviewed | Updated | Notes |
|---|---|---|---|
| `index.html` | yes | rewritten | Hero, quick facts, three feature cards, sample packages, demo notices. Testimonials, hygiene badge and the Polish section removed. |
| `menu.html` | yes | rewritten | 39 items across six categories, sticky category nav, eleven photos, printable PDF. |
| `soft-play.html` | yes | rewritten | Sample pricing, sample rules, sample layout, two photos. Loyalty scheme and testimonials removed. |
| `parties.html` | yes | rewritten | Three sample packages, the estimate calculator kept and working, the enquiry kept, three photos. The £100 deposit and the testimonial block removed. |
| `calendar.html` | yes | rewritten | Public calendar and booking form kept working; every `data-` hook preserved. |
| `contact.html` | yes | rewritten | Demo enquiry form, prefilled. Map and phone removed. |
| `admin.html` | yes | updated | Title, brand, demo banner, demo note, newsletter panel copy. All 13 ids and 34 data-attributes preserved; authentication untouched. |
| `privacy.html` | yes | rewritten | Eight sections, controller, what the forms do, what is stored, retention, rights, open questions. |
| `terms.html` | yes | rewritten | Seven sections. No contract, no deposit, no English law. |
| `cookies.html` | yes | rewritten | Six sections and the storage table, matching the code exactly. |
| `unsubscribe.html` | yes | updated | Title, head, copy, demo note. `data-no-consent-banner` and `data-no-signup` kept/added. |
| `proposal.html` | yes | **removed from `public/`** | Kept in `deliverables/`. |

## 4. Old-brand references removed

Brand name and its variants; the "Malibu's" sub-brand; the logo and every icon;
the Food Standards Agency 5-star badge; "family-run since 1996"; the address,
postcode, district and phone number; opening hours; the Google Maps link and
embed; the Facebook page; every customer testimonial and first name; the real
prices, deposit and loyalty scheme; the Polish-specialist identity and the
`Restaurant` JSON-LD entity; `oak.bytesfx.com`; the `OHP-` reference prefix;
the `ohpc-` storage keys; the `window.OHP*` namespace; the `Oak Hill Admin`
two-factor issuer; `short_name: "Oak Hill Cafe"`.

**References deliberately retained** — infrastructure and history, listed with
reasons in `docs/REBRAND-AUDIT.md` §3.4 and §5: the Cloudflare project name
and D1 identifiers, the deploy workflow, `docs/superpowers/**`,
`deliverables/**`, and the historical entries in `docs/EXTERNAL-CHANGES.md`.

## 5. Running the demonstration locally

```bash
npm install
npx wrangler pages dev
```

No database is needed. The public calendar and booking flow are served from the
isolated demo store. The admin console needs an owner account, bootstrapped
through the admin page.

```bash
npm test                   # 83 tests, no dependencies
```

### Demo configuration and the isolation controls

| Control | Where | Default |
|---|---|---|
| `DEMO_MODE` | `wrangler.jsonc` → `vars` | `"true"` |
| `LIVE_MODE_ACK` | Cloudflare environment | unset |
| The demo store | `functions/api/_lib/demo-store.mjs` | synthetic slots for the next 28 days, Mondays closed |
| Admin authentication | `functions/api/admin/_middleware.js` | unchanged — a Bearer session and TOTP are required |

## 6. Tests run, and what they show

`npm test` — **83 tests, 83 pass, 0 fail.**

`tests/demo-mode.test.mjs` is new and is the safety net. Each test asserts on
the *absence* of a write or a request, so it would fail if a guard were
removed:

| Test | Proves |
|---|---|
| the mode is resolved | A typo, a blank or a missing `DEMO_MODE` is never live. |
| live behaviour needs two settings | `DEMO_MODE="false"` alone does not arm the live path. |
| an unconfigured environment refuses | Write endpoints return 503 and touch nothing. |
| a demo booking writes nothing | No statement is run; the reference is `DEMO-`; the real path is preserved. |
| a demo booking still validates | Bad input, a bad email and an unknown slot are still refused. |
| a demo enquiry is discarded | No row, no contact, no email. |
| a demo signup is discarded | No marketing consent. |
| no analytics is recorded | The track endpoint stores nothing. |
| no snippets are served | The code endpoint returns an empty list. |
| no email leaves | The Resend helper returns before the request, even with a key configured. |
| no captcha | Turnstile is off in demonstration mode. |
| the admin API stays closed | An unauthenticated or bogus request gets 401, in demonstration mode too. |
| live mode still double-book-proofs | A lost race still returns 409, not a false hold. |

Browser verification was done against `wrangler pages dev`, and every public
page was walked programmatically at desktop (1280×900) and mobile (390×844)
widths by `tools/check-pages.mjs`:

- **No broken images.** Every `<img>` has an `alt`, and a `width`/`height`
  matching the file's real dimensions.
- **No horizontal overflow** at either width.
- **One `<h1>` per page**, with no heading-level jumps.
- **No unlabelled form controls**, and no dead in-page anchors.
- **No console errors** on any page.
- **No old-brand text** in any page's rendered text.
- Every local `src`/`href` in every page resolves to a file that exists.

The API was exercised directly against the running server:

| Call | Result |
|---|---|
| `GET /api/slots` | `demo: true`, 6 slots from the local store |
| `GET /api/calendar-events` | `demo: true`, 9 synthetic events |
| `GET /api/code` | `demo: true`, **0** snippets |
| `POST /api/book` (real slot) | `{"ok":true,"demo":true,"ref":"DEMO-038EX","message":"Demo booking — no reservation will be made."}` |
| `POST /api/book` (unknown slot) | 404 |
| `POST /api/book` (bad input) | 400 — validation still bites |
| `POST /api/enquiry` | `{"ok":true,"demo":true,"message":"Demo enquiry — no message will be sent."}` |
| `POST /api/enquiry` (bad email) | 400 |
| `POST /api/lead` | `{"ok":true,"demo":true,"message":"Demo signup — no email will be sent."}` |
| `POST /api/track` | 204, nothing recorded |

**And the database was checked afterwards.** Before and after four rounds of
demo submissions, the local D1 row counts were identical: `bookings 0,
enquiries 1, contacts 1, analytics_events 20` both times. The one enquiry,
one contact and twenty events are pre-existing local test data from June; the
demo added nothing.

## 7. Screenshots

`tools/capture-screenshots.mjs` captured every public page at both widths into
`screenshots/`, named `demo-<page>-<viewport>.jpg`. The older captures from the
original site are still there for comparison.

Two findings came out of the automated pass, and both are **pre-existing in
the original `admin.html`**, not introduced by the rebrand:

- The admin page contains two `<h1>` elements. `admin.css` hides the first one
  once the signed-in app is showing, so only one is ever visible.
- The admin sidebar links to `#overview`, `#bookings` and the rest, but those
  panels are built at runtime by `admin.js` and carry the ids `panel-overview`,
  `panel-bookings` and so on. The links are intercepted by the script. This was
  already the case before the rebrand and was left alone.

## 8. Limitations, and the decisions a real café would still have to make

1. **The origin is the Pages URL, not a domain of the café's own.** Every
   canonical URL, `og:` tag, sitemap entry and the robots file name
   `https://oak-hill-park-cafe.pages.dev`, because that is the URL the
   deployment actually serves: the Pages project has **no custom domain
   attached**, and the previous canonical, `oak.bytesfx.com`, does not
   resolve. A canonical must name a URL that serves the page, so a name
   pointing at a host that does not exist would be worse than the project
   URL. **Attaching a domain is the owner's call** — it is one click in
   Cloudflare and one search-and-replace here, and it would carry the old
   project name out of the site's public URLs.
2. **The Cloudflare environment still holds the old email settings.**
   `RESEND_API_KEY` is set from the previous deployment and points at the old
   business's sender domain; `ENQUIRY_FROM` and `ENQUIRY_NOTIFY_TO` are not
   configured, so no message can be sent even if the key were used.
   **No external service was modified.** The demonstration runs with
   `DEMO_MODE=true`, so the code cannot reach them, but the key should still
   be cleared.
3. **The Pages project and the D1 database still carry the old names.**
   `oak-hill-park-cafe` and `oak-hill-bookings` name live cloud resources.
   Renaming them would orphan the deployment and the database, so they were
   left alone deliberately. The **working directory** is likewise still called
   `F:\Projects\Websites\Oak Hill`, and the git remote is
   `github.com/jared0565/Oak-Hill.git` — both are the operator's to rename.
4. **The legal pages need a real review.** They describe what this
   demonstration does. They are not legal advice, they have not been reviewed
   by a solicitor, and no compliance audit has been carried out. Each page
   ends with the questions a café owner would have to settle.
5. **The prices are invented.** £165 and £175 for the sample party packages,
   £2.50 and £5 for the sample soft play sessions, and the whole menu — chosen
   to be plausible for a family café, not derived from anything.
6. **The images are illustrations.** They are not photographs of a real venue,
   and they do not depict a real building. The site says so on every page that
   shows one.
7. **The demo store is synthetic.** With no database, availability is
   generated from today's date. If the owner adds slots through the admin
   console, those appear on the public calendar instead.
8. **The admin console is a real admin console.** It is fully authenticated and
   it will write to whatever database it is pointed at. In the demonstration
   it should be pointed at a local D1, not the production one.

## 9. Deployment

**No DNS was touched, no paid resource was provisioned, and Bytes-Web was not
modified.** The Pages project still has no custom domain, so the site is
served at `https://oak-hill-park-cafe.pages.dev`.

The deployment is a merge into `master`, which triggers the existing deploy
workflow: the unit tests run first, then the D1 migrations are applied to the
remote database, then the Pages project is rebuilt. **`feature/bytesfx-rebrand`
is the branch to merge**, and it is a fast-forward — `master` is an ancestor
of it.

What is already done:

1. **The origin is set** — `https://oak-hill-park-cafe.pages.dev`, the URL the
   deployment actually serves. See limitation 1 above.
2. **The public site has one live URL per page.** `public/_redirects` serves
   each page at its `.html` path — the URL its canonical tag and its sitemap
   entry name — and retires the extension-less twin with a 301. The home page
   is the root, and `/index` and `/index.html` both 301 to it.

What is still the owner's:

3. **The old email key is still in the environment.** `RESEND_API_KEY` remains
   set from the previous deployment. It cannot be used — the site runs with
   `DEMO_MODE=true` and no sender or recipient address is configured — but it
   should still be cleared.
4. **The Pages project and the D1 database still carry the old names.** They
   name live cloud resources, so they were left alone. Renaming them is the
   owner's decision: Cloudflare first, then `wrangler.jsonc`, then
   `.github/workflows/deploy.yml`.
5. **The demonstration is the default.** `DEMO_MODE=true`, so a booking
   creates no reservation, an enquiry sends no message, and the public
   calendar shows the synthetic sample café. Turning live behaviour on
   needs two settings, `DEMO_MODE=false` and `LIVE_MODE_ACK=true`.

What a real, non-demonstration café would still need: the prices, the opening
hours, the address, the food-hygiene position, the allergen process, the
deposit and consumer contract, and legal review of the legal pages.

## 10. Proposed commit message

```
Rebrand the site as the BytesFX Café & Bookings demonstration

The site was built for a real family café in Barnet. It is now a
demonstration of a café, soft play and party booking website, made by
BytesFX, with a fictional café throughout.

Brand
- New mark (tools/brand/logo.svg), rasterised to the icon set and the
  favicon; new social previews composed from real HTML text so the
  wording stays editable
- All ten venue photographs replaced with 19 AI-generated illustrations:
  no people, no children, no lettering, no real premises
- The old name, the Malibu's sub-brand, the Food Standards Agency 5-star
  sticker, the address, phone number, opening hours, founding year,
  Facebook page, map links, testimonials and the Polish-specialist
  identity are gone; the Restaurant JSON-LD entity is replaced with a
  WebSite/Organization block describing the demonstration

Demonstration boundary
- New demo.mjs and demo-store.mjs: submissions are validated then
  discarded, no personal detail is stored, no reservation, calendar
  event, analytics record, email or third-party tag is possible
- Live behaviour needs both DEMO_MODE=false and LIVE_MODE_ACK=true; a
  missing or misspelled setting is not live, so a misconfigured
  deployment can never quietly accept real bookings
- The owner admin console is untouched and still fully authenticated

Content
- Twelve public pages rewritten, with a standing demo notice and short
  in-context variants; a 39-item sample menu with category navigation and
  a printable PDF; legal pages that describe what the code actually does
- A printable sample menu PDF generated from menu.html, replacing the two
  rasterised PDFs of the old café's real menu
- public/proposal.html and its PDFs removed from the published site;
  identical copies remain in deliverables/

Tests
- New tests/demo-mode.test.mjs asserts on the absence of writes and
  outbound requests, so it fails if a guard is removed
- 83 tests pass
```

## 11. Where things live

| Path | What it is |
|---|---|
| `docs/REBRAND-AUDIT.md` | What the audit found and what was done about it. |
| `docs/BRAND-ASSETS.md` | Every image, its prompt, its purpose and its provenance. |
| `docs/EXTERNAL-CHANGES.md` | Changes made outside this repository. |
| `tools/brand/logo.svg` | The mark, as source. |
| `tools/brand/REBRAND-BRIEF.md` | The brief the page rewrites followed. |
| `tools/brand/partials/` | The shared header, footer and `<head>`. |
| `tools/build-brand-assets.mjs` | Icons and social previews. |
| `tools/build-menu-pdf.mjs` | The printable sample menu. |
| `functions/api/_lib/demo.mjs` | The demonstration boundary. |
| `functions/api/_lib/demo-store.mjs` | The isolated demo slot and calendar store. |
| `tests/demo-mode.test.mjs` | The safety net for the boundary. |
| `tools/check-pages.mjs` | Walks every public page and reports broken images, overflow, heading order, unlabelled controls and old-brand text. |
| `tools/capture-screenshots.mjs` | Captures the handover screenshots. |
