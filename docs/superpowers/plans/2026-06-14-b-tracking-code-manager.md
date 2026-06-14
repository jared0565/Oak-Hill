# B — Tracking-Code Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner paste Head/Body tracking snippets (Google tag, Meta Pixel, etc.) in the dashboard — scoped global or per-page — which the site injects and executes, consent-gated, on public pages.

**Architecture:** A `code_snippets` D1 table; admin CRUD + a public `GET /api/code`; a consent-gated client injector folded into the existing `consent.js` (replacing its hardcoded GA loader), which parses each snippet with `DOMParser` and rebuilds `<script>` elements so they execute (now permitted by a relaxed CSP: curated provider allowlist + `'unsafe-inline'`). A dashboard "Tracking code" manager with an at-save host warning. Cookie/privacy policies updated.

**Tech Stack:** Cloudflare Pages Functions, D1, vanilla JS/CSS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-14-b-tracking-code-manager-design.md`

**Key risks to respect (from review):**
- **Verify with an EXTERNAL-`src` snippet**, not just inline — external `src` exercises attribute-copying + the CSP host check (a real GA4/Meta paste is external). Watch the browser console for CSP violations.
- **Two silent failures to surface:** a CSP-blocked off-allowlist host (→ at-save warning), and a consent-gated tag that the owner tests without consenting (→ explicit per-category copy; `necessary` is the run-immediately escape hatch).
- `consent.js` is a working file (banner + Consent Mode v2) — don't regress Accept/Reject/Customize.

---

### Task 1: Migration — `code_snippets`

**Files:** Create `migrations/0004_code_snippets.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0004: owner-pasted tracking snippets (Head/Body), consent-gated on the client.
CREATE TABLE IF NOT EXISTS code_snippets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  label            TEXT NOT NULL,
  code             TEXT NOT NULL,
  placement        TEXT NOT NULL DEFAULT 'head',          -- head | body_start | body_end
  scope            TEXT NOT NULL DEFAULT 'global',        -- 'global' or a page path e.g. '/parties.html'
  consent_category TEXT NOT NULL DEFAULT 'advertising',   -- necessary | analytics | advertising
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_snippets_enabled ON code_snippets(enabled);
```

- [ ] **Step 2: Apply locally** — `npx wrangler d1 migrations apply oak-hill-bookings --local` (acceptable to skip if env can't; CI applies it).
- [ ] **Step 3: Commit** — `git add migrations/0004_code_snippets.sql && git commit -m "Add code_snippets table"` (+ Co-Authored-By trailer).

---

### Task 2: Pure helpers — `snippet-core.mjs` (+ tests)

**Files:** Create `functions/api/_lib/snippet-core.mjs`, Create `tests/snippet-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/snippet-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSnippet, unknownHostsIn, pageMatchesScope } from "../functions/api/_lib/snippet-core.mjs";

test("validateSnippet: good snippet normalizes", () => {
  const v = validateSnippet({ label: "GA4", code: "<script>1</script>", placement: "head", scope: "global", consent_category: "analytics", enabled: true });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { label: "GA4", code: "<script>1</script>", placement: "head", scope: "global", consent_category: "analytics", enabled: 1 });
});

test("validateSnippet: defaults + coercions", () => {
  const v = validateSnippet({ label: "x", code: "y" });
  assert.equal(v.value.placement, "head");
  assert.equal(v.value.scope, "global");
  assert.equal(v.value.consent_category, "advertising");
  assert.equal(v.value.enabled, 1);
});

test("validateSnippet: rejects blanks + bad scope", () => {
  assert.equal(validateSnippet({ label: "", code: "y" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "y", scope: "parties" }).ok, false);
  assert.equal(validateSnippet({ label: "x", code: "y", scope: "/parties.html" }).ok, true);
});

test("unknownHostsIn: flags only non-allowlisted hosts", () => {
  assert.deepEqual(unknownHostsIn('<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>'), []);
  assert.deepEqual(unknownHostsIn('<script src="https://connect.facebook.net/en_US/fbevents.js"></script>'), []);
  assert.deepEqual(unknownHostsIn('<script src="https://evil.example.com/x.js"></script>'), ["evil.example.com"]);
  assert.deepEqual(unknownHostsIn("<script>console.log('no urls')</script>"), []);
});

