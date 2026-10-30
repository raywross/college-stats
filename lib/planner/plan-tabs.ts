/**
 * The advisor page's tabs and links (specs/planner/redesign/page.md; build-plan.md "Tabs and routing"). Pure: which
 * tabs a view shows, which one opens first, where an old `?stage=` link lands, and the `/advisor` URL for a person
 * and tab (`/plan` until the rename, specs/product/advisor.md "1. The name"; `/plan/*` redirects). Students and parents open on Next steps (specs/planner/next-steps/seasons.md; owner, 2026-10-14); "Everyone" (a parent's view across children) is the calendar alone;
 * Offers appears once a decision is recorded. The Scores tab was dropped (owner, 2026-10-12: "a relic now that we've
 * got so many more inputs"), so an old `?tab=scores` link is unrecognized and opens the default tab.
 */

import { ADVISOR_PATH } from "./advisor.ts";

/** Essays (specs/product/essays/tab.md "The tab strip"): third, between the list and the calendar. */
export type PlanTab = "next" | "colleges" | "essays" | "calendar" | "offers";
export const PLAN_TABS: readonly PlanTab[] = ["next", "colleges", "essays", "calendar", "offers"];

export const TAB_LABELS: Record<PlanTab, string> = { next: "Next steps", colleges: "Colleges", essays: "Essays", calendar: "Calendar", offers: "Offers" };

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

/** The tabs a view shows, in order. Everyone → the calendar only; Offers only once a decision is recorded. Essays is on every plan (tab.md open question 1). */
export function tabsFor(opts: { everyone: boolean; hasDecision: boolean }): PlanTab[] {
  if (opts.everyone) return ["calendar"];
  return opts.hasDecision ? ["next", "colleges", "essays", "calendar", "offers"] : ["next", "colleges", "essays", "calendar"];
}

/** Where an old six-stage link (`?stage=N`) lands: List, Rounds, Actions, Apply → Colleges; Timeline → Calendar; Offers → Offers. */
export function tabForStage(stage: number): PlanTab {
  if (stage === 4) return "calendar";
  if (stage === 6) return "offers";
  return "colleges";
}

/**
 * "/advisor", "/advisor?for=<person>", "/advisor?for=<person>&tab=calendar" (the person is a student id). `setup` adds
 * `&setup=1`: the intake guide in edit mode (specs/planner/redesign/intake.md "Edit mode"); with `step`, opened on that
 * step (`&step=4`, the people line's next-step link). `move` (next steps) adds `&move=<task id>` on the Next steps
 * tab, so the people line's "Next:" opens the tab scrolled to that card; ignored on any other tab. `college` (a
 * unit id) on the Essays tab adds `#college-<unit id>`, so a move or a card lands on that college's card
 * (specs/product/essays/tab.md); ignored on any other tab.
 */
export function planHref(opts: { person?: string | null; tab?: PlanTab | null; setup?: boolean; step?: number | null; move?: string | null; college?: string | null }): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.tab === "next" && opts.move) q.set("move", opts.move);
  if (opts.setup) q.set("setup", "1");
  if (opts.setup && opts.step != null) q.set("step", String(opts.step));
  const s = q.toString();
  const anchor = opts.tab === "essays" && opts.college ? `#${collegeAnchor(opts.college)}` : "";
  return (s ? `${ADVISOR_PATH}?${s}` : ADVISOR_PATH) + anchor;
}

/** The id of a college's card on the Essays tab: "college-<unit id>" (the `college` anchor planHref writes). */
export function collegeAnchor(unitId: string): string {
  return `college-${unitId}`;
}

/**
 * The printed calendar (app/advisor/print/page.tsx): "/advisor/print", "/advisor/print?for=<person>", or with `each`
 * "/advisor/print?each=1" (a page per child).
 */
export function planPrintHref(opts: { person?: string | null; each?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  if (opts.each) q.set("each", "1");
  const s = q.toString();
  return s ? `${ADVISOR_PATH}/print?${s}` : `${ADVISOR_PATH}/print`;
}
