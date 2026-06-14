# E — Lead Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A footer newsletter signup (explicit marketing opt-in) that creates/updates a CRM contact with consent recorded, a `newsletter` tag, and a `lead_captured` event; a Leads count in Reports.

**Architecture:** `marketing_opt_in_at` column; `POST /api/lead` reusing `upsertContact` (D) + `spamReason` (enquiry-core); footer form injected via `script.js` (public pages only); `lead_captured` added to analytics; Leads count in reports. UK-GDPR: explicit informed consent, recorded with a timestamp, withdrawable.

**Tech Stack:** Cloudflare Pages Functions, D1, vanilla JS/CSS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-14-e-lead-capture-design.md`

**Review-driven musts:** (1) **verify the existing-contact-signs-up path** (a person who already booked/enquired then signs up — `upsertContact` returns their id but the separate UPDATE is what flips `marketing_opt_in`), plus idempotency on re-submit; (2) link the **privacy policy** from the signup (informed consent); (3) guard `if (window.OHPTrack) window.OHPTrack("lead_captured")`, and regression-check the now-fourth concern in `script.js`.

---

### Task 1: Migration 0007 — consent timestamp

**Files:** Create `migrations/0007_marketing_consent.sql`

- [ ] **Step 1:**
```sql
-- Migration 0007: record when marketing consent was given (consent evidence).
ALTER TABLE contacts ADD COLUMN marketing_opt_in_at TEXT;
```
- [ ] **Step 2:** `npx wrangler d1 migrations apply oak-hill-bookings --local` (reports 0007 applied).
- [ ] **Step 3: Commit** — "Add marketing_opt_in_at consent timestamp (migration 0007)" (+ trailer).

---

### Task 2: Pure helper — `lead-core.mjs` (+ tests)

**Files:** Create `functions/api/_lib/lead-core.mjs`, Create `tests/lead-core.test.mjs`

- [ ] **Step 1: Failing tests**
```js
// tests/lead-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLead } from "../functions/api/_lib/lead-core.mjs";

test("validateLead: valid email, optional name", () => {
  assert.deepEqual(validateLead({ email: " a@b.com ", name: " Sam " }), { ok: true, value: { email: "a@b.com", name: "Sam" } });
  assert.deepEqual(validateLead({ email: "a@b.com" }), { ok: true, value: { email: "a@b.com", name: null } });
});
test("validateLead: rejects bad/missing email", () => {
  assert.equal(validateLead({ email: "" }).ok, false);
  assert.equal(validateLead({ email: "nope" }).ok, false);
  assert.equal(validateLead({ name: "x" }).ok, false);
});
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `functions/api/_lib/lead-core.mjs`
```js
// functions/api/_lib/lead-core.mjs
// Pure helper for lead capture. Unit-testable with `node --test`.
import { clean } from "./contacts-core.mjs";

export function validateLead(body) {
  const email = clean(body?.email, 160);
  const name = clean(body?.name, 100) || null;
  if (!email || !email.includes("@") || !email.includes(".")) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  return { ok: true, value: { email, name } };
}
```
- [ ] **Step 4: Run — expect PASS (2 tests).**
- [ ] **Step 5: Commit** — "Add lead-core validateLead with tests" (+ trailer).

---

### Task 3: Endpoint — `POST /api/lead`

**Files:** Create `functions/api/lead.js`

- [ ] **Step 1:**
```js
// POST /api/lead — newsletter signup = explicit marketing consent. Reuses upsertContact + spamReason.
import { validateLead } from "./_lib/lead-core.mjs";
import { spamReason } from "./_lib/enquiry-core.mjs";
import { upsertContact } from "./_lib/contacts-db.mjs";

export async function onRequestPost(ctx) {
  let body;
  try { body = await ctx.request.json(); } catch (e) { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (spamReason(body)) return Response.json({ ok: true });           // silent discard for bots
  const v = validateLead(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  try {
    const cid = await upsertContact(ctx.env.DB, { email: v.value.email, name: v.value.name });
    if (cid) {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare("UPDATE contacts SET marketing_opt_in = 1, marketing_opt_in_at = datetime('now') WHERE id = ?").bind(cid),
        ctx.env.DB.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, 'newsletter')").bind(cid),
      ]);
    }
  } catch (e) {
    return Response.json({ error: "Could not sign you up just now. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```
