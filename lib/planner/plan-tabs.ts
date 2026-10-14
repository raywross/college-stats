/**
 * The Plan page's tabs and links (specs/planner/redesign/page.md; build-plan.md "Tabs and routing"). Pure: which
 * tabs a view shows, which one opens first, where an old `?stage=` link lands, and the `/plan` URL for a person and
 * tab. Students and parents open on Next steps (specs/planner/next-steps/seasons.md; owner, 2026-10-14); "Everyone" (a parent's view across children) is the calendar alone;
 * Offers appears once a decision is recorded. The Scores tab was dropped (owner, 2026-10-12: "a relic now that we've
 * got so many more inputs"), so an old `?tab=scores` link is unrecognized and opens the default tab.
 */

export type PlanTab = "next" | "colleges" | "calendar" | "offers";
export const PLAN_TABS: readonly PlanTab[] = ["next", "colleges", "calendar", "offers"];

export const TAB_LABELS: Record<PlanTab, string> = { next: "Next steps", colleges: "Colleges", calendar: "Calendar", offers: "Offers" };

export function parseTab(v: unknown): PlanTab | null {
  return typeof v === "string" && (PLAN_TABS as readonly string[]).includes(v) ? (v as PlanTab) : null;
}

/**
 * The tab a view opens on: Next steps for a student and a guardian (next steps, owner decision 2026-10-14: the default
 * on login; it was Colleges). Since the redesign's frame (decision 2026-10-11, no more Everyone) the guardian's default
 * is the student's — a guardian always lands on one child's plan now, so there's no calendar-first
 * family view to default to. `everyone` is kept for the family plan this defers to (`FamilyCalendar`'s `everyone`
 * mode): that view is still only the calendar.
 */
export function defaultTab(viewer: "student" | "guardian", everyone: boolean): PlanTab {
  if (everyone) return "calendar";
  return "next";
}

/** The tabs a view shows, in order. Everyone → the calendar only; Offers only once a decision is recorded. */
export function tabsFor(opts: { everyone: boolean; hasDecision: boolean }): PlanTab[] {
  if (opts.everyone) return ["calendar"];
  return opts.hasDecision ? ["next", "colleges", "calendar", "offers"] : ["next", "colleges", "calendar"];
}

/** Where an old six-stage link (`?stage=N`) lands: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers. */
export function tabForStage(stage: number): PlanTab {
  if (stage === 4) return "calendar";
  if (stage === 6) return "offers";
  return "colleges";
}

/**
 * "/plan", "/plan?for=<person>", "/plan?for=<person>&tab=calendar" (the person is a student id). `setup` adds
 * `&setup=1`: the intake guide in edit mode (specs/planner/redesign/intake.md "Edit mode"); with `step`, opened on that
 * step (`&step=4`, the people line's next-step link). `move` (next steps) adds `&move=<task id>` on the Next steps
 * tab, so the people line's "Next:" opens the tab scrolled to that card; ignored on any other tab.
 */
export function planHref(opts: { person?: string | null; tab?: PlanTab | null; setup?: boolean; step?: number | null; move?: string | null }): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.tab === "next" && opts.move) q.set("move", opts.move);
  if (opts.setup) q.set("setup", "1");
  if (opts.setup && opts.step != null) q.set("step", String(opts.step));
  const s = q.toString();
  return s ? `/plan?${s}` : "/plan";
}
