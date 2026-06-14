// functions/api/_lib/turnstile.mjs
// Cloudflare Turnstile bot check. No-op unless BOTH keys are configured (graceful rollout).

export function turnstileEnabled(env) {
  return !!(env && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
}

// Returns true only on a verified-human response. Fail-closed: any missing token, network
// error, or non-success verdict → false (callers only enforce this when turnstileEnabled).
export async function verifyTurnstile(secret, token, ip) {
  if (!secret || !token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return data && data.success === true;
  } catch (_) {
    return false;
  }
}
