// tests/portrait-anchor.test.mjs
//
// The one portrait picture on the site. It sits beside the "Everything you
// can do here" copy and anchors that section, and three things have to stay
// true:
//
//   - the picture is described, because a visitor who cannot see it still
//     needs to know what is there;
//   - its declared dimensions are 3:4, so the browser reserves the right
//     shape before it arrives and the text beside it does not jump;
//   - the rule that pins the ratio is scoped to .image-stack, because
//     .image-stack is also used on parties.html and twice on soft-play.html,
//     where the pictures are landscape and must stay that way.
//
// The picture itself is the cake rather than the party table: the table
// carries pastel bunting and cone hats, which is the "template kids-party
// site" look PRODUCT.md names as the anti-reference.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const html = read("public/index.html");
const css = read("public/assets/styles.css");

test("the homepage has one portrait, and it is the cake", () => {
  const imgs = html.match(/<img[^>]*class="portrait"[^>]*>/g) || [];
  assert.equal(imgs.length, 1, "the homepage should carry exactly one portrait");
  assert.match(imgs[0], /src="assets\/images\/generated\/party-cake\.jpg"/);
  // The bunting picture is the anti-reference; it must not creep back in.
  assert.doesNotMatch(html, /party-table-detail/);
});

test("the portrait is described and declares a 3:4 box", () => {
  const img = html.match(/<img[^>]*class="portrait"[^>]*>/)[0];
  assert.match(img, /alt="[^"]{20,}"/, "the portrait is not described");
  assert.match(img, /width="768"/);
  assert.match(img, /height="1024"/);
  assert.match(img, /loading="lazy"/);
});

test("the ratio rule is scoped to the image stack", () => {
  // Every selector in the sheet, one per line.
  const selectors = [...css.matchAll(/^\s*([^\n{}]+)\{/gm)].map((m) => m[1].trim());
  const portraitRules = selectors.filter((s) => s.includes("img.portrait"));
  assert.deepEqual(
    portraitRules,
    [".image-stack img.portrait"],
    "the portrait must be pinned by one scoped rule"
  );
  const rule = css.match(/\.image-stack img\.portrait \{([^}]*)\}/);
  assert.match(rule[1], /aspect-ratio:\s*3\s*\/\s*4/);
});
