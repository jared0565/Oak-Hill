# Phase 1 — Identity Core + Staff Roles : Design

> **Parent:** [Booking & Growth Platform architecture map](2026-06-14-booking-platform-architecture.md)
> **Status:** Design, ready for implementation planning.
> **Date:** 2026-06-14

## Goal

Replace the single shared `ADMIN_TOKEN` with **named staff accounts that log in with email +
password and carry a role** (`owner` / `manager` / `staff`). Build the **shared identity core**
(users, login sessions, password hashing, a role→permission map, and a **sign-in + activity
log**) that the later customer-account phases (2–4) will reuse. The dashboard becomes role-aware:
each person sees and can act on only what their role allows, enforced **server-side per
endpoint** — not just by hiding sections in the UI. The Owner also gets a full **activity
history** — who signed in, when, from where, and every change they made — with **bot login
attempts blocked at the door and kept out of the history**.

This is **Phase 1** of a four-phase roadmap (1: staff roles — this doc; 2: customer accounts +
self-service bookings; 3: customer marketing self-service; 4: loyalty/membership). Phase 1
deliberately has **no email dependency** (the Owner sets staff passwords by hand), so it ships
on its own.

## Approaches considered

- **Cloudflare Access (zero-code SSO)** — rejected: Phases 2–4 need *customer* accounts in our
  own D1, which Access can't serve. We'd end up running a second identity system anyway.
- **httpOnly session cookie** — rejected: a cookie is sent automatically cross-site, so it adds
  a **CSRF** attack surface to every mutating `/api/admin/*` route that the current Bearer
  pattern doesn't have.
- **Chosen: hand-rolled identity core in D1 with Bearer session tokens.** Login issues a
  per-user opaque **session token**; `admin.js` sends it in `Authorization: Bearer …` exactly as
  it sends `ADMIN_TOKEN` today. CSRF-immune, smallest change, and reusable by later phases.

## Roles & permission matrix (this *is* the server-side authz map)

Named permissions: `availability, bookings, messages, reports, contacts, contacts.export,
contacts.erase, tracking, users, audit`.

| Permission | Owner | Manager | Staff |
|---|:--:|:--:|:--:|
| `availability` (slots / events / closures) | ✅ | ✅ | ❌ |
| `bookings` (view, mark paid, cancel) | ✅ | ✅ | ✅ |
| `messages` (enquiries: read, archive) | ✅ | ✅ | ✅ |
| `reports` (analytics) | ✅ | ✅ | ❌ |
| `contacts` (view / search / tag / notes) | ✅ | ✅ | ❌ |
| `contacts.export` (CSV of PII) | ✅ | ✅ | ❌ |
| `contacts.erase` (GDPR erasure) | ✅ | ✅ | ❌ |
| `tracking` (tracking-code manager) | ✅ | ❌ | ❌ |
| `users` (manage staff accounts) | ✅ | ❌ | ❌ |
| `audit` (view sign-in + activity log) | ✅ | ❌ | ❌ |

Owner = all; Manager = all except `tracking`, `users`, `audit`; Staff = `bookings` + `messages`.

## Sign-in & activity log (the history)

A single `audit_log` table is the activity history. It records **sign-in events** and **every
data-changing action** — not read-only views. Each row captures the actor, the action, the
target, a PII-free human detail, the **request context (IP, country, device/user-agent)**, and a
**bot flag**.

**Action vocabulary**

| Group | Actions | Written by |
|---|---|---|
| Auth | `auth.bootstrap`, `auth.login`, `auth.login_failed`, `auth.locked`, `auth.logout`, `auth.bot_blocked` | `auth/bootstrap.js`, `auth/login.js`, `auth/logout.js` |
| Users | `user.create`, `user.update`, `user.delete` | `admin/users.js` |
| Availability | `slot.create`, `slot.update`, `slot.delete`, `event.create`, `event.update`, `event.delete` | `admin/slots.js`, `admin/calendar-events.js` |
| Bookings | `booking.confirm`, `booking.cancel` | `admin/bookings.js` |
| Messages | `enquiry.read`, `enquiry.archive` | `admin/enquiries.js` |
| Contacts | `contact.tag_add`, `contact.tag_remove`, `contact.note`, `contact.optin`, `contact.export`, `contact.erase` | `admin/contacts.js` |
| Tracking | `snippet.create`, `snippet.update`, `snippet.delete` | `admin/code-snippets.js` |

