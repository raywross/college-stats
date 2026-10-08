import "server-only";
/**
 * Builds the planner's data on the server (specs/planner/model.md): one read of a list's plan with the user's own
 * session (row-level security decides), the college facts each stage needs cut from the dataset with citations
 * resolved (PlanSchool), and the PlanContext PlanPage hands to the stage panels. Not a "use server" module: pages and
 * lib/planner/store.ts call it; the browser never does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getData } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { distanceFromHome, type HomeLocation } from "@/lib/home";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { currentCycle, cycleFor, cycleStartFromEntering, gradeOf, loadCycle } from "./cycle";
import { stageOf } from "./stage";
import { sameDocumentTotals } from "@/lib/early";
import { redConflictCount } from "./rounds";
import type { MergeResult } from "./tasks";
import type { GeneratorInput, ListSort, PlanContext, PlanItem, PlanNudge, PlanOffer, PlanSchool, PlanTask, PlanVisit } from "./types";
import type { ListRecord } from "@/lib/list-rules";

export const PLAN_LIST_COLUMNS = "id, student_id, user_id, name, is_default, share_enabled, created_by, created, sort, rounds_plan_accepted_at";
export const PLAN_ITEM_COLUMNS =
  "id, list_id, unit_id, category, status, outcome, round, position, added_by, added_at, decision_date, deadline_text, deadline_date, enrolling, updates, visited_on, follows_social, dream, priority, followed_networks, info_requested_on, application_platform, applied_on, complete_on, portal_url, committed_on, withdrawn_on, recommendations_count, supplements_count, transcript_shared";
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

function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || error.code === "PGRST204" || /does not exist|schema cache/i.test(error.message ?? "");
}

/**
 * Reads a list's plan in one round after the list (items, tasks, visits, offers, nudges in parallel). Null when the
 * list isn't visible. Throws `PlannerSetupError` when the planner migration isn't applied yet, so a page can say so.
 */
export async function readPlan(supabase: SupabaseClient, listId: string): Promise<PlanData | null> {
  const list = await supabase.from("lists").select(PLAN_LIST_COLUMNS).eq("id", listId).maybeSingle();
  if (list.error) {
    if (isMissing(list.error)) throw new PlannerSetupError(list.error.message);
    throw new Error(`Reading the plan's list failed: ${list.error.message}`);
  }
  if (!list.data) return null;
  const [items, tasks] = await Promise.all([
    supabase.from("list_items").select(PLAN_ITEM_COLUMNS).eq("list_id", listId).order("position"),
    supabase.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId).order("due_on", { nullsFirst: false }).order("position"),
  ]);
  for (const r of [items, tasks]) {
    if (r.error) {
      if (isMissing(r.error)) throw new PlannerSetupError(r.error.message);
      throw new Error(`Reading the plan failed: ${r.error.message}`);
    }
  }
  const itemIds = (items.data as PlanItem[]).map((i) => i.id);
  const taskIds = (tasks.data as PlanTask[]).map((t) => t.id);
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
    items: items.data as PlanItem[],
    tasks: tasks.data as PlanTask[],
    visits: (visits.data ?? []) as PlanVisit[],
    offers: (offers.data ?? []) as PlanOffer[],
    nudges: (nudges.data ?? []) as PlanNudge[],
  };
}

/** The planner's tables aren't in the database yet (the migration hasn't been applied). */
export class PlannerSetupError extends Error {
  constructor(message: string) {
    super(`The planner's tables aren't set up yet: ${message}`);
    this.name = "PlannerSetupError";
  }
}

/* ------------------------------------------------------------------ */
/* PlanSchool                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every field a stage may cite. A citation is resolved only when the college has a value there, so a list of thirty
 * colleges doesn't ship thirty sets of empty citations to the browser. Add paths additively.
 */
export const PLAN_CITE_PATHS = [
  "admissions.acceptance_rate",
  "admissions.application_fee",
  "admissions.test_policy",
  "cost.avg_paid_all",
  "cost.sticker",
  "location.lat",
  "links.website",
  "links.price_calculator",
  "links.admissions",
  "links.apply",
  "links.financial_aid",
  "links.visit",
  "links.virtual_tour",
  "social.instagram",
  "social.youtube",
  "social.tiktok",
  "social.x",
  "social.facebook",
  "social.linkedin",
  "reported.admission_profile.factors.interest",
  "reported.admission_profile.factors.interview",
  "reported.admission_profile.wait_list.policy",
  "reported.admission_profile.early_decision.offered",
  "reported.admission_profile.early_decision.first.closing",
  "reported.admission_profile.early_decision.first.notification",
  "reported.admission_profile.early_decision.other.closing",
  "reported.admission_profile.early_decision.other.notification",
  "reported.admission_profile.early_decision.applicants",
  "reported.admission_profile.early_decision.admitted",
  "reported.admission_profile.early_action.offered",
  "reported.admission_profile.early_action.closing",
  "reported.admission_profile.early_action.notification",
  "reported.admission_profile.early_action.restrictive",
  "reported.admissions_logistics.fee",
  "reported.admissions_logistics.regular_closing",
  "reported.admissions_logistics.priority_date",
  "reported.admissions_logistics.notification",
  "reported.admissions_logistics.reply",
  "reported.admissions_logistics.housing_deposit",
  "reported.aid.forms",
  "reported.aid.dates",
  "reported.test_policy",
] as const satisfies readonly FieldPath[];

function valueAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * The slice of a School the stages read, with citations resolved. `studentCycleStart` is the start year of the
 * cycle the student applies in: college month/day dates resolve against it (lib/list-rules.ts deadlineFor's rule),
 * and `editionIsLastCycle` says the college's logistics describe an earlier cycle than the student's.
 */
export function planSchoolFor(
  school: School,
  citeField: (path: FieldPath, school?: School) => unknown,
  opts: { studentCycleStart: number; home: HomeLocation | null },
): PlanSchool {
  const logistics = school.reported?.admissions_logistics ?? null;
  const dataStart = cycleStartFromEntering(logistics?.cycle);
  const cites: Record<string, unknown> = {};
  for (const path of PLAN_CITE_PATHS) {
    const v = valueAt(school, path);
    if (v !== undefined && v !== null) cites[path] = citeField(path, school);
  }
  return {
    unit_id: school.unit_id,
    name: school.name,
    city: school.location?.city ?? null,
    state: school.location?.state ?? null,
    brand: crestBrand(school),
    admitRate: school.admissions?.acceptance_rate ?? null,
    admitRateCite: cites["admissions.acceptance_rate"] ?? null,
    avgCost: school.cost?.avg_paid_all ?? null,
    avgCostCite: cites["cost.avg_paid_all"] ?? null,
    sticker: school.cost?.sticker ?? null,
    distanceMiles: opts.home ? distanceFromHome(school.location, opts.home) : null,
    links: school.links ?? null,
    social: school.social ?? null,
    profile: school.reported?.admission_profile ?? null,
    logistics,
    aid: school.reported?.aid ?? null,
    testPolicy: school.reported?.test_policy ?? school.admissions?.test_policy ?? null,
    cycleStartYear: opts.studentCycleStart,
    editionIsLastCycle: dataStart !== null && dataStart < opts.studentCycleStart,
    cites,
    type: school.type ?? null,
    edTotals: sameDocumentTotals(school),
  };
}

/** PlanSchool for every college on the list, by unit id (a college no longer in the dataset is left out). */
export async function planSchools(unitIds: string[], studentCycleStart: number, home: HomeLocation | null): Promise<Record<string, PlanSchool>> {
  const { getSchoolById, citeField } = await getData();
  const out: Record<string, PlanSchool> = {};
  for (const id of unitIds) {
    const school = getSchoolById(id);
    if (school) out[id] = planSchoolFor(school, citeField, { studentCycleStart, home });
  }
  return out;
}

/**
 * Writes a merge (lib/planner/tasks.ts mergeTasks) with the caller's session: upserts on (list_id, key) carrying only
 * generated fields, then marks orphans. Returns whether anything was written (false: nothing to do, or the reader
 * can't edit the list, which RLS refuses quietly or with an error that's logged, never thrown).
 */
export async function writeMerge(supabase: SupabaseClient, listId: string, merge: MergeResult): Promise<boolean> {
  if (merge.upserts.length === 0 && merge.orphans.length === 0) return false;
  if (merge.upserts.length > 0) {
    const rows = merge.upserts.map((u) => ({ ...u, list_id: listId }));
    const { error } = await supabase.from("plan_tasks").upsert(rows, { onConflict: "list_id,key" });
    if (error) {
      console.error(`planner: writing generated tasks failed: ${error.message}`);
      return false;
    }
  }
  if (merge.orphans.length > 0) {
    const { error } = await supabase.from("plan_tasks").update({ orphaned: true }).in("id", merge.orphans);
    if (error) console.error(`planner: marking orphaned tasks failed: ${error.message}`);
  }
  return true;
}

/** Re-reads only a list's tasks (after writeMerge). */
export async function readTasks(supabase: SupabaseClient, listId: string): Promise<PlanTask[]> {
  const { data, error } = await supabase.from("plan_tasks").select(PLAN_TASK_COLUMNS).eq("list_id", listId).order("due_on", { nullsFirst: false }).order("position");
  if (error) throw new Error(`Reading the plan's tasks failed: ${error.message}`);
  return data as PlanTask[];
}

/* ------------------------------------------------------------------ */
/* PlanContext                                                         */
/* ------------------------------------------------------------------ */

/** Today in the site's home time zone (US Eastern), as yyyy-mm-dd: a task due "today" means the family's today. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface PlanStudent {
  id: string;
  display_name: string | null;
  grad_year: number | null;
  user_id: string | null;
}

/** The cycle a plan works in: the student's (from their grad year), else the one under way today. */
export function planCycleKey(gradYear: number | null, today: string): string {
  return gradYear !== null ? cycleFor(gradYear) : currentCycle(today);
}

/** What the generators read for a plan (store.regenerate and PlanPage share it). */
export async function generatorInputFor(
  plan: PlanData,
  opts: { gradYear: number | null; profile: StudentProfileData | null; home: HomeLocation | null; today: string },
): Promise<GeneratorInput> {
  const cycle = loadCycle(planCycleKey(opts.gradYear, opts.today));
  const schools = await planSchools(plan.items.map((i) => i.unit_id), cycle.startYear, opts.home);
  return {
    list: plan.list,
    items: plan.items,
    schools,
    profile: opts.profile,
    cycle,
    grade: gradeOf(opts.gradYear, opts.today),
    today: opts.today,
    visits: plan.visits,
    offers: plan.offers,
  };
}

/** The whole PlanContext: the generator input plus the tasks, the viewer, and the stage machine's answer. */
export function planContextFrom(
  input: GeneratorInput,
  plan: PlanData,
  extra: { student: PlanStudent | null; home: HomeLocation | null; viewer: PlanContext["viewer"] },
): PlanContext {
  const { current, stages } = stageOf({ items: plan.items, tasks: plan.tasks, today: input.today, conflicts: redConflictCount(plan.items, input.schools) });
  return {
    ...input,
    tasks: plan.tasks,
    nudges: plan.nudges,
    student: extra.student,
    home: extra.home,
    viewer: extra.viewer,
    stages,
    current,
  };
}
