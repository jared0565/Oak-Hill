// tests/demo-mode.test.mjs
//
// The demonstration boundary. These tests are the safety net for the promise
// the site makes to a visitor: nothing you submit reaches a real inbox, a real
// reservation, a real customer record, or a real calendar.
//
// A test here is only meaningful if it would FAIL if the guard were removed,
// so each one asserts on the *absence* of a database write or an outbound
// request, not merely on the shape of the response.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveMode, isDemo, configGuard, demoRef, DEMO_MESSAGES, DEMO_NOTICE } from "../functions/api/_lib/demo.mjs";
import { sampleSlots, sampleEvents, listDemoSlots, privateHireDate } from "../functions/api/_lib/demo-store.mjs";
import { sendEnquiryEmail } from "../functions/api/_lib/notify.mjs";
import { turnstileEnabled } from "../functions/api/_lib/turnstile.mjs";

import { onRequestPost as bookPost } from "../functions/api/book.js";
import { onRequestPost as enquiryPost } from "../functions/api/enquiry.js";
import { onRequestPost as leadPost } from "../functions/api/lead.js";
import { onRequestPost as trackPost } from "../functions/api/track.js";
import { onRequestGet as slotsGet } from "../functions/api/slots.js";
import { onRequestGet as codeGet } from "../functions/api/code.js";
import { onRequest as adminMiddleware } from "../functions/api/admin/_middleware.js";

// ---- a fake D1 that records every statement it is asked to run -------------
function fakeDb(overrides = {}) {
  const calls = { prepared: [], run: [], first: [], all: [] };
  const db = {
    calls,
    prepare(sql) {
      calls.prepared.push(sql);
      const stmt = {
        sql,
        bind(...args) {
          return {
            sql,
            args,
            run: async () => { calls.run.push({ sql, args }); return { meta: { changes: 1, last_row_id: 1 } }; },
            first: async () => { calls.first.push({ sql, args }); return overrides.first ?? null; },
            all: async () => { calls.all.push({ sql, args }); return { results: overrides.results ?? [] }; },
          };
        },
        run: async () => { calls.run.push({ sql, args: [] }); return { meta: { changes: 1, last_row_id: 1 } }; },
        first: async () => { calls.first.push({ sql, args: [] }); return overrides.first ?? null; },
        all: async () => { calls.all.push({ sql, args: [] }); return { results: overrides.results ?? [] }; },
      };
      return stmt;
    },
    batch: async (stmts) => { calls.run.push({ sql: "BATCH", args: stmts.length }); return []; },
  };
  return db;
}

