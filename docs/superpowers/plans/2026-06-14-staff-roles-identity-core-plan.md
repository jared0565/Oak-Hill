# Phase 1 — Identity Core + Staff Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared `ADMIN_TOKEN` with named staff accounts (owner/manager/staff) that log in with email + password and carry server-enforced permissions, a full sign-in/activity log, and Turnstile bot-blocking.

**Architecture:** A hand-rolled identity core in D1 — `users` + `sessions` + `audit_log` (migration 0008). Pure logic (permission map, PBKDF2 hashing, token + lockout + bot heuristics) lives in `auth-core.mjs` (unit-tested with `node --test`); D1-coupled helpers in `auth-db.mjs`; Turnstile verify in `turnstile.mjs`. New `/api/auth/*` endpoints issue per-user **Bearer session tokens** (sent exactly like the old token). The admin `_middleware.js` becomes authentication-only; every admin route calls `requirePermission(ctx, perm)` and audits its mutations. The dashboard gains email+password login, first-run owner setup, role-based section hiding, an Owner-only Users manager, and an Owner-only Activity log.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Web Crypto (PBKDF2/SHA-256), Cloudflare Turnstile, vanilla JS/CSS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-14-staff-roles-identity-core-design.md`

**⚠️ Two cut-over hazards, both handled by task ordering:**
1. **The middleware swap (Task 6) is a hard cut-over** — the instant it lands, the old single-password login is dead and every admin route needs a session. So Tasks 2–5 build the whole auth path first; Task 6 swaps the gate; Task 7 adds per-route authorization in the *same* local cycle before anything deploys. Nothing ships until Task 15.
2. **This must be built on a feature branch, NOT `master`** (Task 1) — pushing `master` auto-deploys via CI. Migration 0008 is **additive only** (pure `CREATE TABLE` — no data mutation, nothing irreversible), so no production backup is required, unlike the CRM migration.

**Local D1 / test reminders (learned the hard way on this repo):**
- Run the local server config-driven: `npx wrangler pages dev public --port 8788 --compatibility-date 2024-11-01` (uses the `wrangler.jsonc` DB binding → the same store `wrangler d1 migrations apply ... --local` writes to). Do **NOT** pass `--d1 DB=...` (spins up a separate empty store).
- `node --test` wants **explicit file paths** (a Node 24 quirk makes a bare directory arg report a false failure).
- `.dev.vars` is gitignored; its local `ADMIN_TOKEN` is `local-test-password` (NOT the production secret).

---

### Task 1: Feature branch + migration 0008 (users / sessions / audit_log)

**Files:**
- Create: `migrations/0008_users.sql`

- [ ] **Step 1: Create the feature branch** (never build this on `master`)

```bash
cd "F:/Projects/Websites/Oak Hill"
git checkout -b feat/staff-roles-identity
```

- [ ] **Step 2: Write the migration** — `migrations/0008_users.sql`

```sql
-- Migration 0008: staff identity core — users, login sessions, sign-in + activity log.
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL,
  name                TEXT NOT NULL,
  role                TEXT NOT NULL,                  -- 'owner' | 'manager' | 'staff'
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_sha256 TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_sha256);
CREATE INDEX        IF NOT EXISTS idx_sessions_user  ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_email   TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  detail        TEXT,
  ip            TEXT,
  country       TEXT,
  user_agent    TEXT,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  bot_reason    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
```

- [ ] **Step 3: Apply locally** — `npx wrangler d1 migrations apply oak-hill-bookings --local`. Expected: `0008` applied, no error.
- [ ] **Step 4: Confirm tables exist** — `npx wrangler d1 execute oak-hill-bookings --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','audit_log');"`. Expected: all three listed.
- [ ] **Step 5: Commit**

```bash
git add migrations/0008_users.sql
git commit -m "Add identity core tables (users/sessions/audit_log) — migration 0008"
```

---

### Task 2: Pure core — `auth-core.mjs` (+ tests)

**Files:**
- Create: `functions/api/_lib/auth-core.mjs`
- Test: `tests/auth-core.test.mjs`

- [ ] **Step 1: Write the failing tests** — `tests/auth-core.test.mjs`

```js
// tests/auth-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can, permissionsFor, PERMISSIONS,
  hashPassword, verifyPassword, validatePassword,
  newSessionToken, hashToken,
  looksLikeBot, isLocked, nextFailedState,
  MAX_FAILED, LOCK_MINUTES,
} from "../functions/api/_lib/auth-core.mjs";

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
```

- [ ] **Step 2: Run — expect FAIL** — `node --test tests/auth-core.test.mjs`. Expected: cannot find module / undefined exports.

- [ ] **Step 3: Implement** — `functions/api/_lib/auth-core.mjs`

```js
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
```

- [ ] **Step 4: Run — expect PASS** — `node --test tests/auth-core.test.mjs`. Expected: 8 tests pass.
- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/auth-core.mjs tests/auth-core.test.mjs
git commit -m "Add auth-core: permissions, PBKDF2 hashing, tokens, lockout, bot heuristic (+ tests)"
```

---

### Task 3: Turnstile verifier — `turnstile.mjs`

**Files:**
- Create: `functions/api/_lib/turnstile.mjs`

- [ ] **Step 1: Implement** — `functions/api/_lib/turnstile.mjs`

```js
// functions/api/_lib/turnstile.mjs
// Cloudflare Turnstile bot check. No-op unless BOTH keys are configured (graceful rollout).

