// POST /api/admin/account/2fa-disable — turn 2FA off after re-verifying the password.
// Clears the secret and deletes the user's backup codes.
import { getFullUser, disableTotp, auditFromCtx } from "../../_lib/auth-db.mjs";
import { verifyPassword, hashToken } from "../../_lib/auth-core.mjs";

export async function onRequestPost(ctx) {
  try {
    const b = await ctx.request.json().catch(() => ({}));
    const currentPassword = typeof b.currentPassword === "string" ? b.currentPassword : "";

    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    if (!u) return Response.json({ error: "Not found." }, { status: 404 });

    const ok = await verifyPassword(currentPassword, { hash: u.password_hash, salt: u.password_salt, iterations: u.password_iterations });
    if (!ok) return Response.json({ error: "Your current password is incorrect." }, { status: 400 });

    await disableTotp(ctx.env.DB, u.id);

    // Turning off a second factor is a security downgrade — revoke every OTHER session (keep the
    // one making this request), the same way a password change does, so a stolen token can't ride
    // through the downgrade.
    const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const th = await hashToken(token);
      await ctx.env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_sha256 != ?").bind(u.id, th).run();
    }

    await auditFromCtx(ctx, { action: "account.2fa_disabled", target_type: "user", target_id: u.id });

    return Response.json({ ok: true });
  } catch (_) {
    return Response.json({ error: "Could not turn off two-factor authentication." }, { status: 500 });
  }
}
