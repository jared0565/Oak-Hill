// Builds the downloadable sample menu PDF from the live menu page.
//
//   node tools/build-menu-pdf.mjs
//
// Output: public/assets/bytesfx-cafe-menu.pdf
//
// The PDF is rendered from public/menu.html with Puppeteer, so the menu text
// stays in one place: the HTML page. The stylesheet's @media print rules strip
// the site chrome and lay the menu out for A4. Regenerate after editing the
// menu page.
//
// The page is served over http rather than opened as a file:// URL. Chrome
// treats every file as its own origin, so a file:// page cannot load the
// display face from the repository next to it — the PDF would silently be set
// in a fallback serif and would stop matching the page it is built from.

import puppeteer from "puppeteer";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const source = path.join(publicDir, "menu.html");
const outDir = path.join(publicDir, "assets");
const outFile = path.join(outDir, "bytesfx-cafe-menu.pdf");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function serve(directory) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(directory, relative);
    if (!file.startsWith(directory) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    response.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error("public/menu.html not found");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { server, port } = await serve(publicDir);
  const browser = await puppeteer.launch({ headless: "new" });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/menu.html`, { waitUntil: "networkidle0", timeout: 60000 });
    // Wait for the display face to be in the font cache, before and after
    // the print emulation: the PDF is set in it, and without this the
    // headings quietly fall back to a system serif.
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType("print");
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: outFile,
      format: "A4",
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
      printBackground: true,
    });
  } finally {
    await browser.close();
    server.close();
  }

  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✓ ${path.relative(root, outFile)} (${kb} KB)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
