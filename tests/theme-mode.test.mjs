// tests/theme-mode.test.mjs
//
// The light and dark mode switch. Two things have to be true at once: the
// switch has to work, and the site has to keep its promise about what it
// stores. The second is the part that is easy to break by accident — add a
// stored preference without telling the visitor, and the privacy notice
// becomes a lie.
//
// The script is exercised for real, in a sandbox with a stubbed DOM, rather
// than by reading its source: a test that only greps the file would still
// pass if the switch stopped flipping the theme.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const PUBLIC_PAGES = [
  "index.html",
  "menu.html",
  "soft-play.html",
  "parties.html",
  "calendar.html",
  "contact.html",
  "privacy.html",
  "terms.html",
  "cookies.html",
  "unsubscribe.html",
  "404.html",
];

// ---- run theme.js against a stubbed browser ------------------------------
function runTheme({ stored = null, systemDark = false } = {}) {
  const rootAttrs = new Map();
  const store = new Map();
  if (stored) store.set("bytesfx-theme", stored);

  const listeners = {};
  const button = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };

  const root = {
    setAttribute(name, value) { rootAttrs.set(name, value); },
    getAttribute(name) { return rootAttrs.has(name) ? rootAttrs.get(name) : null; },
  };

  const document = {
    documentElement: root,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll(selector) {
      return selector === "[data-theme-toggle]" ? [button] : [];
    },
  };

  // One media query object, shared by every call to matchMedia, so that the
  // page can be told the system setting changed after it has loaded.
  const mediaListeners = [];
  const media = {
    matches: systemDark,
    addEventListener(type, fn) { if (type === "change") mediaListeners.push(fn); },
    addListener(fn) { mediaListeners.push(fn); },
  };

  const context = {
    document,
    window: { matchMedia: () => media },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("public/assets/theme.js"), context);

  return {
    root,
    button,
    store,
    click() { (listeners.click || []).forEach((fn) => fn()); },
    // The operating system changes its setting, and the page is told.
    systemChange(dark) {
      media.matches = dark;
      for (const fn of mediaListeners) fn({ matches: dark });
    },
  };
}

// ---- the script ----------------------------------------------------------
test("with nothing stored, the page follows the operating system", () => {
  const dark = runTheme({ systemDark: true });
  assert.equal(dark.root.getAttribute("data-theme"), "dark");

  const light = runTheme({ systemDark: false });
  assert.equal(light.root.getAttribute("data-theme"), "light");
});

test("a stored choice beats the operating system", () => {
  const t = runTheme({ stored: "light", systemDark: true });
  assert.equal(t.root.getAttribute("data-theme"), "light");
});

test("a stored dark choice beats a light operating system", () => {
  const t = runTheme({ stored: "dark", systemDark: false });
  assert.equal(t.root.getAttribute("data-theme"), "dark");
});

test("a stored value that is not a mode is ignored", () => {
  // Something else in the browser's storage, under the same name, must not
  // be mistaken for a choice.
  const t = runTheme({ stored: "banana", systemDark: true });
  assert.equal(t.root.getAttribute("data-theme"), "dark");
  assert.equal(t.store.get("bytesfx-theme"), "banana");
});

test("with nothing stored, the page follows the operating system as it changes", () => {
  const t = runTheme({ stored: null, systemDark: false });
  assert.equal(t.root.getAttribute("data-theme"), "light");
  t.systemChange(true);
  assert.equal(t.root.getAttribute("data-theme"), "dark");
});

test("a stored choice is not overridden when the operating system changes", () => {
  const t = runTheme({ stored: "light", systemDark: false });
  assert.equal(t.root.getAttribute("data-theme"), "light");
  t.systemChange(true);
  assert.equal(t.root.getAttribute("data-theme"), "light");
});

test("nothing is stored until the visitor uses the switch", () => {
  const t = runTheme({ systemDark: true });
  assert.equal(t.store.has("bytesfx-theme"), false);
});

test("the switch flips the theme and remembers the choice", () => {
  const t = runTheme({ systemDark: false });
  assert.equal(t.root.getAttribute("data-theme"), "light");

  t.click();
  assert.equal(t.root.getAttribute("data-theme"), "dark");
  assert.equal(t.store.get("bytesfx-theme"), "dark");

  t.click();
  assert.equal(t.root.getAttribute("data-theme"), "light");
  assert.equal(t.store.get("bytesfx-theme"), "light");
});

test("the switch names the action it will take", () => {
  const t = runTheme({ systemDark: false });
  assert.equal(t.button.getAttribute("aria-label"), "Switch to dark mode");
  t.click();
  assert.equal(t.button.getAttribute("aria-label"), "Switch to light mode");
});

// ---- the markup ----------------------------------------------------------
test("every public page carries exactly one theme switch", () => {
  for (const page of PUBLIC_PAGES) {
    const html = read(join("public", page));
    const switches = html.match(/data-theme-toggle/g) || [];
    assert.equal(switches.length, 1, `${page} has ${switches.length} theme switches`);
    assert.match(html, /<script src="assets\/theme\.js"><\/script>/, `${page} does not load theme.js`);
  }
});

test("the staff console carries a switch and loads the script", () => {
  const html = read("public/admin.html");
  assert.match(html, /<script src="assets\/theme\.js"><\/script>/);
  assert.ok((html.match(/data-theme-toggle/g) || []).length >= 1);
});

// ---- the stylesheet ------------------------------------------------------
test("the stylesheet defines a dark theme that overrides the surfaces", () => {
  const css = read("public/assets/styles.css");
  const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  assert.ok(dark, "no [data-theme=\"dark\"] block in styles.css");
  for (const token of ["--cream", "--paper", "--raised", "--ink", "--muted", "--line", "--brand", "--accent"]) {
    assert.match(dark[1], new RegExp(`${token}:`), `the dark block does not set ${token}`);
  }
});

test("every colour token the stylesheet uses is defined somewhere", () => {
  const files = ["public/assets/styles.css", "public/assets/admin.css"];
  const defined = new Set();
  const used = new Set();
  for (const file of files) {
    const css = read(file);
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `undefined tokens: ${missing.join(", ")}`);
});

// ---- the disclosure ------------------------------------------------------
test("the privacy notice and the cookie notice disclose the stored preference", () => {
  for (const page of ["public/privacy.html", "public/cookies.html"]) {
    const html = read(page);
    assert.match(html, /bytesfx-theme/, `${page} does not name the stored preference`);
    assert.match(html, /light or dark|light or the dark/i, `${page} does not describe the preference`);
  }
});

test("the cookie banner says the mode preference is stored", () => {
  const consent = read("public/assets/consent.js");
  assert.match(consent, /mode preference/i);
});
