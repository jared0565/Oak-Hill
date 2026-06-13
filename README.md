# Oak Hill Park Cafe Website

Mostly-static website with a real-time party booking system. Static pages are dependency-free HTML/CSS/JS; bookings are served by Cloudflare Pages Functions backed by a D1 database.

## Preview

Open `public/index.html` directly in a browser for the static pages. The booking system needs the Cloudflare runtime — run `wrangler pages dev` (with the local D1 migrated, see below) to exercise `/api/*` locally.

## Deployment

Config-driven via `wrangler.jsonc` (`pages_build_output_dir: public`, plus the D1 binding). Deploy with `wrangler pages deploy`. Pushing to `master` also deploys via GitHub Actions (`.github/workflows/deploy.yml`); the workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token with **Cloudflare Pages: Edit and D1: Edit**) and `CLOUDFLARE_ACCOUNT_ID`.

## Pages

All site files live in `public/`:

- `index.html` - conversion-led homepage
- `menu.html` - HTML-first cafe, kids, drinks, and Polish specials menu
- `soft-play.html` - soft play pricing, age ranges, rules, and trust copy
- `parties.html` - party package landing page with estimate calculator and real party photos
- `calendar.html` - real-time party booking (open slots + booking form) and the Google Calendar overview
- `contact.html` - phone, directions, hours, map, and general enquiry flow
- `admin.html` - owner booking admin (noindex; not in nav). Password = the `ADMIN_TOKEN` secret
- `privacy.html`, `terms.html`, `cookies.html` - legal pages linked from the footer

## Booking system

Real-time party booking, no third-party SaaS.

- **Database:** Cloudflare D1 `oak-hill-bookings` (`slots`, `bookings`). Schema in `migrations/0001_init.sql`.
- **API (`functions/api/`):** `GET /api/slots` (open slots), `POST /api/book` (creates a soft `pending` hold), and token-protected `/api/admin/slots` and `/api/admin/bookings`.
- **Owner admin:** `/admin.html`. Sign in with the `ADMIN_TOKEN` secret, then add party slots (they appear instantly on `/calendar.html`) and confirm/decline bookings. The slot table shows how many holds each open slot has.
- **Soft-hold workflow:** a customer enquiry creates a `pending` booking but does **not** remove the slot from availability, so the date stays open and others can still enquire. The owner takes the £100 deposit by phone and clicks **Mark paid**, which is the only step that locks the slot (`booked`) and auto-declines any other holds on it. The slot-locking `UPDATE` is conditional (`WHERE status='available'`), so two confirmations on the same slot can't both win (no double-booking). An unpaid hold never blocks the slot; the owner declines it at their discretion. (Online card deposit via Stripe is the next step, see checklist.)

### Working on the booking system

```bash
wrangler d1 migrations apply oak-hill-bookings --local    # set up local DB
wrangler d1 migrations apply oak-hill-bookings --remote    # set up production DB (run once)
wrangler pages dev                                         # local dev with Functions + local D1
# Production admin password:
wrangler pages secret put ADMIN_TOKEN --project-name oak-hill-park-cafe
```

Local secrets live in `.dev.vars` (gitignored). `wrangler pages dev` can crash on Windows paths with spaces; if so, test against a deploy.

## Launch Checklist

- **Booking deposit (Stripe):** add online card payment for the £100 deposit so a booking can be confirmed without a phone call. Needs a Stripe account; integrate Stripe Checkout in `functions/api/book.js` (create a Checkout Session) and confirm the booking on the Stripe webhook.
- **Booking confirmations (email):** email the customer their reference and notify the cafe on each booking. Needs an email provider (Resend, or Cloudflare Email) and an API key; send from `functions/api/book.js`.
- **Change the admin password:** rotate `ADMIN_TOKEN` with `wrangler pages secret put ADMIN_TOKEN --project-name oak-hill-park-cafe`. Consider Cloudflare Access for stronger owner auth.
- Connect the general contact and party-enquiry forms to a secure backend, CRM, or email endpoint.
- Add GA4 and ad conversion events for call clicks, directions clicks, menu views, party enquiry starts, and party enquiry submits. Set `GA_MEASUREMENT_ID` in `assets/consent.js`; the cookie banner (Consent Mode v2) already gates loading on consent.
- Have the owner review `privacy.html`, `terms.html`, and `cookies.html` so the legal copy matches how the cafe actually operates (deposit policy, data retention, allergen handling).
- Confirm final opening hours, party prices, allergens, and any parking/accessibility details with the cafe.
- Replace or supplement legacy photos with a current photo shoot when available.
- Deploy with `_headers` security headers where supported, or translate them into the hosting provider's config.
- Keep PDFs as fallbacks, but treat `menu.html` as the primary menu URL.

## Security Notes

The static front end avoids WordPress plugin attack surface by default. If deployed on WordPress instead, update core/plugins, remove unused plugins, force HTTPS assets, protect login, disable or restrict XML-RPC, add rate limiting, and configure modern security headers.
