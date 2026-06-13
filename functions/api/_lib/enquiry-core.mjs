// Pure helpers for the enquiry endpoint. No Workers globals — unit-testable with `node --test`.

const TYPES = new Set(["general", "party"]);

export function clean(v, max) {
  return (v == null ? "" : String(v)).trim().slice(0, max);
}

export function sanitizeEnquiry(body) {
  const type = TYPES.has(body?.type) ? body.type : "general";
  const out = {
    type,
    name: clean(body?.name, 100),
    email: clean(body?.email, 120),
    phone: clean(body?.phone, 40) || null,
    message: clean(body?.message, 2000) || null,
    source: clean(body?.source, 60) || null,
    party_date: null,
    children: null,
    child_age: null,
  };
  if (type === "party") {
    out.party_date = clean(body?.party_date, 40) || null;
    out.child_age = clean(body?.child_age, 40) || null;
    const n = Number(body?.children);
    out.children = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.trunc(n))) : null;
  }
  return out;
}

export function validateEnquiry(e) {
  if (!e.name) return { ok: false, error: "Please tell us your name." };
  if (!e.email) return { ok: false, error: "Please give us an email address." };
  if (!e.email.includes("@") || !e.email.includes(".")) {
    return { ok: false, error: "That email address does not look right." };
  }
  return { ok: true };
}

// Returns a short reason string if the submission looks like a bot, else null.
export function spamReason(body) {
  if (clean(body?.company, 200)) return "honeypot";          // hidden field must stay empty
  const elapsed = Number(body?.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed < 2000) return "too_fast";
  return null;                                                // absent timing must NOT block humans
}

// Build a Resend payload, or null if destination/sender aren't configured.
export function buildEmailPayload(e, env) {
  const to = env?.ENQUIRY_NOTIFY_TO;
  const from = env?.ENQUIRY_FROM;
  if (!to || !from) return null;
  const isParty = e.type === "party";
  const subject = isParty ? `New party enquiry — ${e.name}` : `New contact message — ${e.name}`;
  const lines = [`Type: ${e.type}`, `Name: ${e.name}`, `Email: ${e.email}`];
  if (e.phone) lines.push(`Phone: ${e.phone}`);
  if (isParty) {
    if (e.party_date) lines.push(`Preferred date: ${e.party_date}`);
    if (e.children != null) lines.push(`Children: ${e.children}`);
    if (e.child_age) lines.push(`Child's age: ${e.child_age}`);
  }
  if (e.message) lines.push("", "Message:", e.message);
  if (e.source) lines.push("", `Submitted from: ${e.source}`);
  return { from, to: [to], reply_to: e.email, subject, text: lines.join("\n") };
}
