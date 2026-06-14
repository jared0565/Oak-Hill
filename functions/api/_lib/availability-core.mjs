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

export function isDateClosed(date, closures) {
  if (!Array.isArray(closures)) return false;
  return closures.some((c) => c && c.start_date <= date && c.end_date >= date);
}

export function validateCalendarEvent(body) {
  const kind = body?.kind === "closure" ? "closure" : "event";
  const title = clean(body?.title, 120);
  const start_date = clean(body?.start_date, 10);
  const end_date = clean(body?.end_date, 10) || start_date;
  if (!title) return { ok: false, error: "Give it a title." };
  if (!DATE_RE.test(start_date)) return { ok: false, error: "Start date must be YYYY-MM-DD." };
  if (!DATE_RE.test(end_date)) return { ok: false, error: "End date must be YYYY-MM-DD." };
  if (end_date < start_date) return { ok: false, error: "End date must be on or after the start date." };
  const allDayReq = body?.all_day === 0 || body?.all_day === false ? 0 : 1;
  let start_time = null, end_time = null, all_day = allDayReq;
  if (kind === "closure") {
    all_day = 1;                       // closures are always day-level
  } else if (!allDayReq) {
    start_time = clean(body?.start_time, 5);
    end_time = clean(body?.end_time, 5);
    if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) return { ok: false, error: "Times must be HH:MM." };
    if (end_time <= start_time) return { ok: false, error: "End time must be after the start time." };
  }
  return { ok: true, value: { kind, title, start_date, end_date, all_day, start_time, end_time, notes: clean(body?.notes, 1000) || null } };
}

export function validateSlotEdit(body) {
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Missing slot id." };
  const out = { id };
  if (body?.label != null) out.label = clean(body.label, 60) || "Party slot";
  if (body?.start_time != null || body?.end_time != null) {
    const start = clean(body?.start_time, 5);
    const end = clean(body?.end_time, 5);
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { ok: false, error: "Times must be HH:MM." };
    if (end <= start) return { ok: false, error: "End time must be after the start time." };
    out.start_time = start; out.end_time = end;
  }
  if (body?.status != null) {
    const status = clean(body.status, 20);
    if (!["available", "closed"].includes(status)) return { ok: false, error: "Status must be available or closed." };
    out.status = status;
  }
  if (out.label === undefined && out.start_time === undefined && out.status === undefined) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, value: out };
}
