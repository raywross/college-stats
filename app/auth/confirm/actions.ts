"use server";

import { authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { trackSignupIfNew } from "@/lib/signup-events";

/**
 * Finishes a magic-link sign-in (app/auth/confirm): stores the session the link brought back as the site's httpOnly
 * cookies, then checks the token with Supabase (getUser) so a forged or expired token never counts as signed in.
 */
export async function completeSignIn(accessToken: string, refreshToken: string): Promise<{ ok: boolean }> {
  if (!authConfigured() || typeof accessToken !== "string" || typeof refreshToken !== "string") return { ok: false };
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) {
    console.error(`auth/confirm: setSession failed (${error.code ?? error.status}): ${error.message}`);
    return { ok: false };
  }
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    console.error(`auth/confirm: getUser failed after setSession: ${userError?.message ?? "no user"}`);
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false };
  }
  // A first confirmation counts as a sign-up. The link's own next path isn't known here, so has_invite is false.
  await trackSignupIfNew(data.user, "magic_link", "");
  return { ok: true };
}
