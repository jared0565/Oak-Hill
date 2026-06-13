// POST /api/enquiry — save a contact/party enquiry to D1 and email the cafe (best-effort).
// Body: { type, name, email, phone?, message?, party_date?, children?, child_age?, source?, company?, elapsed_ms? }
import { sanitizeEnquiry, validateEnquiry, spamReason } from "./_lib/enquiry-core.mjs";
import { sendEnquiryEmail } from "./_lib/notify.mjs";

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

  try {
    await ctx.env.DB
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
      { error: "Could not send your message. Please call 0208 361 1013." },
      { status: 500 }
    );
  }

  // Best-effort email; must never block or break the response.
  ctx.waitUntil(sendEnquiryEmail(ctx.env, enquiry));

  return Response.json({ ok: true });
}
