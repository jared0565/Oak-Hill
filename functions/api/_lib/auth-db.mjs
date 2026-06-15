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
export async function createUser(db, { name, email, role, password, protected: isProtected = false }) {
  const { hash, salt, iterations } = await hashPassword(password);
  const r = await db.prepare(
    "INSERT INTO users (email, name, role, password_hash, password_salt, password_iterations, protected) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(email, name, role, hash, salt, iterations, isProtected ? 1 : 0).run();
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
  // Self-contained erasure: remove the user's satellite rows (sessions, backup codes) in the
  // same atomic batch as the user row, so deletion can't leave orphaned personal/security data
  // behind (D1 has no FK cascade). The avatar lives on the users row, so it goes with it.
  const res = await db.batch([
    db.prepare("DELETE FROM backup_codes WHERE user_id=?").bind(id),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    db.prepare("DELETE FROM users WHERE id=?").bind(id),
  ]);
  return res[res.length - 1].meta.changes;
}
export async function listUsers(db) {
  const { results } = await db.prepare(
    "SELECT id, name, email, role, status, protected, last_login_at, created_at FROM users ORDER BY created_at"
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
    `SELECT s.expires_at, u.id, u.name, u.email, u.role, u.status, u.avatar, u.totp_enabled
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

// --- retention / GC --------------------------------------------------------------------
// Storage-limitation (UK GDPR Art.5(1)(e)): the audit log keeps IP/country/UA and the
// analytics table keeps anonymous events — neither should live forever. We don't run a
// cron, so purge opportunistically on login (staff-only, infrequent → off the public hot
// path), mirroring the expired-session sweep. The retention windows are trusted integer
// constants, so they're inlined into the SQL via SQLite's own date math (datetime('now',
// '-N months')) — that yields the exact 'YYYY-MM-DD HH:MM:SS' format these columns are
// stored in (datetime('now')), so there's no JS/SQLite string-format mismatch at the cut.
export const AUDIT_RETENTION_MONTHS = 12;
export const ANALYTICS_RETENTION_MONTHS = 12;
export function purgeExpiredData(db, nowMs) {
  return db.batch([
    // sessions.expires_at is an ISO string (toISOString), so compare against the same format.
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date(nowMs).toISOString()),
    db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', '-${AUDIT_RETENTION_MONTHS} months')`),
    db.prepare(`DELETE FROM analytics_events WHERE ts < datetime('now', '-${ANALYTICS_RETENTION_MONTHS} months')`),
  ]);
}

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
// Clear the brute-force counter after a successful re-auth (password change / 2FA disable),
// WITHOUT touching last_login_at — these are sudo-style confirmations, not sign-ins. Sharing
// the lockout means failed re-auth attempts feed the same 5-strike/15-min trip as login.
export function clearFailedAttempts(db, userId) {
  return db.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?").bind(userId).run();
}

// --- account & security (self-service) -------------------------------------------------
// Full row incl. avatar + TOTP fields — endpoints fetch this for the acting user, since the
// middleware only attaches {id,name,email,role}.
export function getFullUser(db, id) { return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first(); }

export async function updateProfile(db, id, { name, avatar }) {
  const sets = [], binds = [];
  if (name !== undefined) { sets.push("name=?"); binds.push(name); }
  if (avatar !== undefined) { sets.push("avatar=?"); binds.push(avatar); } // null clears it
  if (!sets.length) return 0;
  binds.push(id);
  const r = await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return r.meta.changes;
}

export function setTotpSecret(db, id, secret) {
  // Stage the secret during setup; enabled stays 0 until a code is verified.
  return db.prepare("UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?").bind(secret, id).run();
}
export function enableTotp(db, id) {
  return db.prepare("UPDATE users SET totp_enabled=1 WHERE id=?").bind(id).run();
}
export async function disableTotp(db, id) {
  await db.prepare("UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?").bind(id).run();
  await db.prepare("DELETE FROM backup_codes WHERE user_id=?").bind(id).run();
}

export async function replaceBackupCodes(db, id, hashes) {
  // Atomic: clear old codes and write the new set in one D1 batch (transactional). A non-atomic
  // delete-then-loop could fail mid-way and leave the user with fewer codes than they were shown.
  await db.batch([
    db.prepare("DELETE FROM backup_codes WHERE user_id=?").bind(id),
    ...hashes.map((h) => db.prepare("INSERT INTO backup_codes (user_id, code_sha256) VALUES (?, ?)").bind(id, h)),
  ]);
}

// Atomic single-use consume: only an unused, matching code flips → changes>0 exactly once.
export async function consumeBackupCode(db, id, codeHash) {
  const r = await db.prepare(
    "UPDATE backup_codes SET used_at=datetime('now') WHERE user_id=? AND code_sha256=? AND used_at IS NULL"
  ).bind(id, codeHash).run();
  return r.meta.changes > 0;
}

export async function changeOwnPassword(db, id, newPw) {
  const { hash, salt, iterations } = await hashPassword(newPw);
  await db.prepare("UPDATE users SET password_hash=?, password_salt=?, password_iterations=? WHERE id=?")
    .bind(hash, salt, iterations, id).run();
}
