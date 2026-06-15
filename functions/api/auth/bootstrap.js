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

  // --- TEMP DIAGNOSTIC (remove after): surface the real failing step + full error on-screen ---
  let step = "createUser";
  let createdId = null;
  try {
    createdId = await createUser(ctx.env.DB, { name, email, role: "owner", password: pw, protected: true });
    step = "recordAudit";
    await recordAudit(ctx.env.DB, { actor_user_id: createdId, actor_email: email, action: "auth.bootstrap", ...c, detail: "first owner" });
    step = "createSession";
    const { token } = await createSession(ctx.env.DB, createdId, Date.now());
    return Response.json({ token, user: { name, email, role: "owner", permissions: permissionsFor("owner") } });
  } catch (err) {
    // Self-clean: if the owner row was created before a later step threw, remove it so
    // needs_bootstrap stays true (don't strand the user on "Setup is already complete").
    if (createdId != null) { try { await ctx.env.DB.prepare("DELETE FROM users WHERE id=?").bind(createdId).run(); } catch (_) {} }
    return Response.json({ error: `DIAG[${step}] ${err?.name}: ${err?.message}${err?.cause ? " | cause: " + err.cause : ""}` }, { status: 500 });
  }
}
