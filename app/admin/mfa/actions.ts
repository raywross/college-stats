"use server";

import { adminState } from "@/lib/admin/auth";
import { formId, parseTotpCode } from "@/lib/admin/console";
import { SITE_NAME } from "@/lib/brand";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * The admin console's second factor (specs/product/admin.md "Who is an admin"), TOTP through Supabase Auth's MFA.
 * These run on the server because the browser never talks to Supabase on this site (the session cookies are httpOnly
 * and there is no public key); a Server Action may write cookies, so the session that comes back from `verify` is
 * the aal2 one. The step is for an admin at aal1 only: anyone else is refused, so these can't be used to add a
 * factor to someone else's session or to an admin who already has one.
 */

export type MfaState =
  | { status: "idle" }
  | { status: "enrolled"; factorId: string; qr: string; secret: string }
  | { status: "verified" }
  | { status: "error"; message: string };

const NOT_YOU: MfaState = { status: "error", message: "This step is for an admin signing in. Reload the page." };
const FAILED: MfaState = { status: "error", message: "That didn't work. Try again in a moment." };
const BAD_CODE: MfaState = { status: "error", message: "That code didn't work. Check the 6 digits in your authenticator app and try again." };

/** Start enrolling: a fresh TOTP factor, its QR code and its secret (for typing in by hand). Only before any factor is verified. */
export async function startEnrollment(): Promise<MfaState> {
  const state = await adminState();
  if (state.kind !== "needs-mfa" || state.enrolled) return NOT_YOU;
  const supabase = await createServerSupabase();

  // A half-finished earlier attempt leaves an unverified factor, and a second enroll with the same name is refused.
  const existing = await supabase.auth.mfa.listFactors();
  if (existing.error) return FAILED;
  for (const factor of existing.data.all) {
    if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `${SITE_NAME} console` });
  if (error || !data) {
    console.error(`admin: mfa enroll failed: ${error?.message ?? "no data"}`);
    return FAILED;
  }
  return { status: "enrolled", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Check a six-digit code: challenge and verify in one step. Enrolling confirms the factor just made (`factor` names
 * it); an enrolled admin leaves `factor` out and the verified factor is used. The factor must be one of this
 * session's own.
 */
export async function verifyCode(_prev: MfaState, form: FormData): Promise<MfaState> {
  const state = await adminState();
  if (state.kind !== "needs-mfa") return NOT_YOU;
  const code = parseTotpCode(form.get("code"));
  if (!code) return { status: "error", message: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createServerSupabase();

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) return FAILED;
  const totp = factors.data.all.filter((f) => f.factor_type === "totp");
  const asked = formId(form, "factor");
  const factor = asked ? totp.find((f) => f.id === asked) : totp.find((f) => f.status === "verified");
  if (!factor) return NOT_YOU;
  // An enrolled admin verifies the factor they have; only a first-time admin confirms a new one.
  if (state.enrolled && factor.status !== "verified") return NOT_YOU;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    // A wrong or expired code is the ordinary case; log nothing about it.
    if (!/invalid|expired|code/i.test(error.message)) console.error(`admin: mfa verify failed: ${error.message}`);
    return BAD_CODE;
  }
  return { status: "verified" };
}
