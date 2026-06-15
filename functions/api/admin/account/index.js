// GET /api/admin/account — the acting user's own profile. Self-service: no permission gate;
// scoped strictly to ctx.data.user (authenticated by admin/_middleware.js).
import { getFullUser } from "../../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  try {
    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    if (!u) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({
      name: u.name,
      email: u.email,
      role: u.role,
      avatar: u.avatar || null,
      totp_enabled: !!u.totp_enabled,
    });
  } catch (_) {
    return Response.json({ error: "Could not load your account." }, { status: 500 });
  }
}
