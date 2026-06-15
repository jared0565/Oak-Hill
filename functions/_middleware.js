// Root Pages-Functions middleware: attaches baseline security headers to every dynamic
// (/api/*) response. Static assets are covered by public/_headers, which does NOT apply to
// Function responses — this closes that gap. Runs outermost, so it also decorates the 401s
// returned by functions/api/admin/_middleware.js and any error responses.
export async function onRequest(ctx) {
  const res = await ctx.next();
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY"); // JSON API responses should never be framed
  // Auth/account/admin responses can carry session-sensitive data — never cache them.
  const path = new URL(ctx.request.url).pathname;
  if (path.startsWith("/api/auth") || path.startsWith("/api/admin")) {
    h.set("Cache-Control", "no-store");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