test("pageMatchesScope: global, exact, .html<->clean, home, non-match", () => {
  assert.equal(pageMatchesScope("global", "/anything"), true);
  assert.equal(pageMatchesScope("/parties.html", "/parties"), true);
  assert.equal(pageMatchesScope("/parties.html", "/parties.html"), true);
  assert.equal(pageMatchesScope("/index.html", "/"), true);
  assert.equal(pageMatchesScope("/", "/index.html"), true);
  assert.equal(pageMatchesScope("/menu.html", "/parties"), false);
});
```

- [ ] **Step 2: Run — expect FAIL** (`node --test tests/snippet-core.test.mjs`).

- [ ] **Step 3: Implement**

```js
// functions/api/_lib/snippet-core.mjs
// Pure helpers for the tracking-code manager. No Workers globals — unit-testable with `node --test`.

const PLACEMENTS = new Set(["head", "body_start", "body_end"]);
const CATEGORIES = new Set(["necessary", "analytics", "advertising"]);
const SCOPE_RE = /^\/[a-z0-9-]*\.html$/;

// Mirrors the _headers CSP allowlist; used only for an advisory at-save warning.
const ALLOWED_SUFFIXES = [
  "googletagmanager.com", "google-analytics.com", "googleadservices.com", "doubleclick.net",
  "google.com", "google.co.uk", "gstatic.com", "googleapis.com",
  "facebook.net", "facebook.com", "licdn.com", "tiktok.com", "bing.com", "clarity.ms",
  "hotjar.com", "hotjar.io",
];

export function clean(v, max) { return (v == null ? "" : String(v)).trim().slice(0, max); }

export function validateSnippet(body) {
  const label = clean(body?.label, 80);
  const code = clean(body?.code, 10000);
  const placement = PLACEMENTS.has(body?.placement) ? body.placement : "head";
  const scope = clean(body?.scope, 100) || "global";
  const consent_category = CATEGORIES.has(body?.consent_category) ? body.consent_category : "advertising";
  const enabled = body?.enabled === 0 || body?.enabled === false ? 0 : 1;
  if (!label) return { ok: false, error: "Give the snippet a label." };
  if (!code) return { ok: false, error: "Paste some code." };
  if (scope !== "global" && scope !== "/" && !SCOPE_RE.test(scope)) {
    return { ok: false, error: "Scope must be 'global' or a page path like /parties.html." };
  }
  return { ok: true, value: { label, code, placement, scope, consent_category, enabled } };
}

export function extractHosts(code) {
  const hosts = new Set();
  const re = /https?:\/\/([a-z0-9.-]+)/gi;
  let m;
  while ((m = re.exec(String(code || "")))) hosts.add(m[1].toLowerCase());
  return [...hosts];
}

export function isAllowedHost(host) {
  return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

export function unknownHostsIn(code) {
  return extractHosts(code).filter((h) => !isAllowedHost(h));
}

// Client also has a mirror of this in consent.js. Normalizes Cloudflare clean URLs.
export function pageMatchesScope(scope, pathname) {
  if (scope === "global") return true;
  const strip = (p) => ((p || "/").replace(/\/+$/, "").replace(/\.html$/, "") || "/");
  let a = strip(pathname); if (a === "/index") a = "/";
  let b = strip(scope); if (b === "/index") b = "/";
  return a === b;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git add functions/api/_lib/snippet-core.mjs tests/snippet-core.test.mjs && git commit -m "Add snippet-core helpers (validate, host warning, scope match) with tests"` (+ trailer).

---

### Task 3: Admin CRUD — `code-snippets.js`

**Files:** Create `functions/api/admin/code-snippets.js`

- [ ] **Step 1: Write the endpoint**

```js
// /api/admin/code-snippets — owner CRUD for tracking snippets (auth via _middleware.js).
import { validateSnippet, unknownHostsIn } from "../_lib/snippet-core.mjs";

export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, label, code, placement, scope, consent_category, enabled, updated_at FROM code_snippets ORDER BY id"
  ).all();
  return Response.json({ snippets: results });
}

