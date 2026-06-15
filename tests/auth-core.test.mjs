// tests/auth-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can, permissionsFor, PERMISSIONS,
  hashPassword, verifyPassword, validatePassword,
  newSessionToken, hashToken,
  looksLikeBot, isLocked, nextFailedState,
  MAX_FAILED, LOCK_MINUTES,
  protectedBlock, PBKDF2_ITERATIONS,
  requires2fa, mustEnroll2fa,
} from "../functions/api/_lib/auth-core.mjs";

test("PBKDF2_ITERATIONS stays within the Cloudflare Workers cap", () => {
  // Workers' WebCrypto throws NotSupportedError for PBKDF2 >100000. Node has no cap, so this
  // guard — not the hash round-trip — is what keeps us from shipping a value the runtime rejects.
  assert.ok(PBKDF2_ITERATIONS <= 100000, "PBKDF2 >100000 is rejected by the Workers runtime");
  assert.ok(PBKDF2_ITERATIONS >= 100000, "don't weaken below the runtime maximum");
});

test("can(): owner everything, staff only bookings+messages, manager not tracking/users/audit", () => {
  assert.equal(can("owner", "users"), true);
  assert.equal(can("owner", "contacts.erase"), true);
  assert.equal(can("staff", "bookings"), true);
  assert.equal(can("staff", "messages"), true);
  assert.equal(can("staff", "reports"), false);
  assert.equal(can("staff", "contacts"), false);
  assert.equal(can("manager", "contacts.export"), true);
  assert.equal(can("manager", "contacts.erase"), true);
  assert.equal(can("manager", "tracking"), false);
  assert.equal(can("manager", "users"), false);
  assert.equal(can("manager", "audit"), false);
  assert.equal(can("owner", "newsletter"), true);
  assert.equal(can("manager", "newsletter"), false); // mass marketing email is owner-only
  assert.equal(can("staff", "newsletter"), false);
  assert.equal(can("nobody", "bookings"), false);
});

test("permissionsFor() returns a copy matching the map", () => {
  assert.deepEqual(permissionsFor("staff"), ["bookings", "messages"]);
  const p = permissionsFor("owner");
  p.push("x");
  assert.equal(PERMISSIONS.owner.includes("x"), false); // not mutated
});

test("hashPassword/verifyPassword round-trip", async () => {
  const rec = await hashPassword("correct horse battery staple");
  assert.ok(rec.hash && rec.salt && rec.iterations > 0);
  assert.equal(await verifyPassword("correct horse battery staple", rec), true);
  assert.equal(await verifyPassword("wrong password here", rec), false);
});

test("verifyPassword rejects a tampered hash/salt", async () => {
  const rec = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", { ...rec, hash: "AAAA" }), false);
  assert.equal(await verifyPassword("correct horse battery staple", { hash: rec.hash, salt: "AAAA", iterations: rec.iterations }), false);
});

test("hashToken is stable hex; newSessionToken is unique", async () => {
  const h1 = await hashToken("abc");
  const h2 = await hashToken("abc");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(newSessionToken(), newSessionToken());
  assert.ok(newSessionToken().length >= 40);
});

test("validatePassword needs >=12 chars", () => {
  assert.equal(validatePassword("short").ok, false);
  assert.equal(validatePassword("elevenchars").ok, false); // 11
  assert.equal(validatePassword("twelvechars!").ok, true); // 12
});

test("looksLikeBot flags missing/automation UAs only", () => {
  assert.deepEqual(looksLikeBot({ user_agent: "" }), { is_bot: true, reason: "no_user_agent" });
  assert.equal(looksLikeBot({ user_agent: "python-requests/2.31" }).is_bot, true);
  assert.equal(looksLikeBot({ user_agent: "curl/8.0" }).is_bot, true);
  assert.equal(looksLikeBot({ user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" }).is_bot, false);
});

test("protectedBlock guards the break-glass owner; password reset stays allowed", () => {
  const plain = { protected: 0, role: "manager" };
  assert.equal(protectedBlock(plain, { deleting: true }), null);
  assert.equal(protectedBlock(plain, { role: "staff" }), null);
  assert.equal(protectedBlock(plain, { status: "disabled" }), null);

  const root = { protected: 1, role: "owner" };
  assert.match(protectedBlock(root, { deleting: true }), /can't be deleted/);
  assert.match(protectedBlock(root, { role: "manager" }), /can't be demoted/);
  assert.match(protectedBlock(root, { status: "disabled" }), /can't be disabled/);

  // No-op / allowed actions return null.
  assert.equal(protectedBlock(root, { role: "owner" }), null);  // re-affirming owner is fine
  assert.equal(protectedBlock(root, { status: "active" }), null);
  assert.equal(protectedBlock(root, {}), null);                 // password-only reset
  assert.equal(protectedBlock(null, { deleting: true }), null); // missing target
});

test("requires2fa: only owner/manager are required roles", () => {
  assert.equal(requires2fa("owner"), true);
  assert.equal(requires2fa("manager"), true);
  assert.equal(requires2fa("staff"), false);
  assert.equal(requires2fa("nobody"), false);
});

test("mustEnroll2fa: privileged role without TOTP only", () => {
  assert.equal(mustEnroll2fa({ role: "owner", totp_enabled: 0 }), true);
  assert.equal(mustEnroll2fa({ role: "manager", totp_enabled: 0 }), true);
  // Once enabled, no longer forced.
  assert.equal(mustEnroll2fa({ role: "owner", totp_enabled: 1 }), false);
  assert.equal(mustEnroll2fa({ role: "manager", totp_enabled: 1 }), false);
  // Staff stay opt-in; missing user is safe.
  assert.equal(mustEnroll2fa({ role: "staff", totp_enabled: 0 }), false);
  assert.equal(mustEnroll2fa(null), false);
});

test("lockout trips on the MAX_FAILED-th failure and clears after the window", () => {
  let u = { failed_attempts: MAX_FAILED - 2, locked_until: null };
  const now = 1_000_000_000_000;
  const s1 = nextFailedState(u, now);           // attempt MAX_FAILED-1
  assert.equal(s1.locked, false);
  const s2 = nextFailedState({ failed_attempts: s1.failed_attempts, locked_until: null }, now); // MAX_FAILED
  assert.equal(s2.locked, true);
  assert.ok(s2.locked_until);
  assert.equal(isLocked({ locked_until: s2.locked_until }, now + 60_000), true);                 // 1 min later: still locked
  assert.equal(isLocked({ locked_until: s2.locked_until }, now + (LOCK_MINUTES + 1) * 60_000), false); // after window
  assert.equal(isLocked({ locked_until: null }, now), false);
});
