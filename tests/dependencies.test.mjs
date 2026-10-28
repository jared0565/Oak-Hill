// tests/dependencies.test.mjs
//
// This site has no build step and no runtime dependencies. The deploy workflow
// installs nothing at all — it runs `node --test` and then uploads the
// `public/` directory — so every entry in package.json's "dependencies" is a
// package that some environment would install for no reason. Puppeteer is the
// one that was there: a headless browser, used only by tools/check-pages.mjs,
// whose install script downloads a full Chromium. Listing it as a production
// dependency puts a browser download in the deploy path of a booking platform
// that never wanted a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const pkg = JSON.parse(read("package.json"));

test("the site ships no runtime npm dependencies", () => {
  const runtime = Object.keys(pkg.dependencies || {});
  assert.deepEqual(
    runtime,
    [],
    `nothing installs these at deploy time, so they belong in devDependencies: ${runtime.join(", ")}`
  );
});

test("the headless browser is a development tool", () => {
  assert.ok(
    (pkg.devDependencies || {}).puppeteer,
    "puppeteer belongs in devDependencies: it is a test tool, and its install script downloads a browser"
  );
});

test("the declared node version is one the tools can actually run on", () => {
  // Puppeteer 25 requires Node 22.12 or newer. A declared floor below that
  // lets a developer install a tree whose own tool refuses to start.
  const floor = /(\d+)\.(\d+)/.exec(String(pkg.engines?.node || ""));
  assert.ok(floor, "package.json declares no engines.node");
  const [major, minor] = [Number(floor[1]), Number(floor[2])];
  assert.ok(
    major > 22 || (major === 22 && minor >= 12),
    `engines.node is ${pkg.engines.node}, but puppeteer needs 22.12.0 or newer`
  );
});
