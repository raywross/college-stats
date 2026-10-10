/**
 * Reads one list's plan with a Supabase client the caller built (the user's own session, so row-level security
 * decides): the list, its colleges, and everything hanging off them. Split out of lib/planner/context.ts (which
 * re-exports all of it) so it has no server-only imports and tests can run it against a fake client
 * (tests/planner-read-plan.test.mts).
 *
 * Before the redesign migration (supabase/migrations/20261010120000_plan_redesign.sql) is applied, `list_items` has no
 * `category_source`/`round_source`. A read that fails on them is retried without them, and every row comes back as
 * the student's (`student` source) so nothing is ever overwritten (specs/planner/redesign/build-plan.md, review
 * note 2): the plan renders, read-only-safe, either way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListRecord } from "../list-rules.ts";
import type { ListSort, PlanItem, PlanNudge, PlanOffer, PlanTask, PlanVisit } from "./types.ts";

export const PLAN_LIST_COLUMNS = "id, student_id, user_id, name, is_default, share_enabled, created_by, created, sort, rounds_plan_accepted_at";
/** list_items columns that exist without the redesign migration. */
export const PLAN_ITEM_BASE_COLUMNS =
  "id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date, deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, dream, priority, followed_networks, info_requested_on, application_platform, applied_on, complete_on, portal_url, committed_on, withdrawn_on, recommendations_count, supplements_count, transcript_shared";
/** The redesign's two columns (20261010120000_plan_redesign.sql). */
export const PLAN_ITEM_SOURCE_COLUMNS = "category_source, round_source";
export const PLAN_ITEM_COLUMNS = `${PLAN_ITEM_BASE_COLUMNS}, ${PLAN_ITEM_SOURCE_COLUMNS}`;
export const PLAN_TASK_COLUMNS =
  "id, list_id, item_id, key, kind, title, detail, due_on, window_start, window_end, assignee, source, source_field, source_edition, date_note, done_at, done_by, snoozed_until, dismissed, orphaned, position, created_by, created_at";
const VISIT_COLUMNS = "id, item_id, kind, on_date, at_time, registered, registration_url, who, rating, notes, created_by, created_at, updated_at";
const OFFER_COLUMNS = "id, item_id, award_year, letter_date, source, coa, gift, work_study, loans, quotes, pros, cons, confirmed_at, created_by, created_at";
const NUDGE_COLUMNS = "id, task_id, from_user, to_student, note, sent_at, channel, reply, replied_at";

export type PlanList = ListRecord & { sort: ListSort | null; rounds_plan_accepted_at: string | null };

/** One list's plan: the list, its colleges, and everything hanging off them that the reader may see. */
export interface PlanData {
  list: PlanList;
  items: PlanItem[];
  tasks: PlanTask[];
  visits: PlanVisit[];
  offers: PlanOffer[];
  nudges: PlanNudge[];
}

type PgError = { code?: string; message?: string };

/** A table or column the code expects isn't in the database (a migration not applied yet). */
export function isMissing(error: PgError): boolean {
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** The error is about one of the redesign's source columns (so the rest of the planner is there). */
export function isMissingSourceColumn(error: PgError): boolean {
  return isMissing(error) && /category_source|round_source/.test(error.message ?? "");
}

/** The planner's tables aren't in the database yet (the migration hasn't been applied). */
export class PlannerSetupError extends Error {
  constructor(message: string) {
    super(`The planner's tables aren't set up yet: ${message}`);
    this.name = "PlannerSetupError";
  }
}

/** Items read without the source columns: every value is treated as the student's, so the site never rewrites it. */
export function withStudentSources(rows: Omit<PlanItem, "category_source" | "round_source">[]): PlanItem[] {
  return rows.map((r) => ({ ...r, category_source: "student", round_source: "student" }));
}

/** The list's items, retrying without the redesign's columns when the database doesn't have them yet. */
export async function readItems(supabase: SupabaseClient, listId: string): Promise<{ data: PlanItem[] | null; error: PgError | null }> {
  const first = await supabase.from("list_items").select(PLAN_ITEM_COLUMNS).eq("list_id", listId).order("position");
  if (!first.error) return { data: (first.data ?? []) as unknown as PlanItem[], error: null };
  if (!isMissingSourceColumn(first.error)) return { data: null, error: first.error };
  const retry = await supabase.from("list_items").select(PLAN_ITEM_BASE_COLUMNS).eq("list_id", listId).order("position");
  if (retry.error) return { data: null, error: retry.error };
  return { data: withStudentSources((retry.data ?? []) as unknown as PlanItem[]), error: null };
}

/**
 * Reads a list's plan in one round after the list (items, tasks, visits, offers, nudges in parallel). Null when the
 * list isn't visible. Throws `PlannerSetupError` when the planner migration isn't applied yet, so a page can say so.
 */
export async function readPlan(supabase: SupabaseClient, listId: string): Promise<PlanData | null> {
  const list = await supabase.from("lists").select(PLAN_LIST_COLUMNS).eq("id", listId).maybeSingle();
  if (list.error) {
    if (isMissing(list.error)) throw new PlannerSetupError(list.error.message ?? "");
    throw new Error(`Reading the plan's list failed: ${list.error.message}`);
  }
  if (!list.data) return null;
  const [items, tasks] = await Promise.all([
    readItems(supabase, listId),
    supabase.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId).order("due_on", { nullsFirst: false }).order("position"),
  ]);
  for (const r of [items, tasks]) {
    if (r.error) {
      if (isMissing(r.error)) throw new PlannerSetupError(r.error.message ?? "");
      throw new Error(`Reading the plan failed: ${r.error.message}`);
    }
  }
  const itemRows = items.data ?? [];
  const taskRows = (tasks.data ?? []) as PlanTask[];
  const itemIds = itemRows.map((i) => i.id);
  const taskIds = taskRows.map((t) => t.id);
  const [visits, offers, nudges] = await Promise.all([
    itemIds.length ? supabase.from("plan_visits").select(VISIT_COLUMNS).in("item_id", itemIds).order("on_date") : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from("plan_offers").select(OFFER_COLUMNS).in("item_id", itemIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    taskIds.length ? supabase.from("plan_nudges").select(NUDGE_COLUMNS).in("task_id", taskIds).order("sent_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [visits, offers, nudges]) {
    if (r.error) throw new Error(`Reading the plan failed: ${r.error.message}`);
  }
  return {
    list: list.data as PlanList,
    items: itemRows,
    tasks: taskRows,
    visits: (visits.data ?? []) as PlanVisit[],
    offers: (offers.data ?? []) as PlanOffer[],
    nudges: (nudges.data ?? []) as PlanNudge[],
  };
}
