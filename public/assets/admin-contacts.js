(function () {
  const KEY = "ohpc-admin-token";
  const root = document.querySelector("[data-contacts]");
  if (!root) return;

  const token = () => sessionStorage.getItem(KEY) || "";
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  let query = "", openId = null;

  async function render() {
    if (!token()) return;
    const res = await api("/api/admin/contacts?q=" + encodeURIComponent(query));
    if (res.status === 401) { root.replaceChildren(el("p", "Session expired — sign in again.", "booking-note")); return; }
    const { contacts } = await res.json();
    root.replaceChildren();

    const bar = el("div", null, "contacts-bar");
    const search = Object.assign(document.createElement("input"), { type: "search", placeholder: "Search name, email, phone", value: query });
    search.addEventListener("change", () => { query = search.value.trim(); openId = null; render(); });
    const csv = el("button", "Export CSV", "button ghost admin-mini"); csv.type = "button";
    csv.addEventListener("click", exportCsv);
    bar.append(search, csv);
    root.appendChild(bar);

    if (!contacts.length) { root.appendChild(el("p", "No contacts yet.", "booking-note")); return; }
    const table = el("table", null, "admin-table");
    const head = el("tr"); ["Name", "Email", "Last seen", "Bookings", "Enquiries", "Tags"].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const c of contacts) {
      const tr = el("tr"); tr.className = "contacts-row";
      tr.appendChild(el("td", c.name || "(no name)"));
      tr.appendChild(el("td", c.email || ""));
      tr.appendChild(el("td", (c.last_seen || "").slice(0, 10)));
      tr.appendChild(el("td", String(c.bookings_n)));
      tr.appendChild(el("td", String(c.enquiries_n)));
      tr.appendChild(el("td", (c.tags || []).join(", ")));
      tr.addEventListener("click", () => { openId = c.id; detail(c.id); });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);
    if (openId) detail(openId);
  }

  async function detail(id) {
    const res = await api("/api/admin/contacts?id=" + id);
    if (!res.ok) return;
    const { contact, bookings, enquiries } = await res.json();
    const panel = el("div", null, "contact-panel");
    panel.appendChild(el("h3", (contact.name || "(no name)") + " — " + (contact.email || "")));
    if (contact.phone) panel.appendChild(el("p", "Phone: " + contact.phone));

    const tagWrap = el("div", null, "contact-tags");
    (contact.tags || []).forEach((t) => {
      const chip = el("span", t + " ✕", "tag-chip"); chip.addEventListener("click", () => tag(id, "tag_remove", t));
      tagWrap.appendChild(chip);
    });
    const tagInput = Object.assign(document.createElement("input"), { type: "text", placeholder: "add tag" });
    tagInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && tagInput.value.trim()) tag(id, "tag_add", tagInput.value.trim()); });
    tagWrap.appendChild(tagInput);
    panel.append(el("strong", "Tags"), tagWrap);

    const optWrap = el("label", null, "contact-opt");
    const opt = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!contact.marketing_opt_in });
    opt.addEventListener("change", () => patch(id, { marketing_opt_in: opt.checked ? 1 : 0 }));
    optWrap.append(opt, document.createTextNode(" Marketing opt-in (consent on file)"));
    panel.appendChild(optWrap);

    const notes = Object.assign(document.createElement("textarea"), { rows: 3, value: contact.notes || "" });
    const saveNotes = el("button", "Save notes", "button ghost admin-mini"); saveNotes.type = "button";
    saveNotes.addEventListener("click", () => patch(id, { notes: notes.value }));
    panel.append(el("strong", "Notes"), notes, saveNotes);

    panel.appendChild(el("strong", "History"));
    const tl = el("ul", null, "contact-timeline");
    for (const b of bookings) tl.appendChild(el("li", "Booking " + b.ref + " — " + (b.date || "") + " " + (b.start_time || "") + " (" + b.status + ") · " + (b.created_at || "").slice(0, 10)));
    for (const q of enquiries) tl.appendChild(el("li", "Enquiry (" + q.type + ") " + (q.party_date ? "for " + q.party_date + " " : "") + "· " + (q.created_at || "").slice(0, 10) + (q.message ? " — " + q.message.slice(0, 80) : "")));
    if (!bookings.length && !enquiries.length) tl.appendChild(el("li", "No bookings or enquiries."));
    panel.appendChild(tl);

    const exportBtn = el("button", "Export this person's data", "button ghost admin-mini"); exportBtn.type = "button";
    exportBtn.addEventListener("click", () => exportContact(id));
    panel.appendChild(exportBtn);

    const erase = el("button", "Erase this person's data", "button ghost admin-mini contact-erase"); erase.type = "button";
    erase.addEventListener("click", async () => {
      if (!confirm("This permanently removes this person's personal data from contacts, bookings and enquiries. It cannot be undone. Continue?")) return;
      const r = await api("/api/admin/contacts?id=" + id, { method: "DELETE" });
      if (r.ok) { openId = null; render(); } else alert("Could not erase.");
    });
    panel.appendChild(erase);

    const existing = root.querySelector(".contact-panel");
    if (existing) existing.replaceWith(panel); else root.appendChild(panel);
  }

  async function patch(id, fields) { const r = await api("/api/admin/contacts", { method: "PUT", body: JSON.stringify({ id, ...fields }) }); if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "Could not save."); } else { openId = id; render(); } }
  async function tag(id, action, t) { const r = await api("/api/admin/contacts", { method: "POST", body: JSON.stringify({ id, action, tag: t }) }); const d = await r.json().catch(() => ({})); if (!r.ok) alert(d.error || "Could not update tag."); else { openId = id; render(); } }

  async function exportCsv() {
    const res = await api("/api/admin/contacts?format=csv");
    if (!res.ok) { alert("Could not export."); return; }
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "contacts.csv"; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // One-click DSAR/portability export of a single person's full record (contact + bookings + enquiries).
  async function exportContact(id) {
    const res = await api("/api/admin/contacts?id=" + id + "&format=csv");
    if (!res.ok) { alert("Could not export this contact."); return; }
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "contact-" + id + "-data-export.csv"; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  window.OHPContacts = { render };
})();
