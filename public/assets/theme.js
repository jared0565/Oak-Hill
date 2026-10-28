/* theme.js — the light and dark mode switch.

   Loaded from <head> without `defer`, on purpose: it has to set the theme
   before the page is painted. A page that flashes cream and then turns
   black is worse than a page that is simply black.

   The visitor's choice is kept in local storage under "bytesfx-theme".
   With no choice stored the site follows the operating system's setting,
   and keeps following it if the system setting changes later. */

(function () {
  var KEY = "bytesfx-theme";
  var root = document.documentElement;

  function readStored() {
    try {
      var value = localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (e) {
      return null; // private mode, or storage turned off
    }
  }

  function writeStored(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* nothing to do */ }
  }

  function systemTheme() {
    if (!window.matchMedia) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
  }

  function current() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  var stored = readStored();
  apply(stored || systemTheme());

  // With nothing stored, keep following the operating system.
  if (!stored && window.matchMedia) {
    var query = window.matchMedia("(prefers-color-scheme: dark)");
    var follow = function (event) { setTheme(event.matches ? "dark" : "light"); };
    if (query.addEventListener) query.addEventListener("change", follow);
    else if (query.addListener) query.addListener(follow);
  }

  function labelFor(theme) {
    return theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }

  // The switches on the page. One place knows how to find them.
  function switches() {
    return document.querySelectorAll("[data-theme-toggle]");
  }

  // Every switch on the page names the same action, because the mode is the
  // same for all of them. They are renamed whenever the mode moves — whether
  // the visitor pressed a switch or the operating system did — so that no
  // switch is ever naming the action it will not take.
  function syncLabels(buttons) {
    var label = labelFor(current());
    var list = buttons || switches();
    for (var i = 0; i < list.length; i++) {
      list[i].setAttribute("aria-label", label);
      list[i].setAttribute("title", label);
    }
  }

  function setTheme(theme) {
    apply(theme);
    syncLabels();
  }

  function bind() {
    var buttons = switches();
    for (var i = 0; i < buttons.length; i++) {
      bindButton(buttons[i]);
    }
    syncLabels(buttons);
  }

  // One switch at a time, and each is bound on its own: the staff console
  // carries two of them, and each has to name the action IT will take.
  function bindButton(button) {
    button.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      setTheme(next);
      writeStored(next);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
