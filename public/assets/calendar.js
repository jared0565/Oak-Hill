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
