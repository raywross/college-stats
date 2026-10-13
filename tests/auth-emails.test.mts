/**
 * Supabase Auth's emails in Quad's look (lib/emails/auth-templates.ts, scripts/auth-emails.mts, specs/auth-emails.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_EMAIL_NAMES, authEmailConfigPatch, renderAuthEmail } from "../lib/emails/auth-templates.ts";

const ROOT = join(import.meta.dirname, "..");

test("every link email sends people to Supabase's confirmation URL, the code email shows the code", () => {
  for (const name of AUTH_EMAIL_NAMES) {
    const { html, subject } = renderAuthEmail(name);
    assert.ok(subject.length > 0 && subject.length <= 80, name);
    if (name.endsWith("_notification")) {
      assert.doesNotMatch(html, /ConfirmationURL/, `${name}: a notice has nothing to confirm`);
      assert.match(html, /\{\{ \.Email \}\}/, name);
    } else if (name === "reauthentication") {
      assert.match(html, /\{\{ \.Token \}\}/, name);
      assert.doesNotMatch(html, /ConfirmationURL/, name);
    } else {
      // The button and the paste-this-link fallback.
      assert.equal(html.match(/\{\{ \.ConfirmationURL \}\}/g)?.length, 3, name);
      assert.match(html, /\{\{ \.Email \}\}/, `${name} names the address it is for`);
    }
    assert.doesNotMatch(html, /\$\{|undefined|null/, `${name}: a template literal leaked`);
    assert.match(html, /Quad/);
  }
  assert.match(renderAuthEmail("email_change").html, /\{\{ \.NewEmail \}\}/);
  assert.match(renderAuthEmail("email_changed_notification").html, /\{\{ \.OldEmail \}\}/);
});

test("Supabase's template syntax is only the variables it fills in", () => {
  const allowed = new Set(["{{ .ConfirmationURL }}", "{{ .Email }}", "{{ .NewEmail }}", "{{ .OldEmail }}", "{{ .Token }}"]);
  for (const name of AUTH_EMAIL_NAMES) {
    const { html, subject } = renderAuthEmail(name);
    for (const m of `${subject}${html}`.matchAll(/\{\{[^}]*\}\}/g)) assert.ok(allowed.has(m[0]), `${name}: ${m[0]}`);
  }
});

test("the push sends each template's subject and content and turns on the two notices, and no other Auth setting", () => {
  const patch = authEmailConfigPatch();
  assert.equal(Object.keys(patch).length, AUTH_EMAIL_NAMES.length * 2 + 2);
  assert.ok(Object.keys(patch).every((k) => /^mailer_subjects_[a-z_]+$|^mailer_templates_[a-z_]+_content$|^mailer_notifications_(password|email)_changed_enabled$/.test(k)));
  assert.equal(patch.mailer_notifications_password_changed_enabled, true);
  assert.equal(patch.mailer_notifications_email_changed_enabled, true);
});

test("the committed files in supabase/templates/ match the source", () => {
  for (const name of AUTH_EMAIL_NAMES) {
    assert.equal(readFileSync(join(ROOT, "supabase", "templates", `${name}.html`), "utf8"), renderAuthEmail(name).html, `${name}: run npm run auth-emails`);
  }
});
