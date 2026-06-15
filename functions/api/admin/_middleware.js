// Authenticates every /api/admin/* request via a Bearer SESSION token (not the old ADMIN_TOKEN).
// Authentication only — per-route authorization is enforced in each route via requirePermission().
import { hashToken, mustEnroll2fa } from "../_lib/auth-core.mjs";
import { resolveSession, touchSession } from "../_lib/auth-db.mjs";

// Endpoints a privileged user with no 2FA may still reach, so they can actually enrol. Everything
// else under /api/admin/* is blocked until TOTP is on — this is the real (server-side) enforcement
// of mandatory 2FA; the dashboard's forced-setup screen is just the matching UX.
function isEnrollmentPath(pathname) {
  return pathname.endsWith("/account/2fa-setup") || pathname.endsWith("/account/2fa-enable");
}

export async function onRequest(ctx) {
  const token = (ctx.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const th = await hashToken(token);
  const now = new Date(Date.now()).toISOString();
  const sess = await resolveSession(ctx.env.DB, th, now);
  if (!sess) return Response.json({ error: "Unauthorized" }, { status: 401 });
  ctx.data = ctx.data || {};
  ctx.data.user = { id: sess.id, name: sess.name, email: sess.email, role: sess.role, totp_enabled: !!sess.totp_enabled };

  if (mustEnroll2fa(ctx.data.user) && !isEnrollmentPath(new URL(ctx.request.url).pathname)) {
    return Response.json({ error: "Two-factor authentication is required for your role before you can continue.", mustEnroll2fa: true }, { status: 403 });
  }

  ctx.waitUntil(touchSession(ctx.env.DB, th, now));
  return ctx.next();
}
