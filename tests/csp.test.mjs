// tests/csp.test.mjs
//
// The Content-Security-Policy in public/_headers is the browser-enforced half of
// the demonstration's promise. The cookie notice tells a visitor that no
// analytics or advertising tags run here; the server keeps that promise by
// serving no third-party snippet at all, and the policy is what keeps the
// browser on the same side of it.
//
// So the policy is checked here rather than left as a comment:
//
//   - it allows every source the shipped pages actually use, so that a strict
//     policy cannot quietly break the site;
//   - the shipped pages set no inline style, so `style-src 'self'` is safe by
//     construction rather than by inspection;
//   - it allows no third-party host and no inline script while the site is in
//     demonstration mode;
//   - and if the site is ever armed for real, the policy has to be widened to
//     match — the test says so instead of letting the site go live with a
//     policy that blocks the tracking-code manager and the bot check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALLOWED_SUFFIXES } from "../functions/api/_lib/snippet-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PUBLIC = join(ROOT, "public");
const PAGES = readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

// ---- the policy ----------------------------------------------------------
function csp() {
  const line = read(join("public", "_headers"))
    .split("\n")
    .find((l) => l.trim().startsWith("Content-Security-Policy:"));
  assert.ok(line, "public/_headers has no Content-Security-Policy");
  const directives = {};
  for (const part of line.slice(line.indexOf(":") + 1).split(";")) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (bits.length) directives[bits[0]] = bits.slice(1);
  }
  return directives;
}

// The hosts the tracking-code manager is allowed to load a tag from, and the
// bot check's own host. These are the only third parties the site has any
// business talking to, and only in live mode. The list is the application's
// own (functions/api/_lib/snippet-core.mjs), so the two cannot drift apart.
const TAG_HOSTS = ALLOWED_SUFFIXES;
const TURNSTILE_HOST = "challenges.cloudflare.com";

// ---- the mode the site is deployed in ------------------------------------
// The same rule the server uses (functions/api/_lib/demo.mjs): a live site
// needs DEMO_MODE=false AND LIVE_MODE_ACK=true. Anything else is a
// demonstration, and a demonstration loads no third-party tag.
function deployedMode() {
  const config = read("wrangler.jsonc");
  const value = (name) => {
    const m = config.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1].trim().toLowerCase() : "";
  };
  if (value("DEMO_MODE") === "true") return "demo";
  if (value("DEMO_MODE") === "false" && value("LIVE_MODE_ACK") === "true") return "live";
  return "unconfigured";
}

// ---- the sources the shipped pages use -----------------------------------
function pageResources() {
  const found = [];
  for (const page of PAGES) {
    const html = read(join("public", page));
    for (const m of html.matchAll(/<script[^>]+src\s*=\s*"([^"]+)"/g)) found.push(["script-src", m[1], page]);
    for (const m of html.matchAll(/<link[^>]+rel\s*=\s*"stylesheet"[^>]+href\s*=\s*"([^"]+)"/g)) found.push(["style-src", m[1], page]);
    for (const m of html.matchAll(/<link[^>]+href\s*=\s*"([^"]+)"[^>]*rel\s*=\s*"stylesheet"/g)) found.push(["style-src", m[1], page]);
    for (const m of html.matchAll(/<img[^>]+src\s*=\s*"([^"]+)"/g)) found.push(["img-src", m[1], page]);
    for (const m of html.matchAll(/<iframe[^>]+src\s*=\s*"([^"]+)"/g)) found.push(["frame-src", m[1], page]);
    for (const m of html.matchAll(/<form[^>]+action\s*=\s*"([^"]+)"/g)) found.push(["form-action", m[1], page]);
  }
  return found;
}

