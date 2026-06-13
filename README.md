# Oak Hill Park Cafe Website

Static, dependency-free website rebuild focused on mobile conversion, local SEO, accessibility, and fast deployment.

## Preview

Open `public/index.html` directly in a browser. No build step is required.

## Deployment

Pushing to `master` deploys `public/` to the `oak-hill-park-cafe` Cloudflare Pages project via GitHub Actions (`.github/workflows/deploy.yml`). The workflow needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token with Cloudflare Pages edit permission) and `CLOUDFLARE_ACCOUNT_ID`. Manual deploys still work with `wrangler pages deploy public --project-name oak-hill-park-cafe`.

## Pages

All site files live in `public/`:

- `index.html` - conversion-led homepage
- `menu.html` - HTML-first cafe, kids, drinks, and Polish specials menu
- `soft-play.html` - soft play pricing, age ranges, rules, and trust copy
- `parties.html` - party package landing page with estimate calculator
- `contact.html` - phone, directions, hours, map, and general enquiry flow
- `privacy.html`, `terms.html`, `cookies.html` - legal pages linked from the footer

## Launch Checklist

- Connect party and contact forms to a secure backend, CRM, or email endpoint.
- Add GA4 and ad conversion events for call clicks, directions clicks, menu views, party enquiry starts, and party enquiry submits. Set `GA_MEASUREMENT_ID` in `assets/consent.js`; the cookie banner (Consent Mode v2) already gates loading on consent.
- Have the owner review `privacy.html`, `terms.html`, and `cookies.html` so the legal copy matches how the cafe actually operates (deposit policy, data retention, allergen handling).
- Confirm final opening hours, party prices, allergens, and any parking/accessibility details with the cafe.
- Replace or supplement legacy photos with a current photo shoot when available.
- Deploy with `_headers` security headers where supported, or translate them into the hosting provider's config.
- Keep PDFs as fallbacks, but treat `menu.html` as the primary menu URL.

## Security Notes

The static front end avoids WordPress plugin attack surface by default. If deployed on WordPress instead, update core/plugins, remove unused plugins, force HTTPS assets, protect login, disable or restrict XML-RPC, add rate limiting, and configure modern security headers.
