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

- The site reads as a café website rather than as a demonstration. The
  standing banner and the in-context notices are gone, and a small
  **"Demo Site" badge** floats in the upper right of the hero on
  every visitor-facing page instead (shortened from "Demonstration site" on
  29 October 2026, because the badge was too long in the header). The image
  caption reads *"Demo Image"*.
  The only place the demonstration is still stated in as many words is the
  message a visitor reads back after submitting a form, and it is there
  deliberately: a visitor who has just handed over a name, a phone number
  and the date of a child's party must not be told the party is booked when
  nothing has been booked.
- The menu is new: six categories, 39 items, each with a name, a short
  ingredient-led description and a price. Eleven dishes have a matching
  photograph, drawn at 180px with a 480px copy for a high-density display. A
  sticky category navigation makes it scannable on a phone. A dietary note
  says the labels are a guide rather than a verified allergen list. There
  are no reviews, popularity counts or bestseller claims.
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

Added: `public/assets/bytesfx-cafe-menu.pdf`, a printable A4 sample menu
generated from `public/menu.html` itself.

### Light and dark mode

Added 28 October 2026, after the audit scored the theming 2/4 for having no
dark variant.

**The switch.** A 44px icon button in the header's action group, on every
public page and in the staff console, drawn in the same stroke and weight as
the icons already on the site. The icon shows the mode the button would
switch *to* — a moon on the light page, a sun on the dark one — and the
accessible name says the same thing ("Switch to dark mode"). On a phone the
Share button and the booking link move down to the bottom bar, but the switch
stays in the header, because it is the one control there that has to be
reachable at any width.

**How the theme is decided.** `public/assets/theme.js` is loaded from `<head>`
*without* `defer`, on purpose: it sets the theme before the first paint, so
the page never flashes cream and then turns black. With nothing stored, the
site follows the operating system and keeps following it. After the visitor
uses the switch, their choice is stored under `bytesfx-theme` and wins over
the system setting from then on.

**The palette.** The stylesheet's colour tokens were split so that each one
means one thing, because several of them meant two: `--cream` was both the
page background and the text on the green bands; `--ink` was both the body
text and the footer; `--white` was both the text on a filled chip and a
near-white panel; `--tomato` was both the button fill and the accent text;
`--park-dark` was both the band and the green of a link. The new tokens
(`--brand`, `--accent`, `--raised`, `--on-band`, `--footer-bg`, `--inverse-bg`
and the rest) each carry a single job, and the dark palette is a second
block that overrides them.

The dark page is a warm near-black, a card is one step up from it and an
input two steps up. The green bands keep the brand colour they already had:
they were dark to begin with, and the photography sits on them. Every value
in the dark block was measured against its own background — the eleven text
pairs on the home page are checked by `tools/check-pages.mjs` and all clear
4.5:1, the lowest being the hero eyebrow at 6:1.

**Paper stays paper.** The dark block is inside `@media screen`, so the
menu PDF and a visitor's own print-out keep the light palette whatever the
visitor has on screen.

### The page: warm paper, 28 October 2026

The light theme's page background was the yellow cream `#fff7ea` — the
first marker in `PRODUCT.md`'s anti-reference list. The operator decided to
move off it, and the page is now **warm paper `#faf3f0`**: the colour the
reference café site uses, barely pink rather than yellow, so it reads as
paper rather than as a template's cream.

Two things had to be true for that to work:

- **Each surface on the page is a step crisper than it.** The page is
  `#faf3f0`, a card is `#fffdf8` and a raised surface is `#ffffff`. The old
  ladder was the same shape but with a saturated cream under it, so a card
  barely separated from the page. `--raised` has to stay the brightest step
  because the selected booking slot uses it — an unselected slot is a
  `--card` and the selected one is `--raised`, and the selected one has to
  be the brighter of the two.
- **The tokens were renamed to say what they are.** `--cream` is now
  `--page` and `--paper` is now `--card`, because the page is the paper and
  the card is not. The dark block was renamed the same way and keeps its
  values; the ladder still runs the same way in both modes, dark to light.

Every text pair that sits directly on the page came out slightly *lower*,
because the new paper is a shade darker than the old cream — body text
12.00:1 (it was 12.37:1), the muted colour 5.18:1 (was 5.34:1) and the
tomato accent 4.95:1 (was 5.10:1). All are still well above the 4.5:1
that body text needs, and the tightest of them, the accent, is the only
one within half a point of the line. The page checker's own readings did
not move at all, because the pairs it measures sit on the white cards and
the deep green bands rather than on the page.

