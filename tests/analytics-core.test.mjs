// tests/analytics-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSource, validateTrackName, sanitizeDays } from "../functions/api/_lib/analytics-core.mjs";

test("deriveSource: utm wins, lowercased", () => {
  assert.equal(deriveSource("https://www.google.com/x", "Facebook", "oak-hill-park-cafe.pages.dev"), "facebook");
});
test("deriveSource: external referrer -> host only (no query leak)", () => {
  assert.equal(deriveSource("https://www.google.com/search?q=secret+personal+thing", "", "oak-hill-park-cafe.pages.dev"), "www.google.com");
});
test("deriveSource: self referrer -> direct", () => {
  assert.equal(deriveSource("https://oak-hill-park-cafe.pages.dev/menu", "", "oak-hill-park-cafe.pages.dev"), "direct");
});
test("deriveSource: empty / garbage -> direct", () => {
  assert.equal(deriveSource("", "", "x.pages.dev"), "direct");
  assert.equal(deriveSource("not a url", "", "x.pages.dev"), "direct");
});
test("validateTrackName: allowlist only", () => {
  assert.equal(validateTrackName("page_view"), true);
  assert.equal(validateTrackName("slot_selected"), true);
  assert.equal(validateTrackName("lead_captured"), true);
  assert.equal(validateTrackName("evil"), false);
  assert.equal(validateTrackName(""), false);
});
test("sanitizeDays: 7/30/90 else 30", () => {
  assert.equal(sanitizeDays("7"), 7);
  assert.equal(sanitizeDays(30), 30);
  assert.equal(sanitizeDays("90"), 90);
  assert.equal(sanitizeDays("5"), 30);
  assert.equal(sanitizeDays("abc"), 30);
});
