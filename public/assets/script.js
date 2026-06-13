(function () {
  const navToggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-primary-nav]");

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!isOpen));
      navToggle.setAttribute("aria-expanded", String(!isOpen));
      document.body.classList.toggle("menu-open", !isOpen);
    });
  }

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

  const mapEmbed = document.querySelector("[data-map-embed]");
  if (mapEmbed) {
    const loadButton = mapEmbed.querySelector("[data-map-load]");
    loadButton.addEventListener("click", () => {
      const iframe = document.createElement("iframe");
      iframe.className = "map-frame";
      iframe.title = "Map to Oak Hill Park Cafe";
      iframe.src = mapEmbed.getAttribute("data-map-src");
      mapEmbed.replaceWith(iframe);
    });
  }

  document.querySelectorAll("[data-static-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      if (status) {
        status.textContent = "Thanks. Please call 0208 361 1013 to complete this enquiry.";
      }
    });
  });
})();