- **Failed logins** record the *attempted* email (`actor_email`) with `actor_user_id = NULL`,
  plus IP/country/device — so brute-force or odd-location attempts are visible. `auth.locked` is
  written when the 5th failure trips the lockout. `auth.bot_blocked` records a request rejected
  by the bot check before any credential test.
- **`detail` is always PII-free**: it describes the change, not the customer — e.g.
  `"status: pending→paid"`, `"role: staff→manager"`, `"contact #42"`, `"slot 2026-07-02 14:00"`.
  Customer name/email/phone never enter the log; contacts are referenced by id.
- **Request context** comes from the edge: `ip = cf-connecting-ip` header, `country =
  request.cf.country`, `user_agent = User-Agent` header (truncated to 256 chars). In local
  `wrangler pages dev` these may be absent → stored as `NULL`, which is fine.

## Bot defence — Turnstile (block) + heuristic (label & hide)

The login endpoint is public, so bots probe it. Two layers:

1. **Block — Cloudflare Turnstile.** When `TURNSTILE_SITE_KEY` **and** `TURNSTILE_SECRET` are
   configured, the sign-in and first-run forms render an invisible Turnstile widget; `login.js`
   and `bootstrap.js` verify the returned token against Cloudflare's **siteverify** endpoint
   **before** the password is examined. A missing/invalid token → `403`, the credential check
   never runs and the per-account lockout counter is **not** touched (so bots can't lock real
   staff out). The rejected request is logged once as `auth.bot_blocked` (`is_bot=1`, hidden by
   default).
   - **Graceful / off until configured:** if either env var is absent, verification is skipped
     and login behaves exactly as designed — Phase 1 ships before the owner provisions the
     widget, and the defence activates the moment both keys are set.
   - **Config-driven key:** `GET /api/auth/status` returns `turnstile_site_key` (public value,
     or `null`); `admin.js` injects the Turnstile script + widget only when a key is present, and
     sends the token as `turnstileToken` in the login/bootstrap body.
2. **Label & hide leftovers — heuristic.** `looksLikeBot({user_agent})` (pure, **conservative**:
   empty/missing UA, or an obvious automation UA such as `curl`, `python-requests`, `bot`,
   `headless`) stamps `is_bot` + `bot_reason` on attempts that slip through (and on all login
   attempts when Turnstile is off). The Activity view **hides `is_bot=1` rows by default** behind
   a "Show bot attempts" toggle; `/api/admin/audit` excludes them unless `?include_bots=1`.

