// /api/auth/login — email+password → Bearer session token. Public; bot-checked; no enumeration.
import { findUserByEmail, recordLoginResult, createSession, recordAudit, reqContext, consumeBackupCode } from "../_lib/auth-db.mjs";
import { verifyPassword, permissionsFor, isLocked, nextFailedState, looksLikeBot, PBKDF2_ITERATIONS, hashToken } from "../_lib/auth-core.mjs";
import { verifyTotp } from "../_lib/totp-core.mjs";
import { turnstileEnabled, verifyTurnstile } from "../_lib/turnstile.mjs";
import { normalizeEmail } from "../_lib/contacts-core.mjs";

const GENERIC = "Email or password is incorrect, or the account is locked.";
// A validly-shaped (all-zero-bytes) PBKDF2 record so unknown-email logins still spend
// hashing time → no user enumeration via timing. The verify always returns false.
const DUMMY = { hash: "A".repeat(43) + "=", salt: "A".repeat(22) + "==", iterations: PBKDF2_ITERATIONS };

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

  // 4b. Second factor (only when enabled). Password is already correct here.
  if (user.totp_enabled) {
    const code = typeof body.totpCode === "string" ? body.totpCode.trim() : "";
    if (!code) {
      // Password was correct — this is a continue-to-second-step, not a failure. Return 200 so
      // the browser doesn't log a spurious 401 on the normal 2FA path. No token is issued; the
      // body's `twofa` flag tells the client to prompt for the code. (Not a failed attempt, so
      // the lockout counter is untouched.)
      return Response.json({ twofa: true, error: "Enter your authenticator code." }, { status: 200 });
    }
    // verifyTotp's 6-digit guard rejects backup codes, so falling through to consume one is
    // safe. Backup codes are uppercase base32 → normalize before the case-sensitive hash.
    const totpOk = await verifyTotp(user.totp_secret, code) || await consumeBackupCode(ctx.env.DB, user.id, await hashToken(code.toUpperCase()));
    if (!totpOk) {
      // Wrong code → share the brute-force lockout so 2FA can't be hammered.
      const lock = nextFailedState(user, now);
      await recordLoginResult(ctx.env.DB, user, false, now, lock);
      await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.login_failed", ...c, is_bot: bot.is_bot ? 1 : 0, bot_reason: bot.reason, detail: "bad 2fa code" });
      if (lock.locked) await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.locked", ...c, detail: "locked 15m after 5 fails" });
      return Response.json({ twofa: true, error: GENERIC }, { status: 401 });
    }
  }

  // 5. Success.
  await recordLoginResult(ctx.env.DB, user, true, now);
  const { token } = await createSession(ctx.env.DB, user.id, now);
  // Best-effort housekeeping: drop expired sessions so the table can't grow unbounded.
  ctx.waitUntil(ctx.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date(now).toISOString()).run());
  await recordAudit(ctx.env.DB, { actor_user_id: user.id, actor_email: user.email, action: "auth.login", ...c });
  return Response.json({ token, user: { name: user.name, email: user.email, role: user.role, permissions: permissionsFor(user.role), avatar: user.avatar || null, totp_enabled: !!user.totp_enabled } });
}