// ---- the checks ----------------------------------------------------------
test("the policy allows every source the shipped pages actually use", () => {
  const directives = csp();
  for (const [directive, url, page] of pageResources()) {
    const allowed = directives[directive] || directives["default-src"] || [];
    assert.ok(allowed.length, `the policy has no ${directive} to check ${page} against`);
    if (url.startsWith("/") || url.startsWith(".") || !/^[a-z]+:\/\//i.test(url)) {
      // A same-site path: the policy has to allow 'self'.
      assert.ok(
        allowed.includes("'self'"),
        `${page} loads ${url} from this site, so ${directive} must allow 'self' (it has: ${allowed.join(" ")})`
      );
      continue;
    }
    const host = new URL(url).hostname;
    assert.ok(
      allowed.some((a) => a === host || host.endsWith(a.replace(/^\*\./, "."))),
      `${page} loads ${url}, so ${directive} must allow ${host} (it allows: ${allowed.join(" ")})`
    );
  }
});

test("the shipped pages set no inline style", () => {
  // style-src is 'self' with no 'unsafe-inline', so a style attribute or a
  // CSSOM write would be silently dropped by the browser.
  for (const page of PAGES) {
    const html = read(join("public", page));
    for (const m of html.matchAll(/<[^>]+\sstyle\s*=\s*"[^"]*"/g)) {
      assert.fail(`${page} sets an inline style (${m[0]}) — style-src does not allow 'unsafe-inline'`);
    }
  }
  const scripts = readdirSync(join(PUBLIC, "assets")).filter((f) => f.endsWith(".js"));
  for (const file of scripts) {
    const src = read(join("public", "assets", file));
    assert.ok(
      !/style\.cssText\s*=/.test(src),
      `public/assets/${file} writes an inline style — style-src does not allow 'unsafe-inline'`
    );
  }
});

test("the policy matches the mode the site is deployed in", () => {
  const mode = deployedMode();
  const directives = csp();

  if (mode !== "demo") {
    // The site has been armed for real. Its tracking tags load from the hosts
    // the application allows, and its bot check loads from Cloudflare, so the
    // policy has to allow both.
    //
    // It does NOT have to allow 'unsafe-inline'. The tracking-code manager
    // pastes a tag in as an inline script today, and a live policy would
    // therefore have to allow it — but the better shape is to serve an
    // approved snippet from this origin, or to give it a nonce, so that even
    // a live policy can keep 'unsafe-inline' out. Nothing here should make
    // the looser shape the only way through, and the demonstration's own
    // policy below allows no inline script at all.
    assert.ok(
      directives["frame-src"].includes(TURNSTILE_HOST),
      `a live site loads the bot check from ${TURNSTILE_HOST}, so frame-src must allow it`
    );
    for (const host of TAG_HOSTS) {
      assert.ok(
        directives["script-src"].some((a) => a.includes(host)),
        `a live site's tracking tags may load from ${host}, so script-src must allow it`
      );
    }
    return;
  }

  // A demonstration loads no third-party tag at all, so the policy allows
  // none: the cookie notice's promise is kept in the browser as well as on
  // the server.
  assert.deepEqual(directives["script-src"], ["'self'"], "script-src must be 'self' and nothing else");
  assert.deepEqual(directives["style-src"], ["'self'"], "style-src must be 'self' and nothing else");
  assert.deepEqual(directives["connect-src"], ["'self'"], "connect-src must be 'self' and nothing else");
  assert.deepEqual(directives["frame-src"], ["'none'"], "frame-src must be 'none'");
  assert.deepEqual(directives["img-src"], ["'self'", "data:"], "img-src must be 'self' data: and nothing else");

  for (const host of [...TAG_HOSTS, TURNSTILE_HOST]) {
    for (const directive of Object.keys(directives)) {
      const allowed = directives[directive];
      assert.ok(
        !allowed.some((a) => a.includes(host)),
        `${directive} still allows ${host}, but a demonstration loads no third-party tag`
      );
    }
  }
});

test("the policy carries the protections that are not about scripts", () => {
  const directives = csp();
  assert.deepEqual(directives["default-src"], ["'self'"], "default-src must be 'self'");
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
  assert.deepEqual(directives["form-action"], ["'self'"]);
  assert.deepEqual(directives["frame-ancestors"], ["'self'"]);
});
