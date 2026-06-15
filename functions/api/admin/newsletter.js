// /api/admin/newsletter — owner-only compose + send marketing email via Resend.
// No-ops cleanly without RESEND_API_KEY + NEWSLETTER_FROM (real broadcast also needs the owner to
// verify a Resend sending domain via DNS). Only opted-in contacts ever receive; every message
// carries a per-recipient one-click unsubscribe (reuses the shipped /api/unsubscribe + unsub_token).
import { requirePermission, auditFromCtx } from "../_lib/auth-db.mjs";
import { validateNewsletter, renderNewsletter, buildBatchEmail, chunk } from "../_lib/newsletter-core.mjs";
import { maskEmail } from "../_lib/unsubscribe-core.mjs";

const CAFE_NAME = "Oak Hill Park Cafe";
const CAFE_ADDRESS = "Parkside Gardens, Barnet EN4 8JP";

const configured = (env) => !!(env && env.RESEND_API_KEY && env.NEWSLETTER_FROM);
const unsubUrl = (origin, token) => origin + "/unsubscribe.html?token=" + encodeURIComponent(token);

function resendPost(env, path, payload) {
  return fetch("https://api.resend.com/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const OPTED_IN_SQL = "marketing_opt_in = 1 AND email IS NOT NULL AND TRIM(email) <> ''";
async function optedInRecipients(db) {
  const { results } = await db.prepare(`SELECT id, email, unsub_token FROM contacts WHERE ${OPTED_IN_SQL}`).all();
  return results || [];
}
// Give every opted-in contact a stable unsubscribe token before a real send.
function mintMissingTokens(db) {
  return db.prepare(`UPDATE contacts SET unsub_token = lower(hex(randomblob(16))) WHERE ${OPTED_IN_SQL} AND unsub_token IS NULL`).run();
}

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "newsletter"); if (deny) return deny;
  const countRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${OPTED_IN_SQL}`).first();
  const { results: history } = await ctx.env.DB.prepare(
    "SELECT id, subject, recipient_count, sent_count, failed_count, sent_at FROM newsletters ORDER BY sent_at DESC LIMIT 50"
  ).all();
  return Response.json({ recipientCount: countRow ? countRow.n : 0, history: history || [], configured: configured(ctx.env) });
}

export async function onRequestPost(ctx) {
  const deny = requirePermission(ctx, "newsletter"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const mode = String(b.mode || "");
  const v = validateNewsletter(b);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const { subject, body } = v.value;
  const origin = new URL(ctx.request.url).origin;
  const render = (token) => renderNewsletter({ bodyText: body, unsubUrl: unsubUrl(origin, token), cafeName: CAFE_NAME, cafeAddress: CAFE_ADDRESS });

  // DRYRUN — build the recipient list + a redacted sample, send nothing, write nothing.
  if (mode === "dryrun") {
    const recipients = await optedInRecipients(ctx.env.DB);
    const first = recipients[0];
    const sample = first ? {
      toMasked: maskEmail(first.email),
      subject,
      hasListUnsubscribe: true,
      unsubUrlPreview: first.unsub_token ? unsubUrl(origin, first.unsub_token.slice(0, 6) + "…") : "(token minted at send time)",
    } : null;
    return Response.json({ mode, recipientCount: recipients.length, configured: configured(ctx.env), sample });
  }

  // TEST — one real email to the acting owner so they can check formatting + inbox placement.
  if (mode === "test") {
    if (!configured(ctx.env)) return Response.json({ error: "Email isn't set up yet (needs RESEND_API_KEY + NEWSLETTER_FROM)." }, { status: 400 });
    const to = ctx.data.user.email;
    const own = await ctx.env.DB.prepare("SELECT unsub_token FROM contacts WHERE email = ?").bind(to).first();
    const token = (own && own.unsub_token) || "example-test-token";
    const { html, text } = render(token);
    const email = buildBatchEmail({ from: ctx.env.NEWSLETTER_FROM, to, subject: "[TEST] " + subject, html, text, unsubUrl: unsubUrl(origin, token) });
    const res = await resendPost(ctx.env, "emails", email);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({ error: "Test send failed (" + res.status + ").", detail: detail.slice(0, 300) }, { status: 502 });
    }
    await auditFromCtx(ctx, { action: "newsletter.test", detail: "test send to " + to });
    return Response.json({ ok: true, mode, sentTo: to });
  }

  // SEND — broadcast to all opted-in contacts. Mint tokens, batch in 100s, record the campaign.
  if (mode === "send") {
    if (!configured(ctx.env)) return Response.json({ error: "Email isn't set up yet (needs RESEND_API_KEY + NEWSLETTER_FROM)." }, { status: 400 });
    await mintMissingTokens(ctx.env.DB);
    const recipients = await optedInRecipients(ctx.env.DB);
    if (!recipients.length) return Response.json({ error: "No subscribers to send to." }, { status: 400 });
    let sent = 0, failed = 0;
    for (const group of chunk(recipients, 100)) {
      const emails = group.map((r) => {
        const { html, text } = render(r.unsub_token);
        return buildBatchEmail({ from: ctx.env.NEWSLETTER_FROM, to: r.email, subject, html, text, unsubUrl: unsubUrl(origin, r.unsub_token) });
      });
      try {
        const res = await resendPost(ctx.env, "emails/batch", emails);
        if (res.ok) sent += group.length; else failed += group.length;
      } catch (_) { failed += group.length; }
    }
    await ctx.env.DB.prepare(
      "INSERT INTO newsletters (subject, body, recipient_count, sent_count, failed_count, sent_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(subject, body, recipients.length, sent, failed, ctx.data.user.id).run();
    await auditFromCtx(ctx, { action: "newsletter.send", detail: `${sent} sent / ${failed} failed of ${recipients.length}` });
    return Response.json({ ok: true, mode, recipientCount: recipients.length, sent, failed });
  }

  return Response.json({ error: "Unknown mode." }, { status: 400 });
}
