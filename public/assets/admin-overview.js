// admin-overview.js — the Overview home page. Fetches GET /api/admin/overview (one
// round-trip) and renders permission-gated KPI cards, a recent-bookings list, and quick
// actions. The server already omits any block the caller can't see, so a card only renders
// when its block is present in the response. DOM is built with createElement — no innerHTML
// with server data.
(function () {
  const api = (p, o) => window.OHPAdmin.api(p, o);
  const mount = document.querySelector("[data-overview]");

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
    const [y, m, d] = iso.split("-").map(Number);
    return d + " " + MONTHS[m - 1] + " " + y;
  }

  function kpiCard(value, label) {
    const card = el("div", null, "admin-kpi");
    card.appendChild(el("span", String(value), "admin-kpi-value"));
    card.appendChild(el("span", label, "admin-kpi-label"));
    return card;
  }

  function recentList(recent) {
    const wrap = el("div", null, "admin-recent");
    if (!recent || !recent.length) {
      wrap.appendChild(el("p", "No bookings yet.", "booking-note"));
      return wrap;
    }
    for (const b of recent) {
      const row = el("a");
      row.href = "#bookings";
      row.appendChild(el("span", b.ref || "", "admin-recent-ref"));
      row.appendChild(el("span", b.name || "", "admin-recent-name"));
      row.appendChild(el("span", fmtDate(b.date) + " · " + (b.status || ""), "admin-recent-meta"));
      wrap.appendChild(row);
    }
    return wrap;
  }

  function quickActions(data) {
    const actions = [];
    if (data.bookings) actions.push(["View bookings", "#bookings"]);
    if (data.messages) actions.push(["View messages", "#messages"]);
    if (data.availability) actions.push(["Manage availability", "#availability"]);
    if (data.reports) actions.push(["Open reports", "#reports"]);
    if (!actions.length) return null;
    const wrap = el("div", null, "admin-quick");
    for (const [label, hash] of actions) {
      const a = el("a", label, "button ghost");
      a.href = hash;
      wrap.appendChild(a);
    }
    return wrap;
  }

  async function render() {
    if (!mount) return;
    mount.replaceChildren(el("p", "Loading…", "booking-note"));

    let data = {};
    try {
      const res = await api("/api/admin/overview");
      if (res.status === 401) { mount.replaceChildren(); return; } // admin.js handles re-login
      data = await res.json().catch(() => ({}));
    } catch (_) {
      mount.replaceChildren(el("p", "Could not load the overview.", "booking-note"));
      return;
    }

    const frag = document.createDocumentFragment();

    // KPI cards — only those present in the response (server permission-gates them).
    const kpis = el("div", null, "admin-kpis");
    if (data.bookings) kpis.appendChild(kpiCard(data.bookings.pending ?? 0, "Pending bookings"));
    if (data.messages) kpis.appendChild(kpiCard(data.messages.unread ?? 0, "Unread messages"));
    if (data.availability) kpis.appendChild(kpiCard(data.availability.openSlots14d ?? 0, "Open slots (14d)"));
    if (data.reports) kpis.appendChild(kpiCard(data.reports.visits7d ?? 0, "Visits (7d)"));
    if (kpis.childElementCount) frag.appendChild(kpis);

    // Recent bookings + quick actions.
    const cols = el("div", null, "admin-overview-cols");
    if (data.bookings) {
      const recentCard = el("div", null, "admin-card");
      recentCard.appendChild(el("h3", "Recent bookings"));
      recentCard.appendChild(recentList(data.bookings.recent));
      cols.appendChild(recentCard);
    }
    const quick = quickActions(data);
    if (quick) {
      const quickCard = el("div", null, "admin-card");
      quickCard.appendChild(el("h3", "Quick actions"));
      quickCard.appendChild(quick);
      cols.appendChild(quickCard);
    }
    if (cols.childElementCount) frag.appendChild(cols);

    if (!frag.childElementCount) {
      frag.appendChild(el("p", "Nothing to show here yet.", "booking-note"));
    }
    mount.replaceChildren(frag);
  }

  window.OHPOverview = { render };
})();
