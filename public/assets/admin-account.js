// Account & Security — self-service profile, password and 2FA for the signed-in user.
// IIFE in the same style as admin-users.js: uses window.OHPAdmin.api for authed fetches,
// builds all DOM with createElement (no innerHTML with server/user data), exposes render().
(function () {
  const root = document.querySelector("[data-account]");
  if (!root) return;
  const api = (p, o) => window.OHPAdmin.api(p, o);
  function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  const AVATAR_MAX = 280000; // data-URL char cap enforced server-side too
  const AVATAR_PX = 256;     // longest edge after client-side resize

  // First letters of up to two words; falls back to "?" for empty names.
  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Build an avatar element: <img> if a data URL is present, else an initials circle.
  function avatarNode(user, sizeCls) {
    if (user && user.avatar) {
      const img = el("img", null, "account-avatar account-avatar-img" + (sizeCls ? " " + sizeCls : ""));
      img.src = user.avatar;
      img.alt = "";
      return img;
    }
    const circle = el("span", initials(user && user.name), "account-avatar account-avatar-initials" + (sizeCls ? " " + sizeCls : ""));
    circle.setAttribute("aria-hidden", "true");
    return circle;
  }

  // ---- Profile card ----
  function profileCard(acct) {
    const card = el("section", null, "account-card");
    card.appendChild(el("h3", "Profile"));

    const row = el("div", null, "account-avatar-row");
    const preview = el("div", null, "account-avatar-preview");
    // Local mutable copy so the avatar preview can update before saving.
    const state = { name: acct.name, avatar: acct.avatar || null };
    preview.appendChild(avatarNode(state, "account-avatar-lg"));

    const controls = el("div", null, "account-avatar-controls");
    const fileLabel = el("label", null, "button ghost admin-mini account-file-label");
    fileLabel.appendChild(document.createTextNode("Upload photo"));
    const file = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/webp" });
    file.className = "account-file-input";
    fileLabel.appendChild(file);
    const removeBtn = el("button", "Remove photo", "button ghost admin-mini");
    removeBtn.type = "button";
    if (!state.avatar) removeBtn.hidden = true;
    controls.append(fileLabel, removeBtn);
    row.append(preview, controls);

    const nameLabel = el("label", null, "account-field");
    nameLabel.appendChild(el("span", "Name"));
    const name = Object.assign(document.createElement("input"), { type: "text", value: acct.name || "", maxLength: 100 });
    nameLabel.appendChild(name);

    const save = el("button", "Save profile", "button admin-mini");
    save.type = "button";
    const status = el("p", "", "form-status");

    function repaintPreview() { preview.replaceChildren(avatarNode(state, "account-avatar-lg")); removeBtn.hidden = !state.avatar; }

    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      file.value = ""; // allow re-selecting the same file later
      if (!f) return;
      status.textContent = "Processing image…";
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, AVATAR_PX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          let url;
          try { url = canvas.toDataURL("image/webp", 0.85); } catch (_) { url = canvas.toDataURL("image/png"); }
          if (url.length > AVATAR_MAX) { status.textContent = "That image is too large even after resizing — please pick a smaller one."; return; }
          state.avatar = url;
          repaintPreview();
          status.textContent = "Image ready — click Save profile to keep it.";
        };
        img.onerror = () => { status.textContent = "Could not read that image."; };
        img.src = reader.result;
      };
      reader.onerror = () => { status.textContent = "Could not read that file."; };
      reader.readAsDataURL(f);
    });

    removeBtn.addEventListener("click", () => { state.avatar = null; repaintPreview(); status.textContent = "Photo will be removed when you save."; });

    save.addEventListener("click", async () => {
      status.textContent = "Saving…";
      const body = { name: name.value.trim(), avatar: state.avatar };
      const r = await api("/api/admin/account/profile", { method: "PUT", body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { status.textContent = d.error || "Could not save your profile."; return; }
      status.textContent = "Saved.";
      // Keep the shell's user + top-bar avatar in sync.
      const me = window.OHPAdmin.user() || {};
      const next = { ...me, name: d.name != null ? d.name : body.name, avatar: d.avatar !== undefined ? d.avatar : state.avatar };
      if (window.OHPAdmin.setUser) window.OHPAdmin.setUser(next);
    });

    card.append(row, nameLabel, save, status);
    return card;
  }

  // ---- Email card (read-only) ----
  function emailCard(acct) {
    const card = el("section", null, "account-card");
    card.appendChild(el("h3", "Sign-in email"));
    const val = el("p", acct.email || "", "account-email");
    const note = el("p", "Changing your sign-in email needs email verification — coming soon.", "booking-note");
    card.append(val, note);
    return card;
  }

  // ---- Security card (password + 2FA) ----
  function securityCard(acct) {
    const card = el("section", null, "account-card");
    card.appendChild(el("h3", "Security"));

    // -- Change password --
    const pwBlock = el("div", null, "account-subblock");
    pwBlock.appendChild(el("h4", "Change password"));
    const cur = passwordField("Current password", "current-password");
    const nw = passwordField("New password (at least 12 characters)", "new-password");
    const conf = passwordField("Confirm new password", "new-password");
    const pwBtn = el("button", "Update password", "button admin-mini");
    pwBtn.type = "button";
    const pwStatus = el("p", "", "form-status");
    pwBlock.append(cur.label, nw.label, conf.label, pwBtn, pwStatus);

    pwBtn.addEventListener("click", async () => {
      const newPw = nw.input.value, confPw = conf.input.value;
      if (newPw.length < 12) { pwStatus.textContent = "New password must be at least 12 characters."; return; }
      if (newPw !== confPw) { pwStatus.textContent = "New password and confirmation do not match."; return; }
      pwStatus.textContent = "Updating…";
      const r = await api("/api/admin/account/password", { method: "PUT", body: JSON.stringify({ currentPassword: cur.input.value, newPassword: newPw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { pwStatus.textContent = d.error || "Could not update your password."; return; }
      cur.input.value = nw.input.value = conf.input.value = "";
      pwStatus.textContent = "Password updated. Other devices were signed out.";
    });

    // -- Two-factor --
    const twofaBlock = el("div", null, "account-subblock");
    twofaBlock.appendChild(el("h4", "Two-factor authentication"));
    const twofaBody = el("div");
    twofaBlock.appendChild(twofaBody);
    paint2fa(twofaBody, !!acct.totp_enabled);

    card.append(pwBlock, twofaBlock);
    return card;
  }

  function passwordField(labelText, autocomplete) {
    const label = el("label", null, "account-field");
    label.appendChild(el("span", labelText));
    const input = Object.assign(document.createElement("input"), { type: "password", autocomplete });
    label.appendChild(input);
    return { label, input };
  }

  // Render the 2FA sub-block for the given enabled state into `host`.
  function paint2fa(host, enabled) {
    host.replaceChildren();
    if (enabled) {
      host.appendChild(el("p", "Two-factor is on. You'll be asked for a code from your authenticator when you sign in.", "account-2fa-on"));
      const role = (window.OHPAdmin.user() || {}).role;
      if (role === "owner" || role === "manager") {
        host.appendChild(el("p", "Your role requires two-factor authentication. You can disable it to switch authenticator apps, but you'll be asked to set it up again straight away.", "booking-note"));
      }
      const disableBtn = el("button", "Disable two-factor", "button ghost admin-mini");
      disableBtn.type = "button";
      const status = el("p", "", "form-status");
      const pwWrap = el("div", null, "account-2fa-disable");
      const pw = passwordField("Confirm your password to disable", "current-password");
      const confirmBtn = el("button", "Confirm disable", "button admin-mini contact-erase");
      confirmBtn.type = "button";
      pwWrap.append(pw.label, confirmBtn);
      pwWrap.hidden = true;
      disableBtn.addEventListener("click", () => { pwWrap.hidden = false; disableBtn.hidden = true; pw.input.focus(); });
      confirmBtn.addEventListener("click", async () => {
        status.textContent = "Disabling…";
        const r = await api("/api/admin/account/2fa-disable", { method: "POST", body: JSON.stringify({ currentPassword: pw.input.value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { status.textContent = d.error || "Could not disable two-factor."; return; }
        syncTotp(false);
        // Owners/managers must keep 2FA: disabling (e.g. to swap authenticators) drops them into
        // the must-enrol state, so hand back to the shell's forced-enrolment gate instead of
        // painting the normal "off" state (which the API would then block them out of).
        if (d.mustEnroll2fa && window.OHPAdmin.requireEnroll) { window.OHPAdmin.requireEnroll(); return; }
        paint2fa(host, false);
      });
      host.append(disableBtn, pwWrap, status);
      return;
    }

    // Disabled → offer setup.
    host.appendChild(el("p", "Add a second step at sign-in using an authenticator app (Google Authenticator, 1Password, etc.).", "booking-note"));
    const enableBtn = el("button", "Enable two-factor authentication", "button admin-mini");
    enableBtn.type = "button";
    const status = el("p", "", "form-status");
    host.append(enableBtn, status);

    enableBtn.addEventListener("click", async () => {
      status.textContent = "Preparing…";
      const r = await api("/api/admin/account/2fa-setup", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { status.textContent = d.error || "Could not start two-factor setup."; return; }
      status.textContent = "";
      enableBtn.hidden = true;
      renderSetup(host, d.secret, d.otpauth);
    });
  }

  // Render the QR + secret + code entry for an in-progress setup. onDone (optional) runs after the
  // user acknowledges their backup codes — used by the forced-enrolment gate to enter the app.
  function renderSetup(host, secret, otpauth, onDone) {
    const wrap = el("div", null, "account-2fa-setup");
    wrap.appendChild(el("p", "Scan this with your authenticator app, then enter the 6-digit code it shows.", "booking-note"));

    const qrBox = el("div", null, "account-qr");
    const canvas = drawQr(otpauth);
    if (canvas) qrBox.appendChild(canvas);
    wrap.appendChild(qrBox);

    const secWrap = el("div", null, "account-secret");
    secWrap.appendChild(el("span", "Can't scan? Enter this key manually:", "account-secret-label"));
    secWrap.appendChild(el("code", secret, "account-secret-code"));
    wrap.appendChild(secWrap);

    const codeLabel = el("label", null, "account-field");
    codeLabel.appendChild(el("span", "6-digit code"));
    const code = Object.assign(document.createElement("input"), { type: "text", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6 });
    codeLabel.appendChild(code);
    const verifyBtn = el("button", "Verify & enable", "button admin-mini");
    verifyBtn.type = "button";
    const status = el("p", "", "form-status");
    wrap.append(codeLabel, verifyBtn, status);

    verifyBtn.addEventListener("click", async () => {
      status.textContent = "Verifying…";
      const r = await api("/api/admin/account/2fa-enable", { method: "POST", body: JSON.stringify({ code: code.value.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { status.textContent = d.error || "That code wasn't right — try again."; return; }
      syncTotp(true);
      renderBackupCodes(host, d.backupCodes || [], onDone);
    });

    host.appendChild(wrap);
  }

  // Show backup codes once, with copy + acknowledge. onDone (optional) overrides the default
  // "show the enabled state" — the forced-enrolment gate passes a callback that enters the app.
  function renderBackupCodes(host, codes, onDone) {
    host.replaceChildren();
    host.appendChild(el("p", "Two-factor is on. Save these backup codes somewhere safe — each works once if you lose your authenticator. They won't be shown again.", "account-2fa-on"));
    const block = el("div", null, "account-backup-codes");
    for (const c of codes) block.appendChild(el("code", c, "account-backup-code"));
    host.appendChild(block);

    const copyBtn = el("button", "Copy codes", "button ghost admin-mini");
    copyBtn.type = "button";
    const copyStatus = el("span", "", "account-copy-status");
    copyBtn.addEventListener("click", async () => {
      const text = codes.join("\n");
      try { await navigator.clipboard.writeText(text); copyStatus.textContent = "Copied."; }
      catch (_) { copyStatus.textContent = "Copy failed — select the codes manually."; }
    });
    const doneBtn = el("button", "I've saved these", "button admin-mini");
    doneBtn.type = "button";
    doneBtn.addEventListener("click", () => (typeof onDone === "function" ? onDone() : paint2fa(host, true)));
    const actions = el("div", null, "account-backup-actions");
    actions.append(copyBtn, copyStatus, doneBtn);
    host.appendChild(actions);
  }

  // Draw the otpauth URI as a QR onto a canvas (correct orientation, CSP-clean, no innerHTML).
  function drawQr(text) {
    if (typeof qrcode !== "function") return null;
    try {
      const qr = qrcode(0, "M"); // type 0 = auto-size
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      const cell = 5, margin = 4 * cell;
      const size = count * cell + margin * 2;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Two-factor setup QR code");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(margin + c * cell, margin + r * cell, cell, cell);
        }
      }
      return canvas;
    } catch (_) { return null; }
  }

  // Reflect 2FA state into the shell's user object so re-renders/topbar stay accurate.
  function syncTotp(on) {
    const me = window.OHPAdmin.user();
    if (me && window.OHPAdmin.setUser) window.OHPAdmin.setUser({ ...me, totp_enabled: on });
  }

  async function render() {
    root.replaceChildren(el("p", "Loading…", "booking-note"));
    const res = await api("/api/admin/account");
    if (!res.ok) { root.replaceChildren(el("p", "Could not load your account.", "booking-note")); return; }
    const acct = await res.json();
    root.replaceChildren(profileCard(acct), emailCard(acct), securityCard(acct));
  }

  // Forced-enrolment flow for the mandatory-2FA gate: kick straight into setup (skip the "Enable"
  // button), and on completion run onComplete instead of showing the in-account "enabled" state.
  // Used by admin.js's showEnroll() into the standalone [data-enroll-2fa] host (NOT the account
  // panel), so it only touches the two endpoints the API still allows pre-enrolment.
  async function renderEnroll(host, onComplete) {
    host.replaceChildren(el("p", "Preparing…", "booking-note"));
    const r = await api("/api/admin/account/2fa-setup", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { host.replaceChildren(el("p", d.error || "Could not start two-factor setup. Reload and try again.", "form-status")); return; }
    host.replaceChildren();
    renderSetup(host, d.secret, d.otpauth, onComplete);
  }

  window.OHPAccount = { render, renderEnroll };
})();
