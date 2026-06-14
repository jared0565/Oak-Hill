// functions/api/_lib/lead-core.mjs
// Pure helper for lead capture. Unit-testable with `node --test`.
import { clean } from "./contacts-core.mjs";

export function validateLead(body) {
  const email = clean(body?.email, 160);
  const name = clean(body?.name, 100) || null;
  if (!email || !email.includes("@") || !email.includes(".")) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  return { ok: true, value: { email, name } };
}
