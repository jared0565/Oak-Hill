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
// Arming live is a third deliberate step, in the same file as the other two:
// the Content-Security-Policy in public/_headers allows no third-party host
// and no inline script, because a demonstration loads no third-party tag. A
// live site pastes tracking tags in as inline scripts and loads the bot check
// from Cloudflare, so its policy has to be widened to match — the list of
// hosts to allow is the application's own, in _lib/snippet-core.mjs, and
// tests/csp.test.mjs fails the moment the mode is armed without it.
//
// Fail-safe rule: an unrecognised or missing DEMO_MODE is NOT live. The site
// reports that it is unconfigured and writes nothing, so a misconfigured
// deployment can never quietly accept real bookings. Arming live takes two
// deliberate settings, and neither can be flipped by a visitor.

// The standing notice. The site carries a small "Demo Site" badge
// rather than a notice across every page, so this is the one place the
// boundary is stated in full — and it is what the server says if a caller
// ever asks what mode it is in.
export const DEMO_NOTICE =
  "BytesFX Café & Bookings is a demonstration site: the forms are checked and then discarded, and nothing a visitor sends is stored or sent.";

// The messages the visitor reads back after submitting something.
//
// These are the only place in the whole site where the demonstration is
// stated in as many words, and they are there on purpose. Everywhere else
// reads as a café website and the badge carries the disclosure; here, a
// visitor has just handed over a name, a phone number and the date of a
// child's party, and telling them "we have your booking" when nothing has
// been booked would be a false statement about a transaction.
export const DEMO_MESSAGES = {
  menu: "Menu and prices.",
  image: "Demo Image",
  booking:
    "Your request has been checked. As this is a demonstration site, no reservation has been made and no email has been sent.",
  enquiry:
    "Your message has been received. As this is a demonstration site, nothing has actually been sent and nothing has been stored.",
  newsletter:
    "Thanks for signing up. As this is a demonstration site, no sign-up has been recorded and no email will be sent.",
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
