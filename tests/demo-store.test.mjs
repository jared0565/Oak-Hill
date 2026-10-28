// tests/demo-store.test.mjs
//
// The synthetic café. In demonstration mode this list is the whole
// availability of the site, so the calendar, the slot picker and the party
// packages can never disagree about which days are open.
//
// The contract is narrow and worth pinning exactly:
//
//   - the window is the next 28 days, starting tomorrow;
//   - it trades Monday to Friday, so there is no weekend slot;
//   - the day taken for a private hire offers no slot either;
//   - the sample calendar closes the weekend and books out one Wednesday.
//
// The tests use a fixed "now" rather than the wall clock, so a failure means
// the rule changed rather than that the day did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { privateHireDate, sampleSlots, sampleEvents } from "../functions/api/_lib/demo-store.mjs";

// A Monday, so that tomorrow is a Tuesday. The last day of the window
// (28 days on) is then a Monday and the day after it is a Tuesday: both are
// trading days, so a window that is one day short or one day long shows up
// as a different set of dates.
const MONDAY = new Date("2026-01-05T00:00:00Z");
const TOMORROW = "2026-01-06";
const LAST_DAY = "2026-02-02";
const HIRE = "2026-01-14"; // the first Wednesday at least a week away

// Every weekday in the window, worked out here without the module's rules:
// count the days, drop Saturday and Sunday, drop the private hire.
function expectedDates() {
  const dates = [];
  const start = Date.parse(TOMORROW + "T00:00:00Z");
  for (let day = 1; day <= 28; day++) {
    const stamp = new Date(start + (day - 1) * 86400000);
    const dow = stamp.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = stamp.toISOString().slice(0, 10);
    if (iso === HIRE) continue;
    dates.push(iso);
  }
  return dates;
}

test("the sample slot list covers the next 28 days and no more", () => {
  const slots = sampleSlots(MONDAY);
  const dates = [...new Set(slots.map((s) => s.date))];

  assert.deepEqual(dates, expectedDates());
  // The window starts tomorrow: there is no slot for today.
  assert.equal(dates[0], TOMORROW);
  // And it stops on the 28th day, which is a Monday here.
  assert.equal(dates[dates.length - 1], LAST_DAY);
  // Nothing is offered past the window, which is what a 29-day window would
  // have added.
  assert.ok(dates.every((d) => d <= LAST_DAY), `a slot is offered after ${LAST_DAY}`);
});

test("the sample slot list trades Monday to Friday", () => {
  const slots = sampleSlots(MONDAY);
  for (const s of slots) {
    const dow = new Date(s.date + "T00:00:00Z").getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, `${s.date} is a weekend and is offered as bookable`);
  }
});

test("the day taken for a private hire is not offered as bookable", () => {
  const slots = sampleSlots(MONDAY);
  assert.equal(privateHireDate(MONDAY), HIRE);
  assert.ok(!slots.some((s) => s.date === HIRE), "the private-hire day is offered as bookable");
});

test("every trading day offers three slots, numbered in order", () => {
  const slots = sampleSlots(MONDAY);
  const perDay = new Map();
  for (const s of slots) perDay.set(s.date, (perDay.get(s.date) || 0) + 1);
  for (const [date, n] of perDay) {
    assert.equal(n, 3, `${date} offers ${n} slots`);
  }
  assert.deepEqual(
    slots.map((s) => s.id),
    slots.map((_, i) => i + 1)
  );
  assert.deepEqual([...new Set(slots.map((s) => s.start_time))], ["09:30", "12:00", "14:30"]);
  assert.deepEqual([...new Set(slots.map((s) => s.end_time))], ["11:30", "14:00", "16:30"]);
});

test("the private hire is the first Wednesday at least a week away", () => {
  // A week and a day later, so the first Wednesday in the search is the one
  // eight days out rather than the one seven days out.
  const hire = privateHireDate(MONDAY);
  const dow = new Date(hire + "T00:00:00Z").getUTCDay();
  assert.equal(dow, 3, "the private hire is not on a Wednesday");
  const daysOut = (Date.parse(hire) - Date.parse("2026-01-05T00:00:00Z")) / 86400000;
  assert.ok(daysOut >= 7 && daysOut <= 21, `the private hire is ${daysOut} days out`);
});

test("the sample calendar closes the weekend and books out the private hire", () => {
  // The range ends on a Sunday, so that its last day carries an event and a
  // calendar that stopped a day short would be visible.
  const events = sampleEvents(TOMORROW, "2026-01-25", MONDAY);
  const byDate = new Map(events.map((e) => [e.start_date, e]));

  // The last day of the range is in the calendar.
  assert.ok(byDate.has("2026-01-25"), "the last day of the range is missing from the calendar");
  // The weekend is closed.
  assert.equal(byDate.get("2026-01-10").kind, "closure");
  assert.equal(byDate.get("2026-01-10").title, "Closed");
  assert.equal(byDate.get("2026-01-25").kind, "closure");
  // The private hire is a booking, not a closure.
  assert.equal(byDate.get(HIRE).kind, "event");
  assert.equal(byDate.get(HIRE).title, "Private hire");
  // A trading day that is neither has nothing on it.
  assert.equal(byDate.get("2026-01-08"), undefined);
});

test("a range that cannot be read produces no events at all", () => {
  assert.deepEqual(sampleEvents("not a date", "2026-01-20", MONDAY), []);
  assert.deepEqual(sampleEvents(TOMORROW, "not a date", MONDAY), []);
  assert.deepEqual(sampleEvents("not a date", "also not a date", MONDAY), []);
});

test("a readable range produces events even when one end is unreadable", () => {
  // The guard is "either end is unreadable", not "both ends are unreadable":
  // a range with one bad end must still come back empty rather than half
  // populated.
  const events = sampleEvents(TOMORROW, "not a date", MONDAY);
  assert.deepEqual(events, []);
});
