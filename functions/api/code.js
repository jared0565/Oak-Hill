// GET /api/code — enabled tracking snippets for the consent-gated client injector.
// Public: this code runs on public pages, so it is inherently public (tag IDs are not secrets).
// `label` (owner-facing) is intentionally omitted.
//
// In demonstration mode no snippets are served at all, so the demo cannot load
// a third-party tag even if one was left enabled in the database.
import { isDemo } from "./_lib/demo.mjs";

export async function onRequestGet(ctx) {
  if (isDemo(ctx.env)) {
    return Response.json({ snippets: [], demo: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, code, placement, scope, consent_category FROM code_snippets WHERE enabled = 1 ORDER BY id"
  ).all();
  return Response.json({ snippets: results }, { headers: { "Cache-Control": "no-store" } });
}
