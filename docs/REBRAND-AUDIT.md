# Rebrand audit — Oak Hill Park Cafe → BytesFX Café & Bookings

**Date:** 21 October 2026
**Branch:** `feature/bytesfx-rebrand` (from `610763c`)
**Scope:** the whole of `F:\Projects\Websites\Oak Hill` — every tracked file, plus
every image inspected visually rather than by text search.

This records what the audit found and what was done about it. It is the
evidence behind the changes, not a plan for them.

---

## 1. What the site was

A statically-rendered Cloudflare Pages site for a real, operating family café
in Barnet, with a real-time party-booking system on Pages Functions and a D1
database, an owner admin console, a CRM, a newsletter sender and a public
availability calendar. Twelve public HTML pages, roughly sixty function files,
twelve migrations, five icon files, five social-preview images, ten venue
photographs, two PDF menus and a client-side script bundle.

The site was good. The code was in good shape. What it could not be, once
rebranded, was a demonstration: almost every visible and many invisible strings
described a business that exists, at an address that exists, with a phone
number that connects.

## 2. How the audit was done

- **Text:** every tracked file was searched for the brand names and their
  variants, the domains, the address, the postcode, the phone number, the
  opening hours, the founding year, the food-hygiene claim, the social page,
  the review copy, the "Malibu's" sub-brand, the `OHP`/`ohpc` code identifiers
  and the asset filenames.
- **Images:** all ten venue photographs, all five social previews and all five
  icons were opened and looked at, and cropped and enlarged where lettering
  might be hiding. Two images carried text that no text search could find: the
  "MALIBU" mascot ribbon painted on the soft-play room wall, and the
  Food Standards Agency's 5-star sticker photographed in a window.
- **Code and configuration:** the Pages Functions, the migrations, the deploy
  workflow, the Cloudflare configuration, the content-security policy, the
  sitemap, the robots file and the web manifest were read for the same
  strings and for the data flows that would carry a visitor's details.

## 3. What was found

### 3.1 Branding that was visible to a visitor

| Found | Where | Action |
|---|---|---|
| "Oak Hill Park Cafe" as the brand | All 12 pages: titles, descriptions, `og:` tags, JSON-LD, header lockup, footers | Replaced with "BytesFX Café & Bookings" |
| "Oak Hill", "Oak Hill Park" | Descriptions, alt text, footers, the menu's "The Oak Hill Special" | Removed |
| "Malibu's" — a second, real sub-brand | Soft play and parties pages, a menu tab, the logo artwork, and painted on the soft-play room wall | Removed; the demo café has no soft-play sub-brand |
| The logo, with two brands in it | `oak-hill-logo.png`, all five icons, `favicon.ico` | Replaced with a new mark, re-rasterised |
| The Food Standards Agency 5-star sticker | A photograph of the real certificate in a real window; the claim in six pages' metadata | Removed |
| "Family-run since 1996" | Hero, metadata, footers, social cards | Removed — a founding year for a fictional café would be an invention |
| The real address, postcode and district | 10 pages, 40+ places, plus the JSON-LD `PostalAddress`, plus the D1 newsletter footer | Removed; there is no address |
| The real phone number | 30+ places, including a server-side error string and the client-side fallbacks | Removed |
| The real opening hours | 12 pages, the JSON-LD `openingHoursSpecification`, the topbar | Removed |
| The real Facebook page | JSON-LD `sameAs`, footers, the contact page | Removed |
| The Google Maps link and click-to-load embed | Every page's topbar and footer, plus the contact page's embed | Removed — a fictional café has no location to map |
| Real customer reviews, with first names | Three on the homepage, three on parties, three on soft play | Removed |
| Real prices, a real £100 non-refundable deposit, a real loyalty-card scheme, real soft-play pricing and ages | Homepage, menu, parties, soft play, terms | Replaced with clearly-labelled sample figures |
| The Polish-specialist identity | Descriptions, a menu tab, a named dish, a whole section of the homepage | Removed — the demo café is a general family café, and the Polish heritage was the old business's signature |
| "Open in Google Maps", "Get directions", "Call the cafe" | Buttons on every page | Replaced |

### 3.2 Branding in the machine-readable layer

| Found | Where | Action |
|---|---|---|
| `Restaurant` JSON-LD naming a real business, with its telephone, address, opening hours, cuisine and Facebook page | `index.html` | Replaced with a `WebSite` + `Organization` block describing the demonstration |
| `oak.bytesfx.com` — the live production domain, which carries "Oak" in it | 30+ places: every canonical, every `og:url`, every `og:image`, nine sitemap entries, the robots file, the content-security policy | Replaced with a documented placeholder, `bytesfx-cafe.example.com` |
| `short_name: "Oak Hill Cafe"` — a *different* brand string from the main one, which a naive find-and-replace would have missed | `site.webmanifest` | Replaced |
| `OHP-` booking references, shown to customers | `book.js` | Now `BFX-` in live mode and `DEMO-` in demonstration mode |
| `Oak Hill Admin` as the two-factor issuer, which appears in a visitor's authenticator app | `totp-core.mjs` | Now `BytesFX Admin` |
| `ohpc-consent`, `ohpc-admin-token`, and the `window.OHP*` namespace | Client-side JavaScript | Renamed to `bytesfx-consent`, `bfx-admin-token` and `window.BFX*` |

### 3.3 Branding in assets

