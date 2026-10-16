
/**
 * The household's state for a student, for the readers that load a profile straight from the database instead of
 * through lib/student-profile-store.ts (the estimate snapshot, the admin standing view): the student's household
 * (household_members.student_id) → its home (household_homes) → the state in the address (stateOfHome). Null when
 * the student has no household, the household has no home, or the address names no state. Never throws: a failed
 * read leaves the estimate on its high-school fallback.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { stateOfHome } from "./home.ts";

export async function homeStateForStudent(supabase: Pick<SupabaseClient, "from">, studentId: string): Promise<string | null> {
  try {
    const member = await supabase.from("household_members").select("household_id").eq("student_id", studentId).limit(1).maybeSingle();
    const householdId = (member.data as { household_id: string } | null)?.household_id ?? null;
    if (member.error || !householdId) return null;
    const home = await supabase.from("household_homes").select("label, place").eq("household_id", householdId).maybeSingle();
    if (home.error) return null;
    return stateOfHome(home.data as { label: string; place: string } | null);
  } catch {
    return null;
  }
}
