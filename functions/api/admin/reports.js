// /api/admin/reports?days=N — aggregate analytics + conversions (auth via _middleware.js).
import { sanitizeDays } from "../_lib/analytics-core.mjs";
import { requirePermission } from "../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "reports"); if (deny) return deny;
  const days = sanitizeDays(new URL(ctx.request.url).searchParams.get("days"));
  const cutoff = "-" + days + " days";
  const db = ctx.env.DB;
  const [visits, slotSel, topPages, topSources, enquiries, bookings, leads] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name='slot_selected' AND ts >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT path, COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?) GROUP BY path ORDER BY n DESC LIMIT 8").bind(cutoff).all(),
    db.prepare("SELECT source, COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?) GROUP BY source ORDER BY n DESC LIMIT 8").bind(cutoff).all(),
    db.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT status, COUNT(*) AS n FROM bookings WHERE created_at >= datetime('now', ?) GROUP BY status").bind(cutoff).all(),
    db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE marketing_opt_in = 1 AND marketing_opt_in_at >= datetime('now', ?)").bind(cutoff).first(),
  ]);
  const b = { pending: 0, confirmed: 0, cancelled: 0 };
  for (const row of bookings.results) if (Object.prototype.hasOwnProperty.call(b, row.status)) b[row.status] = row.n;
  return Response.json({
    days,
    visits: visits.n, slotSelected: slotSel.n,
    topPages: topPages.results, topSources: topSources.results,
    enquiries: enquiries.n, leads: leads.n, bookings: b,
  });
}
