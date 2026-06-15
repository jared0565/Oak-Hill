// Email-preferences page: reads the unsubscribe token, shows the current state, and lets the
// visitor unsubscribe or re-subscribe. State changes happen via POST (the API never changes state
// on GET, so a prefetched link can't opt someone out). All DOM via createElement + textContent.
(function () {
  const root = document.querySelector("[data-unsub]");
  if (!root) return;
  const token = new URLSearchParams(location.search).get("token") || "";

  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function message(text) { root.replaceChildren(el("p", text, "booking-note")); }

  function button(label, ghost) {
    const b = el("button", label, "button" + (ghost ? " ghost" : ""));
    b.type = "button";
    return b;
  }

  // Render the right call-to-action for the current subscription state.
  function paint(subscribed, emailMasked) {
    root.replaceChildren();
    if (subscribed) {
      root.appendChild(el("p", emailMasked ? "You're currently subscribed to Oak Hill Park Cafe emails as " + emailMasked + "." : "You're currently subscribed to Oak Hill Park Cafe emails."));
      const btn = button("Unsubscribe");
      btn.addEventListener("click", () => act(false, btn));
      root.appendChild(btn);
    } else {
      root.appendChild(el("p", "You're unsubscribed from Oak Hill Park Cafe emails. You won't receive marketing emails from us."));
      root.appendChild(el("p", "Changed your mind?", "booking-note"));
      const btn = button("Re-subscribe", true);
      btn.addEventListener("click", () => act(true, btn));
      root.appendChild(btn);
    }
    const status = el("p", "", "form-status");
    status.setAttribute("aria-live", "polite");
    root.appendChild(status);
  }

  // POST the change, then repaint to the new state with a short confirmation line.
  async function act(resubscribe, btn) {
    const status = root.querySelector(".form-status");
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Saving…";
    try {
      const res = await fetch("/api/unsubscribe?token=" + encodeURIComponent(token) + (resubscribe ? "&action=resubscribe" : ""), { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { if (status) status.textContent = d.error || "Something went wrong — please try again."; if (btn) btn.disabled = false; return; }
      paint(!!d.subscribed, null);
      const after = root.querySelector(".form-status");
      if (after) after.textContent = d.subscribed ? "You're subscribed again." : "You've been unsubscribed.";
    } catch (_) {
      if (status) status.textContent = "Network error — please try again.";
      if (btn) btn.disabled = false;
    }
  }

  async function init() {
    if (!token) { message("This link is missing its code. Please use the unsubscribe link from one of our emails, or call us on 0208 361 1013."); return; }
    try {
      const res = await fetch("/api/unsubscribe?token=" + encodeURIComponent(token));
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { message(d.error || "This unsubscribe link is invalid or has expired."); return; }
      paint(!!d.subscribed, d.emailMasked);
    } catch (_) {
      message("We couldn't load your preferences just now. Please try again, or call us on 0208 361 1013.");
    }
  }

  init();
})();
