/**
 * How much of their profile a student has entered, for the quiet progress ring on the plan's people line
 * (specs/planner/redesign/page.md "The people line"; owner, 2026-10-12: "a way for them to quickly know there's more
 * to do without overwhelming them"). A plain count of the student's own sections, nothing from the estimate (not the
 * model's completeness), plus the one most useful next step and where it's entered. Pure and client-safe.
 */
import { stepHasEntries } from "./activity-steps.ts";
import type { IntakeStep } from "./intake.ts";
import type { StudentProfileData } from "../student-profile.ts";

/** The sections, in the order the next step is picked (the most useful missing one first). */
export type ProfileSection = "high_school" | "courses" | "grades" | "test" | "clubs" | "sports" | "major" | "work" | "connections" | "other" | "state";
export const PROFILE_SECTIONS: readonly ProfileSection[] = ["high_school", "courses", "grades", "test", "clubs", "sports", "major", "work", "connections", "other", "state"];

/** Where each section is entered: an intake step, or the student's Numbers page (major and state aren't in the intake). */
export const SECTION_STEP: Record<ProfileSection, IntakeStep | "numbers"> = {
  high_school: 0,
  grades: 0,
  test: 1,
  courses: 2,
  sports: 3,
  clubs: 4,
  work: 5,
  connections: 6,
  other: 7,
  major: "numbers",
  state: "numbers",
};

export interface ProfileProgress {
  done: number;
  total: number;
  /** The most useful missing section, or null when every section is in. */
  next: ProfileSection | null;
  /** "add class standing" or "add grades" for the grades section, else the section's own words; null when complete. */
  nextLabel: string | null;
}

const LABELS: Record<ProfileSection, string> = {
  high_school: "add a high school",
  courses: "add courses",
  grades: "add grades",
  test: "add a test or target",
  clubs: "add clubs",
  sports: "add sports",
  major: "add an intended major",
  work: "add work and internships",
  connections: "add connections (or none)",
  other: "add awards and more",
  state: "add a state",
};

/**
 * The profile move's own title (plan-v3-fix-cards, 2026-10-16; owner: "I'm assuming the student has more to add to
 * their plan. It should say what's needed, like 'add APs'."): one per section, title case, for the playbook's
 * `profile` entry (`moves-catalog.ts`'s `titleFor`) rather than the generic "Fill in your numbers and courses". The
 * grades title reads "Add your class standing" once the GPA is in (the same swap `profileProgress`'s `nextLabel`
 * makes) — callers apply that swap themselves; this map holds the section's base title.
 */
export const SECTION_MOVE_TITLE: Record<ProfileSection, string> = {
  high_school: "Add your high school",
  courses: "Add your AP courses",
  grades: "Add your grades",
  test: "Add a test score or target",
  clubs: "Add your clubs",
  sports: "Add your sports",
  major: "Add an intended major",
  work: "Add work and internships",
  connections: "Add your connections (or none)",
  other: "Add awards and more",
  state: "Add your state",
};

/** The first missing section in `PROFILE_SECTIONS`' own order, or null once every section is done. */
export function firstMissingSection(p: StudentProfileData | null): ProfileSection | null {
  if (!p) return "high_school";
  return PROFILE_SECTIONS.find((s) => !sectionDone(p, s)) ?? null;
}

/** Whether one section has anything entered. */
export function sectionDone(p: StudentProfileData, s: ProfileSection): boolean {
  const a = p.academics;
  switch (s) {
    case "high_school":
      return Boolean(p.basics.highSchoolId || p.basics.highSchool?.trim());
    case "grades":
      // GPA plus class standing (any answer, including "my school doesn't rank", or a stated expectation).
      return a.gpa !== null && (a.classStanding != null || a.classRankPercentile !== null || a.rankExpectation != null);
    case "test":
      return p.tests.focus === "none" || p.tests.satTotal !== null || p.tests.actComposite !== null || p.tests.target !== null;
    case "courses":
      return a.courses.length > 0;
    // An activity step is done with an entry, or when the student answered "None" (owner, 2026-10-12); never just
    // for having seen it.
    case "sports":
    case "clubs":
    case "work":
    case "other":
      return a.activitiesNone?.[s] === true || stepHasEntries(s, a.activities ?? [], a.awards ?? []);
    case "connections":
      return a.connections.length > 0 || a.activitiesNone?.connections === true;
    case "major":
      return p.plans.intendedMajors.length > 0;
    case "state":
      return Boolean(p.basics.stateOfResidence);
  }
}

export function profileProgress(p: StudentProfileData | null): ProfileProgress {
  const total = PROFILE_SECTIONS.length;
  if (!p) return { done: 0, total, next: "high_school", nextLabel: LABELS.high_school };
  const missing = PROFILE_SECTIONS.filter((s) => !sectionDone(p, s));
  const next = missing[0] ?? null;
  const nextLabel = next === null ? null : next === "grades" && p.academics.gpa !== null ? "add class standing" : LABELS[next];
  return { done: total - missing.length, total, next, nextLabel };
}