function ctxFor(env, { url = "https://demo.test/api/x", method = "POST", body = null } = {}) {
  const db = fakeDb();
  const init = body ? { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : { method };
  return {
    env: { ...env, DB: db },
    request: new Request(url, init),
    db,
  };
}

const DEMO_ENV = { DEMO_MODE: "true" };
const LIVE_ENV = { DEMO_MODE: "false", LIVE_MODE_ACK: "true" };

// ---- the mode itself --------------------------------------------------------

test("the demonstration is the default, and a typo never re-enables live behaviour", () => {
  assert.equal(resolveMode(DEMO_ENV), "demo");
  assert.equal(isDemo(DEMO_ENV), true);

  // Missing, misspelled or half-set configuration is NOT live.
  assert.equal(resolveMode({}), "unconfigured");
  assert.equal(resolveMode({ DEMO_MODE: "" }), "unconfigured");
  assert.equal(resolveMode({ DEMO_MODE: "yes" }), "unconfigured");
  assert.equal(resolveMode({ DEMO_MODE: "TRUE " }), "demo"); // case/space tolerant
  assert.equal(isDemo({}), true);
});

test("live behaviour needs two deliberate settings, not one", () => {
  assert.equal(resolveMode(LIVE_ENV), "live");
  assert.equal(isDemo(LIVE_ENV), false);
  // DEMO_MODE=false on its own does not arm the live path.
  assert.equal(resolveMode({ DEMO_MODE: "false" }), "unconfigured");
  assert.equal(resolveMode({ LIVE_MODE_ACK: "true" }), "unconfigured");
});

test("an unconfigured environment refuses to write, and says why", async () => {
  const guard = configGuard({});
  assert.ok(guard, "a guard response must be returned");
  assert.equal(guard.status, 503);
  const body = await guard.json();
  assert.match(body.error, /not configured/i);
  assert.match(body.detail, /DEMO_MODE/);
  assert.equal(configGuard(DEMO_ENV), null);
  assert.equal(configGuard(LIVE_ENV), null);
});

test("a demo booking reference is unmistakably synthetic", () => {
  const ref = demoRef();
  assert.match(ref, /^DEMO-[0-9A-Z]{5}$/);
  assert.notEqual(ref, demoRef());
});

test("the notices say what the site is", () => {
  // The site itself carries a badge rather than notices across every page,
  // so these are the one place the boundary is stated in full.
  assert.match(DEMO_NOTICE, /demonstration site/i);
  assert.match(DEMO_NOTICE, /nothing a visitor sends is stored or sent/i);
  assert.match(DEMO_MESSAGES.menu, /Menu and prices/);
  // The three the visitor reads back after submitting something must say
  // plainly that nothing was booked, sent or stored.
  assert.match(DEMO_MESSAGES.booking, /no reservation has been made/i);
  assert.match(DEMO_MESSAGES.booking, /no email has been sent/i);
  assert.match(DEMO_MESSAGES.enquiry, /nothing has actually been sent/i);
  assert.match(DEMO_MESSAGES.enquiry, /nothing has been stored/i);
  assert.match(DEMO_MESSAGES.newsletter, /no sign-up has been recorded/i);
});

// ---- the isolated demo store ------------------------------------------------

test("the sample slot list is synthetic, deterministic and falls on trading days only", () => {
  const now = new Date("2026-10-21T09:00:00Z");
  const a = sampleSlots(now);
  const b = sampleSlots(now);
  assert.deepEqual(a, b, "the same day must produce the same list");
  assert.ok(a.length > 0);

  const hire = privateHireDate(now);
  for (const s of a) {
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(s.date > "2026-10-21", "slots must be in the future");
    const dow = new Date(s.date + "T00:00:00Z").getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, "the sample café trades Monday to Friday");
    assert.notEqual(s.date, hire, "the day taken for a private hire has no slots");
    assert.ok(s.start_time < s.end_time);
    assert.equal(typeof s.label, "string");
  }
  // Ids are unique and sequential, so a slot can be looked up by id.
  assert.deepEqual(a.map((s) => s.id), a.map((_, i) => i + 1));
});

test("the sample calendar shows a closure and a private hire", () => {
  const now = new Date("2026-10-21T09:00:00Z");
  const events = sampleEvents("2026-10-01", "2026-12-31", now);
  assert.ok(events.length > 0);
  assert.ok(events.some((e) => e.kind === "closure"));
  assert.ok(events.some((e) => e.kind === "event"));
  for (const e of events) {
    assert.ok(e.start_date <= e.end_date);
    assert.match(e.start_date, /^\d{4}-\d{2}-\d{2}$/);
  }
  // A range that cannot be parsed yields nothing rather than throwing.
  assert.deepEqual(sampleEvents("nonsense", "also nonsense"), []);
});

test("a slot is never offered on a day the calendar calls closed", () => {
  // The one thing the demonstration must never do is offer a booking on a day
  // it says the café is shut.
  const now = new Date("2026-10-21T09:00:00Z");
  const slots = sampleSlots(now);
  const closed = new Set(
    sampleEvents("2026-10-01", "2026-12-31", now)
      .filter((e) => e.kind === "closure")
      .map((e) => e.start_date)
  );
  assert.ok(closed.size > 0, "the sample calendar must show closures");
  for (const s of slots) {
    assert.ok(!closed.has(s.date), "a slot was offered on a closed day: " + s.date);
  }
  // And the private-hire day is booked out: it carries an event, not a slot.
  const hire = privateHireDate(now);
  const hired = sampleEvents(hire, hire, now);
  assert.ok(hired.some((e) => e.kind === "event"), "the private hire day must be marked");
  assert.ok(!slots.some((s) => s.date === hire), "the private hire day must have no slots");
});

