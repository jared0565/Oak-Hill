// Captures the demonstration site for the handover: every public page, at
// desktop and mobile widths.
//
//   node tools/capture-screenshots.mjs [baseUrl] [outDir]
//
// Requires the dev server to be running (npx wrangler pages dev public).

import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8792";
const OUT = process.argv[3] || path.resolve("screenshots");

const PAGES = [
  ["index", "index.html"],
  ["menu", "menu.html"],
  ["soft-play", "soft-play.html"],
  ["parties", "parties.html"],
  ["calendar", "calendar.html"],
  ["contact", "contact.html"],
  ["privacy", "privacy.html"],
  ["terms", "terms.html"],
  ["cookies", "cookies.html"],
  ["unsubscribe", "unsubscribe.html"],
  ["admin", "admin.html"],
];
const VIEWPORTS = [
  ["desktop", 1280, 900],
  ["mobile", 390, 844],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();

for (const [name, width, height] of VIEWPORTS) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  for (const [slug, file] of PAGES) {
    await page.goto(`${BASE}/${file}`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 600));
    const out = path.join(OUT, `demo-${slug}-${name}.jpg`);
    await page.screenshot({ path: out, type: "jpeg", quality: 82, fullPage: true });
    console.log(`  ${path.basename(out)}`);
  }
}

await browser.close();
console.log("Screenshots written to " + OUT);
