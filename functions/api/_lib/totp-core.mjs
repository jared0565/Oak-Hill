// functions/api/_lib/totp-core.mjs
// Pure TOTP (RFC 6238) + backup-code helpers. Web Crypto only (globalThis.crypto), so this
// runs in Cloudflare Workers AND Node — and is unit-testable with `node --test`.
import { hashToken } from "./auth-core.mjs";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648, no padding
const ISSUER = "Oak Hill Admin";

// --- base32 (RFC 4648, no padding) -----------------------------------------------------
export function base32Encode(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bits = 0, value = 0, out = "";
  for (let i = 0; i < a.length; i++) {
    value = (value << 8) | a[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// --- secret / codes --------------------------------------------------------------------
export function newTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// --- TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s period) ----------------------------------
export async function totpAt(secretB32, timeMs) {
  const key = base32Decode(secretB32);
  // T = number of 30s steps since the unix epoch.
  let t = Math.floor(timeMs / 1000 / 30);
  // 8-byte big-endian T. Build by division (JS bitwise is 32-bit → shifts ≥32 corrupt).
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { msg[i] = t & 0xff; t = Math.floor(t / 256); }
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secretB32, code, timeMs = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code) || !secretB32) return false;
  // Accept ±1 window (±30s clock skew): T-1, T, T+1.
  for (let w = -1; w <= 1; w++) {
    const candidate = await totpAt(secretB32, timeMs + w * 30000);
    if (constantTimeEqual(candidate, code)) return true;
  }
  return false;
}

export function otpauthUri(email, secretB32) {
  const label = encodeURIComponent(ISSUER) + ":" + encodeURIComponent(email);
  // URLSearchParams encodes spaces as "+", but the otpauth spec/label use %20 — keep both
  // halves consistent (some authenticator parsers read a literal "+" instead of a space).
  const query = new URLSearchParams({
    secret: secretB32,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  }).toString().replace(/\+/g, "%20");
  return `otpauth://totp/${label}?${query}`;
}

// --- backup codes (10-char base32 plain; stored as SHA-256 hex, single-use) ------------
export async function newBackupCodes(n = 10) {
  const codes = [];
  const hashes = [];
  for (let i = 0; i < n; i++) {
    // 10 base32 chars → 50 bits of entropy. base32Encode(7 bytes)=56 bits → slice to 10.
    const code = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
    codes.push(code);
    hashes.push(await hashToken(code));
  }
  return { codes, hashes };
}
