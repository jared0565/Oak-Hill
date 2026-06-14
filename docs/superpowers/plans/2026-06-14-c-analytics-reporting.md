# C — Analytics & Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A dashboard Reports view over the owner's own data — cookieless first-party visits/sources + enquiry/booking conversions from existing tables.

**Architecture:** An `analytics_events` table (name/path/source/ts only — no IP, no identifiers, no cookies). A public cookieless `POST /api/track` (server derives source from referrer host/utm; never reads IP). A page-view beacon folded into `script.js` (all 9 public pages) plus a guarded `slot_selected` hook in `booking.js`. An admin `GET /api/admin/reports` aggregates events + bookings + enquiries; a dashboard Reports section renders it.

**Tech Stack:** Cloudflare Pages Functions, D1, vanilla JS/CSS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-14-c-analytics-reporting-design.md`

**Compliance (hard rules):** no cookies/localStorage written by the tracker; no IP persisted (never read `cf-connecting-ip`); no unique-id/fingerprint; source = referrer **host** or `utm_source` only (never full URL); stored fields exactly `name,path,source,ts`.

**Two review-driven musts:** (1) send the beacon as explicit `application/json` (Blob for `sendBeacon`, header for `fetch`), and VERIFY by confirming a row lands in `analytics_events` — not by the 204; (2) guard the booking hook (`if (window.OHPTrack) ...`) and regression-check nav/share/forms after the `script.js` edit.

---

### Task 1: Migration — `analytics_events`

**Files:** Create `migrations/0005_analytics_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0005: first-party, cookieless, anonymous events. No IP, no user-id, no full URLs.
CREATE TABLE IF NOT EXISTS analytics_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,                       -- page_view | slot_selected
  path   TEXT,                                -- page path, e.g. /parties
  source TEXT,                                -- referrer host or utm_source ('direct' if none)
  ts     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts   ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_name ON analytics_events(name);
```

- [ ] **Step 2:** `npx wrangler d1 migrations apply oak-hill-bookings --local` (OK to skip if env can't; CI applies).
- [ ] **Step 3: Commit** — "Add analytics_events table" (+ Co-Authored-By trailer).

---

### Task 2: Pure helpers — `analytics-core.mjs` (+ tests)

**Files:** Create `functions/api/_lib/analytics-core.mjs`, Create `tests/analytics-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/analytics-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSource, validateTrackName, sanitizeDays } from "../functions/api/_lib/analytics-core.mjs";