- [ ] **Step 2:** `node --check functions/api/lead.js`.
- [ ] **Step 3: Commit** — "Add /api/lead endpoint (consent + tag, reuses upsertContact)" (+ trailer).

---

### Task 4: Analytics allowlist + Reports leads count

**Files:** Modify `functions/api/_lib/analytics-core.mjs`, Modify `tests/analytics-core.test.mjs`, Modify `functions/api/admin/reports.js`, Modify `public/assets/admin-reports.js`

- [ ] **Step 1: analytics-core — add `lead_captured`.** Change the `TRACK_NAMES` set to:
```js
const TRACK_NAMES = new Set(["page_view", "slot_selected", "lead_captured"]);
```
- [ ] **Step 2: analytics-core test — add an assertion** inside the existing `validateTrackName` test:
```js
  assert.equal(validateTrackName("lead_captured"), true);
```
Run `node --test tests/analytics-core.test.mjs` → pass.

- [ ] **Step 3: reports.js — add the leads query** to the `Promise.all` array (after the bookings query) and include it in the response. Add this prepared statement to the array:
```js
    db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE marketing_opt_in = 1 AND marketing_opt_in_at >= datetime('now', ?)").bind(cutoff).first(),
```
Update the destructure to capture it (e.g. `const [visits, slotSel, topPages, topSources, enquiries, bookings, leads] = await Promise.all([... , <the new stmt>]);`) and add `leads: leads.n` to the returned object.

- [ ] **Step 4: admin-reports.js — add a Leads stat card.** In the `stats.append(...)` call, add:
```js
      stat("Leads (opted in)", r.leads || 0),
```
- [ ] **Step 5:** `node --check functions/api/admin/reports.js public/assets/admin-reports.js`.
- [ ] **Step 6: Commit** — "Track lead_captured + show Leads in reports" (+ trailer).

---

### Task 5: Footer signup form (`script.js`) + styles

**Files:** Modify `public/assets/script.js`, Modify `public/assets/styles.css`

