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
  /** The ISO date of the soonest open deadline on this child's list, or null when there isn't one. */
  nextDeadline?: string | null;
}

/**
 * Which child a guardian's `/plan` opens on (page.md "Routes", decision 2026-10-11: no Everyone — a guardian
 * always lands on one child): an explicit `?for=` that names a real child (a legacy `?for=everyone` doesn't match
 * any child, so it falls through), else the last one viewed (the `plan_child` cookie the switcher sets), else the
 * child with the soonest open deadline, else the first child on the roster. A guardian with no children at all gets
 * null (nothing to show).
 */
export function resolveSelectedChild(opts: { forParam: string | null; children: readonly SwitchableChild[]; lastViewed?: string | null }): string | null {
  const { forParam, children, lastViewed } = opts;
  if (children.length === 0) return null;
  if (forParam && children.some((c) => c.studentId === forParam)) return forParam;
  if (lastViewed && children.some((c) => c.studentId === lastViewed)) return lastViewed;
  const withDeadline = children.filter((c): c is SwitchableChild & { nextDeadline: string } => typeof c.nextDeadline === "string");
  if (withDeadline.length > 0) {
    return withDeadline.sort((a, b) => a.nextDeadline.localeCompare(b.nextDeadline))[0].studentId;
  }
  return children[0].studentId;
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-15" → "Thu, Oct 15" (page.md "Next up"). */
export function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${dayLabel(iso)}`;
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

/**
 * The initials on a student's circle in the plan's top line (page.md "The people line", owner 2026-10-12): the first
 * letters of the first and last words ("Alex QA" → "AQ", "Maya Ross" → "MR"), one letter for a single name, "?" for
 * none. Letters only, upper-cased.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letter = (w: string | undefined) => (w ? (w.match(/\p{L}|\p{N}/u)?.[0] ?? "") : "");
  const out = words.length > 1 ? letter(words[0]) + letter(words[words.length - 1]) : letter(words[0]);
  return out ? out.toUpperCase() : "?";
}

/**
 * The numbers on the expanded chip, as the student entered them ("GPA 99.2/100 · ACT 23", "GPA 3.82 · Not
 * testing", "No numbers yet"). `enteredGpa` is `gpaAsEntered` (lib/student-profile.ts), else the plan's unweighted
 * GPA is shown to two places; `test` is "SAT 1390" or null.
 */
export function numbersLine(enteredGpa: string | null, gpa: number | null, test: string | null): string {
  const gpaText = enteredGpa ?? (gpa !== null ? gpa.toFixed(2) : null);
  if (!gpaText && !test) return "No numbers yet";
  return `${gpaText ? `GPA ${gpaText}` : "No GPA yet"} · ${test ?? "Not testing"}`;
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
 * Every row sharing Next up's exact date and round (page.md "Next up"): the ink card joins their names ("Georgia
 * and South Carolina") instead of showing one deadline at a time when two colleges happen to share it.
 */
export function nextUpGroup(view: PlanView, info: NextUpInfo): PlanRowView[] {
  const row = info.row;
  if (!row) return [];
  if (info.kind === "deadline" && row.deadline) {
    const iso = row.deadline.iso;
    return view.rows.filter((r) => isOpenRow(r) && r.deadline?.iso === iso && r.round === row.round);
  }
  if (info.kind === "decision" && row.decision) {
    const iso = row.decision.iso;
    return view.rows.filter((r) => r.item.status === "applied" && r.decision?.iso === iso);
  }
  return [row];
}

/** "Georgia" | "Georgia and South Carolina" | "Georgia, South Carolina, and Clemson". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "A college";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
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
