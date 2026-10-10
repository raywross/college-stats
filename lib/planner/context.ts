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
import { satTotal } from "@/lib/score-bands";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { currentCycle, cycleFor, cycleStartFromEntering, gradeOf, loadCycle } from "./cycle";
import { stageOf } from "./stage";
import { sameDocumentTotals } from "@/lib/early";
import { redConflictCount } from "./rounds";
import type { MergeResult } from "./tasks";
import type { GeneratorInput, PlanContext, PlanSchool, PlanTask } from "./types";
import type { ListCategory, ListRound } from "@/lib/list-rules";
import type { StandingSchool } from "./standing";
import { autoWriteBatches } from "./plan-writes";
import { PLAN_TASK_COLUMNS, type PlanData } from "./read-plan";

export {
  isMissing,
  PLAN_ITEM_BASE_COLUMNS,
  PLAN_ITEM_COLUMNS,
  PLAN_ITEM_SOURCE_COLUMNS,
  PLAN_LIST_COLUMNS,
  PLAN_TASK_COLUMNS,
  PlannerSetupError,
  readItems,
  readPlan,
  type PlanData,
  type PlanList,
} from "./read-plan";

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
  // Redesign (standing.md "The rules"): the average first-year GPA the standing model compares with.
  "reported.admission_profile.gpa.average",
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
  "admissions.act_composite_25_75",
  // U2 (list-building.md "Suggested category"): the SAT total shown, resolved from the CDS when it reports one else
  // the sum of sections (lib/score-bands.ts). Not a real dot path on School, so planSchoolFor resolves it by hand.
  "derived.sat_total",
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
    if (path === "derived.sat_total") continue; // not a real dot path; resolved below
    const v = valueAt(school, path);
    if (v !== undefined && v !== null) cites[path] = citeField(path, school);
  }
  // U2: the SAT total shown (satTotal, lib/score-bands.ts), cited only when the college reports one.
  const satRange = satTotal(school);
  if (satRange) cites["derived.sat_total"] = citeField("derived.sat_total", school);
  const actRange = school.admissions.act_composite_25_75 ?? null;
  const gpaAverage = standingGpaAverage(school);
  const standing: StandingSchool = {
    admitRate: school.admissions?.acceptance_rate ?? null,
    sat: satRange,
    act: actRange,
    gpaAverage,
    testPolicy: school.admissions?.test_policy ?? null,
  };
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
    applicationFee: school.admissions?.application_fee ?? null,
    cycleStartYear: opts.studentCycleStart,
    editionIsLastCycle: dataStart !== null && dataStart < opts.studentCycleStart,
    cites,
    type: school.type ?? null,
    edTotals: sameDocumentTotals(school),
    satRange,
    actRange,
    gpaAverage,
    standing,
  };
}

/**
 * The college's average first-year GPA as the standing model reads it (standing.md "The rules"; the same rule as the
 * design preview): only an unweighted average on the 4.0 scale (CDS C12), else null.
 */
export function standingGpaAverage(school: Pick<School, "reported">): number | null {
  const gpa = school.reported?.admission_profile?.gpa;
  return gpa?.average != null && gpa.average <= 4 && gpa.scale !== "weighted" ? gpa.average : null;
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

/**
 * Writes the auto groups and rounds the model wants (lib/planner/plan-view.ts autoWrites) with the caller's session,
 * one update per distinct value (lib/planner/plan-writes.ts autoWriteBatches). Every update is also filtered on its
 * source column still being `auto`, so a pick the student made a moment ago is never overwritten. Returns how many
 * rows changed; a reader who can't edit writes nothing (RLS), and errors are logged, never thrown.
 */
export async function writeAutoWrites(supabase: SupabaseClient, writes: { id: string; category?: ListCategory; round?: ListRound }[]): Promise<number> {
  let changed = 0;
  for (const batch of autoWriteBatches(writes)) {
    const { data, error } = await supabase.from("list_items").update(batch.patch).in("id", batch.ids).eq(batch.sourceColumn, "auto").select("id");
    if (error) {
      console.error(`planner: writing suggested ${batch.sourceColumn === "category_source" ? "groups" : "rounds"} failed: ${error.message}`);
      continue;
    }
    changed += data?.length ?? 0;
  }
  return changed;
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
