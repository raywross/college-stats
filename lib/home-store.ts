"use server";
/**
 * The household's home (public.household_homes; specs/product/home-and-distance.md). One home per household, set by
 * any active member and seen by all of them: a student's list and a guardian's view of it measure from the same
 * place. Every read and write runs with the signed-in user's own Supabase session, so the member-only policies in
 * supabase/migrations/20261005160000_household_limits_and_home.sql decide; nobody outside the household reads it.
 *
 * Someone with no household yet who saves a home gets a one-person household made for them here (the word never
 * appears until someone else joins); accepting an invitation later dissolves it and carries the home along.
 *
 * Server Actions, so client components on otherwise-static pages (Explore's "Use my home" button) can call them
 * after the page has rendered, the way lib/student-profile-store.ts's myScores() works for the fit chips.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfigured, currentStudent, getAccount, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { geocodeAddress } from "@/lib/geocode";
import { HOUSEHOLD_ERRORS, errorMessage } from "@/lib/household-rules";
import type { HomeLocation } from "@/lib/home";

const COLUMNS = "household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at";

export interface HomeRow extends HomeLocation {
  household_id: string;
  /** Who set it, and their name at the time ("Set by Mom"). */
  set_by: string | null;
  set_by_name: string | null;
  updated_at: string;
}

export type HomeSaveResult = { ok: true; home: HomeRow } | { ok: false; message: string };

const FAILED = "We couldn't save that. Try again in a moment.";
const NOT_SET_UP = "Home addresses aren't set up on this site yet.";

/** The table or function isn't there: the migration hasn't been applied. */
function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "42883" || error.code === "PGRST205" || error.code === "PGRST202" || /does not exist|schema cache|could not find the function/i.test(error.message ?? "");
}

/** The signed-in user's household id (public.my_household()), or null: none yet, or the migration isn't applied. */
async function myHouseholdId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_household");
  if (error) {
    if (!isMissing(error)) console.error(`home: my_household failed: ${error.message}`);
    return null;
  }
  return (data as string | null) ?? null;
}

/** The home of the signed-in user's household, or null: signed out, no household or no home yet, or not set up. */
export async function myHome(): Promise<HomeRow | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const household = await myHouseholdId(supabase);
  if (!household) return null;
  const { data, error } = await supabase.from("household_homes").select(COLUMNS).eq("household_id", household).maybeSingle();
  if (error) {
    if (!isMissing(error)) console.error(`home: reading failed: ${error.message}`);
    return null;
  }
  return (data as HomeRow | null) ?? null;
}

/**
 * Geocodes the typed address (or ZIP code) and saves the match as the household's home, replacing any previous
 * one. A user with no household gets a one-person household first.
 */
export async function saveHomeAddress(input: string): Promise<HomeSaveResult> {
  const account = await getAccount().catch(() => null);
  if (!account) return { ok: false, message: "Sign in to save a home address." };
  if (account.profile.deleted_at) return { ok: false, message: HOUSEHOLD_ERRORS.account_deleted };
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, message: "Enter a street address, or just a ZIP code." };
  if (text.length > 200) return { ok: false, message: "Keep the address under 200 characters." };

  const geo = await geocodeAddress(text);
  if (!geo.ok) {
    return {
      ok: false,
      message:
        geo.reason === "unavailable"
          ? "The address lookup isn't answering right now. Try again in a moment, or enter just your ZIP code."
          : "We couldn't find that address. Check the street, city, and state, or enter just your ZIP code.",
    };
  }

  const supabase = await createServerSupabase();
  let household = await myHouseholdId(supabase);
  if (!household) {
    // Alone so far: a household of one, named after them, as a student when they have a student record.
    const student = await currentStudent();
    const name = account.profile.display_name?.trim();
    const created = await supabase.rpc("create_household", {
      p_name: (name ? `${name}'s household` : "My household").slice(0, 80),
      p_role: student ? "student" : "guardian",
    });
    if (created.error) {
      if (isMissing(created.error)) return { ok: false, message: NOT_SET_UP };
      console.error(`home: create_household failed: ${created.error.message}`);
      return { ok: false, message: errorMessage(created.error, HOUSEHOLD_ERRORS, FAILED) };
    }
    household = created.data as string;
  }

  const row = {
    household_id: household,
    ...geo.home,
    set_by: account.user.id,
    set_by_name: account.profile.display_name?.trim().slice(0, 80) || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("household_homes").upsert(row, { onConflict: "household_id" }).select(COLUMNS).single();
  if (error) {
    if (isMissing(error)) return { ok: false, message: NOT_SET_UP };
    console.error(`home: saving failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  return { ok: true, home: data as HomeRow };
}

/** Removes the household's home (any member may). */
export async function clearHome(): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };
  const supabase = await createServerSupabase();
  const household = await myHouseholdId(supabase);
  if (!household) return { ok: true };
  const { error } = await supabase.from("household_homes").delete().eq("household_id", household);
  if (error) {
    console.error(`home: removing failed: ${error.message}`);
    return { ok: false };
  }
  return { ok: true };
}
