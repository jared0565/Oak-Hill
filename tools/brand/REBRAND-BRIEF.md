# BytesFX Café & Bookings — rebrand brief for the page rewrite

You are rewriting one or more pages of a static Cloudflare Pages site at
`F:\Projects\Websites\Oak Hill` (branch `feature/bytesfx-rebrand`).

The site was built for a real, operating family café in Barnet. It is now being
rebuilt as a **demonstration** of a café, soft-play and party-booking website,
made by BytesFX. The café is fictional. Nothing on the site may suggest a real
business, a real venue, a real price, a real review, or a real booking.

Read this whole file before editing. Then read the file(s) you are editing.

---

## 1. The brand

- Display name: **BytesFX Café & Bookings** (the word "Café" carries an acute
  accent — `Café`).
- In running prose, refer to it as **the BytesFX Café** or **BytesFX Café &
  Bookings**. Never "Oak Hill", "Oak Hill Park", "Malibu's", "OHP" or
  "ohpc" — not in copy, not in alt text, not in class names, not in file names.
- Creator link used wherever the site's origin needs crediting:
  <https://web.bytesfx.com/> (add `rel="noopener"`).
- The café is fictional. Its location, opening hours, phone number and staff do
  not exist. **Do not invent an address, a phone number, a postcode, opening
  hours, a food hygiene rating, a founding year, a company registration number
  or a customer review.** If a page needs one of those, omit it and say the
  café is fictional instead.

## 2. The standing demo notice

Every page already carries this banner — keep it exactly as it is in
`tools/brand/partials/header.html`:

> **Demonstration website by BytesFX.** This is a fictional café. Menus, prices
> and availability are illustrative. No real bookings or payments are accepted.

Shorter variants belong next to the thing they describe, using the
`.demo-note` component (`<div class="demo-note"><p>…</p></div>`):

| Where | Text |
|---|---|
| Menu | Sample menu and prices. |
| Any image | AI-generated illustration (as a `.demo-caption` under the image) |
| Booking | Demo booking — no reservation will be made. |
| Contact / enquiry | Demo enquiry — no message will be sent. |
| Newsletter | Demo signup — no email will be sent. |

The `.demo-note` component renders a "Demo" label automatically. Do not add
the word "Demo" to the text yourself.

## 3. The shared chrome — copy it, do not reinvent it

`tools/brand/partials/header.html` and `tools/brand/partials/footer.html` are
the exact header and footer for a public page. Replace the existing header and
footer in the page you are editing with these, changing only:

- `aria-current="page"` on the nav link for the page you are editing.
- the `<title>`, meta description, canonical, og:* tags (see §4).

`tools/brand/partials/head.html` is the standard `<head>`. Keep the same tag
order and the same set of tags on every page.

## 4. Metadata

- Canonical origin on every page: `https://bytesfx-cafe.example.com`
  (a documented placeholder — see `docs/REBRAND-HANDOVER.md`; do not invent a
  real domain, and do not use the old `oak.bytesfx.com`).
- `<link rel="canonical" href="https://bytesfx-cafe.example.com/{page}.html">`
  — for `index.html` use `.../index.html`, matching the old pattern.
- `og:url` = the same URL. `og:image` = `https://bytesfx-cafe.example.com/assets/og/{file}`.
- `og:site_name` = `BytesFX Café &amp; Bookings`.
- `og:image:alt` describes the image, and must not mention the old brand.
- `og:title` and `og:description` are written for a reader, not a crawler:
  short, specific, no superlatives.
- `og:image` files that exist: `og-home.jpg`, `og-menu.jpg`, `og-soft-play.jpg`,
  `og-parties.jpg`, `og-contact.jpg`. Use the one that matches the page.

**Structured data.** The old `Restaurant` JSON-LD described a real business
(name, telephone, postal address, opening hours, Facebook page, cuisine). It
must not survive. `index.html` carries a `WebSite` + `Organization` block:

