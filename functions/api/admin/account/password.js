// PUT /api/admin/account/password — change own password. Re-verifies the current password,
// then revokes every OTHER session (the current bearer token stays valid).
import { getFullUser, changeOwnPassword, auditFromCtx } from "../../_lib/auth-db.mjs";
import { verifyPassword, validatePassword, hashToken } from "../../_lib/auth-core.mjs";

export async function onRequestPut(ctx) {
  try {
    const b = await ctx.request.json().catch(() => ({}));
    const currentPassword = typeof b.currentPassword === "string" ? b.currentPassword : "";
    const newPassword = typeof b.newPassword === "string" ? b.newPassword : "";

    const pv = validatePassword(newPassword);
    if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 });

    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    if (!u) return Response.json({ error: "Not found." }, { status: 404 });

    const ok = await verifyPassword(currentPassword, { hash: u.password_hash, salt: u.password_salt, iterations: u.password_iterations });
    if (!ok) return Response.json({ error: "Your current password is incorrect." }, { status: 400 });

    await changeOwnPassword(ctx.env.DB, u.id, newPassword);

    // Revoke other sessions; keep the one making this request.
    const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const th = await hashToken(token);
      await ctx.env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_sha256 != ?").bind(u.id, th).run();
    }

    await auditFromCtx(ctx, { action: "account.password_change", target_type: "user", target_id: u.id });
    return Response.json({ ok: true });
  } catch (_) {
    return Response.json({ error: "Could not change your password." }, { status: 500 });
  }
}
