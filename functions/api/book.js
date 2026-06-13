// POST /api/book — claim a slot atomically and create a pending booking.
// Body: { slot_id, name, phone, email, children?, child_age?, notes? }

function makeRef() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += "0123456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 33];
  return "OHP-" + s;
}

function clean(v, max) {
  return (v == null ? "" : String(v)).trim().slice(0, max);
}

export async function onRequestPost(ctx) {
  let body;
  try {
    body = await ctx.request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const slotId = Number(body.slot_id);
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 120);

  if (!Number.isInteger(slotId) || slotId <= 0 || !name || !phone || !email) {
    return Response.json({ error: "Please fill in your name, phone, email and pick a slot." }, { status: 400 });
  }
  if (!email.includes("@") || !email.includes(".")) {
    return Response.json({ error: "That email address does not look right." }, { status: 400 });
  }

  const children = body.children ? Math.max(0, Math.min(100, Number(body.children) || 0)) : null;
  const childAge = clean(body.child_age, 40) || null;
  const notes = clean(body.notes, 1000) || null;

  // Atomic claim: the UPDATE only changes a row if the slot is still available,
  // so two simultaneous requests cannot both succeed (no double-booking).
  const claim = await ctx.env.DB
    .prepare("UPDATE slots SET status = 'booked' WHERE id = ? AND status = 'available'")
    .bind(slotId)
    .run();

  if (!claim.success || claim.meta.changes !== 1) {
    return Response.json(
      { error: "Sorry, that slot has just been taken. Please choose another." },
      { status: 409 }
    );
  }

  const ref = makeRef();
  try {
    await ctx.env.DB
      .prepare(
        "INSERT INTO bookings (slot_id, ref, name, phone, email, children, child_age, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
      )
      .bind(slotId, ref, name, phone, email, children, childAge, notes)
      .run();
  } catch (err) {
    // Release the slot if the booking row could not be written.
    await ctx.env.DB
      .prepare("UPDATE slots SET status = 'available' WHERE id = ? AND status = 'booked'")
      .bind(slotId)
      .run();
    return Response.json({ error: "Could not save your booking. Please try again." }, { status: 500 });
  }

  const slot = await ctx.env.DB
    .prepare("SELECT date, start_time, end_time, label FROM slots WHERE id = ?")
    .bind(slotId)
    .first();

  return Response.json({ ok: true, ref, slot });
}
