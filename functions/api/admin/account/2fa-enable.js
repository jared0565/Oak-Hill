// POST /api/admin/account/2fa-enable — confirm setup: verify a code against the staged secret,
// then turn 2FA on and issue one-time backup codes (shown once).
import { getFullUser, enableTotp, replaceBackupCodes, auditFromCtx } from "../../_lib/auth-db.mjs";
import { verifyTotp, newBackupCodes } from "../../_lib/totp-core.mjs";

export async function onRequestPost(ctx) {
  try {
    const b = await ctx.request.json().catch(() => ({}));
    const code = typeof b.code === "string" ? b.code.trim() : "";

    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    if (!u) return Response.json({ error: "Not found." }, { status: 404 });
    if (u.totp_enabled) return Response.json({ error: "Two-factor authentication is already on." }, { status: 409 });
    if (!u.totp_secret) return Response.json({ error: "Start two-factor setup first." }, { status: 400 });

    const ok = await verifyTotp(u.totp_secret, code);
    if (!ok) return Response.json({ error: "That code didn't match. Try the current one." }, { status: 400 });

    const { codes, hashes } = await newBackupCodes(10);
    await replaceBackupCodes(ctx.env.DB, u.id, hashes);
    await enableTotp(ctx.env.DB, u.id);
    await auditFromCtx(ctx, { action: "account.2fa_enabled", target_type: "user", target_id: u.id });

    return Response.json({ ok: true, backupCodes: codes });
  } catch (_) {
    return Response.json({ error: "Could not enable two-factor authentication." }, { status: 500 });
  }
}
