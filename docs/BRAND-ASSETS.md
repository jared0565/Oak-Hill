# Brand assets — BytesFX Café & Bookings

Every image on the demonstration site, where it came from, and what it is for.

**Provenance.** All photographs are AI-generated illustrations produced for this
demonstration with **Cloudflare Workers AI** (`@cf/black-forest-labs/flux-1-schnell`)
via the account the repo already deploys to. They are not photographs of any real
premises, and no third-party stock library, hotlinked asset or image with
unknown rights is used anywhere on the site. Every photograph is labelled
"AI-generated illustration" in the page that shows it.

**The mark** (`assets/images/bytesfx-logo.svg`) is hand-authored vector artwork in
this repository — `tools/brand/logo.svg` is the source. It is not generated.

**The social previews** (`assets/og/og-*.jpg`) are composed locally by
`tools/build-brand-assets.mjs`, which renders a photograph with real HTML text
over it using Puppeteer. The wording is therefore editable text, not pixels
baked in by an image model.

**The machine-readable asset list** is `tools/brand/photos.json` — the single
source of truth for the photographs' prompts and purposes. The table below is
the human-readable version of it. `tools/build-image-manifest.mjs` reads that
file together with the real images on disk and writes
`public/assets/images/generated/_manifest.json`, so the manifest cannot drift
from what is actually shipped; it fails loudly if the two disagree.

---

## Regenerating

```bash
node tools/build-brand-assets.mjs      # icons + social previews
```

The photographs themselves are not reproducible from a script in this repo: they
were generated from the prompts below and the resulting files are committed.
The exact prompt for each file is recorded in the table, so any file can be
regenerated with the same prompt and the same model.

| Asset | Dimensions | Format | Purpose |
|---|---|---|---|
| `assets/images/bytesfx-logo.svg` | 64×64 viewBox | SVG | The brand mark, used in the header and copied to `assets/images/` by the build script |
| `assets/icons/icon-16.png` | 16×16 | PNG | Favicon at small size |
| `assets/icons/icon-32.png` | 32×32 | PNG | Favicon at standard size |
| `assets/icons/icon-192.png` | 192×192 | PNG | PWA / home-screen icon |
| `assets/icons/icon-512.png` | 512×512 | PNG | PWA / home-screen icon |
| `assets/icons/apple-touch-icon.png` | 180×180 | PNG | Apple home-screen icon |
| `favicon.ico` | 16/32/48 | ICO | Legacy favicon, rasterised from the mark |
| `assets/og/og-home.jpg` | 1200×630 | JPEG | Social preview, homepage |
| `assets/og/og-menu.jpg` | 1200×630 | JPEG | Social preview, menu |
| `assets/og/og-soft-play.jpg` | 1200×630 | JPEG | Social preview, soft play |
| `assets/og/og-parties.jpg` | 1200×630 | JPEG | Social preview, parties |
| `assets/og/og-contact.jpg` | 1200×630 | JPEG | Social preview, contact |

## Photographs

All in `public/assets/images/generated/`, JPEG, quality 84, progressive.