test("the demo store falls back to the sample list when there is no database", async () => {
  const result = await listDemoSlots({});
  assert.equal(result.source, "sample");
  assert.ok(result.slots.length > 0);
});

// ---- no email, no captcha ----------------------------------------------------

test("the demo never sends an enquiry email, even with a Resend key configured", async () => {
  const env = { ...DEMO_ENV, RESEND_API_KEY: "key-would-be-used-in-live-mode", ENQUIRY_FROM: "a@b.test", ENQUIRY_NOTIFY_TO: "c@d.test" };
  const result = await sendEnquiryEmail(env, { type: "general", name: "Alex", email: "alex@example.com" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "demo_mode");
});

test("the demo does not ask visitors to solve a captcha", () => {
  assert.equal(turnstileEnabled({ ...DEMO_ENV, TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET: "s" }), false);
  assert.equal(turnstileEnabled({ ...LIVE_ENV, TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET: "s" }), true);
});

// ---- bookings create no reservation -----------------------------------------

test("a demo booking validates, returns a synthetic reference and writes nothing", async () => {
  const ctx = ctxFor(DEMO_ENV, {
    body: { slot_id: 1, name: "Alex Sample", phone: "020 0000 0000", email: "alex@example.com" },
  });
  const res = await bookPost(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.demo, true);
  assert.match(body.ref, /^DEMO-/);
  assert.equal(body.message, DEMO_MESSAGES.booking);

  // The heart of the test: not one statement was written. Reading the isolated
  // demo store is fine; writing to it is not.
  assert.deepEqual(ctx.db.calls.run, [], "the demo must not write a booking row");
  for (const sql of ctx.db.calls.prepared) {
    assert.match(sql.trim(), /^SELECT\b/i, `the demo must not prepare a write: ${sql.slice(0, 40)}`);
  }
});

test("a demo booking still rejects bad input, so the validation states are real", async () => {
  for (const body of [
    { slot_id: 1, name: "", phone: "0", email: "a@b.test" },
    { slot_id: 1, name: "A", phone: "0", email: "not-an-email" },
    { slot_id: 0, name: "A", phone: "0", email: "a@b.test" },
  ]) {
    const ctx = ctxFor(DEMO_ENV, { body });
    const res = await bookPost(ctx);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.deepEqual(ctx.db.calls.run, []);
  }
});

test("a demo booking for a slot that does not exist is refused, not invented", async () => {
  const ctx = ctxFor(DEMO_ENV, { body: { slot_id: 9999, name: "A", phone: "0", email: "a@b.test" } });
  const res = await bookPost(ctx);
  assert.equal(res.status, 404);
  assert.deepEqual(ctx.db.calls.run, []);
});

test("an unconfigured environment refuses a booking outright", async () => {
  const ctx = ctxFor({}, { body: { slot_id: 1, name: "A", phone: "0", email: "a@b.test" } });
  const res = await bookPost(ctx);
  assert.equal(res.status, 503);
  assert.deepEqual(ctx.db.calls.run, []);
});

// ---- public forms persist no personal information ----------------------------

test("a demo enquiry is validated and then discarded", async () => {
  const ctx = ctxFor(DEMO_ENV, {
    body: { type: "general", name: "Alex Sample", email: "alex@example.com", message: "hello" },
  });
  const res = await enquiryPost(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.demo, true);
  assert.equal(body.message, DEMO_MESSAGES.enquiry);
  assert.deepEqual(ctx.db.calls.run, [], "the demo must not store an enquiry");
  assert.deepEqual(ctx.db.calls.prepared, []);
});

test("a demo enquiry is still validated before it is dropped", async () => {
  const ctx = ctxFor(DEMO_ENV, { body: { type: "general", name: "", email: "a@b.test" } });
  const res = await enquiryPost(ctx);
  assert.equal(res.status, 400);
  assert.deepEqual(ctx.db.calls.run, []);
});

test("a demo newsletter signup records no marketing consent", async () => {
  const ctx = ctxFor(DEMO_ENV, { body: { email: "alex@example.com" } });
  const res = await leadPost(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.demo, true);
  assert.equal(body.message, DEMO_MESSAGES.newsletter);
  assert.deepEqual(ctx.db.calls.run, []);
  assert.deepEqual(ctx.db.calls.prepared, []);
});

test("the demo records no analytics events", async () => {
  const ctx = ctxFor(DEMO_ENV, { body: { name: "page_view", path: "/index.html" } });
  const res = await trackPost(ctx);
  assert.equal(res.status, 204);
  assert.deepEqual(ctx.db.calls.run, []);
});

test("the demo serves no third-party tracking snippets", async () => {
  const ctx = ctxFor(DEMO_ENV, { url: "https://demo.test/api/code", method: "GET" });
  const res = await codeGet(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.snippets, []);
  assert.equal(body.demo, true);
});

test("the public slot list is the sample list, and no slot row is written", async () => {
  const ctx = ctxFor(DEMO_ENV, { url: "https://demo.test/api/slots", method: "GET" });
  const res = await slotsGet(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.demo, true);
  assert.ok(body.slots.length > 0);
  assert.deepEqual(ctx.db.calls.run, []);
});

// ---- the live path is preserved ---------------------------------------------

test("live mode still writes a booking, with a reference that is not a demo one", async () => {
  const ctx = ctxFor(LIVE_ENV, {
    body: { slot_id: 1, name: "Alex Sample", phone: "020 0000 0000", email: "alex@example.com" },
  });
  // The live path reads the slot first; hand it an available one.
  const slot = { id: 1, date: "2099-01-01", start_time: "10:00", end_time: "12:00", label: "Party slot", status: "available" };
  const db = ctx.db;
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = originalPrepare(sql);
    const origFirst = stmt.bind ? null : null;
    return stmt;
  };
  // Simpler: patch first() to return the slot for the slot SELECT.
  const origPrepare = originalPrepare;
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (sql.includes("FROM slots WHERE id = ?")) {
      const origBind = stmt.bind;
      stmt.bind = (...args) => {
        const b = origBind(...args);
        b.first = async () => { db.calls.first.push({ sql, args }); return slot; };
        return b;
      };
    }
    return stmt;
  };

  const res = await bookPost(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.demo, undefined, "live mode must not claim to be a demo");
  assert.match(body.ref, /^BFX-/);
  assert.doesNotMatch(body.ref, /^DEMO-/);
  assert.ok(db.calls.run.length >= 1, "live mode must still write the booking row");
});

