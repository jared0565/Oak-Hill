// /api/auth/bootstrap — one-time first-owner creation. Guarded by ADMIN_TOKEN + empty users (+ Turnstile).
import { createUser, createSession, recordAudit, reqContext } from "../_lib/auth-db.mjs";
import { validatePassword, permissionsFor } from "../_lib/auth-core.mjs";
import { turnstileEnabled, verifyTurnstile } from "../_lib/turnstile.mjs";
import { normalizeEmail, clean } from "../_lib/contacts-core.mjs";

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const c = reqContext(ctx.request);

  if (turnstileEnabled(ctx.env)) {
    const ok = await verifyTurnstile(ctx.env.TURNSTILE_SECRET, body.turnstileToken, c.ip);
    if (!ok) {
      await recordAudit(ctx.env.DB, { action: "auth.bot_blocked", ...c, is_bot: 1, bot_reason: body.turnstileToken ? "turnstile_failed" : "turnstile_missing", detail: "bootstrap" });
      return Response.json({ error: "Could not verify you are human. Please try again." }, { status: 403 });
    }
  }

  const countRow = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (countRow && countRow.n > 0) return Response.json({ error: "Setup is already complete." }, { status: 409 });
  if (!ctx.env.ADMIN_TOKEN || body.adminToken !== ctx.env.ADMIN_TOKEN) return Response.json({ error: "Setup token is incorrect." }, { status: 401 });

  const email = normalizeEmail(body.email);
  const name = clean(body.name, 100);
  const pw = typeof body.password === "string" ? body.password : "";
  if (!email || !name) return Response.json({ error: "Name and email are required." }, { status: 400 });
  const pv = validatePassword(pw);
  if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 });

  const id = await createUser(ctx.env.DB, { name, email, role: "owner", password: pw, protected: true });
  await recordAudit(ctx.env.DB, { actor_user_id: id, actor_email: email, action: "auth.bootstrap", ...c, detail: "first owner" });
  const { token } = await createSession(ctx.env.DB, id, Date.now());
  return Response.json({ token, user: { name, email, role: "owner", permissions: permissionsFor("owner"), avatar: null, totp_enabled: false } });
}
