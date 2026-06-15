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
