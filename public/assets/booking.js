(function () {
  const root = document.querySelector("[data-booking]");
  if (!root) return;

  const slotsEl = root.querySelector("[data-booking-slots]");
  const form = root.querySelector("[data-booking-form]");
  const chosenEl = root.querySelector("[data-booking-chosen]");
  const statusEl = root.querySelector("[data-booking-status]");
  const successEl = root.querySelector("[data-booking-success]");
  const cancelBtn = root.querySelector("[data-booking-cancel]");
  const submitBtn = root.querySelector("[data-booking-submit]");
  let selected = null;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return DAYS[dt.getUTCDay()] + " " + d + " " + MONTHS[m - 1];
  }
  function fmtTime(t) {
    let [h, mi] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return h + (mi ? ":" + String(mi).padStart(2, "0") : "") + ap;
  }
  function slotLabel(s) {
    return fmtDate(s.date) + ", " + fmtTime(s.start_time) + "–" + fmtTime(s.end_time);
  }

  // The status line has to say which kind of message it is carrying: it used
  // to be green by default, so a server error was rendered in the success
  // colour and read as a confirmation.
  function setStatus(kind, text) {
    statusEl.classList.remove("is-error", "is-success");
    if (kind) statusEl.classList.add(kind);
    if (text != null)  statusEl.textContent = text;
  }

  // The message has to name the field that is wrong, and that field has to be
  // marked. "Please fill in your name, phone, email and pick a slot" when only
  // the name is empty tells the visitor nothing about which box to look at.
  function fieldName(el) {
    const label = el.id ? form.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
    const text = label ? label.textContent.trim().replace(/\s*\*$/, "") : "";
    const first =  text.split(/\s+/)[0];
    return  (first || el.name || "field").toLowerCase();
  }

  function markInvalid(el, on) {
    if (on) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }

  async function loadSlots() {
    slotsEl.innerHTML = '<p class="booking-note">Loading the free slots…</p>';
    try {
      const res = await fetch("/api/slots", { headers: { Accept: "application/json" } });
      const data = await res.json();
      renderSlots(data.slots || []);
    } catch {
      slotsEl.innerHTML = '<p class="booking-note">We could not load the availability just now. Please try again in a moment.</p>';
    }
  }

  function renderSlots(slots) {
    const summary = root.querySelector("[data-booking-summary]");
    if (!slots.length) {
      slotsEl.innerHTML = '<p class="booking-note">No slots are listed right now. Send us an enquiry and we will match a date for you.</p>';
      if (summary) summary.textContent = "";
      return;
    }
    // Say what is available and when the next one is. The list alone leaves a
    // visitor to work that out from a grid of dates.
    if (summary) {
      const days = new Set(slots.map((s) => s.date));
      summary.textContent =
        slots.length + " slots across " + days.size + " days. The next one is " + slotLabel(slots[0]) + ".";
    }
    const grid = document.createElement("div");
    grid.className = "booking-grid";
    for (const s of slots) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "booking-slot";
      const strong = document.createElement("strong");
      strong.textContent = fmtDate(s.date);
      const time = document.createElement("span");
      time.textContent = fmtTime(s.start_time) + "–" + fmtTime(s.end_time);
      const label = document.createElement("span");
      label.className = "booking-slot-label";
      label.textContent = s.label || "Party slot";
      btn.append(strong, time, label);
      btn.addEventListener("click", () => choose(s, btn));
      grid.appendChild(btn);
    }
    slotsEl.replaceChildren(grid);
  }

  function choose(slot, btn) {
    if (window.BFXTrack) window.BFXTrack("slot_selected");
    selected = slot;
    slotsEl.querySelectorAll(".booking-slot").forEach((x) => x.removeAttribute("aria-pressed"));
    btn.setAttribute("aria-pressed", "true");
    chosenEl.textContent = "Chosen: " + slotLabel(slot);
    successEl.hidden = true;
    form.hidden = false;
    setStatus(null, "");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.querySelector("[name='name']").focus();
  }

  cancelBtn.addEventListener("click", () => {
    form.hidden = true;
    selected = null;
    slotsEl.querySelectorAll(".booking-slot").forEach((x) => x.removeAttribute("aria-pressed"));
    slotsEl.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected) return;

    // Check the fields here first, so the message names one field and that
    // field is marked, rather than sending a request that fails for a reason
    // the visitor cannot see.
    const required = Array.from(form.querySelectorAll("input[required], select[required], textarea[required]"));
    const missing =  required.find((el) => !String(el.value || "").trim());
    const badEmail =  required.find((el) => el.type === "email" && String(el.value || "").trim() && !el.validity.valid);
    const bad =  missing || badEmail;
    if (bad) {
      required.forEach((el) =>  markInvalid(el, el === bad));
      setStatus("is-error", badEmail
        ? "That email address does not look right."
        : "Please fill in your " + fieldName(bad) + ".");
      bad.focus();
      return;
    }
    required.forEach((el) => markInvalid(el, false));

    submitBtn.disabled = true;
    setStatus(null, "Sending your request…");
    const fd = new FormData(form);
    const payload = {
      slot_id: selected.id,
      name: fd.get("name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      children: fd.get("children"),
      child_age: fd.get("child_age"),
      notes: fd.get("notes")
    };
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        form.hidden = true;
        const ref = document.createElement("strong");
        ref.textContent = data.demo
          ? "Your reference is " + data.ref + "."
          : "Thanks — your reference is " + data.ref + ".";
        const p = document.createElement("p");
        p.textContent = data.demo
          ? (data.message || "Your request has been checked. As this is a demonstration site, no reservation has been made and no email has been sent.") +
            " " + slotLabel(data.slot) + " was the slot you asked for."
          : "We've got your request for " + slotLabel(data.slot) + ". The slot stays open until your deposit is paid, which locks it in.";
        successEl.replaceChildren(ref, p);
        successEl.hidden = false;
        // The confirmation is the one thing the visitor must not miss, and it
        // is now the only thing on screen. Say it out loud, and put the cursor
        // on it, rather than leaving it below a form that has just vanished.
        successEl.setAttribute("role", "status");
        setStatus(null, "");
        successEl.scrollIntoView({ behavior: "smooth", block: "center" });
        successEl.focus();
        // The chosen slot kept its "held" ring while the text next to it said
        // no date was held.
        slotsEl.querySelectorAll(".booking-slot").forEach((x) => x.removeAttribute("aria-pressed"));
        selected = null;
      } else if (res.status === 409) {
        setStatus("is-error",  data.error || "That slot was just taken. Please pick another.");
        form.hidden = true;
        await loadSlots();
        slotsEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setStatus("is-error",  data.error || "Something went wrong. Please try again in a moment.");
      }
    } catch {
      setStatus("is-error", "Network problem. Please try again in a moment.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  loadSlots();
})();
