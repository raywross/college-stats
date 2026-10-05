"use server";

import { refresh } from "next/cache";
import { getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { birthYearAllowed, isRoleHint, parseBirthYear } from "@/lib/accounts";

export type ProfileFormState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/** Saves name, birth year, and role hint on the signed-in user's own profile (RLS allows only their own row). */
export async function updateProfile(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const user = await getUser();
  if (!user) return { status: "error", message: "Your session ended. Sign in again to save." };

  const name = String(form.get("display_name") ?? "").trim();
  if (name.length > 80) return { status: "error", message: "Keep your name under 80 characters." };
  const yearInput = String(form.get("birth_year") ?? "").trim();
  const year = parseBirthYear(yearInput);
  if (yearInput && (year === null || year > new Date().getFullYear())) return { status: "error", message: "Enter your birth year as four digits, like 2008." };
  if (year !== null && !birthYearAllowed(year)) return { status: "error", message: "Accounts are for people 13 and older." };
  const role = form.get("role_hint");

  const supabase = await createServerSupabase();
  const update: Record<string, unknown> = { display_name: name || null, role_hint: isRoleHint(role) ? role : null };
  // A birth year, once given, can be corrected but not removed.
  if (year !== null) update.birth_year = year;
  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) {
    if (/birth_year_not_allowed/.test(error.message)) return { status: "error", message: "Accounts are for people 13 and older." };
    console.error(`account: profile update failed: ${error.message}`);
    return { status: "error", message: "We couldn't save that. Try again in a moment." };
  }
  refresh();
  return { status: "saved" };
}
