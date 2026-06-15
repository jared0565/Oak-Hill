// tests/totp-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode, base32Decode,
  newTotpSecret, totpAt, verifyTotp,
  otpauthUri, newBackupCodes,
} from "../functions/api/_lib/totp-core.mjs";
import { hashToken } from "../functions/api/_lib/auth-core.mjs";

const enc = new TextEncoder();

test("base32 encode/decode round-trips arbitrary bytes", () => {
  for (const sample of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
    const bytes = enc.encode(sample);
    const b32 = base32Encode(bytes);
    assert.deepEqual(base32Decode(b32), new Uint8Array(bytes));
  }
  // Known RFC 4648 vectors (no padding).
  assert.equal(base32Encode(enc.encode("foobar")), "MZXW6YTBOI");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), new Uint8Array(enc.encode("foobar")));
});

test("base32Decode rejects characters outside the alphabet", () => {
  assert.throws(() => base32Decode("0189"), /Invalid base32/);
});

test("newTotpSecret yields a 20-byte (32-char base32) secret", () => {
  const s = newTotpSecret();
  assert.equal(s.length, 32);              // 20 bytes → ceil(160/5)=32 base32 chars
  assert.equal(base32Decode(s).length, 20);
  assert.notEqual(newTotpSecret(), newTotpSecret());
});

test("RFC 6238 known-answer: secret '12345678901234567890' at t=59s → 287082", async () => {
  // ASCII "12345678901234567890" is base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
  const secret = base32Encode(enc.encode("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(await totpAt(secret, 59000), "287082");
});

test("verifyTotp accepts T and T±1, rejects T±2 and malformed input", async () => {
  const secret = newTotpSecret();
  const now = 1_700_000_000_000;
  const codeNow = await totpAt(secret, now);
  assert.equal(await verifyTotp(secret, codeNow, now), true);
  // The code computed at T-1 / T+1 must still verify when checked at T (window tolerance).
  assert.equal(await verifyTotp(secret, await totpAt(secret, now - 30000), now), true);
  assert.equal(await verifyTotp(secret, await totpAt(secret, now + 30000), now), true);
  // T±2 is outside the window → rejected (unless it happens to collide, vanishingly unlikely).
  assert.equal(await verifyTotp(secret, await totpAt(secret, now - 60000), now), false);
  assert.equal(await verifyTotp(secret, await totpAt(secret, now + 60000), now), false);
  // Malformed input.
  assert.equal(await verifyTotp(secret, "12345", now), false);   // 5 digits
  assert.equal(await verifyTotp(secret, "1234567", now), false); // 7 digits
  assert.equal(await verifyTotp(secret, "abcdef", now), false);  // non-numeric
  assert.equal(await verifyTotp(secret, "", now), false);
  assert.equal(await verifyTotp(secret, 287082, now), false);    // not a string
});

test("otpauthUri carries the secret, issuer, and SHA1/6/30 params", () => {
  const uri = otpauthUri("staff@oakhill.test", "GEZDGNBVGY3TQOJQ");
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=GEZDGNBVGY3TQOJQ/);
  assert.match(uri, /issuer=Oak%20Hill%20Admin/); // spec-exact: %20, never "+"
  assert.doesNotMatch(uri, /\+/);                  // no "+" space-encoding anywhere
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
  assert.match(uri, /staff%40oakhill\.test/);
});

test("backup codes: a generated code's hash verifies; a wrong code doesn't", async () => {
  const { codes, hashes } = await newBackupCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(hashes.length, 10);
  for (let i = 0; i < codes.length; i++) {
    assert.equal(codes[i].length, 10);
    assert.match(codes[i], /^[A-Z2-7]{10}$/);          // uppercase base32 (login normalizes input)
    assert.equal(await hashToken(codes[i]), hashes[i]); // the verify identity used at login
  }
  assert.equal(hashes.includes(await hashToken("WRONGCODE0")), false);
  // Hashes are unique (codes are high-entropy).
  assert.equal(new Set(hashes).size, 10);
});
