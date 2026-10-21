// POST /api/track — first-party, cookieless event capture. Returns 204.
// COMPLIANCE: never reads/stores the client IP; stores only name/path/source/ts.
//
// In demonstration mode nothing is recorded at all: the demo demonstrates the
// flow without keeping a trace of who looked at what.
import { validateTrackName, deriveSource } from "./_lib/analytics-core.mjs";
import { isDemo } from "./_lib/demo.mjs";

export async function onRequestPost(ctx) {
  let body;
  try { body = await ctx.request.json(); } catch (e) { return new Response(null, { status: 204 }); }
  if (!body || !validateTrackName(body.name)) return new Response(null, { status: 204 });
  if (isDemo(ctx.env)) return new Response(null, { status: 204 });
  const path = (body.path == null ? "" : String(body.path)).trim().slice(0, 200) || null;
  const selfHost = new URL(ctx.request.url).hostname;
  const source = deriveSource(body.referrer, body.utm, selfHost);
  try {
    await ctx.env.DB
      .prepare("INSERT INTO analytics_events (name, path, source) VALUES (?, ?, ?)")
      .bind(body.name, path, source).run();
  } catch (e) { /* analytics must never surface an error to the client */ }
  return new Response(null, { status: 204 });
}