| File | Size | Purpose | Generation prompt |
|---|---|---|---|
| `cafe-interior-hero.jpg` | 1024×683 | Homepage hero; parties page | *A bright welcoming family cafe interior, wooden tables and chairs, banquette seating with cushions, soft daylight through large sash windows, potted plants, sage green walls and cream panelling* + the shared negative cues |
| `cafe-window-table.jpg` | 1024×683 | Homepage, contact page | *A cafe window table set for brunch, small cup of coffee, a plate of scrambled eggs and toast, cutlery and linen napkin, morning light through the window, blurred plant* + shared negatives |
| `cafe-courtyard.jpg` | 1024×683 | Contact page | *A wooden cafe table and two chairs in a small walled garden, low old brick wall covered in ivy, a clipped hedge, gravel underfoot, terracotta pots with shrubs, dappled afternoon sunlight through tree leaves* + shared negatives, and explicitly *no building, no awning, no parasol, no shopfront, no window, no wall sign, no plaque, no board, no banner* |
| `soft-play-room.jpg` | 1024×768 | Soft play page; homepage | *An indoor soft play room in a family cafe, empty of people, a low padded climbing frame with a short slide, a ball pit, foam floor mats, simple wooden toys on a low shelf, painted plaster walls, recessed ceiling lights* + shared negatives and photographic cues |
| `soft-play-corner.jpg` | 1024×768 | Soft play page | *Close-up of a small play corner in a cafe, a low wooden table with a wipe-clean play mat, a woven basket of plain wooden toys, a stack of picture books with blank covers, a small soft cushion, a ceramic mug of pencils, window light from the left* + shared negatives and photographic cues |
| `party-setup.jpg` | 1024×683 | Parties page; homepage | *A children's party table set up in a cafe, empty of people, pastel bunting, plain paper table cover, plates, cups and paper napkins, small gift bags on a side table* + shared negatives |
| `party-cake.jpg` | 1024×1024 | Parties gallery | *A round birthday cake on a cafe table, plain buttercream, a few unlit candles, a wooden cake stand, scattered confetti, soft daylight, no people* + shared negatives |
| `party-table-detail.jpg` | 1024×1024 | Parties gallery | *Close up of a party table top, paper plates, cups, simple paper hats and plain napkins, small bowls of snacks, pastel bunting above, no people* + shared negatives |
| `menu-breakfast.jpg` | 1024×768 | Menu, full English breakfast | *A full English breakfast on a ceramic plate, fried eggs, bacon, sausage, baked beans, grilled tomato, mushrooms, toast, overhead three quarter angle, cafe table* + shared negatives |
| `menu-toastie.jpg` | 1024×768 | Menu, roasted vegetable toastie | *A roasted vegetable toasted sandwich on a wooden board, visible courgette, red pepper and melted cheddar between toasted sourdough, side salad, cafe table* + shared negatives |
| `menu-sandwich.jpg` | 1024×768 | Menu, club sandwich | *A club sandwich on a white plate, three layers of toasted bread with chicken, lettuce and tomato, a few crisps on the side, natural light* + shared negatives |
| `menu-kids-meal.jpg` | 1024×768 | Menu, children's meal | *A children's meal, small portion of pasta spirals with tomato sauce, a small sausage, a few vegetable sticks, a small glass of juice, on a white plate* + shared negatives |
| `menu-cake-carrot.jpg` | 1024×1024 | Menu, carrot cake | *A slice of carrot cake on a white plate, cream cheese frosting, a walnut on top, cafe table, soft daylight* + shared negatives |
| `menu-chocolate-cake.jpg` | 1024×1024 | Menu, chocolate fudge cake | *A slice of chocolate fudge cake on a white plate, glossy ganache, a single strawberry on top, cafe table, soft daylight* + shared negatives |
| `menu-hot-chocolate.jpg` | 1024×1024 | Menu, hot chocolate | *A tall glass mug of hot chocolate, dark chocolate liquid, topped with a generous swirl of whipped cream and a single curl of dark chocolate, on a small saucer beside a teaspoon, cafe table* + shared negatives and photographic cues |
| `menu-coffee.jpg` | 1024×1024 | Menu, flat white | *A flat white coffee in a ceramic cup on a saucer, latte art, cafe table, soft daylight, shallow depth of field* + shared negatives |
| `menu-cold-drinks.jpg` | 1024×1024 | Menu, iced latte | *A tall glass of iced latte with milk and a simple straw next to a glass of fresh orange juice, cafe table, condensation, soft daylight* + shared negatives |
| `menu-soup.jpg` | 1024×768 | Menu, tomato soup | *A bowl of tomato soup with a swirl of cream and a slice of sourdough toast beside it, cafe table, warm daylight* + shared negatives |
| `menu-pancakes.jpg` | 1024×768 | Menu, pancakes | *A stack of fluffy pancakes with maple syrup and berries on a ceramic plate, small jug of syrup, cafe table, morning light* + shared negatives |

### Shared negative cues

Every prompt carries the same trailing clauses:

> Professional editorial food and interior photography, natural window light,
> realistic portions, clean simple composition, warm cream and sage green
> palette, muted natural colours, no people, no children, no faces, no text, no
> lettering, no logos, no watermarks, no signage text, no identifiable
> real-world location, no famous branding

The photographs aimed at interiors additionally carry *amateur editorial
photograph taken on a camera, natural available light, real materials and real
textures, shallow depth of field, gentle photographic grain, natural colours*,
so the set reads as one photographic body of work rather than a mix of renders
and photographs.

---

## Images that were removed

The site's previous photographs were of a real operating café: its real interior,
its real park, its real food, and its real parties — several of which showed
recognisable children. One carried the Food Standards Agency's 5-star hygiene
sticker, a genuine regulatory artefact belonging to that business. They were
all removed rather than relabelled, because a fictional café cannot show a real
venue's rooms, its customers or its regulator's certificate. See
`docs/REBRAND-AUDIT.md` for the full inventory.
