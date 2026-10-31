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
    demoBadge: document.querySelectorAll(".demo-badge").length,
    demoNotes: document.querySelectorAll(".notice-box").length,
    captions: document.querySelectorAll(".demo-caption").length,
    // Only one switch may be on screen: the staff console carries one for
    // the signed-out view and another for the signed-in top bar, and only
    // one of the two is showing at a time.
    themeSwitch: [...document.querySelectorAll("[data-theme-toggle]")].filter(
      (b) =>  b.getClientRects().length > 0
    ).length,
    theme: document.documentElement.getAttribute("data-theme"),
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
    // Every visitor-facing page carries the badge that says what the site is.
    if (a.demoBadge !== 1) issues.push(`demo badge count ${a.demoBadge}`);
    // Every page must offer the mode switch, and the page must know which
    // mode it is in before it paints.
    if (a.themeSwitch !== 1)  issues.push(`theme switch count ${a.themeSwitch}`);
    if (a.theme !== "light" && a.theme !== "dark")  issues.push(`theme not set: ${a.theme}`);
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

// ---- the mode switch ------------------------------------------------------
// The switch has to do three things: follow the operating system until the
// visitor says otherwise, remember what the visitor said, and leave the
// dark page legible. The first two are checked here; the third is checked
// by measuring the contrast of the text that carries the page.
console.log("\n=== theme ===");
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const issues = [];

  const read = () =>
    page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      bg: getComputedStyle(document.body).backgroundColor,
      stored: localStorage.getItem("bytesfx-theme"),
      label: document.querySelector("[data-theme-toggle]")?.getAttribute("aria-label") || null,
    }));

  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle2", timeout: 45000 });
  const system = await read();
  if (system.theme !== "dark") issues.push(`a dark system did not give a dark page (${system.theme})`);
  if (system.stored) issues.push(`the system preference was stored (${system.stored})`);

  // The visitor overrides the system, and the choice survives a reload.
  await page.click("[data-theme-toggle]");
  const clicked = await read();
  if (clicked.theme !== "light") issues.push(`the switch did not turn the page light (${clicked.theme})`);
  if (clicked.stored !== "light") issues.push(`the choice was not stored (${clicked.stored})`);
  await page.reload({ waitUntil: "networkidle2" });
  const reloaded = await read();
  if (reloaded.theme !== "light") issues.push(`the stored choice was lost on reload (${reloaded.theme})`);

  // Back to the dark page, and measure it.
  await page.click("[data-theme-toggle]");
  // Let any transition settle before the colours are read.
  await new Promise((r) => setTimeout(r, 400));
  const dark = await read();
  if (dark.theme !== "dark") issues.push(`the switch did not turn the page dark (${dark.theme})`);

  const samples = await page.evaluate(() => {
    const parse = (value) => {
      const n = (value.match(/[\d.]+/g) || []).map(Number);
      return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Composite the background chain and the text over it, so a translucent
    // layer is measured as it is actually seen.
    const backdropOf = (el) => {
      const layers = [];
      let node = el;
      while (node) {
        const layer = parse(getComputedStyle(node).backgroundColor);
        if (layer.a > 0) {
          layers.push(layer);
          if (layer.a >= 1) break;
        }
        node = node.parentElement;
      }
      let base = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        base = l.rgb.map((c, j) => l.a * c + (1 - l.a) * base[j]);
      }
      return base;
    };
    const targets = [
      ["body text", "body"],
      ["section lede", ".section-lede"],
      ["price", ".price"],
      ["footer link", ".site-footer a"],
      ["hero heading", ".hero h1"],
      ["hero tagline", ".hero__tagline"],
      ["demo badge", ".demo-badge"],
      ["primary button", ".hero-actions .button"],
      ["nav link", ".primary-nav a"],
      ["share button", ".nav-share"],
      ["theme switch", ".theme-toggle"],
      // The photographic band is on the homepage only, so it is measured
      // where it is and passed over where it is not.
      ["band heading", ".photo-band h2", true],
    ];
    return targets.map(([name, selector, optional]) => {
      const el = document.querySelector(selector);
      if (!el) return optional ? null : { name, missing: true };
      const bg = backdropOf(el);
      const fg = parse(getComputedStyle(el).color);
      const flat = fg.rgb.map((c, j) => fg.a * c + (1 - fg.a) * bg[j]);
      return { name, ratio: Number(ratio(flat, bg).toFixed(2)) };
    });
  });

  for (const s of samples) {
    if (!s) continue;
    if (s.missing) { issues.push(`missing: ${s.name}`); continue; }
    if (s.ratio < 4.5) issues.push(`contrast ${s.name} ${s.ratio}:1`);
    console.log(`  ${s.ratio >= 4.5 ? "ok" : "X"}  ${s.name.padEnd(16)} ${s.ratio}:1`);
  }
  if (issues.length) problems += issues.length;
  console.log(`  ${issues.length ? "X" : "ok"} theme switch${issues.length ? ": " + issues.join(" | ") : ""}`);
  await page.close();
}

await browser.close();
console.log(`\n${problems === 0 ? "No issues found." : `${problems} issue(s) found.`}`);
