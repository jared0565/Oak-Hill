// Authenticates every /api/admin/* request via a Bearer SESSION token (not the old ADMIN_TOKEN).
// Authentication only — per-route authorization is enforced in each route via requirePermission().
import { hashToken } from "../_lib/auth-core.mjs";
import { resolveSession, touchSession } from "../_lib/auth-db.mjs";

export async function onRequest(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const th = await hashToken(token);
  const now = new Date(Date.now()).toISOString();
  const sess = await resolveSession(ctx.env.DB, th, now);
  if (!sess) return Response.json({ error: "Unauthorized" }, { status: 401 });
  ctx.data = ctx.data || {};
  ctx.data.user = { id: sess.id, name: sess.name, email: sess.email, role: sess.role };
  ctx.waitUntil(touchSession(ctx.env.DB, th, now));
  return ctx.next();
}
