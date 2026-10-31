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
// display face from the repository next to it — the PDF would silently be
// set in a fallback serif and would stop matching the page it is built from.

import puppeteer from "puppeteer";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const source = path.join(publicDir, "menu.html");
const outDir = path.join(publicDir, "assets");
const outFile = path.join(outDir, "bytesfx-cafe-menu.pdf");

// How long the page has to load before the build gives up on it.
export const PAGE_TIMEOUT_MS = 60000;

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

/**
 * Work out which file a request is asking for, and whether it may have it.
 *
 * The requested path is resolved and then compared with the directory it has
 * to sit inside, so a request that climbs out of it is refused rather than
 * served. A plain prefix test would not do: the directory is `…/public`, and
 * a sibling directory called `public-backup` starts with the same string.
 * Percent-encoded slashes matter too — the URL parser leaves `%2f` alone,
 * and decoding it afterwards turns `/..%2fpublic-backup%2fsecret` into a
 * climb that the parser never normalised.
 *
 * Returns the file, or null when the request may not have it.
 */
export function resolveRequest(directory, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(directory, relative);
  const inside = path.relative(directory, file);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    return null;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return null;
  }
  return file;
}

export function serve(directory) {
  const server = http.createServer((request, response) => {
    const file = resolveRequest(directory, request.url);
    if (!file) {
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
    await page.goto(`http://127.0.0.1:${port}/menu.html`, { waitUntil: "networkidle0", timeout: PAGE_TIMEOUT_MS });
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

// Only build when this file is the thing being run: the tests import it.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