export function turnstileEnabled(env) {
  return !!(env && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
}

// Returns true only on a verified-human response. Fail-closed: any missing token, network
// error, or non-success verdict → false (callers only enforce this when turnstileEnabled).
export async function verifyTurnstile(secret, token, ip) {
  if (!secret || !token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return data && data.success === true;
  } catch (_) {
    return false;
  }
}
```

- [ ] **Step 2: Syntax check** — `node --check functions/api/_lib/turnstile.mjs`. Expected: no output (valid).
- [ ] **Step 3: Commit**

```bash
git add functions/api/_lib/turnstile.mjs
git commit -m "Add Turnstile siteverify helper (graceful when unconfigured)"
```

---

### Task 4: D1-coupled helpers — `auth-db.mjs`

**Files:**
- Create: `functions/api/_lib/auth-db.mjs`

(Like the existing `contacts-db.mjs`, this layer is verified by `node --check` + the live end-to-end task, not unit tests — it needs a real D1 binding.)

- [ ] **Step 1: Implement** — `functions/api/_lib/auth-db.mjs`

```js
// functions/api/_lib/auth-db.mjs
// D1-coupled identity helpers + the per-request authorization/audit utilities.
import { hashPassword, hashToken, newSessionToken, sessionExpiry, can } from "./auth-core.mjs";

// --- request context (actor IP / country / device) -------------------------------------
export function reqContext(request) {
  const ip = request.headers.get("cf-connecting-ip") || null;
  const country = (request.cf && request.cf.country) || null;
  const ua = request.headers.get("user-agent");
  return { ip, country, user_agent: ua ? ua.slice(0, 256) : null };
}

// --- audit log -------------------------------------------------------------------------
export async function recordAudit(db, e) {
  try {
    await db.prepare(
      `INSERT INTO audit_log
        (actor_user_id, actor_email, action, target_type, target_id, detail, ip, country, user_agent, is_bot, bot_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      e.actor_user_id ?? null,
      e.actor_email ?? null,
      e.action,
      e.target_type ?? null,
      e.target_id == null ? null : String(e.target_id),
      e.detail ?? null,
      e.ip ?? null,
      e.country ?? null,
      e.user_agent ?? null,
      e.is_bot ? 1 : 0,
      e.bot_reason ?? null
    ).run();
  } catch (_) { /* best-effort: never break the action being logged */ }
}
// Convenience for authenticated routes: actor from ctx.data.user, context from the request.
export function auditFromCtx(ctx, e) {
  const u = ctx.data && ctx.data.user;
  return recordAudit(ctx.env.DB, {
    actor_user_id: u ? u.id : null,
    actor_email: u ? u.email : null,
    ...reqContext(ctx.request),
    ...e,
  });
}

// --- authorization guard (returns a 403 Response, or null if allowed) ------------------
export function requirePermission(ctx, perm) {
  const u = ctx.data && ctx.data.user;
  if (u && can(u.role, perm)) return null;
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

// --- users -----------------------------------------------------------------------------
export function findUserByEmail(db, email) { return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first(); }
export function getUserById(db, id) { return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first(); }
export async function countOwners(db) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND status='active'").first();
  return r ? r.n : 0;
}
export async function createUser(db, { name, email, role, password }) {
  const { hash, salt, iterations } = await hashPassword(password);
  const r = await db.prepare(
    "INSERT INTO users (email, name, role, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(email, name, role, hash, salt, iterations).run();
  return r.meta.last_row_id;
}
export async function updateUser(db, id, fields) {
  const sets = [], binds = [];
  if (fields.role !== undefined) { sets.push("role=?"); binds.push(fields.role); }
  if (fields.status !== undefined) { sets.push("status=?"); binds.push(fields.status); }
  if (fields.password !== undefined) {
    const { hash, salt, iterations } = await hashPassword(fields.password);
    sets.push("password_hash=?", "password_salt=?", "password_iterations=?");
    binds.push(hash, salt, iterations);
  }
  if (!sets.length) return 0;
  binds.push(id);
  const r = await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return r.meta.changes;
}
export async function deleteUser(db, id) {
  const r = await db.prepare("DELETE FROM users WHERE id=?").bind(id).run();
  return r.meta.changes;
}
export async function listUsers(db) {
  const { results } = await db.prepare(
    "SELECT id, name, email, role, status, last_login_at, created_at FROM users ORDER BY created_at"
  ).all();
  return results;
}

// --- sessions --------------------------------------------------------------------------
export async function createSession(db, userId, nowMs) {
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const expires = sessionExpiry(nowMs);
  await db.prepare("INSERT INTO sessions (token_sha256, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expires).run();
  return { token, expires };
}
export async function resolveSession(db, tokenHash, nowIso) {
  const row = await db.prepare(
    `SELECT s.expires_at, u.id, u.name, u.email, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_sha256 = ?`
  ).bind(tokenHash).first();
  if (!row || row.status !== "active" || row.expires_at <= nowIso) return null;
  return row;
}
export function touchSession(db, tokenHash, nowIso) {
  return db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_sha256 = ?").bind(nowIso, tokenHash).run();
}
export function deleteSession(db, tokenHash) { return db.prepare("DELETE FROM sessions WHERE token_sha256 = ?").bind(tokenHash).run(); }
export function deleteUserSessions(db, userId) { return db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run(); }

// --- login bookkeeping -----------------------------------------------------------------
export async function recordLoginResult(db, user, ok, nowMs, lockState) {
  if (ok) {
    await db.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=? WHERE id=?")
      .bind(new Date(nowMs).toISOString(), user.id).run();
  } else {
    await db.prepare("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?")
      .bind(lockState.failed_attempts, lockState.locked_until, user.id).run();
  }
}
```

- [ ] **Step 2: Syntax check** — `node --check functions/api/_lib/auth-db.mjs`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add functions/api/_lib/auth-db.mjs
git commit -m "Add auth-db: users/sessions/audit D1 helpers + requirePermission + reqContext"
```

---

### Task 5: Auth endpoints — `/api/auth/{status,bootstrap,login,logout,me}`

**Files:**
- Create: `functions/api/auth/status.js`
- Create: `functions/api/auth/bootstrap.js`
- Create: `functions/api/auth/login.js`
- Create: `functions/api/auth/logout.js`
- Create: `functions/api/auth/me.js`

(These live under `/api/auth/`, which has no `_middleware.js`, so they are reachable without a session — each one self-guards.)

- [ ] **Step 1: `functions/api/auth/status.js`**

```js
// /api/auth/status — public: is first-run setup still needed, and the Turnstile site key (public).
export async function onRequestGet(ctx) {
  const row = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return Response.json(
    { needs_bootstrap: !row || row.n === 0, turnstile_site_key: ctx.env.TURNSTILE_SITE_KEY || null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
```

- [ ] **Step 2: `functions/api/auth/bootstrap.js`**

```js
// /api/auth/bootstrap — one-time first-owner creation. Guarded by ADMIN_TOKEN + empty users (+ Turnstile).
import { createUser, createSession, recordAudit, reqContext } from "../_lib/auth-db.mjs";
import { validatePassword, permissionsFor } from "../_lib/auth-core.mjs";
import { turnstileEnabled, verifyTurnstile } from "../_lib/turnstile.mjs";
import { normalizeEmail, clean } from "../_lib/contacts-core.mjs";

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const c = reqContext(ctx.request);

  if (turnstileEnabled(ctx.env)) {
    const ok = await verifyTurnstile(ctx.env.TURNSTILE_SECRET, body.turnstileToken, c.ip);
    if (!ok) {
      await recordAudit(ctx.env.DB, { action: "auth.bot_blocked", ...c, is_bot: 1, bot_reason: body.turnstileToken ? "turnstile_failed" : "turnstile_missing", detail: "bootstrap" });
      return Response.json({ error: "Could not verify you are human. Please try again." }, { status: 403 });
    }
  }

  const countRow = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (countRow && countRow.n > 0) return Response.json({ error: "Setup is already complete." }, { status: 409 });
  if (!ctx.env.ADMIN_TOKEN || body.adminToken !== ctx.env.ADMIN_TOKEN) return Response.json({ error: "Setup token is incorrect." }, { status: 401 });

  const email = normalizeEmail(body.email);
  const name = clean(body.name, 100);
  const pw = typeof body.password === "string" ? body.password : "";
  if (!email || !name) return Response.json({ error: "Name and email are required." }, { status: 400 });
  const pv = validatePassword(pw);
  if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 });

  const id = await createUser(ctx.env.DB, { name, email, role: "owner", password: pw });
  await recordAudit(ctx.env.DB, { actor_user_id: id, actor_email: email, action: "auth.bootstrap", ...c, detail: "first owner" });
  const { token } = await createSession(ctx.env.DB, id, Date.now());
  return Response.json({ token, user: { name, email, role: "owner", permissions: permissionsFor("owner") } });
}
```

- [ ] **Step 3: `functions/api/auth/login.js`**

```js
// /api/auth/login — email+password → Bearer session token. Public; bot-checked; no enumeration.
import { findUserByEmail, recordLoginResult, createSession, recordAudit, reqContext } from "../_lib/auth-db.mjs";
import { verifyPassword, permissionsFor, isLocked, nextFailedState, looksLikeBot } from "../_lib/auth-core.mjs";
import { turnstileEnabled, verifyTurnstile } from "../_lib/turnstile.mjs";
import { normalizeEmail } from "../_lib/contacts-core.mjs";

const GENERIC = "Email or password is incorrect, or the account is locked.";
// A validly-shaped (all-zero-bytes) PBKDF2 record so unknown-email logins still spend
// hashing time → no user enumeration via timing. The verify always returns false.
const DUMMY = { hash: "A".repeat(43) + "=", salt: "A".repeat(22) + "==", iterations: 150000 };

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const c = reqContext(ctx.request);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const bot = looksLikeBot(c);

  // 1. Bot gate (only when configured) — rejected before any credential work; lockout untouched.
  if (turnstileEnabled(ctx.env)) {
    const ok = await verifyTurnstile(ctx.env.TURNSTILE_SECRET, body.turnstileToken, c.ip);
    if (!ok) {
      await recordAudit(ctx.env.DB, { actor_email: email || null, action: "auth.bot_blocked", ...c, is_bot: 1, bot_reason: body.turnstileToken ? "turnstile_failed" : "turnstile_missing" });
      return Response.json({ error: "Could not verify you are human. Please try again." }, { status: 403 });
    }
  }

  const user = email ? await findUserByEmail(ctx.env.DB, email) : null;

  // 2. Unknown email → dummy verify (timing) + generic.
  if (!user) {
    await verifyPassword(password, DUMMY);
    await recordAudit(ctx.env.DB, { actor_email: email || null, action: "auth.login_failed", ...c, is_bot: bot.is_bot ? 1 : 0, bot_reason: bot.reason, detail: "unknown email" });
    return Response.json({ error: GENERIC }, { status: 401 });
  }

  const now = Date.now();

  // 3. Locked or disabled → generic.
  if (user.status !== "active" || isLocked(user, now)) {
    await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.login_failed", ...c, is_bot: bot.is_bot ? 1 : 0, bot_reason: bot.reason, detail: user.status !== "active" ? "disabled" : "locked" });
    return Response.json({ error: GENERIC }, { status: 401 });
  }

  // 4. Verify password.
  const ok = await verifyPassword(password, { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iterations });
  if (!ok) {
    const lock = nextFailedState(user, now);
    await recordLoginResult(ctx.env.DB, user, false, now, lock);
    await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.login_failed", ...c, is_bot: bot.is_bot ? 1 : 0, bot_reason: bot.reason });
    if (lock.locked) await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.locked", ...c, detail: "locked 15m after 5 fails" });
    return Response.json({ error: GENERIC }, { status: 401 });
  }

  // 5. Success.
  await recordLoginResult(ctx.env.DB, user, true, now);
  const { token } = await createSession(ctx.env.DB, user.id, now);
  await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.login", ...c });
  return Response.json({ token, user: { name: user.name, email: user.email, role: user.role, permissions: permissionsFor(user.role) } });
}
```

- [ ] **Step 4: `functions/api/auth/logout.js`**

```js
// /api/auth/logout — revoke the current session (Bearer).
import { hashToken } from "../_lib/auth-core.mjs";
import { resolveSession, deleteSession, recordAudit, reqContext } from "../_lib/auth-db.mjs";

export async function onRequestPost(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const th = await hashToken(token);
    const now = new Date(Date.now()).toISOString();
    const sess = await resolveSession(ctx.env.DB, th, now);
    if (sess) await recordAudit(ctx.env.DB, { actor_user_id: sess.id, actor_email: sess.email, action: "auth.logout", ...reqContext(ctx.request) });
    await deleteSession(ctx.env.DB, th);
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 5: `functions/api/auth/me.js`**

```js
// /api/auth/me — resolve the Bearer session → current user (lets the dashboard restore after reload).
import { hashToken, permissionsFor } from "../_lib/auth-core.mjs";
import { resolveSession } from "../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date(Date.now()).toISOString();
  const sess = await resolveSession(ctx.env.DB, await hashToken(token), now);
  if (!sess) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ user: { name: sess.name, email: sess.email, role: sess.role, permissions: permissionsFor(sess.role) } });
}
```

- [ ] **Step 6: Syntax check** — `node --check functions/api/auth/status.js functions/api/auth/bootstrap.js functions/api/auth/login.js functions/api/auth/logout.js functions/api/auth/me.js`. Expected: no output.
- [ ] **Step 7: Commit**

```bash
git add functions/api/auth/
git commit -m "Add /api/auth endpoints: status, bootstrap, login, logout, me"
```

---

### Task 6: Rewrite admin middleware → authentication-only

**Files:**
- Modify (replace whole file): `functions/api/admin/_middleware.js`

- [ ] **Step 1: Replace `functions/api/admin/_middleware.js` entirely**

```js
// Authenticates every /api/admin/* request via a Bearer SESSION token (not the old ADMIN_TOKEN).
// Authentication only — per-route authorization is enforced in each route via requirePermission().
import { hashToken } from "../_lib/auth-core.mjs";
import { resolveSession, touchSession } from "../_lib/auth-db.mjs";

export async function onRequest(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const th = await hashToken(token);
  const now = new Date(Date.now()).toISOString();
  const sess = await resolveSession(ctx.env.DB, th, now);
  if (!sess) return Response.json({ error: "Unauthorized" }, { status: 401 });
  ctx.data = ctx.data || {};
  ctx.data.user = { id: sess.id, name: sess.name, email: sess.email, role: sess.role };
  ctx.waitUntil(touchSession(ctx.env.DB, th, now));
  return ctx.next();
}
```

- [ ] **Step 2: Syntax check** — `node --check functions/api/admin/_middleware.js`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add functions/api/admin/_middleware.js
git commit -m "Rewrite admin middleware to authenticate Bearer sessions (drop ADMIN_TOKEN gate)"
```

---

### Task 7: Per-route authorization + audit on existing admin endpoints

**Files (modify):** `functions/api/admin/bookings.js`, `slots.js`, `calendar-events.js`, `enquiries.js`, `reports.js`, `contacts.js`, `code-snippets.js`

Every route gets `requirePermission(...)` at the top of each handler; mutating routes also call `auditFromCtx(...)` after a successful change. Apply each edit exactly.

- [ ] **Step 1: `bookings.js`**
  - Add import at the top (after the file's opening comment):
    ```js
    import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";
    ```
  - First line inside `onRequestGet(ctx)`:
    ```js
      const deny = requirePermission(ctx, "bookings"); if (deny) return deny;
    ```
  - First line inside `onRequestPost(ctx)`:
    ```js
      const deny = requirePermission(ctx, "bookings"); if (deny) return deny;
    ```
  - In the **confirm** branch, the block that declines other holds ends with `.run();` then `return Response.json({ ok: true });`. Insert the audit between them:
    ```js
          .run();
        await auditFromCtx(ctx, { action: "booking.confirm", target_type: "booking", target_id: id, detail: "marked paid" });
        return Response.json({ ok: true });
    ```
  - At the very end of `onRequestPost` (the final `}` of the cancel path then `return Response.json({ ok: true });`), insert the cancel audit before that final return:
    ```js
      }
      await auditFromCtx(ctx, { action: "booking.cancel", target_type: "booking", target_id: id });
      return Response.json({ ok: true });
    }
    ```

- [ ] **Step 2: `slots.js`**
  - Import: `import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";`
  - Add `const deny = requirePermission(ctx, "availability"); if (deny) return deny;` as the first line of **each** of `onRequestGet`, `onRequestPost`, `onRequestPut`, `onRequestDelete`.
  - Recurring-add return: before `return Response.json({ ok: true, added: toInsert.length, skipped: rows.length - toInsert.length });` insert:
    ```js
    await auditFromCtx(ctx, { action: "slot.create", detail: "bulk add " + toInsert.length + " slots" });
    ```
  - Single-add return: before `return Response.json({ ok: true, id: r.meta.last_row_id });` insert:
    ```js
    await auditFromCtx(ctx, { action: "slot.create", target_type: "slot", target_id: r.meta.last_row_id, detail: date + " " + start });
    ```
  - PUT success: before its final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: "slot.update", target_type: "slot", target_id: upd.id });
    ```
  - DELETE success: before its final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: "slot.delete", target_type: "slot", target_id: id });
    ```