```html
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "BytesFX Café & Bookings",
    "url": "https://bytesfx-cafe.example.com/",
    "description": "A demonstration website by BytesFX for a fictional family café with a soft play area and a party booking flow.",
    "publisher": {
      "@type": "Organization",
      "name": "BytesFX",
      "url": "https://web.bytesfx.com/"
    }
  }
  </script>
```

## 5. Images

Every photograph on the site has been replaced. The new files are in
`public/assets/images/generated/`. Use only these — do not reference any other
image, and do not reference a file that does not exist.

| File | What it shows | Suggested use |
|---|---|---|
| `cafe-interior-hero.jpg` | Café interior: wooden tables, banquette seating, daylight through sash windows, sage walls | homepage hero, party page |
| `cafe-window-table.jpg` | A window table set for brunch — coffee, scrambled eggs, toast | homepage, contact page |
| `cafe-courtyard.jpg` | Outdoor seating under a plain canopy, olive trees, no signage | contact page |
| `soft-play-room.jpg` | An empty indoor soft play room — climbing frame, ball pit, slide, foam mats | soft play page, homepage |
| `soft-play-corner.jpg` | A small soft play corner in the café — foam pit, toy shelf, two small chairs | soft play page |
| `party-setup.jpg` | A party table set up, empty of people — bunting, plates, cups, gift bags | parties page |
| `party-cake.jpg` | A round birthday cake on a wooden stand, unlit candles, confetti | parties page |
| `party-table-detail.jpg` | Party table top: paper plates, cups, paper hats, snack bowls | parties page |
| `menu-breakfast.jpg` | A full English breakfast plate | menu page |
| `menu-toastie.jpg` | A roasted vegetable toasted sandwich on a wooden board | menu page |
| `menu-sandwich.jpg` | A club sandwich on a white plate | menu page |
| `menu-kids-meal.jpg` | A children's meal — pasta, sausage, vegetable sticks, a drink | menu page |
| `menu-cake-carrot.jpg` | A slice of carrot cake with cream cheese frosting | menu page |
| `menu-chocolate-cake.jpg` | A slice of chocolate fudge cake with a strawberry | menu page |
| `menu-hot-chocolate.jpg` | A mug of hot chocolate with whipped cream | menu page |
| `menu-coffee.jpg` | A flat white in a ceramic cup | menu page |
| `menu-cold-drinks.jpg` | An iced latte and a glass of orange juice | menu page |
| `menu-soup.jpg` | A bowl of tomato soup with cream and sourdough toast | menu page |
| `menu-pancakes.jpg` | A stack of pancakes with maple syrup and berries | menu page |

The logo is `assets/images/bytesfx-logo.svg` (it is in the shared header — do
not add it again).

Rules:

- Every `<img>` needs an `alt` that describes the **picture**, not the brand.
- Every photo of food or the interior needs a `.demo-caption` under it reading
  "AI-generated illustration", so a generated picture is never read as a
  photograph of a real premises.
- Give every `<img>` a `width` and `height` that match the file's real
  dimensions, so the browser reserves the right space:
  `cafe-interior-hero.jpg` 1024×683, `cafe-window-table.jpg` 1024×683,
  `cafe-courtyard.jpg` 1024×683, `soft-play-room.jpg` 1024×768,
  `soft-play-corner.jpg` 1024×768, `party-setup.jpg` 1024×683,
  `party-cake.jpg` 1024×1024, `party-table-detail.jpg` 1024×1024,
  `menu-breakfast.jpg` 1024×768, `menu-toastie.jpg` 1024×768,
  `menu-sandwich.jpg` 1024×768, `menu-kids-meal.jpg` 1024×768,
  `menu-cake-carrot.jpg` 1024×1024, `menu-chocolate-cake.jpg` 1024×1024,
  `menu-hot-chocolate.jpg` 1024×1024, `menu-coffee.jpg` 1024×1024,
  `menu-cold-drinks.jpg` 1024×1024, `menu-soup.jpg` 1024×768,
  `menu-pancakes.jpg` 1024×768.
