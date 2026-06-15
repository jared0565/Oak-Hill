// /api/auth/logout — revoke the current session (Bearer).
import { hashToken } from "../_lib/auth-core.mjs";
import { resolveSession, deleteSession, recordAudit, reqContext } from "../_lib/auth-db.mjs";

export async function onRequestPost(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token) {
    const th = await hashToken(token);
    const now = new Date(Date.now()).toISOString();
    const sess = await resolveSession(ctx.env.DB, th, now);
    if (sess) await recordAudit(ctx.env.DB, { actor_user_id: sess.id, actor_email: sess.email, action: "auth.logout", ...reqContext(ctx.request) });
    await deleteSession(ctx.env.DB, th);
  }
  return Response.json({ ok: true });
}
