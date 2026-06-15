// Newsletter — owner-only compose + send. Uses window.OHPAdmin.api; all DOM via createElement.
(function () {
  const root = document.querySelector("[data-newsletter]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  function field(labelText, control) {
    const label = el("label", null, "account-field");
    label.appendChild(el("span", labelText));
    label.appendChild(control);
    return label;
  }

  async function render() {
    root.replaceChildren(el("p", "Loading…", "booking-note"));
    const res = await api("/api/admin/newsletter");
    if (!res.ok) { root.replaceChildren(el("p", "Could not load the newsletter section.", "booking-note")); return; }
    const data = await res.json();
    root.replaceChildren();

    if (!data.configured) {
      root.appendChild(el("p", "Email sending isn't switched on yet — add the Resend API key + sender address (and verify your sending domain) to send for real. You can still write and preview below.", "booking-note"));
    }

    const card = el("section", null, "account-card");
    card.appendChild(el("h3", "Compose"));

    const subject = Object.assign(document.createElement("input"), { type: "text", maxLength: 200, placeholder: "Subject" });
    const body = Object.assign(document.createElement("textarea"), { rows: 10, placeholder: "Write your message. Blank lines start a new paragraph." });
    card.append(field("Subject", subject), field("Message", body));

    const count = el("p", recipientLine(data.recipientCount), "booking-note");
    card.appendChild(count);

    const status = el("p", "", "form-status");
    status.setAttribute("aria-live", "polite");

    const previewBtn = el("button", "Preview recipients", "button ghost admin-mini"); previewBtn.type = "button";
    const testBtn = el("button", "Send test to me", "button ghost admin-mini"); testBtn.type = "button";
    const sendBtn = el("button", "Send to subscribers", "button admin-mini"); sendBtn.type = "button";
    const actions = el("div", null, "account-backup-actions");
    actions.append(previewBtn, testBtn, sendBtn);
    card.append(actions, status);
    root.appendChild(card);

    function payload(mode) { return JSON.stringify({ mode, subject: subject.value, body: body.value }); }
    function busy(on) { [previewBtn, testBtn, sendBtn].forEach((b) => (b.disabled = on)); }

    previewBtn.addEventListener("click", async () => {
      busy(true); status.textContent = "Checking…";
      const r = await api("/api/admin/newsletter", { method: "POST", body: payload("dryrun") });
      const d = await r.json().catch(() => ({}));
      busy(false);
      if (!r.ok) { status.textContent = d.error || "Could not preview."; return; }
      if (!d.recipientCount) { status.textContent = "No subscribers yet — nobody has opted in."; return; }
      const s = d.sample;
      status.textContent = d.recipientCount + " subscriber" + (d.recipientCount === 1 ? "" : "s") + " would receive this"
        + (s ? " — e.g. " + s.toMasked + ", with a one-click unsubscribe link." : ".");
    });

    testBtn.addEventListener("click", async () => {
      if (!subject.value.trim() || !body.value.trim()) { status.textContent = "Add a subject and message first."; return; }
      busy(true); status.textContent = "Sending test…";
      const r = await api("/api/admin/newsletter", { method: "POST", body: payload("test") });
      const d = await r.json().catch(() => ({}));
      busy(false);
      status.textContent = r.ok ? "Test sent to " + (d.sentTo || "you") + " — check it looks right before sending to everyone." : (d.error || "Test send failed.");
    });

    sendBtn.addEventListener("click", async () => {
      if (!subject.value.trim() || !body.value.trim()) { status.textContent = "Add a subject and message first."; return; }
      if (!data.recipientCount) { status.textContent = "No subscribers to send to."; return; }
      if (!confirm("Send this to " + data.recipientCount + " subscriber" + (data.recipientCount === 1 ? "" : "s") + "? This can't be undone.")) return;
      busy(true); status.textContent = "Sending…";
      const r = await api("/api/admin/newsletter", { method: "POST", body: payload("send") });
      const d = await r.json().catch(() => ({}));
      busy(false);
      if (!r.ok) { status.textContent = d.error || "Send failed."; return; }
      status.textContent = "Sent to " + d.sent + (d.failed ? " (" + d.failed + " failed)" : "") + ".";
      subject.value = ""; body.value = "";
      render(); // refresh history + count
    });

    // History
    if (data.history && data.history.length) {
      const hist = el("section", null, "account-card");
      hist.appendChild(el("h3", "Sent"));
      const ul = el("ul", null, "contact-timeline");
      for (const h of data.history) {
        ul.appendChild(el("li", (h.sent_at || "").slice(0, 10) + " — " + (h.subject || "") + " · " + h.sent_count + " sent" + (h.failed_count ? ", " + h.failed_count + " failed" : "")));
      }
      hist.appendChild(ul);
      root.appendChild(hist);
    }
  }

  function recipientLine(n) {
    if (!n) return "No subscribers have opted in yet.";
    return n + " subscriber" + (n === 1 ? "" : "s") + " opted in to cafe news will receive this.";
  }

  window.OHPNewsletter = { render };
})();
