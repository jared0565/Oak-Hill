(function () {
  const KEY = "ohpc-admin-token";
  const setupWrap = document.querySelector("[data-admin-setup]");
  const setupForm = document.querySelector("[data-admin-setup-form]");
  const setupStatus = document.querySelector("[data-admin-setup-status]");
  const loginWrap = document.querySelector("[data-admin-login]");
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loginStatus = document.querySelector("[data-admin-login-status]");
  const app = document.querySelector("[data-admin-app]");
  const whoami = document.querySelector("[data-admin-whoami]");
  const bookingsEl = document.querySelector("[data-admin-bookings]");
  const enquiriesEl = document.querySelector("[data-admin-enquiries]");
  const logoutBtn = document.querySelector("[data-admin-logout]");

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + d + " " + MONTHS[m - 1] + " " + y;
  }

  let currentUser = null;
  let siteKey = null;
  let turnstileToken = "";
  let turnstileScript = null;

  const token = () => sessionStorage.getItem(KEY) || "";
  const authHeaders = () => ({ Authorization: "Bearer " + token(), "Content-Type": "application/json" });
  const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });

  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }

  // ---- Turnstile (only when a site key is configured) ----
  function ensureTurnstileScript() {
    return new Promise((resolve) => {
      if (window.turnstile) return resolve();
      if (turnstileScript) { turnstileScript.addEventListener("load", () => resolve()); return; }
      turnstileScript = document.createElement("script");
      turnstileScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      turnstileScript.async = true; turnstileScript.defer = true;
      turnstileScript.addEventListener("load", () => resolve());
      document.head.appendChild(turnstileScript);
    });
  }
  async function mountTurnstile(container) {
    if (!siteKey || !container) return;
    await ensureTurnstileScript();
    if (!window.turnstile) return;
    container.replaceChildren();
    window.turnstile.render(container, { sitekey: siteKey, callback: (t) => { turnstileToken = t; } });
  }
  function resetTurnstile() { turnstileToken = ""; if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} } }

  // ---- view switching ----
  function showSetup() {
    app.hidden = true; loginWrap.hidden = true; setupWrap.hidden = false;
    mountTurnstile(document.querySelector("[data-setup-turnstile]"));
  }
  function showLogin() {
    app.hidden = true; setupWrap.hidden = true; loginWrap.hidden = false;
    mountTurnstile(document.querySelector("[data-login-turnstile]"));
  }
  function showApp() {
    setupWrap.hidden = true; loginWrap.hidden = true; app.hidden = false;
    applyPermissions();
    refresh();
  }
  function applyPermissions() {
    const perms = (currentUser && currentUser.permissions) || [];
    document.querySelectorAll("[data-perm]").forEach((sec) => { sec.hidden = !perms.includes(sec.getAttribute("data-perm")); });
    whoami.textContent = currentUser ? "Signed in as " + currentUser.name + " (" + currentUser.role + ")" : "";
  }

  // ---- setup (first owner) ----
  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setupStatus.textContent = "Creating…";
    const fd = new FormData(setupForm);
    const body = { adminToken: fd.get("adminToken"), name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), turnstileToken };
    const res = await fetch("/api/auth/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { sessionStorage.setItem(KEY, d.token); currentUser = d.user; setupStatus.textContent = ""; showApp(); }
    else { setupStatus.textContent = d.error || "Setup failed."; resetTurnstile(); }
  });

  // ---- login ----
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginStatus.textContent = "Checking…";
    const fd = new FormData(loginForm);
    const body = { email: fd.get("email"), password: fd.get("password"), turnstileToken };
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { sessionStorage.setItem(KEY, d.token); currentUser = d.user; loginStatus.textContent = ""; showApp(); }
    else { loginStatus.textContent = d.error || "Sign-in failed."; resetTurnstile(); }
  });

  // ---- logout ----
  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
    sessionStorage.removeItem(KEY); currentUser = null; showLogin();
  });

  // ---- data loads (permission-gated by refresh) ----
  async function refresh() {
    const perms = (currentUser && currentUser.permissions) || [];
    const has = (p) => perms.includes(p);
    if (has("bookings")) await loadBookings(); else if (bookingsEl) bookingsEl.replaceChildren();
    if (has("messages")) await loadEnquiries(); else if (enquiriesEl) enquiriesEl.replaceChildren();
    if (has("availability") && window.OHPAvailability) window.OHPAvailability.render();
    if (has("tracking") && window.OHPTracking) window.OHPTracking.render();
    if (has("reports") && window.OHPReports) window.OHPReports.render();
    if (has("contacts") && window.OHPContacts) window.OHPContacts.render();
    if (has("users") && window.OHPUsers) window.OHPUsers.render();
    if (has("audit") && window.OHPAudit) window.OHPAudit.render();
  }

  async function loadBookings() {
    const res = await api("/api/admin/bookings");
    if (res.status === 401) { sessionStorage.removeItem(KEY); showLogin(); return; }
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
      tel.href = "tel:" + b.phone.replace(/[^\d+]/g, "");
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
        const msg = isPending ? "Decline this enquiry? The slot stays open for others." : "Cancel this booking and free the slot?";
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
    if (res.status === 401) { sessionStorage.removeItem(KEY); showLogin(); return; }
    const { enquiries } = await res.json();
    if (!enquiries || !enquiries.length) { enquiriesEl.replaceChildren(el("p", "No messages yet.", "booking-note")); return; }

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
      const contact = el("td");
      if (e.email) contact.appendChild(document.createTextNode(e.email));
      if (e.email && e.phone) contact.appendChild(el("br"));
      if (e.phone) contact.appendChild(document.createTextNode(e.phone));
      tr.appendChild(contact);
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

  // Expose the authed fetch + current user so the Owner-only modules can reuse them.
  window.OHPAdmin = { api, user: () => currentUser, refresh };

  // ---- init ----
  (async function init() {
    if (token()) {
      const me = await api("/api/auth/me");
      if (me.ok) { currentUser = (await me.json()).user; return showApp(); }
      sessionStorage.removeItem(KEY);
    }
    const st = await fetch("/api/auth/status").then((r) => r.json()).catch(() => ({}));
    siteKey = st.turnstile_site_key || null;
    if (st.needs_bootstrap) showSetup(); else showLogin();
  })();
})();
