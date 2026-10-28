// functions/api/_lib/snippet-core.mjs
// Pure helpers for the tracking-code manager. No Workers globals — unit-testable with `node --test`.

const PLACEMENTS = new Set(["head", "body_start", "body_end"]);
// Owner-pasted snippets may only be consent-gated categories. "necessary" (runs before consent)
// is deliberately NOT selectable here: under PECR only strictly-essential code may run without
// consent, and every such script on this site is first-party (in the repo), never pasted. This
// stops a tracker (GA/Pixel/etc.) being mislabelled "necessary" to bypass the consent gate.
const CATEGORIES = new Set(["analytics", "advertising"]);
const SCOPE_RE = /^\/[a-z0-9-]*\.html$/;

// The hosts an owner-pasted tag may load from. The site's Content-Security-Policy
// in public/_headers does NOT allow these while the site is a demonstration: a
// demonstration loads no third-party tag at all, and the policy says so to the
// browser as well as to the server. Arming the site for real therefore means
// widening that policy to match this list (plus challenges.cloudflare.com for
// the bot check) — see the arming note in functions/api/_lib/demo.mjs.
export const ALLOWED_SUFFIXES = [
  "googletagmanager.com", "google-analytics.com", "googleadservices.com", "doubleclick.net",
  "google.com", "google.co.uk", "gstatic.com", "googleapis.com",
  "facebook.net", "facebook.com", "licdn.com", "tiktok.com", "bing.com", "clarity.ms",
  "hotjar.com", "hotjar.io",
];

export function clean(v, max) { return (v == null ? "" : String(v)).trim().slice(0, max); }

export function validateSnippet(body) {
  const label = clean(body?.label, 80);
  const code = clean(body?.code, 10000);
  const placement = PLACEMENTS.has(body?.placement) ? body.placement : "head";
  const scope = clean(body?.scope, 100) || "global";
  const consent_category = CATEGORIES.has(body?.consent_category) ? body.consent_category : "advertising";
  const enabled = body?.enabled === 0 || body?.enabled === false ? 0 : 1;
  if (!label) return { ok: false, error: "Give the snippet a label." };
  if (!code) return { ok: false, error: "Paste some code." };
  if (scope !== "global" && scope !== "/" && !SCOPE_RE.test(scope)) {
    return { ok: false, error: "Scope must be 'global' or a page path like /parties.html." };
  }
  return { ok: true, value: { label, code, placement, scope, consent_category, enabled } };
}

export function extractHosts(code) {
  const hosts = new Set();
  const re = /https?:\/\/([a-z0-9.-]+)/gi;
  let m;
  while ((m = re.exec(String(code || "")))) hosts.add(m[1].toLowerCase());
  return [...hosts];
}

export function isAllowedHost(host) {
  return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

export function unknownHostsIn(code) {
  return extractHosts(code).filter((h) => !isAllowedHost(h));
}

// Client also has a mirror of this in consent.js. Normalizes Cloudflare clean URLs.
export function pageMatchesScope(scope, pathname) {
  if (scope === "global") return true;
  const strip = (p) => ((p || "/").replace(/\/+$/, "").replace(/\.html$/, "") || "/");
  let a = strip(pathname); if (a === "/index") a = "/";
  let b = strip(scope); if (b === "/index") b = "/";
  return a === b;
}
