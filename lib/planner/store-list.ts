"use server";
/**
 * Stage 1's own Server Actions (specs/planner/list-building.md "Sorting", "The Dream", "Finding colleges to add"):
 * the per-list sort, accepting every open suggestion at once, and a view-only guardian's suggestion. Copies
 * lib/planner/store.ts's `ready(capability)` pattern: sign in, the entitlement check, then the write with the
 * caller's own session so row-level security decides. `setSort` and `acceptAllSuggestions` never change which
 * tasks exist (the generators read round and status, not category or sort), so neither calls `regenerate`.
 */
import { revalidatePath } from "next/cache";
import { authConfigured, getUser } from "@/lib/auth";
import { allowed, NOT_ALLOWED_MESSAGE, type Capability } from "@/lib/entitlements";
import { createServerSupabase } from "@/lib/supabase-server";
import { getData } from "@/lib/data";
import { isUnitId } from "@/lib/follow-state";
import { profileFor } from "@/lib/student-profile-store";
import type { StudentProfileData } from "@/lib/student-profile";
import { planSchoolFor, todayIso } from "./context";
import { currentCycle, cycleStartOf } from "./cycle";
import { suggestCategory } from "./suggest";
import type { ListSort, PlanItem } from "./types";

export type PlanListActionResult = { ok: true } | { ok: false; message: string };

const FAILED = "That didn't work. Try again in a moment.";
const SIGN_IN = "Sign in first.";
const SORTS: readonly ListSort[] = ["mine", "category", "dream_priority", "next_date", "admit_rate", "avg_cost", "distance", "standing"];
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Ready = { userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

async function ready(capability: Capability): Promise<Ready | { ok: false; message: string }> {
  if (!authConfigured()) return { ok: false, message: SIGN_IN };
  const user = await getUser();
  if (!user) return { ok: false, message: SIGN_IN };
  if (!(await allowed(user, capability))) return { ok: false, message: NOT_ALLOWED_MESSAGE };
  return { userId: user.id, supabase: await createServerSupabase() };
}

function fail(error: { message?: string } | null | undefined, what: string): PlanListActionResult {
  if (error) console.error(`planner/list: ${what} failed: ${error.message}`);
  return { ok: false, message: FAILED };
}

function refresh() {
  revalidatePath("/household", "layout");
}

/** The list's remembered sort (list-building.md "Sorting"); only someone who can edit the list may change it — it's shared, not per-viewer. */
export async function setSort(listId: string, sort: ListSort | null): Promise<PlanListActionResult> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  if (sort !== null && !SORTS.includes(sort)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { data, error } = await r.supabase.from("lists").update({ sort }).eq("id", listId).select("id");
  if (error) return fail(error, "setSort");
  if (!data?.length) return { ok: false, message: "Only someone who can edit this list can change its sort." };
  refresh();
  return { ok: true };
}

/**
 * Fills every `unsorted` row with its suggested category at once (list-building.md "Suggested category": "Accept
 * all suggestions fills every unsorted row at once and leaves categorized rows alone"). A row with no suggestion
 * ("Add a score or GPA to see a suggestion") is left unsorted; the Dream, if any, keeps its star either way.
 */
export async function acceptAllSuggestions(listId: string): Promise<PlanListActionResult & { changed?: number }> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const [list, items] = await Promise.all([
    r.supabase.from("lists").select("student_id").eq("id", listId).maybeSingle(),
    r.supabase.from("list_items").select("id, unit_id, category").eq("list_id", listId).eq("category", "unsorted"),
  ]);
  if (list.error) return fail(list.error, "acceptAllSuggestions");
  if (items.error) return fail(items.error, "acceptAllSuggestions");
  const rows = (items.data ?? []) as Pick<PlanItem, "id" | "unit_id" | "category">[];
  if (rows.length === 0) return { ok: true, changed: 0 };

  const studentId = (list.data as { student_id: string | null } | null)?.student_id ?? null;
  const start = cycleStartOf(currentCycle(todayIso()))!;
  let profile: StudentProfileData | null = null;
  if (studentId) {
    const p = await profileFor(studentId);
    profile = p?.data ?? null;
  }
  const { getSchoolById, citeField } = await getData();

  let changed = 0;
  for (const row of rows) {
    const school = getSchoolById(row.unit_id);
    if (!school) continue;
    const planSchool = planSchoolFor(school, citeField, { studentCycleStart: start, home: null });
    const { category } = suggestCategory(planSchool, profile);
    if (category === "none") continue;
    const { error } = await r.supabase.from("list_items").update({ category }).eq("id", row.id);
    if (!error) changed++;
  }
  if (changed > 0) refresh();
  return { ok: true, changed };
}

/**
 * A view-only guardian's suggestion (list-building.md "Finding colleges to add"): adds the college unsorted with a
 * note "Suggested by {name}", through `suggest_college()` (supabase/migrations/20261008130000_planner_list.sql),
 * which checks can_read_list — not can_edit_list — since this is exactly the action a reader without edit access
 * may take. Anyone who can already edit the list should use `addToList` (lib/lists.ts) instead; calling this adds
 * the same row, just unsorted with the note, so it still works but duplicates the chip for a canEdit guardian.
 */
export async function suggestCollege(listId: string, unitId: string): Promise<PlanListActionResult> {
  if (!isUuid(listId)) return { ok: false, message: FAILED };
  if (!isUnitId(unitId)) return { ok: false, message: "We couldn't find that college." };
  const r = await ready("planner.tab");
  if (!("supabase" in r)) return r;
  const { error } = await r.supabase.rpc("suggest_college", { p_list: listId, p_unit_id: unitId });
  if (error) {
    if (error.message?.includes("already_on_list")) return { ok: false, message: "Already on this list." };
    if (error.message?.includes("not_allowed") || error.message?.includes("not_signed_in")) return { ok: false, message: "Only someone who can see this list can suggest a college for it." };
    return fail(error, "suggestCollege");
  }
  refresh();
  return { ok: true };
}
