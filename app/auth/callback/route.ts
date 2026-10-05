import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { safeNextPath } from "@/lib/accounts";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "email_change"];

/**
 * Where a magic link lands (specs/product/accounts.md). Two forms:
 * - `?code=…` (Supabase's default email template, PKCE): exchanged for a session with the code verifier cookie the
 *   login action set, so it works in the browser that asked for the link.
 * - `?token_hash=…&type=email` (the custom template in the spec's Setup section): verified directly, so it also
 *   works when the email opens in a different browser or device.
 * Then on to `?next=` (a same-origin path only). Any failure goes back to /login with a friendly message.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/account");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  if (!authConfigured()) return to("/login");

  const failed = () => to(`/login?error=link&next=${encodeURIComponent(next)}`);
  const supabase = await createServerSupabase();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error(`auth/callback: code exchange failed (${error.code ?? error.status}): ${error.message}`);
      return failed();
    }
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error(`auth/callback: verifyOtp failed (${error.code ?? error.status}): ${error.message}`);
      return failed();
    }
  } else {
    // Supabase redirects here with ?error=…&error_code=otp_expired when a link is stale or reused.
    return failed();
  }
  return to(next);
}
