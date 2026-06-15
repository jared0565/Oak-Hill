// POST /api/lead — newsletter signup = explicit marketing consent. Reuses upsertContact + spamReason.
import { validateLead } from "./_lib/lead-core.mjs";
import { spamReason } from "./_lib/enquiry-core.mjs";
import { upsertContact } from "./_lib/contacts-db.mjs";

export async function onRequestPost(ctx) {
  let body;
  try { body = await ctx.request.json(); } catch (e) { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (spamReason(body)) return Response.json({ ok: true });
  const v = validateLead(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const cid = await upsertContact(ctx.env.DB, { email: v.value.email, name: v.value.name });
    if (cid) {
      await ctx.env.DB.batch([
        // Opt in, clear any prior opt-out (a re-signup is a clean re-subscribe), and mint a stable
        // unsubscribe token if the contact doesn't already have one (COALESCE keeps old links valid).
        ctx.env.DB.prepare("UPDATE contacts SET marketing_opt_in = 1, marketing_opt_in_at = datetime('now'), marketing_opt_out_at = NULL, unsub_token = COALESCE(unsub_token, lower(hex(randomblob(16)))) WHERE id = ?").bind(cid),
        ctx.env.DB.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, 'newsletter')").bind(cid),
      ]);
    }
  } catch (e) {
    return Response.json({ error: "Could not sign you up just now. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
