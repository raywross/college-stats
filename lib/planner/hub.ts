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
import { getData } from "@/lib/data";
import { gradeOf, inSeason } from "./cycle";
import { stageCaption, stageOf } from "./stage";
import { summaryLine } from "./summary";
import { todayIso } from "./context";
import type { PlanItem, PlanTask, PlanVisit } from "./types";

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

/* ------------------------------------------------------------------ */
/* U8 (specs/planner/parents.md "The summary line")                    */
/* ------------------------------------------------------------------ */

type SummaryRow = {
  student_id: string;
  list_items: (Pick<PlanItem, "id" | "unit_id" | "category" | "status" | "outcome" | "round" | "enrolling" | "visited_on" | "dream"> & {
    plan_visits: Pick<PlanVisit, "on_date">[];
  })[];
  plan_tasks: Pick<
    PlanTask,
    "id" | "item_id" | "key" | "kind" | "title" | "due_on" | "window_start" | "window_end" | "assignee" | "done_at" | "dismissed" | "snoozed_until" | "orphaned" | "position" | "created_at"
  >[];
};

/**
 * The full summary line per student ("Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan"), for
 * the household page under each student's chip. Same one-query-per-student-set shape as `stageCaptions`, plus the
 * colleges' names (read from the dataset, not the database) and future visits for the fallback line. Fails soft:
 * any error means no summary lines, never a broken hub.
 */
export async function summaryLines(students: { id: string; gradYear: number | null }[]): Promise<Record<string, string>> {
  const today = todayIso();
  if (students.length === 0) return {};
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("lists")
      .select(
        "student_id, list_items!list_items_list_id_fkey(id, unit_id, category, status, outcome, round, enrolling, visited_on, dream, plan_visits!plan_visits_item_id_fkey(on_date)), plan_tasks!plan_tasks_list_id_fkey(id, item_id, key, kind, title, due_on, window_start, window_end, assignee, done_at, dismissed, snoozed_until, orphaned, position, created_at)",
      )
      .in(
        "student_id",
        students.map((s) => s.id),
      )
      .eq("is_default", true);
    if (error) {
      console.error(`planner: hub summary lines unavailable: ${error.message}`);
      return {};
    }
    const rows = (data ?? []) as SummaryRow[];
    const { getSchoolById } = await getData();
    const schools: Record<string, { name: string }> = {};
    for (const row of rows) for (const item of row.list_items ?? []) if (!schools[item.unit_id]) schools[item.unit_id] = { name: getSchoolById(item.unit_id)?.name ?? "A college" };
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (!row.list_items?.length) continue;
      const { current, stages } = stageOf({ items: row.list_items, tasks: row.plan_tasks ?? [], today });
      const visits = row.list_items.flatMap((i) => i.plan_visits ?? []);
      out[row.student_id] = summaryLine({
        current,
        stages,
        tasks: row.plan_tasks ?? [],
        items: row.list_items,
        schools,
        visits,
        today,
      });
    }
    return out;
  } catch (err) {
    console.error(`planner: hub summary lines unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
