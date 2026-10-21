# BytesFX Café & Bookings

A demonstration website by **BytesFX** for a **fictional** family café with a
soft play area and a party booking flow.

> **Demonstration website by BytesFX.** This is a fictional café. Menus, prices
> and availability are illustrative. No real bookings or payments are accepted.

The site is a static Cloudflare Pages build — dependency-free HTML, CSS and
JavaScript for the pages, Pages Functions backed by D1 for the API — and it
keeps a real party-booking workflow underneath, wrapped in an explicit
demonstration boundary. See `docs/REBRAND-HANDOVER.md` for the full handover
and `docs/REBRAND-AUDIT.md` for what the rebrand changed and why.

## Running it locally

```bash
npm install                # only dependency is puppeteer, for the asset tools
npx wrangler pages dev     # serves public/ with the Functions and a local D1
```

Then open the URL Wrangler prints. The static pages also work by opening
`public/index.html` directly in a browser, but the booking and enquiry flows
need the Functions runtime, so use `wrangler pages dev` to exercise them.

To set up a local database:

```bash
npx wrangler d1 migrations apply oak-hill-bookings --local
```

**You do not need a database to see the demonstration.** In demonstration mode
the public calendar and the booking flow are served from a synthetic, isolated
store (`functions/api/_lib/demo-store.mjs`), so the site works on a machine
that has never run a migration.

### Tests

```bash
npm test                   # node --test
```

83 tests, no dependencies. `tests/demo-mode.test.mjs` is the important one: it
proves the demonstration boundary by asserting that no database statement is
written and no outbound request is made on any public path.

## The demonstration boundary

Two server-side settings decide how the API behaves. They are Cloudflare
environment variables, set in `vars` in `wrangler.jsonc` — **not** request
parameters, and not reachable by a visitor.

| Setting | Value | Meaning |
|---|---|---|
| `DEMO_MODE` | `"true"` | Demonstration behaviour: submissions are simulated, no personal detail is stored, no email is sent. |
| `DEMO_MODE` | `"false"` | The original live workflow, kept intact so the booking code stays reusable. |
| `LIVE_MODE_ACK` | `"true"` | Required, in addition to `DEMO_MODE="false"`, before the live path arms at all. |

**Fail-safe rule.** An unrecognised or missing `DEMO_MODE` is *not* live. The
site reports that it is unconfigured and writes nothing. Arming live takes two
deliberate settings, and a visitor can do neither.

What demonstration mode guarantees, and what `tests/demo-mode.test.mjs` checks:

- A booking validates exactly as the live path does, then creates **no
  reservation** and returns a synthetic `DEMO-` reference.
- An enquiry and a newsletter signup are validated, then **discarded**. No
  contact record, no marketing consent, no email.
- The enquiry email helper returns before the Resend call, so no message can
  leave the site.
- No analytics event is recorded, and no third-party tracking snippet is
  served, even if one is left enabled in the database.
- The captcha is switched off, so no visitor is asked to solve one.
- The owner admin console stays fully authenticated: sign-in, two-factor
  authentication and permissions are untouched, and every `/api/admin/*` route
  still requires a valid session.

## Pages

All site files live in `public/`:

- `index.html` — the homepage
- `menu.html` — the sample menu, with a printable PDF
- `soft-play.html` — the sample soft play area
- `parties.html` — the sample party packages and the booking enquiry
- `calendar.html` — the public availability calendar and the demo booking form
- `contact.html` — the demo enquiry form
- `admin.html` — the owner admin console (noindex; not in the nav)
- `privacy.html`, `terms.html`, `cookies.html` — the legal pages
- `unsubscribe.html` — the email-preference page (noindex)

## The API

`functions/api/` holds the Pages Functions. The public ones are:

- `GET /api/slots` — open slots. In demonstration mode this is the isolated
  demo store.
- `GET /api/calendar-events` — closures and events. Synthetic in demonstration
  mode.
- `POST /api/book` — creates a pending booking. Simulated in demonstration mode.
- `POST /api/enquiry` — saves a contact or party enquiry. Discarded in
  demonstration mode.
- `POST /api/lead` — newsletter signup, which is explicit marketing consent.
  Discarded in demonstration mode.
- `POST /api/track` — cookieless page-view counting. Records nothing in
  demonstration mode.
- `GET /api/code` — owner-configured tracking snippets. Serves none in
  demonstration mode.
- `POST /api/unsubscribe` — marketing-consent withdrawal. Changes nothing in
  demonstration mode.

The admin and auth routes under `/api/admin/*` and `/api/auth/*` are
unaffected by the demonstration boundary, and remain authenticated.

## Deployment

Config-driven via `wrangler.jsonc` (`pages_build_output_dir: public`, plus the
D1 binding). Pushing to `master` deploys via GitHub Actions
(`.github/workflows/deploy.yml`); the workflow needs two repository secrets:
`CLOUDFLARE_API_TOKEN` (a token with **Cloudflare Pages: Edit and D1: Edit**)
and `CLOUDFLARE_ACCOUNT_ID`.

### Before any deployment

1. **Set the origin.** The canonical URL, `og:` tags, the sitemap and the
   robots file all use the documented placeholder
   `https://bytesfx-cafe.example.com`. Replace it with the demo's real origin
   before deploying:

   ```bash
   grep -rl 'bytesfx-cafe.example.com' public/
   ```

   `example.com` is reserved by the IETF and can never belong to a real
   business, so the placeholder cannot point anywhere unintended.
2. **Clear the old email settings.** The Cloudflare environment still holds
   `RESEND_API_KEY`, `ENQUIRY_FROM` and `ENQUIRY_NOTIFY_TO` from the previous
   deployment, pointing at the old business's sender domain and inbox. The
   demonstration code cannot reach them, but they should be removed.
3. **Decide the Pages project and database names.** `wrangler.jsonc` still
   names the live Cloudflare resources — `oak-hill-park-cafe` and
   `oak-hill-bookings`. They are infrastructure rather than branding, so they
   were deliberately left alone; renaming them orphans the deployment and the
   database.

## Regenerating the brand assets

```bash
node tools/build-brand-assets.mjs   # icons, favicon source, social previews
node tools/build-menu-pdf.mjs        # the downloadable sample menu PDF
```

Every photograph is an AI-generated illustration, produced with Cloudflare
Workers AI. The prompts, the filenames and the provenance are recorded in
`docs/BRAND-ASSETS.md`.

## Working on this repo

Changes an agent makes belong to **this repository only**. If a bug or an
improvement is found in the **aramid** or **graphite** tools, don't fix it here
— file it as a channel entry in the shared `.agent-channel/` so the tool's
owner can resolve it.

(This bounds the agent, not the tools: aramid and graphite are expected to
write into this repo — hooks, agent hooks, MCP server, managed instruction
files — and the graphite daemon maintains this repo's graph on its own
schedule.)

Any change made outside this repository is recorded in
[`docs/EXTERNAL-CHANGES.md`](docs/EXTERNAL-CHANGES.md), with the location, what
changed, and why.
