// POST /api/admin/account/2fa-setup — begin 2FA setup: stage a secret (not yet enabled) and
// return it + the otpauth URI so the client can render the QR. Does NOT enable 2FA.
import { getFullUser, setTotpSecret, auditFromCtx } from "../../_lib/auth-db.mjs";
import { newTotpSecret, otpauthUri } from "../../_lib/totp-core.mjs";

export async function onRequestPost(ctx) {
  try {
    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    if (!u) return Response.json({ error: "Not found." }, { status: 404 });
    if (u.totp_enabled) return Response.json({ error: "Two-factor authentication is already on." }, { status: 409 });

    const secret = newTotpSecret();
    await setTotpSecret(ctx.env.DB, u.id, secret);
    await auditFromCtx(ctx, { action: "account.2fa_setup", target_type: "user", target_id: u.id });

    return Response.json({ secret, otpauth: otpauthUri(u.email, secret) });
  } catch (_) {
    return Response.json({ error: "Could not start two-factor setup." }, { status: 500 });
  }
}
