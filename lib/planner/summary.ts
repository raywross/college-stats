/**
 * The parent's view, computed, never stored (specs/planner/parents.md): the one-line summary under a student's
 * chip and atop their Plan tab, the stuck signals shown to guardian and student alike, and "Your part" (open tasks
 * assigned to a guardian, grouped by student). Pure: no I/O, so the hub, the Plan tab, the weekly email, and the
 * tests all read the same three functions.
 *
 * Nothing here is a verdict: no score, no standing, no overdue count presented as a failing grade (that stays inside
 * the plan, in the same style as for the student). `stuckSignals` is a short list of facts with a link, each shown
 * only when true, gated by grade (off for juniors except the Likely one in spring; all six from the summer before
 * senior year on).
 */
import { dayLabel, isOpen, nextTask, compareTasks, taskDate } from "./tasks.ts";
import { stageCaption, type StageCounts } from "./stage.ts";
import type { Cycle, Grade } from "./cycle.ts";
import type { Estimate, MoneyInput } from "./rounds.ts";
import { ROUND_SHORT } from "./rounds.ts";
import type { PlanItem, PlanSchool, PlanTask, PlanVisit, Stage } from "./types.ts";

export { NO_MONEY } from "./rounds.ts";
export type { Estimate, MoneyInput };

/* ------------------------------------------------------------------ */
/* The summary line                                                    */
/* ------------------------------------------------------------------ */

export type SummaryItem = Pick<PlanItem, "id" | "unit_id" | "dream" | "round">;

export interface SummaryInput {
  current: Stage;
  stages: StageCounts;
  tasks: Pick<PlanTask, "item_id" | "due_on" | "window_start" | "window_end" | "done_at" | "dismissed" | "snoozed_until" | "orphaned">[];
  items: SummaryItem[];
  schools: Record<string, Pick<PlanSchool, "name">>;
  /** Only future ones matter here; past visits don't change the line. */
  visits: Pick<PlanVisit, "on_date">[];
  today: string;
}

/**
 * "Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan" (parents.md "The summary line"): the
 * stage caption, then the next dated task (college, date, round) when one exists, else how many visits are planned,
 * then the Dream when one is set. Never a score, a standing, or an overdue count. The caller prepends the name
 * ("Alex · …").
 */
export function summaryLine(input: SummaryInput): string {
  const parts = [stageCaption(input.current, input.stages)];
  const next = nextTaskLine(input);
  if (next) parts.push(next);
  else {
    const upcoming = input.visits.filter((v) => v.on_date >= input.today).length;
    if (upcoming > 0) parts.push(`${upcoming} visit${upcoming === 1 ? "" : "s"} planned`);
  }
  const dream = input.items.find((i) => i.dream);
  if (dream) parts.push(`Dream: ${input.schools[dream.unit_id]?.name ?? "a college"}`);
  return parts.join(" · ");
}

function nextTaskLine(input: SummaryInput): string | null {
  const t = nextTask(input.tasks as PlanTask[], input.today);
  if (!t) return null;
  const item = t.item_id ? input.items.find((i) => i.id === t.item_id) : null;
  // A college task names the college; a list-wide task (the cycle's or the stage's) names itself.
  const name = item ? (input.schools[item.unit_id]?.name ?? "a college") : t.title;
  const date = dayLabel(taskDate(t)!, input.today);
  const round = item?.round ? ROUND_SHORT[item.round] : null;
  return `next: ${name}, ${date}${round ? ` (${round})` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Stuck signals                                                       */
/* ------------------------------------------------------------------ */

export type StuckSignalId = "overdue_task" | "no_activity" | "no_likely" | "ed_no_estimate" | "waitlist_no_commit" | "overdue_decision";

export interface StuckSignal {
  id: StuckSignalId;
  /** A fact with a link where one applies; never a judgment. */
  text: string;
  link?: string | null;
}

/** `added_at` is optional so callers with older rows still compile; when present, adding a college counts as activity. */
export type StuckItem = Pick<PlanItem, "id" | "unit_id" | "category" | "status" | "outcome" | "round" | "committed_on"> & { added_at?: string | null };
export type StuckTask = Pick<PlanTask, "id" | "item_id" | "kind" | "due_on" | "window_start" | "window_end" | "done_at" | "dismissed" | "snoozed_until" | "source" | "created_at" | "title" | "orphaned">;
export type StuckVisit = Pick<PlanVisit, "created_at" | "updated_at">;

export interface StuckSignalsInput {
  items: StuckItem[];
  tasks: StuckTask[];
  visits: StuckVisit[];
  schools: Record<string, Pick<PlanSchool, "name" | "links">>;
  money: MoneyInput;
  cycle: Pick<Cycle, "startYear">;
  grade: Grade;
  today: string;
}

/** Grades in which every signal but the Likely one may fire (parents.md: "from the summer before senior year on"). */
const ALL_SIGNALS_FROM: readonly Grade[] = ["summer_before_senior", "senior_fall", "senior_winter", "senior_spring", "summer_after"];

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function schoolName(schools: StuckSignalsInput["schools"], unitId: string | undefined): string {
  return (unitId && schools[unitId]?.name) || "A college";
}

/** The most overdue open task (7+ days), if any. */
function overdueTaskSignal(input: StuckSignalsInput): StuckSignal | null {
  const cutoff = addDaysIso(input.today, -7);
  const overdue = input.tasks
    .filter((t) => isOpen(t, input.today) && taskDate(t) !== null && taskDate(t)! <= cutoff)
    .sort((a, b) => taskDate(a)!.localeCompare(taskDate(b)!));
  const t = overdue[0];
  if (!t) return null;
  const name = t.item_id ? schoolName(input.schools, (input.items.find((i) => i.id === t.item_id) as StuckItem | undefined)?.unit_id) : null;
  return { id: "overdue_task", text: `${name ? `${name}'s ` : ""}"${t.title}" was due ${dayLabel(taskDate(t)!, input.today)}`, link: null };
}

/** Nothing ticked, added, or logged in the last 14 days, during the season (August to May). */
function noActivitySignal(input: StuckSignalsInput): StuckSignal | null {
  const month = Number(input.today.slice(5, 7));
  if (month >= 6 && month <= 7) return null; // June, July: not "the season" (Aug–May)
  const stamps: string[] = [];
  for (const t of input.tasks) {
    if (t.done_at) stamps.push(t.done_at);
    if (t.source === "own" && t.created_at) stamps.push(t.created_at);
  }
  for (const v of input.visits) stamps.push(v.updated_at ?? v.created_at);
  for (const i of input.items) if (i.added_at) stamps.push(i.added_at); // a college added this week is activity too
  const last = stamps.sort().at(-1) ?? null;
  const cutoff = addDaysIso(input.today, -14);
  if (last !== null && last.slice(0, 10) > cutoff) return null;
  return { id: "no_activity", text: "No activity on the plan for 14 days.", link: null };
}

/** No Likely on the list. */
function noLikelySignal(input: StuckSignalsInput): StuckSignal | null {
  if (input.items.length === 0 || input.items.some((i) => i.category === "likely")) return null;
  return { id: "no_likely", text: "No Likely college is on the list yet.", link: null };
}

/** A live ED/ED II college with no shared estimate (the net-price estimator's seam; rounds.ts MoneyInput). */
function edNoEstimateSignal(input: StuckSignalsInput): StuckSignal | null {
  const item = input.items.find((i) => (i.round === "ed" || i.round === "ed2") && i.status !== "decided" && !input.money.estimates[i.id]);
  if (!item) return null;
  const name = schoolName(input.schools, item.unit_id);
  return { id: "ed_no_estimate", text: `${name} is ${ROUND_SHORT[item.round!]}, which is binding; share an estimate or run the college's calculator`, link: input.schools[item.unit_id]?.links?.price_calculator ?? null };
}