**Why Turnstile, not bot scores:** Cloudflare Bot Management scores (`cf.botManagement`) are
**Enterprise-only**, so we don't depend on them. Turnstile is free on any plan, sets **no
cookies**, and is privacy-preserving — the right fit for "compliant always". Edge **rate-limiting**
on `/api/auth/login` is a complementary *owner-side dashboard* setting (recommended; outside this
repo's scope).

## Compliance (UK GDPR) — built in

- **Staff accounts are employee personal data** (name, email, password hash). **Lawful basis:**
  legitimate interest in running the cafe / employment relationship. **Retention:** delete the
  account when someone leaves (the Users UI supports delete). These are *not* customers — **no
  public-facing privacy-policy change is required**; an internal note records the basis.
- **The activity log holds additional staff personal data** — each entry stores the **actor's IP
  address, approximate country, and device/user-agent**. **Lawful basis:** legitimate interest in
  the **security and accountability** of the admin system (detecting unauthorised access, misuse,
  and brute-force). It is **proportionate**: it covers privileged staff actions only, not the
  public, and is disclosed to staff via the internal note. **Retention ~12 months**
  (criteria-based; a scheduled purge is out of scope for v1, consistent with the rest of the
  platform). The log carries **no *customer* PII** (see `detail` rule above).
- **This is distinct from public analytics.** The cookieless, no-IP visitor analytics
  (`analytics_events`) is unchanged and stays IP-free. Storing staff IPs here is a *separate*
  security-audit system with its own lawful basis — there's no contradiction with the public
  no-IP stance, and the two never mix.
- **Turnstile is privacy-preserving** — no cookies, no cross-site tracking. Verification sends the
  challenge token (and optionally the actor's IP) to Cloudflare, already our hosting processor,
  under the same security legitimate-interest basis. It runs on the **admin login only**; no
  customer or public-page involvement.
- **Passwords are never stored or logged in plaintext** — only a PBKDF2 hash + per-user salt.
- **Session tokens are never stored raw** — the DB holds only their SHA-256, so a DB leak can't
  be replayed as a live session.
- **No new *customer* data is collected.** This phase only adds *staff* identity + the audit trail.

## Scope

**In:** `users` + `sessions` + `audit_log` tables; `auth-core.mjs` (pure) + `auth-db.mjs` (DB) +
`turnstile.mjs`; `/api/auth/*` (status, bootstrap, login, logout, me); `/api/admin/users`
(Owner-only CRUD); `/api/admin/audit` (Owner-only read with filters); authentication-only rewrite
of `admin/_middleware.js`; per-route authorization on every existing admin endpoint; a **sign-in
+ activity log** on every sign-in/out/failed attempt **and** every data-changing admin action,
each with the actor's IP/country/device; **Turnstile bot-blocking** on login/bootstrap (graceful
when unconfigured) + **heuristic bot labelling/hiding**; dashboard login (email+password) +
first-run setup + role-based section visibility + Owner-only Users and Activity sections.

**Out:** customer accounts / public registration (Phase 2); password reset by email / magic link
(needs email; Phases 2+); "remember me" long sessions; SSO/2FA (possible later); logging of
**read-only** views (only sign-ins + changes are logged); edge rate-limiting (owner-side CF
dashboard); a scheduled audit-log purge; any change to the public-facing site.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0008_users.sql` | `users`, `sessions`, `audit_log` (incl. ip/country/user_agent + is_bot/bot_reason) + indexes |
| Create | `functions/api/_lib/auth-core.mjs` | **Pure:** permission map + `can`/`permissionsFor`; `hashPassword`/`verifyPassword` (PBKDF2 via WebCrypto); `newSessionToken`/`hashToken`; `validatePassword` (≥12); lockout math; `looksLikeBot({user_agent})`; constants |
| Create | `functions/api/_lib/auth-db.mjs` | DB helpers: `findUserByEmail`, `getUserById`, `createSession`, `resolveSession`, `deleteSession`, `deleteUserSessions`, `recordLoginResult`, `listUsers`, `createUser`, `updateUser`, `deleteUser`, `countOwners`; `requirePermission(ctx,perm)`; `recordAudit` + `auditFromCtx`; `reqContext(request)` |
| Create | `functions/api/_lib/turnstile.mjs` | `verifyTurnstile(secret, token, ip)` → bool via Cloudflare siteverify; `turnstileEnabled(env)` |
| Create | `functions/api/auth/status.js` | `GET` → `{ needs_bootstrap, turnstile_site_key }` (public; no secrets) |
| Create | `functions/api/auth/bootstrap.js` | `POST` one-time first-Owner (guarded by `ADMIN_TOKEN` + empty `users` + Turnstile); audit `auth.bootstrap` |
| Create | `functions/api/auth/login.js` | `POST {email,password,turnstileToken}` → Turnstile-first, then auth; audit `auth.login`/`auth.login_failed`/`auth.locked`/`auth.bot_blocked` |
| Create | `functions/api/auth/logout.js` | `POST` (Bearer) → delete session; audit `auth.logout` |
| Create | `functions/api/auth/me.js` | `GET` (Bearer) → current `{user:{name,email,role,permissions}}` |
| Rewrite | `functions/api/admin/_middleware.js` | **Authentication only:** resolve Bearer session → `ctx.data.user`, else `401`. No more `ADMIN_TOKEN`. |
| Create | `functions/api/admin/users.js` | Owner-only: list/create/update/delete staff; last-Owner guardrails; audit `user.*` |
| Create | `functions/api/admin/audit.js` | Owner-only read of the activity log with filters incl. `include_bots` (`requirePermission(ctx,'audit')`) |
| Modify | `functions/api/admin/slots.js` | `requirePermission(ctx,'availability')`; audit `slot.*` |
| Modify | `functions/api/admin/calendar-events.js` | `requirePermission(ctx,'availability')`; audit `event.*` |
| Modify | `functions/api/admin/bookings.js` | `requirePermission(ctx,'bookings')`; audit `booking.confirm`/`booking.cancel` |
| Modify | `functions/api/admin/enquiries.js` | `requirePermission(ctx,'messages')`; audit `enquiry.read`/`enquiry.archive` |
| Modify | `functions/api/admin/reports.js` | `requirePermission(ctx,'reports')` (read-only → no audit) |
| Modify | `functions/api/admin/contacts.js` | `contacts`; CSV→`contacts.export`; erase→`contacts.erase`; audit `contact.*` |
| Modify | `functions/api/admin/code-snippets.js` | `requirePermission(ctx,'tracking')`; audit `snippet.*` |
| Create | `public/assets/admin-users.js` | Owner-only Users UI (`window.OHPUsers`) |
| Create | `public/assets/admin-audit.js` | Owner-only Activity-log UI with filters + "Show bot attempts" toggle (`window.OHPAudit`) |
| Modify | `public/admin.html` | Login = email+password; first-run setup panel; Turnstile widget mounts; Users + Activity sections; load new scripts |
| Modify | `public/assets/admin.js` | Login→`/api/auth/login`; restore via `/api/auth/me`; first-run via `/api/auth/status`+`/api/auth/bootstrap`; render Turnstile when `turnstile_site_key`; logout→`/api/auth/logout`; hide sections per `user.permissions` |
| Modify | `public/_headers` | Add `https://challenges.cloudflare.com` to `script-src` + `frame-src` (Turnstile) |
| Modify | `public/assets/styles.css` | Minor styles for Users/Activity tables (reuse `admin-table`) |
| Create | `tests/auth-core.test.mjs` | `node --test` |

## Data model (`migrations/0008_users.sql`)

```sql
-- Migration 0008: staff identity core — users, login sessions, sign-in + activity log.
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL,              -- normalized: trim + lowercase (login id)
  name                TEXT NOT NULL,
  role                TEXT NOT NULL,              -- 'owner' | 'manager' | 'staff'
  password_hash       TEXT NOT NULL,             -- base64 PBKDF2 derived key
  password_salt       TEXT NOT NULL,             -- base64 random 16 bytes
  password_iterations INTEGER NOT NULL,          -- stored per-user so it can be retuned later
  status              TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'disabled'
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,                       -- ISO datetime or NULL
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_sha256 TEXT NOT NULL,                     -- SHA-256 of the opaque token (never the raw)
  user_id      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_sha256);
CREATE INDEX        IF NOT EXISTS idx_sessions_user  ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,                          -- NULL for failed/bot logins
  actor_email   TEXT,                             -- snapshot / attempted email; survives deletion
  action        TEXT NOT NULL,                    -- e.g. 'auth.login','booking.confirm','contact.erase'
  target_type   TEXT,                             -- e.g. 'user','contact','booking','snippet'
  target_id     TEXT,
  detail        TEXT,                             -- short human note; NO customer PII
  ip            TEXT,                             -- cf-connecting-ip (actor's IP) or NULL
  country       TEXT,                             -- request.cf.country or NULL
  user_agent    TEXT,                             -- truncated User-Agent or NULL
  is_bot        INTEGER NOT NULL DEFAULT 0,       -- 1 = bot-flagged (hidden from Activity by default)
  bot_reason    TEXT,                             -- e.g. 'turnstile_failed','no_user_agent'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
```

Runs once (wrangler migration tracking), like 0003–0007; auto-applies in CI via `deploy.yml`.

## Pure core (`auth-core.mjs`, tested)

- **Permission map.** `PERMISSIONS = { owner: [<all>], manager: [<all except tracking,users,
  audit>], staff: ['bookings','messages'] }`. `can(role, perm) → boolean`. `permissionsFor(role)
  → string[]` (sent to the client for cosmetic section-hiding).
- **`hashPassword(password, {salt?, iterations?})`** → `{hash, salt, iterations}` using
  `crypto.subtle` PBKDF2-HMAC-SHA256 (random 16-byte salt if none given; base64 out). Works in
  Workers **and** Node (both expose `globalThis.crypto.subtle`), so it's unit-testable.
- **`verifyPassword(password, {hash, salt, iterations})`** → boolean, **constant-time** compare
  of the derived bytes.
- **`newSessionToken()`** → 32 random bytes, base64url (the raw token, returned to client once).
  **`hashToken(token)`** → SHA-256 hex (what the DB stores).
- **`validatePassword(pw)`** → `{ok, error?}`: **≥12 characters** (length over complexity).
- **`looksLikeBot({user_agent})`** → `{is_bot, reason}`: conservative — flags empty/missing UA
  (`no_user_agent`) or a known-automation UA (`automation_ua`); otherwise `{is_bot:false}`. Used
  only for *labelling* leftovers, so a miss is harmless (Turnstile does the real blocking).
- **Lockout constants:** `MAX_FAILED = 5`, `LOCK_MINUTES = 15`, `SESSION_HOURS = 12`. Helpers
  `isLocked(user, now)` and `nextFailedState(user, now)` (compute `failed_attempts`/`locked_until`,
  signalling when the lockout trips so the caller can audit `auth.locked`).
- **`PBKDF2_ITERATIONS`** default constant, **verified empirically during build** to keep a login
  comfortably under the Pages Functions CPU budget (start high, e.g. ~210k, and tune down if a
  login approaches the limit). Stored per-user (`password_iterations`) so it's future-tunable.

## Bot verification + request context + audit helpers

- **`turnstile.mjs`:** `turnstileEnabled(env)` = both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`
  present. `verifyTurnstile(secret, token, ip)` → POSTs `secret`/`response`/`remoteip` to
  `https://challenges.cloudflare.com/turnstile/v0/siteverify`, returns `result.success === true`;
  any network/parse error → `false` (fail-closed when the feature is enabled).
- **`reqContext(request)`** (in `auth-db.mjs`) → `{ ip, country, user_agent }` from
  `cf-connecting-ip`, `request.cf?.country`, and a 256-char-truncated `User-Agent`. Missing → `null`.
- **`recordAudit(db, { ...fields, ip, country, user_agent, is_bot, bot_reason })`** — single
  INSERT, **best-effort** (try/catch; never breaks the underlying action).
- **`auditFromCtx(ctx, { action, target_type?, target_id?, detail? })`** — for authenticated
  routes: fills `actor_*` from `ctx.data.user`, context from `reqContext(ctx.request)`, `is_bot=0`.

## Auth endpoints (`/api/auth/*` — not behind the admin middleware; each self-guards)

- **`GET /api/auth/status`** → `{ needs_bootstrap: (users count===0), turnstile_site_key:
  env.TURNSTILE_SITE_KEY ?? null }`. Public; leaks nothing sensitive (the site key is a public value).
- **`POST /api/auth/bootstrap` `{adminToken, email, name, password, turnstileToken}`** → if
  `turnstileEnabled`, verify the token first (fail → `auth.bot_blocked`, `403`). Then allowed
  **only** when `users` is empty **and** `adminToken === env.ADMIN_TOKEN`. Validate password,
  create the first **Owner**, audit `auth.bootstrap`, return a session (logs them straight in).
  Any later call (users exist) → `409`. After this, `ADMIN_TOKEN` no longer authenticates anything.
- **`POST /api/auth/login` `{email, password, turnstileToken}`** →
  1. If `turnstileEnabled` and `verifyTurnstile` fails → audit `auth.bot_blocked` (`is_bot=1`,
     `bot_reason` `turnstile_failed`/`turnstile_missing`), return `403`. Lockout counter untouched.
  2. Normalize email; `findUserByEmail`. Missing → dummy `verifyPassword` (flatten timing / no
     enumeration), audit `auth.login_failed` (stamp `is_bot` from `looksLikeBot`), generic `401`.
  3. `isLocked` or `disabled` → audit `auth.login_failed`, generic `401`.
  4. Verify password: fail → `recordLoginResult(false)`, audit `auth.login_failed` (+ `auth.locked`
     if this trips the lock), generic `401`. Success → reset counters, set `last_login_at`,
     `createSession` (`expires_at = now+12h`), audit `auth.login`, return `{ token, user:{ name,
     email, role, permissions } }`.
  - **Generic error text** ("Email or password is incorrect, or the account is locked.") for every
    credential failure path.
- **`POST /api/auth/logout`** (Bearer) → `deleteSession(hashToken(token))`; audit `auth.logout`.
- **`GET /api/auth/me`** (Bearer) → resolve session → `{user:{name,email,role,permissions}}` or
  `401`. Restores the dashboard UI after a reload. (No audit — a read.)

## Authorization model

- **`admin/_middleware.js` (rewritten) = authentication only.** Read Bearer token → `resolveSession
  (hashToken(token))` (join `sessions`→`users`, require `expires_at > now` and `status='active'`).
  Hit → attach `ctx.data.user = {id,name,email,role,permissions}`, bump `last_seen_at`, `ctx.next()`.
  Miss/expired → `401`. **No `ADMIN_TOKEN` path here** (bootstrap is the only place it's honoured,
  and that route lives outside this middleware).
- **`requirePermission(ctx, perm)`** (helper in `auth-db.mjs`, the non-pure layer — it returns a
  `403 Response` so it can't live in the pure `auth-core`): `return can(ctx.data.user.role, perm)
  ? null : Response.json({error:'Forbidden'},{status:403})`. **Every** admin route calls it at
  the top and returns early if it's non-null. Sub-actions check the finer permission inline:
  - `contacts.js`: base `contacts`; `?format=csv` additionally requires `contacts.export`;
    `DELETE` (erase) requires `contacts.erase`.
  - `users.js` / `audit.js`: require `users` / `audit` respectively.
- **UI hiding is cosmetic.** `admin.js` hides sections whose permission isn't in
  `user.permissions`, but the API is the real boundary — a Staff member hand-crafting a
  `DELETE /api/admin/contacts` gets a `403`.

## Users API (`/api/admin/users`, Owner-only — `requirePermission(ctx,'users')`)

- `GET` → `{users:[{id,name,email,role,status,last_login_at,created_at}]}` (never returns hashes).
- `POST {name,email,role,password}` → validate (role ∈ set; email unique → `409`; password ≥12);
  `createUser` (hash+salt+iterations); audit `user.create`. Returns the new user (no hash).
- `PUT {id, role?, status?, password?}` → update role/status and/or reset password. **Guardrails**
  (server-side, not just UI): cannot demote, disable, or remove the **last active Owner**
  (`countOwners()` must stay ≥1); changing `status→disabled` or resetting a password also calls
  `deleteUserSessions(id)` so the change takes effect immediately. Audit `user.update`
  (PII-free detail, e.g. `"role: staff→manager"`).
- `DELETE ?id=N` → block deleting the last active Owner; block deleting **yourself** (avoid
  self-lockout); `deleteUser` + `deleteUserSessions`; audit `user.delete`.

## Activity-log API (`/api/admin/audit`, Owner-only — `requirePermission(ctx,'audit')`)

- `GET /api/admin/audit?actor=<userId>&action=<prefix>&from=<date>&to=<date>&include_bots=0|1&limit=200`
  → `{entries:[{created_at,actor_email,action,target_type,target_id,detail,ip,country,user_agent,
  is_bot,bot_reason}]}`, newest first. Filters optional and combine: `actor` (user id), `action`
  (exact or a group prefix like `auth.` / `contact.`), `from`/`to` date range, and **`include_bots`
  (default `0` → `is_bot=1` rows excluded)**. `limit` capped at 500.

## Dashboard changes (`admin.html` + `admin.js`)

- **First run:** on load, `admin.js` calls `GET /api/auth/status`. If `needs_bootstrap`, show a
  **"Set up the first owner account"** panel (admin token + name + email + password). If
  `turnstile_site_key` is present, mount the widget and include its token.
- **Login (normal):** the form now has **email + password** (+ the Turnstile widget when a site
  key is present) → `POST /api/auth/login`. On success store `token` in `sessionStorage` (key
  unchanged: `ohpc-admin-token`) and the returned `user`; `showApp()`. Generic error on failure.
- **Turnstile rendering:** inject `https://challenges.cloudflare.com/turnstile/v0/api.js` and a
  widget container only when `status.turnstile_site_key` is set; read the token from the widget
  on submit. When no key → no widget, login proceeds (graceful).
- **Restore:** if a token exists in `sessionStorage` on load, call `GET /api/auth/me` to confirm
  the session before showing the app; `401` → show login.
- **Role-aware UI:** `showApp()` hides each `section.admin-block` whose required permission isn't
  in `user.permissions`. **Users** and **Activity** sections render only for Owners. A small
  "Signed in as `name` (`role`)" line sits by the Sign-out button.
- **Activity section** (`admin-audit.js`, `window.OHPAudit`): a filter bar (person dropdown from
  the Users list, action-group select, from/to dates, **"Show bot attempts"** checkbox →
  `include_bots`) over a table — **When · Who · Action · Target · Detail · Country · IP · Device**.
  Newest first, default last 200, bots hidden. `createElement`/`textContent` only.
- **Logout:** `POST /api/auth/logout` then clear `sessionStorage` and show login.
- All rendering stays `createElement`/`textContent` (CSP; no innerHTML), matching existing modules.

## Edge cases & decisions

- **Deploy transition:** the instant 0008 ships, the old single-password login stops working;
  the dashboard auto-shows the first-run setup panel (`needs_bootstrap`) so the Owner creates
  their account with the existing `ADMIN_TOKEN`, then logs in. Documented as the go-live step.
- **CSP for Turnstile:** add `https://challenges.cloudflare.com` to `script-src` **and**
  `frame-src` in the single global `_headers` CSP (a plain *allow* — nothing loads it on public
  pages). Done globally, not as a second `/admin`-only CSP, to avoid two `Content-Security-Policy`
  headers being sent and intersected (which would silently block the widget). Verify at build with
  the browser console clean of CSP errors on the login page.
- **Turnstile fail-closed only when enabled:** if the keys are unset the check is skipped entirely
  (login works); if they're set, a verification/network error denies the login rather than
  silently allowing it.
- **Last-Owner protection** enforced in `auth-db` (count check) **and** surfaced in the UI.
- **Disabled / deleted user** loses access immediately (sessions deleted), not at next expiry.
- **No user enumeration:** identical generic error + dummy hash on unknown email; lockout per
  account after 5 fails for 15 min; every failure logged with IP/country/device.
- **Bot rows don't burn lockouts:** a Turnstile-blocked request is rejected before the credential
  path, so it never increments `failed_attempts` — bots can't lock out real staff.
- **Audit is best-effort:** an audit-write failure is swallowed and never blocks the action.
- **`detail` PII discipline:** reviewed per write-point — only operational descriptors and ids,
  never customer name/email/phone.
- **Token hygiene:** raw session token returned once at login, stored client-side only; DB keeps
  just its SHA-256. Logout and disable/delete revoke server-side.
- **CPU budget:** PBKDF2 iteration count validated against the Pages Functions limit during build.
- **`ADMIN_TOKEN` after bootstrap:** dead for authentication; follow-up asks the owner to
  remove/rotate it so no shared secret lingers.

## Testing / verification

- **`node --test tests/auth-core.test.mjs`:** `can()` for all three roles across every permission;
  `hashPassword`→`verifyPassword` round-trip (right passes, wrong fails); `verifyPassword` rejects
  tampered hash/salt; `hashToken` stable + `newSessionToken` unique/length; `validatePassword`
  (rejects <12, accepts ≥12); `looksLikeBot` (flags empty UA + `python-requests`/`curl`/`headless`;
  passes a normal browser UA); `isLocked`/`nextFailedState` (5th failure sets `locked_until`, clears
  after the window); `permissionsFor` matches the matrix.
- **Local `wrangler pages dev` (config-driven, migrated local D1; Turnstile via Cloudflare's
  always-pass test keys in `.dev.vars`):**
  1. `status` → `needs_bootstrap:true` + the test site key; bootstrap with the local `ADMIN_TOKEN`
     → first Owner + session; `status` now `false`; second bootstrap → `409`.
  2. As Owner, create a Manager and a Staff; `GET /api/admin/users` hides hashes.
  3. **Authz matrix probes:** Staff token → `reports`/`contacts`/`audit` + contact `DELETE` all
     `403`, but `bookings` `200`. Manager → `contacts`+`?format=csv`+erase `200`, but `users`/
     `code-snippets` POST/`audit` `403`. Owner → all `200`.
  4. **Lockout:** 5 bad logins → locked; correct password within window still `401`; after the
     window, success.
  5. **Guardrails:** delete/demote/disable the only Owner → blocked; disabling a Staff user
     invalidates their session immediately (`401`).
  6. **Activity log:** rows for `auth.login`, a failed `auth.login_failed`, `booking.confirm`,
     `contact.export`, `contact.erase`, `snippet.update`, `user.create`; `?actor=`/`?action=auth.`/
     date filters narrow correctly; every `detail` PII-free.
  7. **Bot defence:** with Turnstile's *fail* test secret (`2x0000000000000000000000000000000AA`),
     a login is rejected `403` and logged `auth.bot_blocked` with `is_bot=1` and the lockout
     counter unchanged; that row is **absent** from `/api/admin/audit` by default and **present**
     with `?include_bots=1`. A request with a `python-requests` UA (Turnstile off) is stamped
     `is_bot=1` (`automation_ua`) and hidden by default.
- **After deploy:** migration `0008` applied; `/api/auth/status` reachable; `/api/admin/*` `401`
  without a session; first-run setup creates the Owner; roles behave per matrix; the Activity log
  shows real sign-ins with country/IP/device; with the real Turnstile keys set, the login page has
  a clean CSP console and the widget renders.

## Operational follow-ups (owner / dev, post-deploy)

- Bootstrap the first Owner, then **create real staff accounts** and hand out their initial
  passwords (no self-reset until Phase 2's email is on).
- **Remove or rotate `ADMIN_TOKEN`** in Cloudflare once the Owner exists.
- **Turn on bot blocking:** create a free **Turnstile** widget in the Cloudflare dashboard, then
  set `TURNSTILE_SITE_KEY` (plain var) and `TURNSTILE_SECRET` (`wrangler pages secret put`). Until
  both are set the login works without a challenge. Locally use Cloudflare's documented test keys.
- Tell staff (internal note) that admin sign-ins and actions are logged with IP/device for
  security, kept ~12 months — the disclosure that supports the legitimate-interest basis.
- Optionally add an **edge rate-limit** on `/api/auth/login` in the Cloudflare dashboard.
- Email-based password reset / self-service is **Phase 2+** (needs Resend on).

## Done =

The shared `ADMIN_TOKEN` is gone. Staff sign in with their own email + password (bots stopped at
the door by Turnstile); the Owner manages accounts and roles in a Users section and reviews a full
**Activity log** — who signed in, when, from where (IP/country/device), and every change they made,
with bot attempts hidden by default; every admin API enforces the role→permission matrix
server-side; passwords are PBKDF2-hashed, sessions are revocable Bearer tokens stored only as
hashes, and brute-force is throttled — all with no public-site change and a clean foundation for
customer accounts in Phase 2.
