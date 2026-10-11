/**
 * The Plan page's tabs and links (specs/planner/redesign/page.md; build-plan.md "Tabs and routing"). Pure: which
 * tabs a view shows, which one opens first, where an old `?stage=` link lands, and the `/plan` URL for a person and
 * tab. Students open on Colleges, parents on the Calendar; "Everyone" (a parent's view across children) is the
 * calendar alone; Offers appears once a decision is recorded.
 */

export type PlanTab = "colleges" | "scores" | "calendar" | "offers";
export const PLAN_TABS: readonly PlanTab[] = ["colleges", "scores", "calendar", "offers"];

export const TAB_LABELS: Record<PlanTab, string> = { colleges: "Colleges", scores: "Scores", calendar: "Calendar", offers: "Offers" };

export function parseTab(v: unknown): PlanTab | null {
  return typeof v === "string" && (PLAN_TABS as readonly string[]).includes(v) ? (v as PlanTab) : null;
}

/** The tab a view opens on: a student's Colleges, a parent's Calendar; Everyone is only the calendar. */
export function defaultTab(viewer: "student" | "guardian", everyone: boolean): PlanTab {
  if (everyone) return "calendar";
  return viewer === "student" ? "colleges" : "calendar";
}

/** The tabs a view shows, in order. Everyone → the calendar only; Offers only once a decision is recorded. */
export function tabsFor(opts: { everyone: boolean; hasDecision: boolean }): PlanTab[] {
  if (opts.everyone) return ["calendar"];
  return opts.hasDecision ? ["colleges", "scores", "calendar", "offers"] : ["colleges", "scores", "calendar"];
}

/** Where an old six-stage link (`?stage=N`) lands: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers. */
export function tabForStage(stage: number): PlanTab {
  if (stage === 4) return "calendar";
  if (stage === 6) return "offers";
  return "colleges";
}

/** "/plan", "/plan?for=<person>", "/plan?for=<person>&tab=scores" (the person is a student id). */
export function planHref(opts: { person?: string | null; tab?: PlanTab | null }): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  if (opts.tab) q.set("tab", opts.tab);
  const s = q.toString();
  return s ? `/plan?${s}` : "/plan";
}
