// functions/api/_lib/availability-core.mjs
// Pure helpers for availability management. No Workers globals — unit-testable with `node --test`.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function clean(v, max) {
  return (v == null ? "" : String(v)).trim().slice(0, max);
}

// Iterate dates start..end inclusive in UTC, calling fn(iso, weekday) where weekday is 0=Sun..6=Sat.
function eachDate(startDate, endDate, fn) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (cur <= end) {
    const d = new Date(cur);
    fn(d.toISOString().slice(0, 10), d.getUTCDay());
    cur += 86400000;
  }
}

export function normalizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) return [];
  const set = new Set();
  for (const w of weekdays) {
    const n = Number(w);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return [...set];
}

export function parseTimes(times) {
  if (!Array.isArray(times)) return [];
  return times.map((t) => ({
    start: clean(t?.start, 5),
    end: clean(t?.end, 5),
    label: clean(t?.label, 60) || "Party slot",
  }));
}

// Expand a recurrence into concrete slot rows. `today` (YYYY-MM-DD) is injected for testability.
export function expandRecurrence({ start_date, end_date, weekdays, times } = {}, today) {
  if (!DATE_RE.test(start_date || "") || !DATE_RE.test(end_date || "")) {
    throw new Error("Need a start and end date (YYYY-MM-DD).");
  }
  if (end_date < start_date) throw new Error("End date must be on or after the start date.");
  const days = new Set(normalizeWeekdays(weekdays));
  if (!days.size) throw new Error("Pick at least one weekday.");
  const slots = parseTimes(times);
  if (!slots.length) throw new Error("Add at least one time.");
  for (const s of slots) {
    if (!TIME_RE.test(s.start) || !TIME_RE.test(s.end)) throw new Error("Times must be HH:MM.");
    if (s.end <= s.start) throw new Error("Each end time must be after its start time.");
  }
  const out = [];
  eachDate(start_date, end_date, (iso, wd) => {
    if (today && iso < today) return;
    if (!days.has(wd)) return;
    for (const s of slots) {
      out.push({ date: iso, start_time: s.start, end_time: s.end, label: s.label });
      if (out.length > 500) throw new Error("That range would create too many slots (max 500). Narrow it down.");
    }
  });
  return out;
}
