"use server";

import { cookies, headers } from "next/headers";
import { authConfigured } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { supabaseAuthEnv } from "@/lib/supabase-server";
import { AGE_GATE_COOKIE, birthYearAllowed, isRoleHint, parseBirthYear, safeNextPath } from "@/lib/accounts";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  /** No account for this email yet: ask for a birth year (and role) to create one. */
  | { status: "need-birth-year"; email: string }
  /** Under 13: refused, and nothing was stored or sent. */
  | { status: "refused" }
  | { status: "error"; message: string; email?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The client that sends magic links, in Supabase's implicit flow: the link returns the session itself (in the URL
 * fragment, read by /auth/confirm), so it works in whichever browser opens the email. The cookie-bound client
 * (lib/supabase-server.ts) always uses PKCE, whose link only works in the browser that asked for it; on a phone the
 * email app usually opens another one. Switching to PKCE + token_hash needs an edited email template, which Supabase's
 * free plan allows only with custom SMTP (waits for the new domain, specs/backlog.md).
 */
function magicLinkClient() {
  const env = supabaseAuthEnv();
  if (!env) throw new Error("Sign-in isn't configured.");
  return createClient(env.url, env.key, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Sends a magic link (Supabase Auth's signInWithOtp, PKCE). Without a birth year it only signs in an existing account
 * (shouldCreateUser: false); if there's none, it asks for the birth year, refuses under-13s, and then creates the
 * account with the birth year and role hint in the user metadata, which the database's sign-up trigger copies into
 * the profile (and checks again).
 */
export async function requestMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!authConfigured()) return { status: "error", message: "Sign-in isn't available here." };
  const store = await cookies();
  if (store.get(AGE_GATE_COOKIE)?.value === "refused") return { status: "refused" };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: "error", message: "Enter a valid email address.", email };
  const next = safeNextPath(form.get("next"), "/account");

  const birthInput = String(form.get("birth_year") ?? "").trim();
  const signingUp = birthInput !== "";
  let data: Record<string, string> | undefined;
  if (signingUp) {
    const year = parseBirthYear(birthInput);
    if (year === null || year > new Date().getFullYear()) return { status: "error", message: "Enter your birth year as four digits, like 2008.", email };
    if (!birthYearAllowed(year)) {
      store.set(AGE_GATE_COOKIE, "refused", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
      return { status: "refused" };
    }
    const role = form.get("role_hint");
    data = { birth_year: String(year), ...(isRoleHint(role) ? { role_hint: role } : {}) };
  }

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = magicLinkClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: signingUp,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      ...(data ? { data } : {}),
    },
  });
  if (error) {
    if (!signingUp && (error.code === "otp_disabled" || error.code === "user_not_found" || /signups? not allowed/i.test(error.message))) {
      return { status: "need-birth-year", email };
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
      return { status: "error", message: "Too many sign-in emails were sent recently. Wait a few minutes, then try again.", email };
    }
    console.error(`login: signInWithOtp failed (${error.code ?? error.status}): ${error.message}`);
    return { status: "error", message: "We couldn't send the sign-in email. Try again in a moment.", email };
  }
  return { status: "sent", email };
}