- All five social previews had the old logo, the "MALIBU'S SOFT PLAY" strip,
  the 5-star badge, "BARNET", "FAMILY-RUN SINCE 1996", the phone number, the
  address and the old prices **baked in as pixels**. They were re-rendered
  locally from real HTML text, so the wording is editable rather than
  photographic.
- Both PDF menus were rasterised exports of the old café's real menu, with no
  text layer, and could not be edited. They were removed.
- `public/proposal.html` and its two PDFs were live, publicly reachable files
  describing the old café's website upgrade, including the 5-star claim. They
  were removed from `public/` — identical copies remain in `deliverables/`, so
  no work was lost. `proposal.html` had no `noindex`, so it was indexable.
- `og-templates.html`, the source of the old social cards, was removed; the
  generator that replaced it is `tools/build-brand-assets.mjs`.

### 3.4 Branding in the infrastructure — deliberately left alone

| Kept | Why |
|---|---|
| `wrangler.jsonc` → `name: "oak-hill-park-cafe"` | The Cloudflare Pages project name. Renaming it would orphan the deployment and the `wrangler pages deploy` target. |
| `wrangler.jsonc` → `database_name: "oak-hill-bookings"`, `database_id` | The live D1 database. `database_id` names a real cloud resource holding real data; the name is referenced by `.github/workflows/deploy.yml`. Renaming either would break the migration step. |
| The `DB` binding | Infrastructure, not branding. |
| `.github/workflows/deploy.yml` | Untouched, including its trigger on `master`. |
| `docs/superpowers/**` | Historical design and plan documents. They describe the café as it was, and rewriting them would falsify the record. |
| `deliverables/**` | The upgrade proposal and its PDFs, kept as deliverables. |
| `docs/EXTERNAL-CHANGES.md`, `AGENTS.md`, `README.md` | Updated where they described the site's current state; historical entries were left as written. |

### 3.5 Found outside the published site

- `.claude/settings.local.json` carries a `WebFetch` permission for the old
  café's real domain, `www.oakhillparkcafe.co.uk`. It is a machine-local
  permission entry, not part of the site, and it is not tracked by git. It is
  left alone: removing a permission the operator granted is their call, not
  this agent's. It is recorded here so the decision is visible.
- The git remote is `github.com/jared0565/Oak-Hill.git`. The repository name
  and the owner's GitHub handle are the owner's to change.
- `docs/superpowers/specs/2026-06-15-admin-dashboard-redesign-design.md`
  renders "Jared (owner)" in a mockup. Historical design document; left as
  written.
- The Cloudflare environment still holds `RESEND_API_KEY`, `ENQUIRY_FROM` and
  `ENQUIRY_NOTIFY_TO` from the previous deployment, pointing at the old
  business's sender domain and inbox. **No external service was modified.**
  The code cannot reach them while demonstration mode is on — `notify.mjs`
  returns before the Resend call — but they should be cleared before any live
  use, and that is an operator action. It is in the handover.

## 4. What was done about it

1. **New brand.** A mark drawn as vector artwork in `tools/brand/logo.svg`, a
   wordmark-free symbol, rasterised to five icon sizes and to `favicon.ico`.
2. **New photographs.** Every venue photograph replaced by an AI-generated
   illustration, produced with Cloudflare Workers AI. Nineteen images, no
   people and no children, no lettering, no watermarks, no real premises. See
   `docs/BRAND-ASSETS.md` for every prompt.
3. **New social previews.** Composed locally from a photograph and real HTML
   text, by `tools/build-brand-assets.mjs`.
4. **A demonstration boundary.** `functions/api/_lib/demo.mjs` and
   `functions/api/_lib/demo-store.mjs` make the site a demonstration by
   construction: submissions are validated and then discarded, no email is
   sent, no personal detail is stored, no reservation is created, no calendar
   event is written, no analytics event is recorded and no third-party tag is
   served. The live workflow is preserved intact behind a two-setting arming
   rule, so the code stays reusable. `tests/demo-mode.test.mjs` proves each of
   those by asserting that no statement is written and no request is made.
5. **Rewritten pages.** All twelve public pages, their metadata, their
   structured data and their legal copy.
6. **Rewritten client-side behaviour.** The share dialog, the enquiry form, the
   booking form, the calendar, the consent banner and the footer signup now
   describe the demonstration rather than a business.

## 5. Old-brand references that remain, and why

| Reference | Where | Why it stays |
|---|---|---|
| `oak-hill-park-cafe`, `oak-hill-bookings`, the D1 id | `wrangler.jsonc`, the deploy workflow | Live cloud resource identifiers. Changing them would break the deployment and the database. |
| "Oak Hill", "Barnet", the phone number, the address | `docs/superpowers/**`, `deliverables/**` | Historical design documents and the upgrade proposal, which describe the café as it was. |
| "Oak Hill" | `docs/EXTERNAL-CHANGES.md` | A record of what earlier sessions did, written when the site was the old café's. |
| `staff@example.test` | `tests/totp-core.test.mjs` | A test fixture using a reserved domain. |
| `oak-hill-bookings` | `wrangler.jsonc`, `.github/workflows/deploy.yml` | The live D1 database name. Renaming it would break the migration step. |
| "Oak Hill" and the old café's details | `tools/brand/REBRAND-BRIEF.md` | The instruction document that describes what had to be removed. It is a record of the change, not part of the site. |
| "Oak Hill", the old phone number, and the old domain | `tools/check-pages.mjs` | The audit script's own pattern list, so it can detect them. |
