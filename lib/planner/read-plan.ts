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
 *
 * Next steps (supabase/migrations/20261014120000_next_steps.sql; specs/planner/next-steps/build-plan.md review note
 * 5): until it's applied, tasks are read without `season, action` (null), items without `ed_dismissed_at, ed_checks`
 * (null, {}), and a generated-task upsert that fails on `season`/`action` is retried without them (upsertTaskRows).
 *
 * Plan v3 (supabase/migrations/20261016120000_plan_v3.sql; specs/planner/v3/build-plan.md review note 3): until it's
 * applied, tasks are read without `dismissed_at, dismissed_by` (null), and a skip that fails on them is retried with
 * the `dismissed` flag alone (updateTaskSkip). The generators never write them.
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
/** The five-levels migration's per-college hooks (20261012100000_five_levels.sql). */
export const PLAN_ITEM_HOOKS_COLUMNS = "legacy, recruited";
/** The sibling connection (20261012130000_list_item_sibling.sql; owner, 2026-10-12). */
export const PLAN_ITEM_SIBLING_COLUMN = "legacy_sibling";
/** Next steps' ED columns (20261014120000_next_steps.sql). */
export const PLAN_ITEM_ED_COLUMNS = "ed_dismissed_at, ed_checks";
export const PLAN_ITEM_COLUMNS = `${PLAN_ITEM_BASE_COLUMNS}, ${PLAN_ITEM_SOURCE_COLUMNS}, ${PLAN_ITEM_HOOKS_COLUMNS}, ${PLAN_ITEM_SIBLING_COLUMN}, ${PLAN_ITEM_ED_COLUMNS}`;
/** plan_tasks columns that exist without the next-steps migration. */
export const PLAN_TASK_BASE_COLUMNS =
  "id, list_id, item_id, key, kind, title, detail, due_on, window_start, window_end, assignee, source, source_field, source_edition, date_note, done_at, done_by, snoozed_until, dismissed, orphaned, position, created_by, created_at";
/** Next steps' move columns (20261014120000_next_steps.sql). */
export const PLAN_TASK_MOVE_COLUMNS = "season, action";
/** Plan v3's skip record (20261016120000_plan_v3.sql). */
export const PLAN_TASK_SKIP_COLUMNS = ["dismissed_at", "dismissed_by"] as const;
export const PLAN_TASK_COLUMNS = `${PLAN_TASK_BASE_COLUMNS}, ${PLAN_TASK_MOVE_COLUMNS}, dismissed_at, dismissed_by` as const;
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
  /** The database doesn't have the redesign's source columns yet: show suggestions, but write none. */
  sourcesMissing?: boolean;
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

/** The error is about the five-levels migration's hooks columns (not applied yet). */
export function isMissingHooksColumn(error: PgError): boolean {
  return isMissing(error) && /\blegacy\b|recruited/.test((error.message ?? "").replace(/legacy_sibling/g, ""));
}

/** The error is about the sibling column alone (20261012130000 not applied yet; the rest is there). */
export function isMissingSiblingColumn(error: PgError): boolean {
  return isMissing(error) && /legacy_sibling/.test(error.message ?? "");
}

/** The planner's tables aren't in the database yet (the migration hasn't been applied). */
export class PlannerSetupError extends Error {
  constructor(message: string) {
    super(`The planner's tables aren't set up yet: ${message}`);
    this.name = "PlannerSetupError";
  }
}

/**
 * Items read without the source columns get the sources the migration's own backfill would give them: a chosen group
 * (anything but "unsorted") and a stored round are the student's; the rest are suggestions. So the page shows the same
 * suggestions before and after the migration. Nothing is written while the columns are missing: `readItems` reports
 * `sourcesMissing` and the callers skip their auto writes (browser QA 2026-10-10 found every group showing "Add a
 * number" when every row was treated as the student's).
 */
export function withBackfillSources(rows: Omit<PlanItem, "category_source" | "round_source">[]): PlanItem[] {
  return rows.map((r) => ({
    ...r,
    category_source: r.category !== "unsorted" ? "student" : "auto",
    round_source: r.round !== null ? "student" : "auto",
  }));
}

/** Rows read before the five-levels migration (20261012100000) has applied: legacy/recruited default like a fresh row. */
function withBackfillHooks<T>(rows: T[]): (T & { legacy: boolean; recruited: "none" })[] {
  return rows.map((r) => ({ ...r, legacy: false, recruited: "none" as const }));
}

