(function () {
  var STORAGE_KEY = "ohpc-consent";

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (!window.gtag) { window.gtag = gtag; }

  // Consent Mode v2: everything denied until the visitor chooses.
  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function readConsent() {
    try { var raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function storeConsent(consent) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(consent)); } catch (e) { /* private mode */ }
  }

  // ---- Tracking-snippet injector (owner-pasted Head/Body code, consent-gated) ----
  var snippetsCache = null, fetched = false, injectedIds = {};

  // Mirror of snippet-core.pageMatchesScope (kept in sync; tested there).
  function pageMatchesScope(scope, pathname) {
    if (scope === "global") return true;
    function strip(p) { return ((p || "/").replace(/\/+$/, "").replace(/\.html$/, "")) || "/"; }
    var a = strip(pathname); if (a === "/index") a = "/";
    var b = strip(scope); if (b === "/index") b = "/";
    return a === b;
  }

  function categoryGranted(cat, consent) {
    if (cat === "necessary") return true;
    if (cat === "analytics") return !!consent.analytics;
    if (cat === "advertising") return !!consent.advertising;
    return false;
  }

  function injectSnippet(snippet) {
    var target = snippet.placement === "head" ? document.head : document.body;
    if (!target) return;
    var anchor = snippet.placement === "body_start" ? target.firstChild : null;
    var doc;
    try { doc = new DOMParser().parseFromString(snippet.code, "text/html"); } catch (e) { return; }
    var nodes = [];
    if (doc.head) nodes = nodes.concat(Array.prototype.slice.call(doc.head.childNodes));
    if (doc.body) nodes = nodes.concat(Array.prototype.slice.call(doc.body.childNodes));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i], out;
      if (node.tagName === "SCRIPT") {
        out = document.createElement("script");
        for (var a = 0; a < node.attributes.length; a++) out.setAttribute(node.attributes[a].name, node.attributes[a].value);
        if (node.textContent) out.textContent = node.textContent;
      } else if (node.nodeType === 1 || node.nodeType === 3) {
        out = document.importNode(node, true);
      } else { continue; }
      target.insertBefore(out, anchor); // null anchor === appendChild; keeps order for body_start
    }
  }

  function runInjection(consent) {
    if (!snippetsCache) return;
    for (var i = 0; i < snippetsCache.length; i++) {
      var s = snippetsCache[i];
      if (injectedIds[s.id]) continue;
      if (!pageMatchesScope(s.scope, location.pathname)) continue;
      if (!categoryGranted(s.consent_category, consent)) continue;
      injectSnippet(s);
      injectedIds[s.id] = true;
    }
  }

  function injectConsented(consent) {
    if (fetched) { runInjection(consent); return; }
    fetched = true;
    fetch("/api/code", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { snippetsCache = (d && d.snippets) || []; runInjection(consent); })
      .catch(function () { snippetsCache = []; });
  }

  function applyConsent(consent) {
    gtag("consent", "update", {
      analytics_storage: consent.analytics ? "granted" : "denied",
      ad_storage: consent.advertising ? "granted" : "denied",
      ad_user_data: consent.advertising ? "granted" : "denied",
      ad_personalization: consent.advertising ? "granted" : "denied"
    });
    injectConsented(consent);
  }

  function buildBanner() {
    var banner = document.createElement("div");
    banner.className = "consent-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie choices");
    banner.hidden = true;
    banner.innerHTML =
      '<div class="consent-text">' +
      '<strong>Cookies at the cafe</strong>' +
      '<p>We use optional cookies only to count visits and improve the site. Nothing is set unless you allow it. See the <a href="cookies.html">cookie policy</a>.</p>' +
      '</div>' +
      '<form class="consent-options" hidden>' +
      '<label><input type="checkbox" checked disabled> Strictly necessary (always on)</label>' +
      '<label><input type="checkbox" name="analytics"> Analytics: count visits anonymously</label>' +
      '<label><input type="checkbox" name="advertising"> Advertising: measure if our local ads work</label>' +
      '</form>' +
      '<div class="consent-actions">' +
      '<button type="button" class="button" data-consent-accept>Accept all cookies</button>' +
      '<button type="button" class="button ghost" data-consent-reject>Reject optional cookies</button>' +
      '<button type="button" class="button ghost" data-consent-customise>Choose cookies</button>' +
      '<button type="button" class="button" data-consent-save hidden>Save my choices</button>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  function init() {
    var banner = buildBanner();
    var options = banner.querySelector(".consent-options");
    var customiseButton = banner.querySelector("[data-consent-customise]");
    var saveButton = banner.querySelector("[data-consent-save]");

    function showBanner(withOptions) {
      banner.hidden = false;
      var stored = readConsent();
      if (stored) {
        options.querySelector("[name='analytics']").checked = !!stored.analytics;
        options.querySelector("[name='advertising']").checked = !!stored.advertising;
      }
      if (withOptions) {
        options.hidden = false;
        customiseButton.hidden = true;
        saveButton.hidden = false;
        options.querySelector("[name='analytics']").focus();
      }
    }

    function decide(consent) {
      consent.necessary = true;
      consent.decidedAt = new Date().toISOString();
      storeConsent(consent);
      applyConsent(consent);
      banner.hidden = true;
    }

    banner.querySelector("[data-consent-accept]").addEventListener("click", function () { decide({ analytics: true, advertising: true }); });
    banner.querySelector("[data-consent-reject]").addEventListener("click", function () { decide({ analytics: false, advertising: false }); });
    customiseButton.addEventListener("click", function () { showBanner(true); });
    saveButton.addEventListener("click", function () {
      decide({ analytics: options.querySelector("[name='analytics']").checked, advertising: options.querySelector("[name='advertising']").checked });
    });

    document.querySelectorAll("[data-cookie-settings]").forEach(function (trigger) {
      trigger.addEventListener("click", function () { showBanner(true); });
    });

    var stored = readConsent();
    if (stored) { applyConsent(stored); } else { showBanner(false); }
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
