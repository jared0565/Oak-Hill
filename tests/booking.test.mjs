// tests/booking.test.mjs
//
// The booking form on the calendar page: the slots it offers, the way it
// checks what the visitor typed, and the two failures it has to explain.
//
// The script is a classic browser script, so it is exercised for real in a
// sandbox with a stubbed DOM, the way the mode switch is: a test that only
// read the source would still pass if the form stopped naming the field that
// is wrong, or started sending a request it should have held back.
//
// The stub is a small stand-in for the page's own markup, taken from
// public/calendar.html.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(join(ROOT, "public/assets/booking.js"), "utf8");

// ---- a very small DOM -----------------------------------------------------
// Only the parts the booking script actually touches.

function parseSimple(sel) {
  const out = { tag: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*)|\.([\w-]+)|\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g;
  let m;
  while ((m = re.exec(sel)) !== null) {
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs.push([m[3], m[4]]);
  }
  return out;
}

function matchesSimple(el, sel) {
  const p = parseSimple(sel.trim());
  if (p.tag && el.tag.toLowerCase() !== p.tag) return false;
  for (const c of p.classes) if (!el.classList.contains(c)) return false;
  for (const [name, value] of p.attrs) {
    const have = el.getAttribute(name);
    if (have === null) return false;
    if (value !== undefined && have !== value) return false;
  }
  return true;
}

function matches(el, sel) {
  return sel
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => matchesSimple(el, s));
}

function makeEl(tag = "div", attrs = {}) {
  const el = {
    tag,
    attrs: { ...attrs },
    children: [],
    listeners: {},
    parentElement: null,
    textContent: "",
    innerHTML: "",
    value: attrs.value ?? "",
    type: attrs.type ?? "text",
    id: attrs.id ?? "",
    name: attrs.name ?? "",
    hidden: false,
    disabled: false,
    focused: false,
    scrolled: false,
    classList: {
      set: new Set(),
      add(...names) { names.forEach((n) => el.classList.set.add(n)); },
      remove(...names) { names.forEach((n) => el.classList.set.delete(n)); },
      contains(name) { return el.classList.set.has(name); },
    },
    setAttribute(name, value) { el.attrs[name] = String(value); },
    get className() { return [...el.classList.set].join(" "); },
    set className(value) { el.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    fire(type, ev = {}) {
      return Promise.all((el.listeners[type] || []).map((fn) => fn(ev)));
    },
    getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
    removeAttribute(name) { delete el.attrs[name]; },
    hasAttribute(name) { return name in el.attrs; },
    appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
    append(...kids) { kids.forEach((k) => el.appendChild(k)); },
    replaceChildren(...kids) { el.children = []; kids.forEach((k) => el.appendChild(k)); },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    focus() { el.focused = true; },
    scrollIntoView() { el.scrolled = true; },
    // A browser reports a required, empty field as invalid, and a field whose
    // pattern does not match as invalid too.
    valid() {
      if (el.hasAttribute("required") && !String(el.value).trim()) return false;
      const pattern = el.getAttribute("pattern");
      if (pattern && !new RegExp(`^(?:${pattern})$`).test(el.value)) return false;
      if (el.type === "email" && el.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value)) return false;
      return true;
    },
    get validity() { return { valid: el.valid() }; },   // replaced below with a live getter
    closest(sel) {
      let node = el;
      while (node) {
        if (matchesSimple(node, sel)) return node;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (matches(child, sel)) found.push(child);
          walk(child);
        }
      };
      walk(el);
      return found;
    },
  };
  return el;
}


const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- the page -------------------------------------------------------------
// A field with a label, the way the page has it: the input sits inside the
// label, so the label is what names the field.
function labelledField({ name, type = "text", value = "", label, required = true, pattern }) {
  const input = makeEl("input", { name, type, value });
  if (required) input.setAttribute("required", "required");
  if (pattern) input.setAttribute("pattern", pattern);
  const el = makeEl("label", { class: "field-sample" });
  el.textContent = label;
  el.appendChild(input);
  return { label: el, input };
}

