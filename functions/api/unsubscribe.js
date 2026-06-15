// /api/unsubscribe — public, token-gated marketing-consent withdrawal (PECR reg.22 / RFC 8058).
// No session: the 128-bit unsub_token in the URL is the authorization. State changes only on POST
// (so link prefetchers/scanners, which GET, can't opt people out); GET just reports state.
import { recordAudit, reqContext } from "./_lib/auth-db.mjs";
import { maskEmail } from "./_lib/unsubscribe-core.mjs";

function findByToken(db, token) {
  return db.prepare("SELECT id, email, marketing_opt_in FROM contacts WHERE unsub_token = ?").bind(token).first();
}
const tokenOf = (ctx) => (new URL(ctx.request.url).searchParams.get("token") || "").trim();

// GET — report current subscription state so the page can show the right action.
export async function onRequestGet(ctx) {
  const token = tokenOf(ctx);
  if (!token) return Response.json({ error: "Missing unsubscribe link." }, { status: 400 });
  const c = await findByToken(ctx.env.DB, token);
  if (!c) return Response.json({ error: "This unsubscribe link is invalid or has expired." }, { status: 404 });
  return Response.json({ ok: true, subscribed: !!c.marketing_opt_in, emailMasked: maskEmail(c.email) });
}

// POST — withdraw consent (default) or re-subscribe (?action=resubscribe). Idempotent either way.
export async function onRequestPost(ctx) {
  const token = tokenOf(ctx);
  if (!token) return Response.json({ error: "Missing unsubscribe link." }, { status: 400 });
  const c = await findByToken(ctx.env.DB, token);
  if (!c) return Response.json({ error: "This unsubscribe link is invalid or has expired." }, { status: 404 });

  const resubscribe = new URL(ctx.request.url).searchParams.get("action") === "resubscribe";
  if (resubscribe) {
    await ctx.env.DB.prepare(
      "UPDATE contacts SET marketing_opt_in = 1, marketing_opt_in_at = COALESCE(marketing_opt_in_at, datetime('now')), marketing_opt_out_at = NULL WHERE id = ?"
    ).bind(c.id).run();
  } else {
    await ctx.env.DB.prepare(
      "UPDATE contacts SET marketing_opt_in = 0, marketing_opt_out_at = datetime('now') WHERE id = ?"
    ).bind(c.id).run();
  }
  await recordAudit(ctx.env.DB, {
    action: resubscribe ? "marketing.resubscribe" : "marketing.unsubscribe",
    target_type: "contact", target_id: c.id, detail: "self-service", ...reqContext(ctx.request),
  });
  return Response.json({ ok: true, subscribed: resubscribe });
}
