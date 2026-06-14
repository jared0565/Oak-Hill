// tests/availability-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandRecurrence } from "../functions/api/_lib/availability-core.mjs";

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
