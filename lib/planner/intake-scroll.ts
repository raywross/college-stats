/**
 * Where the intake guide scrolls (owner, 2026-10-12: "when you move from step to step or if you add something like a
 * sport or activity, it should bring you back to the top of the screen"). Pure, so the rules are tested; the browser
 * side is `useIntakeScroll` in components/planner/intake/PlanIntake.tsx.
 *
 * - A step change scrolls the page to the very top and moves focus to the step's heading.
 * - Adding an entry (a sport, club, work entry, other activity, award, or AP course) scrolls the step's top, with its
 *   search box, into view, so the next add starts there. Removing or editing one doesn't scroll.
 * - Smooth unless the viewer prefers reduced motion; then instant.
 */

export interface IntakeEntries {
  activities: readonly unknown[];
  awards: readonly unknown[];
  courses: readonly unknown[];
}

/** Everything the steps add, counted together: a rise means something was just added. */
export function entryCount(d: IntakeEntries): number {
  return d.activities.length + d.awards.length + d.courses.length;
}

export type IntakeScroll = "page-top" | "step-top" | null;

/**
 * What to do after a render, given the previous and current step and entry count: the page top on a step change (it
 * wins over an add in the same render), the step's top when an entry was added, else nothing. The first render
 * (`prev` null) never scrolls, so opening the guide doesn't jump.
 */
export function intakeScrollFor(prev: { step: number; count: number } | null, next: { step: number; count: number }): IntakeScroll {
  if (prev === null) return null;
  if (prev.step !== next.step) return "page-top";
  if (next.count > prev.count) return "step-top";
  return null;
}

/** `behavior` for scrollTo/scrollIntoView. */
export function scrollBehavior(prefersReducedMotion: boolean): "smooth" | "auto" {
  return prefersReducedMotion ? "auto" : "smooth";
}
