// /api/admin/calendar-events — owner CRUD for events + closures (auth via _middleware.js).
import { validateCalendarEvent } from "../_lib/availability-core.mjs";

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let sql = "SELECT id, kind, title, start_date, end_date, all_day, start_time, end_time, notes FROM calendar_events";
  const binds = [];
  if (from && to) { sql += " WHERE end_date >= ? AND start_date <= ?"; binds.push(from, to); }
  sql += " ORDER BY start_date, start_time";
  const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return Response.json({ events: results });
}

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const v = validateCalendarEvent(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const e = v.value;
  const r = await ctx.env.DB
    .prepare(`INSERT INTO calendar_events (kind, title, start_date, end_date, all_day, start_time, end_time, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(e.kind, e.title, e.start_date, e.end_date, e.all_day, e.start_time, e.end_time, e.notes)
    .run();
  return Response.json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestPut(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const v = validateCalendarEvent(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const e = v.value;
  const r = await ctx.env.DB
    .prepare(`UPDATE calendar_events SET kind=?, title=?, start_date=?, end_date=?, all_day=?, start_time=?, end_time=?, notes=? WHERE id=?`)
    .bind(e.kind, e.title, e.start_date, e.end_date, e.all_day, e.start_time, e.end_time, e.notes, id)
    .run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const r = await ctx.env.DB.prepare("DELETE FROM calendar_events WHERE id=?").bind(id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