- [ ] **Step 3: `calendar-events.js`**
  - Import: `import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";`
  - `const deny = requirePermission(ctx, "availability"); if (deny) return deny;` as first line of each handler (`onRequestGet/Post/Put/Delete`).
  - POST: before `return Response.json({ ok: true, id: r.meta.last_row_id });` insert:
    ```js
    await auditFromCtx(ctx, { action: "event.create", target_type: "event", target_id: r.meta.last_row_id, detail: e.kind + ": " + e.title });
    ```
  - PUT: before its final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: "event.update", target_type: "event", target_id: id });
    ```
  - DELETE: before its final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: "event.delete", target_type: "event", target_id: id });
    ```

- [ ] **Step 4: `enquiries.js`**
  - Import: `import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";`
  - `const deny = requirePermission(ctx, "messages"); if (deny) return deny;` as first line of `onRequestGet` and `onRequestPost`.
  - POST success: before the final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: b.action === "archive" ? "enquiry.archive" : "enquiry.read", target_type: "enquiry", target_id: id });
    ```

- [ ] **Step 5: `reports.js`** (read-only — guard only, no audit)
  - Import: `import { requirePermission } from "../_lib/auth-db.mjs";`
  - First line of `onRequestGet`: `const deny = requirePermission(ctx, "reports"); if (deny) return deny;`

- [ ] **Step 6: `contacts.js`**
  - Import: `import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";` (keep the existing `contacts-core` import).
  - `onRequestGet`: first line `const deny = requirePermission(ctx, "contacts"); if (deny) return deny;`. Then, **inside** the `if (url.searchParams.get("format") === "csv") {` block, as its first lines (before building rows):
    ```js
        const denyExport = requirePermission(ctx, "contacts.export"); if (denyExport) return denyExport;
        await auditFromCtx(ctx, { action: "contact.export", detail: "CSV export" });
    ```
  - `onRequestPut`: first line `const deny = requirePermission(ctx, "contacts"); if (deny) return deny;`. Before its final `return Response.json({ ok: true });` insert:
    ```js
      if (b.notes !== undefined) await auditFromCtx(ctx, { action: "contact.note", target_type: "contact", target_id: id });
      if (b.marketing_opt_in !== undefined) await auditFromCtx(ctx, { action: "contact.optin", target_type: "contact", target_id: id, detail: b.marketing_opt_in ? "opted in" : "opted out" });
    ```
  - `onRequestPost` (tags): first line `const deny = requirePermission(ctx, "contacts"); if (deny) return deny;`. Before its final `return Response.json({ ok: true });` insert:
    ```js
      await auditFromCtx(ctx, { action: action === "tag_add" ? "contact.tag_add" : "contact.tag_remove", target_type: "contact", target_id: id, detail: v.value });
    ```
  - `onRequestDelete` (erase): first line `const deny = requirePermission(ctx, "contacts.erase"); if (deny) return deny;`. Before its final `return Response.json({ ok: true });` insert:
    ```js
      await auditFromCtx(ctx, { action: "contact.erase", target_type: "contact", target_id: id });
    ```

- [ ] **Step 7: `code-snippets.js`**
  - Import: `import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";` (keep the existing `snippet-core` import).
  - `const deny = requirePermission(ctx, "tracking"); if (deny) return deny;` as first line of each handler.
  - POST: before `return Response.json({ ok: true, id: r.meta.last_row_id, warnings: unknownHostsIn(s.code) });` insert:
    ```js
    await auditFromCtx(ctx, { action: "snippet.create", target_type: "snippet", target_id: r.meta.last_row_id, detail: s.label });
    ```
  - PUT: before `return Response.json({ ok: true, warnings: unknownHostsIn(s.code) });` insert:
    ```js
    await auditFromCtx(ctx, { action: "snippet.update", target_type: "snippet", target_id: id, detail: s.label });
    ```
  - DELETE: before its final `return Response.json({ ok: true });` insert:
    ```js
    await auditFromCtx(ctx, { action: "snippet.delete", target_type: "snippet", target_id: id });
    ```

- [ ] **Step 8: Syntax check all seven**

```bash
node --check functions/api/admin/bookings.js functions/api/admin/slots.js functions/api/admin/calendar-events.js functions/api/admin/enquiries.js functions/api/admin/reports.js functions/api/admin/contacts.js functions/api/admin/code-snippets.js
```
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add functions/api/admin/
git commit -m "Enforce per-route permissions + audit mutations on all admin endpoints"
```

---

### Task 8: Owner-only Users endpoint — `/api/admin/users`

**Files:**
- Create: `functions/api/admin/users.js`

- [ ] **Step 1: Write the endpoint**

```js
// /api/admin/users — Owner-only staff account management (authz + audit enforced here).
import { requirePermission, auditFromCtx, listUsers, getUserById, findUserByEmail, createUser, updateUser, deleteUser, deleteUserSessions, countOwners } from "../_lib/auth-db.mjs";
import { validatePassword } from "../_lib/auth-core.mjs";
import { normalizeEmail, clean } from "../_lib/contacts-core.mjs";

const ROLES = ["owner", "manager", "staff"];

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  return Response.json({ users: await listUsers(ctx.env.DB) });
}

