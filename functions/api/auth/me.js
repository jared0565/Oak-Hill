// /api/auth/me — resolve the Bearer session → current user (lets the dashboard restore after reload).
import { hashToken, permissionsFor } from "../_lib/auth-core.mjs";
import { resolveSession } from "../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date(Date.now()).toISOString();
  const sess = await resolveSession(ctx.env.DB, await hashToken(token), now);
  if (!sess) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ user: { name: sess.name, email: sess.email, role: sess.role, permissions: permissionsFor(sess.role), avatar: sess.avatar || null, totp_enabled: !!sess.totp_enabled } });
}
