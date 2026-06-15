// /api/admin/users — Owner-only staff account management (authz + audit enforced here).
import { requirePermission, auditFromCtx, listUsers, getUserById, findUserByEmail, createUser, updateUser, deleteUser, deleteUserSessions, countOwners } from "../_lib/auth-db.mjs";
import { validatePassword, protectedBlock } from "../_lib/auth-core.mjs";
import { normalizeEmail, clean } from "../_lib/contacts-core.mjs";

const ROLES = ["owner", "manager", "staff"];

export async function onRequestGet(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  return Response.json({ users: await listUsers(ctx.env.DB) });
}

export async function onRequestPost(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const name = clean(b.name, 100);
  const email = normalizeEmail(b.email);
  const role = String(b.role || "");
  const pw = typeof b.password === "string" ? b.password : "";
  if (!name || !email) return Response.json({ error: "Name and email are required." }, { status: 400 });
  if (!ROLES.includes(role)) return Response.json({ error: "Pick a valid role." }, { status: 400 });
  const pv = validatePassword(pw); if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 });
  if (await findUserByEmail(ctx.env.DB, email)) return Response.json({ error: "That email is already in use." }, { status: 409 });
  const id = await createUser(ctx.env.DB, { name, email, role, password: pw });
  await auditFromCtx(ctx, { action: "user.create", target_type: "user", target_id: id, detail: role + " " + email });
  return Response.json({ ok: true, id });
}

export async function onRequestPut(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const b = await ctx.request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  const target = await getUserById(ctx.env.DB, id);
  if (!target) return Response.json({ error: "Not found." }, { status: 404 });

  const fields = {};
  if (b.role !== undefined) { if (!ROLES.includes(String(b.role))) return Response.json({ error: "Bad role." }, { status: 400 }); fields.role = String(b.role); }
  if (b.status !== undefined) { const st = String(b.status); if (st !== "active" && st !== "disabled") return Response.json({ error: "Bad status." }, { status: 400 }); fields.status = st; }
  if (b.password !== undefined) { const pv = validatePassword(String(b.password)); if (!pv.ok) return Response.json({ error: pv.error }, { status: 400 }); fields.password = String(b.password); }
  if (!Object.keys(fields).length) return Response.json({ error: "Nothing to update." }, { status: 400 });

  // Protected (break-glass) owner: can't be demoted or disabled. Password reset is allowed.
  const prot = protectedBlock(target, { role: fields.role, status: fields.status });
  if (prot) return Response.json({ error: prot }, { status: 409 });

  // Last-owner guard: never demote or disable the only active owner.
  const demoting = fields.role !== undefined && fields.role !== "owner" && target.role === "owner";
  const disabling = fields.status === "disabled" && target.role === "owner";
  if ((demoting || disabling) && (await countOwners(ctx.env.DB)) <= 1) {
    return Response.json({ error: "This is the last active owner — promote another owner first." }, { status: 409 });
  }

  const detail = [];
  if (fields.role) detail.push("role: " + target.role + "→" + fields.role);
  if (fields.status) detail.push("status: " + target.status + "→" + fields.status);
  if (fields.password) detail.push("password reset");
  await updateUser(ctx.env.DB, id, fields);
  if (fields.status === "disabled" || fields.password !== undefined) await deleteUserSessions(ctx.env.DB, id);
  await auditFromCtx(ctx, { action: "user.update", target_type: "user", target_id: id, detail: detail.join(", ") });
  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const deny = requirePermission(ctx, "users"); if (deny) return deny;
  const id = Number(new URL(ctx.request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing id." }, { status: 400 });
  if (ctx.data.user.id === id) return Response.json({ error: "You can't delete your own account while signed in." }, { status: 409 });
  const target = await getUserById(ctx.env.DB, id);
  if (!target) return Response.json({ error: "Not found." }, { status: 404 });
  const protDel = protectedBlock(target, { deleting: true });
  if (protDel) return Response.json({ error: protDel }, { status: 409 });
  if (target.role === "owner" && (await countOwners(ctx.env.DB)) <= 1) {
    return Response.json({ error: "This is the last active owner — promote another owner first." }, { status: 409 });
  }
  await deleteUser(ctx.env.DB, id); // also removes the user's sessions + backup codes atomically
  await auditFromCtx(ctx, { action: "user.delete", target_type: "user", target_id: id, detail: target.role + " " + target.email });
  return Response.json({ ok: true });
}
