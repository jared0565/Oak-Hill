// /api/admin/bookings — list and act on bookings (auth enforced by _middleware.js).
import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";

// Compensating undo for a slot we locked but then couldn't confirm. Guarded on
// 'booked' so it only ever releases a slot this request itself just claimed.
function releaseSlot(ctx, slotId) {
  return ctx.env.DB
    .prepare("UPDATE slots SET status = 'available' WHERE id = ? AND status = 'booked'")
    .bind(slotId)
    .run();
}

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "bookings"); if (deny) return deny;
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
  const deny = requirePermission(ctx, "bookings"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  const action = String(b.action || "");
  if (!Number.isInteger(id) || id <= 0 || !["confirm", "cancel"].includes(action)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const booking = await ctx.env.DB
    .prepare("SELECT slot_id, status FROM bookings WHERE id = ?")
    .bind(id)
    .first();
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });

  if (action === "confirm") {
    if (booking.status === "confirmed") return Response.json({ ok: true }); // already done
    if (booking.status === "cancelled") {
      return Response.json({ error: "That booking was cancelled, so it can't be confirmed." }, { status: 409 });
    }
    // Confirming means the deposit is paid: lock the slot. The conditional UPDATE
    // only succeeds while the slot is still available, so two confirmations on the
    // same slot can't both win (no double-booking).
    const claim = await ctx.env.DB
      .prepare("UPDATE slots SET status = 'booked' WHERE id = ? AND status = 'available'")
      .bind(booking.slot_id)
      .run();
    if (claim.meta.changes !== 1) {
      return Response.json(
        { error: "That slot is already booked by another enquiry. Cancel that booking first to switch." },
        { status: 409 }
      );
    }
    // Slot is locked to us. Confirm THIS booking only if it is still pending: a
    // concurrent decline could have cancelled it after our status read. If the confirm
    // does not land, release the slot we just locked so it can never get stuck 'booked'
    // with no confirmed booking behind it.
    let confChanges = 0;
    try {
      const conf = await ctx.env.DB
        .prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'")
        .bind(id)
        .run();
      confChanges = conf.meta.changes;
    } catch (err) {
      await releaseSlot(ctx, booking.slot_id);
      return Response.json({ error: "Could not confirm that booking. Please try again." }, { status: 500 });
    }
    if (confChanges !== 1) {
      await releaseSlot(ctx, booking.slot_id);
      return Response.json({ error: "That booking was just changed. Refresh and try again." }, { status: 409 });
    }
    // This booking now holds the slot. Declining the other pending holds is best-effort:
    // if it fails they simply stay pending (harmless) and can be declined by hand.
    await ctx.env.DB
      .prepare("UPDATE bookings SET status = 'cancelled' WHERE slot_id = ? AND id <> ? AND status = 'pending'")
      .bind(booking.slot_id, id)
      .run();
    await auditFromCtx(ctx, { action: "booking.confirm", target_type: "booking", target_id: id, detail: "marked paid" });
    return Response.json({ ok: true });
  }

  // action === "cancel". Every transition is status-guarded so a concurrent confirm
  // can't be silently clobbered (the guarded UPDATE just no-ops with changes = 0).
  if (booking.status === "cancelled") return Response.json({ ok: true });
  if (booking.status === "confirmed") {
    // This booking held the slot, so cancelling it frees the slot again.
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").bind(id),
      ctx.env.DB.prepare("UPDATE slots SET status = 'available' WHERE id = ? AND status = 'booked'").bind(booking.slot_id)
    ]);
  } else {
    // A pending hold never locked the slot, so just cancel the booking.
    await ctx.env.DB.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(id).run();
  }
  await auditFromCtx(ctx, { action: "booking.cancel", target_type: "booking", target_id: id });
  return Response.json({ ok: true });
}
