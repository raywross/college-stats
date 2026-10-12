/**
 * The Plan page's tabs and links (specs/planner/redesign/page.md; build-plan.md "Tabs and routing"). Pure: which
 * tabs a view shows, which one opens first, where an old `?stage=` link lands, and the `/plan` URL for a person and
 * tab. Students and parents open on Colleges; "Everyone" (a parent's view across children) is the calendar alone;
 * Offers appears once a decision is recorded. The Scores tab was dropped (owner, 2026-10-12: "a relic now that we've
 * got so many more inputs"), so an old `?tab=scores` link is unrecognized and opens the default tab.
 */

export type PlanTab = "colleges" | "calendar" | "offers";
export const PLAN_TABS: readonly PlanTab[] = ["colleges", "calendar", "offers"];

export const TAB_LABELS: Record<PlanTab, string> = { colleges: "Colleges", calendar: "Calendar", offers: "Offers" };

export function parseTab(v: unknown): PlanTab | null {
  return typeof v === "string" && (PLAN_TABS as readonly string[]).includes(v) ? (v as PlanTab) : null;
}

/**
 * The tab a view opens on: Colleges for a student and, since the redesign's frame (decision 2026-10-11, no more
 * Everyone), for a guardian too — a guardian always lands on one child's plan now, so there's no calendar-first
 * family view to default to. `everyone` is kept for the family plan this defers to (`FamilyCalendar`'s `everyone`
 * mode): that view is still only the calendar.
 */
export function defaultTab(viewer: "student" | "guardian", everyone: boolean): PlanTab {
  if (everyone) return "calendar";
  return "colleges";
}

/** The tabs a view shows, in order. Everyone → the calendar only; Offers only once a decision is recorded. */
export function tabsFor(opts: { everyone: boolean; hasDecision: boolean }): PlanTab[] {
  if (opts.everyone) return ["calendar"];
  return opts.hasDecision ? ["colleges", "calendar", "offers"] : ["colleges", "calendar"];
}

/** Where an old six-stage link (`?stage=N`) lands: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers. */
export function tabForStage(stage: number): PlanTab {
  if (stage === 4) return "calendar";
  if (stage === 6) return "offers";
  return "colleges";
}

/**
 * "/plan", "/plan?for=<person>", "/plan?for=<person>&tab=calendar" (the person is a student id). `setup` adds
 * `&setup=1`: the intake guide in edit mode (specs/planner/redesign/intake.md "Edit mode").
 */
export function planHref(opts: { person?: string | null; tab?: PlanTab | null; setup?: boolean }): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.setup) q.set("setup", "1");
  const s = q.toString();
  return s ? `/plan?${s}` : "/plan";
}
