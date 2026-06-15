// /api/admin/enquiries — list and update status of contact/party enquiries.
// Auth is enforced automatically by _middleware.js — no auth code here.
import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";

const STATUS = { read: "read", archive: "archived" };

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "messages"); if (deny) return deny;
  const { results } = await ctx.env.DB
    .prepare(
      `SELECT id, type, name, email, phone, message, party_date, children, child_age, status, source, created_at
       FROM enquiries ORDER BY created_at DESC, id DESC LIMIT 100`
    )
    .all();
  return Response.json({ enquiries: results });
}

// POST { id, action: "read" | "archive" }
export async function onRequestPost(ctx) {
  const deny = requirePermission(ctx, "messages"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  // Own-property check so inherited keys ("constructor", etc.) can't slip past the guard.
  const status = Object.prototype.hasOwnProperty.call(STATUS, b.action) ? STATUS[b.action] : null;
  if (!Number.isInteger(id) || id <= 0 || !status) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const res = await ctx.env.DB
    .prepare("UPDATE enquiries SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
  if (res.meta.changes !== 1) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  await auditFromCtx(ctx, { action: b.action === "archive" ? "enquiry.archive" : "enquiry.read", target_type: "enquiry", target_id: id });
  return Response.json({ ok: true });
}
