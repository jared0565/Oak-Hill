// /api/admin/enquiries — list and update status of contact/party enquiries.
// Auth is enforced automatically by _middleware.js — no auth code here.

const STATUS = { read: "read", archive: "archived", new: "new" };

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB
    .prepare(
      `SELECT id, type, name, email, phone, message, party_date, children, child_age, status, source, created_at
       FROM enquiries ORDER BY created_at DESC, id DESC LIMIT 100`
    )
    .all();
  return Response.json({ enquiries: results });
}

// POST { id, action: "read" | "archive" | "new" }
export async function onRequestPost(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  const status = STATUS[b.action];
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
  return Response.json({ ok: true });
}
