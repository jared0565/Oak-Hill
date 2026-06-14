# A1 — Availability Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a month-grid dashboard to manage bookable party slots (single, bulk/recurring, edit, status) plus events and closures, where a closure automatically stops that day's slots being bookable.

**Architecture:** Cloudflare Pages Functions (ESM) over D1. Pure, framework-free logic lives in `functions/api/_lib/availability-core.mjs` and is unit-tested with `node --test`; the D1-touching endpoints import those helpers and are verified on a real deploy (project convention). A new `calendar_events` table holds events + closures; the closure→booking rule is computed at query time. The dashboard UI is vanilla DOM (`createElement`/`textContent` only — no `innerHTML`, to stay inside the strict CSP).

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), wrangler 4.x, `node --test`, vanilla JS/CSS.

**Spec:** `docs/superpowers/specs/2026-06-14-a1-availability-management-design.md`

**Conventions to follow (from the existing codebase):**
- Endpoints are ESM with `onRequestGet/Post/Put/Delete(ctx)`, returning `Response.json(...)`.
- `/api/admin/*` is already protected by `functions/api/admin/_middleware.js` (Bearer `ADMIN_TOKEN`) — **no auth code in handlers**.
- Validation is server-side with simple regexes (`^\d{4}-\d{2}-\d{2}$`, `^\d{2}:\d{2}$`).
- Race-safe writes use conditional SQL + checking `meta.changes`.
- Admin client reads the token from `sessionStorage["ohpc-admin-token"]`.

---

### Task 1: Migration — `calendar_events` table

**Files:**
- Create: `migrations/0003_calendar_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0003: general calendar events and closures.
-- A 'closure' row blocks bookings for every date it covers (see /api/slots, /api/book).
CREATE TABLE IF NOT EXISTS calendar_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'event',   -- 'event' | 'closure'
  title      TEXT NOT NULL,
  start_date TEXT NOT NULL,                    -- YYYY-MM-DD
  end_date   TEXT NOT NULL,                    -- YYYY-MM-DD (== start_date for one day)
  all_day    INTEGER NOT NULL DEFAULT 1,       -- 1 = all day; 0 = timed (events only)
  start_time TEXT,                             -- HH:MM when all_day = 0
  end_time   TEXT,                             -- HH:MM when all_day = 0
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calevents_dates ON calendar_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calevents_kind  ON calendar_events(kind);
```

- [ ] **Step 2: Apply locally to verify it parses**

Run: `npx wrangler d1 migrations apply oak-hill-bookings --local`
Expected: reports applying `0003_calendar_events.sql` with no SQL error.

- [ ] **Step 3: Commit**

```bash
git add migrations/0003_calendar_events.sql
git commit -m "Add calendar_events table (events + closures)"
```

---

### Task 2: CI — apply D1 migrations on deploy

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add a migrations step before the deploy step**

Insert this step immediately **before** the existing "Deploy to Cloudflare Pages" step (after `actions/checkout@v4`):

```yaml
      - name: Apply D1 migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          wranglerVersion: "4.100.0"
          command: d1 migrations apply oak-hill-bookings --remote
```

