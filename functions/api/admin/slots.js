// /api/admin/slots — owner slot management (auth enforced by _middleware.js).

export async function onRequestGet(ctx) {
  // `holds` = number of pending enquiries on a slot (soft holds awaiting a deposit).
  // The slot is still available to book until one of those holds is confirmed (paid).
  const { results } = await ctx.env.DB.prepare(
    `SELECT s.id, s.date, s.start_time, s.end_time, s.label, s.status,
            SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS holds
     FROM slots s
     LEFT JOIN bookings b ON b.slot_id = s.id
     GROUP BY s.id
     ORDER BY s.date, s.start_time`
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
  // Friendly pre-check for the common case.
  const booking = await ctx.env.DB
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'")
    .bind(id)
    .first();
  if (booking) {
    return Response.json({ error: "That slot has a confirmed booking. Cancel the booking first." }, { status: 409 });
  }
  // The delete itself must be race-safe against a confirm that lands after that check.
  // We only ever delete pending/cancelled booking rows (never a confirmed one), and the
  // slot delete is guarded so it does nothing if a confirmed booking has appeared — which
  // keeps the foreign key intact. Both run in one batch so they commit together.
  const [, slotDel] = await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM bookings WHERE slot_id = ? AND status IN ('pending', 'cancelled')").bind(id),
    ctx.env.DB
      .prepare("DELETE FROM slots WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id = ? AND status = 'confirmed')")
      .bind(id, id)
  ]);
  if (slotDel.meta.changes !== 1) {
    return Response.json({ error: "That slot just got a confirmed booking, so it was not deleted." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
