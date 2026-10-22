// Walks every public page of the running site and reports the checks that
// matter for the rebrand: broken images, missing alt text, horizontal
// overflow, heading order, the demo notice, and console errors.
//
//   node tools/check-pages.mjs [baseUrl]
//
// Requires the dev server to be running (npx wrangler pages dev public).

import puppeteer from "puppeteer";

const BASE = process.argv[2] || "http://127.0.0.1:8792";
const PAGES = [
  "index.html",
  "menu.html",
  "soft-play.html",
  "parties.html",
  "calendar.html",
  "contact.html",
  "privacy.html",
  "terms.html",
  "cookies.html",
  "unsubscribe.html",
  "404.html",
  "admin.html",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const AUDIT = () => {
  const imgs = [...document.querySelectorAll("img")];
  // An image that is still loading (lazy) is not broken; one that finished
  // with no intrinsic width is.
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src"));
  const pending = imgs.filter((i) => !i.complete).length;
  const noAlt = imgs.filter((i) => i.getAttribute("alt") === null).map((i) => i.getAttribute("src"));
  const noDims = imgs.filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).map((i) => i.getAttribute("src"));
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
  const jumps = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) jumps.push(`${headings[i - 1]}->${headings[i]}`);
  }
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1
    ? `${document.documentElement.scrollWidth} > ${window.innerWidth}` : null;
  const anchors = [...document.querySelectorAll('a[href^="#"]')]
    .map((a) => a.getAttribute("href"))
    .filter((h) => h && h.length > 1 && !document.querySelector(h));
  const labels = [...document.querySelectorAll("input,select,textarea")].filter((el) => {
    if (el.type === "hidden") return false;
    if (el.getAttribute("aria-hidden") === "true") return false; // the spam honeypot
    if (el.getAttribute("tabindex") === "-1") return false;
    if (el.getAttribute("aria-label")) return false;
    if (el.getAttribute("aria-labelledby")) return false;
    return !document.querySelector(`label[for="${el.id}"]`) && !el.closest("label");
  }).map((el) => el.getAttribute("name") || el.id || el.type);
  return {
    imgs: imgs.length,
    pending,
    broken,
    noAlt,
    noDims,
    h1: document.querySelectorAll("h1").length,
    jumps,
    overflow,
    deadAnchors: anchors,
    unlabelled: labels,
    demoBanner: !!document.querySelector(".demo-banner"),
    demoNotes: document.querySelectorAll(".demo-note").length,
    captions: document.querySelectorAll(".demo-caption").length,
    title: document.title,
    canonical: document.querySelector("link[rel=canonical]")?.href || null,
    ogImage: document.querySelector('meta[property="og:image"]')?.content || null,
  };
};

const OLD_BRAND = /Oak Hill|oak\.bytesfx|Malibu|0208 361|3611013|EN4 8JP|Parkside|Barnet|5-star|Very Good|Food Standards|since 1996|OHP-|ohpc/i;

const browser = await puppeteer.launch({ headless: "new" });
let problems = 0;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 120)));

  console.log(`\n=== ${vp.name} (${vp.width}x${vp.height}) ===`);
  for (const p of PAGES) {
    errors.length = 0;
    await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle2", timeout: 45000 });
    // Scroll the whole page so lazy-loaded images actually request, then
    // return to the top before measuring.
    //
    // The scroll has to be slow enough for Chrome's lazy loader to start each
    // image, and the wait happens at the bottom: scrolling back to the top
    // first cancels the loads of images that are still far below the fold. A
    // fast scroll used to leave images unstarted, which the check below could
    // not tell apart from a genuinely broken image.
    await page.evaluate(async () => {
      const step = Math.floor(window.innerHeight / 2);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    // Wait for every image to settle, so that one still pending afterwards is
    // a real failure rather than a slow network.
    await page
      .waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete), {
        timeout: 20000,
      })
      .catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));
    const a = await page.evaluate(AUDIT);
    const text = await page.evaluate(() => document.body.innerText);
    const oldBrand = (text.match(new RegExp(OLD_BRAND, "g")) || []);
    const issues = [];
    if (a.broken.length) issues.push(`broken imgs: ${a.broken.join(", ")}`);
    if (a.pending) issues.push(`still loading: ${a.pending}`);
    if (a.noAlt.length) issues.push(`no alt: ${a.noAlt.join(", ")}`);
    if (a.noDims.length) issues.push(`no dims: ${a.noDims.join(", ")}`);
    if (a.h1 !== 1) issues.push(`h1 count ${a.h1}`);
    if (a.jumps.length) issues.push(`heading jumps ${a.jumps.join(",")}`);
    if (a.overflow) issues.push(`h-overflow ${a.overflow}`);
    if (a.deadAnchors.length) issues.push(`dead anchors ${a.deadAnchors.join(",")}`);
    if (a.unlabelled.length) issues.push(`unlabelled ${a.unlabelled.join(",")}`);
    if (errors.length) issues.push(`console: ${errors.join(" | ")}`);
    if (oldBrand.length) issues.push(`OLD BRAND: ${oldBrand.join(",")}`);
    if (issues.length) problems += issues.length;
    console.log(`  ${issues.length ? "X" : "ok"} ${p.padEnd(18)} ${issues.join(" | ")}`);
  }
  await page.close();
}

await browser.close();
console.log(`\n${problems === 0 ? "No issues found." : `${problems} issue(s) found.`}`);
