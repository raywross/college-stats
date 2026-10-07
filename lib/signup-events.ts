import "server-only";
import type { User } from "@supabase/supabase-js";
import { trackServer } from "@/lib/analytics-server";
import { isRoleHint } from "@/lib/accounts";
import { isFreshConfirmation } from "@/lib/signup-events-rules";

/**
 * Sends `signup_completed` once for a brand-new account, from the places a confirmation link lands (the auth callback
 * and `completeSignIn`). Only when the email was confirmed in the last two minutes (lib/signup-events-rules.ts), so an
 * ordinary sign-in sends nothing. Carries the role hint and whether the sign-up came through an invitation, with the
 * opaque account id as the distinct id; never the email, birth year, or `next` itself. Never throws.
 */
export async function trackSignupIfNew(user: User, method: "magic_link" | "password", next: string): Promise<void> {
  try {
    if (!isFreshConfirmation(user)) return;
    const hint = user.user_metadata?.role_hint;
    await trackServer(
      "signup_completed",
      { method, role_hint: isRoleHint(hint) ? hint : "none", has_invite: next.startsWith("/invite") },
      user.id,
    );
  } catch (error) {
    console.error("signup-events: signup_completed failed", error);
  }
}
