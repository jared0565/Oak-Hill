// GET /api/slots — public list of bookable (available, future, not-closed) party slots.
export async function onRequestGet(ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, date, start_time, end_time, label FROM slots
     WHERE status = 'available' AND date >= ?
       AND NOT EXISTS (
         SELECT 1 FROM calendar_events c
         WHERE c.kind = 'closure' AND c.start_date <= slots.date AND c.end_date >= slots.date
       )
     ORDER BY date, start_time`
  ).bind(today).all();
  return Response.json({ slots: results }, { headers: { "Cache-Control": "no-store" } });
}