/** The list's items, retrying without newer columns when the database doesn't have them yet. */
export async function readItems(supabase: SupabaseClient, listId: string): Promise<{ data: PlanItem[] | null; error: PgError | null; sourcesMissing: boolean }> {
  const full = await supabase.from("list_items").select(PLAN_ITEM_COLUMNS).eq("list_id", listId).order("position");
  if (!full.error) return { data: withEdDefaults((full.data ?? []) as unknown as PlanItem[]), error: null, sourcesMissing: false };
  // Next steps' ED columns missing (20261014120000 not applied): read the rest; a different missing column falls
  // through to the older retries, none of which ask for the ED columns.
  if (!isMissing(full.error)) return { data: null, error: full.error, sourcesMissing: false };
  // An older column named instead: that read would fail the same way, so the older retries start from this error.
  const r = await readItemsBeforeNextSteps(supabase, listId, isMissingEdColumn(full.error) ? undefined : full.error);
  return r.data ? { ...r, data: withEdDefaults(r.data) } : r;
}

/** The error is about next steps' ED columns (20261014120000_next_steps.sql not applied yet). */
export function isMissingEdColumn(error: PgError): boolean {
  return isMissing(error) && /ed_dismissed_at|ed_checks/.test(error.message ?? "");
}

/** Rows read without the ED columns: not dismissed, no checks ticked. */
function withEdDefaults(rows: PlanItem[]): PlanItem[] {
  return rows.map((r) => ({ ...r, ed_dismissed_at: r.ed_dismissed_at ?? null, ed_checks: r.ed_checks ?? {} }));
}

/** readItems before next steps: every column but the ED ones, with the older migrations' retries. */
async function readItemsBeforeNextSteps(supabase: SupabaseClient, listId: string, known?: PgError): Promise<{ data: PlanItem[] | null; error: PgError | null; sourcesMissing: boolean }> {
  const full: { data: unknown; error: PgError | null } = known
    ? { data: null, error: known }
    : await supabase.from("list_items").select(`${PLAN_ITEM_BASE_COLUMNS}, ${PLAN_ITEM_SOURCE_COLUMNS}, ${PLAN_ITEM_HOOKS_COLUMNS}, ${PLAN_ITEM_SIBLING_COLUMN}`).eq("list_id", listId).order("position");
  if (!full.error) return { data: (full.data ?? []) as unknown as PlanItem[], error: null, sourcesMissing: false };
  let first: { data: unknown; error: PgError | null } = full;
  // The sibling column alone missing: read everything else, the sibling reading as unmarked.
  if (isMissingSiblingColumn(full.error)) {
    first = await supabase.from("list_items").select(`${PLAN_ITEM_BASE_COLUMNS}, ${PLAN_ITEM_SOURCE_COLUMNS}, ${PLAN_ITEM_HOOKS_COLUMNS}`).eq("list_id", listId).order("position");
    if (!first.error) return { data: ((first.data ?? []) as unknown as PlanItem[]).map((r) => ({ ...r, legacy_sibling: false })), error: null, sourcesMissing: false };
  }
  const err: PgError = first.error ?? full.error;
  if (isMissingHooksColumn(err)) {
    const withoutHooks = await supabase.from("list_items").select(`${PLAN_ITEM_BASE_COLUMNS}, ${PLAN_ITEM_SOURCE_COLUMNS}`).eq("list_id", listId).order("position");
    if (!withoutHooks.error) return { data: withBackfillHooks((withoutHooks.data ?? []) as unknown as Omit<PlanItem, "legacy" | "recruited">[]), error: null, sourcesMissing: false };
    if (!isMissingSourceColumn(withoutHooks.error)) return { data: null, error: withoutHooks.error, sourcesMissing: false };
  } else if (!isMissingSourceColumn(err)) {
    return { data: null, error: err, sourcesMissing: false };
  }
  const retry = await supabase.from("list_items").select(PLAN_ITEM_BASE_COLUMNS).eq("list_id", listId).order("position");
  if (retry.error) return { data: null, error: retry.error, sourcesMissing: true };
  return { data: withBackfillHooks(withBackfillSources((retry.data ?? []) as unknown as PlanItem[])), error: null, sourcesMissing: true };
}

/** The error is about next steps' move columns on plan_tasks (20261014120000_next_steps.sql not applied yet). */
export function isMissingMoveColumn(error: PgError): boolean {
  return isMissing(error) && /\bseason\b|\baction\b/.test(error.message ?? "");
}

/** The error is about plan v3's skip record on plan_tasks (20261016120000_plan_v3.sql not applied yet). */
export function isMissingSkipColumn(error: PgError): boolean {
  return isMissing(error) && /dismissed_at|dismissed_by/.test(error.message ?? "");
}

/** Rows read without the newer task columns: no season, no button, no skip record. */
export function withTaskDefaults<T extends Partial<Pick<PlanTask, "season" | "action" | "dismissed_at" | "dismissed_by">>>(rows: T[]): (T & Pick<PlanTask, "season" | "action" | "dismissed_at" | "dismissed_by">)[] {
  return rows.map((r) => ({ ...r, season: r.season ?? null, action: r.action ?? null, dismissed_at: r.dismissed_at ?? null, dismissed_by: r.dismissed_by ?? null }));
}

