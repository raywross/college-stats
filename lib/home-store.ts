"use server";
/**
 * The signed-in user's home (public.home_locations; specs/product/home-and-distance.md). Every read and write runs
 * with the user's own Supabase session, so the own-row policies in
 * supabase/migrations/20261005160000_home_locations.sql decide: nobody reads anyone else's home, household or not.
 *
 * Server Actions, so client components on otherwise-static pages (Explore's "Use my home" button) can call them
 * after the page has rendered, the way lib/student-profile-store.ts's myScores() works for the fit chips.
 */
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { geocodeAddress } from "@/lib/geocode";
import type { HomeLocation } from "@/lib/home";

const COLUMNS = "lat, lng, label, place, zip, updated_at";

export interface HomeRow extends HomeLocation {
  updated_at: string;
}

export type HomeSaveResult = { ok: true; home: HomeRow } | { ok: false; message: string };

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** The signed-in user's own home, or null: signed out, none saved, or the migration isn't applied yet. */
export async function myHome(): Promise<HomeRow | null> {
  if (!authConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("home_locations").select(COLUMNS).eq("user_id", user.id).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error(`home: reading failed: ${error.message}`);
    return null;
  }
  return (data as HomeRow | null) ?? null;
}

/** Geocodes the typed address (or ZIP code) and saves the match as the user's home, replacing any previous one. */
export async function saveHomeAddress(input: string): Promise<HomeSaveResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in to save a home address." };
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
  const row = { user_id: user.id, ...geo.home, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("home_locations").upsert(row, { onConflict: "user_id" }).select(COLUMNS).single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, message: "Home addresses aren't set up on this site yet." };
    console.error(`home: saving failed: ${error.message}`);
    return { ok: false, message: "We couldn't save that. Try again in a moment." };
  }
  return { ok: true, home: data as HomeRow };
}

/** Removes the user's home. */
export async function clearHome(): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("home_locations").delete().eq("user_id", user.id);
  if (error) {
    console.error(`home: removing failed: ${error.message}`);
    return { ok: false };
  }
  return { ok: true };
}
