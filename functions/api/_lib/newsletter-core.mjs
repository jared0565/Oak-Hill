// functions/api/_lib/newsletter-core.mjs
// Pure helpers for composing + batching the newsletter. No Workers globals — unit-testable.

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function validateNewsletter({ subject, body } = {}) {
  const s = (subject == null ? "" : String(subject)).trim();
  const b = (body == null ? "" : String(body)).trim();
  if (!s) return { ok: false, error: "Please add a subject." };
  if (s.length > 200) return { ok: false, error: "Subject is too long (200 characters max)." };
  if (!b) return { ok: false, error: "Please write a message." };
  if (b.length > 20000) return { ok: false, error: "Message is too long." };
  return { ok: true, value: { subject: s, body: b } };
}

// Owner-typed plain text → HTML: blank line = paragraph, single newline = <br>. Escaped first,
// so nothing the owner types can inject markup.
function textToHtmlParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => '<p style="margin:0 0 1em">' + escapeHtml(block).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

// Render the branded HTML + plain-text versions of one newsletter. The footer (sender identity +
// unsubscribe) is always present — required for marketing email (PECR / RFC 8058).
export function renderNewsletter({ bodyText, unsubUrl, cafeName, cafeAddress }) {
  const name = cafeName || "Oak Hill Park Cafe";
  const addr = cafeAddress || "";
  const html =
    '<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#1f2a24;line-height:1.5">' +
    '<h1 style="font-size:20px;margin:0 0 20px;color:#1d4633">' + escapeHtml(name) + "</h1>" +
    textToHtmlParagraphs(bodyText) +
    '<hr style="border:none;border-top:1px solid #d8d8d8;margin:28px 0 16px">' +
    '<p style="font-size:12px;color:#6b6b6b;margin:0">' +
    escapeHtml(name) + (addr ? " &middot; " + escapeHtml(addr) : "") + "<br>" +
    'You\'re receiving this because you signed up for cafe news. ' +
    '<a href="' + escapeHtml(unsubUrl) + '" style="color:#1d4633">Unsubscribe</a>.' +
    "</p></div>";
  const text =
    String(bodyText || "").trim() +
    "\n\n—\n" + name + (addr ? "\n" + addr : "") +
    "\nYou're receiving this because you signed up for cafe news." +
    "\nUnsubscribe: " + unsubUrl;
  return { html, text };
}

// Build one Resend email object (for /emails or /emails/batch). The per-recipient List-Unsubscribe
// header + RFC 8058 one-click POST flag make this a compliant marketing message.
export function buildBatchEmail({ from, to, subject, html, text, unsubUrl }) {
  return {
    from,
    to: [to],
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": "<" + unsubUrl + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
