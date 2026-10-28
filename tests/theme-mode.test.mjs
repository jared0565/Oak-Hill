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
function makeButton() {
  const listeners = {};
  return {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn({})); },
  };
}

function runTheme({ stored = null, systemDark = false, buttonCount = 1, runs = 1 } = {}) {
  const rootAttrs = new Map();
  const store = new Map();
  if (stored) store.set("bytesfx-theme", stored);

  // One listener set per button: the staff console carries two switches, and
  // a click has to reach the one that was clicked.
  const buttons = [];
  for (let i = 0; i < buttonCount; i++) buttons.push(makeButton());

  const root = {
    setAttribute(name, value) { rootAttrs.set(name, value); },
    getAttribute(name) { return rootAttrs.has(name) ? rootAttrs.get(name) : null; },
  };

  const document = {
    documentElement: root,
    readyState: "complete",
    addEventListener() {},
    querySelectorAll(selector) {
      return selector === "[data-theme-toggle]" ? buttons : [];
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
  // "runs" loads the script more than once, the way a page that carries the
  // script tag twice would.
  for (let i = 0; i < runs; i++) {
    vm.runInContext(read("public/assets/theme.js"), context);
  }

  return {
    root,
    button: buttons[0],
    buttons,
    store,
    click() { buttons[0].fire("click"); },
    clickButton(i) { buttons[i].fire("click"); },
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

test("a page with two switches renames the one that was clicked", () => {
  // The staff console carries two switches: one in the signed-out head, one in
  // the signed-in top bar. Each has to name the action IT will take — a switch
  // still labelled "Switch to light mode" after the site has gone dark is
  // telling a screen-reader user the opposite of the truth.
  const t = runTheme({ systemDark: false, buttonCount: 2 });
  assert.equal(t.buttons[0].getAttribute("aria-label"), "Switch to dark mode");
  assert.equal(t.buttons[1].getAttribute("aria-label"), "Switch to dark mode");

  t.clickButton(0);
  assert.equal(t.root.getAttribute("data-theme"), "dark");
  assert.equal(t.buttons[0].getAttribute("aria-label"), "Switch to light mode");
  assert.equal(t.buttons[1].getAttribute("aria-label"), "Switch to light mode");
});

test("the switch is renamed when the operating system changes the theme", () => {
  // The page follows the operating system when nothing is stored, so the
  // switch has to follow it too. A switch that still says "Switch to dark
  // mode" on a dark page is naming the wrong action.
  const t = runTheme({ systemDark: false });
  assert.equal(t.button.getAttribute("aria-label"), "Switch to dark mode");

  t.systemChange(true);
  assert.equal(t.root.getAttribute("data-theme"), "dark");
  assert.equal(t.button.getAttribute("aria-label"), "Switch to light mode");
});

test("a page that loads the script twice still flips the theme once", () => {
  // Two copies of the script mean two click handlers on the same switch, and
  // a click would flip the theme and flip it straight back. The switch would
  // look dead.
  const t = runTheme({ systemDark: false, runs: 2 });
  assert.equal(t.root.getAttribute("data-theme"), "light");

  t.click();
  assert.equal(t.root.getAttribute("data-theme"), "dark");
  assert.equal(t.store.get("bytesfx-theme"), "dark");
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
  for (const token of ["--page", "--card", "--raised", "--ink", "--muted", "--line", "--brand", "--accent"]) {
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

// ---- the page --------------------------------------------------------------
// The page used to be the yellow cream that PRODUCT.md names as one of the
// generic-AI-landing-page markers. It is now warm paper: barely pink, a long
// way from the saturated yellow of a template's background. The surfaces on
// it are each a step crisper, so a card reads as an object on the paper
// rather than as another shade of the same colour.
const channel = (hex) => {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((h) => parseInt(h, 16));
  return { r, g, b };
};
const lightness = (hex) => {
  const { r, g, b } = channel(hex);
  const [cr, cg, cb] = [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
};

test("the page is warm paper, and each surface on it is a step crisper", () => {
  const css = read("public/assets/styles.css");
  const light = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  const value = (token) => {
    const m = light.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(m, `the light theme does not set ${token}`);
    return m[1].toLowerCase();
  };

  const page = value("--page");
  const card = value("--card");
  const raised = value("--raised");

  // Not the old cream, and not any other saturated yellow: the paper is
  // warm, so red is the strongest channel, but only just.
  assert.notEqual(page, "#fff7ea", "the page is back to the old cream");
  const { r, g, b } = channel(page);
  assert.ok(r >= g && g >= b, `the paper is not warm: ${page}`);
  assert.ok(r - b <= 12, `the paper is too saturated to read as paper: ${page}`);

  // The ladder: page, then a card, then a step above the card.
  assert.ok(lightness(page) < lightness(card), "a card is not crisper than the page");
  assert.ok(lightness(card) < lightness(raised), "a raised surface is not crisper than a card");
});

test("the sticky header is the page colour, so no seam shows under it", () => {
  const css = read("public/assets/styles.css");
  const light = css.match(/:root \{([\s\S]*?)\n\}/)[1];
  const page = light.match(/--page:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
  const header = light.match(/--header-bg:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  assert.ok(header, "the header has no translucent background of its own");
  const { r, g, b } = channel(page);
  assert.deepEqual(
    [Number(header[1]), Number(header[2]), Number(header[3])],
    [r, g, b],
    "the header is not the page colour"
  );
});

test("the dark page keeps the same ladder, in the other direction", () => {
  const css = read("public/assets/styles.css");
  const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
  const value = (token) => {
    const m = dark.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"));
    assert.ok(m, `the dark theme does not set ${token}`);
    return m[1].toLowerCase();
  };
  assert.ok(lightness(value("--page")) < lightness(value("--card")));
  assert.ok(lightness(value("--card")) < lightness(value("--raised")));
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