export async function onRequestPost(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const name = clean(b.name, 100);
  const email = normalizeEmail(b.email);
  const role = String(b.role || "");
  const pw = typeof b.password === "string" ? b.password : "";
  if (!name || !email) return Response.json({ error: "Name and email are required." }, { status: 400 });
  if (!ROLES.includes(role)) return Response.json({ error: "Pick a valid role." }, { status: 400 });
  const pv = validatePassword(pw); if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 });
  if (await findUserByEmail(ctx.env.DB, email)) return Response.json({ error: "That email is already in use." }, { status: 409 });
  const id = await createUser(ctx.env.DB, { name, email, role, password: pw });
  await auditFromCtx(ctx, { action: "user.create", target_type: "user", target_id: id, detail: role + " " + email });
  return Response.json({ ok: true, id });
}

export async function onRequestPut(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const target = await getUserById(ctx.env.DB, id);
  if (!target) return Response.json({ error: "Not found." }, { status: 404 });

  const fields = {};
  if (b.role !== undefined) { if (!ROLES.includes(String(b.role))) return Response.json({ error: "Bad role." }, { status: 400 }); fields.role = String(b.role); }
  if (b.status !== undefined) { const st = String(b.status); if (st !== "active" && st !== "disabled") return Response.json({ error: "Bad status." }, { status: 400 }); fields.status = st; }
  if (b.password !== undefined) { const pv = validatePassword(String(b.password)); if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 }); fields.password = String(b.password); }
  if (!Object.keys(fields).length) return Response.json({ error: "Nothing to update." }, { status: 400 });

  // Last-owner guard: never demote or disable the only active owner.
  const demoting = fields.role !== undefined && fields.role !== "owner" && target.role === "owner";
  const disabling = fields.status === "disabled" && target.role === "owner";
  if ((demoting || disabling) && (await countOwners(ctx.env.DB)) <= 1) {
    return Response.json({ error: "This is the last active owner — promote another owner first." }, { status: 409 });
  }

  const detail = [];
  if (fields.role) detail.push("role: " + target.role + "→" + fields.role);
  if (fields.status) detail.push("status: " + target.status + "→" + fields.status);
  if (fields.password) detail.push("password reset");
  await updateUser(ctx.env.DB, id, fields);
  if (fields.status === "disabled" || fields.password !== undefined) await deleteUserSessions(ctx.env.DB, id);
  await auditFromCtx(ctx, { action: "user.update", target_type: "user", target_id: id, detail: detail.join(", ") });
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  if (ctx.data.user.id === id) return Response.json({ error: "You can't delete your own account while signed in." }, { status: 409 });
  const target = await getUserById(ctx.env.DB, id);
  if (!target) return Response.json({ error: "Not found." }, { status: 404 });
  if (target.role === "owner" && (await countOwners(ctx.env.DB)) <= 1) {
    return Response.json({ error: "This is the last active owner — promote another owner first." }, { status: 409 });
  }
  await deleteUser(ctx.env.DB, id);
  await deleteUserSessions(ctx.env.DB, id);
  await auditFromCtx(ctx, { action: "user.delete", target_type: "user", target_id: id, detail: target.role + " " + target.email });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Syntax check** — `node --check functions/api/admin/users.js`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add functions/api/admin/users.js
git commit -m "Add Owner-only Users management endpoint with last-owner guardrails"
```

---

### Task 9: Owner-only Activity-log endpoint — `/api/admin/audit`

**Files:**
- Create: `functions/api/admin/audit.js`

- [ ] **Step 1: Write the endpoint**

```js
// /api/admin/audit — Owner-only read of the sign-in + activity log, with filters.
import { requirePermission } from "../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "audit"); if (deny) return deny;
  const url = new URL(ctx.request.url);
  const where = [], binds = [];

  const actor = Number(url.searchParams.get("actor"));
  if (Number.isInteger(actor) && actor > 0) { where.push("actor_user_id = ?"); binds.push(actor); }

  const action = (url.searchParams.get("action") || "").trim();
  if (action) {
    if (action.endsWith(".")) { where.push("action LIKE ?"); binds.push(action + "%"); }
    else { where.push("action = ?"); binds.push(action); }
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || "")) { where.push("created_at >= ?"); binds.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || "")) { where.push("created_at <= ?"); binds.push(to + " 23:59:59"); }

  if (url.searchParams.get("include_bots") !== "1") where.push("is_bot = 0");

  let limit = Number(url.searchParams.get("limit")) || 200;
  if (limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  let sql = "SELECT created_at, actor_email, action, target_type, target_id, detail, ip, country, user_agent, is_bot, bot_reason FROM audit_log";
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY id DESC LIMIT ?";
  binds.push(limit);
  const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return Response.json({ entries: results });
}
```

- [ ] **Step 2: Syntax check** — `node --check functions/api/admin/audit.js`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add functions/api/admin/audit.js
git commit -m "Add Owner-only Activity-log endpoint with actor/action/date/bot filters"
```

---

### Task 10: Dashboard shell — login, first-run setup, Turnstile, role-aware app (`admin.html` + `admin.js`)

**Files:**
- Modify (replace whole file): `public/admin.html`
- Modify (replace whole file): `public/assets/admin.js`

- [ ] **Step 1: Replace `public/admin.html` entirely**

