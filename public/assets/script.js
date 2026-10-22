(function () {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-primary-nav]");

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!isOpen));
      navToggle.setAttribute("aria-expanded", String(!isOpen));
      navToggle.setAttribute("aria-label", isOpen ? "Open menu" : "Close menu");
      document.body.classList.toggle("menu-open", !isOpen);
    });
  }

  // The click-to-load map embed was removed with the café's real address: the
  // demonstration café has no location, so there is nothing to map and no
  // third-party embed to consent-gate.

  document.querySelectorAll("[data-tabs]").forEach((tabRoot) => {
    const tabs = Array.from(tabRoot.querySelectorAll("[role='tab']"));
    const panels = Array.from(tabRoot.querySelectorAll("[role='tabpanel']"));

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("aria-controls");

        tabs.forEach((item) => {
          item.setAttribute("aria-selected", String(item === tab));
        });

        panels.forEach((panel) => {
          panel.hidden = panel.id !== target;
        });
      });
    });
  });

  const calculator = document.querySelector("[data-party-calculator]");
  if (calculator) {
    const day = calculator.querySelector("[name='party-day']");
    const guests = calculator.querySelector("[name='party-guests']");
    const output = calculator.querySelector("[data-party-output]");

    const update = () => {
      const count = Math.max(10, Math.min(25, Number(guests.value || 10)));
      const weekend = day.value === "weekend";
      const base = weekend ? 175 : 165;
      const extra = weekend ? 8 : 7;
      const total = base + Math.max(0, count - 10) * extra;
      output.innerHTML = "<span>Sample party total</span><strong>&pound;" + total + "</strong><small>Includes " + count + " children. An illustrative figure for the demonstration — no deposit is taken and no date is held.</small>";
    };

    day.addEventListener("change", update);
    guests.addEventListener("input", update);
    update();
  }

  document.querySelectorAll("[data-static-form]").forEach((form) => {
    const renderedAt = Date.now();
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector("button[type=submit], button:not([type])");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.type = form.getAttribute("data-enquiry-type") || "general";
      data.elapsed_ms = Date.now() - renderedAt;
      data.source = location.pathname;
      if (status) status.textContent = "Sending…";
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch("/api/enquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) {
          if (status) {
            status.textContent = out.message ||
              "The demo enquiry form works. Nothing was sent and nothing was stored.";
          }
          form.reset();
        } else if (status) {
          status.textContent = out.error || "Sorry, something went wrong. Please try again in a moment.";
        }
      } catch {
        if (status) status.textContent = "Sorry, something went wrong. Please try again in a moment.";
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
})();

