// PUT /api/admin/account/profile — update the acting user's name and/or avatar.
// Self-service: scoped to ctx.data.user only.
import { getFullUser, updateProfile, auditFromCtx } from "../../_lib/auth-db.mjs";
import { clean } from "../../_lib/contacts-core.mjs";

const AVATAR_PREFIX_RE = /^data:image\/(png|jpeg|webp);base64,/;
const AVATAR_MAX = 280000; // ~200 KB of base64

export async function onRequestPut(ctx) {
  try {
    const b = await ctx.request.json().catch(() => ({}));
    const fields = {};

    if (b.name !== undefined) {
      const name = clean(b.name, 100);
      if (!name) return Response.json({ error: "Name can't be empty." }, { status: 400 });
      fields.name = name;
    }

    if (b.avatar !== undefined) {
      const av = b.avatar;
      if (av === null || av === "") {
        fields.avatar = null;
      } else if (typeof av === "string" && AVATAR_PREFIX_RE.test(av) && av.length <= AVATAR_MAX) {
        fields.avatar = av;
      } else {
        return Response.json({ error: "Avatar must be a small PNG, JPEG, or WebP image." }, { status: 400 });
      }
    }

    if (!Object.keys(fields).length) return Response.json({ error: "Nothing to update." }, { status: 400 });

    await updateProfile(ctx.env.DB, ctx.data.user.id, fields);
    await auditFromCtx(ctx, { action: "account.profile_update", target_type: "user", target_id: ctx.data.user.id, detail: Object.keys(fields).join(", ") });

    const u = await getFullUser(ctx.env.DB, ctx.data.user.id);
    return Response.json({
      name: u.name,
      email: u.email,
      role: u.role,
      avatar: u.avatar || null,
      totp_enabled: !!u.totp_enabled,
    });
  } catch (_) {
    return Response.json({ error: "Could not update your profile." }, { status: 500 });
  }
}
