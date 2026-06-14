// tests/availability-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRecurrence, isDateClosed, validateCalendarEvent, validateSlotEdit } from "../functions/api/_lib/availability-core.mjs";

test("expandRecurrence: one weekday, one time, inside range", () => {
  // 2026-06-15 is a Monday. weekday 1 = Monday.
  const rows = expandRecurrence(
    { start_date: "2026-06-15", end_date: "2026-06-22", weekdays: [1], times: [{ start: "10:00", end: "12:00", label: "AM" }] },
    "2026-01-01"
  );
  assert.deepEqual(rows, [
    { date: "2026-06-15", start_time: "10:00", end_time: "12:00", label: "AM" },
    { date: "2026-06-22", start_time: "10:00", end_time: "12:00", label: "AM" },
  ]);
});

test("expandRecurrence: multiple times per matching day", () => {
  const rows = expandRecurrence(
    { start_date: "2026-06-15", end_date: "2026-06-15", weekdays: [1], times: [
      { start: "10:00", end: "12:00", label: "AM" }, { start: "13:00", end: "15:00", label: "PM" }] },
    "2026-01-01"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].label, "PM");
});

test("expandRecurrence: skips dates before today", () => {
  const rows = expandRecurrence(
    { start_date: "2026-06-15", end_date: "2026-06-22", weekdays: [1], times: [{ start: "10:00", end: "12:00" }] },
    "2026-06-20"
  );
  assert.deepEqual(rows.map(r => r.date), ["2026-06-22"]);
});

test("expandRecurrence: default label when omitted", () => {
  const rows = expandRecurrence(
    { start_date: "2026-06-15", end_date: "2026-06-15", weekdays: [1], times: [{ start: "10:00", end: "12:00" }] },
    "2026-01-01"
  );
  assert.equal(rows[0].label, "Party slot");
});

test("expandRecurrence: throws on bad input", () => {
  assert.throws(() => expandRecurrence({ start_date: "x", end_date: "2026-06-15", weekdays: [1], times: [{ start: "10:00", end: "12:00" }] }, "2026-01-01"));
  assert.throws(() => expandRecurrence({ start_date: "2026-06-16", end_date: "2026-06-15", weekdays: [1], times: [{ start: "10:00", end: "12:00" }] }, "2026-01-01"));
  assert.throws(() => expandRecurrence({ start_date: "2026-06-15", end_date: "2026-06-15", weekdays: [], times: [{ start: "10:00", end: "12:00" }] }, "2026-01-01"));
  assert.throws(() => expandRecurrence({ start_date: "2026-06-15", end_date: "2026-06-15", weekdays: [1], times: [] }, "2026-01-01"));
  assert.throws(() => expandRecurrence({ start_date: "2026-06-15", end_date: "2026-06-15", weekdays: [1], times: [{ start: "12:00", end: "10:00" }] }, "2026-01-01"));
});

test("expandRecurrence: rejects oversized ranges (>500)", () => {
  assert.throws(() => expandRecurrence(
    { start_date: "2026-01-01", end_date: "2027-12-31", weekdays: [0,1,2,3,4,5,6], times: [{ start: "10:00", end: "12:00" }] },
    "2026-01-01"
  ), /too many slots/);
});

test("isDateClosed: inside, boundaries, outside, none", () => {
  const closures = [{ start_date: "2026-06-10", end_date: "2026-06-12" }];
  assert.equal(isDateClosed("2026-06-11", closures), true);
  assert.equal(isDateClosed("2026-06-10", closures), true);   // start boundary
  assert.equal(isDateClosed("2026-06-12", closures), true);   // end boundary
  assert.equal(isDateClosed("2026-06-13", closures), false);
  assert.equal(isDateClosed("2026-06-11", []), false);
  assert.equal(isDateClosed("2026-06-11", undefined), false);
});

test("validateCalendarEvent: valid closure defaults end_date and forces all_day", () => {
  const v = validateCalendarEvent({ kind: "closure", title: "Bank holiday", start_date: "2026-08-31" });
  assert.equal(v.ok, true);
  assert.equal(v.value.kind, "closure");
  assert.equal(v.value.end_date, "2026-08-31");
  assert.equal(v.value.all_day, 1);
});

test("validateCalendarEvent: timed event keeps times", () => {
  const v = validateCalendarEvent({ kind: "event", title: "Live music", start_date: "2026-07-01", all_day: 0, start_time: "18:00", end_time: "20:00" });
  assert.equal(v.ok, true);
  assert.equal(v.value.start_time, "18:00");
});

test("validateCalendarEvent: rejects bad data", () => {
  assert.equal(validateCalendarEvent({ kind: "event", title: "", start_date: "2026-07-01" }).ok, false);
  assert.equal(validateCalendarEvent({ kind: "event", title: "x", start_date: "nope" }).ok, false);
  assert.equal(validateCalendarEvent({ kind: "event", title: "x", start_date: "2026-07-02", end_date: "2026-07-01" }).ok, false);
  assert.equal(validateCalendarEvent({ kind: "event", title: "x", start_date: "2026-07-01", all_day: 0, start_time: "20:00", end_time: "18:00" }).ok, false);
});

test("validateSlotEdit: label only, times pair, status whitelist, nothing-to-update", () => {
  assert.deepEqual(validateSlotEdit({ id: 5, label: "VIP" }).value, { id: 5, label: "VIP" });
  const t = validateSlotEdit({ id: 5, start_time: "10:00", end_time: "12:00" });
  assert.deepEqual(t.value, { id: 5, start_time: "10:00", end_time: "12:00" });
  assert.equal(validateSlotEdit({ id: 5, status: "booked" }).ok, false);   // not a settable status
  assert.equal(validateSlotEdit({ id: 5, status: "closed" }).ok, true);
  assert.equal(validateSlotEdit({ id: 0 }).ok, false);
  assert.equal(validateSlotEdit({ id: 5 }).ok, false);                     // nothing to update
  assert.equal(validateSlotEdit({ id: 5, start_time: "12:00", end_time: "10:00" }).ok, false);
});
