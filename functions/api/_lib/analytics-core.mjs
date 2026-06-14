// functions/api/_lib/analytics-core.mjs
// Pure helpers for first-party analytics. No Workers globals — unit-testable with `node --test`.

const TRACK_NAMES = new Set(["page_view", "slot_selected"]);

export function clean(v, max) { return (v == null ? "" : String(v)).trim().slice(0, max); }

export function validateTrackName(name) { return TRACK_NAMES.has(name); }

export function sanitizeDays(d) { const n = Number(d); return [7, 30, 90].includes(n) ? n : 30; }

// Returns a host or campaign token only — never a full URL/query string (privacy).
export function deriveSource(referrer, utm, selfHost) {
  const u = clean(utm, 60).toLowerCase();
  if (u) return u;
  const r = clean(referrer, 500);
  if (!r) return "direct";
  let host = "";
  try { host = new URL(r).hostname.toLowerCase(); } catch (e) { return "direct"; }
  if (!host || host === clean(selfHost, 200).toLowerCase()) return "direct";
  return host.slice(0, 120);
}
