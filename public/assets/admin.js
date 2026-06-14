(function () {
  const KEY = "ohpc-admin-token";
  const loginWrap = document.querySelector("[data-admin-login]");
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loginStatus = document.querySelector("[data-admin-login-status]");
  const app = document.querySelector("[data-admin-app]");
  const bookingsEl = document.querySelector("[data-admin-bookings]");
  const enquiriesEl = document.querySelector("[data-admin-enquiries]");
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

  async function refresh() {
    await Promise.all([loadBookings(), loadEnquiries()]);
    if (window.OHPAvailability) window.OHPAvailability.render();
    if (window.OHPTracking) window.OHPTracking.render();
    if (window.OHPReports) window.OHPReports.render();
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
        const confirmBtn = el("button", "Mark paid", "button admin-mini");
        confirmBtn.addEventListener("click", () => {
          if (confirm("Mark this booking as paid? This locks the slot and declines any other holds on it.")) act(b.id, "confirm");
        });
        actions.appendChild(confirmBtn);
      }
      if (b.status !== "cancelled") {
        const isPending = b.status === "pending";
        const cancelBtn = el("button", isPending ? "Decline" : "Cancel", "button ghost admin-mini");
        const msg = isPending
          ? "Decline this enquiry? The slot stays open for others."
          : "Cancel this booking and free the slot?";
        cancelBtn.addEventListener("click", () => { if (confirm(msg)) act(b.id, "cancel"); });
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

  async function actEnquiry(id, action) {
    const r = await api("/api/admin/enquiries", { method: "POST", body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) loadEnquiries(); else alert(d.error || "Action failed.");
  }

  async function loadEnquiries() {
    if (!enquiriesEl) return;
    const res = await api("/api/admin/enquiries");
    if (res.status === 401) { showLogin(); return; }
    const { enquiries } = await res.json();
    if (!enquiries || !enquiries.length) {
      enquiriesEl.replaceChildren(el("p", "No messages yet.", "booking-note"));
      return;
    }

    const table = el("table", null, "admin-table");
    const head = el("tr");
    ["When", "Type", "Name", "Contact", "Message", "Status", ""].forEach((h) => head.appendChild(el("th", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = el("tbody");
    for (const e of enquiries) {
      const tr = el("tr");
      tr.appendChild(el("td", e.created_at || ""));
      tr.appendChild(el("td", e.type || ""));
      tr.appendChild(el("td", e.name || ""));

      // Contact cell: email + phone on separate lines
      const contact = el("td");
      if (e.email) contact.appendChild(document.createTextNode(e.email));
      if (e.email && e.phone) contact.appendChild(el("br"));
      if (e.phone) contact.appendChild(document.createTextNode(e.phone));
      tr.appendChild(contact);

      // Message cell: party details (if any) then message text
      const msgCell = el("td");
      const partyParts = [];
      if (e.type === "party") {
        if (e.party_date) partyParts.push("Date: " + e.party_date);
        if (e.children != null) partyParts.push("Children: " + e.children);
        if (e.child_age) partyParts.push("Age: " + e.child_age);
      }
      if (partyParts.length) {
        msgCell.appendChild(document.createTextNode(partyParts.join(" · ")));
        if (e.message) msgCell.appendChild(el("br"));
      }
      if (e.message) msgCell.appendChild(document.createTextNode(e.message));
      tr.appendChild(msgCell);

      tr.appendChild(el("td", e.status || ""));

      const actions = el("td");
      const markRead = el("button", "Mark read", "button ghost admin-mini");
      markRead.addEventListener("click", () => actEnquiry(e.id, "read"));
      const archive = el("button", "Archive", "button ghost admin-mini");
      archive.addEventListener("click", () => actEnquiry(e.id, "archive"));
      actions.appendChild(markRead);
      actions.appendChild(archive);
      tr.appendChild(actions);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    enquiriesEl.replaceChildren(table);
  }

  if (token()) showApp();
})();
