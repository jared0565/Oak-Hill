// /api/admin/slots — owner slot management (auth enforced by _middleware.js).
import { expandRecurrence, validateSlotEdit } from "../_lib/availability-core.mjs";

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

  // Bulk/recurring add.
  if (b && b.recurrence) {
    let rows;
    try {
      rows = expandRecurrence(b.recurrence, new Date().toISOString().slice(0, 10));
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (!rows.length) return Response.json({ ok: true, added: 0, skipped: 0 });
    let minD = rows[0].date, maxD = rows[0].date;
    for (const r of rows) { if (r.date < minD) minD = r.date; if (r.date > maxD) maxD = r.date; }
    const { results: existing } = await ctx.env.DB
      .prepare("SELECT date, start_time, end_time FROM slots WHERE date >= ? AND date <= ?")
      .bind(minD, maxD).all();
    const seen = new Set(existing.map((e) => `${e.date}|${e.start_time}|${e.end_time}`));
    const toInsert = rows.filter((r) => !seen.has(`${r.date}|${r.start_time}|${r.end_time}`));
    if (toInsert.length) {
      await ctx.env.DB.batch(
        toInsert.map((r) =>
          ctx.env.DB.prepare("INSERT INTO slots (date, start_time, end_time, label, status) VALUES (?, ?, ?, ?, 'available')")
            .bind(r.date, r.start_time, r.end_time, r.label))
      );
    }
    return Response.json({ ok: true, added: toInsert.length, skipped: rows.length - toInsert.length });
  }

  // Single slot.
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

export async function onRequestPut(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const v = validateSlotEdit(b);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const upd = v.value;

  const slot = await ctx.env.DB.prepare("SELECT status FROM slots WHERE id = ?").bind(upd.id).first();
  if (!slot) return Response.json({ error: "Slot not found." }, { status: 404 });

  // Time/status changes are unsafe on a slot with a confirmed booking.
  const changesTimeOrStatus = upd.start_time !== undefined || upd.status !== undefined;
  if (changesTimeOrStatus && slot.status === "booked") {
    return Response.json({ error: "That slot has a confirmed booking. Cancel it first to change the time or status." }, { status: 409 });
  }

  const sets = [], binds = [];
  if (upd.label !== undefined) { sets.push("label = ?"); binds.push(upd.label); }
  if (upd.start_time !== undefined) { sets.push("start_time = ?", "end_time = ?"); binds.push(upd.start_time, upd.end_time); }
  if (upd.status !== undefined) { sets.push("status = ?"); binds.push(upd.status); }
  binds.push(upd.id);
  const r = await ctx.env.DB.prepare(`UPDATE slots SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Could not update the slot." }, { status: 409 });
  return Response.json({ ok: true });
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
