// /api/admin/bookings — list and act on bookings (auth enforced by _middleware.js).

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    `SELECT b.id, b.ref, b.name, b.phone, b.email, b.children, b.child_age, b.notes, b.status, b.created_at,
            s.date, s.start_time, s.end_time, s.label
     FROM bookings b JOIN slots s ON s.id = b.slot_id
     ORDER BY b.created_at DESC`
  ).all();
  return Response.json({ bookings: results });
}

// POST { id, action: "confirm" | "cancel" }
export async function onRequestPost(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  const action = String(b.action || "");
  if (!Number.isInteger(id) || id <= 0 || !["confirm", "cancel"].includes(action)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const booking = await ctx.env.DB.prepare("SELECT slot_id FROM bookings WHERE id = ?").bind(id).first();
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });

  if (action === "confirm") {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").bind(id),
      ctx.env.DB.prepare("UPDATE slots SET status = 'booked' WHERE id = ?").bind(booking.slot_id)
    ]);
  } else {
    // Cancel releases the slot back to available.
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(id),
      ctx.env.DB.prepare("UPDATE slots SET status = 'available' WHERE id = ?").bind(booking.slot_id)
    ]);
  }
  return Response.json({ ok: true });
}
