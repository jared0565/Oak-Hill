import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clean, sanitizeEnquiry, validateEnquiry, spamReason, buildEmailPayload,
} from "../functions/api/_lib/enquiry-core.mjs";

test("clean trims and caps length", () => {
  assert.equal(clean("  hi  ", 10), "hi");
  assert.equal(clean("abcdef", 3), "abc");
  assert.equal(clean(null, 5), "");
});

test("sanitizeEnquiry defaults to general and drops party fields", () => {
  const e = sanitizeEnquiry({ type: "weird", name: " Jo ", email: "a@b.co", children: 5, party_date: "2026-07-01" });
  assert.equal(e.type, "general");
  assert.equal(e.name, "Jo");
  assert.equal(e.party_date, null);
  assert.equal(e.children, null);
});

test("sanitizeEnquiry keeps and clamps party fields", () => {
  const e = sanitizeEnquiry({ type: "party", name: "Jo", email: "a@b.co", phone: "0207", children: "999", child_age: "5", party_date: "2026-07-01" });
  assert.equal(e.type, "party");
  assert.equal(e.children, 100);
  assert.equal(e.party_date, "2026-07-01");
  assert.equal(e.phone, "0207");
});

test("validateEnquiry requires name and a sane email", () => {
  assert.equal(validateEnquiry({ name: "", email: "a@b.co" }).ok, false);
  assert.equal(validateEnquiry({ name: "Jo", email: "nope" }).ok, false);
  assert.equal(validateEnquiry({ name: "Jo", email: "a@b.co" }).ok, true);
});

test("spamReason catches honeypot and too-fast submits", () => {
  assert.equal(spamReason({ company: "x" }), "honeypot");
  assert.equal(spamReason({ elapsed_ms: 500 }), "too_fast");
  assert.equal(spamReason({ elapsed_ms: 9000 }), null);
  assert.equal(spamReason({}), null);
});

test("buildEmailPayload returns null without addresses, builds text otherwise", () => {
  const e = sanitizeEnquiry({ type: "party", name: "Jo", email: "a@b.co", phone: "0207", children: "10", party_date: "2026-07-01", message: "hi" });
  assert.equal(buildEmailPayload(e, {}), null);
  const p = buildEmailPayload(e, { ENQUIRY_NOTIFY_TO: "cafe@x.co", ENQUIRY_FROM: "no-reply@x.co" });
  assert.equal(p.to[0], "cafe@x.co");
  assert.equal(p.reply_to, "a@b.co");
  assert.match(p.subject, /party enquiry/i);
  assert.match(p.text, /Children: 10/);
});