The menu PDF is untouched: the print block paints the page `--white` and
hides the sticky category navigation, so it never saw the cream.

**What it costs the visitor.** One more entry in their browser's storage —
`bytesfx-theme`, holding the word `light` or `dark` and nothing else, written
only when the visitor uses the switch. The privacy notice and the cookie
notice both say so, and the cookie notice's storage table lists it. Until
the switch is used, nothing is written at all.

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

### The content-security policy, tightened to what the demonstration does

The policy in `public/_headers` used to allow `'unsafe-inline'` scripts and a
dozen advertising and analytics hosts. A demonstration serves no third-party
tag at all — `/api/code` returns an empty list in demonstration mode, and the
site loads no font, script, image or frame from anywhere but its own origin —
so those allowances only widened the blast radius of an injection. They are
gone:

| Directive | Was | Now |
|---|---|---|
| `script-src` | `'self' 'unsafe-inline'` + 13 tag hosts | `'self'` |
| `style-src` | `'self' 'unsafe-inline'` | `'self'` |
| `img-src` | `'self' data:` + 12 tag hosts | `'self' data:` |
| `connect-src` | `'self'` + 12 tag hosts | `'self'` |
| `frame-src` | 4 hosts | `'none'` |

`default-src`, `object-src`, `worker-src`, `base-uri`, `form-action` and
`frame-ancestors` are unchanged.

Three things had to move to make `style-src 'self'` safe, because the browser
drops an inline style the policy does not allow:

- the spam honeypot in `contact.html` and the one the footer sign-up form
  builds in `script.js` now use a `.honeypot` class in `styles.css`;
- the "Protected" pill beside an owner's name in the staff console now uses an
  `.admin-protected-badge` class in `admin.css`.

`tests/csp.test.mjs` holds the policy to the mode the site is deployed in. It
checks that the policy allows every source the shipped pages actually use, that
the shipped pages set no inline style, and that the policy allows no
third-party host and no inline script while the site is in demonstration mode.

**Arming the site for real changes the policy.** A live site pastes tracking
tags in as inline scripts and loads the bot check from Cloudflare, so its
policy has to allow both. That is a third deliberate step alongside
`DEMO_MODE=false` and `LIVE_MODE_ACK=true` (see `functions/api/_lib/demo.mjs`),
the hosts to allow are the application's own list in
`functions/api/_lib/snippet-core.mjs`, and `tests/csp.test.mjs` fails at the
moment the mode is armed without it.

**A live policy should not have to allow `'unsafe-inline'`.** The
tracking-code manager pastes the owner's snippet in as an inline script, so a
live policy would have to allow inline scripts to run — and that is the
loosest thing a policy can allow. The better shape is to serve an approved
snippet from this origin (so the policy can stay `'self'`) or to give it a
nonce, and that change is worth making before the site is ever armed. It is
not made here: the live path cannot be exercised end to end, because there is
no live deployment, no third-party tag and no real bot check to test against,
and the demonstration's own policy allows no inline script at all.

### The display face: Fraunces, 29 October 2026

The site's serif was Georgia — a system font, which the browser only has if
the operating system has it. It is now **Fraunces**, the variable serif the
reference café site uses, and it is a **design variable**:

```
--font-display: "Fraunces", Georgia, "Iowan Old Style", …
--font-body:    "Segoe UI", ui-sans-serif, system-ui, …
```

`--serif` and `--sans` are gone; every rule that used them now uses one of
the two, so the typeface can be changed in one place and nowhere else.

Three things had to be arranged around it.

- **It is served from this repository**, at
  `public/assets/fonts/fraunces-latin-variable.woff2` — the latin subset of
  the variable font, 67KB, weights 100 to 900, with the optical size axis
  applied by the browser. It is not fetched from a font CDN, for two
  reasons: the content-security policy allows no third-party font at all,
  and a visitor's address should not be handed to a font house to read a
  heading. The SIL Open Font License travels with it in
  `public/assets/fonts/OFL.txt`.
- **Every page preloads it**, before the stylesheet that asks for the face,
  so the headings do not arrive in the fallback and swap after the first
  paint. The text face is still the system sans, so nothing is downloaded
  to read a paragraph.
