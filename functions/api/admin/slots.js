// /api/admin/slots — owner slot management (auth enforced by _middleware.js).

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, date, start_time, end_time, label, status FROM slots ORDER BY date, start_time"
  ).all();
  return Response.json({ slots: results });
}

export async function onRequestPost(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const date = String(b.date || "").trim();
  const start = String(b.start_time || "").trim();
  const end = String(b.end_time || "").trim();
  const label = (String(b.label || "Party slot").trim().slice(0, 60)) || "Party slot";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return Response.json({ error: "Need a date (YYYY-MM-DD) and start/end times (HH:MM)." }, { status: 400 });
  }
  if (end <= start) {
    return Response.json({ error: "End time must be after the start time." }, { status: 400 });
  }

  const r = await ctx.env.DB
    .prepare("INSERT INTO slots (date, start_time, end_time, label, status) VALUES (?, ?, ?, ?, 'available')")
    .bind(date, start, end, label)
    .run();
  return Response.json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Missing slot id." }, { status: 400 });
  }
  const booking = await ctx.env.DB
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status != 'cancelled'")
    .bind(id)
    .first();
  if (booking) {
    return Response.json({ error: "That slot has a booking. Cancel the booking first." }, { status: 409 });
  }
  // Remove any cancelled-booking rows (they reference the slot via a foreign key)
  // then delete the slot, atomically.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM bookings WHERE slot_id = ?").bind(id),
    ctx.env.DB.prepare("DELETE FROM slots WHERE id = ?").bind(id)
  ]);
  return Response.json({ ok: true });
}