(The token is already scoped for D1: Edit. Migrations use `CREATE TABLE IF NOT EXISTS`, so this is idempotent even if `0001`/`0002` were first applied by hand.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "Apply D1 migrations in CI before deploy"
```

---

### Task 3: Pure helper — `expandRecurrence`

**Files:**
- Create: `functions/api/_lib/availability-core.mjs`
- Test: `tests/availability-core.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/availability-core.test.mjs`
Expected: FAIL — `expandRecurrence` not exported / module missing.

- [ ] **Step 3: Implement the helper**

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/availability-core.test.mjs`
Expected: PASS (all `expandRecurrence` tests).

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/availability-core.mjs tests/availability-core.test.mjs
git commit -m "Add expandRecurrence helper with tests"
```

---

### Task 4: Pure helper — `isDateClosed`

**Files:**
- Modify: `functions/api/_lib/availability-core.mjs`
- Modify: `tests/availability-core.test.mjs`

- [ ] **Step 1: Add the failing test**

```js
import { isDateClosed } from "../functions/api/_lib/availability-core.mjs";

test("isDateClosed: inside, boundaries, outside, none", () => {
  const closures = [{ start_date: "2026-06-10", end_date: "2026-06-12" }];
  assert.equal(isDateClosed("2026-06-11", closures), true);
  assert.equal(isDateClosed("2026-06-10", closures), true);   // start boundary
  assert.equal(isDateClosed("2026-06-12", closures), true);   // end boundary
  assert.equal(isDateClosed("2026-06-13", closures), false);
  assert.equal(isDateClosed("2026-06-11", []), false);
  assert.equal(isDateClosed("2026-06-11", undefined), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/availability-core.test.mjs`
Expected: FAIL — `isDateClosed` not exported.

- [ ] **Step 3: Implement**

Append to `functions/api/_lib/availability-core.mjs`:

```js
export function isDateClosed(date, closures) {
  if (!Array.isArray(closures)) return false;
  return closures.some((c) => c && c.start_date <= date && c.end_date >= date);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/availability-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/availability-core.mjs tests/availability-core.test.mjs
git commit -m "Add isDateClosed helper with tests"
```

---

### Task 5: Pure helpers — `validateCalendarEvent` and `validateSlotEdit`

**Files:**
- Modify: `functions/api/_lib/availability-core.mjs`
- Modify: `tests/availability-core.test.mjs`

- [ ] **Step 1: Add the failing tests**

```js
import { validateCalendarEvent, validateSlotEdit } from "../functions/api/_lib/availability-core.mjs";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/availability-core.test.mjs`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `functions/api/_lib/availability-core.mjs`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/availability-core.test.mjs`
Expected: PASS (all tests across Tasks 3–5).

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/availability-core.mjs tests/availability-core.test.mjs
git commit -m "Add calendar-event and slot-edit validators with tests"
```

---

### Task 6: Closure rule on public `/api/slots` and `/api/book`

**Files:**
- Modify: `functions/api/slots.js`
- Modify: `functions/api/book.js:44-61`

- [ ] **Step 1: Add closure suppression to the public slots query**

Replace the body of `functions/api/slots.js` with:

```js
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
```

- [ ] **Step 2: Add a closure guard to `/api/book`**

In `functions/api/book.js`, immediately **after** the existing past-date check (`if (slot.date < today) { ... }`, around line 55) and **before** the `if (slot.status !== "available")` check, insert:

```js
  const closed = await ctx.env.DB
    .prepare("SELECT 1 FROM calendar_events WHERE kind = 'closure' AND start_date <= ? AND end_date >= ? LIMIT 1")
    .bind(slot.date, slot.date)
    .first();
  if (closed) {
    return Response.json({ error: "Sorry, that date is now closed. Please choose another." }, { status: 409 });
  }
```

- [ ] **Step 3: Local syntax check**

Run: `node --check functions/api/slots.js && node --check functions/api/book.js`
Expected: no output (both parse).

- [ ] **Step 4: Commit**

```bash
git add functions/api/slots.js functions/api/book.js
git commit -m "Suppress bookings on closed dates (public slots + book)"
```

---

### Task 7: Admin CRUD — `calendar-events.js`

**Files:**
- Create: `functions/api/admin/calendar-events.js`

- [ ] **Step 1: Write the endpoint**

```js
// /api/admin/calendar-events — owner CRUD for events + closures (auth via _middleware.js).
import { validateCalendarEvent } from "../_lib/availability-core.mjs";

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let sql = "SELECT id, kind, title, start_date, end_date, all_day, start_time, end_time, notes FROM calendar_events";
  const binds = [];
  if (from && to) { sql += " WHERE end_date >= ? AND start_date <= ?"; binds.push(from, to); }
  sql += " ORDER BY start_date, start_time";
  const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return Response.json({ events: results });
}

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const v = validateCalendarEvent(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const e = v.value;
  const r = await ctx.env.DB
    .prepare(`INSERT INTO calendar_events (kind, title, start_date, end_date, all_day, start_time, end_time, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(e.kind, e.title, e.start_date, e.end_date, e.all_day, e.start_time, e.end_time, e.notes)
    .run();
  return Response.json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestPut(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const v = validateCalendarEvent(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const e = v.value;
  const r = await ctx.env.DB
    .prepare(`UPDATE calendar_events SET kind=?, title=?, start_date=?, end_date=?, all_day=?, start_time=?, end_time=?, notes=? WHERE id=?`)
    .bind(e.kind, e.title, e.start_date, e.end_date, e.all_day, e.start_time, e.end_time, e.notes, id)
    .run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const r = await ctx.env.DB.prepare("DELETE FROM calendar_events WHERE id=?").bind(id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Local syntax check**

Run: `node --check functions/api/admin/calendar-events.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add functions/api/admin/calendar-events.js
git commit -m "Add admin calendar-events CRUD endpoint"
```

---

### Task 8: Admin slots — bulk recurrence (POST) + edit (PUT)

**Files:**
- Modify: `functions/api/admin/slots.js`

- [ ] **Step 1: Replace the file with the extended version**

Keep `onRequestGet` and `onRequestDelete` exactly as they are today; add the import, branch `onRequestPost` on `recurrence`, and add `onRequestPut`. Full file:

```js
// /api/admin/slots — owner slot management (auth enforced by _middleware.js).
import { expandRecurrence, validateSlotEdit } from "../_lib/availability-core.mjs";

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    `SELECT s.id, s.date, s.start_time, s.end_time, s.label, s.status,
            SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS holds
     FROM slots s
     LEFT JOIN bookings b ON b.slot_id = s.id
     GROUP BY s.id
     ORDER BY s.date, s.start_time`
  ).all();
  return Response.json({ slots: results });
}

export async function onRequestPost(ctx) {
  const b = await ctx.request.json().catch(() => ({}));

  // Bulk/recurring add.
  if (b && b.recurrence) {
    let rows;
    try {
      rows = expandRecurrence(b.recurrence, new Date().toISOString().slice(0, 10));
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (!rows.length) return Response.json({ ok: true, added: 0, skipped: 0 });
    let minD = rows[0].date, maxD = rows[0].date;
    for (const r of rows) { if (r.date < minD) minD = r.date; if (r.date > maxD) maxD = r.date; }
    const { results: existing } = await ctx.env.DB
      .prepare("SELECT date, start_time, end_time FROM slots WHERE date >= ? AND date <= ?")
      .bind(minD, maxD).all();
    const seen = new Set(existing.map((e) => `${e.date}|${e.start_time}|${e.end_time}`));
    const toInsert = rows.filter((r) => !seen.has(`${r.date}|${r.start_time}|${r.end_time}`));
    if (toInsert.length) {
      await ctx.env.DB.batch(
        toInsert.map((r) =>
          ctx.env.DB.prepare("INSERT INTO slots (date, start_time, end_time, label, status) VALUES (?, ?, ?, ?, 'available')")
            .bind(r.date, r.start_time, r.end_time, r.label))
      );
    }
    return Response.json({ ok: true, added: toInsert.length, skipped: rows.length - toInsert.length });
  }

  // Single slot.
  const date = String(b.date || "").trim();
  const start = String(b.start_time || "").trim();
  const end = String(b.end_time || "").trim();
  const label = (String(b.label || "Party slot").trim().slice(0, 60)) || "Party slot";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return Response.json({ error: "Need a date (YYYY-MM-DD) and start/end times (HH:MM)." }, { status: 400 });
  }
  if (end <= start) return Response.json({ error: "End time must be after the start time." }, { status: 400 });
  const r = await ctx.env.DB
    .prepare("INSERT INTO slots (date, start_time, end_time, label, status) VALUES (?, ?, ?, ?, 'available')")
    .bind(date, start, end, label).run();
  return Response.json({ ok: true, id: r.meta.last_row_id });
}

export async function onRequestPut(ctx) {
  const b = await ctx.request.json().catch(() => ({}));
  const v = validateSlotEdit(b);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const upd = v.value;

  const slot = await ctx.env.DB.prepare("SELECT status FROM slots WHERE id = ?").bind(upd.id).first();
  if (!slot) return Response.json({ error: "Slot not found." }, { status: 404 });

  // Time/status changes are unsafe on a slot with a confirmed booking.
  const changesTimeOrStatus = upd.start_time !== undefined || upd.status !== undefined;
  if (changesTimeOrStatus && slot.status === "booked") {
    return Response.json({ error: "That slot has a confirmed booking. Cancel it first to change the time or status." }, { status: 409 });
  }

  const sets = [], binds = [];
  if (upd.label !== undefined) { sets.push("label = ?"); binds.push(upd.label); }
  if (upd.start_time !== undefined) { sets.push("start_time = ?", "end_time = ?"); binds.push(upd.start_time, upd.end_time); }
  if (upd.status !== undefined) { sets.push("status = ?"); binds.push(upd.status); }
  binds.push(upd.id);
  const r = await ctx.env.DB.prepare(`UPDATE slots SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Could not update the slot." }, { status: 409 });
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Missing slot id." }, { status: 400 });
  }
  const booking = await ctx.env.DB
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'")
    .bind(id).first();
  if (booking) {
    return Response.json({ error: "That slot has a confirmed booking. Cancel the booking first." }, { status: 409 });
  }
  const [, slotDel] = await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM bookings WHERE slot_id = ? AND status IN ('pending', 'cancelled')").bind(id),
    ctx.env.DB
      .prepare("DELETE FROM slots WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id = ? AND status = 'confirmed')")
      .bind(id, id)
  ]);
  if (slotDel.meta.changes !== 1) {
    return Response.json({ error: "That slot just got a confirmed booking, so it was not deleted." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Local syntax check**

Run: `node --check functions/api/admin/slots.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add functions/api/admin/slots.js
git commit -m "Add bulk recurrence and slot editing to admin slots endpoint"
```

---

### Task 9: Dashboard markup + calendar styles

**Files:**
- Modify: `public/admin.html`
- Modify: `public/assets/styles.css`

- [ ] **Step 1: Replace the slot/slots sections with an Availability section**

In `public/admin.html`, delete the two sections `<section class="admin-block"><h2>Add a party slot</h2>…</section>` and `<section class="admin-block"><h2>Slots</h2>…</section>`, and put this single section in their place (immediately inside `<div data-admin-app hidden>`, before the Bookings section):

```html
        <section class="admin-block">
          <h2>Availability</h2>
          <p class="section-lede">Manage party slots, events and closures. A closure stops that day's slots being bookable on the website.</p>
          <div data-availability><p class="booking-note">Loading&hellip;</p></div>
        </section>
```

- [ ] **Step 2: Load the new script**

In `public/admin.html`, change the script tags at the bottom to:

```html
  <script src="assets/admin-availability.js" defer></script>
  <script src="assets/admin.js" defer></script>
```

(Order matters: `admin-availability.js` defines `window.OHPAvailability` before `admin.js` calls it.)

- [ ] **Step 3: Add calendar styles**

Append to `public/assets/styles.css`:

```css
/* ---- Admin availability calendar ---- */
.cal-head { display: flex; align-items: center; gap: 1rem; margin: 0 0 0.75rem; }
.cal-head h3 { margin: 0; font-size: 1.1rem; }
.cal-head .cal-nav { margin-left: auto; display: flex; gap: 0.4rem; }
.cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.cal-dow { font-size: 0.72rem; font-weight: 700; color: var(--muted); text-align: center; padding: 0.25rem 0; }
.cal-cell { min-height: 84px; border: 1px solid var(--line); border-radius: 6px; padding: 4px; background: #fff; text-align: left; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.cal-cell:hover { border-color: var(--park); }
.cal-cell.is-empty { background: transparent; border-color: transparent; cursor: default; }
.cal-cell.is-today { outline: 2px solid var(--honey); }
.cal-cell.is-past { opacity: 0.55; }
.cal-cell.is-closed { background: repeating-linear-gradient(45deg, #f3f3f3, #f3f3f3 6px, #ececec 6px, #ececec 12px); }
.cal-date { font-size: 0.78rem; font-weight: 700; color: var(--ink); }
.cal-chip { font-size: 0.68rem; line-height: 1.2; padding: 2px 4px; border-radius: 4px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cal-chip.s-available { background: var(--park); }
.cal-chip.s-held { background: var(--honey); color: var(--ink); }
.cal-chip.s-booked { background: #b3403a; }
.cal-chip.s-closed { background: #8a8f8c; }
.cal-chip.e-event { background: var(--sky); color: var(--ink); }
.cal-chip.e-closure { background: #6b7280; }
.cal-warn { font-size: 0.66rem; color: #b3403a; font-weight: 700; }
.cal-day-panel { margin-top: 1rem; border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem; background: var(--paper); }
.cal-day-panel h3 { margin: 0 0 0.5rem; }
.cal-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.35rem 0; border-bottom: 1px solid var(--line); }
.cal-row:last-child { border-bottom: 0; }
.cal-forms { display: grid; gap: 1rem; margin-top: 0.75rem; }
@media (min-width: 720px) { .cal-forms { grid-template-columns: 1fr 1fr; } }
.cal-bulk { margin-top: 1rem; }
.cal-bulk .cal-dows { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.4rem 0; }
.cal-bulk .cal-dows label { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; }
.cal-time-row { display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.35rem; }
@media (max-width: 560px) { .cal-cell { min-height: 64px; } }
```

- [ ] **Step 4: Local check (page still serves)**

Run: `cd public && python -m http.server 8133` then in another shell `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8133/admin.html` → expect `200`. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/admin.html public/assets/styles.css
git commit -m "Add availability section markup and calendar styles to admin"
```

---

### Task 10: Month-grid editor — `admin-availability.js`

**Files:**
- Create: `public/assets/admin-availability.js`

- [ ] **Step 1: Write the module**

```js
(function () {
  const KEY = "ohpc-admin-token";
  const root = document.querySelector("[data-availability]");
  if (!root) return;

  const token = () => sessionStorage.getItem(KEY) || "";
  const api = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];   // display order Mon-first
  const DOW_NUM = [1,2,3,4,5,6,0];                            // matching getUTCDay values

  const now = new Date();
  let viewY = now.getUTCFullYear();
  let viewM = now.getUTCMonth();                              // 0-based
  let slots = [], events = [];
  let openDate = null;

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function fmtTime(t) { let [h, mi] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (mi ? ":" + pad(mi) : "") + ap; }
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  async function load() {
    if (!token()) return;
    const from = iso(viewY, viewM, 1);
    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const to = iso(viewY, viewM, lastDay);
    const [sRes, eRes] = await Promise.all([api("/api/admin/slots"), api(`/api/admin/calendar-events?from=${from}&to=${to}`)]);
    if (sRes.status === 401 || eRes.status === 401) { root.replaceChildren(el("p", "Session expired — sign in again.", "booking-note")); return; }
    slots = (await sRes.json()).slots || [];
    events = (await eRes.json()).events || [];
    render();
  }

  const slotsOn = (d) => slots.filter((s) => s.date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const eventsOn = (d) => events.filter((e) => e.start_date <= d && e.end_date >= d);
  const isClosed = (d) => events.some((e) => e.kind === "closure" && e.start_date <= d && e.end_date >= d);
  function slotState(s) { if (s.status === "booked") return "booked"; if (s.status === "closed") return "closed"; if (Number(s.holds) > 0) return "held"; return "available"; }

  function render() {
    root.replaceChildren();

    const head = el("div", null, "cal-head");
    head.appendChild(el("h3", MONTHS[viewM] + " " + viewY));
    const nav = el("div", null, "cal-nav");
    const prev = el("button", "‹", "button ghost admin-mini"); prev.type = "button";
    const next = el("button", "›", "button ghost admin-mini"); next.type = "button";
    prev.addEventListener("click", () => { if (--viewM < 0) { viewM = 11; viewY--; } openDate = null; load(); });
    next.addEventListener("click", () => { if (++viewM > 11) { viewM = 0; viewY++; } openDate = null; load(); });
    nav.append(prev, next);
    head.appendChild(nav);
    root.appendChild(head);

    const grid = el("div", null, "cal-grid");
    for (const name of DOW) grid.appendChild(el("div", name, "cal-dow"));

    // Lead blanks so the 1st lands under its weekday (Mon-first).
    const firstDow = new Date(Date.UTC(viewY, viewM, 1)).getUTCDay();   // 0=Sun..6=Sat
    const lead = (firstDow + 6) % 7;                                    // Mon=0..Sun=6
    for (let i = 0; i < lead; i++) grid.appendChild(el("div", null, "cal-cell is-empty"));

    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const t = todayISO();
    for (let d = 1; d <= lastDay; d++) {
      const date = iso(viewY, viewM, d);
      const cell = el("button", null, "cal-cell"); cell.type = "button";
      if (date === t) cell.classList.add("is-today");
      if (date < t) cell.classList.add("is-past");
      if (isClosed(date)) cell.classList.add("is-closed");
      cell.appendChild(el("span", String(d), "cal-date"));
      for (const s of slotsOn(date)) {
        const st = slotState(s);
        const chip = el("span", fmtTime(s.start_time) + " " + s.label, "cal-chip s-" + st);
        cell.appendChild(chip);
        if (isClosed(date) && (st === "booked" || st === "held")) cell.appendChild(el("span", "⚠ closure clashes with a booking", "cal-warn"));
      }
      for (const e of eventsOn(date)) cell.appendChild(el("span", (e.kind === "closure" ? "Closed: " : "") + e.title, "cal-chip e-" + e.kind));
      cell.addEventListener("click", () => { openDate = date; render(); });
      grid.appendChild(cell);
    }
    root.appendChild(grid);

    if (openDate) root.appendChild(dayPanel(openDate));
    root.appendChild(bulkTool());
  }

  function dayPanel(date) {
    const panel = el("div", null, "cal-day-panel");
    panel.appendChild(el("h3", "Manage " + date));

    for (const s of slotsOn(date)) {
      const row = el("div", null, "cal-row");
      row.appendChild(el("span", fmtTime(s.start_time) + "–" + fmtTime(s.end_time) + " · " + s.label + " · " + slotState(s)));
      if (s.status !== "booked") {
        const close = el("button", s.status === "closed" ? "Re-open" : "Close", "button ghost admin-mini"); close.type = "button";
        close.addEventListener("click", () => putSlot({ id: s.id, status: s.status === "closed" ? "available" : "closed" }));
        const del = el("button", "Delete", "button ghost admin-mini"); del.type = "button";
        del.addEventListener("click", () => { if (confirm("Delete this slot?")) delSlot(s.id); });
        row.append(close, del);
      }
      panel.appendChild(row);
    }
    for (const e of eventsOn(date)) {
      const row = el("div", null, "cal-row");
      row.appendChild(el("span", (e.kind === "closure" ? "Closure: " : "Event: ") + e.title));
      const del = el("button", "Delete", "button ghost admin-mini"); del.type = "button";
      del.addEventListener("click", () => { if (confirm("Delete this " + e.kind + "?")) delEvent(e.id); });
      row.appendChild(del);
      panel.appendChild(row);
    }

    const forms = el("div", null, "cal-forms");
    forms.appendChild(addSlotForm(date));
    forms.appendChild(addEventForm(date));
    panel.appendChild(forms);
    return panel;
  }

  function field(labelText, input) { const l = el("label", labelText + " "); l.appendChild(input); return l; }
  function input(attrs) { const i = document.createElement("input"); Object.assign(i, attrs); return i; }

  function addSlotForm(date) {
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Add a slot"));
    const start = input({ type: "time", required: true });
    const end = input({ type: "time", required: true });
    const label = input({ type: "text", value: "Party slot", maxLength: 60 });
    form.append(field("Start", start), field("End", end), field("Label", label));
    const status = el("p", null, "form-status");
    const btn = el("button", "Add slot", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "Adding…";
      const r = await api("/api/admin/slots", { method: "POST", body: JSON.stringify({ date, start_time: start.value, end_time: end.value, label: label.value }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) load(); else status.textContent = d.error || "Could not add.";
    });
    return form;
  }

  function addEventForm(date) {
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Add an event or closure"));
    const kind = document.createElement("select");
    kind.append(new Option("Event", "event"), new Option("Closure (blocks bookings)", "closure"));
    const title = input({ type: "text", required: true, maxLength: 120 });
    const endDate = input({ type: "date", value: date });
    form.append(field("Type", kind), field("Title", title), field("Through date", endDate));
    const status = el("p", null, "form-status");
    const btn = el("button", "Add", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "Adding…";
      const r = await api("/api/admin/calendar-events", { method: "POST", body: JSON.stringify({ kind: kind.value, title: title.value, start_date: date, end_date: endDate.value || date, all_day: 1 }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) load(); else status.textContent = d.error || "Could not add.";
    });
    return form;
  }

  function bulkTool() {
    const wrap = el("div", null, "cal-bulk");
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Bulk-add recurring slots"));
    const from = input({ type: "date", required: true });
    const to = input({ type: "date", required: true });
    form.append(field("From", from), field("To", to));

    const dows = el("div", null, "cal-dows");
    const boxes = DOW.map((name, i) => { const cb = input({ type: "checkbox", value: String(DOW_NUM[i]) }); const l = el("label"); l.append(cb, document.createTextNode(" " + name)); dows.appendChild(l); return cb; });
    form.append(el("span", "Weekdays"), dows);

    const times = [];
    const timesWrap = el("div");
    function addTimeRow(s = "10:00", e = "12:00", lab = "Party slot") {
      const row = el("div", null, "cal-time-row");
      const st = input({ type: "time", value: s }), en = input({ type: "time", value: e }), lb = input({ type: "text", value: lab, maxLength: 60 });
      const rm = el("button", "×", "button ghost admin-mini"); rm.type = "button";
      const entry = { st, en, lb };
      rm.addEventListener("click", () => { timesWrap.removeChild(row); times.splice(times.indexOf(entry), 1); });
      row.append(st, en, lb, rm); timesWrap.appendChild(row); times.push(entry);
    }
    addTimeRow();
    const addTimeBtn = el("button", "+ time", "button ghost admin-mini"); addTimeBtn.type = "button";
    addTimeBtn.addEventListener("click", () => addTimeRow());
    form.append(el("span", "Times"), timesWrap, addTimeBtn);

    const status = el("p", null, "form-status");
    const btn = el("button", "Generate slots", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const weekdays = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      const t = times.map((x) => ({ start: x.st.value, end: x.en.value, label: x.lb.value }));
      status.textContent = "Generating…";
      const r = await api("/api/admin/slots", { method: "POST", body: JSON.stringify({ recurrence: { start_date: from.value, end_date: to.value, weekdays, times: t } }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { status.textContent = `Added ${d.added}, skipped ${d.skipped} duplicate(s).`; load(); }
      else status.textContent = d.error || "Could not generate.";
    });
    wrap.appendChild(form);
    return wrap;
  }

  async function putSlot(body) { const r = await api("/api/admin/slots", { method: "PUT", body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not update."); }
  async function delSlot(id) { const r = await api("/api/admin/slots?id=" + id, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not delete."); }
  async function delEvent(id) { const r = await api("/api/admin/calendar-events?id=" + id, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not delete."); }

  window.OHPAvailability = { render: load };
})();
```

- [ ] **Step 2: Wire `admin.js` to drive it and drop the old slot UI**

In `public/assets/admin.js`:
- Remove the element refs that no longer exist: `slotForm`, `slotStatus`, `slotsEl` (the `const … = document.querySelector("[data-admin-slot-form]")` etc.).
- Remove the entire `slotForm.addEventListener("submit", …)` block.
- Remove the entire `async function loadSlots() { … }` function.
- Change `refresh()` to:

```js
  async function refresh() {
    await Promise.all([loadBookings(), loadEnquiries()]);
    if (window.OHPAvailability) window.OHPAvailability.render();
  }
```

- [ ] **Step 3: Local syntax check**

Run: `node --check public/assets/admin-availability.js && node --check public/assets/admin.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add public/assets/admin-availability.js public/assets/admin.js
git commit -m "Add month-grid availability editor; wire into admin dashboard"
```

---

### Task 11: Deploy and verify end-to-end

**Files:** none (verification).

- [ ] **Step 1: Run the full unit suite**

Run: `node --test tests/`
Expected: all tests pass.

- [ ] **Step 2: Push to deploy (migrations apply, then Pages deploy)**

```bash
git push origin master
```
Then watch CI: `gh run list --limit 1` until `completed  success`. Confirm the "Apply D1 migrations" step ran.

- [ ] **Step 3: Verify the closure rule on the live API**

```bash
BASE="https://oak-hill-park-cafe.pages.dev"
TOKEN="<ADMIN_TOKEN>"
# Add a far-future slot + a closure covering it, then confirm it's hidden publicly.
curl -s -X POST "$BASE/api/admin/slots" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-12-31","start_time":"10:00","end_time":"12:00","label":"NYE test"}'
curl -s -X POST "$BASE/api/admin/calendar-events" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"closure","title":"NYE closed","start_date":"2026-12-31"}'
curl -s "$BASE/api/slots" | grep -q "2026-12-31" && echo "FAIL: slot still public" || echo "PASS: closure hid the slot"
```
Expected: `PASS: closure hid the slot`. Then delete the test slot + closure via the dashboard or DELETE endpoints.

- [ ] **Step 4: Verify the dashboard by hand**

Open `/admin.html`, sign in, and confirm: the month grid renders; single add, bulk-add (with skipped-duplicate count), edit/close/re-open/delete a slot, and add/delete an event and a closure all work and refresh the grid; a closed day is tinted and a closure over a booked slot shows the ⚠ warning.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "Fix issues found during A1 end-to-end verification"
git push origin master
```

---

## Self-Review

**Spec coverage:** calendar_events table (T1); CI migrations (T2); recurrence/closure/validation logic (T3–T5); closure suppression on slots+book (T6); admin events CRUD (T7); bulk add + edit (T8); month-grid editor + markup + styles (T9–T10); deploy + verify (T11). All spec sections map to a task.

**Type consistency:** `expandRecurrence(recurrence, today)` returns `{date,start_time,end_time,label}` rows — consumed identically in T8. `validateCalendarEvent` returns `{ok,value:{kind,title,start_date,end_date,all_day,start_time,end_time,notes}}` — bound in that order in T7. `validateSlotEdit` returns `{ok,value:{id,label?,start_time?,end_time?,status?}}` — consumed in T8's PUT. `/api/admin/calendar-events?from=&to=` and `/api/admin/slots` shapes match the client in T10. `window.OHPAvailability.render` defined in T10, called in T10/Step 2's `refresh()`.

**Placeholder scan:** none — every code step is complete. `<ADMIN_TOKEN>` in T11 is a runtime secret the operator supplies, not a code placeholder.
