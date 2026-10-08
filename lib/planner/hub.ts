import "server-only";
/**
 * The people strip's caption for a student in season (specs/planner/model.md "Where it lives": "the people strip's
 * caption for a student in season becomes the stage", e.g. "Applying · 3 of 8 in"). One query for every student the
 * hub shows: their default lists with the items and tasks the stage machine reads, embedded. Students without a list
 * (or with an empty one), and students out of season (before junior year, or in college), keep the plain caption.
 * Fails soft: any error means no captions, never a broken hub. U8 extends the caption with the summary line. The
 * embeds name their foreign keys: plan_tasks points at both lists and list_items, so PostgREST could otherwise read
 * it as a junction between them and call list_items ambiguous.
 */
import { createServerSupabase } from "@/lib/supabase-server";
import { gradeOf, inSeason } from "./cycle";
import { stageCaption, stageOf } from "./stage";
import { todayIso } from "./context";
import type { PlanItem, PlanTask } from "./types";

type Row = {
  student_id: string;
  list_items: Pick<PlanItem, "id" | "category" | "status" | "outcome" | "round" | "enrolling" | "visited_on">[];
  plan_tasks: Pick<PlanTask, "item_id" | "kind" | "due_on" | "window_start" | "window_end" | "done_at" | "dismissed" | "snoozed_until">[];
};

/** Captions by student id, for the students given (id → grad year, from the roster). */
export async function stageCaptions(students: { id: string; gradYear: number | null }[]): Promise<Record<string, string>> {
  const today = todayIso();
  const wanted = students.filter((s) => s.gradYear === null || inSeason(gradeOf(s.gradYear, today)));
  if (wanted.length === 0) return {};
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("lists")
      .select(
        "student_id, list_items!list_items_list_id_fkey(id, category, status, outcome, round, enrolling, visited_on), plan_tasks!plan_tasks_list_id_fkey(item_id, kind, due_on, window_start, window_end, done_at, dismissed, snoozed_until)",
      )
      .in(
        "student_id",
        wanted.map((s) => s.id),
      )
      .eq("is_default", true);
    if (error) {
      console.error(`planner: hub captions unavailable: ${error.message}`);
      return {};
    }
    const out: Record<string, string> = {};
    for (const row of (data ?? []) as Row[]) {
      if (!row.list_items?.length) continue;
      const { current, stages } = stageOf({ items: row.list_items, tasks: row.plan_tasks ?? [], today });
      out[row.student_id] = stageCaption(current, stages);
    }
    return out;
  } catch (err) {
    console.error(`planner: hub captions unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