```html
<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Booking admin | Oak Hill Park Cafe</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="favicon.ico" sizes="32x32">
  <link rel="icon" type="image/png" sizes="32x32" href="assets/icons/icon-32.png">
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <main id="main" class="section">
    <div class="section-inner admin">
      <span class="kicker">Staff only</span>
      <h1>Booking admin</h1>

      <div data-admin-setup hidden>
        <p class="section-lede">First-time setup: create the owner account. Enter the setup token (the <code>ADMIN_TOKEN</code> from Cloudflare), then choose your sign-in details.</p>
        <form data-admin-setup-form class="form-panel admin-login">
          <label>Setup token <input type="password" name="adminToken" autocomplete="off" required></label>
          <label>Your name <input type="text" name="name" autocomplete="name" required></label>
          <label>Email <input type="email" name="email" autocomplete="username" required></label>
          <label>Password (at least 12 characters) <input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
          <div data-setup-turnstile></div>
          <button class="button" type="submit">Create owner account</button>
          <p class="form-status" data-admin-setup-status aria-live="polite"></p>
        </form>
      </div>

      <div data-admin-login hidden>
        <p class="section-lede">Sign in to manage bookings.</p>
        <form data-admin-login-form class="form-panel admin-login">
          <label>Email <input type="email" name="email" autocomplete="username" required></label>
          <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
          <div data-login-turnstile></div>
          <button class="button" type="submit">Sign in</button>
          <p class="form-status" data-admin-login-status aria-live="polite"></p>
        </form>
      </div>

      <div data-admin-app hidden>
        <p class="admin-whoami" data-admin-whoami></p>

        <section class="admin-block" data-perm="availability">
          <h2>Availability</h2>
          <p class="section-lede">Manage party slots, events and closures. A closure stops that day's slots being bookable on the website.</p>
          <div data-availability><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="reports">
          <h2>Reports</h2>
          <p class="section-lede">Visits and traffic are counted anonymously with no cookies. Booking and enquiry numbers come from your live data.</p>
          <div data-reports><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="bookings">
          <h2>Bookings</h2>
          <div class="admin-table-wrap" data-admin-bookings><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="messages">
          <h2>Messages</h2>
          <p class="section-lede">Contact and party enquiries submitted through the website.</p>
          <div class="admin-table-wrap" data-admin-enquiries><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="contacts">
          <h2>Contacts</h2>
          <p class="section-lede">One record per person, from bookings and enquiries. Search, tag, add notes, export, or erase someone's details on request.</p>
          <div data-contacts><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="tracking">
          <h2>Tracking code</h2>
          <p class="section-lede">Paste tracking snippets (Google tag, Meta Pixel, etc.) to run on the public site. <strong>Necessary</strong> runs immediately; <strong>Analytics</strong>/<strong>Advertising</strong> run only after the visitor consents. Only known ad/analytics providers are allowed by the site's security policy; tags using <code>document.write</code> may not work when added this way.</p>
          <div data-tracking><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="users">
          <h2>Users</h2>
          <p class="section-lede">Staff accounts and roles. Owners can add people, change roles, reset passwords, disable or remove accounts.</p>
          <div data-users><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <section class="admin-block" data-perm="audit">
          <h2>Activity</h2>
          <p class="section-lede">Sign-ins and changes, newest first — who did what, when, and from where. Bot attempts are hidden unless you tick the box.</p>
          <div data-audit><p class="booking-note">Loading&hellip;</p></div>
        </section>

        <p><button class="button ghost" type="button" data-admin-logout>Sign out</button></p>
      </div>
    </div>
  </main>
  <script src="assets/admin-availability.js" defer></script>
  <script src="assets/admin-tracking.js" defer></script>
  <script src="assets/admin-reports.js" defer></script>
  <script src="assets/admin-contacts.js" defer></script>
  <script src="assets/admin-users.js" defer></script>
  <script src="assets/admin-audit.js" defer></script>
  <script src="assets/admin.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Replace `public/assets/admin.js` entirely**

```js
(function () {
  const KEY = "ohpc-admin-token";
  const setupWrap = document.querySelector("[data-admin-setup]");
  const setupForm = document.querySelector("[data-admin-setup-form]");
  const setupStatus = document.querySelector("[data-admin-setup-status]");
  const loginWrap = document.querySelector("[data-admin-login]");
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loginStatus = document.querySelector("[data-admin-login-status]");
  const app = document.querySelector("[data-admin-app]");
  const whoami = document.querySelector("[data-admin-whoami]");
  const bookingsEl = document.querySelector("[data-admin-bookings]");
  const enquiriesEl = document.querySelector("[data-admin-enquiries]");
  const logoutBtn = document.querySelector("[data-admin-logout]");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + d + " " + MONTHS[m - 1] + " " + y;
  }

  let currentUser = null;
  let siteKey = null;
  let turnstileToken = "";
  let turnstileScript = null;

  const token = () => sessionStorage.getItem(KEY) || "";
  const authHeaders = () => ({ Authorization: "Bearer " + token(), "Content-Type": "application/json" });
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  // ---- Turnstile (only when a site key is configured) ----
  function ensureTurnstileScript() {
    return new Promise((resolve) => {
      if (window.turnstile) return resolve();
      if (turnstileScript) { turnstileScript.addEventListener("load", () => resolve()); return; }
      turnstileScript = document.createElement("script");
      turnstileScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      turnstileScript.async = true; turnstileScript.defer = true;
      turnstileScript.addEventListener("load", () => resolve());
      document.head.appendChild(turnstileScript);
    });
  }
  async function mountTurnstile(container) {
    if (!siteKey || !container) return;
    await ensureTurnstileScript();
    if (!window.turnstile) return;
    container.replaceChildren();
    window.turnstile.render(container, { sitekey: siteKey, callback: (t) => { turnstileToken = t; } });
  }
  function resetTurnstile() { turnstileToken = ""; if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} } }

  // ---- view switching ----
  function showSetup() {
    app.hidden = true; loginWrap.hidden = true; setupWrap.hidden = false;
    mountTurnstile(document.querySelector("[data-setup-turnstile]"));
  }
  function showLogin() {
    app.hidden = true; setupWrap.hidden = true; loginWrap.hidden = false;
    mountTurnstile(document.querySelector("[data-login-turnstile]"));
  }
  function showApp() {
    setupWrap.hidden = true; loginWrap.hidden = true; app.hidden = false;
    applyPermissions();
    refresh();
  }
  function applyPermissions() {
    const perms = (currentUser && currentUser.permissions) || [];
    document.querySelectorAll("[data-perm]").forEach((sec) => { sec.hidden = !perms.includes(sec.getAttribute("data-perm")); });
    whoami.textContent = currentUser ? "Signed in as " + currentUser.name + " (" + currentUser.role + ")" : "";
  }

  // ---- setup (first owner) ----
  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setupStatus.textContent = "Creating…";
    const fd = new FormData(setupForm);
    const body = { adminToken: fd.get("adminToken"), name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), turnstileToken };
    const res = await fetch("/api/auth/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { sessionStorage.setItem(KEY, d.token); currentUser = d.user; setupStatus.textContent = ""; showApp(); }
    else { setupStatus.textContent = d.error || "Setup failed."; resetTurnstile(); }
  });

  // ---- login ----
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginStatus.textContent = "Checking…";
    const fd = new FormData(loginForm);
    const body = { email: fd.get("email"), password: fd.get("password"), turnstileToken };
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { sessionStorage.setItem(KEY, d.token); currentUser = d.user; loginStatus.textContent = ""; showApp(); }
    else { loginStatus.textContent = d.error || "Sign-in failed."; resetTurnstile(); }
  });

  // ---- logout ----
  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
    sessionStorage.removeItem(KEY); currentUser = null; showLogin();
  });

  // ---- data loads (permission-gated by refresh) ----
  async function refresh() {
    const perms = (currentUser && currentUser.permissions) || [];
    const has = (p) => perms.includes(p);
    if (has("bookings")) await loadBookings(); else if (bookingsEl) bookingsEl.replaceChildren();
    if (has("messages")) await loadEnquiries(); else if (enquiriesEl) enquiriesEl.replaceChildren();
    if (has("availability") && window.OHPAvailability) window.OHPAvailability.render();
    if (has("tracking") && window.OHPTracking) window.OHPTracking.render();
    if (has("reports") && window.OHPReports) window.OHPReports.render();
    if (has("contacts") && window.OHPContacts) window.OHPContacts.render();
    if (has("users") && window.OHPUsers) window.OHPUsers.render();
    if (has("audit") && window.OHPAudit) window.OHPAudit.render();
  }

  async function loadBookings() {
    const res = await api("/api/admin/bookings");
    if (res.status === 401) { sessionStorage.removeItem(KEY); showLogin(); return; }
    const { bookings } = await res.json();
    if (!bookings.length) { bookingsEl.replaceChildren(el("p", "No bookings yet.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["Ref", "Slot", "Name", "Phone", "Email", "Children", "Age", "Notes", "Status", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const b of bookings) {
      const tr = el("tr");
      tr.appendChild(el("td", b.ref));
      tr.appendChild(el("td", fmtDate(b.date) + ", " + b.start_time + "–" + b.end_time));
      tr.appendChild(el("td", b.name));
      const phone = el("td");
      const tel = el("a", b.phone);
      tel.href = "tel:" + b.phone.replace(/[^\d+]/g, "");
      phone.appendChild(tel);
      tr.appendChild(phone);
      tr.appendChild(el("td", b.email));
      tr.appendChild(el("td", b.children == null ? "" : String(b.children)));
      tr.appendChild(el("td", b.child_age || ""));
      tr.appendChild(el("td", b.notes || ""));
      tr.appendChild(el("td", b.status));
      const actions = el("td");
      if (b.status === "pending") {
        const confirmBtn = el("button", "Mark paid", "button admin-mini");
        confirmBtn.addEventListener("click", () => {
          if (confirm("Mark this booking as paid? This locks the slot and declines any other holds on it.")) act(b.id, "confirm");
        });
        actions.appendChild(confirmBtn);
      }
      if (b.status !== "cancelled") {
        const isPending = b.status === "pending";
        const cancelBtn = el("button", isPending ? "Decline" : "Cancel", "button ghost admin-mini");
        const msg = isPending ? "Decline this enquiry? The slot stays open for others." : "Cancel this booking and free the slot?";
        cancelBtn.addEventListener("click", () => { if (confirm(msg)) act(b.id, "cancel"); });
        actions.appendChild(cancelBtn);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    bookingsEl.replaceChildren(table);
  }

  async function act(id, action) {
    const r = await api("/api/admin/bookings", { method: "POST", body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) refresh(); else alert(d.error || "Action failed.");
  }

  async function actEnquiry(id, action) {
    const r = await api("/api/admin/enquiries", { method: "POST", body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) loadEnquiries(); else alert(d.error || "Action failed.");
  }

  async function loadEnquiries() {
    if (!enquiriesEl) return;
    const res = await api("/api/admin/enquiries");
    if (res.status === 401) { sessionStorage.removeItem(KEY); showLogin(); return; }
    const { enquiries } = await res.json();
    if (!enquiries || !enquiries.length) { enquiriesEl.replaceChildren(el("p", "No messages yet.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["When", "Type", "Name", "Contact", "Message", "Status", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const e of enquiries) {
      const tr = el("tr");
      tr.appendChild(el("td", e.created_at || ""));
      tr.appendChild(el("td", e.type || ""));
      tr.appendChild(el("td", e.name || ""));
      const contact = el("td");
      if (e.email) contact.appendChild(document.createTextNode(e.email));
      if (e.email && e.phone) contact.appendChild(el("br"));
      if (e.phone) contact.appendChild(document.createTextNode(e.phone));
      tr.appendChild(contact);
      const msgCell = el("td");
      const partyParts = [];
      if (e.type === "party") {
        if (e.party_date) partyParts.push("Date: " + e.party_date);
        if (e.children != null) partyParts.push("Children: " + e.children);
        if (e.child_age) partyParts.push("Age: " + e.child_age);
      }
      if (partyParts.length) {
        msgCell.appendChild(document.createTextNode(partyParts.join(" · ")));
        if (e.message) msgCell.appendChild(el("br"));
      }
      if (e.message) msgCell.appendChild(document.createTextNode(e.message));
      tr.appendChild(msgCell);
      tr.appendChild(el("td", e.status || ""));
      const actions = el("td");
      const markRead = el("button", "Mark read", "button ghost admin-mini");
      markRead.addEventListener("click", () => actEnquiry(e.id, "read"));
      const archive = el("button", "Archive", "button ghost admin-mini");
      archive.addEventListener("click", () => actEnquiry(e.id, "archive"));
      actions.appendChild(markRead);
      actions.appendChild(archive);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    enquiriesEl.replaceChildren(table);
  }

  // Expose the authed fetch + current user so the Owner-only modules can reuse them.
  window.OHPAdmin = { api, user: () => currentUser, refresh };

  // ---- init ----
  (async function init() {
    if (token()) {
      const me = await api("/api/auth/me");
      if (me.ok) { currentUser = (await me.json()).user; return showApp(); }
      sessionStorage.removeItem(KEY);
    }
    const st = await fetch("/api/auth/status").then((r) => r.json()).catch(() => ({}));
    siteKey = st.turnstile_site_key || null;
    if (st.needs_bootstrap) showSetup(); else showLogin();
  })();
})();
```

- [ ] **Step 3: Syntax check** — `node --check public/assets/admin.js`. Expected: no output.
- [ ] **Step 4: Commit**

```bash
git add public/admin.html public/assets/admin.js
git commit -m "Rework dashboard shell: email+password login, first-run setup, Turnstile, role-aware sections"
```

---

### Task 11: Users dashboard module — `admin-users.js`

**Files:**
- Create: `public/assets/admin-users.js`

- [ ] **Step 1: Write the module**

```js
(function () {
  const root = document.querySelector("[data-users]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  const ROLES = ["owner", "manager", "staff"];

  async function render() {
    const res = await api("/api/admin/users");
    if (!res.ok) { root.replaceChildren(el("p", "Could not load users.", "booking-note")); return; }
    const { users } = await res.json();
    root.replaceChildren();
    root.appendChild(createForm());

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["Name", "Email", "Role", "Status", "Last login", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    const me = window.OHPAdmin.user();
    for (const u of users) {
      const tr = el("tr");
      tr.appendChild(el("td", u.name));
      tr.appendChild(el("td", u.email));

      const roleTd = el("td");
      const roleSel = document.createElement("select");
      for (const r of ROLES) { const o = el("option", r[0].toUpperCase() + r.slice(1), null); o.value = r; if (u.role === r) o.selected = true; roleSel.appendChild(o); }
      roleSel.addEventListener("change", () => update(u.id, { role: roleSel.value }));
      roleTd.appendChild(roleSel);
      tr.appendChild(roleTd);

      tr.appendChild(el("td", u.status));
      tr.appendChild(el("td", (u.last_login_at || "—").slice(0, 16).replace("T", " ")));

      const actions = el("td");
      const toggle = el("button", u.status === "active" ? "Disable" : "Enable", "button ghost admin-mini");
      toggle.addEventListener("click", () => update(u.id, { status: u.status === "active" ? "disabled" : "active" }));
      const reset = el("button", "Reset password", "button ghost admin-mini");
      reset.addEventListener("click", () => {
        const pw = prompt("New password for " + u.email + " (at least 12 characters):");
        if (pw) update(u.id, { password: pw });
      });
      const del = el("button", "Delete", "button ghost admin-mini contact-erase");
      del.addEventListener("click", () => { if (confirm("Delete " + u.email + "? This removes their account and signs them out.")) remove(u.id); });
      actions.append(toggle, reset);
      if (!me || me.email !== u.email) actions.append(del); // can't delete yourself
      tr.appendChild(actions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function createForm() {
    const form = el("form", null, "form-panel users-add");
    const name = Object.assign(document.createElement("input"), { type: "text", placeholder: "Name", required: true });
    const email = Object.assign(document.createElement("input"), { type: "email", placeholder: "Email", required: true });
    const role = document.createElement("select");
    for (const r of ROLES) { const o = el("option", r[0].toUpperCase() + r.slice(1), null); o.value = r; role.appendChild(o); }
    role.value = "staff";
    const pw = Object.assign(document.createElement("input"), { type: "password", placeholder: "Password (12+ chars)", minLength: 12, required: true });
    const btn = el("button", "Add user", "button admin-mini"); btn.type = "submit";
    const status = el("p", "", "form-status");
    form.append(el("strong", "Add a staff account"), name, email, role, pw, btn, status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "Saving…";
      const r = await api("/api/admin/users", { method: "POST", body: JSON.stringify({ name: name.value, email: email.value, role: role.value, password: pw.value }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { status.textContent = ""; render(); } else status.textContent = d.error || "Could not add user.";
    });
    return form;
  }

  async function update(id, fields) {
    const r = await api("/api/admin/users", { method: "PUT", body: JSON.stringify({ id, ...fields }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) render(); else { alert(d.error || "Could not update."); render(); }
  }
  async function remove(id) {
    const r = await api("/api/admin/users?id=" + id, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) render(); else alert(d.error || "Could not delete.");
  }

  window.OHPUsers = { render };
})();
```

- [ ] **Step 2: Syntax check** — `node --check public/assets/admin-users.js`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add public/assets/admin-users.js
git commit -m "Add Owner-only Users dashboard module"
```

---

### Task 12: Activity-log dashboard module — `admin-audit.js`

**Files:**
- Create: `public/assets/admin-audit.js`

- [ ] **Step 1: Write the module**

```js
(function () {
  const root = document.querySelector("[data-audit]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  const ACTION_GROUPS = [["", "All actions"], ["auth.", "Sign-ins"], ["user.", "Users"], ["slot.", "Slots"], ["event.", "Events"], ["booking.", "Bookings"], ["enquiry.", "Messages"], ["contact.", "Contacts"], ["snippet.", "Tracking"]];
  let filters = { actor: "", action: "", from: "", to: "", include_bots: false };
  let people = [];

  async function render() {
    if (!people.length) {
      const ures = await api("/api/admin/users");
      if (ures.ok) people = (await ures.json()).users || [];
    }
    const qs = new URLSearchParams();
    if (filters.actor) qs.set("actor", filters.actor);
    if (filters.action) qs.set("action", filters.action);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.include_bots) qs.set("include_bots", "1");
    const res = await api("/api/admin/audit?" + qs.toString());
    if (!res.ok) { root.replaceChildren(el("p", "Could not load activity.", "booking-note")); return; }
    const { entries } = await res.json();

    root.replaceChildren(buildBar());
    if (!entries.length) { root.appendChild(el("p", "No activity for these filters.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["When", "Who", "Action", "Target", "Detail", "Country", "IP", "Device"].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const e of entries) {
      const tr = el("tr");
      if (e.is_bot) tr.className = "audit-bot";
      tr.appendChild(el("td", (e.created_at || "").replace("T", " ").slice(0, 19)));
      tr.appendChild(el("td", e.actor_email || "—"));
      tr.appendChild(el("td", e.action));
      tr.appendChild(el("td", e.target_type ? e.target_type + " " + (e.target_id || "") : ""));
      tr.appendChild(el("td", e.detail || ""));
      tr.appendChild(el("td", e.country || ""));
      tr.appendChild(el("td", e.ip || ""));
      const dev = el("td", (e.user_agent || "").slice(0, 40)); if (e.user_agent) dev.title = e.user_agent;
      tr.appendChild(dev);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function buildBar() {
    const bar = el("div", null, "contacts-bar");

    const who = document.createElement("select");
    who.appendChild(Object.assign(el("option", "Everyone"), { value: "" }));
    for (const p of people) { const o = el("option", p.name + " (" + p.role + ")"); o.value = String(p.id); if (String(p.id) === filters.actor) o.selected = true; who.appendChild(o); }
    who.addEventListener("change", () => { filters.actor = who.value; render(); });

    const act = document.createElement("select");
    for (const [val, label] of ACTION_GROUPS) { const o = el("option", label); o.value = val; if (val === filters.action) o.selected = true; act.appendChild(o); }
    act.addEventListener("change", () => { filters.action = act.value; render(); });

    const from = Object.assign(document.createElement("input"), { type: "date", value: filters.from });
    from.addEventListener("change", () => { filters.from = from.value; render(); });
    const to = Object.assign(document.createElement("input"), { type: "date", value: filters.to });
    to.addEventListener("change", () => { filters.to = to.value; render(); });

    const botsLabel = el("label", null, "audit-bots");
    const bots = Object.assign(document.createElement("input"), { type: "checkbox", checked: filters.include_bots });
    bots.addEventListener("change", () => { filters.include_bots = bots.checked; render(); });
    botsLabel.append(bots, document.createTextNode(" Show bot attempts"));

    bar.append(who, act, from, to, botsLabel);
    return bar;
  }

  window.OHPAudit = { render };
})();
```

- [ ] **Step 2: Syntax check** — `node --check public/assets/admin-audit.js`. Expected: no output.
- [ ] **Step 3: Commit**

```bash
git add public/assets/admin-audit.js
git commit -m "Add Owner-only Activity-log dashboard module with filters + bot toggle"
```

---

### Task 13: CSP for Turnstile, styles, local test keys, internal staff note

**Files:**
- Modify: `public/_headers`
- Modify: `public/assets/styles.css`
- Modify: `.dev.vars` (local only — gitignored)
- Modify: `.gitignore`
- Create: `docs/STAFF-PRIVACY-NOTE.md`

- [ ] **Step 1: `public/_headers` — allow Turnstile in the CSP.** Read the current `Content-Security-Policy` line. Add the origin `https://challenges.cloudflare.com` to **both** the `script-src` and `frame-src` directives (a plain allow — nothing loads it on public pages; done globally so two CSP headers are never sent and intersected). After the edit, `script-src` should include `https://challenges.cloudflare.com` (alongside the existing `'self' 'unsafe-inline' https://www.googletagmanager.com …`) and `frame-src` should include `https://challenges.cloudflare.com` (alongside the existing Google Maps/Calendar sources). Change nothing else on the line.

- [ ] **Step 2: `public/assets/styles.css` — append** (reuses existing `admin-table` / `contacts-bar` styling):

```css
.admin-whoami { font-size: 0.85rem; color: var(--ink-soft, #5b6b62); margin: 0 0 1rem; }
.users-add { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
.users-add input, .users-add select { padding: 0.45rem; border: 1px solid var(--line); border-radius: var(--radius); }
.admin-table select { padding: 0.3rem; border: 1px solid var(--line); border-radius: var(--radius); }
.audit-bots { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; white-space: nowrap; }
.audit-bot { opacity: 0.6; }
.audit-bot td:nth-child(3) { font-style: italic; }
```

- [ ] **Step 3: `.dev.vars` — add the documented Cloudflare Turnstile TEST keys (local only).** Append so the local server can exercise the bot path. Leave them commented by default so the graceful (no-Turnstile) path is what runs unless a verification step opts in:

```
# Cloudflare Turnstile local test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
# Uncomment BOTH to exercise the always-pass path; swap the secret to the always-fail one to test blocking.
# TURNSTILE_SITE_KEY="1x00000000000000000000AA"
# TURNSTILE_SECRET="1x0000000000000000000000000000000AA"
# always-fail secret: 2x0000000000000000000000000000000AA
```

- [ ] **Step 4: `.gitignore` — ignore an optional pre-deploy backup** (additive 0008 doesn't need one, but keep the convention safe). Add a line:

```
pre-0008-backup.sql
```

- [ ] **Step 5: Create `docs/STAFF-PRIVACY-NOTE.md`** (the internal disclosure that supports the legitimate-interest basis):

```markdown
# Staff privacy note — admin dashboard logging

The booking admin dashboard records staff sign-ins and changes for security and accountability.

**What we log:** each sign-in, sign-out, failed sign-in, and every change made in the dashboard
(bookings, availability, messages, contacts, tracking code, user accounts), together with the
staff member's account, the action, a short description, and the **IP address, approximate
country, and device/browser** the action came from.

**Why (lawful basis):** our legitimate interest in keeping the system secure and being able to
see who did what — detecting unauthorised access, mistakes, and abuse.

**How long:** about 12 months, then it can be cleared.

**Not customer data:** the log never stores a customer's name, email, or phone — only references
(e.g. "contact #42"). It is separate from the public website analytics, which use no cookies and
no IP addresses.

This note is the disclosure to staff that this logging takes place.
```

- [ ] **Step 6: Commit**

```bash
git add public/_headers public/assets/styles.css .gitignore docs/STAFF-PRIVACY-NOTE.md
git commit -m "Allow Turnstile in CSP, add admin styles, staff privacy note, backup gitignore"
```
(Note: `.dev.vars` is gitignored and is intentionally NOT committed.)

---

### Task 14: Local end-to-end verification (matrix, lockout, guardrails, activity, bot)

**Files:** none (verification). Run the full local suite before any deploy.

- [ ] **Step 1: Unit tests (all green)**

```bash
node --test tests/auth-core.test.mjs tests/availability-core.test.mjs tests/enquiry-core.test.mjs tests/snippet-core.test.mjs tests/analytics-core.test.mjs tests/contacts-core.test.mjs tests/lead-core.test.mjs
```
Expected: all pass.

- [ ] **Step 2: Reset local identity state + start the server** (config-driven so it uses the migrated local D1)

```bash
npx wrangler d1 execute oak-hill-bookings --local --command "DELETE FROM sessions; DELETE FROM users; DELETE FROM audit_log;"
npx wrangler pages dev public --port 8788 --compatibility-date 2024-11-01
```
(Leave running in another shell. `.dev.vars` keeps Turnstile OFF for Steps 3–8, so no token is needed; Step 9 turns it on.)

- [ ] **Step 3: Bootstrap the first owner**

```bash
B=http://localhost:8788
curl -s "$B/api/auth/status"   # {"needs_bootstrap":true,"turnstile_site_key":null}
curl -s -X POST "$B/api/auth/bootstrap" -H 'Content-Type: application/json' \
  -d '{"adminToken":"local-test-password","name":"Olive Owner","email":"owner@example.com","password":"owner-pass-1234"}'
# → {"token":"...","user":{...,"role":"owner",...}}.  Save the token:
OWNER=<paste token>
curl -s "$B/api/auth/status"   # needs_bootstrap now false
curl -s -X POST "$B/api/auth/bootstrap" -H 'Content-Type: application/json' -d '{"adminToken":"local-test-password","name":"x","email":"x@y.z","password":"xxxxxxxxxxxx"}'  # → 409
```

- [ ] **Step 4: Owner creates a Manager and a Staff**

```bash
curl -s -X POST "$B/api/admin/users" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"name":"Mara Manager","email":"manager@example.com","role":"manager","password":"manager-pass-1"}'
curl -s -X POST "$B/api/admin/users" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d '{"name":"Sam Staff","email":"staff@example.com","role":"staff","password":"staff-pass-12345"}'
curl -s "$B/api/admin/users" -H "Authorization: Bearer $OWNER"   # 3 users, NO password fields present
# Log each in to grab their tokens:
MANAGER=$(curl -s -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"manager@example.com","password":"manager-pass-1"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
STAFF=$(curl -s -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"staff@example.com","password":"staff-pass-12345"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
```

- [ ] **Step 5: Authorization matrix probes** (each line notes the expected HTTP status)

```bash
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }
# STAFF: bookings/messages OK; everything else 403
echo "staff bookings   $(code "$B/api/admin/bookings"  -H "Authorization: Bearer $STAFF")"   # 200
echo "staff reports    $(code "$B/api/admin/reports"   -H "Authorization: Bearer $STAFF")"   # 403
echo "staff contacts   $(code "$B/api/admin/contacts"  -H "Authorization: Bearer $STAFF")"   # 403
echo "staff erase      $(code -X DELETE "$B/api/admin/contacts?id=1" -H "Authorization: Bearer $STAFF")"  # 403
echo "staff audit      $(code "$B/api/admin/audit"     -H "Authorization: Bearer $STAFF")"   # 403
echo "staff users      $(code "$B/api/admin/users"     -H "Authorization: Bearer $STAFF")"   # 403
# MANAGER: contacts (incl. export) OK; tracking/users/audit 403
echo "mgr contacts     $(code "$B/api/admin/contacts"            -H "Authorization: Bearer $MANAGER")"   # 200
echo "mgr export       $(code "$B/api/admin/contacts?format=csv" -H "Authorization: Bearer $MANAGER")"   # 200
echo "mgr tracking     $(code "$B/api/admin/code-snippets"       -H "Authorization: Bearer $MANAGER")"   # 403 (GET guarded too)
echo "mgr users        $(code "$B/api/admin/users"               -H "Authorization: Bearer $MANAGER")"   # 403
echo "mgr audit        $(code "$B/api/admin/audit"               -H "Authorization: Bearer $MANAGER")"   # 403
# OWNER: all OK
echo "owner tracking   $(code "$B/api/admin/code-snippets" -H "Authorization: Bearer $OWNER")"   # 200
echo "owner users      $(code "$B/api/admin/users"         -H "Authorization: Bearer $OWNER")"   # 200
echo "owner audit      $(code "$B/api/admin/audit"         -H "Authorization: Bearer $OWNER")"   # 200
# No token → 401
echo "no-token bookings $(code "$B/api/admin/bookings")"   # 401
```

- [ ] **Step 6: Lockout** — 5 wrong passwords lock the staff account for 15 min

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "fail $i: %{http_code}\n" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"staff@example.com","password":"wrong"}'; done  # all 401
curl -s -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"staff@example.com","password":"staff-pass-12345"}'   # still 401 (locked, correct pw)
npx wrangler d1 execute oak-hill-bookings --local --command "SELECT email, failed_attempts, locked_until FROM users WHERE email='staff@example.com';"  # failed_attempts=5, locked_until set
# (unlock for later steps)
npx wrangler d1 execute oak-hill-bookings --local --command "UPDATE users SET failed_attempts=0, locked_until=NULL WHERE email='staff@example.com';"
```

- [ ] **Step 7: Guardrails** — last owner protected; disable invalidates sessions

```bash
OID=$(npx wrangler d1 execute oak-hill-bookings --local --command "SELECT id FROM users WHERE email='owner@example.com';" --json | sed -E 's/.*"id":([0-9]+).*/\1/')
# demote the only owner → 409
curl -s -X PUT "$B/api/admin/users" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"id\":$OID,\"role\":\"manager\"}"   # 409 last owner
# delete self → 409
curl -s -X DELETE "$B/api/admin/users?id=$OID" -H "Authorization: Bearer $OWNER"   # 409 can't delete yourself
# disable staff → their existing token stops working immediately
SID=$(npx wrangler d1 execute oak-hill-bookings --local --command "SELECT id FROM users WHERE email='staff@example.com';" --json | sed -E 's/.*"id":([0-9]+).*/\1/')
curl -s -X PUT "$B/api/admin/users" -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' -d "{\"id\":$SID,\"status\":\"disabled\"}"
echo "disabled staff token $(code "$B/api/admin/bookings" -H "Authorization: Bearer $STAFF")"   # 401 (session revoked)
```

- [ ] **Step 8: Activity log** — confirm sign-ins + actions recorded, PII-free, filterable

```bash
# generate a couple of actions as owner
curl -s "$B/api/admin/contacts?format=csv" -H "Authorization: Bearer $OWNER" -o /dev/null   # contact.export
curl -s "$B/api/admin/audit?action=auth." -H "Authorization: Bearer $OWNER"   # only auth.* rows (login/login_failed/locked/logout/bootstrap)
curl -s "$B/api/admin/audit" -H "Authorization: Bearer $OWNER"                  # recent activity, newest first
# Confirm NO customer name/email leaked into detail:
npx wrangler d1 execute oak-hill-bookings --local --command "SELECT action, detail FROM audit_log ORDER BY id DESC LIMIT 20;"
```
Expected: rows for `auth.bootstrap`, `auth.login`, `auth.login_failed`, `auth.locked`, `user.create`, `user.update`, `contact.export`; `detail` columns contain only operational text (roles, ids, statuses), never a customer's name/email.

- [ ] **Step 9: Bot defence** — turn Turnstile ON locally and verify block + hide

```bash
# In .dev.vars uncomment SITE_KEY + the ALWAYS-FAIL secret, then restart `wrangler pages dev`:
#   TURNSTILE_SITE_KEY="1x00000000000000000000AA"
#   TURNSTILE_SECRET="2x0000000000000000000000000000000AA"   <-- always FAILS
curl -s "$B/api/auth/status"   # turnstile_site_key now non-null
echo "bot login $(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"owner@example.com","password":"owner-pass-1234","turnstileToken":"x"}')"  # 403
npx wrangler d1 execute oak-hill-bookings --local --command "SELECT action,is_bot,bot_reason FROM audit_log WHERE action='auth.bot_blocked' ORDER BY id DESC LIMIT 1;"  # is_bot=1
# default audit view hides it; include_bots shows it:
curl -s "$B/api/admin/audit"                 -H "Authorization: Bearer $OWNER" | grep -c bot_blocked   # 0 (hidden)
curl -s "$B/api/admin/audit?include_bots=1"  -H "Authorization: Bearer $OWNER" | grep -c bot_blocked   # >=1
# lockout untouched by bot attempts:
npx wrangler d1 execute oak-hill-bookings --local --command "SELECT email,failed_attempts FROM users WHERE email='owner@example.com';"  # failed_attempts unchanged
# Now swap to the ALWAYS-PASS secret (1x...) + restart → a login with any token succeeds:
echo "human login $(code -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"owner@example.com","password":"owner-pass-1234","turnstileToken":"x"}')"  # 200
# Re-comment both keys in .dev.vars + restart to return to the default graceful state for the rest.
```

- [ ] **Step 10: Browser smoke (manual, via the running server at http://localhost:8788/admin):** sign in as the owner in a fresh tab (with Turnstile keys commented out → no widget); confirm all 8 sections show; sign out; sign in as staff → only Bookings + Messages show; the Users/Activity/Reports/Contacts/Tracking/Availability sections are hidden. Confirm the browser console has **no CSP errors** (and, with the always-pass test keys set, that the Turnstile widget renders on the login form).

- [ ] **Step 11:** If any step failed, fix and re-run the affected step before proceeding. Do not deploy on a red step.

---

### Task 15: Deploy (merge to master) + live verification + tune iterations

**Files:** none (deploy + verify). This is the only step that ships.

- [ ] **Step 1: Final pre-merge checks**

```bash
node --test tests/auth-core.test.mjs   # green
node --check functions/api/auth/*.js functions/api/admin/*.js functions/api/_lib/auth-core.mjs functions/api/_lib/auth-db.mjs functions/api/_lib/turnstile.mjs public/assets/admin.js public/assets/admin-users.js public/assets/admin-audit.js
git status   # only intended files changed; .dev.vars NOT staged
```

- [ ] **Step 2: Measure a login's CPU cost and tune `PBKDF2_ITERATIONS` if needed.** With the local server running, time a login:

```bash
curl -s -o /dev/null -w "login wall time: %{time_total}s\n" -X POST "$B/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"owner@example.com","password":"owner-pass-1234"}'
```
If the login is comfortably fast (well under ~0.3s of compute locally), the `150000` default is fine. If it's sluggish, lower `PBKDF2_ITERATIONS` in `functions/api/_lib/auth-core.mjs` (and the matching `DUMMY.iterations` in `functions/api/auth/login.js`) to `100000`, re-run Task 2's tests, and re-commit. (Existing users keep their stored `password_iterations`; this only affects new/reset passwords.)

- [ ] **Step 3: Merge to master and push (this triggers CI: apply migration 0008 → deploy)**

```bash
git checkout master
git merge --no-ff feat/staff-roles-identity -m "Phase 1: staff roles + identity core + activity log + Turnstile"
git push origin master
gh run list --limit 1
```
Watch the run: **confirm the "Apply D1 migrations" step succeeds** (0008 created the tables) **and** the Pages deploy succeeds.

- [ ] **Step 4: Live verification**

```bash
BASE="https://oak-hill-park-cafe.pages.dev"
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }
echo "status        $(curl -s "$BASE/api/auth/status")"          # {"needs_bootstrap":true,...} (prod users table is empty)
echo "admin no-tok  $(code "$BASE/api/admin/bookings")"          # 401
echo "admin.html    $(code "$BASE/admin.html")"                  # 200
echo "login GET     $(code "$BASE/api/auth/login")"              # 405 (POST-only) — reachable, not 404
```
Then in a browser at `$BASE/admin`: the **first-run setup panel** shows. Create the real first Owner using the **production `ADMIN_TOKEN`**. Sign in; confirm all sections render and the Activity log shows your `auth.bootstrap` + `auth.login` with a real country/IP/device. Confirm the console has no CSP errors.

- [ ] **Step 5: Operational follow-ups (hand to the owner / do together).**
  - Create the real staff accounts (Manager/Staff) in the **Users** section and hand out initial passwords.
  - **Rotate or remove `ADMIN_TOKEN`** in Cloudflare (Workers & Pages → oak-hill-park-cafe → Settings → Variables and Secrets) — bootstrap is done, so it's no longer a login.
  - **Turn on bot blocking (optional, recommended):** create a free Turnstile widget in the Cloudflare dashboard; set `TURNSTILE_SITE_KEY` (plain var) + `TURNSTILE_SECRET` (`npx wrangler pages secret put TURNSTILE_SECRET`); redeploy. The login challenge then activates automatically.
  - Share `docs/STAFF-PRIVACY-NOTE.md` with staff (the logging disclosure).

- [ ] **Step 6: Final commit if Step 2 changed iterations; confirm the branch is merged and CI is green.**

---

## Self-Review

**Spec coverage (every spec section maps to a task):**
- Data model `users`/`sessions`/`audit_log` incl. ip/country/user_agent + is_bot/bot_reason → **T1**.
- `auth-core.mjs` (permissions, PBKDF2, tokens, validatePassword, looksLikeBot, lockout) + tests → **T2**.
- `turnstile.mjs` → **T3**. `auth-db.mjs` (helpers + requirePermission + reqContext + recordAudit/auditFromCtx) → **T4**.
- `/api/auth/{status,bootstrap,login,logout,me}` incl. Turnstile-first, dummy-verify, no-enumeration, generic errors, `auth.*` audit → **T5**.
- Middleware authentication-only, `ADMIN_TOKEN` dropped → **T6**.
- Per-route authorization + audit on bookings/slots/calendar-events/enquiries/reports/contacts/code-snippets incl. `contacts.export`/`contacts.erase` sub-actions → **T7**.
- Owner-only Users CRUD + last-owner/self guardrails + session invalidation → **T8**.
- Owner-only Activity API with actor/action/date/include_bots filters → **T9**.
- Dashboard: email+password login, first-run setup, `/me` restore, Turnstile mount, role-aware hiding, logout → **T10**; Users UI → **T11**; Activity UI + show-bots → **T12**.
- CSP allows Turnstile; styles; local test keys; staff privacy note → **T13**.
- Full verification matrix (authz, lockout, guardrails, activity PII-free, bot block/hide) → **T14**; deploy + live verify + iteration tuning + ADMIN_TOKEN rotation → **T15**.

**Type/contract consistency:**
- `permissionsFor(role)`/`can(role,perm)` defined T2; consumed by `requirePermission` (T4), `/me`+login+bootstrap responses (T5), and client `applyPermissions` via `user.permissions` (T10).
- `reqContext`→`{ip,country,user_agent}`, `recordAudit`/`auditFromCtx` shape defined T4; used identically in T5/T7/T8.
- Session contract: `createSession`→`{token}`, `resolveSession`→`{id,name,email,role,status,expires_at}`; middleware (T6) sets `ctx.data.user={id,name,email,role}`; `requirePermission` reads `ctx.data.user.role`.
- Client uses `sessionStorage["ohpc-admin-token"]` (unchanged key) and `window.OHPAdmin.api` (defined T10) is consumed by `OHPUsers` (T11) and `OHPAudit` (T12); `refresh()` gates each module by permission.
- Audit `action` group prefixes used in T12 (`auth.`,`user.`,`contact.`…) match the strings written in T5/T7/T8 and the `action.endsWith(".")` LIKE filter in T9.

**Placeholder scan:** none — every step has complete code or exact commands. `owner@example.com`, `local-test-password`, and the Turnstile `1x/2x` strings are deliberate local fixtures / Cloudflare's documented test keys.

**Risk control:** built entirely on a feature branch; 0008 is additive-only (no PII transform → no prod backup needed); the middleware cut-over (T6) and per-route authz (T7) land together before T14's matrix proves every role is correctly fenced; nothing deploys until T15.
