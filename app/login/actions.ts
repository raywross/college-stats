"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase, supabaseAuthEnv } from "@/lib/supabase-server";
import { passwordProblems } from "@/lib/password";
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

/* ------------------------------------------------------------------ */
/* Passwords (the default since 2026-10-05; the magic link stays as an */
/* option)                                                             */
/* ------------------------------------------------------------------ */

export type PasswordState =
  | { status: "idle" }
  /** Account created; Supabase wants the email confirmed before the first sign-in. */
  | { status: "confirm-email"; email: string }
  /** A password-reset or confirmation email went out. */
  | { status: "email-sent"; email: string; kind: "reset" | "confirm" }
  /** Sign-in refused because the email isn't confirmed yet: offer to send the confirmation again. */
  | { status: "unconfirmed"; email: string }
  | { status: "refused" }
  | { status: "error"; message: string; email?: string };

async function originOf(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

const rateLimited = (e: { status?: number; code?: string; message: string }) =>
  e.status === 429 || /rate.?limit/i.test(`${e.code} ${e.message}`);
const RATE_LIMITED = "Too many emails were sent recently. Wait a few minutes, then try again.";

/** Email and password. Success sets the session cookies and goes on to ?next=. */
export async function signInWithPassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  if (!authConfigured()) return { status: "error", message: "Sign-in isn't available here." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(form.get("next"), "/account");
  if (!EMAIL_RE.test(email) || !password) return { status: "error", message: "Enter your email and password.", email };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { status: "unconfirmed", email };
    if (rateLimited(error)) return { status: "error", message: "Too many tries. Wait a few minutes, then try again.", email };
    if (error.code !== "invalid_credentials") console.error(`login: signInWithPassword failed (${error.code ?? error.status}): ${error.message}`);
    return {
      status: "error",
      message: "That email and password don't match. If you signed up with an emailed link, use “Forgot password” to set one.",
      email,
    };
  }
  redirect(next);
}

/**
 * Creates an account with a password (checked against lib/password.ts here as well as in the form), the birth year
 * and role going into user metadata for the sign-up trigger as with magic links. Sent with the implicit-flow client,
 * so the confirmation email's link works in any browser and lands on /auth/confirm.
 */
export async function signUpWithPassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  if (!authConfigured()) return { status: "error", message: "Sign-in isn't available here." };
  const store = await cookies();
  if (store.get(AGE_GATE_COOKIE)?.value === "refused") return { status: "refused" };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(form.get("next"), "/account");
  if (!EMAIL_RE.test(email) || email.length > 254) return { status: "error", message: "Enter a valid email address.", email };
  const problems = passwordProblems(password, email);
  if (problems.length) return { status: "error", message: problems.join(" "), email };
  const year = parseBirthYear(String(form.get("birth_year") ?? ""));
  if (year === null || year > new Date().getFullYear()) return { status: "error", message: "Enter your birth year as four digits, like 2008.", email };
  if (!birthYearAllowed(year)) {
    store.set(AGE_GATE_COOKIE, "refused", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
    return { status: "refused" };
  }
  const role = form.get("role_hint");

  const { data, error } = await magicLinkClient().auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await originOf()}/auth/confirm?next=${encodeURIComponent(next)}`,
      data: { birth_year: String(year), ...(isRoleHint(role) ? { role_hint: role } : {}) },
    },
  });
  if (error) {
    if (rateLimited(error)) return { status: "error", message: RATE_LIMITED, email };
    if (error.code === "user_already_exists" || error.code === "email_exists") return alreadyExists(email);
    if (error.code === "weak_password") return { status: "error", message: error.message, email };
    console.error(`login: signUp failed (${error.code ?? error.status}): ${error.message}`);
    return { status: "error", message: "We couldn't create the account. Try again in a moment.", email };
  }
  // With email confirmation on, an address that already has an account comes back as a user with no identities.
  if (data.user && (data.user.identities?.length ?? 0) === 0) return alreadyExists(email);
  if (data.session) {
    // Email confirmation is off on this project: sign straight in.
    const supabase = await createServerSupabase();
    await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    redirect(next);
  }
  return { status: "confirm-email", email };
}

function alreadyExists(email: string): PasswordState {
  return { status: "error", message: "There's already an account for this email. Sign in instead, or use “Forgot password”.", email };
}

/** "Forgot password": emails a link that signs in and opens /account/password to choose a new one. */
export async function requestPasswordReset(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  if (!authConfigured()) return { status: "error", message: "Sign-in isn't available here." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: "error", message: "Enter a valid email address.", email };
  const { error } = await magicLinkClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${await originOf()}/auth/confirm?next=${encodeURIComponent("/account/password")}`,
  });
  if (error) {
    if (rateLimited(error)) return { status: "error", message: RATE_LIMITED, email };
    console.error(`login: resetPasswordForEmail failed (${error.code ?? error.status}): ${error.message}`);
    return { status: "error", message: "We couldn't send the email. Try again in a moment.", email };
  }
  // The same answer whether or not the address has an account.
  return { status: "email-sent", email, kind: "reset" };
}

/** Sends the sign-up confirmation email again. */
export async function resendConfirmation(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  if (!authConfigured()) return { status: "error", message: "Sign-in isn't available here." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNextPath(form.get("next"), "/account");
  if (!EMAIL_RE.test(email)) return { status: "error", message: "Enter a valid email address.", email };
  const { error } = await magicLinkClient().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await originOf()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    if (rateLimited(error)) return { status: "error", message: RATE_LIMITED, email };
    console.error(`login: resend failed (${error.code ?? error.status}): ${error.message}`);
    return { status: "error", message: "We couldn't send the email. Try again in a moment.", email };
  }
  return { status: "email-sent", email, kind: "confirm" };
}