/* ---- Share menu + QR code ---- */
(function () {
  var SHARE_TITLE = "BytesFX Café & Bookings";
  var modal = null, lastFocus = null;

  function shareUrl() {
    var canon = document.querySelector('link[rel="canonical"]');
    if (canon && canon.href) return canon.href;
    return location.origin + location.pathname;
  }

  function build() {
    modal = document.createElement("div");
    modal.className = "share-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="share-backdrop" data-share-close></div>' +
      '<div class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-h">' +
        '<button class="share-x" type="button" data-share-close aria-label="Close">×</button>' +
        '<div class="share-view" data-view="options">' +
          '<h2 id="share-h">Share BytesFX Café &amp; Bookings</h2>' +
          '<p class="share-url" data-share-url></p>' +
          '<div class="share-actions">' +
            '<button class="share-opt" type="button" data-act="native" hidden>Share…</button>' +
            '<button class="share-opt" type="button" data-act="copy">Copy link</button>' +
            '<button class="share-opt" type="button" data-act="qr">QR code</button>' +
          '</div>' +
          '<div class="share-links">' +
            '<a data-net="whatsapp" target="_blank" rel="noopener">WhatsApp</a>' +
            '<a data-net="facebook" target="_blank" rel="noopener">Facebook</a>' +
            '<a data-net="email">Email</a>' +
          '</div>' +
          '<p class="share-status" data-share-status aria-live="polite"></p>' +
        '</div>' +
        '<div class="share-view" data-view="qr" hidden>' +
          '<button class="share-back" type="button" data-share-back>← Back</button>' +
          '<h2>Scan to open on your phone</h2>' +
          '<div class="share-qr" data-qr></div>' +
          '<p class="share-url" data-share-url></p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", onClick);
    document.addEventListener("keydown", function (e) {
      if (!modal.hidden && e.key === "Escape") close();
    });
  }

  function view(name) {
    var vs = modal.querySelectorAll(".share-view");
    for (var i = 0; i < vs.length; i++) vs[i].hidden = vs[i].getAttribute("data-view") !== name;
  }

  function open() {
    if (!modal) build();
    var url = shareUrl(), enc = encodeURIComponent(url);
    var urls = modal.querySelectorAll("[data-share-url]");
    for (var i = 0; i < urls.length; i++) urls[i].textContent = url;
    modal.querySelector('[data-act="native"]').hidden = !navigator.share;
    modal.querySelector('[data-net="whatsapp"]').href = "https://wa.me/?text=" + encodeURIComponent(SHARE_TITLE + " ") + enc;
    modal.querySelector('[data-net="facebook"]').href = "https://www.facebook.com/sharer/sharer.php?u=" + enc;
    modal.querySelector('[data-net="email"]').href = "mailto:?subject=" + encodeURIComponent(SHARE_TITLE) + "&body=" + enc;
    modal.querySelector("[data-share-status]").textContent = "";
    view("options");
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("share-open");
    var x = modal.querySelector(".share-x");
    if (x) x.focus();
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("share-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onClick(e) {
    if (e.target.closest("[data-share-close]")) return close();
    if (e.target.closest("[data-share-back]")) return view("options");
    var act = e.target.closest("[data-act]");
    if (act) doAct(act.getAttribute("data-act"));
  }

  function doAct(act) {
    var url = shareUrl();
    var status = modal.querySelector("[data-share-status]");
    if (act === "native" && navigator.share) {
      navigator.share({ title: SHARE_TITLE, url: url }).catch(function () {});
    } else if (act === "copy") {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { status.textContent = "Link copied to clipboard."; },
          function () { status.textContent = "Copy this link: " + url; }
        );
      } else {
        status.textContent = "Copy this link: " + url;
      }
    } else if (act === "qr") {
      showQr(url);
    }
  }

  function showQr(url) {
    view("qr");
    var box = modal.querySelector("[data-qr]");
    box.textContent = "Loading…";
    loadLib(function (ok) {
      if (!ok || !window.qrcode) { box.textContent = "Could not load the QR code."; return; }
      try {
        var qr = window.qrcode(0, "M");
        qr.addData(url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 8, scalable: true });
      } catch (e) {
        box.textContent = "Could not generate the QR code.";
      }
    });
  }

  var libState = 0, libCbs = [];
  function flush(ok) { var c = libCbs; libCbs = []; for (var i = 0; i < c.length; i++) c[i](ok); }
  function loadLib(cb) {
    if (libState === 2) return cb(true);
    if (libState === 3) return cb(false);
    libCbs.push(cb);
    if (libState === 1) return;
    libState = 1;
    var s = document.createElement("script");
    s.src = "assets/qrcode.js";
    s.onload = function () { libState = 2; flush(true); };
    s.onerror = function () { libState = 3; flush(false); };
    document.head.appendChild(s);
  }

  function init() {
    var triggers = document.querySelectorAll("[data-share]");
    for (var i = 0; i < triggers.length; i++) triggers[i].addEventListener("click", open);
    var bar = document.querySelector(".mobile-actions");
    if (bar && !bar.querySelector("[data-share]")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-share", "");
      btn.textContent = "Share";
      btn.addEventListener("click", open);
      bar.appendChild(btn);
    }
  }
  init();
})();

// ---- First-party, cookieless page analytics (no cookies, no localStorage, no IP, no identifiers) ----
(function () {
  function send(name) {
    try {
      var payload = JSON.stringify({
        name: name,
        path: location.pathname,
        referrer: name === "page_view" ? document.referrer : "",
        utm: name === "page_view" ? (new URLSearchParams(location.search).get("utm_source") || "") : ""
      });
      var blob = null;
      try { blob = new Blob([payload], { type: "application/json" }); } catch (e) { blob = null; }
      if (navigator.sendBeacon && blob) { navigator.sendBeacon("/api/track", blob); }
      else { fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }); }
    } catch (e) { /* analytics must never break the page */ }
  }
  window.BFXTrack = send;
  window.BFXTrack("page_view");
})();

