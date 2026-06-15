// tests/newsletter-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml, validateNewsletter, renderNewsletter, buildBatchEmail, chunk,
} from "../functions/api/_lib/newsletter-core.mjs";

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml('<script>"&\'</script>'), "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
  assert.equal(escapeHtml(null), "");
});

test("validateNewsletter requires subject + body, caps length", () => {
  assert.equal(validateNewsletter({ subject: "", body: "hi" }).ok, false);
  assert.equal(validateNewsletter({ subject: "Hi", body: "" }).ok, false);
  assert.equal(validateNewsletter({ subject: "x".repeat(201), body: "hi" }).ok, false);
  const ok = validateNewsletter({ subject: "  Hello  ", body: "  Body  " });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { subject: "Hello", body: "Body" });
});

test("renderNewsletter: escaped paragraphs + unsubscribe link in html and text", () => {
  const { html, text } = renderNewsletter({
    bodyText: "Line one\nstill one\n\nPara two <b>bold</b>",
    unsubUrl: "https://x/unsub?token=abc",
    cafeName: "Oak Hill Park Cafe",
    cafeAddress: "Barnet EN4 8JP",
  });
  // blank line → two paragraphs; single newline → <br>
  assert.equal((html.match(/<p /g) || []).length >= 2, true);
  assert.match(html, /Line one<br>still one/);
  // owner content is escaped (no raw tag injected)
  assert.match(html, /Para two &lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  // unsubscribe + identity present in both renderings
  assert.match(html, /https:\/\/x\/unsub\?token=abc/);
  assert.match(html, /Barnet EN4 8JP/);
  assert.match(text, /Unsubscribe: https:\/\/x\/unsub\?token=abc/);
  assert.match(text, /Barnet EN4 8JP/);
});

test("buildBatchEmail sets RFC 8058 List-Unsubscribe headers", () => {
  const e = buildBatchEmail({ from: "a@b", to: "c@d", subject: "S", html: "<p>", text: "t", unsubUrl: "https://x/u?token=z" });
  assert.deepEqual(e.to, ["c@d"]);
  assert.equal(e.headers["List-Unsubscribe"], "<https://x/u?token=z>");
  assert.equal(e.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("chunk splits into batches", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});
