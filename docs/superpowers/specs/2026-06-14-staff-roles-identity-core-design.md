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
history** — who signed in, when, from where, and every change they made.

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
target, a PII-free human detail, and the **request context (IP, country, device/user-agent)**.

**Action vocabulary**

| Group | Actions | Written by |
|---|---|---|
| Auth | `auth.bootstrap`, `auth.login`, `auth.login_failed`, `auth.locked`, `auth.logout` | `auth/bootstrap.js`, `auth/login.js`, `auth/logout.js` |
| Users | `user.create`, `user.update`, `user.delete` | `admin/users.js` |
| Availability | `slot.create`, `slot.update`, `slot.delete`, `event.create`, `event.update`, `event.delete` | `admin/slots.js`, `admin/calendar-events.js` |
| Bookings | `booking.confirm`, `booking.cancel` | `admin/bookings.js` |
| Messages | `enquiry.read`, `enquiry.archive` | `admin/enquiries.js` |
| Contacts | `contact.tag_add`, `contact.tag_remove`, `contact.note`, `contact.optin`, `contact.export`, `contact.erase` | `admin/contacts.js` |
| Tracking | `snippet.create`, `snippet.update`, `snippet.delete` | `admin/code-snippets.js` |

- **Failed logins** record the *attempted* email (`actor_email`) with `actor_user_id = NULL`,
  plus IP/country/device — so brute-force or odd-location attempts are visible. `auth.locked` is
  written when the 5th failure trips the lockout.
- **`detail` is always PII-free**: it describes the change, not the customer — e.g.
  `"status: pending→paid"`, `"role: staff→manager"`, `"contact #42"`, `"slot 2026-07-02 14:00"`.
  Customer name/email/phone never enter the log; contacts are referenced by id.
- **Request context** comes from the edge: `ip = cf-connecting-ip` header, `country =
  request.cf.country`, `user_agent = User-Agent` header (truncated to 256 chars). In local
  `wrangler pages dev` these may be absent → stored as `NULL`, which is fine.

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
- **Passwords are never stored or logged in plaintext** — only a PBKDF2 hash + per-user salt.
- **Session tokens are never stored raw** — the DB holds only their SHA-256, so a DB leak can't
  be replayed as a live session.
- **No new *customer* data is collected.** This phase only adds *staff* identity + the audit trail.

## Scope

**In:** `users` + `sessions` + `audit_log` tables; `auth-core.mjs` (pure) + `auth-db.mjs` (DB);
`/api/auth/*` (status, bootstrap, login, logout, me); `/api/admin/users` (Owner-only CRUD);
`/api/admin/audit` (Owner-only read with filters); authentication-only rewrite of
`admin/_middleware.js`; per-route authorization on every existing admin endpoint; a **sign-in +
activity log** written on every sign-in/out/failed attempt **and** every data-changing admin
action, each with the actor's IP/country/device; dashboard login (email+password) + first-run
setup + role-based section visibility + Owner-only Users and Activity sections.

