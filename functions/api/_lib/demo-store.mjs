// The demonstration's isolated slot store.
//
// In demo mode the public calendar and the booking flow must work on a machine
// that has never run a migration and must never write a reservation. This
// module provides that: a synthetic, deterministic café generated from
// today's date.
//
// One rule generates the whole café: **it trades Monday to Friday, and is
// closed at the weekend.** Everything below follows from that single fact, so
// the calendar, the slot picker and the party packages can never disagree:
//
//   - slots        : trading days only, four weeks ahead, three a day
//   - closures     : Saturday and Sunday
//   - private hire : one Wednesday, so a booked-out day is visible too
//
// The slots deliberately exclude the private-hire day. A day that is marked
// "Private hire" must not also offer a slot, and a day that is marked "Closed"
// must not be bookable at all — that contradiction is what the earlier
// database-backed list produced, where the database's own Mondays were
// offered as bookable while the calendar called every Monday closed.
//
// Demo mode always shows this synthetic café. Slots the owner has added
// through the console belong to the live build, and the console is where they
// are visible; mixing a real café's rows into a fictional café's calendar is
// how the two came to contradict each other on screen.

const LABELS = [
  "Weekday party",
  "Cake ceremony",
  "Soft play party",
  "Afternoon party",
];

// The café's trading day: three party slots, 9.30am to 4.30pm.
function timesFor() {
  return [
    ["09:30", "11:30"],
    ["12:00", "14:00"],
    ["14:30", "16:30"],
  ];
}

const isWeekend = (dow) => dow === 0 || dow === 6;
const midnightUTC = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

// The day taken for a private hire: the first Wednesday at least a week away.
// Deterministic, so the same café is generated for everyone on the same day.
export function privateHireDate(now = new Date()) {
  const today = midnightUTC(now);
  for (let add = 7; add <= 21; add++) {
    const stamp = new Date(today + add * 86400000);
    if (stamp.getUTCDay() === 3) return stamp.toISOString().slice(0, 10);
  }
  return null;
}

// The synthetic list: the next 28 days, on trading days only.
export function sampleSlots(now = new Date()) {
  const today = midnightUTC(now);
  const hire = privateHireDate(now);
  const slots = [];
  for (let day = 1;  day <= 28; day++) {
    const stamp =  new Date(today + day * 86400000);
    if (isWeekend(stamp.getUTCDay())) continue;
    const date = stamp.toISOString().slice(0, 10);
    if (date === hire) continue; // that day is a private hire
    for (const [start_time, end_time] of timesFor()) {
      slots.push({
        id: slots.length + 1,
        date,
        start_time,
        end_time,
        label: LABELS[slots.length % LABELS.length],
      });
    }
  }
  return slots;
}

// Sample calendar entries so the public calendar shows its states: a closure
// at the weekend and a booked-out day mid-week. Purely synthetic.
//
// `now` is the same clock the slot list uses, so the two can never disagree
// about which day is taken for a private hire.
export function sampleEvents(from, to, now = new Date()) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const events = [];
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))  return events;
  const hire = privateHireDate(now);
  for (let stamp = start.getTime();  stamp <= end.getTime(); stamp += 86400000) {
    const d = new Date(stamp);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (isWeekend(dow)) {
      events.push({
        id: events.length + 1,
        kind: "closure",
        title: "Closed",
        start_date: date,
        end_date: date,
        all_day: 1,
        start_time: null,
        end_time: null,
      });
    } else if (date === hire) {
      events.push({
        id: events.length + 1,
        kind: "event",
        title: "Private hire",
        start_date: date,
        end_date: date,
        all_day: 1,
        start_time: null,
        end_time: null,
      });
    }
  }
  return events;
}

// Slots for the public calendar. In demonstration mode these are always the
// synthetic list above, so the calendar, the picker and the copy all describe
// the same café. A live build reads the owner's own rows from the database.
export function listDemoSlots() {
  return { slots: sampleSlots(), source: "sample" };
}
