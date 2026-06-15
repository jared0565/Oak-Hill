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

  // Privacy-friendly map: the Google Maps embed is a third party that can set cookies, so under
  // PECR it must not load until the visitor asks. Show a placeholder; swap in the iframe on click.
  document.querySelectorAll("[data-map-load]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-map-embed]");
      if (!wrap) return;
      const iframe = document.createElement("iframe");
      iframe.className = "map-frame";
      iframe.title = wrap.getAttribute("data-map-title") || "Map";
      iframe.loading = "lazy";
      iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      iframe.src = wrap.getAttribute("data-map-src");
      wrap.replaceWith(iframe);
    });
  });

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
      const base = weekend ? 180 : 170;
      const extra = weekend ? 8 : 7;
      const total = base + Math.max(0, count - 10) * extra;
      output.innerHTML = "<span>Estimated party total</span><strong>&pound;" + total + "</strong><small>Includes " + count + " children. A &pound;100 non-refundable deposit secures the booking.</small>";
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
          if (status) status.textContent =
            "Thanks — we've got your message and will reply. For anything urgent call 0208 361 1013.";
          form.reset();
        } else if (status) {
          status.textContent = out.error || "Sorry, something went wrong. Please call 0208 361 1013.";
        }
      } catch {
        if (status) status.textContent = "Sorry, something went wrong. Please call 0208 361 1013.";
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
})();

/* ---- Share menu + QR code ---- */
(function () {
  var SHARE_TITLE = "Oak Hill Park Cafe";
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
          '<h2 id="share-h">Share Oak Hill Park Cafe</h2>' +
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
  window.OHPTrack = send;
  window.OHPTrack("page_view");
})();

// ---- Footer newsletter signup (explicit marketing opt-in → CRM) ----
(function () {
  var footer = document.querySelector(".site-footer");
  if (!footer) return;
  var loadedAt = Date.now();

  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  var wrap = el("div", null, "footer-signup");
  wrap.appendChild(el("strong", "Cafe news & party offers"));
  var lead = el("p");
  lead.appendChild(document.createTextNode("Get occasional emails about the cafe and party offers. Unsubscribe anytime. "));
  var priv = el("a", "See our privacy policy"); priv.href = "privacy.html";
  lead.appendChild(priv);
  wrap.appendChild(lead);

  var form = document.createElement("form"); form.className = "footer-signup-form";
  var hp = document.createElement("input"); hp.type = "text"; hp.name = "company"; hp.tabIndex = -1; hp.autocomplete = "off";
  hp.setAttribute("aria-hidden", "true"); hp.style.cssText = "position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden";
  var email = document.createElement("input"); email.type = "email"; email.required = true; email.placeholder = "you@example.com"; email.setAttribute("aria-label", "Email address");
  var btn = el("button", "Sign me up", "button"); btn.type = "submit";
  var status = el("p", null, "footer-signup-status");
  form.append(hp, email, btn);
  wrap.append(form, status);
  footer.insertBefore(wrap, footer.firstChild);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    btn.disabled = true; status.textContent = "Signing you up…";
    fetch("/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, company: hp.value, elapsed_ms: Date.now() - loadedAt })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          wrap.replaceChildren(el("strong", "Thanks — you’re on the list."), el("p", "We’ll only email you about the cafe and party offers."));
          if (window.OHPTrack) window.OHPTrack("lead_captured");
        } else { btn.disabled = false; status.textContent = (res.d && res.d.error) || "Could not sign you up. Please try again."; }
      })
      .catch(function () { btn.disabled = false; status.textContent = "Network problem. Please try again."; });
  });
})();
