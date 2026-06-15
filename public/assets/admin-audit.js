(function () {
  const root = document.querySelector("[data-audit]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  const ACTION_GROUPS = [["", "All actions"], ["auth.", "Sign-ins"], ["user.", "Users"], ["slot.", "Slots"], ["event.", "Events"], ["booking.", "Bookings"], ["enquiry.", "Messages"], ["contact.", "Contacts"], ["snippet.", "Tracking"]];
  let filters = { actor: "", action: "", from: "", to: "", include_bots: false };
  let people = [];

  async function render() {
    if (!people.length) {
      const ures = await api("/api/admin/users");
      if (ures.ok) people = (await ures.json()).users || [];
    }
    const qs = new URLSearchParams();
    if (filters.actor) qs.set("actor", filters.actor);
    if (filters.action) qs.set("action", filters.action);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.include_bots) qs.set("include_bots", "1");
    const res = await api("/api/admin/audit?" + qs.toString());
    if (!res.ok) { root.replaceChildren(el("p", "Could not load activity.", "booking-note")); return; }
    const { entries } = await res.json();

    root.replaceChildren(buildBar());
    if (!entries.length) { root.appendChild(el("p", "No activity for these filters.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["When", "Who", "Action", "Target", "Detail", "Country", "IP", "Device"].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const e of entries) {
      const tr = el("tr");
      if (e.is_bot) tr.className = "audit-bot";
      tr.appendChild(el("td", (e.created_at || "").replace("T", " ").slice(0, 19)));
      tr.appendChild(el("td", e.actor_email || "—"));
      tr.appendChild(el("td", e.action));
      tr.appendChild(el("td", e.target_type ? e.target_type + " " + (e.target_id || "") : ""));
      tr.appendChild(el("td", e.detail || ""));
      tr.appendChild(el("td", e.country || ""));
      tr.appendChild(el("td", e.ip || ""));
      const dev = el("td", (e.user_agent || "").slice(0, 40)); if (e.user_agent) dev.title = e.user_agent;
      tr.appendChild(dev);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function buildBar() {
    const bar = el("div", null, "contacts-bar");

    const who = document.createElement("select");
    who.appendChild(Object.assign(el("option", "Everyone"), { value: "" }));
    for (const p of people) { const o = el("option", p.name + " (" + p.role + ")"); o.value = String(p.id); if (String(p.id) === filters.actor) o.selected = true; who.appendChild(o); }
    who.addEventListener("change", () => { filters.actor = who.value; render(); });

    const act = document.createElement("select");
    for (const [val, label] of ACTION_GROUPS) { const o = el("option", label); o.value = val; if (val === filters.action) o.selected = true; act.appendChild(o); }
    act.addEventListener("change", () => { filters.action = act.value; render(); });

    const from = Object.assign(document.createElement("input"), { type: "date", value: filters.from });
    from.addEventListener("change", () => { filters.from = from.value; render(); });
    const to = Object.assign(document.createElement("input"), { type: "date", value: filters.to });
    to.addEventListener("change", () => { filters.to = to.value; render(); });

    const botsLabel = el("label", null, "audit-bots");
    const bots = Object.assign(document.createElement("input"), { type: "checkbox", checked: filters.include_bots });
    bots.addEventListener("change", () => { filters.include_bots = bots.checked; render(); });
    botsLabel.append(bots, document.createTextNode(" Show bot attempts"));

    bar.append(who, act, from, to, botsLabel);
    return bar;
  }

  window.OHPAudit = { render };
})();