function buildPage({ slotResponse, bookResponse } = {}) {
  const root = makeEl("div");
  const slotsEl = makeEl("div");
  const form = makeEl("form");
  const chosenEl = makeEl("h3");
  const statusEl = makeEl("p");
  const successEl = makeEl("div");
  const cancelBtn = makeEl("button");
  const submitBtn = makeEl("button");
  const summary = makeEl("p");

  const bySelector = {
    "[data-booking-slots]": slotsEl,
    "[data-booking-form]": form,
    "[data-booking-chosen]": chosenEl,
    "[data-booking-status]": statusEl,
    "[data-booking-success]": successEl,
    "[data-booking-cancel]": cancelBtn,
    "[data-booking-submit]": submitBtn,
    "[data-booking-summary]": summary,
  };
  root.querySelector = (sel) => bySelector[sel] || null;

  const fields = {};
  for (const spec of [
    { name: "name", label: "Your name", value: "Alex Sample" },
    { name: "phone", type: "tel", label: "Telephone", value: "020 0000 0000" },
    { name: "email", type: "email", label: "Email", value: "alex@example.com" },
  ]) {
    const { label, input } = labelledField(spec);
    form.appendChild(label);
    fields[spec.name] = input;
  }
  // A required field with no label at all: the message can only name it by
  // its name attribute.
  const orphan = makeEl("input", { name: "postcode", value: "SW1A" });
  orphan.setAttribute("required", "required");
  form.appendChild(orphan);
  fields.postcode = orphan;

  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/slots") {
      return { ok: true, status: 200, json: async () => slotResponse };
    }
    return bookResponse;
  };

  class FormDataStub {
    constructor(f) { this.form = f; }
    get(name) {
      const field = this.form.querySelector(`[name='${name}']`);
      return field ? field.value : null;
    }
  }

  const document = {
    querySelector: (sel) => (sel === "[data-booking]" ? root : bySelector[sel] || null),
    createElement: (tag) => makeEl(tag),
  };
  const context = {
    document,
    window: {},
    fetch: fetchStub,
    FormData: FormDataStub,
    CSS: { escape: (s) => s },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return {
    root, form, slotsEl, statusEl, successEl, chosenEl, submitBtn, summary, fields, calls,
    async settle() { await tick(); },
    slotButtons() { return slotsEl.querySelectorAll(".booking-slot"); },
    async submit() {
      await form.fire("submit", { preventDefault() {} });
      await tick();
    },
    async fire(type, ev = {}) {
      const out = (form.listeners[type] || []).map((fn) => fn(ev));
      await Promise.all(out);
      await tick();
    },
  };
}

const SLOTS = {
  slots: [
    { id: 1, date: "2026-02-02", start_time: "09:30", end_time: "11:30", label: "Weekday party" },
    { id: 2, date: "2026-02-02", start_time: "12:00", end_time: "14:00", label: "Cake ceremony" },
  ],
};

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });

// What the server sends back when a request is accepted.
const accepted = () =>
  ok({
    ok: true,
    demo: true,
    ref: "ABC-123",
    message: "Checked.",
    slot: { id: 1, date: "2026-02-02", start_time: "09:30", end_time: "11:30" },
  });

// ---- the tests ------------------------------------------------------------

test("the free slots are offered, and choosing one opens the form", async () => {
  const page = buildPage({ slotResponse: SLOTS, bookResponse: ok() });
  await page.settle();

  const buttons = page.slotButtons();
  assert.equal(buttons.length, 2, "the slots were not rendered");
  // Each button carries the date, the time and the package name.
  assert.equal(buttons[0].children[0].textContent, "Mon 2 Feb");
  assert.equal(buttons[0].children[1].textContent, "9:30am–11:30am");
  assert.equal(buttons[0].children[2].textContent, "Weekday party");
  assert.equal(buttons[1].children[1].textContent, "12pm–2pm");

  // Nothing is sent until a slot has been chosen.
  assert.deepEqual(page.calls.map((c) => c.url), ["/api/slots"]);

  // The summary says how much is free and when the next slot is.
  assert.equal(
    page.summary.textContent,
    "2 slots across 1 days. The next one is Mon 2 Feb, 9:30am–11:30am."
  );

  buttons[0].fire("click", {});
  assert.equal(page.chosenEl.textContent, "Chosen: Mon 2 Feb, 9:30am–11:30am");
  assert.equal(page.form.hidden, false);
});

test("the confirmation says that the demonstration reserved nothing", async () => {
  // The server sends no message of its own, so the wording comes from the
  // page. This is the sentence that says the site is a demonstration, and it
  // must not be softened.
  const page = buildPage({
    slotResponse: SLOTS,
    bookResponse: ok({ ok: true, demo: true, ref: "ABC-123", slot: { id: 1, date: "2026-02-02", start_time: "09:30", end_time: "11:30" } }),
  });
  await page.settle();
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  const paragraph = page.successEl.children[1];
  assert.match(paragraph.textContent, /no reservation has been made and no email has been sent/);
  assert.match(paragraph.textContent, /Mon 2 Feb, 9:30am–11:30am was the slot you asked for/);
});

