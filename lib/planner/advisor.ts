/**
 * The advisor's names (specs/product/advisor.md "1. The name", decided 2026-10-26): the plan became **Quad Advisor**.
 * Pure and client-safe, so the tab bar and the header import this tiny module, not the planner. Only what a person
 * reads changes; internal names (the `plan_child` cookie, `/api/plan/*`, event names, `PlanTab`, file names) keep
 * "plan". The route root is `/advisor`; `/plan` and `/plan/*` redirect to it for good (next.config.ts).
 */

/** The product, on the splash page, in the home hero line, and in emails' sign-offs. */
export const ADVISOR_NAME = "Quad Advisor";

/** The tab, the header, menus, page titles. */
export const ADVISOR_SHORT = "Advisor";

/** The route root: the page tree is `app/advisor/**`; every link is built by `planHref()` (lib/planner/plan-tabs.ts). */
export const ADVISOR_PATH = "/advisor";

/** "Your advisor" for the student (no name passed, or a blank one), "Jordan's advisor" to a parent. */
export function advisorTitle(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `${name}'s advisor` : "Your advisor";
}