test("deriveSource: utm wins, lowercased", () => {
  assert.equal(deriveSource("https://www.google.com/x", "Facebook", "oak-hill-park-cafe.pages.dev"), "facebook");
});
test("deriveSource: external referrer -> host only (no query leak)", () => {
  assert.equal(deriveSource("https://www.google.com/search?q=secret+personal+thing", "", "oak-hill-park-cafe.pages.dev"), "www.google.com");
});
test("deriveSource: self referrer -> direct", () => {
  assert.equal(deriveSource("https://oak-hill-park-cafe.pages.dev/menu", "", "oak-hill-park-cafe.pages.dev"), "direct");
});
test("deriveSource: empty / garbage -> direct", () => {
  assert.equal(deriveSource("", "", "x.pages.dev"), "direct");
  assert.equal(deriveSource("not a url", "", "x.pages.dev"), "direct");
});
test("validateTrackName: allowlist only", () => {
  assert.equal(validateTrackName("page_view"), true);
  assert.equal(validateTrackName("slot_selected"), true);
  assert.equal(validateTrackName("evil"), false);
  assert.equal(validateTrackName(""), false);
});
test("sanitizeDays: 7/30/90 else 30", () => {
  assert.equal(sanitizeDays("7"), 7);
  assert.equal(sanitizeDays(30), 30);
  assert.equal(sanitizeDays("90"), 90);
  assert.equal(sanitizeDays("5"), 30);
  assert.equal(sanitizeDays("abc"), 30);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `functions/api/_lib/analytics-core.mjs`

```js
// functions/api/_lib/analytics-core.mjs
// Pure helpers for first-party analytics. No Workers globals — unit-testable with `node --test`.

const TRACK_NAMES = new Set(["page_view", "slot_selected"]);

export function clean(v, max) { return (v == null ? "" : String(v)).trim().slice(0, max); }

export function validateTrackName(name) { return TRACK_NAMES.has(name); }

export function sanitizeDays(d) { const n = Number(d); return [7, 30, 90].includes(n) ? n : 30; }

// Returns a host or campaign token only — never a full URL/query string (privacy).
export function deriveSource(referrer, utm, selfHost) {
  const u = clean(utm, 60).toLowerCase();
  if (u) return u;
  const r = clean(referrer, 500);
  if (!r) return "direct";
  let host = "";
  try { host = new URL(r).hostname.toLowerCase(); } catch (e) { return "direct"; }
  if (!host || host === clean(selfHost, 200).toLowerCase()) return "direct";
  return host.slice(0, 120);
}
```

- [ ] **Step 4: Run — expect PASS (6 tests).**
- [ ] **Step 5: Commit** — "Add analytics-core helpers with tests" (+ trailer).

---

### Task 3: Public endpoint — `POST /api/track`

**Files:** Create `functions/api/track.js`

- [ ] **Step 1: Write the endpoint**

```js
// POST /api/track — first-party, cookieless event capture. Returns 204.
// COMPLIANCE: never reads/stores the client IP; stores only name/path/source/ts.
import { validateTrackName, deriveSource } from "./_lib/analytics-core.mjs";

export async function onRequestPost(ctx) {
  let body;
  try { body = await ctx.request.json(); } catch (e) { return new Response(null, { status: 204 }); }
  if (!body || !validateTrackName(body.name)) return new Response(null, { status: 204 });
  const path = (body.path == null ? "" : String(body.path)).trim().slice(0, 200) || null;
  const selfHost = new URL(ctx.request.url).hostname;
  const source = deriveSource(body.referrer, body.utm, selfHost);
  try {
    await ctx.env.DB
      .prepare("INSERT INTO analytics_events (name, path, source) VALUES (?, ?, ?)")
      .bind(body.name, path, source).run();
  } catch (e) { /* analytics must never surface an error to the client */ }
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 2:** `node --check functions/api/track.js`.
- [ ] **Step 3: Commit** — "Add public /api/track endpoint (cookieless, no IP)" (+ trailer).

---

### Task 4: Admin endpoint — `GET /api/admin/reports`

**Files:** Create `functions/api/admin/reports.js`

- [ ] **Step 1: Write the endpoint**

```js
// /api/admin/reports?days=N — aggregate analytics + conversions (auth via _middleware.js).
import { sanitizeDays } from "../_lib/analytics-core.mjs";

export async function onRequestGet(ctx) {
  const days = sanitizeDays(new URL(ctx.request.url).searchParams.get("days"));
  const cutoff = "-" + days + " days";
  const db = ctx.env.DB;
  const [visits, slotSel, topPages, topSources, enquiries, bookings] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE name='slot_selected' AND ts >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT path, COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?) GROUP BY path ORDER BY n DESC LIMIT 8").bind(cutoff).all(),
    db.prepare("SELECT source, COUNT(*) AS n FROM analytics_events WHERE name='page_view' AND ts >= datetime('now', ?) GROUP BY source ORDER BY n DESC LIMIT 8").bind(cutoff).all(),
    db.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= datetime('now', ?)").bind(cutoff).first(),
    db.prepare("SELECT status, COUNT(*) AS n FROM bookings WHERE created_at >= datetime('now', ?) GROUP BY status").bind(cutoff).all(),
  ]);
  const b = { pending: 0, confirmed: 0, cancelled: 0 };
  for (const row of bookings.results) if (Object.prototype.hasOwnProperty.call(b, row.status)) b[row.status] = row.n;
  return Response.json({
    days,
    visits: visits.n, slotSelected: slotSel.n,
    topPages: topPages.results, topSources: topSources.results,
    enquiries: enquiries.n, bookings: b,
  });
}
```

- [ ] **Step 2:** `node --check functions/api/admin/reports.js`.
- [ ] **Step 3: Commit** — "Add admin reports aggregation endpoint" (+ trailer).

---

### Task 5: Page-view tracker (`script.js`) + `slot_selected` hook (`booking.js`)

**Files:** Modify `public/assets/script.js`, Modify `public/assets/booking.js`

- [ ] **Step 1: Append the tracker block to the END of `public/assets/script.js`**

```js

