/**
 * The redesigned Plan page's frame logic (specs/planner/redesign/page.md; build-plan.md "U2 Page frame &
 * navigation"): which child a guardian is looking at, the season in words for the header card, what Next up shows,
 * whether the header's nav dot should light up, whether a student needs the first-time setup, and where an old
 * `?stage=` link on a person's plan lands now. Pure (no server or browser APIs), so the page, the API route, and
 * tests all run the same rules.
 */
import { addDays, parseStage } from "./stage.ts";
import { planHref, tabForStage, type PlanTab } from "./plan-tabs.ts";
import type { PlanView, PlanRowView } from "./plan-view.ts";

/** A guardian's child, as far as route choice cares. */
export interface SwitchableChild {
  studentId: string;
}

/**
 * Which child a guardian's `/plan` opens on (page.md "Routes"): an explicit `?for=` that names a real child, else
 * the only child when there's just one (the switcher's Everyone pill is skipped), else null (Everyone). A guardian
 * with no children at all also gets null (nothing to switch between).
 */
export function resolveSelectedChild(opts: { forParam: string | null; children: readonly SwitchableChild[] }): string | null {
  const { forParam, children } = opts;
  if (children.length === 0) return null;
  if (forParam && children.some((c) => c.studentId === forParam)) return forParam;
  if (children.length === 1) return children[0].studentId;
  return null;
}

/**
 * Where an old six-stage person link (`/household/[person]/plan?stage=N`) lands now: `/plan?for=<personId>`, with
 * `tab` set from the stage when one was given (stage.ts tabForStage).
 */
export function personPlanRedirectHref(personId: string, stageParam: string | string[] | undefined): string {
  const raw = Array.isArray(stageParam) ? stageParam[0] : stageParam;
  const stage = parseStage(raw);
  return planHref({ person: personId, tab: stage ? tabForStage(stage) : null });
}

/** The season in words for the header card (page.md "The page"): before, during, or after the season. */
export function seasonWords(opts: { today: string; cycleStartYear: number | null; anyOpenDeadline: boolean; anyApplied: boolean }): string {
  const { today, cycleStartYear, anyOpenDeadline, anyApplied } = opts;
  if (cycleStartYear === null) return "building the list";
  const seniorFallStarts = `${cycleStartYear}-08-01`;
  if (today < seniorFallStarts) return "building the list";
  if (anyApplied && !anyOpenDeadline) return "deciding";
  return "applying this fall";
}

/** Whole days from `today` to `iso` (can be negative). */
export function daysBetween(today: string, iso: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-01" → "Nov 1". */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/**
 * The child switcher's shortened summary line (page.md "The child switcher"): parents.md's full summary
 * ("Applying · 3 of 8 in · next: Michigan, Nov 1 (ED I) · Dream: Michigan") with the college name and round
 * dropped from the next-task part and the Dream part left off entirely, so it fits a pill
 * ("Applying · 3 of 8 in · next Nov 1").
 */
export function shortSummaryLine(full: string): string {
  return full
    .split(" · ")
    .filter((part) => !part.startsWith("Dream:"))
    .map((part) => {
      const m = /^next: [^,]+, (.+?)(?: \([^)]*\))?$/.exec(part);
      return m ? `next ${m[1]}` : part;
    })
    .join(" · ");
}

export type NextUpKind = "deadline" | "decision" | "before_season" | "none";

export interface NextUpInfo {
  kind: NextUpKind;
  row: PlanRowView | null;
  /** Days to the deadline or decision; null when there's neither. */
  days: number | null;
}

/**
 * What Next up shows (page.md "The page"): the nearest deadline still to meet, else the next decision still to
 * hear, else, before the season starts, "Applications open Aug 1, YYYY", else nothing dated yet.
 */
export function nextUpInfo(opts: { view: PlanView; today: string; cycleStartYear: number | null }): NextUpInfo {
  const { view, today, cycleStartYear } = opts;
  if (view.next) {
    const isDeadline = view.next.deadline !== null && view.next.deadline.iso >= today;
    const iso = isDeadline ? view.next.deadline!.iso : view.next.decision!.iso;
    return { kind: isDeadline ? "deadline" : "decision", row: view.next, days: daysBetween(today, iso) };
  }
  const beforeSeason = cycleStartYear !== null && today < `${cycleStartYear}-08-01`;
  return { kind: beforeSeason ? "before_season" : "none", row: null, days: null };
}

/** A college whose deadline still binds: not yet submitted, not withdrawn. */
function isOpenRow(r: PlanRowView): boolean {
  return (r.item.status === "considering" || r.item.status === "applying") && !r.item.withdrawn_on;
}

/**
 * Whether the header's nav dot should light up for this student (page.md "Navigation"): a deadline still to meet
 * within `windowDays` (7 by default).
 */
export function hasDueSoon(view: PlanView, today: string, windowDays = 7): boolean {
  const limit = addDays(today, windowDays);
  return view.rows.some((r) => isOpenRow(r) && r.deadline !== null && r.deadline.iso >= today && r.deadline.iso <= limit);
}

/**
 * Whether a student needs the first-time setup in place of the tabs (standing.md "First-time setup"): no numbers
 * on file yet. (A student who skips the Dream step on purpose isn't sent back to setup every visit.)
 */
export function firstTimeNeeded(view: PlanView): boolean {
  return view.student.gpa === null && view.student.test === null;
}

export type { PlanTab };
