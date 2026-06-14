// tests/contacts-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, csvCell, validateTag } from "../functions/api/_lib/contacts-core.mjs";

test("normalizeEmail: trims + lowercases", () => {
  assert.equal(normalizeEmail("  Foo@BAR.com "), "foo@bar.com");
  assert.equal(normalizeEmail(null), "");
});
test("validateTag: normalizes spaces, rejects junk", () => {
  assert.deepEqual(validateTag("VIP Customer"), { ok: true, value: "vip-customer" });
  assert.equal(validateTag("bad!char").ok, false);
  assert.equal(validateTag("").ok, false);
});
test("csvCell: escapes quotes/commas/newlines and neutralizes formulas", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvCell("line1\nline2"), "line1 line2");
  assert.equal(csvCell("=cmd"), " =cmd");
  assert.equal(csvCell("@x"), " @x");
});
