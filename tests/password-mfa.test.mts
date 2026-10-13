/**
 * Changing the password on an account with an authenticator app (admins): Supabase only allows it from a session that
 * passed the second factor (aal2), and a reset link's session is aal1. The page asks for the 6-digit code and the
 * action verifies it before saving (app/account/password; specs/product/accounts.md "Passwords"). Checked against dev
 * on 2026-10-13: without the code updateUser answers insufficient_aal; after challengeAndVerify it saves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("the action verifies the code before saving when the session hasn't passed the authenticator", () => {
  const src = read("app/account/password/actions.ts");
  assert.match(src, /data\.nextLevel === "aal2" && data\.currentLevel !== "aal2"/);
  const check = src.indexOf("if (await needsSecondFactor(supabase))");
  const verify = src.indexOf("challengeAndVerify({ factorId: factor.id, code })");
  const save = src.indexOf("supabase.auth.updateUser({ password })");
  assert.ok(check > 0 && verify > check && save > verify, "check, verify, then save");
  assert.match(src, /error\.code === "insufficient_aal"\) return \{ status: "error", message: CODE_NEEDED, needsCode: true \}/, "a refusal asks for the code, not 'try again'");
});

test("the page asks for the code up front, and the form shows the field when the action asks", () => {
  assert.match(read("app/account/password/page.tsx"), /const askCode = await needsSecondFactor\(/);
  const form = read("app/account/password/SetPasswordForm.tsx");
  assert.match(form, /const showCode = askCode \|\| \(state\.status === "error" && state\.needsCode === true\)/);
  assert.match(form, /name="code"[\s\S]*autoComplete="one-time-code"/);
});