- **The menu PDF is built over http, not from a file.** Chrome treats every
  file as its own origin, so a `file://` page cannot load the display face
  from the repository beside it — the PDF would silently be set in a
  fallback serif and would stop matching the page it is built from.
  `tools/build-menu-pdf.mjs` now serves `public/` on a loopback port and
  prints from there. The headings in the PDF are set in Fraunces as vector
  outlines, because a variable font cannot be subset-embedded the way a
  static one is; the text is still selectable and the file is still seven
  pages.

**The social preview cards were rebuilt too.** `tools/build-brand-assets.mjs`
had its own hard-coded Georgia stack, so the cards would have kept the old
face while the site changed; the builder now inlines the font as a data URI
and the five cards are set in Fraunces. The icons came out byte-identical.

**What was checked.** The printed page was rendered before and after and
compared by pixel: the same height, the same seven pages, and 0.26% of the
pixels changed — in exactly seven bands, each 14 to 21 points tall, which
are the seven headings. No body text moved and nothing reflowed.

### The homepage hero: one full-bleed photograph, 31 October 2026

The hero used to be a green band with the photograph in a card beside the
text. It is now **one full-bleed photograph with the type centred over it**,
in the manner of the reference café site: the picture is the hero, not a card
beside it.

- The picture is `party-outdoor-hero.jpg` — a **1024×420 band** cut from a
  generated square. The generator only makes squares, and a band this wide
  is wider than the hero at ordinary window sizes, so the crop is horizontal
  and the table stays in frame; a narrower band put the table at the bottom
  edge, where a wide window cut it away.
- The wash over the photograph is a flat **62% near-black**. The reference
  uses 40%; ours is heavier because our illustration is brighter and the
  type has to clear AA against the photograph itself.
- **Measured against the photograph's own pixels**, not the colour behind
  it: the heading **5.41:1**, the lede **10.95:1**, the tagline **5.32:1**
  and the "Demo Image" caption **15.47:1**.
- The caption sits **outside** the washed layer. Under the wash it measured
  3.26:1, which is below the 4.5:1 that small text needs.
- The page checker's "hero eyebrow" target became **"hero tagline"**, which
  now measures the icon-and-tagline line over the photograph.
- Two things the reviewed mock had dropped are gone from the homepage: the
  third button ("See the soft play area" — the page is still in the
  navigation) and the note under the buttons about the soft play corner
  and the two-hour packages. One line each to bring back.

`cafe-interior-hero.jpg`, the café interior that used to sit in the hero's
card, is now used by no page. It is kept in the repository as a brand asset.

### The badge: a stamp with a pulse, 31 October 2026

The badge said "Demonstration site", which was too long for the header, and
it was a pill. It now reads **"Demo Site"** and is shaped like a stamp: a
crisp rectangle with a hairline keyline inside the fill, and a small square
mark set on its corner the way a printer's mark sits on a block of type.

It also **pulses**. The pulse is a slow honey ring that expands out of the
stamp and fades — a ring and not a fade, because fading the stamp would dim
its own text. It stops entirely for anyone who has asked for less movement.

The demonstration boundary itself did not change: the standing notice the
worker returns, and the three messages a visitor reads back after a
booking, an enquiry or a sign-up, still say "as this is a demonstration
site" in as many words. Only the badge's label is short.

## 3. The pages, reviewed and updated

| Page | Reviewed | Updated | Notes |
|---|---|---|---|
| `index.html` | yes | rewritten | Hero, quick facts, three feature cards, party packages, the demonstration badge. Testimonials, hygiene badge and the Polish section removed. |
| `menu.html` | yes | rewritten | 39 items across six categories, sticky category nav, eleven photos, printable PDF. |
| `soft-play.html` | yes | rewritten | Pricing by age band, house rules, the layout, two photos. Loyalty scheme and testimonials removed. |
| `parties.html` | yes | rewritten | Three packages, the estimate calculator kept and working, the enquiry kept, three photos. The £100 deposit and the testimonial block removed. |
| `calendar.html` | yes | rewritten | Public calendar and booking form kept working; every `data-` hook preserved. |
| `contact.html` | yes | rewritten | Enquiry form, prefilled. Map and phone removed. |
| `admin.html` | yes | updated | Title, brand, the demonstration badge, the staff-console notice, newsletter panel copy. All 13 ids and 34 data-attributes preserved; authentication untouched. |
| `privacy.html` | yes | rewritten | Eight sections, controller, what the forms do, what is stored, retention, rights, open questions. |
| `terms.html` | yes | rewritten | Seven sections. No contract, no deposit, no English law. |
| `cookies.html` | yes | rewritten | Six sections and the storage table, matching the code exactly. |
| `unsubscribe.html` | yes | updated | Title, head, copy, notice. `data-no-consent-banner` and `data-no-signup` kept/added. |
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

