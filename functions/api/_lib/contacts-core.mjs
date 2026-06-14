// functions/api/_lib/contacts-core.mjs
// Pure helpers for the CRM. No Workers globals — unit-testable with `node --test`.

export function clean(v, max) { return (v == null ? "" : String(v)).trim().slice(0, max); }

export function normalizeEmail(e) { return clean(e, 160).toLowerCase(); }

const TAG_RE = /^[a-z0-9-]{1,30}$/;
export function validateTag(t) {
  const tag = clean(t, 30).toLowerCase().replace(/\s+/g, "-");
  if (!TAG_RE.test(tag)) return { ok: false, error: "Tags are 1–30 chars: letters, numbers, hyphens." };
  return { ok: true, value: tag };
}

// CSV-safe: strip CR/LF, neutralize spreadsheet formula injection, quote/escape as needed.
export function csvCell(v) {
  let s = (v == null ? "" : String(v)).replace(/[\r\n]+/g, " ");
  if (/^[=+\-@]/.test(s)) s = " " + s;
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