/**
 * A list's tasks (due date, then position), retrying without the newer columns while their migrations aren't applied:
 * without `dismissed_at, dismissed_by` (plan v3), then without `season, action` too (next steps' review note 5). They
 * read as null.
 */
export async function readTaskRows(supabase: SupabaseClient, listId: string): Promise<{ data: PlanTask[] | null; error: PgError | null }> {
  const sel = (cols: string) => supabase.from("plan_tasks").select(cols).eq("list_id", listId).order("due_on", { nullsFirst: false }).order("position");
  const done = (rows: unknown) => ({ data: withTaskDefaults((rows ?? []) as unknown as PlanTask[]), error: null });
  const full = await sel(PLAN_TASK_COLUMNS);
  if (!full.error) return done(full.data);
  let err: PgError = full.error;
  if (isMissingSkipColumn(err)) {
    const withoutSkip = await sel(`${PLAN_TASK_BASE_COLUMNS}, ${PLAN_TASK_MOVE_COLUMNS}`);
    if (!withoutSkip.error) return done(withoutSkip.data);
    err = withoutSkip.error;
  }
  if (!isMissingMoveColumn(err)) return { data: null, error: err };
  const retry = await sel(PLAN_TASK_BASE_COLUMNS);
  if (retry.error) return { data: null, error: retry.error };
  return done(retry.data);
}

/**
 * The skip record's patch (now.md "Skip, recorded"; build-plan.md review note 7): skipping stamps when and who;
 * bringing back clears all three.
 */
export function skipPatch(dismissed: boolean, userId: string, now: string): { dismissed: boolean; dismissed_at: string | null; dismissed_by: string | null } {
  return dismissed ? { dismissed: true, dismissed_at: now, dismissed_by: userId } : { dismissed: false, dismissed_at: null, dismissed_by: null };
}

/**
 * Skips a task or brings it back with the user's own client (RLS decides), stamping the skip record; on a missing
 * `dismissed_at`/`dismissed_by` column (the plan v3 migration not applied yet) retried with `{ dismissed }` alone.
 * Returns the updated ids (empty when the user can't edit the task) or the last error.
 */
export async function updateTaskSkip(
  supabase: SupabaseClient,
  taskId: string,
  dismissed: boolean,
  userId: string,
  now: string = new Date().toISOString(),
): Promise<{ data: { id: string }[] | null; error: PgError | null }> {
  const update = (patch: Record<string, unknown>) => supabase.from("plan_tasks").update(patch).eq("id", taskId).select("id");
  const first = await update(skipPatch(dismissed, userId, now));
  if (!first.error || !isMissingSkipColumn(first.error)) return { data: (first.data ?? null) as { id: string }[] | null, error: first.error };
  const retry = await update({ dismissed });
  return { data: (retry.data ?? null) as { id: string }[] | null, error: retry.error };
}

/**
 * Upserts generated task rows on (list_id, key). On a missing-column error naming `season` or `action` (the
 * next-steps migration not applied yet), retries once without those two fields (review note 5). Returns the error of
 * the last attempt, or null.
 */
export async function upsertTaskRows(supabase: SupabaseClient, rows: Record<string, unknown>[]): Promise<PgError | null> {
  const { error } = await supabase.from("plan_tasks").upsert(rows, { onConflict: "list_id,key" });
  if (!error) return null;
  if (!isMissingMoveColumn(error)) return error;
  const stripped = rows.map((r) => {
    const copy = { ...r };
    delete copy.season;
    delete copy.action;
    return copy;
  });
  const retry = await supabase.from("plan_tasks").upsert(stripped, { onConflict: "list_id,key" });
  return retry.error ?? null;
}

/**
 * Reads a list's plan in one round after the list (items, tasks, visits, offers, nudges in parallel). Null when the
 * list isn't visible. Throws `PlannerSetupError` when the planner migration isn't applied yet, so a page can say so.
 */
export async function readPlan(supabase: SupabaseClient, listId: string): Promise<PlanData | null> {
  // The list, its items, and its tasks don't depend on each other: one round together (U20 "real speed"; it was the
  // list, then the other two). An unreadable list still returns null, whatever the other two said.
  const [list, items, tasks] = await Promise.all([
    supabase.from("lists").select(PLAN_LIST_COLUMNS).eq("id", listId).maybeSingle(),
    readItems(supabase, listId),
    readTaskRows(supabase, listId),
  ]);
  if (list.error) {
    if (isMissing(list.error)) throw new PlannerSetupError(list.error.message ?? "");
    throw new Error(`Reading the plan's list failed: ${list.error.message}`);
  }
  if (!list.data) return null;
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
    ...(items.sourcesMissing ? { sourcesMissing: true } : {}),
  };
}
