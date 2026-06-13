// Protects every /api/admin/* route with the ADMIN_TOKEN secret.
export async function onRequest(ctx) {
  const header = ctx.request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!ctx.env.ADMIN_TOKEN || !token || token !== ctx.env.ADMIN_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return ctx.next();
}
