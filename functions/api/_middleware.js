// API middleware: attaches baseline security headers to every /api/* (Pages Functions) response.
// Scoped to functions/api/ on purpose — a root functions/_middleware.js would also intercept
// every STATIC asset, routing it through the Worker and overriding public/_headers. Static assets
// get their headers from public/_headers; this covers only the dynamic API responses it doesn't.
// Runs as the parent of functions/api/admin/_middleware.js, so it also decorates that 401 and any
// error responses.
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
