(function () {
  const root = document.querySelector("[data-users]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  const ROLES = ["owner", "manager", "staff"];

  async function render() {
    const res = await api("/api/admin/users");
    if (!res.ok) { root.replaceChildren(el("p", "Could not load users.", "booking-note")); return; }
    const { users } = await res.json();
    root.replaceChildren();
    root.appendChild(createForm());

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["Name", "Email", "Role", "Status", "Last login", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    const me = window.OHPAdmin.user();
    for (const u of users) {
      const tr = el("tr");
      tr.appendChild(el("td", u.name));
      tr.appendChild(el("td", u.email));

      const roleTd = el("td");
      const roleSel = document.createElement("select");
      for (const r of ROLES) { const o = el("option", r[0].toUpperCase() + r.slice(1), null); o.value = r; if (u.role === r) o.selected = true; roleSel.appendChild(o); }
      roleSel.addEventListener("change", () => update(u.id, { role: roleSel.value }));
      roleTd.appendChild(roleSel);
      tr.appendChild(roleTd);

      tr.appendChild(el("td", u.status));
      tr.appendChild(el("td", (u.last_login_at || "—").slice(0, 16).replace("T", " ")));

      const actions = el("td");
      const toggle = el("button", u.status === "active" ? "Disable" : "Enable", "button ghost admin-mini");
      toggle.addEventListener("click", () => update(u.id, { status: u.status === "active" ? "disabled" : "active" }));
      const reset = el("button", "Reset password", "button ghost admin-mini");
      reset.addEventListener("click", () => {
        const pw = prompt("New password for " + u.email + " (at least 12 characters):");
        if (pw) update(u.id, { password: pw });
      });
      const del = el("button", "Delete", "button ghost admin-mini contact-erase");
      del.addEventListener("click", () => { if (confirm("Delete " + u.email + "? This removes their account and signs them out.")) remove(u.id); });
      actions.append(toggle, reset);
      if (!me || me.email !== u.email) actions.append(del); // can't delete yourself
      tr.appendChild(actions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function createForm() {
    const form = el("form", null, "form-panel users-add");
    const name = Object.assign(document.createElement("input"), { type: "text", placeholder: "Name", required: true });
    const email = Object.assign(document.createElement("input"), { type: "email", placeholder: "Email", required: true });
    const role = document.createElement("select");
    for (const r of ROLES) { const o = el("option", r[0].toUpperCase() + r.slice(1), null); o.value = r; role.appendChild(o); }
    role.value = "staff";
    const pw = Object.assign(document.createElement("input"), { type: "password", placeholder: "Password (12+ chars)", minLength: 12, required: true });
    const btn = el("button", "Add user", "button admin-mini"); btn.type = "submit";
    const status = el("p", "", "form-status");
    form.append(el("strong", "Add a staff account"), name, email, role, pw, btn, status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "Saving…";
      const r = await api("/api/admin/users", { method: "POST", body: JSON.stringify({ name: name.value, email: email.value, role: role.value, password: pw.value }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { status.textContent = ""; render(); } else status.textContent = d.error || "Could not add user.";
    });
    return form;
  }

  async function update(id, fields) {
    const r = await api("/api/admin/users", { method: "PUT", body: JSON.stringify({ id, ...fields }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) render(); else { alert(d.error || "Could not update."); render(); }
  }
  async function remove(id) {
    const r = await api("/api/admin/users?id=" + id, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) render(); else alert(d.error || "Could not delete.");
  }

  window.OHPUsers = { render };
})();
