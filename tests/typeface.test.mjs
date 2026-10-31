// tests/typeface.test.mjs
//
// The display face is a design decision with four parts, and each of them
// can rot quietly:
//
//   - the typeface is a design variable, so it can be changed in one place;
//   - the file it points at is in this repository, because the site's
//     content-security policy allows no third-party font and a visitor's
//     address should not be handed to a font house to read a heading;
//   - the licence travels with the file, as the SIL Open Font License asks;
//   - every page asks for the font early, so the headings do not swap from
//     the fallback after the first paint.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const css = read("public/assets/styles.css");
const pages = [
  "index.html", "menu.html", "soft-play.html", "parties.html", "calendar.html",
  "contact.html", "admin.html", "privacy.html", "terms.html", "cookies.html",
  "unsubscribe.html", "404.html",
];

test("the typeface is a design variable, not a font stack written into a rule", () => {
  assert.match(css, /--font-display:\s*"Fraunces"/, "there is no --font-display token");
  assert.match(css, /--font-body:\s*"Segoe UI"/, "there is no --font-body token");
  // The headings take the variable, so changing the face is one edit.
  assert.match(css, /\.hero h1 \{[^}]*font-family:\s*var\(--font-display\)/s);
  assert.match(css, /\.page-hero h1 \{[^}]*font-family:\s*var\(--font-display\)/s);
  // The old tokens are gone, so nothing is left pointing at a face that is
  // no longer the site's.
  assert.doesNotMatch(css, /--serif:/);
  assert.doesNotMatch(css, /--sans:/);
  assert.doesNotMatch(css, /var\(--serif\)/);
  assert.doesNotMatch(css, /var\(--sans\)/);
});

test("the display face is served from this repository", () => {
  const face = css.match(/@font-face\s*\{([^}]*)\}/);
  assert.ok(face, "the stylesheet declares no font face");
  const src = face[1].match(/src:\s*url\("([^"]+)"\)/);
  assert.ok(src, "the font face has no source");
  const file = join(ROOT, "public/assets", src[1]);
  assert.ok(existsSync(file), `the font file is missing: ${src[1]}`);
  // A variable font: the weights are a range, not a single value.
  assert.match(face[1], /font-weight:\s*100\s+900/);
});

test("the font's licence travels with it", () => {
  const licence = join(ROOT, "public/assets/fonts/OFL.txt");
  assert.ok(existsSync(licence), "the font licence is not in the repository");
  const text = readFileSync(licence, "utf8");
  assert.match(text, /SIL Open Font License/);
  assert.match(text, /Fraunces/);
});

test("the font file is a reasonable thing to ask a visitor for", () => {
  const size = statSync(join(ROOT, "public/assets/fonts/fraunces-latin-variable.woff2")).size;
  assert.ok(size < 120 * 1024, `the font is ${Math.round(size / 1024)}KB, which is more than it should be`);
});

test("every page asks for the font before the first paint", () => {
  for (const page of pages) {
    const html = read(join("public", page));
    const preload = html.match(/<link[^>]+rel="preload"[^>]*as="font"[^>]*>/);
    assert.ok(preload, `${page} does not preload the font`);
    assert.match(preload[0], /href="assets\/fonts\/fraunces-latin-variable\.woff2"/, `${page} preloads something else`);
    assert.match(preload[0], /crossorigin/, `${page} preloads the font without crossorigin, so it is fetched twice`);
    // The preload has to come before the stylesheet that asks for the face.
    assert.ok(
      html.indexOf(preload[0]) < html.indexOf('<link rel="stylesheet"'),
      `${page} preloads the font after the stylesheet`
    );
  }
});

test("no page loads a font from another origin", () => {
  for (const page of pages) {
    const html = read(join("public", page));
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, `${page} loads a font from a font CDN`);
  }
  assert.doesNotMatch(css, /https?:\/\/[^)]*\.(woff2?|ttf|otf)/, "the stylesheet loads a font from elsewhere");
});
