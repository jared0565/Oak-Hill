// tests/snippet-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSnippet, unknownHostsIn, pageMatchesScope } from "../functions/api/_lib/snippet-core.mjs";

test("validateSnippet: good snippet normalizes", () => {
  const v = validateSnippet({ label: "GA4", code: "<script>1</script>", placement: "head", scope: "global", consent_category: "analytics", enabled: true });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { label: "GA4", code: "<script>1</script>", placement: "head", scope: "global", consent_category: "analytics", enabled: 1 });
});

test("validateSnippet: defaults + coercions", () => {
  const v = validateSnippet({ label: "x", code: "y" });
  assert.equal(v.value.placement, "head");
  assert.equal(v.value.scope, "global");
  assert.equal(v.value.consent_category, "advertising");
  assert.equal(v.value.enabled, 1);
});

test("validateSnippet: rejects blanks + bad scope", () => {
  assert.equal(validateSnippet({ label: "", code: "y" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "y", scope: "parties" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "y", scope: "/parties.html" }).ok, true);
});

test("unknownHostsIn: flags only non-allowlisted hosts", () => {
  assert.deepEqual(unknownHostsIn('<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>'), []);
  assert.deepEqual(unknownHostsIn('<script src="https://connect.facebook.net/en_US/fbevents.js"></script>'), []);
  assert.deepEqual(unknownHostsIn('<script src="https://evil.example.com/x.js"></script>'), ["evil.example.com"]);
  assert.deepEqual(unknownHostsIn("<script>console.log('no urls')</script>"), []);
});

test("pageMatchesScope: global, exact, .html<->clean, home, non-match", () => {
  assert.equal(pageMatchesScope("global", "/anything"), true);
  assert.equal(pageMatchesScope("/parties.html", "/parties"), true);
  assert.equal(pageMatchesScope("/parties.html", "/parties.html"), true);
  assert.equal(pageMatchesScope("/index.html", "/"), true);
  assert.equal(pageMatchesScope("/", "/index.html"), true);
  assert.equal(pageMatchesScope("/menu.html", "/parties"), false);
});
