// Builds the BytesFX Cafe & Bookings brand assets from source.
//
//   node tools/build-brand-assets.mjs
//
// Outputs (all generated — do not hand-edit):
//   public/assets/images/bytesfx-logo.svg   the wordmark-free mark
//   public/assets/icons/icon-{16,32,192,512}.png
//   public/assets/icons/apple-touch-icon.png
//   public/assets/og/og-{home,menu,soft-play,parties,contact}.jpg   1200x630
//
// The icon set is rasterised from tools/brand/logo.svg, and the social previews
// are composed from a generated photograph plus real HTML text — never baked
// into an image by a generator, so the wording stays editable and correct.

import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const brandDir = path.join(root, "tools", "brand");
const outIcons = path.join(root, "public", "assets", "icons");
const outOg = path.join(root, "public", "assets", "og");
const outImages = path.join(root, "public", "assets", "images");
const generatedPhotos = path.join(outImages, "generated");

const CREAM = "#fff7ea";
const GREEN = "#1d4633";
const TOMATO = "#d94f30";
const AMBER = "#f4b942";

const ICONS = [
  { file: "icon-16.png", size: 16 },
  { file: "icon-32.png", size: 32 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

const OG = [
  {
    file: "og-home.jpg",
    photo: "cafe-interior-hero.jpg",
    title: "BytesFX Café &amp; Bookings",
    sub: "A sample menu, a soft play corner and a party booking flow",
    kicker: "Demo Site",
  },
  {
    file: "og-menu.jpg",
    photo: "menu-breakfast.jpg",
    title: "Sample menu",
    sub: "Breakfast, sandwiches, children's meals, cakes and drinks",
    kicker: "Illustrative prices",
  },
  {
    file: "og-soft-play.jpg",
    photo: "soft-play-room.jpg",
    title: "Soft play",
    sub: "A sample soft play area, priced and laid out for illustration",
    kicker: "Demo Site",
  },
  {
    file: "og-parties.jpg",
    photo: "party-setup.jpg",
    title: "Party packages",
    sub: "A sample two-hour party package with food and a cake ceremony",
    kicker: "Demo Site",
  },
  {
    file: "og-contact.jpg",
    photo: "cafe-courtyard.jpg",
    title: "Contact",
    sub: "A demo enquiry form — no message is sent and nothing is stored",
    kicker: "Demo Site",
  },
];

function ogHtml({ title, sub, kicker, photoDataUri, fontDataUri }) {
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  /* The brand's display face, inlined: the card is rendered from a string
     with no origin of its own, so it cannot fetch the font from the site. */
  @font-face {
    font-family: "Fraunces";
    src: url("${fontDataUri}") format("woff2");
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  html, body { margin: 0; padding: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    position: relative;
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    color: #fff;
    background: ${GREEN};
  }
  .photo { position: absolute; inset: 0; width: 1200px; height: 630px; object-fit: cover; }
  .scrim {
    position: absolute; inset: 0;
    background: linear-gradient(100deg, rgba(20,53,38,0.92) 0%, rgba(20,53,38,0.80) 42%, rgba(20,53,38,0.30) 100%);
  }
  .wrap { position: relative; padding: 66px 72px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
  .mark { width: 72px; height: 72px; margin-bottom: auto; }
  .kicker {
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 17px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: ${AMBER}; margin: 0 0 14px;
  }
  h1 { margin: 0; font-size: 66px; line-height: 1.04; font-weight: 700; letter-spacing: -0.01em; }
  p.sub { margin: 20px 0 0; max-width: 760px; font-family: "Segoe UI", system-ui, sans-serif; font-size: 25px; line-height: 1.4; color: rgba(255,255,255,0.9); }
  .rule { width: 74px; height: 4px; background: ${TOMATO}; margin: 26px 0 0; }
</style></head>
<body>
  <img class="photo" src="${photoDataUri}" alt="">
  <div class="scrim"></div>
  <div class="wrap">
    <img class="mark" src="MARK_SVG_DATA_URI" alt="">
    <p class="kicker">${kicker}</p>
    <h1>${title}</h1>
    <p class="sub">${sub}</p>
    <div class="rule"></div>
  </div>
</body></html>`;
}

function dataUri(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

async function main() {
  for (const dir of [outIcons, outOg, outImages]) fs.mkdirSync(dir, { recursive: true });

  const logoSvg = fs.readFileSync(path.join(brandDir, "logo.svg"));
  fs.writeFileSync(path.join(outImages, "bytesfx-logo.svg"), logoSvg);

  const browser = await puppeteer.launch({ headless: "new" });

  // --- icons ---
  for (const { file, size } of ICONS) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${CREAM}}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${logoSvg.toString()}</body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: path.join(outIcons, file), omitBackground: false });
    await page.close();
    console.log(`icon   ${file} (${size}x${size})`);
  }

  // --- social previews ---
  for (const card of OG) {
    const photoPath = path.join(generatedPhotos, card.photo);
    if (!fs.existsSync(photoPath)) {
      console.warn(`SKIP   ${card.file} — missing photo ${card.photo}`);
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    const html = ogHtml({
      title: card.title,
      sub: card.sub,
      kicker: card.kicker,
      photoDataUri: dataUri(photoPath, "image/jpeg"),
      fontDataUri: dataUri(path.join(root, "public", "assets", "fonts", "fraunces-latin-variable.woff2"), "font/woff2"),
    }).replace("MARK_SVG_DATA_URI", dataUri(path.join(brandDir, "logo.svg"), "image/svg+xml"));
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outOg, card.file), type: "jpeg", quality: 88 });
    await page.close();
    console.log(`og     ${card.file}`);
  }

  await browser.close();
  console.log("\nBrand assets written to public/assets/.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
