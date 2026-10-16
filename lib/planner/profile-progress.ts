/**
 * How much of their profile a student has entered, for the quiet progress ring on the plan's people line
 * (specs/planner/redesign/page.md "The people line"; owner, 2026-10-12: "a way for them to quickly know there's more
 * to do without overwhelming them"). A plain count of the student's own sections, nothing from the estimate (not the
 * model's completeness), plus the one most useful next step and where it's entered. Pure and client-safe.
 *
 * Your record (specs/planner/record/build-plan.md review notes 6–7): fourteen sections, each entered on one step of
 * the record's tour; ./record.ts `recordProgress` is the overview's view over the same `sectionDone`.
 */
import { stepHasEntries } from "./activity-steps.ts";
import type { RecordEntryStep } from "./intake.ts";
import { seasonRank, type Season } from "./seasons.ts";
import { hasAnyPreference, storyWritten, type StudentProfileData } from "../student-profile.ts";

/** The sections, in the order the next step is picked (the most useful missing one first). */
export type ProfileSection =
  | "high_school"
  | "grades"
  | "test"
  | "courses"
  | "sports"
  | "clubs"
  | "work"
  | "connections"
  | "other"
  | "major"
  | "basics"
  | "where"
  | "story"
  | "recommenders";
export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  "high_school",
  "grades",
  "test",
  "courses",
  "sports",
  "clubs",
  "work",
  "connections",
  "other",
  "major",
  "basics",
  "where",
  "story",
  "recommenders",
];

/**
 * The sections that wait for the summer before senior year (steps.md: "they don't need filling out until the summer
 * before senior year"): never the profile move's title, and the people line's "next" only from that season on.
 */
export const LATER_SECTIONS: readonly ProfileSection[] = ["story", "recommenders"];
/** The season the later sections open. */
export const LATER_SECTIONS_SEASON: Season = "summer_before_senior";

/** Where each section is entered: a step of the record's tour (every section has one now). */
export const SECTION_STEP: Record<ProfileSection, RecordEntryStep> = {
  high_school: 0,
  grades: 0,
  test: 1,
  courses: 2,
  sports: 3,
  clubs: 4,
  work: 5,
  connections: 6,
  other: 7,
  major: 8,
  basics: 9,
  where: 10,
  story: 11,
  recommenders: 12,
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
  major: "add a major",
  work: "add work and internships",
  connections: "add connections (or none)",
  other: "add awards and more",
  basics: "add a few basics",
  where: "add where you'd go",
  story: "write your story",
  recommenders: "add your recommenders",
};

/**
 * The profile move's own title (plan-v3-fix-cards, 2026-10-16; owner: "I'm assuming the student has more to add to
 * their plan. It should say what's needed, like 'add APs'."): one per section, title case, for the playbook's
 * `profile` entry (`moves-catalog.ts`'s `titleFor`) rather than the generic "Fill in your numbers and courses". The
 * grades title reads "Add your class standing" once the GPA is in (the same swap `profileProgress`'s `nextLabel`
 * makes) — callers apply that swap themselves; this map holds the section's base title. The story and recommenders
 * entries are never the profile move's title (`firstMissingSection` skips them: they have their own moves).
 */
export const SECTION_MOVE_TITLE: Record<ProfileSection, string> = {
  high_school: "Add your high school",
  courses: "Add your AP courses",
  grades: "Add your grades",
  test: "Add a test score or target",
  clubs: "Add your clubs",
  sports: "Add your sports",
  major: "Add a major",
  work: "Add work and internships",
  connections: "Add your connections (or none)",
  other: "Add awards and more",
  basics: "Add a few basics",
  where: "Add where you'd go",
  story: "Write your story",
  recommenders: "Pick your recommenders",
};

/**
 * The first missing section in `PROFILE_SECTIONS`' own order that the profile move names, or null once every such
 * section is done. Never story or recommenders (review note 6: they have their own moves), so the profile move closes
 * once everything else is in.
 */
export function firstMissingSection(p: StudentProfileData | null): ProfileSection | null {
  if (!p) return "high_school";
  return PROFILE_SECTIONS.find((s) => !LATER_SECTIONS.includes(s) && !sectionDone(p, s)) ?? null;
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
    case "basics":
      // The state (the built `state` section, folded in), or either yes/no question answered.
      return Boolean(p.basics.stateOfResidence) || p.basics.feeWaiverEligible !== null || a.firstGeneration !== null;
    case "where":
      return hasAnyPreference(p.preferences);
    case "story":
      // `!storyMissing` for the student's own copy; a guardian's redacted copy counts once a story exists.
      return storyWritten(p);
    case "recommenders":
      return p.recommenders.length > 0;
  }
}

/** Whether a later section (story, recommenders) can be the "next" step yet: only from the summer before senior year. */
function laterOpen(season: Season | undefined): boolean {
  return season !== undefined && season !== "unknown" && seasonRank(season) >= seasonRank(LATER_SECTIONS_SEASON);
}

/**
 * The people line's count and next step over the fourteen sections. `next` skips story and recommenders before the
 * summer before senior year (`opts.season`); without a season they're never `next` (they still count in done/total).
 */
export function profileProgress(p: StudentProfileData | null, opts: { season?: Season } = {}): ProfileProgress {
  const total = PROFILE_SECTIONS.length;
  if (!p) return { done: 0, total, next: "high_school", nextLabel: LABELS.high_school };
  const missing = PROFILE_SECTIONS.filter((s) => !sectionDone(p, s));
  const open = laterOpen(opts.season);
  const next = missing.find((s) => open || !LATER_SECTIONS.includes(s)) ?? null;
  const nextLabel = next === null ? null : next === "grades" && p.academics.gpa !== null ? "add class standing" : LABELS[next];
  return { done: total - missing.length, total, next, nextLabel };
}
