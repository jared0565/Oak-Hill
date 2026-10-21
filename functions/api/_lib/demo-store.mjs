// functions/api/_lib/demo-store.mjs
// The demonstration's isolated slot store.
//
// In demo mode the public calendar and the booking flow must work on a machine
// that has never run a migration and must never write a reservation. This
// module provides that: a synthetic, deterministic list of slots generated from
// today's date, used whenever the local database has no slots of its own.
//
// Nothing here touches the database. The one exception is listDemoSlots, which
// *reads* slots the owner has added through the admin console, so the demo
// reflects the owner's own setup when there is one.

const LABELS = [
  "Weekday party",
  "Weekend party",
  "Soft play party",
  "Cake ceremony",
];

// A Monday in, Monday out, 9.30am to 4.30pm week; 10am to 5pm at the weekend.
function timesFor(dayOfWeek) {
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [
      ["10:00", "12:00"],
      ["12:30", "14:30"],
      ["15:00", "17:00"],
    ];
  }
  return [
    ["09:30", "11:30"],
    ["12:00", "14:00"],
    ["14:30", "16:30"],
  ];
}

// The synthetic list: the next 28 days, closed on Mondays.
export function sampleSlots(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const slots = [];
  for (let day = 1; day <= 28; day++) {
    const stamp = new Date(today + day * 86400000);
    const dow = stamp.getUTCDay();
    if (dow === 1) continue;
    for (const [start_time, end_time] of timesFor(dow)) {
      slots.push({
        id: slots.length + 1,
        date: stamp.toISOString().slice(0, 10),
        start_time,
        end_time,
        label: LABELS[slots.length % LABELS.length],
      });
    }
  }
  return slots;
}

// Sample calendar entries so the public calendar shows its states: a closure
// and a booked-out event. Purely synthetic.
export function sampleEvents(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const events = [];
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return events;

  for (let stamp = start.getTime(); stamp <= end.getTime(); stamp += 86400000) {
    const d = new Date(stamp);
    const dow = d.getUTCDay();
    if (dow === 1) {
      events.push({
        id: events.length + 1,
        kind: "closure",
        title: "Closed",
        start_date: d.toISOString().slice(0, 10),
        end_date: d.toISOString().slice(0, 10),
        all_day: 1,
        start_time: null,
        end_time: null,
      });
    } else if (dow === 4) {
      events.push({
        id: events.length + 1,
        kind: "event",
        title: "Private hire",
        start_date: d.toISOString().slice(0, 10),
        end_date: d.toISOString().slice(0, 10),
        all_day: 1,
        start_time: null,
        end_time: null,
      });
    }
  }
  return events;
}

// Slots for the public calendar. Prefers slots the owner has added to the
// local database; falls back to the synthetic list when there are none, so the
// demonstration works with no setup at all.
export async function listDemoSlots(env) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      `SELECT id, date, start_time, end_time, label FROM slots
       WHERE status = 'available' AND date >= ?
         AND NOT EXISTS (
           SELECT 1 FROM calendar_events c
           WHERE c.kind = 'closure' AND c.start_date <= slots.date AND c.end_date >= slots.date
         )
       ORDER BY date, start_time`
    ).bind(today).all();
    if (results && results.length) return { slots: results, source: "database" };
  } catch (e) {
    /* No database in this environment — the sample list stands in for it. */
  }
  return { slots: sampleSlots(), source: "sample" };
}
