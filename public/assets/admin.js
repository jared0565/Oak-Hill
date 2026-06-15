(function () {
  const KEY = "ohpc-admin-token";
  const setupWrap = document.querySelector("[data-admin-setup]");
  const setupForm = document.querySelector("[data-admin-setup-form]");
  const setupStatus = document.querySelector("[data-admin-setup-status]");
  const loginWrap = document.querySelector("[data-admin-login]");
  const loginForm = document.querySelector("[data-admin-login-form]");
  const loginStatus = document.querySelector("[data-admin-login-status]");
  const login2fa = document.querySelector("[data-login-2fa]");
  const login2faInput = login2fa && login2fa.querySelector("input[name='totpCode']");
  const enrollWrap = document.querySelector("[data-admin-enroll]");
  const app = document.querySelector("[data-admin-app]");
  const whoami = document.querySelector("[data-admin-whoami]");
  const bookingsEl = document.querySelector("[data-admin-bookings]");
  const enquiriesEl = document.querySelector("[data-admin-enquiries]");
  const logoutBtns = document.querySelectorAll("[data-admin-logout]");
  const nav = document.querySelector("[data-admin-nav]");
  const titleEl = document.querySelector("[data-admin-title]");
  const hamburger = document.querySelector("[data-admin-hamburger]");
  const drawerBackdrop = document.querySelector("[data-admin-drawer-backdrop]");

  // Section registry: panel id (= hash), its permission (null = always available),
  // human label for the top-bar title, and the lazy loader run on first visit.
  // The loader is resolved at call time so the per-section modules (loaded by their own
  // <script defer>) are guaranteed present.
  const SECTIONS = [
    { id: "overview",     perm: null,           title: "Overview",      load: () => window.OHPOverview && window.OHPOverview.render() },
    { id: "bookings",     perm: "bookings",     title: "Bookings",      load: () => loadBookings() },
    { id: "messages",     perm: "messages",     title: "Messages",      load: () => loadEnquiries() },
    { id: "availability", perm: "availability", title: "Availability",  load: () => window.OHPAvailability && window.OHPAvailability.render() },
    { id: "contacts",     perm: "contacts",     title: "Contacts",      load: () => window.OHPContacts && window.OHPContacts.render() },
    { id: "reports",      perm: "reports",      title: "Reports",       load: () => window.OHPReports && window.OHPReports.render() },
    { id: "tracking",     perm: "tracking",     title: "Tracking code", load: () => window.OHPTracking && window.OHPTracking.render() },
    { id: "users",        perm: "users",        title: "Users",         load: () => window.OHPUsers && window.OHPUsers.render() },
    { id: "audit",        perm: "audit",        title: "Activity",      load: () => window.OHPAudit && window.OHPAudit.render() },
    { id: "account",      perm: null,           title: "Account",       load: () => window.OHPAccount && window.OHPAccount.render() },
  ];
  const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
  const loaded = new Set();
  let activeId = null;

  // Pure routing helper (unit-testable): given the set of permissions and a requested
  // section id, return the id to actually show. Overview (perm null) is always allowed;
  // an unknown or forbidden id falls back to "overview".
  function resolveRoute(perms, requestedId, sections) {
    const list = sections || SECTIONS;
    const target = list.find((s) => s.id === requestedId);
    if (target && (target.perm === null || (perms || []).includes(target.perm))) return target.id;
    return "overview";
  }

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
    app.hidden = true; loginWrap.hidden = true; enrollWrap.hidden = true; setupWrap.hidden = false;
    document.body.classList.remove("admin-shell", "admin-drawer-open");
    mountTurnstile(document.querySelector("[data-setup-turnstile]"));
  }
  function showLogin() {
    app.hidden = true; setupWrap.hidden = true; enrollWrap.hidden = true; loginWrap.hidden = false;
    document.body.classList.remove("admin-shell", "admin-drawer-open");
    // Start the 2FA step hidden and cleared each time the login view is shown fresh.
    if (login2fa) login2fa.hidden = true;
    if (login2faInput) login2faInput.value = "";
    mountTurnstile(document.querySelector("[data-login-turnstile]"));
  }
  // Mandatory-2FA gate: a privileged user with no TOTP is parked here (the API blocks everything
  // but enrolment) until they finish setup, after which onEnrollComplete refreshes identity → app.
  function showEnroll() {
    app.hidden = true; setupWrap.hidden = true; loginWrap.hidden = true; enrollWrap.hidden = false;
    document.body.classList.remove("admin-shell", "admin-drawer-open");
    const host = enrollWrap.querySelector("[data-enroll-2fa]");
    if (window.OHPAccount && window.OHPAccount.renderEnroll) window.OHPAccount.renderEnroll(host, onEnrollComplete);
  }
  async function onEnrollComplete() {
    // 2FA is on now → re-fetch identity so mustEnroll2fa clears, then enter the dashboard.
    try { const me = await api("/api/auth/me"); if (me.ok) currentUser = (await me.json()).user; } catch (_) {}
    showApp();
  }
  function showApp() {
    setupWrap.hidden = true; loginWrap.hidden = true; enrollWrap.hidden = true; app.hidden = false;
    document.body.classList.add("admin-shell");
    applyPermissions();
    buildNav();
    // Route to the current hash (or default/guard to #overview), which lazy-loads it.
    routeTo(location.hash);
  }
  function applyPermissions() {
    paintIdentity();
  }

  // Initials for the avatar circle: first letters of up to two words, "?" fallback.
  function userInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Paint the top-bar identity: an avatar (image or initials circle) + name/role text.
  function paintIdentity() {
    if (!whoami) return;
    const right = whoami.parentNode;
    if (right) {
      let av = right.querySelector("[data-admin-avatar]");
      if (!av) {
        av = document.createElement("span");
        av.setAttribute("data-admin-avatar", "");
        right.insertBefore(av, whoami);
      }
      av.className = "admin-avatar";
      av.replaceChildren();
      if (currentUser && currentUser.avatar) {
        const img = document.createElement("img");
        img.className = "admin-avatar-img";
        img.src = currentUser.avatar;
        img.alt = "";
        av.appendChild(img);
      } else {
        av.classList.add("admin-avatar-initials");
        av.setAttribute("aria-hidden", "true");
        av.textContent = currentUser ? userInitials(currentUser.name) : "";
      }
    }
    whoami.textContent = currentUser ? currentUser.name + " (" + currentUser.role + ")" : "";
  }

  function perms() { return (currentUser && currentUser.permissions) || []; }

  // Show only the nav items the user is permitted to see (Overview always shown).
  function buildNav() {
    if (!nav) return;
    const p = perms();
    nav.querySelectorAll("[data-nav]").forEach((a) => {
      const need = a.getAttribute("data-perm");
      a.hidden = !!need && !p.includes(need);
    });
  }

  // ---- drawer (mobile) ----
  function setDrawer(open) {
    document.body.classList.toggle("admin-drawer-open", open);
    if (hamburger) hamburger.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closeDrawer() { setDrawer(false); }

  // ---- hash router ----
  function routeTo(hash) {
    const requested = String(hash || "").replace(/^#/, "");
    const id = resolveRoute(perms(), requested, SECTIONS);
    // Keep the URL honest if we redirected (e.g. forbidden/unknown -> overview).
    if (("#" + id) !== location.hash) { location.hash = id; return; } // hashchange re-enters

    activeId = id;
    // Show exactly one panel; the router owns panel visibility.
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== id;
    });
    // Active nav state.
    if (nav) {
      nav.querySelectorAll("[data-nav]").forEach((a) => {
        if (a.getAttribute("data-nav") === id) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
    }
    // Top-bar title.
    const section = SECTION_BY_ID[id];
    if (titleEl && section) titleEl.textContent = section.title;
    // Lazy-load on first visit.
    if (section && !loaded.has(id)) { loaded.add(id); Promise.resolve(section.load()).catch(() => {}); }
    // Mobile: a chosen section closes the drawer.
    closeDrawer();
    // Move focus to the panel heading for keyboard users.
    const panel = document.getElementById("panel-" + id);
    if (panel) { try { panel.focus({ preventScroll: false }); } catch (_) { panel.focus(); } }
  }

  // ---- setup (first owner) ----
  setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setupStatus.textContent = "Creating…";
    const fd = new FormData(setupForm);
    const body = { adminToken: fd.get("adminToken"), name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), turnstileToken };
    const res = await fetch("/api/auth/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { sessionStorage.setItem(KEY, d.token); currentUser = d.user; setupStatus.textContent = ""; d.mustEnroll2fa ? showEnroll() : showApp(); }
    else { setupStatus.textContent = d.error || "Setup failed."; resetTurnstile(); }
  });

  // ---- login ----
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginStatus.textContent = "Checking…";
    const fd = new FormData(loginForm);
    const totpCode = (fd.get("totpCode") || "").toString().trim();
    const body = { email: fd.get("email"), password: fd.get("password"), turnstileToken };
    if (totpCode) body.totpCode = totpCode;
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (d && d.twofa) {
      // Password was correct; reveal the authenticator code field and resubmit. This covers both
      // the first prompt (HTTP 200, no token yet) and a rejected code retry (HTTP 401), so it is
      // checked before res.ok. The whole form re-POSTs, and the server re-checks Turnstile on
      // every request. Turnstile tokens are single-use, so when a site key is configured we must
      // reset the widget to obtain a fresh token before the user resubmits with their code.
      if (login2fa) login2fa.hidden = false;
      if (login2faInput) login2faInput.focus();
      if (siteKey) {
        resetTurnstile(); // clears the spent token; the widget re-solves and refills it
        loginStatus.textContent = d.error || "Enter your authenticator code, then complete the human check again.";
      } else {
        loginStatus.textContent = d.error || "Enter your authenticator code.";
      }
    } else if (res.ok) {
      sessionStorage.setItem(KEY, d.token); currentUser = d.user; loginStatus.textContent = "";
      if (login2fa) login2fa.hidden = true;
      if (login2faInput) login2faInput.value = "";
      if (d.mustEnroll2fa) showEnroll(); else showApp();
    } else {
      loginStatus.textContent = d.error || "Sign-in failed."; resetTurnstile();
    }
  });

  // ---- logout (both the sidebar and top-bar buttons share this) ----
  async function doLogout() {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
    sessionStorage.removeItem(KEY); currentUser = null;
    loaded.clear(); activeId = null;
    document.body.classList.remove("admin-shell", "admin-drawer-open");
    showLogin();
  }
  logoutBtns.forEach((b) => b.addEventListener("click", doLogout));

  // ---- nav / router / drawer wiring ----
  if (nav) {
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("[data-nav]");
      if (!a) return;
      // Let the hash change drive routing; just close the drawer on selection.
      closeDrawer();
    });
  }
  window.addEventListener("hashchange", () => { if (!app.hidden) routeTo(location.hash); });
  if (hamburger) {
    hamburger.addEventListener("click", () => setDrawer(!document.body.classList.contains("admin-drawer-open")));
  }
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

  // Re-run the active section's loader (used after booking/enquiry actions repaint).
  // Bypasses the `loaded` set so it always refetches the visible data.
  function refresh() {
    const section = activeId && SECTION_BY_ID[activeId];
    if (section) return Promise.resolve(section.load()).catch(() => {});
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

  // Update the shell's current user and repaint the top-bar identity/avatar.
  // Used by the Account module after a profile/avatar or 2FA change.
  function setUser(u) { currentUser = u; paintIdentity(); }

  // Expose the authed fetch + current user so the Owner-only modules can reuse them.
  // requireEnroll lets the Account module hand control back to the forced-2FA gate (e.g. after a
  // privileged user disables 2FA and must immediately re-enrol).
  window.OHPAdmin = { api, user: () => currentUser, refresh, setUser, requireEnroll: showEnroll };

  // ---- init ----
  (async function init() {
    if (token()) {
      const me = await api("/api/auth/me");
      if (me.ok) { const data = await me.json(); currentUser = data.user; return data.mustEnroll2fa ? showEnroll() : showApp(); }
      sessionStorage.removeItem(KEY);
    }
    const st = await fetch("/api/auth/status").then((r) => r.json()).catch(() => ({}));
    siteKey = st.turnstile_site_key || null;
    if (st.needs_bootstrap) showSetup(); else showLogin();
  })();
})();
