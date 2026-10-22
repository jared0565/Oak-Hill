// POST /api/enquiry — save a contact/party enquiry to D1 and email the cafe (best-effort).
// Body: { type, name, email, phone?, message?, party_date?, children?, child_age?, source?, company?, elapsed_ms? }
//
// In demonstration mode the enquiry is validated and then dropped: nothing is
// written to the database, no contact is created and no email is sent.
import { sanitizeEnquiry, validateEnquiry, spamReason } from "./_lib/enquiry-core.mjs";
import { sendEnquiryEmail } from "./_lib/notify.mjs";
import { upsertContact } from "./_lib/contacts-db.mjs";
import { configGuard, isDemo, DEMO_MESSAGES } from "./_lib/demo.mjs";

// Checks the party size and the child's age. The visible forms constrain both,
// but a request can skip the form entirely, so the server checks them as well.
// A blank field means "not supplied" and is allowed. Returns a plain-English
// message when a value is present but not acceptable, or null when both are fine.
function partyProblem(children, childAge) {
  const kids = (children == null ? "" : String(children)).trim();
  if (kids) {
    const n = Number(kids);
    if (!Number.isInteger(n)) {
      return "The number of children should be a whole number between 1 and 25.";
    }
    if (n < 1) return "There must be at least one child on a party.";
    if (n > 25) return "There can be up to 25 children on a party.";
  }
  const age = (childAge == null ? "" : String(childAge)).trim();
  if (age) {
    const n = Number(age);
    if (!Number.isInteger(n) || n < 1 || n > 17) {
      return "The children's age should be between 1 and 17.";
    }
  }
  return null;
}

export async function onRequestPost(ctx) {
  let body;
  try {
    body = await ctx.request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Silent spam discard: respond OK so bots can't learn what tripped them.
  if (spamReason(body)) {
    return Response.json({ ok: true });
  }

  const enquiry = sanitizeEnquiry(body);
  const valid = validateEnquiry(enquiry);
  if (!valid.ok) {
    return Response.json({ error: valid.error }, { status: 400 });
  }

  // The number of children and the child's age are checked here, before the
  // demonstration and live branches, so both are held to the same rule.
  const problem = partyProblem(body.children, body.child_age);
  if (problem) {
    return Response.json({ error: problem }, { status: 400 });
  }

  const guard = configGuard(ctx.env);
  if (guard) return guard;

  // ---- demonstration mode -------------------------------------------------
  // The enquiry is validated, then discarded. No row, no contact, no email.
  if (isDemo(ctx.env)) {
    return Response.json({ ok: true, demo: true, message: DEMO_MESSAGES.enquiry });
  }

  // ---- live mode ----------------------------------------------------------
  let ins;
  try {
    ins = await ctx.env.DB
      .prepare(
        `INSERT INTO enquiries (type, name, email, phone, message, party_date, children, child_age, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        enquiry.type, enquiry.name, enquiry.email, enquiry.phone, enquiry.message,
        enquiry.party_date, enquiry.children, enquiry.child_age, enquiry.source
      )
      .run();
  } catch (err) {
    return Response.json(
      { error: "Could not save your message. Please try again in a moment." },
      { status: 500 }
    );
  }

  try {
    const cid = await upsertContact(ctx.env.DB, { email: enquiry.email, phone: enquiry.phone, name: enquiry.name });
    if (cid) await ctx.env.DB.prepare("UPDATE enquiries SET contact_id = ? WHERE id = ?").bind(cid, ins.meta.last_row_id).run();
  } catch (e) { /* best-effort */ }

  // Best-effort email; must never block or break the response.
  ctx.waitUntil(sendEnquiryEmail(ctx.env, enquiry));

  return Response.json({ ok: true });
}
