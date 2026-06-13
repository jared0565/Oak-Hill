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

  // Soft hold: an enquiry creates a 'pending' booking but does NOT lock the slot.
  // The slot only becomes unavailable when the owner confirms payment
  // (see /api/admin/bookings). Until then it stays open so others can still enquire,
  // and the owner takes whoever pays the deposit first.
  const slot = await ctx.env.DB
    .prepare("SELECT id, date, start_time, end_time, label, status FROM slots WHERE id = ?")
    .bind(slotId)
    .first();

  if (!slot) {
    return Response.json({ error: "That slot is no longer listed. Please choose another." }, { status: 404 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (slot.date < today) {
    return Response.json({ error: "That date has passed. Please choose another slot." }, { status: 409 });
  }
  if (slot.status !== "available") {
    return Response.json(
      { error: "Sorry, that slot has just been booked. Please choose another." },
      { status: 409 }
    );
  }

  const ref = makeRef();
  let insert;
  try {
    // Conditional insert: the row is only written while the slot is still available, so
    // if the owner confirms a competing booking between the check above and here, the
    // customer gets an honest "just booked" 409 instead of a false hold.
    insert = await ctx.env.DB
      .prepare(
        `INSERT INTO bookings (slot_id, ref, name, phone, email, children, child_age, notes, status)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'pending'
         WHERE EXISTS (SELECT 1 FROM slots WHERE id = ? AND status = 'available')`
      )
      .bind(slotId, ref, name, phone, email, children, childAge, notes, slotId)
      .run();
  } catch (err) {
    return Response.json({ error: "Could not save your booking. Please try again." }, { status: 500 });
  }
  if (insert.meta.changes !== 1) {
    return Response.json(
      { error: "Sorry, that slot has just been booked. Please choose another." },
      { status: 409 }
    );
  }

  return Response.json({ ok: true, ref, slot });
}
