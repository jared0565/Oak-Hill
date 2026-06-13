(function () {
  // Set this to the GA4 measurement ID (e.g. "G-XXXXXXXXXX") when analytics goes live.
  // While empty, no Google script ever loads; the banner still records choices.
  var GA_MEASUREMENT_ID = "";
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
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function storeConsent(consent) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    } catch (error) {
      /* Private browsing without storage: choices apply for this page view only. */
    }
  }

  var gaLoaded = false;

  function applyConsent(consent) {
    gtag("consent", "update", {
      analytics_storage: consent.analytics ? "granted" : "denied",
      ad_storage: consent.advertising ? "granted" : "denied",
      ad_user_data: consent.advertising ? "granted" : "denied",
      ad_personalization: consent.advertising ? "granted" : "denied"
    });

    if (consent.analytics && GA_MEASUREMENT_ID && !gaLoaded) {
      gaLoaded = true;
      var script = document.createElement("script");
      script.async = true;
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_MEASUREMENT_ID);
      document.head.appendChild(script);
      gtag("js", new Date());
      gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
    }
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

    banner.querySelector("[data-consent-accept]").addEventListener("click", function () {
      decide({ analytics: true, advertising: true });
    });

    banner.querySelector("[data-consent-reject]").addEventListener("click", function () {
      decide({ analytics: false, advertising: false });
    });

    customiseButton.addEventListener("click", function () {
      showBanner(true);
    });

    saveButton.addEventListener("click", function () {
      decide({
        analytics: options.querySelector("[name='analytics']").checked,
        advertising: options.querySelector("[name='advertising']").checked
      });
    });

    document.querySelectorAll("[data-cookie-settings]").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        showBanner(true);
      });
    });

    var stored = readConsent();
    if (stored) {
      applyConsent(stored);
    } else {
      showBanner(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
