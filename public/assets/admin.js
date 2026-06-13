(function () {
  const KEY = "ohpc-admin-token";
  const loginWrap = document.querySelector("[data-admin-login]");
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loginStatus = document.querySelector("[data-admin-login-status]");
  const app = document.querySelector("[data-admin-app]");
  const slotForm = document.querySelector("[data-admin-slot-form]");
  const slotStatus = document.querySelector("[data-admin-slot-status]");
  const slotsEl = document.querySelector("[data-admin-slots]");
  const bookingsEl = document.querySelector("[data-admin-bookings]");
  const logoutBtn = document.querySelector("[data-admin-logout]");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + d + " " + MONTHS[m - 1] + " " + y;
  }

  const token = () => sessionStorage.getItem(KEY) || "";
  const authHeaders = () => ({ Authorization: "Bearer " + token(), "Content-Type": "application/json" });
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  function showApp() { loginWrap.hidden = true; app.hidden = false; refresh(); }
  function showLogin() { app.hidden = true; loginWrap.hidden = false; }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    sessionStorage.setItem(KEY, new FormData(loginForm).get("token"));
    loginStatus.textContent = "Checking…";
    const res = await api("/api/admin/slots");
    if (res.ok) { loginStatus.textContent = ""; showApp(); }
    else { sessionStorage.removeItem(KEY); loginStatus.textContent = "That password was not accepted."; }
  });

  logoutBtn.addEventListener("click", () => { sessionStorage.removeItem(KEY); showLogin(); });

  slotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(slotForm);
    slotStatus.textContent = "Adding…";
    const res = await api("/api/admin/slots", {
      method: "POST",
      body: JSON.stringify({
        date: fd.get("date"),
        start_time: fd.get("start_time"),
        end_time: fd.get("end_time"),
        label: fd.get("label")
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { slotStatus.textContent = "Slot added."; slotForm.reset(); slotForm.querySelector("[name='label']").value = "Party slot"; refresh(); }
    else { slotStatus.textContent = data.error || "Could not add the slot."; }
  });

  async function refresh() {
    await Promise.all([loadSlots(), loadBookings()]);
  }

  async function loadSlots() {
    const res = await api("/api/admin/slots");
    if (res.status === 401) { showLogin(); return; }
    const { slots } = await res.json();
    if (!slots.length) { slotsEl.replaceChildren(el("p", "No slots yet. Add one above.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["Date", "Time", "Label", "Status", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const s of slots) {
      const tr = el("tr");
      tr.appendChild(el("td", fmtDate(s.date)));
      tr.appendChild(el("td", s.start_time + "–" + s.end_time));
      tr.appendChild(el("td", s.label));
      tr.appendChild(el("td", s.status));
      const actions = el("td");
      if (s.status !== "booked") {
        const del = el("button", "Delete", "button ghost admin-mini");
        del.addEventListener("click", async () => {
          if (!confirm("Delete this slot?")) return;
          const r = await api("/api/admin/slots?id=" + s.id, { method: "DELETE" });
          const d = await r.json().catch(() => ({}));
          if (r.ok) refresh(); else alert(d.error || "Could not delete.");
        });
        actions.appendChild(del);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    slotsEl.replaceChildren(table);
  }

  async function loadBookings() {
    const res = await api("/api/admin/bookings");
    if (res.status === 401) { showLogin(); return; }
    const { bookings } = await res.json();
    if (!bookings.length) { bookingsEl.replaceChildren(el("p", "No bookings yet.", "booking-note")); return; }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["Ref", "Slot", "Name", "Phone", "Email", "Children", "Age", "Notes", "Status", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const b of bookings) {
      const tr = el("tr");
      tr.appendChild(el("td", b.ref));
      tr.appendChild(el("td", fmtDate(b.date) + ", " + b.start_time + "–" + b.end_time));
      tr.appendChild(el("td", b.name));
      const phone = el("td");
      const tel = el("a", b.phone);
      tel.href = "tel:" + b.phone.replace(/\s+/g, "");
      phone.appendChild(tel);
      tr.appendChild(phone);
      tr.appendChild(el("td", b.email));
      tr.appendChild(el("td", b.children == null ? "" : String(b.children)));
      tr.appendChild(el("td", b.child_age || ""));
      tr.appendChild(el("td", b.notes || ""));
      tr.appendChild(el("td", b.status));
      const actions = el("td");
      if (b.status === "pending") {
        const confirmBtn = el("button", "Confirm", "button admin-mini");
        confirmBtn.addEventListener("click", () => act(b.id, "confirm"));
        actions.appendChild(confirmBtn);
      }
      if (b.status !== "cancelled") {
        const cancelBtn = el("button", "Cancel", "button ghost admin-mini");
        cancelBtn.addEventListener("click", () => { if (confirm("Cancel this booking and free the slot?")) act(b.id, "cancel"); });
        actions.appendChild(cancelBtn);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    bookingsEl.replaceChildren(table);
  }

  async function act(id, action) {
    const r = await api("/api/admin/bookings", { method: "POST", body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) refresh(); else alert(d.error || "Action failed.");
  }

  if (token()) showApp();
})();
