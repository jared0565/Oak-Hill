# Account & Security (Phase 2) — Design Spec

**Date:** 2026-06-15 · **Status:** approved direction (locked via /loop), implementation-ready.

## Goal

Add a self-service **Account** area to the admin dashboard for *every* logged-in user (no
special permission), covering: profile (name, avatar), password self-change, and **TOTP
two-factor authentication** with backup codes. Email-change is deferred (needs verification
email; Resend is off).

## Data model — migration `0010_account_security.sql` (additive)

Add to `users`:
- `avatar TEXT` — a small image **data URL** (`data:image/...;base64,...`) or NULL. Personal
  data → already covered by account deletion (row delete).
- `totp_secret TEXT` — base32 TOTP secret (NULL until 2FA setup begins).
- `totp_enabled INTEGER NOT NULL DEFAULT 0` — 1 only after a code is verified.

New table:
```sql
CREATE TABLE IF NOT EXISTS backup_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_sha256 TEXT NOT NULL,      -- SHA-256 of the code (codes are high-entropy)
  used_at TEXT                    -- NULL = unused
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON backup_codes(user_id);
```

## TOTP core — `functions/api/_lib/totp-core.mjs` (pure, unit-tested)

RFC 6238, Web Crypto only (works in Workers + Node). Functions:
- `base32Encode(bytes)` / `base32Decode(str)` — RFC 4648, no padding, A–Z2–7.
- `newTotpSecret()` → base32 string of 20 random bytes (`crypto.getRandomValues`).
- `totpAt(secretBase32, timeMs)` → 6-digit code: `T = floor(timeMs/1000/30)`; HMAC-SHA1 of
  the 8-byte big-endian `T` with the decoded secret (`crypto.subtle` importKey HMAC SHA-1 +
  sign); dynamic truncation → `code % 10^6`, zero-padded.
- `verifyTotp(secretBase32, code, timeMs)` → boolean; accept the windows **T-1, T, T+1**
  (±30 s clock skew); constant-time string compare; reject non-6-digit input.
- `otpauthUri(email, secretBase32)` → `otpauth://totp/Oak%20Hill%20Admin:{email}?secret=...&issuer=Oak%20Hill%20Admin&algorithm=SHA1&digits=6&period=30`.
- `newBackupCodes(n=10)` → `{ codes: [plain...], hashes: [sha256...] }`; plain codes are
  10-char base32 (shown once); store only hashes. Reuse `hashToken` (SHA-256) from auth-core.

