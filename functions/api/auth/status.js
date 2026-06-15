// /api/auth/status — public: is first-run setup still needed, and the Turnstile site key (public).
export async function onRequestGet(ctx) {
  const row = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return Response.json(
    { needs_bootstrap: !row || row.n === 0, turnstile_site_key: ctx.env.TURNSTILE_SITE_KEY || null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
