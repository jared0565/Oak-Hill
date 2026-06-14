// tests/lead-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLead } from "../functions/api/_lib/lead-core.mjs";

test("validateLead: valid email, optional name", () => {
  assert.deepEqual(validateLead({ email: " a@b.com ", name: " Sam " }), { ok: true, value: { email: "a@b.com", name: "Sam" } });
  assert.deepEqual(validateLead({ email: "a@b.com" }), { ok: true, value: { email: "a@b.com", name: null } });
});
test("validateLead: rejects bad/missing email", () => {
  assert.equal(validateLead({ email: "" }).ok, false);
  assert.equal(validateLead({ email: "nope" }).ok, false);
  assert.equal(validateLead({ name: "x" }).ok, false);
});
