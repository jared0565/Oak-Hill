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