test("live mode still refuses to double-book a slot", async () => {
  const ctx = ctxFor(LIVE_ENV, {
    body: { slot_id: 1, name: "Alex Sample", phone: "020 0000 0000", email: "alex@example.com" },
  });
  const slot = { id: 1, date: "2099-01-01", start_time: "10:00", end_time: "12:00", label: "Party slot", status: "available" };
  const origPrepare = ctx.db.prepare.bind(ctx.db);
  ctx.db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (sql.includes("FROM slots WHERE id = ?")) {
      const origBind = stmt.bind;
      stmt.bind = (...args) => {
        const b = origBind(...args);
        b.first = async () => slot;
        return b;
      };
    }
    if (sql.includes("INSERT INTO bookings")) {
      const origBind = stmt.bind;
      stmt.bind = (...args) => {
        const b = origBind(...args);
        b.run = async () => { ctx.db.calls.run.push({ sql, args }); return { meta: { changes: 0, last_row_id: 0 } }; };
        return b;
      };
    }
    return stmt;
  };

  const res = await bookPost(ctx);
  assert.equal(res.status, 409, "a lost race must still be a 409, not a false hold");
});

// ---- the admin console stays closed ----------------------------------------

test("the admin API refuses an unauthenticated request, in demo mode too", async () => {
  const ctx = ctxFor(DEMO_ENV, { url: "https://demo.test/api/admin/bookings", method: "GET" });
  const res = await adminMiddleware(ctx);
  assert.equal(res.status, 401);
  assert.deepEqual(ctx.db.calls.run, []);
});

test("the admin API refuses a bogus session token", async () => {
  const ctx = ctxFor(DEMO_ENV, { url: "https://demo.test/api/admin/bookings", method: "GET" });
  ctx.request = new Request("https://demo.test/api/admin/bookings", { headers: { Authorization: "Bearer not-a-real-token" } });
  const res = await adminMiddleware(ctx);
  assert.equal(res.status, 401);
});
