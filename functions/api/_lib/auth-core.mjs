// functions/api/_lib/auth-core.mjs
// Pure identity helpers. Uses Web Crypto (globalThis.crypto) — present in Workers AND Node,
// so everything here is unit-testable with `node --test`.

const ALL = [
  "availability", "bookings", "messages", "reports",
  "contacts", "contacts.export", "contacts.erase",
  "tracking", "users", "audit",
];
export const PERMISSIONS = {
  owner: ALL.slice(),
  manager: ["availability", "bookings", "messages", "reports", "contacts", "contacts.export", "contacts.erase"],
  staff: ["bookings", "messages"],
};
export function permissionsFor(role) { return PERMISSIONS[role] ? PERMISSIONS[role].slice() : []; }
export function can(role, perm) { return !!PERMISSIONS[role] && PERMISSIONS[role].includes(perm); }

// A protected account (the break-glass root owner) is locked against removal: it
// can't be deleted, disabled, or demoted from owner — regardless of how many other
// owners exist. Password reset stays allowed so the owner can rotate their own
// credentials. Returns a human-readable reason if the action is blocked, else null.
export function protectedBlock(target, action = {}) {
  if (!target || !target.protected) return null;
  if (action.deleting) return "This is the protected owner account and can't be deleted.";
  if (action.role !== undefined && action.role !== "owner") return "This is the protected owner account and can't be demoted.";
  if (action.status === "disabled") return "This is the protected owner account and can't be disabled.";
  return null;
}

export const SESSION_HOURS = 12;
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
// Starting point; Task 15 measures a real login and tunes this under the Pages CPU budget.
// Stored per-user (password_iterations), so changing it only affects new/reset passwords.
export const PBKDF2_ITERATIONS = 150000;

const enc = new TextEncoder();
function toB64(bytes) { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
function fromB64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function toB64url(bytes) { return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export async function hashPassword(password, opts = {}) {
  const iterations = opts.iterations || PBKDF2_ITERATIONS;
  const salt = opts.salt ? fromB64(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256);
  return { hash: toB64(bits), salt: toB64(salt), iterations };
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
export async function verifyPassword(password, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  let derived;
  try { derived = await hashPassword(password, { salt: rec.salt, iterations: rec.iterations }); }
  catch (_) { return false; }
  return constantTimeEqual(derived.hash, rec.hash);
}

export function newSessionToken() { return toB64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(token)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < 12) return { ok: false, error: "Password must be at least 12 characters." };
  return { ok: true };
}

const BOT_UA_RE = /(bot|spider|crawl|curl|wget|python-requests|python-urllib|httpclient|headless|phantomjs|scrapy|go-http-client|libwww|java\/)/i;
export function looksLikeBot({ user_agent } = {}) {
  const ua = (user_agent || "").trim();
  if (!ua) return { is_bot: true, reason: "no_user_agent" };
  if (BOT_UA_RE.test(ua)) return { is_bot: true, reason: "automation_ua" };
  return { is_bot: false, reason: null };
}

export function isLocked(user, nowMs) {
  return !!(user && user.locked_until) && new Date(user.locked_until).getTime() > nowMs;
}
export function nextFailedState(user, nowMs) {
  const failed = (user.failed_attempts || 0) + 1;
  if (failed >= MAX_FAILED) {
    return { failed_attempts: failed, locked_until: new Date(nowMs + LOCK_MINUTES * 60000).toISOString(), locked: true };
  }
  return { failed_attempts: failed, locked_until: null, locked: false };
}
export function sessionExpiry(nowMs) { return new Date(nowMs + SESSION_HOURS * 3600000).toISOString(); }
