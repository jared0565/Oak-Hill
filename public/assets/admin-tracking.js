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
  function opt(sel, pairs) { for (const [v, t] of pairs) sel.appendChild(new Option(t, v)); return sel; }
  function labelFor(pairs, v) { const f = pairs.find((p) => p[0] === v); return f ? f[1] : v; }

  let editingId = null;
  let fields = {};

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
        toggle.addEventListener("click", () => save({ label: s.label, code: s.code, placement: s.placement, scope: s.scope, consent_category: s.consent_category, enabled: s.enabled ? 0 : 1 }, s.id));
        const edit = el("button", "Edit", "button ghost admin-mini");
        edit.addEventListener("click", async () => { editingId = s.id; await render(); fill(s); });
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

    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      status.textContent = "Saving…";
      save({ label: label.value, code: code.value, placement: placement.value, scope: scope.value, consent_category: category.value, enabled: enabled.checked ? 1 : 0 }, editingId, status);
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
    if (!r.ok) { const msg = d.error || "Could not save."; if (status) status.textContent = msg; else alert(msg); return; }
    if (d.warnings && d.warnings.length) alert("Saved, but these hosts are not in the allowed providers list and won't load until added to the site security policy:\n\n" + d.warnings.join("\n"));
    editingId = null; render();
  }

  window.OHPTracking = { render };
})();
