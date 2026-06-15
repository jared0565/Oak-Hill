// /api/admin/audit — Owner-only read of the sign-in + activity log, with filters.
import { requirePermission } from "../_lib/auth-db.mjs";

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "audit"); if (deny) return deny;
  const url = new URL(ctx.request.url);
  const where = [], binds = [];

  const actor = Number(url.searchParams.get("actor"));
  if (Number.isInteger(actor) && actor > 0) { where.push("actor_user_id = ?"); binds.push(actor); }

  const action = (url.searchParams.get("action") || "").trim();
  if (action) {
    if (action.endsWith(".")) { where.push("action LIKE ?"); binds.push(action + "%"); }
    else { where.push("action = ?"); binds.push(action); }
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || "")) { where.push("created_at >= ?"); binds.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || "")) { where.push("created_at <= ?"); binds.push(to + " 23:59:59"); }

  if (url.searchParams.get("include_bots") !== "1") where.push("is_bot = 0");

  let limit = Number(url.searchParams.get("limit")) || 200;
  if (limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  let sql = "SELECT created_at, actor_email, action, target_type, target_id, detail, ip, country, user_agent, is_bot, bot_reason FROM audit_log";
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY id DESC LIMIT ?";
  binds.push(limit);
  const { results } = await ctx.env.DB.prepare(sql).bind(...binds).all();
  return Response.json({ entries: results });
}
