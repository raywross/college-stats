"use server";
/**
 * The signed-in user's follows (specs/product/follow-colleges.md), read with their own Supabase session so the
 * follows policies decide: a user only ever sees their own rows. Nobody writes follows from the app any more: since
 * 20261006150000_household_hub.sql the database keeps them in step with list_items.updates (the per-college Updates
 * switch on a list, specs/product/household-hub.md "One list per person"), and signed-in users can't insert, update,
 * or delete them. Types and pure rules live in lib/follow-state.ts.
 */
import { getUser, authConfigured } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import type { FollowRow } from "@/lib/follow-state";

/** The signed-in user's follows, newest first; empty when signed out, unconfigured, or before the migration. */
export async function myFollows(): Promise<FollowRow[]> {
  if (!authConfigured()) return [];
  const user = await getUser();
  if (!user) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("follows").select("unit_id, source, created").eq("user_id", user.id).order("created", { ascending: false });
  if (error) {
    console.error(`follows: listing failed: ${error.message}`);
    return [];
  }
  return data as FollowRow[];
}
