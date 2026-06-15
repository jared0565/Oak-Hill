// tests/unsubscribe-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail } from "../functions/api/_lib/unsubscribe-core.mjs";

test("maskEmail keeps first char + domain, stars the rest", () => {
  assert.equal(maskEmail("jane@example.com"), "j***@example.com");
  assert.equal(maskEmail("  Bob@Cafe.co.uk  "), "B***@Cafe.co.uk");
  assert.equal(maskEmail("a@b.com"), "a***@b.com"); // single-char local part
});

test("maskEmail falls back for non-addresses", () => {
  assert.equal(maskEmail(""), "your email");
  assert.equal(maskEmail(null), "your email");
  assert.equal(maskEmail("notanemail"), "your email");
  assert.equal(maskEmail("@nolocal.com"), "your email"); // empty local part
  assert.equal(maskEmail("trailing@"), "your email");    // empty domain
});
