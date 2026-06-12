# Oak Hill Park Cafe Website

Static, dependency-free website rebuild focused on mobile conversion, local SEO, accessibility, and fast deployment.

## Preview

Open `index.html` directly in a browser. No build step is required.

## Pages

- `index.html` - conversion-led homepage
- `menu.html` - HTML-first cafe, kids, drinks, and Polish specials menu
- `soft-play.html` - soft play pricing, age ranges, rules, and trust copy
- `parties.html` - party package landing page with estimate calculator
- `contact.html` - phone, directions, hours, map, and general enquiry flow

## Launch Checklist

- Connect party and contact forms to a secure backend, CRM, or email endpoint.
- Add GA4 and ad conversion events for call clicks, directions clicks, menu views, party enquiry starts, and party enquiry submits.
- Confirm final opening hours, party prices, allergens, and any parking/accessibility details with the cafe.
- Replace or supplement legacy photos with a current photo shoot when available.
- Deploy with `_headers` security headers where supported, or translate them into the hosting provider's config.
- Keep PDFs as fallbacks, but treat `menu.html` as the primary menu URL.

## Security Notes

The static front end avoids WordPress plugin attack surface by default. If deployed on WordPress instead, update core/plugins, remove unused plugins, force HTTPS assets, protect login, disable or restrict XML-RPC, add rate limiting, and configure modern security headers.
