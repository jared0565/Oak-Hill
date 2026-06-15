// functions/api/_lib/unsubscribe-core.mjs
// Pure helpers for the public unsubscribe flow. Unit-testable with `node --test`.

// Mask an email for a confirmation page so a leaked unsubscribe link doesn't expose the full
// address: keep the first local-part character, star the rest, keep the domain. Falls back to a
// generic label for anything that isn't a plausible address.
export function maskEmail(email) {
  const s = (email == null ? "" : String(email)).trim();
  const at = s.indexOf("@");
  if (at < 1 || at === s.length - 1) return "your email";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const shown = local[0] + "***";
  return shown + "@" + domain;
}
