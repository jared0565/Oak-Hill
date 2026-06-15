// /api/admin/overview — read-only dashboard summary for the Overview home page.
// Auth (a valid session) is enforced by admin/_middleware.js, which attaches ctx.data.user.
// This endpoint adds NO new permission of its own: each block is gated by the matching
// section permission via can(role, perm), so the response only ever contains numbers the
// caller is already allowed to see elsewhere. Each query is wrapped so one failure can't
// 500 the whole endpoint — an included-but-failed field defaults to 0 (a forbidden field is
// omitted entirely, which is a different outcome from 0).
import { can } from "../_lib/auth-core.mjs";

async function safeFirst(stmt, field, fallback = 0) {
  try {
    const row = await stmt.first();
    const v = row ? row[field] : null;
    return Number.isFinite(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

export async function onRequestGet(ctx) {
  const db = ctx.env.DB;
  const role = (ctx.data && ctx.data.user && ctx.data.user.role) || null;
  const out = {};

  // Pending bookings + latest 5 (ref, date, name, status). Permission: bookings.
  if (can(role, "bookings")) {
    const pending = await safeFirst(
      db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"),
      "n"
    );
    let recent = [];
    try {
      const { results } = await db.prepare(
        `SELECT b.ref, b.name, b.status, s.date
         FROM bookings b JOIN slots s ON s.id = b.slot_id
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT 5`
      ).all();
      recent = (results || []).map((r) => ({ ref: r.ref, date: r.date, name: r.name, status: r.status }));
    } catch (_) { recent = []; }
    out.bookings = { pending, recent };
  }

  // Unread messages = enquiries still in the default 'new' status. Permission: messages.
  if (can(role, "messages")) {
    const unread = await safeFirst(
      db.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'"),
      "n"
    );
    out.messages = { unread };
  }

  // Open slots in the next 14 days = bookable slots (available, future, not inside a
  // closure) — mirrors the public /api/slots definition. Pending holds are soft, so a
  // slot stays 'available' until a booking is confirmed (which flips it to 'booked').
  // Permission: availability.
  if (can(role, "availability")) {
    const openSlots14d = await safeFirst(
      db.prepare(
        `SELECT COUNT(*) AS n FROM slots
         WHERE status = 'available'
           AND date >= date('now')
           AND date <= date('now', '+14 days')
           AND NOT EXISTS (
             SELECT 1 FROM calendar_events c
             WHERE c.kind = 'closure' AND c.start_date <= slots.date AND c.end_date >= slots.date
           )`
      ),
      "n"
    );
    out.availability = { openSlots14d };
  }

  // Visits over the last 7 days = page_view analytics events. Permission: reports.
  if (can(role, "reports")) {
    const visits7d = await safeFirst(
      db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name = 'page_view' AND ts >= datetime('now', '-7 days')"),
      "n"
    );
    out.reports = { visits7d };
  }

  return Response.json(out);
}
