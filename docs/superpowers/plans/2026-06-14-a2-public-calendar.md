# A2 — Public Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Google Calendar iframe on the public `calendar.html` with our own calendar rendered from D1 (`slots` + `calendar_events`) — desktop month grid, mobile upcoming-list — so the dashboard is the single source of truth.

**Architecture:** A new public read endpoint `GET /api/calendar-events` returns events + closures (no private `notes`). A new `public/assets/calendar.js` fetches that plus the existing public `/api/slots`, and renders a grid (desktop) or list (mobile) using `createElement`/`textContent` only (strict CSP). `calendar.html` swaps the iframe for a container; `_headers` drops the Google-Calendar frame source.

**Tech Stack:** Cloudflare Pages Functions, D1, vanilla JS/CSS.

**Spec:** `docs/superpowers/specs/2026-06-14-a2-public-calendar-design.md`

**Critical correctness note (from review):** events/closures can span multiple days. Every render path MUST mark a date `d` whenever `start_date <= d && end_date >= d` — NOT only on `start_date`. The verification task seeds a multi-day closure specifically to exercise this.

---

### Task 1: Public endpoint `GET /api/calendar-events`

**Files:**
- Create: `functions/api/calendar-events.js`

- [ ] **Step 1: Write the endpoint**

```js
// GET /api/calendar-events?from=YYYY-MM-DD&to=YYYY-MM-DD
// Public, read-only list of events + closures overlapping [from, to].
// Excludes `notes` (may be private). Forgiving: bad/absent range -> empty list.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
    return Response.json({ events: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, kind, title, start_date, end_date, all_day, start_time, end_time
     FROM calendar_events
     WHERE end_date >= ? AND start_date <= ?
     ORDER BY start_date, start_time`
  ).bind(from, to).all();
  return Response.json({ events: results }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check functions/api/calendar-events.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add functions/api/calendar-events.js
git commit -m "Add public calendar-events read endpoint"
```

---

### Task 2: Public calendar renderer `calendar.js`

**Files:**
- Create: `public/assets/calendar.js`

- [ ] **Step 1: Write the module**

```js
(function () {
  const root = document.querySelector("[data-public-calendar]");
  if (!root) return;

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; // index by getUTCDay

  const now = new Date();
  let viewY = now.getUTCFullYear();
  let viewM = now.getUTCMonth();
  let slots = [], events = [];
  const mq = window.matchMedia("(max-width: 640px)");

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function fmtTime(t) { let [h, mi] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (mi ? ":" + pad(mi) : "") + ap; }
  function fmtDateLong(isoStr) { const [y, m, d] = isoStr.split("-").map(Number); const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return DAY_SHORT[wd] + " " + d + " " + MON_SHORT[m - 1]; }
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  // Multi-day aware: a date is covered if it falls within [start_date, end_date].
  const eventsOn = (d) => events.filter((e) => e.start_date <= d && e.end_date >= d);
  const isClosed = (d) => events.some((e) => e.kind === "closure" && e.start_date <= d && e.end_date >= d);
  const hasOpenSlot = (d) => slots.some((s) => s.date === d); // /api/slots already returns only open, future, non-closed

  function scrollToBook() { const b = document.getElementById("book"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function openChip() { const m = el("button", "Slots available", "pubcal-chip is-open"); m.type = "button"; m.addEventListener("click", scrollToBook); return m; }

  async function load() {
    const from = iso(viewY, viewM, 1);
    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const to = iso(viewY, viewM, lastDay);
    try {
      const [sRes, eRes] = await Promise.all([
        fetch("/api/slots", { headers: { Accept: "application/json" } }),
        fetch(`/api/calendar-events?from=${from}&to=${to}`, { headers: { Accept: "application/json" } }),
      ]);
      slots = (await sRes.json()).slots || [];
      events = (await eRes.json()).events || [];
    } catch {
      root.replaceChildren(el("p", "Couldn't load the calendar just now — please call 0208 361 1013.", "pubcal-note"));
      return;
    }
    render();
  }

  function header() {
    const head = el("div", null, "pubcal-head");
    head.appendChild(el("h3", MONTHS[viewM] + " " + viewY));
    const nav = el("div", null, "pubcal-nav");
    const prev = el("button", "‹", "button ghost"); prev.type = "button"; prev.setAttribute("aria-label", "Previous month");
    const next = el("button", "›", "button ghost"); next.type = "button"; next.setAttribute("aria-label", "Next month");
    prev.addEventListener("click", () => { if (--viewM < 0) { viewM = 11; viewY--; } load(); });
    next.addEventListener("click", () => { if (++viewM > 11) { viewM = 0; viewY++; } load(); });
    nav.append(prev, next); head.appendChild(nav);
    return head;
  }

  function render() { if (mq.matches) renderList(); else renderGrid(); }

  function renderGrid() {
    root.replaceChildren(header());
    const grid = el("div", null, "pubcal-grid");
    for (const name of DOW) grid.appendChild(el("div", name, "pubcal-dow"));
    const firstDow = new Date(Date.UTC(viewY, viewM, 1)).getUTCDay();
    const lead = (firstDow + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(el("div", null, "pubcal-cell is-empty"));
    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const t = todayISO();
    let anything = false;
    for (let d = 1; d <= lastDay; d++) {
      const date = iso(viewY, viewM, d);
      const cell = el("div", null, "pubcal-cell");
      if (date === t) cell.classList.add("is-today");
      if (date < t) cell.classList.add("is-past");
      const closed = isClosed(date);
      if (closed) cell.classList.add("is-closed");
      cell.appendChild(el("span", String(d), "pubcal-date"));
      if (closed) { cell.appendChild(el("span", "Closed", "pubcal-chip is-closure")); anything = true; }
      for (const e of eventsOn(date)) {
        if (e.kind !== "event") continue;
        cell.appendChild(el("span", (e.all_day ? "" : fmtTime(e.start_time) + " ") + e.title, "pubcal-chip is-event"));
        anything = true;
      }
      if (!closed && hasOpenSlot(date)) { cell.appendChild(openChip()); anything = true; }
      grid.appendChild(cell);
    }
    root.appendChild(grid);
    if (!anything) root.appendChild(el("p", "Nothing scheduled this month.", "pubcal-note"));
  }

  function renderList() {
    root.replaceChildren(header());
    const list = el("div", null, "pubcal-list");
    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const t = todayISO();
    let rows = 0;
    for (let d = 1; d <= lastDay; d++) {
      const date = iso(viewY, viewM, d);
      if (date < t) continue; // upcoming only on mobile
      const closed = isClosed(date);
      const evs = eventsOn(date).filter((e) => e.kind === "event");
      const open = !closed && hasOpenSlot(date);
      if (!closed && !evs.length && !open) continue;
      const row = el("div", null, "pubcal-row");
      row.appendChild(el("strong", fmtDateLong(date)));
      if (closed) row.appendChild(el("span", "Closed", "pubcal-chip is-closure"));
      for (const e of evs) row.appendChild(el("span", (e.all_day ? "" : fmtTime(e.start_time) + " ") + e.title, "pubcal-chip is-event"));
      if (open) row.appendChild(openChip());
      list.appendChild(row); rows++;
    }
    if (!rows) list.appendChild(el("p", "Nothing scheduled for the rest of this month.", "pubcal-note"));
    root.appendChild(list);
  }

  mq.addEventListener("change", render);
  load();
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/assets/calendar.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add public/assets/calendar.js
git commit -m "Add public calendar renderer (grid + mobile list)"
```

---

### Task 3: Swap the iframe in `calendar.html` and update `_headers`

**Files:**
- Modify: `public/calendar.html`
- Modify: `public/_headers`

- [ ] **Step 1: Replace the events/closures section body**

In `public/calendar.html`, find the "Events & closures" section. Replace its `section-head` lede wording and the `<iframe …>` so the section reads:

```html
    <section class="section alt">
      <div class="section-inner">
        <div class="section-head">
          <div>
            <span class="kicker">Events &amp; closures</span>
            <h2>Everything else that's on.</h2>
          </div>
          <p class="section-lede">Events and the days we're closed. For a party, pick an open slot above; this is the wider view of the month.</p>
        </div>
        <div class="pubcal" data-public-calendar><p class="pubcal-note">Loading the calendar&hellip;</p></div>
      </div>
    </section>
```

- [ ] **Step 2: Load the script**

In `public/calendar.html`, the scripts at the bottom currently include `assets/script.js` and `assets/booking.js`. Add, after `booking.js`:

```html
  <script src="assets/calendar.js" defer></script>
```

- [ ] **Step 3: Drop the Google-Calendar frame source**

In `public/_headers`, the CSP `frame-src` currently reads:
`frame-src https://maps.google.com https://www.google.com https://calendar.google.com`
Change it to (remove only the calendar source; keep the maps sources for the contact page):
`frame-src https://maps.google.com https://www.google.com`

- [ ] **Step 4: Verify the page serves**

Run: `cd public && python -m http.server 8135 >/dev/null 2>&1 &` then `sleep 1 && curl -s http://localhost:8135/calendar.html | grep -c "data-public-calendar"` (expect `1`) and `curl -s http://localhost:8135/calendar.html | grep -c "calendar.google.com"` (expect `0`). Kill the server (`pkill -f "http.server 8135"`).

- [ ] **Step 5: Commit**

```bash
git add public/calendar.html public/_headers
git commit -m "Render own public calendar; retire Google Calendar embed"
```

---

### Task 4: Public calendar styles (and remove dead iframe CSS)

**Files:**
- Modify: `public/assets/styles.css`

- [ ] **Step 1: Remove the now-unused iframe styles**

In `public/assets/styles.css`, delete the `.calendar-frame` and `.calendar-frame--tall` rules (search for `calendar-frame`). If they are the only consumers of any helper, remove those too. Do not remove anything else.

- [ ] **Step 2: Append public calendar styles**

```css
/* ---- Public calendar (calendar.html) ---- */
.pubcal-head { display: flex; align-items: center; gap: 1rem; margin: 0 0 1rem; }
.pubcal-head h3 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 1.4rem; }
.pubcal-head .pubcal-nav { margin-left: auto; display: flex; gap: 0.4rem; }
.pubcal-head .pubcal-nav .button { min-height: 40px; padding: 0.4rem 0.9rem; }
.pubcal-note { color: var(--muted); }
.pubcal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.pubcal-dow { text-align: center; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); padding: 0.25rem 0; }
.pubcal-cell { min-height: 92px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.pubcal-cell.is-empty { background: transparent; border-color: transparent; }
.pubcal-cell.is-today { outline: 2px solid var(--honey); }
.pubcal-cell.is-past { opacity: 0.5; }
.pubcal-cell.is-closed { background: repeating-linear-gradient(45deg, #f4f1ea, #f4f1ea 7px, #ece7dc 7px, #ece7dc 14px); }
.pubcal-date { font-size: 0.85rem; font-weight: 800; color: var(--ink); }
.pubcal-chip { font-size: 0.72rem; line-height: 1.25; padding: 2px 6px; border-radius: 999px; font-weight: 700; align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pubcal-chip.is-event { background: rgba(120, 183, 197, 0.22); color: #1d4633; }
.pubcal-chip.is-closure { background: #6b7280; color: #fff; }
.pubcal-chip.is-open { background: var(--park); color: #fff; border: 0; cursor: pointer; font: inherit; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; }
.pubcal-chip.is-open:hover { background: var(--park-dark); }
.pubcal-list { display: flex; flex-direction: column; gap: 0; }
.pubcal-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
.pubcal-row:last-child { border-bottom: 0; }
.pubcal-row strong { min-width: 6.5rem; }
@media (max-width: 640px) { .pubcal-head h3 { font-size: 1.2rem; } }
```

- [ ] **Step 3: Verify CSS still loads**

Run: `cd public && python -m http.server 8135 >/dev/null 2>&1 &` then `sleep 1 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8135/assets/styles.css` (expect 200) and `curl -s http://localhost:8135/assets/styles.css | grep -c "calendar-frame"` (expect `0`). Kill the server.

- [ ] **Step 4: Commit**

```bash
git add public/assets/styles.css
git commit -m "Add public calendar styles; remove dead iframe CSS"
```

---

### Task 5: Deploy and verify end-to-end (incl. a MULTI-DAY closure)

**Files:** none (verification).

- [ ] **Step 1: Local pages dev + seed data including a multi-day span**

```bash
cd "F:/Projects/Websites/Oak Hill"
npx wrangler pages dev public --port 8788 --compatibility-date 2024-11-01 > /tmp/a2dev.log 2>&1 &
# wait for up
for i in $(seq 1 15); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8788/api/slots)" = "200" ] && break || sleep 3; done
T="local-test-password"; B="http://localhost:8788"
# A future single-day event, a MULTI-DAY closure (3 days), and an open slot:
curl -s -X POST $B/api/admin/calendar-events -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"kind":"event","title":"Halloween party","start_date":"2026-10-31","all_day":1}'
curl -s -X POST $B/api/admin/calendar-events -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"kind":"closure","title":"Refurb","start_date":"2026-10-12","end_date":"2026-10-14"}'
curl -s -X POST $B/api/admin/slots -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"date":"2026-10-17","start_time":"10:00","end_time":"12:00","label":"Party slot"}'
# Public endpoint returns the events for October WITHOUT a token (200):
curl -s -w "\n[http:%{http_code}]\n" "$B/api/calendar-events?from=2026-10-01&to=2026-10-31"
```
Expected: the GET returns the event + closure, `[http:200]`, and crucially has NO `notes` field.

- [ ] **Step 2: Screenshot October at desktop AND mobile widths**

Use Playwright (or browser) to load `http://localhost:8788/calendar.html`, navigate the calendar to October 2026, and screenshot at 1280px and at 390px. **Verify specifically:**
- the **3-day closure (Oct 12, 13, 14)** is shaded and shows "Closed" on **all three** days (the multi-day path),
- the Halloween event chip shows on Oct 31,
- Oct 17 shows the "Slots available" marker, and clicking it scrolls to `#book`,
- mobile (390px) renders the **upcoming list**, not the grid.
- **Decision point:** look at whether the "Slots available" marker reads as cluttered next to the booking picker above. If it does, drop the open-slot marker (remove `hasOpenSlot`/`openChip` usage from both render paths) and re-commit; otherwise keep it.

- [ ] **Step 3: Stop local server, clean up screenshots.**

- [ ] **Step 4: Deploy**

```bash
git push origin master
```
Watch `gh run list --limit 1` until `completed success` (migrate step is a no-op now; deploy runs).

- [ ] **Step 5: Live verification**

```bash
BASE="https://oak-hill-park-cafe.pages.dev"
curl -s -o /dev/null -w "calendar-events no-token: %{http_code}\n" "$BASE/api/calendar-events?from=2026-10-01&to=2026-10-31"  # expect 200 (public)
curl -sL "$BASE/calendar.html" | grep -c "calendar.google.com"   # expect 0 (iframe gone)
curl -sL "$BASE/calendar.html" | grep -c "data-public-calendar"  # expect 1
curl -sL "$BASE/contact.html" | grep -c "maps.google.com\|google.com/maps"  # contact map link still present
```
Also load `/contact.html` in a browser and confirm the **Google Map still renders** (we kept the maps frame sources). Load `/calendar.html` and confirm the rendered calendar appears with the booking picker still working above it.

- [ ] **Step 6: Final commit (if verification fixes were needed) and push.**

---

## Self-Review

**Spec coverage:** public endpoint (T1); renderer grid+list, multi-day aware, open-slot marker, scroll-to-#book, empty/error states (T2); iframe swap + script load + CSP frame-src edit (T3); styles + dead-CSS removal (T4); deploy + multi-day verification + public-endpoint-no-token + contact-map check (T5). All spec sections map to a task.

**Type consistency:** `/api/calendar-events` returns `{ events: [{id,kind,title,start_date,end_date,all_day,start_time,end_time}] }` — consumed by `calendar.js` (`eventsOn`, `isClosed`, chip rendering using exactly those fields). `/api/slots` returns `{ slots: [{date,...}] }` — `hasOpenSlot` matches on `.date`. `[data-public-calendar]` container (T3) is the selector `calendar.js` (T2) queries. `.pubcal-*` classes used in JS are all defined in CSS (T4).

**Placeholder scan:** none — all code is complete. `local-test-password` (T5) is the documented local dev token, not a code placeholder.

**Multi-day correctness:** `eventsOn`/`isClosed` use `start_date <= d && end_date >= d` in BOTH render paths, and T5 Step 2 explicitly verifies a 3-day closure marks all three days.
