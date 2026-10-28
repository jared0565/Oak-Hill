// tests/calendar.test.mjs
//
// The public calendar on the calendar page, and in particular the sentence
// that explains it. That sentence is written from the data on screen: which
// days have slots, which day is closed, and which day is taken for a private
// hire. It used to be a fixed sentence about Mondays, which described the
// generator rather than whatever the page was showing.
//
// The script is a classic browser script, so it runs for real here in a
// sandbox with a stubbed DOM, the way the mode switch is tested: reading the
// source would not notice a summary that named the wrong day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(join(ROOT, "public/assets/calendar.js"), "utf8");

// ---- a very small DOM -----------------------------------------------------

function makeEl(tag = "div") {
  const el = {
    tag,
    attrs: {},
    children: [],
    listeners: {},
    parentElement: null,
    textContent: "",
    type: "",
    classList: {
      set: new Set(),
      add(...names) { names.forEach((n) => el.classList.set.add(n)); },
      remove(...names) { names.forEach((n) => el.classList.set.delete(n)); },
      contains(name) { return el.classList.set.has(name); },
    },
    get className() { return [...el.classList.set].join(" "); },
    set className(value) { el.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
    append(...kids) { kids.forEach((k) => el.appendChild(k)); },
    replaceChildren(...kids) { el.children = []; kids.forEach((k) => el.appendChild(k)); },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    scrollIntoView() {},
  };
  return el;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- the page -------------------------------------------------------------

const SLOTS = [
  { id: 1, date: "2026-03-02", start_time: "09:30", end_time: "11:30" },
  { id: 2, date: "2026-03-03", start_time: "09:30", end_time: "11:30" },
  { id: 3, date: "2026-03-04", start_time: "09:30", end_time: "11:30" },
  { id: 4, date: "2026-03-05", start_time: "09:30", end_time: "11:30" },
  { id: 5, date: "2026-03-06", start_time: "09:30", end_time: "11:30" },
];

const EVENTS = [
  // A closure: a Tuesday the café does not trade on.
  { kind: "closure", title: "Closed", start_date: "2026-03-03", end_date: "2026-03-03" },
  // An ordinary booking: a party, which is not a private hire.
  { kind: "event", title: "Children's party", start_date: "2026-03-10", end_date: "2026-03-10" },
  // The day that is taken for a private hire.
  { kind: "event", title: "Private hire", start_date: "2026-03-11", end_date: "2026-03-11" },
];

function buildPage({ slots = SLOTS, events = EVENTS, withSummary = true } = {}) {
  const root = makeEl("div");
  const summary = makeEl("p");
  const bySelector = {};
  if (withSummary) bySelector["[data-availability-summary]"] = summary;

  const document = {
    querySelector: (sel) => (sel === "[data-public-calendar]" ? root : bySelector[sel] || null),
    getElementById: () => null,
    createElement: (tag) => makeEl(tag),
  };

  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);
    if (url === "/api/slots") return { ok: true, status: 200, json: async () => ({ slots }) };
    return { ok: true, status: 200, json: async () => ({ events }) };
  };

  const media = { matches: false, addEventListener() {} };
  const context = {
    document,
    window: { matchMedia: () => media },
    fetch: fetchStub,
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return { root, summary, calls, async settle() { await tick(); } };
}

// ---- the tests ------------------------------------------------------------

test("the summary describes the days that are open, closed and taken", async () => {
  const page = buildPage();
  await page.settle();

  const text = page.summary.textContent;
  // The trading days come from the slots that are on screen.
  assert.match(text, /trades Mondays to Fridays/);
  assert.match(text, /5 slots are open over the next four weeks/);
  // The private hire is named, with its date.
  assert.match(text, /Wed 11 Mar is taken for a private hire/);
  // The closed day is named.
  assert.match(text, /Tuesday is closed/);
  // An ordinary party is not a private hire.
  assert.doesNotMatch(text, /10 Mar is taken for a private hire/);
  // And the hire's day is not reported as closed.
  assert.doesNotMatch(text, /Wednesdays are closed/);
  assert.doesNotMatch(text, /Wednesday is closed/);
});

test("a calendar with no summary on the page still works", async () => {
  // The summary is an extra, not a requirement: a page without it must not
  // fall over, and must still draw the calendar.
  const page = buildPage({ withSummary: false });
  await page.settle();
  assert.equal(page.summary.textContent, "");
  assert.ok(page.root.children.length > 0, "the calendar was not drawn");
  assert.ok(page.calls.includes("/api/slots"));
  assert.ok(page.calls.some((u) => u.startsWith("/api/calendar-events")));
});

test("a calendar with nothing booked says only that it is open", async () => {
  const page = buildPage({ slots: [], events: [] });
  await page.settle();
  const text = page.summary.textContent;
  assert.match(text, /trades no days/);
  assert.doesNotMatch(text, /private hire/);
  assert.doesNotMatch(text, /closed/);
});
