"use server";
/**
 * The household's home (public.household_homes; specs/product/home-and-distance.md). One home per household, set by
 * any active member from the household's card on /account/household and seen by all of them: a student's list and
 * a guardian's view of it measure from the same place. Every read and write runs with the signed-in user's own
 * Supabase session, so the member-only policies in supabase/migrations/20261005170000_household_limits_and_home.sql
 * decide; nobody outside the household reads or writes it.
 *
 * Server Actions, so client components on otherwise-static pages (Explore's "Use my home" button) can call them
 * after the page has rendered, the way lib/student-profile-store.ts's myScores() works for the fit chips.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfigured, getAccount, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { geocodeAddress, suggestAddresses as suggestFromProvider } from "@/lib/geocode";
import { HOUSEHOLD_ERRORS } from "@/lib/household-rules";
import { isSessionToken, shouldSuggest, type SuggestResult } from "@/lib/address-suggest";
import type { HomeLocation } from "@/lib/home";

const COLUMNS = "household_id, lat, lng, label, place, zip, set_by, set_by_name, updated_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * one. The policies refuse a household the caller isn't an active member of.
 */
export async function saveHomeAddress(householdId: string, input: string): Promise<HomeSaveResult> {
  const account = await getAccount().catch(() => null);
  if (!account) return { ok: false, message: "Sign in to save a home address." };
  if (account.profile.deleted_at) return { ok: false, message: HOUSEHOLD_ERRORS.account_deleted };
  if (!UUID_RE.test(householdId)) return { ok: false, message: FAILED };
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
  const row = {
    household_id: householdId,
    ...geo.home,
    set_by: account.user.id,
    set_by_name: account.profile.display_name?.trim().slice(0, 80) || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("household_homes").upsert(row, { onConflict: "household_id" }).select(COLUMNS).single();
  if (error) {
    if (isMissing(error)) return { ok: false, message: NOT_SET_UP };
    if (error.code === "42501") return { ok: false, message: HOUSEHOLD_ERRORS.not_a_member };
    console.error(`home: saving failed: ${error.message}`);
    return { ok: false, message: FAILED };
  }
  return { ok: true, home: data as HomeRow };
}

/**
 * Address suggestions for the home field as the member types (lib/address-suggest.ts). Signed-in members only, so
 * the site's quota isn't open to anyone; the field falls back to plain typing when there's no key.
 */
export async function suggestAddresses(input: string, sessionToken: string): Promise<SuggestResult> {
  const none: SuggestResult = { suggestions: [], provider: null };
  if (typeof input !== "string" || !shouldSuggest(input) || !isSessionToken(sessionToken)) return none;
  if (!authConfigured()) return none;
  const user = await getUser();
  if (!user) return none;
  return suggestFromProvider(input, sessionToken);
}

/** Removes the household's home (any member may). */
export async function clearHome(householdId: string): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user || !UUID_RE.test(householdId)) return { ok: false };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("household_homes").delete().eq("household_id", householdId);
  if (error) {
    console.error(`home: removing failed: ${error.message}`);
    return { ok: false };
  }
  return { ok: true };
}
