// tests/demo-badge.test.mjs
//
// The badge is what tells a visitor the site is a demonstration, so it has
// to be there, it has to say so, and the movement it makes has to stop for
// anyone who has asked for less motion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const css = read("public/assets/styles.css");
const PAGES = [
  "index.html", "menu.html", "soft-play.html", "parties.html", "calendar.html",
  "contact.html", "admin.html", "privacy.html", "terms.html", "cookies.html",
  "unsubscribe.html", "404.html",
];

test("every page carries the badge, and it says what the site is", () => {
  for (const page of PAGES) {
    const html = read(join("public", page));
    const badges = html.match(/class="demo-badge"/g) || [];
    assert.equal(badges.length, 1, `${page} carries ${badges.length} badges`);
    assert.match(html, /<p class="demo-badge">Demo Site<\/p>/, `${page}'s badge does not say "Demo Site"`);
  }
});

test("the badge is a stamp, not a pill", () => {
  const rule = css.match(/\.demo-badge \{([^}]*)\}/);
  assert.ok(rule, "the badge has no rule");
  // A crisp rectangle with a hairline keyline inside the fill.
  const radius = rule[1].match(/border-radius:\s*(\d+)px/);
  assert.ok(radius, "the badge has no radius of its own");
  assert.ok(Number(radius[1]) <= 8, "the badge is a pill again");
  assert.match(rule[1], /inset 0 0 0 1px/, "the badge has lost its keyline");
  // The mark is a square set on its corner, not a round dot.
  const mark = css.match(/\.demo-badge::before \{([^}]*)\}/);
  assert.ok(mark, "the badge has no mark");
  assert.match(mark[1], /transform:\s*rotate\(45deg\)/, "the mark is not the square");
  assert.doesNotMatch(mark[1], /border-radius:\s*50%/);
});

test("the badge pulses, and only for anyone who has not asked for less motion", () => {
  assert.match(css, /@keyframes demo-badge-pulse/);
  // The pulse is a ring, not a fade: fading the stamp would dim its text.
  const keyframes = css.match(/@keyframes demo-badge-pulse \{([\s\S]*?)\n\}/);
  assert.ok(keyframes, "the pulse has no keyframes");
  assert.match(keyframes[1], /0 0 0 \d+px rgba\(/, "the pulse is not a ring");
  assert.doesNotMatch(keyframes[1], /opacity/);

  const guarded = css.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/);
  assert.ok(guarded, "the movement is not guarded");
  assert.match(guarded[1], /\.demo-badge \{[^}]*animation:\s*demo-badge-pulse/);
});