- [ ] **Step 1: Append the signup block to the END of `public/assets/script.js`**
```js

// ---- Footer newsletter signup (explicit marketing opt-in → CRM) ----
(function () {
  var footer = document.querySelector(".site-footer");
  if (!footer) return;
  var loadedAt = Date.now();

  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  var wrap = el("div", null, "footer-signup");
  wrap.appendChild(el("strong", "Cafe news & party offers"));
  var lead = el("p");
  lead.appendChild(document.createTextNode("Get occasional emails about the cafe and party offers. Unsubscribe anytime. "));
  var priv = el("a", "See our privacy policy"); priv.href = "privacy.html";
  lead.appendChild(priv);
  wrap.appendChild(lead);

  var form = document.createElement("form"); form.className = "footer-signup-form";
  // honeypot (hidden off-screen)
  var hp = document.createElement("input"); hp.type = "text"; hp.name = "company"; hp.tabIndex = -1; hp.autocomplete = "off";
  hp.setAttribute("aria-hidden", "true"); hp.style.cssText = "position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden";
  var email = document.createElement("input"); email.type = "email"; email.required = true; email.placeholder = "you@example.com"; email.setAttribute("aria-label", "Email address");
  var btn = el("button", "Sign me up", "button"); btn.type = "submit";
  var status = el("p", null, "footer-signup-status");
  form.append(hp, email, btn);
  wrap.append(form, status);
  footer.insertBefore(wrap, footer.firstChild);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    btn.disabled = true; status.textContent = "Signing you up…";
    fetch("/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, company: hp.value, elapsed_ms: Date.now() - loadedAt })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          wrap.replaceChildren(el("strong", "Thanks — you're on the list."), el("p", "We'll only email you about the cafe and party offers."));
          if (window.OHPTrack) window.OHPTrack("lead_captured");
        } else { btn.disabled = false; status.textContent = (res.d && res.d.error) || "Could not sign you up. Please try again."; }
      })
      .catch(function () { btn.disabled = false; status.textContent = "Network problem. Please try again."; });
  });
})();
```
- [ ] **Step 2: Append footer-signup styles to `public/assets/styles.css`**
```css
.footer-signup { border-bottom: 1px solid rgba(255,255,255,0.18); padding: 0 0 1.25rem; margin: 0 0 1.5rem; }
.footer-signup strong { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 1.15rem; }
.footer-signup p { margin: 0.35rem 0 0.75rem; color: rgba(255,255,255,0.82); font-size: 0.9rem; }
.footer-signup a { text-decoration: underline; }
.footer-signup-form { display: flex; gap: 0.5rem; flex-wrap: wrap; max-width: 480px; }
.footer-signup-form input[type="email"] { flex: 1 1 220px; min-height: 46px; padding: 0.6rem 0.8rem; border: 1px solid rgba(255,255,255,0.3); border-radius: var(--radius); background: rgba(255,255,255,0.95); color: var(--ink); }
.footer-signup-status { min-height: 1.2em; }
```
- [ ] **Step 3:** `node --check public/assets/script.js`; serve and confirm `/index.html` 200 and the footer markup includes a signup (`curl -s http://localhost:8141/index.html` then check the page still serves; the form is JS-injected so it won't be in the static HTML — verify in the browser during Task 7).
- [ ] **Step 4: Commit** — "Add footer newsletter signup with explicit consent" (+ trailer).

---

### Task 6: Privacy policy — marketing consent

**Files:** Modify `public/privacy.html`

- [ ] **Step 1:** Add a paragraph in the data-use/lawful-basis area (after the CRM contact-record paragraph added in D):
```html
        <p>If you sign up to our newsletter, we use your email to send occasional cafe news and party offers — our lawful basis is your <strong>consent</strong>, which you give by signing up and can <strong>withdraw at any time</strong> (tell us and we'll stop, or ask us to erase you). We record when you opted in. We do not share your details, and we will add a one-click unsubscribe link to our emails.</p>
```
- [ ] **Step 2:** Verify `privacy.html` serves (200) and contains "consent" + "unsubscribe".
- [ ] **Step 3: Commit** — "Note newsletter marketing consent in privacy policy" (+ trailer).

(Cookies policy is unchanged — newsletter signup sets no cookie; consent for *marketing email* belongs in the privacy policy.)

---

### Task 7: Verify (existing-contact path + idempotency + regression) and deploy

**Files:** none (verification).

- [ ] **Step 1: Full unit suite** — `node --test tests/availability-core.test.mjs tests/enquiry-core.test.mjs tests/snippet-core.test.mjs tests/analytics-core.test.mjs tests/contacts-core.test.mjs tests/lead-core.test.mjs` (all pass, incl. the new `lead_captured` assertion).

- [ ] **Step 2: Local `wrangler pages dev` — the EXISTING-contact path (the real test).**
```bash
cd "F:/Projects/Websites/Oak Hill"; T="local-test-password"; B="http://localhost:8788"; DB=oak-hill-bookings
# 1) Seed a contact via an ENQUIRY (creates contact with marketing_opt_in=0):
curl -s -X POST $B/api/enquiry -H "Content-Type: application/json" -d '{"type":"general","name":"Lead Test","email":"lead@example.com","message":"hi","elapsed_ms":5000}' >/dev/null
npx wrangler d1 execute $DB --local --command "SELECT id, marketing_opt_in, marketing_opt_in_at FROM contacts WHERE email='lead@example.com'"   # opt_in=0, at=NULL
# 2) Now that SAME email signs up via the newsletter:
curl -s -X POST $B/api/lead -H "Content-Type: application/json" -d '{"email":"lead@example.com","company":"","elapsed_ms":5000}'; echo ""
# ASSERT: one contact, opt_in flipped to 1, at set, newsletter tag added
npx wrangler d1 execute $DB --local --command "SELECT (SELECT COUNT(*) FROM contacts WHERE email='lead@example.com') AS n, (SELECT marketing_opt_in FROM contacts WHERE email='lead@example.com') AS opt, (SELECT marketing_opt_in_at IS NOT NULL FROM contacts WHERE email='lead@example.com') AS at_set, (SELECT COUNT(*) FROM contact_tags WHERE tag='newsletter' AND contact_id=(SELECT id FROM contacts WHERE email='lead@example.com')) AS tagged;"
# 3) Idempotency — sign up again:
curl -s -X POST $B/api/lead -H "Content-Type: application/json" -d '{"email":"lead@example.com","elapsed_ms":5000}' >/dev/null
npx wrangler d1 execute $DB --local --command "SELECT (SELECT COUNT(*) FROM contacts WHERE email='lead@example.com') AS contacts, (SELECT COUNT(*) FROM contact_tags WHERE tag='newsletter' AND contact_id=(SELECT id FROM contacts WHERE email='lead@example.com')) AS tags;"   # both 1
# 4) Spam (honeypot) is silently ignored — no new contact:
curl -s -X POST $B/api/lead -H "Content-Type: application/json" -d '{"email":"bot@example.com","company":"x","elapsed_ms":5000}' >/dev/null
npx wrangler d1 execute $DB --local --command "SELECT COUNT(*) AS bot FROM contacts WHERE email='bot@example.com'"   # 0
# cleanup
npx wrangler d1 execute $DB --local --command "DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE email='lead@example.com'); DELETE FROM enquiries WHERE email='lead@example.com'; DELETE FROM contacts WHERE email='lead@example.com';"
```
Expected: step 2 → `n=1, opt=1, at_set=1, tagged=1`; step 3 → `contacts=1, tags=1` (idempotent); step 4 → `bot=0`.

- [ ] **Step 3: Browser checks.** On a public page (e.g. `/`): the footer shows the signup with the **privacy-policy link**; submitting a valid email shows "you're on the list" and fires `lead_captured` (a `/api/track` request); **no cookie is set** by it. On `/admin.html`: **no signup form** (script.js not loaded there). Sign in → Reports shows a **"Leads (opted in)"** stat. **Regression:** nav menu, Share modal, the contact/party form, and the page-view tracker all still work (0 console errors) after this 4th `script.js` addition.

- [ ] **Step 4: Stop server; clean up.**

- [ ] **Step 5: Deploy** — `git push origin master`; watch CI to `completed success` (migrate applies 0007 — additive ALTER).

- [ ] **Step 6: Live verification**
```bash
BASE="https://oak-hill-park-cafe.pages.dev"
curl -s -o /dev/null -w "lead POST: %{http_code}\n" -X POST "$BASE/api/lead" -H "Content-Type: application/json" -d '{"email":"","elapsed_ms":5000}'   # 400 (invalid email) — confirms endpoint live + validating
curl -sI -X POST "$BASE/api/lead" -H "Content-Type: application/json" -d '{"email":"x@y.com","company":"x","elapsed_ms":5000}' | grep -ci "set-cookie"   # 0 (spam path, no cookie)
curl -sL "$BASE/privacy.html" | grep -c "unsubscribe"   # >=1
```
Load the live home page; confirm the footer signup renders with the privacy link. (Avoid submitting a real signup to production unless you want a real opted-in contact; if you do test-submit, erase it afterward in the dashboard.)

- [ ] **Step 7: Final commit if fixes were needed; push.**

---

## Self-Review

**Spec coverage:** consent timestamp (T1); validateLead + tests (T2); `/api/lead` (T3); analytics allowlist + Reports leads (T4); footer signup + privacy link + guarded track (T5); privacy consent wording (T6); existing-contact + idempotency + regression verification (T7). All map to a task.

**Compliance:** explicit opt-in (signup is the affirmative act), informed (privacy link in the form, T5), evidenced (`marketing_opt_in_at`, T1/T3), withdrawable (policy, T6); no cookie/IP; spam-gated via shared `spamReason`.

**Type consistency:** `validateLead` → `{ok,value:{email,name}}` consumed in T3. `upsertContact(db,{email,name})` (D) reused. `/api/admin/reports` now returns `leads`, consumed by `admin-reports.js` (T4). `window.OHPTrack("lead_captured")` guarded (T5); `lead_captured` in `TRACK_NAMES` (T4) so `/api/track` accepts it.

**Placeholder scan:** none. The spam path returns `Response.json({ ok: true })` (not the spec's `{ ok: true }` shorthand). `lead@example.com`/`bot@example.com` are deliberate test fixtures.

**Risk:** the consent-flip on an existing contact is explicitly tested (T7 Step 2), plus idempotency and the `script.js` regression.
