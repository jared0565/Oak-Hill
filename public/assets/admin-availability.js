(function () {
  const KEY = "ohpc-admin-token";
  const root = document.querySelector("[data-availability]");
  if (!root) return;

  const token = () => sessionStorage.getItem(KEY) || "";
  const api = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];   // display order Mon-first
  const DOW_NUM = [1,2,3,4,5,6,0];                            // matching getUTCDay values

  const now = new Date();
  let viewY = now.getUTCFullYear();
  let viewM = now.getUTCMonth();                              // 0-based
  let slots = [], events = [];
  let openDate = null;

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function fmtTime(t) { let [h, mi] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (mi ? ":" + pad(mi) : "") + ap; }
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  async function load() {
    if (!token()) return;
    const from = iso(viewY, viewM, 1);
    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const to = iso(viewY, viewM, lastDay);
    const [sRes, eRes] = await Promise.all([api("/api/admin/slots"), api(`/api/admin/calendar-events?from=${from}&to=${to}`)]);
    if (sRes.status === 401 || eRes.status === 401) { root.replaceChildren(el("p", "Session expired — sign in again.", "booking-note")); return; }
    slots = (await sRes.json()).slots || [];
    events = (await eRes.json()).events || [];
    render();
  }

  const slotsOn = (d) => slots.filter((s) => s.date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const eventsOn = (d) => events.filter((e) => e.start_date <= d && e.end_date >= d);
  const isClosed = (d) => events.some((e) => e.kind === "closure" && e.start_date <= d && e.end_date >= d);
  function slotState(s) { if (s.status === "booked") return "booked"; if (s.status === "closed") return "closed"; if (Number(s.holds) > 0) return "held"; return "available"; }

  function render() {
    root.replaceChildren();

    const head = el("div", null, "cal-head");
    head.appendChild(el("h3", MONTHS[viewM] + " " + viewY));
    const nav = el("div", null, "cal-nav");
    const prev = el("button", "‹", "button ghost admin-mini"); prev.type = "button";
    const next = el("button", "›", "button ghost admin-mini"); next.type = "button";
    prev.addEventListener("click", () => { if (--viewM < 0) { viewM = 11; viewY--; } openDate = null; load(); });
    next.addEventListener("click", () => { if (++viewM > 11) { viewM = 0; viewY++; } openDate = null; load(); });
    nav.append(prev, next);
    head.appendChild(nav);
    root.appendChild(head);

    const grid = el("div", null, "cal-grid");
    for (const name of DOW) grid.appendChild(el("div", name, "cal-dow"));

    // Lead blanks so the 1st lands under its weekday (Mon-first).
    const firstDow = new Date(Date.UTC(viewY, viewM, 1)).getUTCDay();   // 0=Sun..6=Sat
    const lead = (firstDow + 6) % 7;                                    // Mon=0..Sun=6
    for (let i = 0; i < lead; i++) grid.appendChild(el("div", null, "cal-cell is-empty"));

    const lastDay = new Date(Date.UTC(viewY, viewM + 1, 0)).getUTCDate();
    const t = todayISO();
    for (let d = 1; d <= lastDay; d++) {
      const date = iso(viewY, viewM, d);
      const cell = el("button", null, "cal-cell"); cell.type = "button";
      if (date === t) cell.classList.add("is-today");
      if (date < t) cell.classList.add("is-past");
      if (isClosed(date)) cell.classList.add("is-closed");
      cell.appendChild(el("span", String(d), "cal-date"));
      for (const s of slotsOn(date)) {
        const st = slotState(s);
        const chip = el("span", fmtTime(s.start_time) + " " + s.label, "cal-chip s-" + st);
        cell.appendChild(chip);
        if (isClosed(date) && (st === "booked" || st === "held")) cell.appendChild(el("span", "⚠ closure clashes with a booking", "cal-warn"));
      }
      for (const e of eventsOn(date)) cell.appendChild(el("span", (e.kind === "closure" ? "Closed: " : "") + e.title, "cal-chip e-" + e.kind));
      cell.addEventListener("click", () => { openDate = date; render(); });
      grid.appendChild(cell);
    }
    root.appendChild(grid);

    if (openDate) root.appendChild(dayPanel(openDate));
    root.appendChild(bulkTool());
  }

  function dayPanel(date) {
    const panel = el("div", null, "cal-day-panel");
    panel.appendChild(el("h3", "Manage " + date));

    for (const s of slotsOn(date)) {
      const row = el("div", null, "cal-row");
      row.appendChild(el("span", fmtTime(s.start_time) + "–" + fmtTime(s.end_time) + " · " + s.label + " · " + slotState(s)));
      if (s.status !== "booked") {
        const close = el("button", s.status === "closed" ? "Re-open" : "Close", "button ghost admin-mini"); close.type = "button";
        close.addEventListener("click", () => putSlot({ id: s.id, status: s.status === "closed" ? "available" : "closed" }));
        const del = el("button", "Delete", "button ghost admin-mini"); del.type = "button";
        del.addEventListener("click", () => { if (confirm("Delete this slot?")) delSlot(s.id); });
        row.append(close, del);
      }
      panel.appendChild(row);
    }
    for (const e of eventsOn(date)) {
      const row = el("div", null, "cal-row");
      row.appendChild(el("span", (e.kind === "closure" ? "Closure: " : "Event: ") + e.title));
      const del = el("button", "Delete", "button ghost admin-mini"); del.type = "button";
      del.addEventListener("click", () => { if (confirm("Delete this " + e.kind + "?")) delEvent(e.id); });
      row.appendChild(del);
      panel.appendChild(row);
    }

    const forms = el("div", null, "cal-forms");
    forms.appendChild(addSlotForm(date));
    forms.appendChild(addEventForm(date));
    panel.appendChild(forms);
    return panel;
  }

  function field(labelText, inputEl) { const l = el("label", labelText + " "); l.appendChild(inputEl); return l; }
  function input(attrs) { const i = document.createElement("input"); Object.assign(i, attrs); return i; }

  function addSlotForm(date) {
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Add a slot"));
    const start = input({ type: "time", required: true });
    const end = input({ type: "time", required: true });
    const label = input({ type: "text", value: "Party slot", maxLength: 60 });
    form.append(field("Start", start), field("End", end), field("Label", label));
    const status = el("p", null, "form-status");
    const btn = el("button", "Add slot", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "Adding…";
      const r = await api("/api/admin/slots", { method: "POST", body: JSON.stringify({ date, start_time: start.value, end_time: end.value, label: label.value }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) load(); else status.textContent = d.error || "Could not add.";
    });
    return form;
  }

  function addEventForm(date) {
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Add an event or closure"));
    const kind = document.createElement("select");
    kind.append(new Option("Event", "event"), new Option("Closure (blocks bookings)", "closure"));
    const title = input({ type: "text", required: true, maxLength: 120 });
    const endDate = input({ type: "date", value: date });
    form.append(field("Type", kind), field("Title", title), field("Through date", endDate));
    const status = el("p", null, "form-status");
    const btn = el("button", "Add", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "Adding…";
      const r = await api("/api/admin/calendar-events", { method: "POST", body: JSON.stringify({ kind: kind.value, title: title.value, start_date: date, end_date: endDate.value || date, all_day: 1 }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) load(); else status.textContent = d.error || "Could not add.";
    });
    return form;
  }

  function bulkTool() {
    const wrap = el("div", null, "cal-bulk");
    const form = document.createElement("form"); form.className = "form-panel";
    form.appendChild(el("strong", "Bulk-add recurring slots"));
    const from = input({ type: "date", required: true });
    const to = input({ type: "date", required: true });
    form.append(field("From", from), field("To", to));

    const dows = el("div", null, "cal-dows");
    const boxes = DOW.map((name, i) => { const cb = input({ type: "checkbox", value: String(DOW_NUM[i]) }); const l = el("label"); l.append(cb, document.createTextNode(" " + name)); dows.appendChild(l); return cb; });
    form.append(el("span", "Weekdays"), dows);

    const times = [];
    const timesWrap = el("div");
    function addTimeRow(s = "10:00", e = "12:00", lab = "Party slot") {
      const row = el("div", null, "cal-time-row");
      const st = input({ type: "time", value: s }), en = input({ type: "time", value: e }), lb = input({ type: "text", value: lab, maxLength: 60 });
      const rm = el("button", "×", "button ghost admin-mini"); rm.type = "button";
      const entry = { st, en, lb };
      rm.addEventListener("click", () => { timesWrap.removeChild(row); times.splice(times.indexOf(entry), 1); });
      row.append(st, en, lb, rm); timesWrap.appendChild(row); times.push(entry);
    }
    addTimeRow();
    const addTimeBtn = el("button", "+ time", "button ghost admin-mini"); addTimeBtn.type = "button";
    addTimeBtn.addEventListener("click", () => addTimeRow());
    form.append(el("span", "Weekdays"), timesWrap, addTimeBtn);

    const status = el("p", null, "form-status");
    const btn = el("button", "Generate slots", "button admin-mini"); btn.type = "submit";
    form.append(btn, status);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const weekdays = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      const t = times.map((x) => ({ start: x.st.value, end: x.en.value, label: x.lb.value }));
      status.textContent = "Generating…";
      const r = await api("/api/admin/slots", { method: "POST", body: JSON.stringify({ recurrence: { start_date: from.value, end_date: to.value, weekdays, times: t } }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { status.textContent = `Added ${d.added}, skipped ${d.skipped} duplicate(s).`; load(); }
      else status.textContent = d.error || "Could not generate.";
    });
    wrap.appendChild(form);
    return wrap;
  }

  async function putSlot(body) { const r = await api("/api/admin/slots", { method: "PUT", body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not update."); }
  async function delSlot(id) { const r = await api("/api/admin/slots?id=" + id, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not delete."); }
  async function delEvent(id) { const r = await api("/api/admin/calendar-events?id=" + id, { method: "DELETE" }); const d = await r.json().catch(() => ({})); if (r.ok) load(); else alert(d.error || "Could not delete."); }

  window.OHPAvailability = { render: load };
})();
