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
    var follow = function (event) { apply(event.matches ? "dark" : "light"); };
    if (query.addEventListener) query.addEventListener("change", follow);
    else if (query.addListener) query.addListener(follow);
  }

  function labelFor(theme) {
    return theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }

  function bind() {
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var sync = function () {
        var label = labelFor(current());
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
      };
      button.addEventListener("click", function () {
        var next = current() === "dark" ? "light" : "dark";
        apply(next);
        writeStored(next);
        sync();
      });
      sync();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