**Secret storage note:** `totp_secret` is stored plaintext in D1 (no field encryption
available; it's as sensitive as the PBKDF2 hash beside it). Acceptable for this trust model;
documented for a future app-secret-HMAC wrap if needed.

## DB helpers — extend `functions/api/_lib/auth-db.mjs`

`getFullUser(db,id)` (incl. avatar/totp fields), `updateProfile(db,id,{name,avatar})`,
`setTotpSecret(db,id,secret)`, `enableTotp(db,id)`, `disableTotp(db,id)` (clears secret +
deletes that user's backup_codes), `replaceBackupCodes(db,id,hashes)`,
`consumeBackupCode(db,id,codeHash)` → bool (atomic `UPDATE ... SET used_at WHERE code_sha256=? AND used_at IS NULL`),
`changeOwnPassword(db,id,newPw)`.

## Endpoints — `functions/api/admin/account/*` (authenticated by the existing `admin/_middleware.js`; self-service, **no `requirePermission`** — they act only on `ctx.data.user`)

- `GET  /api/admin/account` → `{ name, email, role, avatar, totp_enabled }`.
- `PUT  /api/admin/account/profile` `{ name?, avatar? }` — `clean(name,100)`; avatar must be
  empty/null **or** a `data:image/(png|jpeg|webp);base64,` URL ≤ **280 000** chars (~200 KB),
  else 400. Updates and returns the fresh profile.
- `PUT  /api/admin/account/password` `{ currentPassword, newPassword }` — verify current via
  `verifyPassword`; `validatePassword(new)` (≥12); update; **revoke all *other* sessions**
  (hash the bearer token from the `Authorization` header; `DELETE FROM sessions WHERE user_id=? AND token_sha256 != ?`); audit `account.password_change`.
- `POST /api/admin/account/2fa/setup` — if already enabled → 409. Generate a secret, store it
  (`totp_enabled` stays 0), return `{ secret, otpauth }` (the client renders the QR with the
  existing `qrcode.js`). Does **not** enable.
- `POST /api/admin/account/2fa/enable` `{ code }` — `verifyTotp(stored secret, code)`; on
  success set `totp_enabled=1`, generate + store backup codes, return `{ ok:true, backupCodes:[...] }`
  (shown once); audit `account.2fa_enabled`. On failure 400.
- `POST /api/admin/account/2fa/disable` `{ currentPassword }` — verify password; clear secret
  + `totp_enabled=0` + delete backup codes; audit `account.2fa_disabled`.

All audit calls use `auditFromCtx` (PII-free detail), consistent with existing endpoints.

## Login flow change — `functions/api/auth/login.js`

After the password verifies (step 4 success) **and** `user.totp_enabled`:
- Read `body.totpCode` (string). If absent → **do not** issue a session; return
  `401 { twofa: true, error: "Enter your authenticator code." }` (password was correct, so do
  **not** increment `failed_attempts` for a *missing* code).
- If present: accept if `verifyTotp(user.totp_secret, code)` **or** `consumeBackupCode` matches
  an unused backup code. On success → issue session as normal. On a *wrong* code → treat like a
  failed attempt (`nextFailedState` + lockout) so TOTP can't be brute-forced; return
  `401 { twofa: true, error: GENERIC }`.

`me`/`login`/`bootstrap` user objects gain `avatar` and `totp_enabled` so the shell can show
the avatar and the Account panel knows 2FA state. (`auth-db` session/user selects updated
accordingly.)

## Frontend

- **Nav:** add an always-visible **Account** item (id `account`, perm `null`) to the sidebar
  (in `admin.html` + the `SECTIONS` registry in `admin.js`) and a `data-panel="account"` panel
  with `<div data-account>`.
- **`public/assets/admin-account.js`** (`window.OHPAccount = { render }`): three cards —
  *Profile* (name field + avatar: initials preview or uploaded image; file input resizes
  client-side via `<canvas>` to ≤256 px, exports `image/webp` data URL, enforces the size cap;
  "Remove photo" clears it); *Email* (read-only, note "changing your login email needs email
  verification — coming soon"); *Security* (change-password form: current + new + confirm; and
  2FA: if disabled → "Enable 2FA" runs setup, renders the QR via `qrcode.js` + secret, asks for
  a code, on enable shows the backup codes once with a copy/acknowledge step; if enabled →
  "2FA is on" + "Disable" (asks password)). All DOM via `createElement`; no innerHTML with
  server/user data.
- **Login 2FA step (`admin.js`):** when `/api/auth/login` responds `{ twofa:true }`, reveal a
  6-digit code field (and "use a backup code") and resubmit `email`+`password` (kept in memory
  for this attempt only)+`totpCode`. Same handling for the setup form is not needed (bootstrap
  never has 2FA).
- **Avatar in the top bar:** show the user's avatar (uploaded image or an initials circle)
  beside the identity text.

## Security notes (aligns with "compliant always")

- 2FA secret only ever leaves the server during setup (to build the QR); never after.
- Backup codes shown once, stored hashed, single-use.
- Wrong-TOTP attempts share the existing 5-try/15-min lockout (anti-brute-force).
- Password change re-verifies the current password and revokes other sessions.
- Avatar is size/type-validated server-side; it's personal data, erased with the account.
- No new external origins → CSP unchanged.

## Testing

- **Unit (`node --test`):** `totp-core` — base32 round-trip; a known RFC 6238 test vector;
  `verifyTotp` accepts T/T±1 and rejects T±2 and malformed; backup-code hash/verify. Plus a
  guard that `verifyTotp` is constant-time-ish (compare path).
- **Browser e2e (local `pages dev` + test owner):** enable 2FA (compute a valid code with
  `totp-core` in Node to enter) → confirm backup codes → sign out → sign in now demands the
  code → wrong code is rejected/locked, right code + a backup code both work → change password
  (other sessions drop) → upload/clear avatar (cap enforced) → 0 console errors.
- **Deploy:** migration `0010` applies in CI; then live smoke.