`npm test` — **160 tests, 160 pass, 0 fail.** (95 at the rebrand; 109
after the mode switch, the policy and the dependency work; 27 more in
the four files the mutation gate had flagged, which until then had no
test of their own — `tests/demo-store.test.mjs`,
`tests/booking.test.mjs`, `tests/calendar.test.mjs` and
`tests/check-pages.test.mjs`; 4 more in the full-bleed band's
`tests/photo-band.test.mjs`, 3 more in `tests/portrait-anchor.test.mjs`,
3 more holding the page colour, 6 in `tests/typeface.test.mjs`, 5 in
`tests/hero.test.mjs` and 3 in `tests/demo-badge.test.mjs`.)

`tests/demo-mode.test.mjs` is the safety net for the demonstration boundary.
Each test asserts on the *absence* of a write or a request, so it would fail
if a guard were removed:

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
- **Exactly one mode switch on screen** on every page, and the page knows
  which mode it is in before it paints.

`tools/check-pages.mjs` also runs a mode pass at the end, which checks that
the system setting is followed while nothing is stored, that the switch
overrides it, that the choice survives a reload, and that the dark page is
legible — eleven text pairs measured on the real rendered colours, all at
4.5:1 or better.

`tests/theme-mode.test.mjs` runs `public/assets/theme.js` in a sandbox with a
stubbed browser, so it tests what the script does rather than what it
contains: with nothing stored the page follows the system setting, a stored
choice beats it, nothing is written until the visitor uses the switch, the
switch flips the theme and remembers it, and the accessible name follows the
action. The harness was checked against a deliberately broken switch: two of
its tests failed, so it is not a test that passes on anything.

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

## 9. Deployment — done, on the operator's instruction

The site is deployed. `feature/bytesfx-rebrand` was fast-forwarded into
`master` and pushed on 22 October 2026, which triggered the existing deploy
workflow: the unit tests ran, the D1 migrations were applied to the remote
database, and the Pages project rebuilt. **No DNS was touched, no paid
resource was provisioned, and Bytes-Web was not modified.** The Pages project
still has no custom domain, so the site is served at
`https://oak-hill-park-cafe.pages.dev`.

Verified on the live deployment, not on a local build:

- the workflow reported **"No migrations to apply"** — the remote database was
  already at the current schema, so the deploy changed no production data;
- `/api/slots` returns 57 slots, all Monday to Friday, none on a day the
  calendar calls closed and none on the private-hire day;
- `/api/code` returns no tracking snippets and `demo: true`;
- the URL matrix answers as intended: every page at its `.html` path with a
  200, the extension-less twin with a 301, `/` with a 200, and an unknown path
  with a 404;
- the repo's own page checker passes on the live site, all twelve pages at
  1280px and 390px, with no issues.

**Deployed again on 28 October 2026**, with the light and dark mode: two
commits on `master` (`8d652bc` the mode switch, `1443ae7` the test browser's
dependencies past a published advisory). The workflow ran the unit tests,
applied the migrations and rebuilt the Pages project, and the same page
checker passes on the live site, including the mode pass: the system setting
is followed while nothing is stored, the switch overrides it, the choice
survives a reload, and the dark page's eleven text pairs all clear 4.5:1.

**Deployed a third time on 28 October 2026**, with the switch, the policy and
the dependencies: seven commits on `master`, from `d81ee67` to `f81ebf5`. The
workflow ran the unit tests, applied the migrations — **"No migrations to
apply!"**, so no production data changed — and rebuilt the Pages project.

Verified on the live deployment:

- the response now carries the tight content-security policy, and the page
  checker passes on the live site: all twelve pages at 1280px and 390px, with
  no issues and no console errors, which is where a blocked script or style
  would show;
- the staff console's two switches both name the action they will take, and
  both are renamed when the mode moves — a click on the visible switch turns
  the page from dark to light and renames both switches to "Switch to dark
  mode";
- the demonstration's own promise still holds: no third-party host is allowed
  by the policy, and `/api/code` still serves no snippet.

**Deployed a fourth time on 28 October 2026**, with the four missing
test suites and nothing else: two commits on `master` (`0111746` the
tests, `015cd77` two more assertions). The behaviour of the site is
unchanged — the source changes are one extra space inside nineteen
statements, so that the mutation gate would re-examine them — and the
workflow ran the unit tests, applied the migrations — **"No migrations
to apply!"** — and rebuilt the Pages project.