export async function onRequestPost(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const v = validateSnippet(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const s = v.value;
  const r = await ctx.env.DB
    .prepare("INSERT INTO code_snippets (label, code, placement, scope, consent_category, enabled) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(s.label, s.code, s.placement, s.scope, s.consent_category, s.enabled).run();
  return Response.json({ ok: true, id: r.meta.last_row_id, warnings: unknownHostsIn(s.code) });
}

export async function onRequestPut(ctx) {
  const body = await ctx.request.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const v = validateSnippet(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const s = v.value;
  const r = await ctx.env.DB
    .prepare("UPDATE code_snippets SET label=?, code=?, placement=?, scope=?, consent_category=?, enabled=?, updated_at=datetime('now') WHERE id=?")
    .bind(s.label, s.code, s.placement, s.scope, s.consent_category, s.enabled, id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true, warnings: unknownHostsIn(s.code) });
}

export async function onRequestDelete(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const r = await ctx.env.DB.prepare("DELETE FROM code_snippets WHERE id=?").bind(id).run();
  if (r.meta.changes !== 1) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: `node --check functions/api/admin/code-snippets.js`.**
- [ ] **Step 3: Commit** — "Add admin code-snippets CRUD endpoint" (+ trailer).

---

### Task 4: Public read — `code.js`

**Files:** Create `functions/api/code.js`

- [ ] **Step 1: Write the endpoint**

```js
// GET /api/code — enabled tracking snippets for the consent-gated client injector.
// Public: this code runs on public pages, so it is inherently public (tag IDs are not secrets).
// `label` (owner-facing) is intentionally omitted.
export async function onRequestGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    "SELECT id, code, placement, scope, consent_category FROM code_snippets WHERE enabled = 1 ORDER BY id"
  ).all();
  return Response.json({ snippets: results }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: `node --check functions/api/code.js`.**
- [ ] **Step 3: Commit** — "Add public /api/code endpoint" (+ trailer).

---

### Task 5: Rework `consent.js` into a consent-gated snippet injector

**Files:** Modify `public/assets/consent.js` (full replacement below)

- [ ] **Step 1: Replace the entire file**

```js
(function () {
  var STORAGE_KEY = "ohpc-consent";

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (!window.gtag) { window.gtag = gtag; }

  // Consent Mode v2: everything denied until the visitor chooses.
  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function readConsent() {
    try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function storeConsent(consent) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(consent)); } catch (e) { /* private mode */ }
  }

  // ---- Tracking-snippet injector (owner-pasted Head/Body code, consent-gated) ----
  var snippetsCache = null, fetched = false, injectedIds = {};

  // Mirror of snippet-core.pageMatchesScope (kept in sync; tested there).
  function pageMatchesScope(scope, pathname) {
    if (scope === "global") return true;
    function strip(p) { return ((p || "/").replace(/\/+$/, "").replace(/\.html$/, "")) || "/"; }
    var a = strip(pathname); if (a === "/index") a = "/";
    var b = strip(scope); if (b === "/index") b = "/";
    return a === b;
  }

  function categoryGranted(cat, consent) {
    if (cat === "necessary") return true;
    if (cat === "analytics") return !!consent.analytics;
    if (cat === "advertising") return !!consent.advertising;
    return false;
  }

  function injectSnippet(snippet) {
    var target = snippet.placement === "head" ? document.head : document.body;
    if (!target) return;
    var anchor = snippet.placement === "body_start" ? target.firstChild : null;
    var doc;
    try { doc = new DOMParser().parseFromString(snippet.code, "text/html"); } catch (e) { return; }
    var nodes = [];
    if (doc.head) nodes = nodes.concat(Array.prototype.slice.call(doc.head.childNodes));
    if (doc.body) nodes = nodes.concat(Array.prototype.slice.call(doc.body.childNodes));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], out;
      if (node.tagName === "SCRIPT") {
        out = document.createElement("script");
        for (var a = 0; a < node.attributes.length; a++) out.setAttribute(node.attributes[a].name, node.attributes[a].value);
        if (node.textContent) out.textContent = node.textContent;
      } else if (node.nodeType === 1 || node.nodeType === 3) {
        out = document.importNode(node, true);
      } else { continue; }
      target.insertBefore(out, anchor); // null anchor === appendChild; keeps order for body_start
    }
  }

  function runInjection(consent) {
    if (!snippetsCache) return;
    for (var i = 0; i < snippetsCache.length; i++) {
      var s = snippetsCache[i];
      if (injectedIds[s.id]) continue;
      if (!pageMatchesScope(s.scope, location.pathname)) continue;
      if (!categoryGranted(s.consent_category, consent)) continue;
      injectSnippet(s);
      injectedIds[s.id] = true;
    }
  }

  function injectConsented(consent) {
    if (fetched) { runInjection(consent); return; }
    fetched = true;
    fetch("/api/code", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { snippetsCache = (d && d.snippets) || []; runInjection(consent); })
      .catch(function () { snippetsCache = []; });
  }

  function applyConsent(consent) {
    gtag("consent", "update", {
      analytics_storage: consent.analytics ? "granted" : "denied",
      ad_storage: consent.advertising ? "granted" : "denied",
      ad_user_data: consent.advertising ? "granted" : "denied",
      ad_personalization: consent.advertising ? "granted" : "denied"
    });
    injectConsented(consent);
  }

  function buildBanner() {
    var banner = document.createElement("div");
    banner.className = "consent-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie choices");
    banner.hidden = true;
    banner.innerHTML =
      '<div class="consent-text">' +
      '<strong>Cookies at the cafe</strong>' +
      '<p>We use optional cookies only to count visits and improve the site. Nothing is set unless you allow it. See the <a href="cookies.html">cookie policy</a>.</p>' +
      '</div>' +
      '<form class="consent-options" hidden>' +
      '<label><input type="checkbox" checked disabled> Strictly necessary (always on)</label>' +
      '<label><input type="checkbox" name="analytics"> Analytics: count visits anonymously</label>' +
      '<label><input type="checkbox" name="advertising"> Advertising: measure if our local ads work</label>' +
      '</form>' +
      '<div class="consent-actions">' +
      '<button type="button" class="button" data-consent-accept>Accept all cookies</button>' +
      '<button type="button" class="button ghost" data-consent-reject>Reject optional cookies</button>' +
      '<button type="button" class="button ghost" data-consent-customise>Choose cookies</button>' +
      '<button type="button" class="button" data-consent-save hidden>Save my choices</button>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  function init() {
    var banner = buildBanner();
    var options = banner.querySelector(".consent-options");
    var customiseButton = banner.querySelector("[data-consent-customise]");
    var saveButton = banner.querySelector("[data-consent-save]");

    function showBanner(withOptions) {
      banner.hidden = false;
      var stored = readConsent();
      if (stored) {
        options.querySelector("[name='analytics']").checked = !!stored.analytics;
        options.querySelector("[name='advertising']").checked = !!stored.advertising;
      }
      if (withOptions) {
        options.hidden = false;
        customiseButton.hidden = true;
        saveButton.hidden = false;
        options.querySelector("[name='analytics']").focus();
      }
    }

    function decide(consent) {
      consent.necessary = true;
      consent.decidedAt = new Date().toISOString();
      storeConsent(consent);
      applyConsent(consent);
      banner.hidden = true;
    }

    banner.querySelector("[data-consent-accept]").addEventListener("click", function () { decide({ analytics: true, advertising: true }); });
    banner.querySelector("[data-consent-reject]").addEventListener("click", function () { decide({ analytics: false, advertising: false }); });
    customiseButton.addEventListener("click", function () { showBanner(true); });
    saveButton.addEventListener("click", function () {
      decide({ analytics: options.querySelector("[name='analytics']").checked, advertising: options.querySelector("[name='advertising']").checked });
    });

    document.querySelectorAll("[data-cookie-settings]").forEach(function (trigger) {
      trigger.addEventListener("click", function () { showBanner(true); });
    });

    var stored = readConsent();
    if (stored) { applyConsent(stored); } else { showBanner(false); }
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
```

- [ ] **Step 2: `node --check public/assets/consent.js`.**
- [ ] **Step 3: Commit** — "Replace consent.js GA loader with consent-gated snippet injector" (+ trailer).

---

### Task 6: Dashboard "Tracking code" manager

**Files:** Modify `public/admin.html`, Modify `public/assets/admin.js`, Create `public/assets/admin-tracking.js`, Modify `public/assets/styles.css`

- [ ] **Step 1: `admin.html` — add the section + load the script.** After the "Messages" section (inside `[data-admin-app]`), add:

```html
        <section class="admin-block">
          <h2>Tracking code</h2>
          <p class="section-lede">Paste tracking snippets (Google tag, Meta Pixel, etc.) to run on the public site. <strong>Necessary</strong> runs immediately; <strong>Analytics</strong>/<strong>Advertising</strong> run only after the visitor consents. Only known ad/analytics providers are allowed by the site's security policy; tags using <code>document.write</code> may not work when added this way.</p>
          <div data-tracking><p class="booking-note">Loading&hellip;</p></div>
        </section>
```

And load the script before `admin.js` (alongside `admin-availability.js`):
```html
  <script src="assets/admin-tracking.js" defer></script>
```

- [ ] **Step 2: `admin.js` — wire `refresh()`.** Change `refresh()` to also render tracking:

```js
  async function refresh() {
    await Promise.all([loadBookings(), loadEnquiries()]);
    if (window.OHPAvailability) window.OHPAvailability.render();
    if (window.OHPTracking) window.OHPTracking.render();
  }
```

- [ ] **Step 3: Create `public/assets/admin-tracking.js`**

```js
(function () {
  const KEY = "ohpc-admin-token";
  const root = document.querySelector("[data-tracking]");
  if (!root) return;

  const PAGES = [
    ["global", "All pages (global)"], ["/index.html", "Home"], ["/menu.html", "Menu"],
    ["/soft-play.html", "Soft Play"], ["/parties.html", "Parties"], ["/calendar.html", "Calendar"],
    ["/contact.html", "Contact"],
  ];
  const PLACE = [["head", "Head"], ["body_start", "Body (start)"], ["body_end", "Body (end)"]];
  const CATS = [["necessary", "Necessary (runs immediately)"], ["analytics", "Analytics (after consent)"], ["advertising", "Advertising (after consent)"]];

  const token = () => sessionStorage.getItem(KEY) || "";
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function opt(sel, pairs, val) { for (const [v, t] of pairs) { const o = new Option(t, v); if (v === val) o.selected = true; sel.appendChild(o); } return sel; }
  function labelFor(pairs, v) { const f = pairs.find((p) => p[0] === v); return f ? f[1] : v; }

  let editingId = null;

  async function render() {
    if (!token()) return;
    const res = await api("/api/admin/code-snippets");
    if (res.status === 401) { root.replaceChildren(el("p", "Session expired — sign in again.", "booking-note")); return; }
    const { snippets } = await res.json();
    root.replaceChildren();

    if (snippets && snippets.length) {
      const table = el("table", null, "admin-table");
      const head = el("tr"); ["Label", "Scope", "Placement", "Category", "On", ""].forEach((h) => head.appendChild(el("th", h)));
      table.appendChild(el("thead")).appendChild(head);
      const tbody = el("tbody");
      for (const s of snippets) {
        const tr = el("tr");
        tr.appendChild(el("td", s.label));
        tr.appendChild(el("td", labelFor(PAGES, s.scope)));
        tr.appendChild(el("td", labelFor(PLACE, s.placement)));
        tr.appendChild(el("td", labelFor(CATS, s.consent_category)));
        tr.appendChild(el("td", s.enabled ? "Yes" : "No"));
        const actions = el("td");
        const toggle = el("button", s.enabled ? "Disable" : "Enable", "button ghost admin-mini");
        toggle.addEventListener("click", () => save({ ...s, enabled: s.enabled ? 0 : 1 }, s.id));
        const edit = el("button", "Edit", "button ghost admin-mini");
        edit.addEventListener("click", () => { editingId = s.id; render().then(() => fill(s)); });
        const del = el("button", "Delete", "button ghost admin-mini");
        del.addEventListener("click", async () => { if (!confirm("Delete this snippet?")) return; const r = await api("/api/admin/code-snippets?id=" + s.id, { method: "DELETE" }); if (r.ok) { editingId = null; render(); } else alert("Could not delete."); });
        actions.append(toggle, edit, del);
        tr.appendChild(actions);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      root.appendChild(table);
    } else {
      root.appendChild(el("p", "No tracking snippets yet.", "booking-note"));
    }

    root.appendChild(form());
  }

  let fields = {};
  function form() {
    const f = document.createElement("form"); f.className = "form-panel";
    f.appendChild(el("strong", editingId ? "Edit snippet" : "Add a snippet"));
    const label = Object.assign(document.createElement("input"), { type: "text", maxLength: 80, required: true });
    const code = Object.assign(document.createElement("textarea"), { rows: 6, required: true });
    code.setAttribute("spellcheck", "false");
    const placement = opt(document.createElement("select"), PLACE);
    const scope = opt(document.createElement("select"), PAGES);
    const category = opt(document.createElement("select"), CATS);
    const enabled = Object.assign(document.createElement("input"), { type: "checkbox", checked: true });
    fields = { label, code, placement, scope, category, enabled };

    const mk = (t, node) => { const l = el("label", t + " "); l.appendChild(node); return l; };
    const grid = el("div", null, "field-grid");
    grid.append(mk("Label", label), mk("Scope", scope), mk("Placement", placement), mk("Consent category", category));
    f.appendChild(grid);
    f.appendChild(mk("Code", code));
    const en = el("label"); en.append(enabled, document.createTextNode(" Enabled")); f.appendChild(en);
    const status = el("p", null, "form-status");
    const submit = el("button", editingId ? "Save changes" : "Add snippet", "button"); submit.type = "submit";
    const actions = el("div", null, "cluster"); actions.appendChild(submit);
    if (editingId) { const cancel = el("button", "Cancel", "button ghost"); cancel.type = "button"; cancel.addEventListener("click", () => { editingId = null; render(); }); actions.appendChild(cancel); }
    f.append(actions, status);

    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "Saving…";
      const payload = { label: label.value, code: code.value, placement: placement.value, scope: scope.value, consent_category: category.value, enabled: enabled.checked ? 1 : 0 };
      const r = await save(payload, editingId, status);
    });
    return f;
  }

  function fill(s) {
    fields.label.value = s.label; fields.code.value = s.code;
    fields.placement.value = s.placement; fields.scope.value = s.scope;
    fields.category.value = s.consent_category; fields.enabled.checked = !!s.enabled;
    fields.label.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function save(payload, id, status) {
    const method = id ? "PUT" : "POST";
    const body = id ? { ...payload, id } : payload;
    const r = await api("/api/admin/code-snippets", { method, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { if (status) status.textContent = d.error || "Could not save."; else alert(d.error || "Could not save."); return; }
    if (d.warnings && d.warnings.length) alert("Saved, but these hosts are not in the allowed providers list and won't load until added to the site security policy:\n\n" + d.warnings.join("\n"));
    editingId = null; render();
  }

  window.OHPTracking = { render };
})();
```

- [ ] **Step 4: `styles.css` — minor (textarea full width in the manager).** Append:

```css
[data-tracking] textarea { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
```

- [ ] **Step 5: Verify** — `node --check public/assets/admin-tracking.js public/assets/admin.js`; serve and `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8136/admin.html` (200).
- [ ] **Step 6: Commit** — "Add tracking-code manager to the dashboard" (+ trailer).

---

### Task 7: CSP — curated allowlist + `'unsafe-inline'`

**Files:** Modify `public/_headers`

- [ ] **Step 1: Replace the `Content-Security-Policy` line** with (single line in the file):

```
  Content-Security-Policy: default-src 'self'; img-src 'self' data: https://oak-hill-park-cafe.pages.dev https://maps.gstatic.com https://maps.googleapis.com https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://www.google.co.uk https://googleads.g.doubleclick.net https://www.facebook.com https://px.ads.linkedin.com https://analytics.tiktok.com https://t.tiktok.com https://bat.bing.com https://*.clarity.ms https://*.hotjar.com; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://connect.facebook.net https://snap.licdn.com https://analytics.tiktok.com https://bat.bing.com https://www.clarity.ms https://*.clarity.ms https://static.hotjar.com https://script.hotjar.com; style-src 'self' 'unsafe-inline'; frame-src https://maps.google.com https://www.google.com https://td.doubleclick.net https://www.facebook.com; connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://www.facebook.com https://px.ads.linkedin.com https://analytics.tiktok.com https://t.tiktok.com https://bat.bing.com https://*.clarity.ms https://*.hotjar.com https://*.hotjar.io wss://*.hotjar.com; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

(Keep all other headers in `_headers` unchanged. The leading two spaces match the existing indentation under the `/*` rule.)

- [ ] **Step 2: Commit** — "Relax CSP: curated tag-provider allowlist + unsafe-inline" (+ trailer).

---

### Task 8: Legal — cookie + privacy policy

**Files:** Modify `public/cookies.html`, Modify `public/privacy.html`

- [ ] **Step 1: `cookies.html` — broaden the Advertising section.** Replace the current "Advertising" `<h2>` + paragraph with:

```html
        <h2>Analytics &amp; advertising tags</h2>
        <p>Off by default. With your consent we may run optional analytics or advertising tags to understand which pages help families and to measure whether our local ads work. These are managed by us and load <strong>only after you allow the matching category</strong>. Depending on what we're running, they may include tags from Google, Meta (Facebook Pixel), Microsoft, TikTok, LinkedIn or similar providers, each under its own privacy policy. You can change or withdraw your choice any time via <button class="link-button" type="button" data-cookie-settings>Cookie settings</button>.</p>
```

(Leave the strictly-necessary, Analytics-GA4, Embedded-services, and Changing-your-mind sections as they are. Do not promise an exact live list of active tags.)

- [ ] **Step 2: `privacy.html` — note third-party tags.** In the "Cookies and embedded services" paragraph, append a sentence:

```
 With your consent we may also run optional analytics/advertising tags (for example Google or Meta/Facebook Pixel) that process limited data under their own privacy policies; these load only after you allow the matching category and can be withdrawn via Cookie settings.
```

- [ ] **Step 3: Verify** both pages serve (200) and contain "Meta" / "Facebook Pixel".
- [ ] **Step 4: Commit** — "Update cookie + privacy policy for owner-managed consent-gated tags" (+ trailer).

---

### Task 9: Deploy and verify end-to-end (incl. an EXTERNAL-`src` snippet)

**Files:** none (verification).

- [ ] **Step 1: Full unit suite** — `node --test tests/availability-core.test.mjs tests/enquiry-core.test.mjs tests/snippet-core.test.mjs` (all pass).

- [ ] **Step 2: Local `wrangler pages dev` (config-driven) + seed three snippets**

```bash
cd "F:/Projects/Websites/Oak Hill"
npx wrangler pages dev public --port 8788 --compatibility-date 2024-11-01 > /tmp/bdev.log 2>&1 &
for i in $(seq 1 15); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8788/api/code)" = "200" ] && break || sleep 3; done
T="local-test-password"; B="http://localhost:8788"
# (a) necessary inline — should run immediately:
curl -s -X POST $B/api/admin/code-snippets -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"label":"Inline test","code":"<script>window.__ohpNecessary=1<\/script>","placement":"head","scope":"global","consent_category":"necessary"}'
# (b) analytics EXTERNAL src (allowlisted) — should run only after analytics consent, no CSP error:
curl -s -X POST $B/api/admin/code-snippets -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"label":"GTM ext","code":"<script src=\"https://www.googletagmanager.com/gtag/js?id=G-TEST123\"><\/script>","placement":"head","scope":"global","consent_category":"analytics"}'
# (c) advertising EXTERNAL src (NON-allowlisted) — POST should return a warning:
curl -s -w "\n" -X POST $B/api/admin/code-snippets -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"label":"Bad host","code":"<script src=\"https://evil.example.com/x.js\"><\/script>","placement":"head","scope":"global","consent_category":"advertising"}'
echo "--- public /api/code without token (expect 200, 3 snippets) ---"
curl -s -w "\n[http:%{http_code}]\n" $B/api/code
```
Expected: the third POST's JSON includes `"warnings":["evil.example.com"]`; `/api/code` returns 200 with the snippets and no token.

- [ ] **Step 3: Browser verification (Playwright/devtools) — the critical external-src + consent + console-CSP checks**
  Load `http://localhost:8788/` and:
  - Before consenting: `window.__ohpNecessary === 1` (necessary ran), and there is **no** `googletagmanager.com/gtag/js?id=G-TEST123` request yet (analytics gated).
  - Click **Accept all cookies**: confirm a network request to `https://www.googletagmanager.com/gtag/js?id=G-TEST123` **fires** and there is **NO Content-Security-Policy violation in the console** for it.
  - Confirm the `evil.example.com` script is **blocked by CSP** (a console CSP violation for it is the *expected, correct* behaviour — it proves the allowlist enforces).
  - **Regression:** reload, and verify the banner's **Reject** and **Choose cookies → Save** still work (no JS errors; Reject → no gtag request).
  - Load `http://localhost:8788/admin.html`, sign in (`local-test-password`), confirm the **Tracking code** manager lists the snippets and the add/edit form renders; screenshot it. Confirm **no tracking ran on the admin page** (`window.__ohpNecessary` is undefined there — consent.js isn't loaded on admin).

- [ ] **Step 4: Stop server; clean up screenshots.**

- [ ] **Step 5: Deploy** — `git push origin master`; watch `gh run list --limit 1` until `completed success` (migrate step applies 0004).

- [ ] **Step 6: Live verification**
```bash
BASE="https://oak-hill-park-cafe.pages.dev"
curl -s -o /dev/null -w "/api/code no-token: %{http_code}\n" "$BASE/api/code"        # 200
curl -sI "$BASE/" | grep -io "script-src[^;]*" | grep -o "unsafe-inline"             # present
curl -sI "$BASE/" | grep -io "connect-src[^;]*" | grep -o "google-analytics.com"     # present
```
Plus load the live home page in a browser; confirm no console CSP errors on normal load, and (optionally, with a real GA4 id the owner provides) that the tag loads after consent.

- [ ] **Step 7: Final commit if fixes were needed; push.**

---

## Self-Review

**Spec coverage:** table (T1); pure validate/host-warning/scope helpers + tests (T2); admin CRUD with warnings (T3); public `/api/code` (T4); consent.js injector rework (T5); dashboard manager + per-category copy + host-warning surfacing (T6); CSP allowlist + unsafe-inline (T7); cookie/privacy legal (T8); deploy + EXTERNAL-src + console-CSP + consent-regression verification (T9). All spec sections map to a task.

**Type consistency:** `validateSnippet` → `{ok,value:{label,code,placement,scope,consent_category,enabled}}` bound in that order in T3 INSERT/UPDATE. `/api/admin/code-snippets` GET returns those + `id,updated_at`; the manager (T6) reads them. POST/PUT return `{warnings:[host]}` surfaced by `save()` (T6). `/api/code` returns `{snippets:[{id,code,placement,scope,consent_category}]}` consumed by `injectConsented`/`runInjection` (T5). `window.OHPTracking.render` defined in T6, called in T6/Step 2 `refresh()`. `pageMatchesScope` tested in T2 and mirrored in T5 (noted).

**Placeholder scan:** none — all code complete. `local-test-password` / `G-TEST123` / `evil.example.com` are deliberate test fixtures, not placeholders.

**Risk coverage:** external-`src` path exercised (T9 Step 2b/3); console-CSP watch (T9 Step 3); off-allowlist warning (T2 `unknownHostsIn` + T3 + T6 + T9 Step 2c); consent.js regression (T9 Step 3); generic cookie wording (T8); document.write caveat (T6 copy).
