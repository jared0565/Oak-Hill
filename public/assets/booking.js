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

  async function loadSlots() {
    slotsEl.innerHTML = '<p class="booking-note">Loading open slots…</p>';
    try {
      const res = await fetch("/api/slots", { headers: { Accept: "application/json" } });
      const data = await res.json();
      renderSlots(data.slots || []);
    } catch {
      slotsEl.innerHTML = '<p class="booking-note">We could not load slots just now. Please call <a href="tel:+442083611013">0208 361 1013</a>.</p>';
    }
  }

  function renderSlots(slots) {
    if (!slots.length) {
      slotsEl.innerHTML = '<p class="booking-note">No open slots are listed right now. Call <a href="tel:+442083611013">0208 361 1013</a> or send a party enquiry and we will find you a date.</p>';
      return;
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
    if (window.OHPTrack) window.OHPTrack("slot_selected");
    selected = slot;
    slotsEl.querySelectorAll(".booking-slot").forEach((x) => x.removeAttribute("aria-pressed"));
    btn.setAttribute("aria-pressed", "true");
    chosenEl.textContent = "Hold " + slotLabel(slot);
    successEl.hidden = true;
    form.hidden = false;
    statusEl.textContent = "";
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
    submitBtn.disabled = true;
    statusEl.textContent = "Sending your request…";
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
        ref.textContent = "Thanks — your reference is " + data.ref + ".";
        const p = document.createElement("p");
        const tel = document.createElement("a");
        tel.href = "tel:+442083611013";
        tel.textContent = "0208 361 1013";
        p.append(
          "We've got your request for " + slotLabel(data.slot) +
          ". The slot stays open until your £100 deposit is paid, which locks it in, so call ",
          tel,
          " soon to secure it."
        );
        successEl.replaceChildren(ref, p);
        successEl.hidden = false;
        successEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (res.status === 409) {
        statusEl.textContent = data.error || "That slot was just taken. Please pick another.";
        form.hidden = true;
        await loadSlots();
        slotsEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        statusEl.textContent = data.error || "Something went wrong. Please call us on 0208 361 1013.";
      }
    } catch {
      statusEl.textContent = "Network problem. Please call 0208 361 1013.";
    } finally {
      submitBtn.disabled = false;
    }
  });

  loadSlots();
})();