Verified on the live deployment: the page checker passes on the live
site, all twelve pages at 1280px and 390px, with no issues and no
console errors, and the mode pass clears 4.5:1 on all eleven text
pairs. The mutation gate's ledger is now clear: **0 open findings**,
25 of them closed by the gate itself after it watched the mutants
die, and 7 by a ledger-logged override (five whose line no longer
exists, and two mutants no test can tell from the original).

**Deployed a fifth time on 28 October 2026**, with the homepage's portrait
anchor: `4663ae2` on `master`. The "Everything you can do here" section
carried a square illustration beside the copy; it now carries a 3:4 portrait
— the cake — and nothing else on the site is in that proportion. The picture
it replaced, `party-table-detail.jpg`, carried pastel bunting and cone
hats, which is the "template kids-party site" look `PRODUCT.md` names as the
anti-reference.

Verified on the live deployment: the page checker passes on the live site,
all twelve pages at 1280px and 390px, with no issues, and the mode pass
still clears 4.5:1 on every text pair. The portrait is served from the
site's own origin at 487×649 CSS pixels, cropped from the 486×486 square at
its native resolution, so nothing on the page is upscaled.

**Deployed a sixth time on 28 October 2026**, with the page colour:
`2a5e0bc` on `master`. The page moved off the yellow cream and onto warm
paper. The deploy ran the unit tests, applied the migrations — **"No
migrations to apply!"** — and rebuilt the Pages project.

Verified on the live deployment: the page checker passes on the live
site, all twelve pages at 1280px and 390px, with no issues, and the
computed page colour on the live site reads `rgb(250, 243, 240)` with a
card at `rgb(255, 253, 248)` and a translucent header that matches the
page exactly.

**Deployed a seventh time on 29 October 2026**, with the display face:
`c1c0290` on `master`. The site's serif was Georgia, a system font; it is
now Fraunces, self-hosted and held in a design variable. The workflow ran
the unit tests, applied the migrations — **"No migrations to apply!"** —
and rebuilt the Pages project.

Verified on the live deployment: the page checker passes on the live site,
all twelve pages at 1280px and 390px, with no issues; the font is served
from the deployment itself — `200`, `font/woff2`, 67,304 bytes — and the
licence with it; and the browser reports the heading's family as
`Fraunces` with the face loaded.

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
- A printable menu PDF generated from menu.html, replacing the two
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
| `tests/demo-store.test.mjs` | The synthetic café's contract: the 28-day window, Monday to Friday, the private-hire day. |
| `tests/booking.test.mjs` | The booking script in a sandbox with a stubbed DOM: what stops a request, and what it says. |
| `tests/calendar.test.mjs` | The sentence under the calendar, written from the data on screen. |
| `tests/check-pages.test.mjs` | The page checker against a fake browser and a page whose DOM the test controls. |
| `tests/photo-band.test.mjs` | Holds the full-bleed band: the picture stays described, and the wash keeps a colour the page checker can measure. |
| `tests/portrait-anchor.test.mjs` | Holds the one portrait picture: it stays the cake rather than the bunting, it declares a 3:4 box, and the rule that pins its ratio stays scoped to the image stack. |
| `tests/typeface.test.mjs` | Holds the display face: it is a design variable, the file is in this repository, the licence travels with it, every page preloads it, and no page loads a font from another origin. |
| `tests/hero.test.mjs` | Holds the homepage hero: one full-bleed picture, described; the picture and its renditions in the repository with the prompt recorded; the wash is a colour the checker can measure; the type is centred; the caption is outside the washed layer. |
| `tests/demo-badge.test.mjs` | Holds the badge: one on every page, saying "Demo Site"; shaped as a stamp rather than a pill; pulsing as a ring, and only for anyone who has not asked for less motion. |
| `public/assets/theme.js` | The light/dark mode switch. Loaded from `<head>` without `defer` so the theme is set before the first paint. |
| `tests/theme-mode.test.mjs` | Runs the mode switch against a stubbed browser, and checks that the notice discloses what it stores. |
| `tools/check-pages.mjs` | Walks every public page and reports broken images, overflow, heading order, unlabelled controls, old-brand text, and the mode switch's state and contrast. |
| `tools/capture-screenshots.mjs` | Captures the handover screenshots. |
