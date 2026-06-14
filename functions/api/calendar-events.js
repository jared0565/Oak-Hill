// GET /api/calendar-events?from=YYYY-MM-DD&to=YYYY-MM-DD
// Public, read-only list of events + closures overlapping [from, to].
// Excludes `notes` (may be private). Forgiving: bad/absent range -> empty list.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
    return Response.json({ events: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  // Cap the window (~14 months) so an absurd range can't force a full-table scan.
  if (to < from || (Date.parse(to) - Date.parse(from)) > 430 * 86400000) {
    return Response.json({ events: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, kind, title, start_date, end_date, all_day, start_time, end_time
     FROM calendar_events
     WHERE end_date >= ? AND start_date <= ?
     ORDER BY start_date, start_time`
  ).bind(from, to).all();
  return Response.json({ events: results }, { headers: { "Cache-Control": "no-store" } });
}
