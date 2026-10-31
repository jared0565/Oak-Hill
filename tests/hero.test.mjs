// tests/hero.test.mjs
//
// The homepage hero: one full-bleed photograph with the type centred over
// it, in the manner of the reference café site. Four things have to stay
// true, and none of them is obvious from the page itself:
//
//   - the picture is described, because a visitor who cannot see it still
//     needs to know what is there;
//   - the picture and its renditions are in the repository, and the prompt
//     that made it is recorded, so it can be made again;
//   - the wash over the photograph is a colour, so the page checker can
//     measure the type against something;
//   - the caption is not inside the washed layer, or the wash would dim it
//     below the contrast it needs to be read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const html = read("public/index.html");
const css = read("public/assets/styles.css");
const spec = JSON.parse(read("tools/brand/photos.json"));

const IMAGE = "party-outdoor-hero.jpg";

test("the hero is one full-bleed picture, and it is described", () => {
  const img = html.match(/<img[^>]*class="hero__img"[^>]*>/);
  assert.ok(img, "the hero has no picture");
  assert.match(img[0], /alt="[^"]{40,}"/, "the hero's picture is not described");
  assert.match(img[0], /width="1024"/);
  assert.match(img[0], /height="420"/, "the hero's picture is not a 1024x420 band");
  assert.match(img[0], /fetchpriority="high"/, "the hero's picture is not fetched early");
  // It is a band, so the browser reserves the right shape before it arrives.
  assert.match(html, /<picture>[\s\S]*?hero__img[\s\S]*?<\/picture>/);
});

test("the picture and its renditions are in the repository", () => {
  for (const file of [IMAGE, "party-outdoor-hero-512.webp", "party-outdoor-hero-1024.webp"]) {
    assert.ok(
      existsSync(join(ROOT, "public/assets/images/generated", file)),
      `${file} is missing from the repository`
    );
  }
  // The prompt that made it is recorded, so it can be made again.
  const entry = spec.photos.find((p) => p.file === IMAGE);
  assert.ok(entry, `photos.json does not record ${IMAGE}`);
  assert.ok(entry.prompt && entry.prompt.length > 40, "the prompt is not recorded");
});

test("the wash over the photograph is a colour the checker can measure", () => {
  const hero = css.match(/\.hero \{([^}]*)\}/);
  assert.ok(hero, "the hero has no rule");
  assert.match(hero[1], /background:\s*#0d1a12/, "the hero has no colour behind the wash");
  const wash = css.match(/\.hero__media::after \{([^}]*)\}/);
  assert.ok(wash, "the photograph has no wash");
  assert.match(wash[1], /background:\s*rgba\(/, "the wash is not a colour");
});

test("the type is centred over the picture", () => {
  assert.match(css, /\.hero \{[^}]*text-align:\s*center/s, "the hero's type is not centred");
  assert.match(css, /\.hero h1 \{[^}]*text-align:\s*center/s, "the heading is not centred");
  assert.match(css, /\.hero-actions \{[^}]*justify-content:\s*center/s, "the buttons are not centred");
  // The tagline carries the clock mark, and it is hidden from a screen
  // reader because the words beside it already say what it is.
  assert.match(html, /class="hero__tagline-icon"[^>]*aria-hidden="true"/);
});

test("the caption sits outside the washed layer", () => {
  const media = html.match(/<div class="hero__media">([\s\S]*?)<\/div>/);
  assert.ok(media, "the hero has no media layer");
  assert.doesNotMatch(media[1], /demo-caption/, "the caption is inside the washed layer");
  assert.match(html, /<p class="demo-caption hero__caption">/);
  // And it is given a z-index above the wash, so the wash cannot dim it.
  const caption = css.match(/\.hero__caption \{([^}]*)\}/);
  assert.ok(caption, "the caption has no rule");
  assert.match(caption[1], /z-index:\s*3/);
});