// ---- Footer newsletter signup (explicit marketing opt-in → CRM) ----
(function () {
  var footer = document.querySelector(".site-footer");
  if (!footer) return;
  // Pages that manage email preferences should not also offer to sign up for
  // them: <html data-no-signup> opts out of the injected footer form.
  if (document.documentElement.hasAttribute("data-no-signup")) return;
  var loadedAt = Date.now();

  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  var wrap = el("div", null, "footer-signup");
  var inner = el("div", null, "footer-signup-inner");
  var textCol = el("div", null, "footer-signup-text");
  textCol.appendChild(el("strong", "Demo newsletter signup"));
  var lead = el("p");
  lead.appendChild(document.createTextNode("Sign up to see how the newsletter flow behaves. "));
  var demo = el("span", "Demo signup — no email will be sent.");
  lead.appendChild(demo);
  lead.appendChild(document.createTextNode(" Nothing is stored and no address is kept. See the "));
  var priv = el("a", "privacy notice"); priv.href = "privacy.html";
  lead.appendChild(priv);
  lead.appendChild(document.createTextNode("."));
  textCol.appendChild(lead);
  inner.appendChild(textCol);

  var form = document.createElement("form"); form.className = "footer-signup-form";
  var hp = document.createElement("input"); hp.type = "text"; hp.name = "company"; hp.tabIndex = -1; hp.autocomplete = "off";
  hp.setAttribute("aria-hidden", "true"); hp.style.cssText = "position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden";
  var email = document.createElement("input"); email.type = "email"; email.required = true; email.value = "alex@example.com"; email.placeholder = "you@example.com"; email.setAttribute("aria-label", "Email address");
  var btn = el("button", "Try the signup", "button"); btn.type = "submit";
  var status = el("p", null, "footer-signup-status");
  form.append(hp, email, btn);
  inner.appendChild(form);
  wrap.append(inner, status);
  footer.insertBefore(wrap, footer.firstChild);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    btn.disabled = true; status.textContent = "Sending…";
    fetch("/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, company: hp.value, elapsed_ms: Date.now() - loadedAt })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          wrap.replaceChildren(
            el("strong", "Demo signup complete"),
            el("p", res.d.message || "Demo signup — no email will be sent. Nothing was stored.")
          );
          if (window.BFXTrack) window.BFXTrack("lead_captured");
        } else { btn.disabled = false; status.textContent = (res.d && res.d.error) || "Could not sign you up. Please try again."; }
      })
      .catch(function () { btn.disabled = false; status.textContent = "Network problem. Please try again."; });
  });
})();

// ---- Staff sign-in (footer) — the way in to the owner dashboard ----
//
// The dashboard itself is /admin.html, and it owns the full sign-in flow. This
// is the same endpoint and the same session store, so signing in here and
// clicking through lands you already authenticated.
//
// It deliberately does NOT re-implement the captcha or the second factor: when
// either is required, the form says so and points at the full page, which
// handles them. Nothing here weakens the server-side protections — the
// endpoint still applies the bot gate, the lockout and the 2FA check.
(function () {
  var footer = document.querySelector(".site-footer");
  if (!footer) return;
  var legal = footer.querySelector(".footer-legal");
  if (!legal) return;

  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  var wrap = el("div", null, "footer-staff");
  var inner = el("div", null, "footer-staff-inner");

  var textCol = el("div", null, "footer-staff-text");
  textCol.appendChild(el("strong", "Staff sign in"));
  var lead = el("p");
  lead.appendChild(document.createTextNode("For the owner of this demonstration. Signing in here opens the booking dashboard."));
  textCol.appendChild(lead);
  inner.appendChild(textCol);

  var form = el("form", null, "footer-staff-form");
  form.setAttribute("data-staff-login", "");

  var emailLabel = el("label");
  emailLabel.appendChild(el("span", "Email"));
  var email = document.createElement("input");
  email.type = "email"; email.name = "email"; email.required = true;
  email.autocomplete = "username"; email.placeholder = "you@example.com";
  emailLabel.appendChild(email);

  var passLabel = el("label");
  passLabel.appendChild(el("span", "Password"));
  var pass = document.createElement("input");
  pass.type = "password"; pass.name = "password"; pass.required = true;
  pass.autocomplete = "current-password";
  passLabel.appendChild(pass);

  var btn = el("button", "Sign in", "button"); btn.type = "submit";
  var status = el("p", null, "footer-staff-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  form.append(emailLabel, passLabel, btn, status);
  inner.appendChild(form);
  wrap.appendChild(inner);
  footer.insertBefore(wrap, legal);

  // Message plus an optional link, with a space between them.
  function say(message, linkText) {
    status.textContent = message + (linkText ? " " : "");
    if (!linkText) return;
    var link = el("a", linkText);
    link.href = "admin.html";
    status.appendChild(link);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    btn.disabled = true;
    status.textContent = "Checking…";
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, password: pass.value })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.token) {
          // Same session store the dashboard reads, so the next click lands authenticated.
          sessionStorage.setItem("bfx-admin-token", res.d.token);
          pass.value = "";
          say("Signed in" + (res.d.user && res.d.user.name ? " as " + res.d.user.name : "") + ".", "Open the dashboard");
        } else if (res.d.twofa) {
          // The second factor is handled on the dedicated page, not here.
          say(res.d.error || "Two-factor authentication is required.", "Finish signing in on the full page");
          btn.disabled = false;
        } else {
          say(res.d.error || "Sign-in failed.", "Sign in on the full page instead");
          btn.disabled = false;
        }
      })
      .catch(function () { btn.disabled = false; status.textContent = "Network problem. Please try again."; });
  });
})();
