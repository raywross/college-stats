/**
 * The store's tick of the essays move (specs/product/essays/moves.md "Done"): after a draft's status, link, or delete
 * changes, read the student's plan list, their drafts, and the move's row, and tick `{list}:essays:next` once every
 * essay is ready (`allReady`: nothing left, and no college still waiting for its prompts; the worked example's Nov 3
 * row stays open). A regeneration never unticks (mergeTasks never touches `done_at`), and a done or missing move is
 * left alone. The student's default list is the plan's list (the brief).
 *
 * Takes the caller's Supabase client (the student's own session, so row-level security decides) and the college
 * slices as a dependency, so tests run it against a fake client (tests/planner-essays-move.test.mts). No server-only
 * imports; lib/essays/store.ts wires the real `planSchools`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readItems, readPlanEssays } from "../planner/read-plan.ts";
import { taskKey } from "../planner/tasks.ts";
import type { PlanSchool } from "../planner/types.ts";
import { allReady, essayProgress } from "./progress.ts";

export interface EssaysTickDeps {
  /** The colleges as the plan reads them (lib/planner/context.ts planSchools, in the student's cycle). */
  schools: (unitIds: string[]) => Promise<Record<string, PlanSchool>>;
  /** The tick's timestamp (ISO). */
  now?: () => string;
}

export type EssaysTickResult =
  | { ticked: true; remaining: 0 }
  | { ticked: false; reason: "no-list" | "no-move" | "already-done" | "work-left" | "failed"; remaining: number | null };

/** The student's plan list: the default one, else the first made. */
async function planListId(supabase: SupabaseClient, studentId: string): Promise<string | null> {
  const { data, error } = await supabase.from("lists").select("id, is_default, created").eq("student_id", studentId).order("created");
  if (error || !data) return null;
  const rows = data as { id: string; is_default: boolean }[];
  return (rows.find((l) => l.is_default) ?? rows[0])?.id ?? null;
}

export async function tickEssaysMove(supabase: SupabaseClient, studentId: string, deps: EssaysTickDeps): Promise<EssaysTickResult> {
  const listId = await planListId(supabase, studentId);
  if (!listId) return { ticked: false, reason: "no-list", remaining: null };
  const key = taskKey(listId, "essays", "next");
  const [items, essays, task] = await Promise.all([
    readItems(supabase, listId),
    readPlanEssays(supabase, studentId),
    supabase.from("plan_tasks").select("id, done_at").eq("list_id", listId).eq("key", key).maybeSingle(),
  ]);
  if (items.error || task.error) return { ticked: false, reason: "failed", remaining: null };
  const row = task.data as { id: string; done_at: string | null } | null;
  if (!row) return { ticked: false, reason: "no-move", remaining: null };
  if (row.done_at) return { ticked: false, reason: "already-done", remaining: null };
  const list = items.data ?? [];
  const schools = await deps.schools([...new Set(list.map((i) => i.unit_id))]);
  const progress = essayProgress({ items: list, schools, essays });
  if (!allReady(progress)) return { ticked: false, reason: "work-left", remaining: progress.remaining };
  const now = deps.now?.() ?? new Date().toISOString();
  const { data, error } = await supabase.from("plan_tasks").update({ done_at: now }).eq("id", row.id).is("done_at", null).select("id");
  if (error || !data?.length) return { ticked: false, reason: "failed", remaining: 0 };
  return { ticked: true, remaining: 0 };
}
