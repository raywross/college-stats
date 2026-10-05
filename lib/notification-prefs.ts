"use server";
/**
 * Whether the signed-in user gets update-digest emails (specs/product/follow-colleges.md#the-digest). The switch on
 * /me/following and the one the digest's own unsubscribe link flips (app/unsubscribe/[token]/route.ts, by token, no
 * sign-in). Every follower has a notification_prefs row from their first follow (the follows_ensure_prefs trigger);
 * upsert so toggling still works for the rare case it's missing (e.g. a row deleted out of band).
 */
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";

/** True (the default) when signed out, unconfigured, or before the user's first follow creates a row. */
export async function getEmailUpdates(): Promise<boolean> {
  if (!authConfigured()) return true;
  const user = await getUser();
  if (!user) return true;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("notification_prefs").select("email_updates").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(`notification_prefs: reading failed: ${error.message}`);
    return true;
  }
  return (data?.email_updates as boolean | undefined) ?? true;
}

/** For displaying the unsubscribe link on /me/updates. Null when signed out, unconfigured, or no row yet. */
export async function getUnsubscribeToken(): Promise<string | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("notification_prefs").select("unsubscribe_token").eq("user_id", user.id).maybeSingle();
  if (error) {
    console.error(`notification_prefs: reading the unsubscribe token failed: ${error.message}`);
    return null;
  }
  return (data?.unsubscribe_token as string | undefined) ?? null;
}

export async function setEmailUpdates(enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!authConfigured()) return { ok: false, message: "Sign-in isn't available here." };
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in to change this." };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, email_updates: enabled, updated: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error(`notification_prefs: updating failed: ${error.message}`);
    return { ok: false, message: "We couldn't save that. Try again in a moment." };
  }
  return { ok: true };
}
