// functions/api/_lib/demo.mjs
// The demonstration boundary for BytesFX Café & Bookings.
//
// This site is a DEMONSTRATION. The café is fictional, the menus, prices and
// availability are illustrative, and nothing a visitor submits may reach a real
// inbox, a real reservation or a real customer record.
//
// Two server-side settings decide what the API does. Neither is a request
// parameter and neither is reachable by a visitor — they are Cloudflare
// environment variables, set in `vars` in wrangler.jsonc:
//
//   DEMO_MODE      "true"  -> demonstration behaviour. Submissions are
//                            simulated, and no personal detail is stored.
//                  "false" -> the original live workflow, kept intact so the
//                            booking code stays reusable.
//   LIVE_MODE_ACK  "true"  -> required, in addition to DEMO_MODE="false",
//                            before the live path can arm at all.
//
// Fail-safe rule: an unrecognised or missing DEMO_MODE is NOT live. The site
// reports that it is unconfigured and writes nothing, so a misconfigured
// deployment can never quietly accept real bookings. Arming live takes two
// deliberate settings, and neither can be flipped by a visitor.

// The standing notice, used site-wide.
export const DEMO_NOTICE =
  "Demonstration website by BytesFX. This is a fictional café. Menus, prices and availability are illustrative. No real bookings or payments are accepted.";

// Shorter notices, used next to the thing they describe.
export const DEMO_MESSAGES = {
  menu: "Sample menu and prices.",
  image: "AI-generated illustration",
  booking: "Demo booking — no reservation will be made.",
  enquiry: "Demo enquiry — no message will be sent.",
  newsletter: "Demo signup — no email will be sent.",
};

// "demo" | "live" | "unconfigured"
export function resolveMode(env) {
  const mode = String(env?.DEMO_MODE ?? "").trim().toLowerCase();
  if (mode === "true") return "demo";
  if (mode === "false") {
    const ack = String(env?.LIVE_MODE_ACK ?? "").trim().toLowerCase();
    return ack === "true" ? "live" : "unconfigured";
  }
  return "unconfigured";
}

// True for every mode that is not a fully-armed live site.
export function isDemo(env) {
  return resolveMode(env) !== "live";
}

// Returns a Response to return as-is when the environment cannot be used, or
// null when the endpoint may proceed. Call this before any write.
export function configGuard(env) {
  if (resolveMode(env) !== "unconfigured") return null;
  return Response.json(
    {
      error: "This demonstration site is not configured, so nothing was submitted.",
      detail:
        'Set DEMO_MODE="true" in the Cloudflare environment (wrangler.jsonc vars) to run the demonstration.',
    },
    { status: 503 }
  );
}

// A booking reference that is unmistakably synthetic: it is not a real
// reservation, and it cannot collide with a live "BFX-" reference.
export function demoRef() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += "0123456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 33];
  return "DEMO-" + s;
}
