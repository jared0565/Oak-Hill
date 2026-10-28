// tests/photo-band.test.mjs
//
// The photographic band: one picture, edge to edge, with the type reversed
// out of it. Three things have to stay true, and none of them is obvious
// from the page itself:
//
//   - the picture is described, because a visitor who cannot see it still
//     needs to know what is there;
//   - the wash the type sits on carries a colour of its own, not only a
//     gradient, so the contrast of the type can be measured against it;
//   - the page checker measures the band, so that contrast is watched on
//     every deployment instead of being assumed once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const html = read("public/index.html");
const css = read("public/assets/styles.css");
const checker = read("tools/check-pages.mjs");

test("the homepage carries the band, and the picture is described", () => {
  assert.match(html, /class="photo-band"/);

  const img = html.match(/<img[^>]*class="photo-band__img"[^>]*>/);
  assert.ok(img, "the band has no picture");
  assert.match(img[0], /alt="[^"]{20,}"/, "the band's picture is not described");
  // The dimensions are declared, so the band does not shift as the picture
  // arrives.
  assert.match(img[0], /width="1024"/);
  assert.match(img[0], /height="683"/);
  assert.match(img[0], /loading="lazy"/);
});

test("the band closes the page, inside the main content", () => {
  const band = html.indexOf('class="photo-band"');
  const footer = html.indexOf("<footer");
  const main = html.indexOf("<main");
  const mainEnd = html.indexOf("</main>");
  assert.ok(band > main && band < mainEnd, "the band is not inside the main content");
  assert.ok(band < footer, "the band is not before the footer");
});

test("the type sits on a wash the checker can measure", () => {
  assert.match(html, /class="photo-band__wash"/);

  const wash = css.match(/\.photo-band__wash \{([^}]*)\}/);
  assert.ok(wash, "the band has no wash");
  // A gradient alone cannot be measured, so the wash needs a colour of its
  // own: this is what the page checker reads.
  assert.match(wash[1], /background-color:/, "the wash has no colour to measure against");
});

test("the page checker measures the band's heading, and only where there is one", () => {
  assert.match(checker, /\["band heading", "\.photo-band h2", true\]/);
});
