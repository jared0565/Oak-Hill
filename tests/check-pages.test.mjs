// tests/check-pages.test.mjs
//
// The page checker, tools/check-pages.mjs. It walks every public page of the
// running site in a browser and reports what is wrong with it: broken
// images, missing alt text, horizontal overflow, heading order, the demo
// notice, and console errors.
//
// The checker is a script that launches a browser the moment it is run, so it
// cannot simply be imported. Instead the file is run here in a sandbox with
// a fake browser in place of puppeteer, and a page whose DOM the test
// controls. That is enough to reach the checks that matter here: how many
// mode switches the page shows, and whether the page has said which mode it
// is in. A checker that counted a hidden switch as visible, or that accepted
// a page which had not set its mode, would pass every other test in this
// repository.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(join(ROOT, "tools/check-pages.mjs"), "utf8");

// ---- the page the checker is pointed at ------------------------------------

function makeDom({ theme = "light", switches = [{ visible: true }] } = {}) {
  const dom = { theme, switches, visited: [], stored: new Map() };

  const plain = () => ({
    getAttribute: () => null,
    getClientRects: () => [],
    parentElement: null,
  });
  const one = () => [plain()];

  const document = {
    title: "BytesFX Café & Bookings",
    body: { innerText: "BytesFX Café & Bookings — a demonstration café" },
    documentElement: {
      scrollWidth: 1280,
      getAttribute: (name) => (name === "data-theme" ? dom.theme : null),
    },
    querySelectorAll(sel) {
      switch (sel) {
        case "[data-theme-toggle]":
          return dom.switches.map((s) => ({
            getClientRects: () => (s.visible ? [{}] : []),
            getAttribute: () => null,
          }));
        case "h1":
        case ".demo-badge":
        case ".notice-box":
        case ".demo-caption":
          return one();
        default:
          return [];
      }
    },
    querySelector(sel) {
      if (sel === "link[rel=canonical]" || sel.startsWith('meta[property="og:image"]')) return null;
      return plain();
    },
    getElementById: () => null,
    createElement: () => plain(),
  };

  return { dom, document };
}

// ---- the fake browser -----------------------------------------------------

function makePuppeteer(document, dom, out) {
  const readTheme = () => dom.theme;
  return {
    async launch() {
      return {
        async newPage() {
          return {
            on() {},
            async setViewport() {},
            async goto(url) { dom.visited.push(url); },
            // Every function the checker hands to the page is run here, in the
            // page's own world, against the DOM the test set up.
            async evaluate(fn) { return fn(); },
            async waitForFunction() { return Promise.resolve(); },
            async emulateMediaFeatures() { dom.theme = "dark"; },
            async click() {
              dom.theme = readTheme() === "dark" ? "light" : "dark";
              dom.stored.set("bytesfx-theme", dom.theme);
            },
            async reload() {
              const stored = dom.stored.get("bytesfx-theme");
              if (stored) dom.theme = stored;
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
}

// ---- running the checker --------------------------------------------------

async function runChecker({ theme = "light", switches = [{ visible: true }] } = {}) {
  const { dom, document } = makeDom({ theme, switches });
  const out = [];
  const context = {
    document,
    window: { innerWidth: 1280, innerHeight: 900, scrollTo() {} },
    getComputedStyle: () => ({ backgroundColor: "rgb(255, 255, 255)", color: "rgb(0, 0, 0)" }),
    localStorage: {
      getItem: (k) => (dom.stored.has(k) ? dom.stored.get(k) : null),
      setItem: (k, v) => dom.stored.set(k, v),
    },
    process: { argv: ["node", "check-pages.mjs", "http://127.0.0.1:8792"] },
    // The checker waits for images and for transitions to settle. In a test
    // there is nothing to wait for, so the timers fire at once.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    console: { log: (...args) => out.push(args.join(" ")), error: () => {} },
  };
  context.globalThis = context;

  // The checker's own import of puppeteer is replaced by the fake, and the
  // whole file is wrapped so that its top-level awaits have somewhere to live.
  const source = `(async () => {\n${SOURCE.replace(
    'import puppeteer from "puppeteer";',
    "const puppeteer = globalThis.__fakePuppeteer;"
  )}\n})();`;
  context.__fakePuppeteer = makePuppeteer(document, dom, out);

  vm.createContext(context);
  await vm.runInContext(source, context);
  return out.join("\n");
}

// ---- the tests ------------------------------------------------------------

test("a page with one visible switch and a mode set passes", async () => {
  const out = await runChecker({ theme: "light" });
  assert.doesNotMatch(out, /theme switch count/);
  assert.doesNotMatch(out, /theme not set/);
});

test("a page in the dark mode passes too", async () => {
  const out = await runChecker({ theme: "dark" });
  assert.doesNotMatch(out, /theme switch count/);
  assert.doesNotMatch(out, /theme not set/);
});

test("two visible switches are reported", async () => {
  // The staff console carries one switch for the signed-out view and another
  // for the signed-in top bar, but only one of them is showing at a time.
  const out = await runChecker({ switches: [{ visible: true }, { visible: true }] });
  assert.match(out, /theme switch count 2/);
});

test("a hidden switch is not counted as a switch on screen", async () => {
  // One showing, one hidden: the page has one switch on screen, and the
  // checker must not count the hidden one.
  const out = await runChecker({ switches: [{ visible: true }, { visible: false }] });
  assert.doesNotMatch(out, /theme switch count/);
});

test("a page that has not said which mode it is in is reported", async () => {
  const out = await runChecker({ theme: null });
  assert.match(out, /theme not set/);
});

test("the checker walks every public page", async () => {
  const out = await runChecker();
  assert.match(out, /index\.html/);
  assert.match(out, /calendar\.html/);
  assert.match(out, /admin\.html/);
});