/** A wait-listed college with no other college committed, once April 20 of the cycle's second year has passed. */
function waitlistSignal(input: StuckSignalsInput): StuckSignal | null {
  const waitlisted = input.items.find((i) => i.outcome === "waitlisted");
  if (!waitlisted) return null;
  if (input.items.some((i) => i.committed_on !== null)) return null;
  const aprilTwenty = `${input.cycle.startYear + 1}-04-20`;
  if (input.today < aprilTwenty) return null;
  return { id: "waitlist_no_commit", text: `${schoolName(input.schools, waitlisted.unit_id)} is on the wait list, and no college has a deposit yet`, link: null };
}

/** A decision-expected date that's passed with no outcome recorded. */
function overdueDecisionSignal(input: StuckSignalsInput): StuckSignal | null {
  const t = input.tasks.find((t) => {
    if (t.kind !== "decision_expected" || !isOpen(t, input.today) || t.due_on === null || t.due_on >= input.today) return false;
    const item = t.item_id ? input.items.find((i) => i.id === t.item_id) : null;
    return item ? item.status !== "decided" : false;
  });
  if (!t) return null;
  const item = input.items.find((i) => i.id === t.item_id)!;
  return { id: "overdue_decision", text: `${schoolName(input.schools, item.unit_id)}'s decision was expected ${dayLabel(t.due_on!, input.today)}; nothing recorded yet`, link: null };
}

/**
 * Every true signal, in a fixed order, gated by grade (parents.md "Stuck signals"): off for juniors and earlier,
 * except the no-Likely one from junior spring; every signal from the summer before senior year on.
 */
export function stuckSignals(input: StuckSignalsInput): StuckSignal[] {
  if (input.grade === "junior_spring") {
    const likely = noLikelySignal(input);
    return likely ? [likely] : [];
  }
  if (!ALL_SIGNALS_FROM.includes(input.grade)) return [];
  const checks = [overdueTaskSignal, noActivitySignal, noLikelySignal, edNoEstimateSignal, waitlistSignal, overdueDecisionSignal];
  const out: StuckSignal[] = [];
  for (const check of checks) {
    const s = check(input);
    if (s) out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Your part                                                           */
/* ------------------------------------------------------------------ */

export interface YourPartStudent {
  studentId: string;
  name: string | null;
  tasks: PlanTask[];
}

export interface YourPartGroup {
  studentId: string;
  name: string | null;
  /** Open tasks assigned to a guardian or either, soonest first (tasks.ts compareTasks). */
  tasks: PlanTask[];
}

/**
 * "Your part" (parents.md "The parent's tasks"): every open task assigned `guardian` or `either`, across every
 * student the guardian can see, grouped by student; a student with none is left out.
 */
export function yourPart(students: YourPartStudent[], today: string): YourPartGroup[] {
  return students
    .map((s) => ({
      studentId: s.studentId,
      name: s.name,
      tasks: s.tasks.filter((t) => isOpen(t, today) && (t.assignee === "guardian" || t.assignee === "either")).sort(compareTasks),
    }))
    .filter((g) => g.tasks.length > 0);
}
