// Builds the downloadable sample menu PDF from the live menu page.
//
//   node tools/build-menu-pdf.mjs
//
// Output: public/assets/bytesfx-cafe-sample-menu.pdf
//
// The PDF is rendered from public/menu.html with Puppeteer, so the menu text
// stays in one place: the HTML page. The stylesheet's @media print rules strip
// the site chrome and lay the menu out for A4. Regenerate after editing the
// menu page.

import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "public", "menu.html");
const outDir = path.join(root, "public", "assets");
const outFile = path.join(outDir, "bytesfx-cafe-sample-menu.pdf");

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error("public/menu.html not found");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const fileUrl = `file:///${source.replace(/\\/g, "/")}`;
  await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });
  await page.emulateMediaType("print");
  await page.pdf({
    path: outFile,
    format: "A4",
    margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
    printBackground: true,
  });
  await browser.close();

  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✓ ${path.relative(root, outFile)} (${kb} KB)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
