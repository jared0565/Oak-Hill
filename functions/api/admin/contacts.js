// /api/admin/contacts — CRM list/detail/patch/tags/erase/CSV (auth via _middleware.js).
import { validateTag, csvCell } from "../_lib/contacts-core.mjs";

async function listContacts(ctx, url) {
  const q = (url.searchParams.get("q") || "").trim();
  const tag = (url.searchParams.get("tag") || "").trim().toLowerCase();
  const binds = [], where = [];
  if (q) { const like = "%" + q + "%"; where.push("(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)"); binds.push(like, like, like); }
  if (tag) { where.push("c.id IN (SELECT contact_id FROM contact_tags WHERE tag = ?)"); binds.push(tag); }
  let sql = `SELECT c.id, c.name, c.email, c.phone, c.marketing_opt_in, c.last_seen,
    (SELECT COUNT(*) FROM bookings b WHERE b.contact_id = c.id) AS bookings_n,
    (SELECT COUNT(*) FROM enquiries e WHERE e.contact_id = c.id) AS enquiries_n
    FROM contacts c`;
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY c.last_seen DESC LIMIT 300";
  const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
  const { results: tagRows } = await ctx.env.DB.prepare("SELECT contact_id, tag FROM contact_tags").all();
  const byCid = {};
  for (const t of tagRows) (byCid[t.contact_id] = byCid[t.contact_id] || []).push(t.tag);
  for (const c of results) c.tags = byCid[c.id] || [];
  return results;
}

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const id = Number(url.searchParams.get("id"));

  if (Number.isInteger(id) && id > 0) {
    const contact = await ctx.env.DB.prepare("SELECT id, name, email, phone, marketing_opt_in, first_seen, last_seen, notes FROM contacts WHERE id = ?").bind(id).first();
    if (!contact) return Response.json({ error: "Not found." }, { status: 404 });
    const { results: tags } = await ctx.env.DB.prepare("SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag").bind(id).all();
    const { results: bookings } = await ctx.env.DB.prepare(
      "SELECT b.ref, b.status, b.created_at, s.date, s.start_time, s.end_time FROM bookings b LEFT JOIN slots s ON s.id = b.slot_id WHERE b.contact_id = ? ORDER BY b.created_at DESC"
    ).bind(id).all();
    const { results: enquiries } = await ctx.env.DB.prepare(
      "SELECT type, message, party_date, status, created_at FROM enquiries WHERE contact_id = ? ORDER BY created_at DESC"
    ).bind(id).all();
    contact.tags = tags.map((t) => t.tag);
    return Response.json({ contact, bookings, enquiries });
  }

  if (url.searchParams.get("format") === "csv") {
    const rows = await listContacts(ctx, url);
    const lines = ["id,name,email,phone,marketing_opt_in,last_seen,tags"];
    for (const c of rows) lines.push([c.id, c.name, c.email, c.phone, c.marketing_opt_in, c.last_seen, (c.tags || []).join("|")].map(csvCell).join(","));
    return new Response(lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=contacts.csv" } });
  }

  return Response.json({ contacts: await listContacts(ctx, url) });
}

export async function onRequestPut(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const sets = [], binds = [];
  if (b.notes !== undefined) { sets.push("notes = ?"); binds.push((b.notes == null ? "" : String(b.notes)).slice(0, 2000) || null); }
  if (b.marketing_opt_in !== undefined) { sets.push("marketing_opt_in = ?"); binds.push(b.marketing_opt_in ? 1 : 0); }
  if (!sets.length) return Response.json({ error: "Nothing to update." }, { status: 400 });
  binds.push(id);
  const r = await ctx.env.DB.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}

export async function onRequestPost(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  const action = String(b.action || "");
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  if (action !== "tag_add" && action !== "tag_remove") return Response.json({ error: "Bad action." }, { status: 400 });
  const v = validateTag(b.tag);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  if (action === "tag_add") {
    await ctx.env.DB.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)").bind(id, v.value).run();
  } else {
    await ctx.env.DB.prepare("DELETE FROM contact_tags WHERE contact_id = ? AND tag = ?").bind(id, v.value).run();
  }
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const row = await ctx.env.DB.prepare("SELECT email FROM contacts WHERE id = ?").bind(id).first();
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });
  const email = (row.email || "").toLowerCase();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE bookings SET name='(erased)', email='(erased)', phone='(erased)', notes=NULL, child_age=NULL, children=NULL, contact_id=NULL WHERE contact_id = ? OR LOWER(TRIM(email)) = ?").bind(id, email),
    ctx.env.DB.prepare("UPDATE enquiries SET name='(erased)', email='(erased)', phone=NULL, message=NULL, child_age=NULL, children=NULL, contact_id=NULL WHERE contact_id = ? OR LOWER(TRIM(email)) = ?").bind(id, email),
    ctx.env.DB.prepare("DELETE FROM contact_tags WHERE contact_id = ?").bind(id),
    ctx.env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(id),
  ]);
  return Response.json({ ok: true });
}
