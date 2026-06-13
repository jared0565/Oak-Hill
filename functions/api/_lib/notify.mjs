import { buildEmailPayload } from "./enquiry-core.mjs";

// Best-effort. No-op without a key/addresses. NEVER throws to the caller.
export async function sendEnquiryEmail(env, enquiry) {
  if (!env?.RESEND_API_KEY) return { sent: false, reason: "no_key" };
  const payload = buildEmailPayload(enquiry, env);
  if (!payload) return { sent: false, reason: "no_address" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.log("enquiry email failed", res.status, await res.text());
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.log("enquiry email error", err?.message);
    return { sent: false, reason: "exception" };
  }
}
