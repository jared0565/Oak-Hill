// /api/admin/code-snippets — owner CRUD for tracking snippets (auth via _middleware.js).
import { validateSnippet, unknownHostsIn } from "../_lib/snippet-core.mjs";

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, label, code, placement, scope, consent_category, enabled, updated_at FROM code_snippets ORDER BY id"
  ).all();
  return Response.json({ snippets: results });
}

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const v = validateSnippet(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const s = v.value;
  const r = await ctx.env.DB
    .prepare("INSERT INTO code_snippets (label, code, placement, scope, consent_category, enabled) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(s.label, s.code, s.placement, s.scope, s.consent_category, s.enabled).run();
  return Response.json({ ok: true, id: r.meta.last_row_id, warnings: unknownHostsIn(s.code) });
}

export async function onRequestPut(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const v = validateSnippet(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const s = v.value;
  const r = await ctx.env.DB
    .prepare("UPDATE code_snippets SET label=?, code=?, placement=?, scope=?, consent_category=?, enabled=?, updated_at=datetime('now') WHERE id=?")
    .bind(s.label, s.code, s.placement, s.scope, s.consent_category, s.enabled, id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true, warnings: unknownHostsIn(s.code) });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const r = await ctx.env.DB.prepare("DELETE FROM code_snippets WHERE id=?").bind(id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