**Out:** customer accounts / public registration (Phase 2); password reset by email / magic link
(needs email; Phases 2+); "remember me" long sessions; SSO/2FA (possible later); logging of
**read-only** views (only sign-ins + changes are logged); a scheduled audit-log purge; any change
to the public site.

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `migrations/0008_users.sql` | `users`, `sessions`, `audit_log` (incl. ip/country/user_agent) + indexes |
| Create | `functions/api/_lib/auth-core.mjs` | **Pure:** permission map + `can(role, perm)`/`permissionsFor(role)`; `hashPassword`/`verifyPassword` (PBKDF2 via WebCrypto); `newSessionToken`/`hashToken`; `validatePassword` (≥12 chars); lockout math; constants |
| Create | `functions/api/_lib/auth-db.mjs` | DB helpers: `findUserByEmail`, `getUserById`, `createSession`, `resolveSession`, `deleteSession`, `deleteUserSessions`, `recordLoginResult`, `listUsers`, `createUser`, `updateUser`, `deleteUser`, `countOwners`; `requirePermission(ctx,perm)`; `recordAudit` + `auditFromCtx(ctx,{...})` (pulls actor from `ctx.data.user` and IP/country/UA from `ctx.request`); `reqContext(request)` |
| Create | `functions/api/auth/status.js` | `GET` → `{ needs_bootstrap }` (public; no secrets) |
| Create | `functions/api/auth/bootstrap.js` | `POST` one-time first-Owner creation (guarded by `ADMIN_TOKEN` **and** empty `users`); audit `auth.bootstrap` |
| Create | `functions/api/auth/login.js` | `POST {email,password}` → session token + user; audit `auth.login` / `auth.login_failed` / `auth.locked` |
| Create | `functions/api/auth/logout.js` | `POST` (Bearer) → delete session; audit `auth.logout` |
| Create | `functions/api/auth/me.js` | `GET` (Bearer) → current `{user:{name,email,role,permissions}}` |
| Rewrite | `functions/api/admin/_middleware.js` | **Authentication only:** resolve Bearer session → `ctx.data.user`, else `401`. No more `ADMIN_TOKEN`. |
| Create | `functions/api/admin/users.js` | Owner-only: list/create/update/delete staff; last-Owner guardrails; audit `user.*` |
| Create | `functions/api/admin/audit.js` | Owner-only read of the activity log with filters (`requirePermission(ctx,'audit')`) |
| Modify | `functions/api/admin/slots.js` | `requirePermission(ctx,'availability')`; audit `slot.*` |
| Modify | `functions/api/admin/calendar-events.js` | `requirePermission(ctx,'availability')`; audit `event.*` |
| Modify | `functions/api/admin/bookings.js` | `requirePermission(ctx,'bookings')`; audit `booking.confirm`/`booking.cancel` |
| Modify | `functions/api/admin/enquiries.js` | `requirePermission(ctx,'messages')`; audit `enquiry.read`/`enquiry.archive` |
| Modify | `functions/api/admin/reports.js` | `requirePermission(ctx,'reports')` (read-only → no audit) |
| Modify | `functions/api/admin/contacts.js` | `contacts`; CSV→`contacts.export`; erase→`contacts.erase`; audit `contact.*` (tag/note/optin/export/erase) |
| Modify | `functions/api/admin/code-snippets.js` | `requirePermission(ctx,'tracking')`; audit `snippet.*` |
| Create | `public/assets/admin-users.js` | Owner-only Users UI (`window.OHPUsers`) |
| Create | `public/assets/admin-audit.js` | Owner-only Activity-log UI with filters (`window.OHPAudit`) |
| Modify | `public/admin.html` | Login = email+password; first-run setup panel; Users + Activity sections; load new scripts |
| Modify | `public/assets/admin.js` | Login→`/api/auth/login`; restore via `/api/auth/me`; first-run via `/api/auth/status`+`/api/auth/bootstrap`; logout→`/api/auth/logout`; hide sections per `user.permissions` |
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
  actor_user_id INTEGER,                          -- NULL for failed logins
  actor_email   TEXT,                             -- snapshot / attempted email; survives deletion
  action        TEXT NOT NULL,                    -- e.g. 'auth.login','booking.confirm','contact.erase'
  target_type   TEXT,                             -- e.g. 'user','contact','booking','snippet'
  target_id     TEXT,
  detail        TEXT,                             -- short human note; NO customer PII
  ip            TEXT,                             -- cf-connecting-ip (actor's IP) or NULL
  country       TEXT,                             -- request.cf.country or NULL
  user_agent    TEXT,                             -- truncated User-Agent or NULL
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
- **Lockout constants:** `MAX_FAILED = 5`, `LOCK_MINUTES = 15`, `SESSION_HOURS = 12`. Helpers
  `isLocked(user, now)` and `nextFailedState(user, now)` (compute `failed_attempts`/`locked_until`,
  signalling when the lockout trips so the caller can audit `auth.locked`).
- **`PBKDF2_ITERATIONS`** default constant, **verified empirically during build** to keep a login
  comfortably under the Pages Functions CPU budget (start high, e.g. ~210k, and tune down if a
  login approaches the limit). Stored per-user (`password_iterations`) so it's future-tunable.

## Request context + audit helper (`auth-db.mjs`)

- **`reqContext(request)`** → `{ ip, country, user_agent }` from `cf-connecting-ip`,
  `request.cf?.country`, and a 256-char-truncated `User-Agent`. Any missing value → `null`.
- **`recordAudit(db, { actor_user_id, actor_email, action, target_type, target_id, detail, ip,
  country, user_agent })`** — single INSERT, **best-effort** (try/catch; never breaks the
  underlying action).
- **`auditFromCtx(ctx, { action, target_type?, target_id?, detail? })`** — convenience for the
  authenticated routes: fills `actor_*` from `ctx.data.user` and IP/country/UA from
  `reqContext(ctx.request)`, then calls `recordAudit`. The auth routes (no session yet) call
  `recordAudit` directly with the attempted/created identity.

## Auth endpoints (`/api/auth/*` — not behind the admin middleware; each self-guards)

- **`GET /api/auth/status`** → `{ needs_bootstrap: (SELECT COUNT(*) FROM users)===0 }`. Public,
  leaks nothing sensitive — only whether first-run setup is still pending.
- **`POST /api/auth/bootstrap` `{adminToken, email, name, password}`** → allowed **only** when
  `users` is empty **and** `adminToken === env.ADMIN_TOKEN`. Validates the password, creates the
  first **Owner**, audits `auth.bootstrap`, and returns a session (logs them straight in). Any
  later call (users now exist) → `409`. After this, `ADMIN_TOKEN` no longer authenticates
  anything — the spec's "operational follow-up" tells the owner to remove/rotate it.
- **`POST /api/auth/login` `{email, password}`** → normalize email; `findUserByEmail`. If missing
  → run a **dummy** `verifyPassword` against a fixed fake hash (flatten timing / no enumeration),
  audit `auth.login_failed` (attempted email), return generic `401`. If `isLocked` or
  `status==='disabled'` → audit `auth.login_failed`, generic `401`. Verify password: on fail →
  `recordLoginResult(false)` (bump `failed_attempts`, set `locked_until` at the threshold), audit
  `auth.login_failed` (and `auth.locked` if this trips the lock), generic `401`. On success →
  reset counters, set `last_login_at`, `createSession` (token + sha256 + `expires_at = now+12h`),
  audit `auth.login`, return `{ token, user:{ name, email, role, permissions } }`. **Generic
  error text** ("Email or password is incorrect, or the account is locked.") for every failure.
- **`POST /api/auth/logout`** (Bearer) → `deleteSession(hashToken(token))`; audit `auth.logout` →
  `{ok:true}`.
- **`GET /api/auth/me`** (Bearer) → resolve session (same as middleware) → `{user:{name,email,
  role,permissions}}` or `401`. Lets the dashboard restore its UI after a reload. (No audit — a
  read.)

## Authorization model

- **`admin/_middleware.js` (rewritten) = authentication only.** Read Bearer token → `resolveSession
  (hashToken(token))` (join `sessions`→`users`, require `expires_at > now` and `status='active'`).
  Hit → attach `ctx.data.user = {id,name,email,role,permissions}`, bump `last_seen_at`, `ctx.next()`.
  Miss/expired → `401`. **No `ADMIN_TOKEN` path here** (bootstrap is the only place it's honoured,
  and that route lives outside this middleware).
- **`requirePermission(ctx, perm)`** (helper in `auth-db.mjs`, the non-pure layer — it returns a
  `403 Response` so it can't live in the pure `auth-core`): `return can(ctx.data.user.role, perm)
  ? null : Response.json({error:'Forbidden'},{status:403})`. **Every** admin route calls it at
  the top and returns early if it's non-null, passing its declared permission. Sub-actions check
  the finer permission inline:
  - `contacts.js`: base `contacts`; the `?format=csv` branch additionally requires
    `contacts.export`; `DELETE` (erase) requires `contacts.erase`.
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

- `GET /api/admin/audit?actor=<userId>&action=<prefix>&from=<date>&to=<date>&limit=200` →
  `{entries:[{created_at,actor_email,action,target_type,target_id,detail,ip,country,user_agent}]}`,
  newest first. Filters are optional and combine: `actor` (by user id), `action` (exact or a
  group prefix like `auth.` / `contact.`), and a `from`/`to` date range. `limit` capped at 500.

## Dashboard changes (`admin.html` + `admin.js`)

- **First run:** on load, `admin.js` calls `GET /api/auth/status`. If `needs_bootstrap`, show a
  **"Set up the first owner account"** panel (admin token + name + email + password) → `POST
  /api/auth/bootstrap` → store the returned session token → `showApp()`.
- **Login (normal):** the form now has **email + password** → `POST /api/auth/login`. On success
  store `token` in `sessionStorage` (key unchanged: `ohpc-admin-token`) and the returned
  `user`; `showApp()`. Generic error on failure.
- **Restore:** if a token exists in `sessionStorage` on load, call `GET /api/auth/me` to fetch the
  current user (and confirm the session is still valid) before showing the app; `401` → show login.
- **Role-aware UI:** `showApp()` hides each `section.admin-block` whose required permission isn't
  in `user.permissions`. New **Users** and **Activity** sections render only for Owners. A small
  "Signed in as `name` (`role`)" line appears by the Sign-out button.
- **Activity section** (`admin-audit.js`, `window.OHPAudit`): a filter bar (person dropdown built
  from the Users list, action-group select, from/to dates) over a table — **When · Who · Action ·
  Target · Detail · Country · IP · Device**. Newest first, default last 200. `createElement`/
  `textContent` only.
- **Logout:** `POST /api/auth/logout` then clear `sessionStorage` and show login.
- All rendering stays `createElement`/`textContent` (CSP; no innerHTML), matching existing admin
  modules.

## Edge cases & decisions

- **Deploy transition:** the instant 0008 ships, the old single-password login stops working;
  the dashboard auto-shows the first-run setup panel (`needs_bootstrap`) so the Owner creates
  their account with the existing `ADMIN_TOKEN`, then logs in. Documented as the go-live step.
- **Last-Owner protection** is enforced in `auth-db` (count check) **and** surfaced in the UI, so
  there's always a way back in.
- **Disabled / deleted user** loses access immediately (their sessions are deleted), not just at
  next expiry.
- **No user enumeration:** identical generic error + dummy hash on unknown email; lockout applies
  per-account after 5 fails for 15 min; every failure is logged with IP/country/device.
- **Audit is best-effort:** an audit-write failure is swallowed and never blocks the action it
  describes (the action's own success/failure is unchanged).
- **`detail` PII discipline:** reviewed per write-point — only operational descriptors and ids,
  never customer name/email/phone, so the log itself never becomes a customer-data store.
- **Token hygiene:** raw session token returned once at login, stored client-side only; DB keeps
  just its SHA-256. Logout and disable/delete revoke server-side.
- **CPU budget:** PBKDF2 iteration count is validated against the Pages Functions limit during
  build rather than guessed; logins are infrequent so a modest cost is fine.
- **`ADMIN_TOKEN` after bootstrap:** dead for authentication; spec's follow-up asks the owner to
  remove/rotate the secret so no shared secret lingers.

## Testing / verification

- **`node --test tests/auth-core.test.mjs`:** `can()` for all three roles across every permission
  (incl. the sensitive sub-actions); `hashPassword`→`verifyPassword` round-trip (right pw passes,
  wrong fails); `verifyPassword` rejects tampered hash/salt; `hashToken` stable + `newSessionToken`
  unique/length; `validatePassword` (rejects <12, accepts ≥12); `isLocked`/`nextFailedState`
  (5th failure sets `locked_until`, lock clears after the window); `permissionsFor` matches the
  matrix.
- **Local `wrangler pages dev` (config-driven, against the migrated local D1):**
  1. `status` → `needs_bootstrap:true`; bootstrap with the local `ADMIN_TOKEN` → first Owner +
     session; `status` now `false`; second bootstrap → `409`.
  2. As Owner, create a Manager and a Staff (Users API); `GET /api/admin/users` hides hashes.
  3. **Authz matrix probes:** with the Staff token, `GET /api/admin/reports`→`403`,
     `GET /api/admin/contacts`→`403`, `DELETE /api/admin/contacts?id=…`→`403`, `GET
     /api/admin/audit`→`403`, but `GET /api/admin/bookings`→`200`. With the Manager token,
     `contacts` + `?format=csv` + erase → `200`, but `/api/admin/users`→`403`,
     `/api/admin/code-snippets` POST→`403`, `/api/admin/audit`→`403`. Owner → all `200`.
  4. **Lockout:** 5 bad logins → account locked; correct password within the window still `401`;
     after the window, login succeeds.
  5. **Guardrails:** deleting/demoting/disabling the only Owner → blocked; disabling a Staff
     user immediately invalidates their existing session token (next call `401`).
  6. **Activity log:** confirm rows for `auth.login`, a failed `auth.login_failed` (with the
     attempted email + IP/country/device populated where the edge provides them), `booking.confirm`,
     `contact.export`, `contact.erase`, `tracking`/`snippet.update`, and `user.create`; then hit
     `/api/admin/audit` with `?actor=`, `?action=auth.`, and a date range and confirm the filters
     narrow correctly and every `detail` is PII-free.
- **After deploy:** migration `0008` applied; `/api/auth/status` reachable; `/api/admin/*`
  returns `401` without a session; first-run setup creates the Owner; each role behaves per the
  matrix; the Activity log shows real sign-ins with country/IP/device on the live dashboard.

## Operational follow-ups (owner / dev, post-deploy)

- Bootstrap the first Owner, then **create real staff accounts** and hand out their initial
  passwords (they can't self-reset until Phase 2's email is on).
- **Remove or rotate `ADMIN_TOKEN`** in Cloudflare once the Owner exists — it's no longer a login,
  only the (now spent) bootstrap guard.
- Tell staff (internal note) that admin sign-ins and actions are logged with IP/device for
  security, kept ~12 months — the disclosure that supports the legitimate-interest basis.
- Email-based password reset / self-service is **Phase 2+** (needs Resend on).

## Done =

The shared `ADMIN_TOKEN` is gone. Staff sign in with their own email + password; the Owner
manages accounts and roles in a Users section and reviews a full **Activity log** — who signed in,
when, from where (IP/country/device), and every change they made; every admin API enforces the
role→permission matrix server-side; passwords are PBKDF2-hashed, sessions are revocable Bearer
tokens stored only as hashes, and brute-force is throttled — all with no public-site change and a
clean foundation for customer accounts in Phase 2.