test("a form with everything filled in sends the request", async () => {
  const page = buildPage({
    slotResponse: SLOTS,
    bookResponse: accepted(),
  });
  await page.settle();
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  const posted = page.calls.find((c) => c.url === "/api/book");
  assert.ok(posted, "the request was not sent");
  const body = JSON.parse(posted.options.body);
  assert.equal(body.slot_id, 1);
  assert.equal(body.name, "Alex Sample");
  assert.equal(body.email, "alex@example.com");
  assert.equal(page.successEl.hidden, false);
});

test("a missing field stops the request and names the field", async () => {
  const page = buildPage({ slotResponse: SLOTS, bookResponse: ok() });
  await page.settle();
  page.slotButtons()[0].fire("click", {});
  page.fields.phone.value = "";

  await page.submit();

  assert.ok(!page.calls.some((c) => c.url === "/api/book"), "the request was sent with a field missing");
  // The message names the field: the label's own word, not the whole label.
  assert.equal(page.statusEl.textContent, "Please fill in your telephone.");
  // And that field, and only that field, is marked.
  assert.equal(page.fields.phone.getAttribute("aria-invalid"), "true");
  assert.equal(page.fields.name.getAttribute("aria-invalid"), null);
  assert.equal(page.fields.email.getAttribute("aria-invalid"), null);
});

test("a field with no label is named by its name attribute", async () => {
  const page = buildPage({ slotResponse: SLOTS, bookResponse: ok() });
  await page.settle();
  page.slotButtons()[0].fire("click", {});
  page.fields.postcode.value = "";

  await page.submit();

  assert.ok(!page.calls.some((c) => c.url === "/api/book"), "the request was sent with a field missing");
  assert.equal(page.statusEl.textContent, "Please fill in your postcode.");
});

test("an email address that does not look right is caught, and named", async () => {
  const page = buildPage({ slotResponse: SLOTS, bookResponse: ok() });
  await page.settle();
  page.slotButtons()[0].fire("click", {});
  page.fields.email.value = "not-an-address";

  await page.submit();

  assert.ok(!page.calls.some((c) => c.url === "/api/book"), "the request was sent with a bad email");
  assert.equal(page.statusEl.textContent, "That email address does not look right.");
  assert.equal(page.fields.email.getAttribute("aria-invalid"), "true");
  assert.equal(page.fields.name.getAttribute("aria-invalid"), null);
  assert.equal(page.fields.phone.getAttribute("aria-invalid"), null);
});

test("a field that breaks its own pattern is not reported as a bad email", async () => {
  // The postcode carries a pattern. It is not an email address, so a value
  // that does not match the pattern is not the email's business, and the
  // request must still go out.
  const page = buildPage({
    slotResponse: SLOTS,
    bookResponse: accepted(),
  });
  await page.settle();
  page.fields.postcode.setAttribute("pattern", "[A-Z]{2}");
  page.fields.postcode.value = "zz";
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  assert.ok(page.calls.some((c) => c.url === "/api/book"), "the request was held back");
  assert.notEqual(page.statusEl.textContent, "That email address does not look right.");
});

test("a slot that has just been taken says so, in the server's words if it has them", async () => {
  const taken = { ok: false, status: 409, json: async () => ({ ok: false }) };
  const page = buildPage({ slotResponse: SLOTS, bookResponse: taken });
  await page.settle();
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  assert.equal(page.statusEl.textContent, "That slot was just taken. Please pick another.");
  // The list is refreshed, so the visitor can pick another slot.
  assert.ok(page.calls.some((c) => c.url === "/api/slots"));
});

test("the server's own message is shown when it sends one", async () => {
  const taken = { ok: false, status: 409, json: async () => ({ ok: false, error: "That day is booked out." }) };
  const page = buildPage({ slotResponse: SLOTS, bookResponse: taken });
  await page.settle();
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  assert.equal(page.statusEl.textContent, "That day is booked out.");
});

test("a server failure says what happened, without blaming the visitor", async () => {
  const broken = { ok: false, status: 500, json: async () => ({ ok: false }) };
  const page = buildPage({ slotResponse: SLOTS, bookResponse: broken });
  await page.settle();
  page.slotButtons()[0].fire("click", {});

  await page.submit();

  assert.equal(page.statusEl.textContent, "Something went wrong. Please try again in a moment.");
});