- The `og:` image dimensions are 1200×630 (the social cards, not the photos).
- Add `loading="lazy"` to images below the fold.

## 6. Writing

- **Natural British English.** Short, specific sentences. Write like a good
  local business would, not like a marketing template.
- Banned phrases: "elevate your journey", "crafted to perfection", "unforgettable
  experiences", "something for everyone", "premium experience", "nestled",
  "delve", "bursting with", "a haven for", "more than just a café".
- No emojis. No exclamation marks in headings.
- No fake reviews, no star ratings, no "bestseller", "most popular", "customer
  favourite", or a count of happy customers.
- No claims about hygiene ratings, awards, years trading, or the number of
  parties hosted.
- Prices are illustrative. Say so where a price is shown.
- Do not describe the facilities as though they exist in the world: write
  "the sample menu shows…", "the demo includes…", "in this demonstration…".

## 7. Design

The stylesheet already provides the components. Use them; do not add inline
`style` attributes and do not edit `public/assets/styles.css` (another agent
owns that file).

Available components: `.demo-banner`, `.demo-note` (+ `.is-error`,
`.is-success`), `.demo-caption`, `.page-hero`, `.section` (+ `.alt`, `.band`),
`.section-head`, `.kicker`, `.section-lede`, `.eyebrow`, `.feature-grid` /
`.feature-card`, `.price-grid` / `.price-card` (+ `.featured`), `.price`,
`.quick-strip` / `.quick-grid` / `.quick-card`, `.check-list`, `.notice`,
`.image-stack`, `.party-gallery`, `.stat-row` / `.stat`, `.menu-grid` /
`.menu-item` (+ `.menu-item--photo`, `.menu-desc`), `.menu-group-head`,
`.menu-cat-nav`, `.form-panel`, `.form-grid`, `.field-grid`, `.form-status`
(+ `.is-error`, `.is-success`, `.is-pending`), `.booking-grid` /
`.booking-slot`, `.booking-form`, `.booking-success`, `.booking-note`,
`.legal-content`, `.cookie-table`, `.cluster`, `.button` (+ `.secondary`,
`.ghost`), `.kicker`.

Banned: gradient blobs, glassmorphism panels, excessive pill badges,
repetitive grids of identical cards, decorative dashboards, fake statistics,
gratuitous animation, emoji, and drop shadows used as decoration.

## 8. Accessibility

- Semantic HTML: one `<h1>` per page, headings in order, `<nav>`, `<main>`,
  `<section>`, `<footer>`, `<figure>`/`<figcaption>`.
- Every form control has a `<label>`; every link has discernible text.
- Focus is visible (the stylesheet handles the ring) — do not remove outlines.
- `prefers-reduced-motion` is already handled in CSS; do not add your own
  animation.
- Colour contrast must hold: `--muted` on the page is about 5.2:1, `--tomato`
  on the page about 5.0:1. Do not introduce a lighter grey for body text.
  (The page token was `--cream` when this brief was written; it is `--page`
  now, and the page is warm paper rather than the yellow cream.)

## 9. Forms in the demo

- Prefill the fields with fictional sample details so a visitor can see the
  flow without entering anything: name `Alex Sample`, email
  `alex@example.com` (`example.com` is reserved for exactly this), phone
  `020 0000 0000`, message text that describes the demo.
- Mark prefilled fields with the `field-sample` class on the wrapping
  `<label>`.
- The copy beside the form must say the submission goes nowhere.

## 10. What not to touch

- Do not edit `public/assets/styles.css`, any file in `public/assets/*.js`, any
  file in `functions/`, `wrangler.jsonc`, `migrations/`, `tests/`, or anything
  under `docs/`. Other agents own those. If you think one of them needs a
  change, say so in your final report instead of making it.
- Do not add new files to `public/assets/images/`.
- Do not change `public/_headers`, `public/robots.txt`, `public/sitemap.xml`
  or `public/site.webmanifest`.
- Do not run `git` commands, do not commit, do not push, do not deploy.