// ---- First-party, cookieless page analytics (no cookies, no localStorage, no IP, no identifiers) ----
(function () {
  function send(name) {
    try {
      var payload = JSON.stringify({
        name: name,
        path: location.pathname,
        referrer: name === "page_view" ? document.referrer : "",
        utm: name === "page_view" ? (new URLSearchParams(location.search).get("utm_source") || "") : ""
      });
      var blob = null;
      try { blob = new Blob([payload], { type: "application/json" }); } catch (e) { blob = null; }
      if (navigator.sendBeacon && blob) { navigator.sendBeacon("/api/track", blob); }
      else { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }); }
    } catch (e) { /* analytics must never break the page */ }
  }
  window.OHPTrack = send;
  send("page_view");
})();
```

- [ ] **Step 2: Add the guarded hook in `public/assets/booking.js`**

Find the `function choose(slot, btn) {` body. As its FIRST line inside the function, add:

```js
    if (window.OHPTrack) window.OHPTrack("slot_selected");
```

(Guarded so a tracker problem can never break slot selection.)

- [ ] **Step 3:** `node --check public/assets/script.js public/assets/booking.js`.
- [ ] **Step 4: Commit** — "Add cookieless page-view tracker and slot_selected hook" (+ trailer).

---

### Task 6: Dashboard Reports section

**Files:** Modify `public/admin.html`, Modify `public/assets/admin.js`, Create `public/assets/admin-reports.js`, Modify `public/assets/styles.css`

- [ ] **Step 1: `admin.html` — add the section (after "Bookings", before "Messages" is fine; place after "Availability").** Inside `[data-admin-app]`:

```html
        <section class="admin-block">
          <h2>Reports</h2>
          <p class="section-lede">Visits and traffic are counted anonymously with no cookies. Booking and enquiry numbers come from your live data.</p>
          <div data-reports><p class="booking-note">Loading&hellip;</p></div>
        </section>
```

And load the script alongside the other admin modules (before `admin.js`):
```html
  <script src="assets/admin-reports.js" defer></script>
```

- [ ] **Step 2: `admin.js` — wire `refresh()`.** Add the reports render call:

```js
  async function refresh() {
    await Promise.all([loadBookings(), loadEnquiries()]);
    if (window.OHPAvailability) window.OHPAvailability.render();
    if (window.OHPTracking) window.OHPTracking.render();
    if (window.OHPReports) window.OHPReports.render();
  }
```

(Add only the OHPReports line; keep the others as they are.)

- [ ] **Step 3: Create `public/assets/admin-reports.js`**

```js
(function () {
  const KEY = "ohpc-admin-token";
  const root = document.querySelector("[data-reports]");
  if (!root) return;

  const token = () => sessionStorage.getItem(KEY) || "";
  const api = (path) => fetch(path, { headers: { Authorization: "Bearer " + token() } });
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  let days = 30;

  async function render() {
    if (!token()) return;
    const res = await api("/api/admin/reports?days=" + days);
    if (res.status === 401) { root.replaceChildren(el("p", "Session expired — sign in again.", "booking-note")); return; }
    const r = await res.json();
    root.replaceChildren();

    const switcher = el("div", null, "report-switch");
    [7, 30, 90].forEach((d) => {
      const b = el("button", "Last " + d + " days", "button ghost admin-mini" + (d === days ? " is-active" : ""));
      b.type = "button";
      b.addEventListener("click", () => { days = d; render(); });
      switcher.appendChild(b);
    });
    root.appendChild(switcher);

    const stats = el("div", null, "report-stats");
    const stat = (label, value) => { const c = el("div", null, "report-stat"); c.appendChild(el("strong", String(value))); c.appendChild(el("span", label)); return c; };
    stats.append(
      stat("Visits", r.visits),
      stat("Slot selections", r.slotSelected),
      stat("Enquiries", r.enquiries),
      stat("Bookings (held)", r.bookings.pending),
      stat("Bookings (paid)", r.bookings.confirmed)
    );
    root.appendChild(stats);

    const funnel = el("p", null, "report-funnel");
    funnel.textContent = "Funnel: " + r.visits + " visits → " + r.slotSelected + " slot selections → " + (r.bookings.pending + r.bookings.confirmed) + " bookings";
    root.appendChild(funnel);

    root.appendChild(listBlock("Top pages", r.topPages, (x) => (x.path || "(unknown)") + " — " + x.n));
    root.appendChild(listBlock("Top sources", r.topSources, (x) => (x.source || "direct") + " — " + x.n));
  }

  function listBlock(title, rows, fmt) {
    const wrap = el("div", null, "report-list");
    wrap.appendChild(el("h3", title));
    if (!rows || !rows.length) { wrap.appendChild(el("p", "No data yet.", "booking-note")); return wrap; }
    const ul = el("ul");
    for (const x of rows) ul.appendChild(el("li", fmt(x)));
    wrap.appendChild(ul);
    return wrap;
  }

  window.OHPReports = { render };
})();
```

- [ ] **Step 4: `styles.css` — append**

```css
.report-switch { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem; }
.report-switch .is-active { background: var(--park); color: #fff; }
.report-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
.report-stat { border: 1px solid var(--line); border-radius: var(--radius); padding: 0.9rem; background: #fff; text-align: center; }
.report-stat strong { display: block; font-size: 1.6rem; color: var(--park-dark); }
.report-stat span { font-size: 0.8rem; color: var(--muted); }
.report-funnel { font-weight: 700; color: var(--ink); }
.report-list { margin-top: 1rem; }
.report-list ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
```

- [ ] **Step 5:** `node --check public/assets/admin-reports.js public/assets/admin.js`; serve and `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8137/admin.html` (200), `grep -c OHPReports public/assets/admin.js` (1).
- [ ] **Step 6: Commit** — "Add Reports dashboard section" (+ trailer).

---

### Task 7: Legal — anonymous cookieless counting note

**Files:** Modify `public/cookies.html`, Modify `public/privacy.html`

- [ ] **Step 1: `cookies.html`** — after the "Strictly necessary" section's table, add:

```html
        <h2>Counting visits (no cookies)</h2>
        <p>We count anonymous page visits to see which pages help families. This uses <strong>no cookies and stores nothing on your device</strong>, and we keep <strong>no IP address or anything that identifies you</strong> — so it needs no consent. The optional Google Analytics described above is separate and only runs if you allow it.</p>
```

- [ ] **Step 2: `privacy.html`** — in the "Cookies and embedded services" paragraph, append:

```
 We also count anonymous page visits with no cookies and no IP address or identifying data, which is not personal data.
```

- [ ] **Step 3:** confirm both serve (200) and contain "no cookies".
- [ ] **Step 4: Commit** — "Note anonymous cookieless visit counting in policies" (+ trailer).

---

### Task 8: Deploy and verify (row-lands + no-storage + regression)

**Files:** none (verification).

- [ ] **Step 1: Full unit suite** — `node --test tests/availability-core.test.mjs tests/enquiry-core.test.mjs tests/snippet-core.test.mjs tests/analytics-core.test.mjs` (all pass).

- [ ] **Step 2: Local `wrangler pages dev` (config-driven).** Then in a browser at `http://localhost:8788/`:
  - **THE check (row lands, not the 204):** after the page loads, query the DB and confirm a `page_view` row exists:
    `npx wrangler d1 execute oak-hill-bookings --local --command "SELECT name,path,source FROM analytics_events ORDER BY id DESC LIMIT 3"` → shows a `page_view` row with `path=/` and a `source` (host/`direct`) and **no other columns of PII**.
  - **No on-device storage (compliance):** in the console, `document.cookie` contains no analytics cookie and `Object.keys(localStorage)` has no analytics key (only `ohpc-consent` may exist from the banner).
  - Visit `/calendar.html`, click a slot → a `slot_selected` row lands.
  - **Regression after the `script.js` edit:** confirm the nav menu toggles, the Share modal opens, and a contact/party form submits (no JS errors in console).
  - Sign into `/admin.html`, open **Reports**: switch 7/30/90 days, confirm Visits/Slot selections/Enquiries/Bookings render and Top pages/sources list. Screenshot it.

- [ ] **Step 3: Stop server; clean up screenshots.**

- [ ] **Step 4: Deploy** — `git push origin master`; watch CI to `completed success` (migrate applies 0005).

- [ ] **Step 5: Live verification**
```bash
BASE="https://oak-hill-park-cafe.pages.dev"
curl -s -o /dev/null -w "track POST: %{http_code}\n" -X POST "$BASE/api/track" -H "Content-Type: application/json" -d '{"name":"page_view","path":"/","referrer":"","utm":""}'   # 204
curl -s -o /dev/null -w "reports no-token: %{http_code}\n" "$BASE/api/admin/reports?days=30"   # 401
curl -sL "$BASE/cookies.html" | grep -c "no cookies"   # >=1
```
Load the live home page; confirm a `POST /api/track` fires (Network) and **no cookie is set** by it.

- [ ] **Step 6: Final commit if fixes were needed; push.**

**Operational note (logged, not built):** `/api/track` is an unauthenticated D1 write on every page load. Accepted for a cafe. If abuse/cost ever appears, the compliance-preserving fix is a **Cloudflare edge rate-limit rule** (throttles by IP at the edge without storing IP in our data) — an infra change, not code.

---

## Self-Review

**Spec coverage:** table (T1); pure helpers + tests (T2); cookieless `/api/track` no-IP (T3); reports aggregation (T4); page-view beacon + guarded slot hook (T5); Reports dashboard (T6); legal notes (T7); deploy + row-lands + no-storage + regression verification (T8). All spec sections map to a task.

**Compliance check:** stored columns are exactly `name,path,source,ts` (T1); `/api/track` never references `cf-connecting-ip` and derives source via host/utm only (T3, T2 `deriveSource` proven by the "no query leak" test); tracker writes no cookie/storage (T5) and T8 asserts it; policies updated (T7).

**Type consistency:** `deriveSource(referrer, utm, selfHost)`, `validateTrackName(name)`, `sanitizeDays(d)` used identically in T3/T4. `/api/admin/reports` returns `{days,visits,slotSelected,topPages:[{path,n}],topSources:[{source,n}],enquiries,bookings:{pending,confirmed,cancelled}}` consumed exactly by `admin-reports.js` (T6). `window.OHPTrack` defined in T5, called (guarded) in T5/booking.js; `window.OHPReports.render` defined in T6, called in T6 `refresh()`.

**Placeholder scan:** none — all code complete. Beacon uses an explicit `application/json` Blob (+ fetch header fallback) so the body always parses server-side (review item #1).
