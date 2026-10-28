/**
 * Your record (specs/planner/record/README.md, steps.md): the student's one place for everything a college reads,
 * entered through the guided tour (the intake, components/planner/intake/) and reviewed on the record overview. This
 * module holds what both read: the name, the thirteen steps with their rail labels, headlines, one-line leads, and
 * folded "why" notes, the unlock line per section, the step summaries the rail and the overview share, the
 * completeness the overview and the people line show, and the tour's links.
 *
 * The draft, the save, and the profile mapping stay in ./intake.ts (build-plan.md review note 1); the per-section rule
 * is ./profile-progress.ts `sectionDone`. Pure and client-safe (no server imports).
 */
import { ADVISOR_PATH } from "./advisor.ts";
import {
  activityStepAt,
  basicsSummary,
  draftFromProfile,
  intakeNeeded,
  majorsSummary,
  recommendersSummary,
  RECORD_DONE,
  RECORD_REVIEW,
  storySummary,
  whereSummary,
  type IntakeDraft,
  type RecordEntryStep,
  type RecordStep,
} from "./intake.ts";
import { stepRailSummary } from "./activity-steps.ts";
import { sectionDone } from "./profile-progress.ts";
import type { PlanContext } from "./types.ts";
import type { StudentProfileData } from "../student-profile.ts";

export { RECORD_DONE, RECORD_REVIEW, type RecordEntryStep, type RecordStep };

/** The record's name, set once (README "The name"); a different choice is a one-line change. */
export const RECORD_LABEL = "Your record";

/**
 * The overview's and the people line's name for the record: "Your record" for the student (no name passed), "Jordan's
 * record" to a parent (the student's first name).
 */
export function recordTitle(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `${name}'s record` : RECORD_LABEL;
}

export type RecordSection = "grades" | "test" | "courses" | "sports" | "clubs" | "work" | "connections" | "other" | "major" | "basics" | "where" | "story" | "recommenders";

export interface RecordStepInfo {
  step: RecordEntryStep;
  section: RecordSection;
  /** The rail's label (and the overview row's name). */
  rail: string;
  /** The step's `<Headline lead pop tail />`. */
  headline: { lead: string; pop: string; tail?: string };
  /** The one line under the headline (less-text.md: a title and one line), under 90 characters. */
  line: string;
  /** Continue waits on it (steps 0 and 1); every other step can be skipped. */
  required: boolean;
  /** Why it matters, two or three sentences, folded behind an info icon (R4). */
  why: string;
}

/** The thirteen entry steps, in order (steps.md "The steps"). */
export const RECORD_STEPS: readonly RecordStepInfo[] = [
  {
    step: 0,
    section: "grades",
    rail: "Grades",
    headline: { lead: "Start with your", pop: "grades" },
    line: "Your class, your GPA the way your transcript shows it, and your high school.",
    required: true,
    why: "Every college's level on your list starts from your grades. Enter the GPA exactly as your transcript shows it; we work out the scale, so nothing gets converted by hand.",
  },
  {
    step: 1,
    section: "test",
    rail: "Test score",
    headline: { lead: "Your", pop: "test" },
    line: "The SAT or ACT you're taking, your best score so far, and a target if you have one.",
    required: true,
    why: "Colleges that look at scores compare yours with the students they admit. A practice score is fine for now, and a target shows which colleges it would move. Not testing is an answer too.",
  },
  {
    step: 2,
    section: "courses",
    rail: "AP courses",
    headline: { lead: "Your", pop: "AP", tail: "courses" },
    line: "Taken, taking now, or planned. Pick the year for each.",
    required: false,
    why: "Colleges read how hard your schedule is against what your school offers. Your courses feed the course choice each spring and the teachers you might ask for a letter.",
  },
  {
    step: 3,
    section: "sports",
    rail: "Sports",
    headline: { lead: "Your", pop: "sports" },
    line: "Teams you've played on in high school. Tap the years and your level each year.",
    required: false,
    why: "Colleges look for depth over a long list: a few things done for years, with growing responsibility. A sport you've stuck with since freshman year says that.",
  },
  {
    step: 4,
    section: "clubs",
    rail: "Clubs",
    headline: { lead: "Clubs and", pop: "organizations" },
    line: "School clubs, national groups like DECA or HOSA, music and theater.",
    required: false,
    why: "A title that grows from member to officer to leader is what colleges read for. Add the years and your title each year; one or two you've gone deep in beat a long list.",
  },
  {
    step: 5,
    section: "work",
    rail: "Work",
    headline: { lead: "Work and", pop: "internships" },
    line: "Jobs, internships, research, and helping your family.",
    required: false,
    why: "Colleges count work like any activity, and caring for family counts too. Hours each week show the commitment behind it.",
  },
  {
    step: 6,
    section: "connections",
    rail: "Connections",
    headline: { lead: "Any", pop: "connections", tail: "to a college?" },
    line: "A parent, grandparent, or sibling who went somewhere, or a coach recruiting you.",
    required: false,
    why: "Some colleges weigh a family connection or a coach's interest. We only use one where the college says it does, and only for that college.",
  },
  {
    step: 7,
    section: "other",
    rail: "Other",
    headline: { lead: "Anything", pop: "else?" },
    line: "Awards, volunteering, projects of your own.",
    required: false,
    why: "Awards show what you've done beyond class, and a project of your own shows initiative. Add what you have; skip what you don't.",
  },
  {
    step: 8,
    section: "major",
    rail: "Major",
    headline: { lead: "What might you", pop: "study?" },
    line: "Up to three. Undecided is fine; leave it blank.",
    required: false,
    why: "Your first choice finds colleges like your list and shows majors and earnings. Changing your mind later is normal; this only steers suggestions.",
  },
  {
    step: 9,
    section: "basics",
    rail: "Basics",
    headline: { lead: "A few", pop: "basics" },
    line: "Where you live, and two yes-or-no questions about applying.",
    required: false,
    why: "Your state sets in-state prices and the net price estimate. A fee waiver saves application fees, and first-generation students get a note where a college says it considers it.",
  },
  {
    step: 10,
    section: "where",
    rail: "Where you'd go",
    headline: { lead: "Where would you", pop: "go?" },
    line: "Size, setting, places, and type; pick any that matter.",
    required: false,
    why: "These drive Explore's Fits my preferences. The cost limit is the most your family would pay in a year, and a parent can fill it in.",
  },
  {
    step: 11,
    section: "story",
    rail: "Your story",
    headline: { lead: "Your", pop: "story" },
    line: "A few sentences in your own words: what your grades don't say.",
    required: false,
    why: "Your story feeds your essays and your recommenders' notes. Most students write it the summer before senior year. Only you see the words; a parent sees only that it's written.",
  },
  {
    step: 12,
    section: "recommenders",
    rail: "Recommenders",
    headline: { lead: "Your", pop: "recommenders" },
    line: "The teachers who might write for you, first choice first.",
    required: false,
    why: "Most colleges ask for one or two teacher letters. Pick teachers from junior year in core subjects, and ask early in senior year; most students pick them the summer before.",
  },
];

/** The steps by section. */
export const SECTION_RECORD_STEP: Readonly<Record<RecordSection, RecordEntryStep>> = Object.fromEntries(RECORD_STEPS.map((s) => [s.section, s.step])) as Record<RecordSection, RecordEntryStep>;

/**
 * What each section unlocks, the overview's line for a missing one (steps.md "How complete is this"; the built
 * `completeness()` tool list folded in). Never a score or a count: no digits (a test).
 */
export const SECTION_UNLOCK: Readonly<Record<RecordSection, string>> = {
  grades: "Add your grades: every college's level on your list reads them",
  test: "Add a score, or say you're not testing: unlocks Explore's “Fits my scores”",
  courses: "Add your AP courses: the estimate reads your courses",
  sports: "Add sports, or none: colleges read depth over a long list",
  clubs: "Add clubs: colleges read depth over a long list",
  work: "Add work, or none: colleges count it like any activity",
  connections: "Add a connection, or none",
  other: "Add awards and more, or none",
  major: "Add a major: unlocks “like your list” matches and majors and earnings",
  basics: "Add your state: unlocks the net price estimate",
  where: "Add a size or setting: unlocks Explore's “Fits my preferences”",
  story: "Not yet · most write it the summer before senior year",
  recommenders: "Not yet · most pick them the summer before senior year",
};

/**
 * One step's summary for the tour's rail and the overview's row (PlanIntake's `railSummary`, moved here):
 * "Class of 2028 · GPA 3.7", "SAT 1350", "4 courses", "2 sports", "Engineering, Computer science" / "Undecided",
 * "NC · fee waiver: not sure", "Mid-sized, suburban, Southeast", "Written" / "Not yet", "2 teachers, 1 asked". Null
 * when the step has nothing to say (Review and Done never do).
 */
export function stepSummary(draft: IntakeDraft, step: RecordStep): string | null {
  switch (step) {
    case 0: {
      const parts = [draft.classYear ? `Class of ${draft.classYear}` : null, draft.gpa.trim() ? `GPA ${draft.gpa.trim()}` : null].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case 1:
      if (draft.test === "none") return "Not testing";
      if (draft.test === "sat" || draft.test === "act") return `${draft.test.toUpperCase()}${draft.score.trim() ? ` ${draft.score.trim()}` : ""}`;
      return null;
    case 2:
      return draft.courses.length > 0 ? `${draft.courses.length} course${draft.courses.length === 1 ? "" : "s"}` : null;
    case 6:
      if (draft.connections.length > 0) return `${draft.connections.length} college${draft.connections.length === 1 ? "" : "s"}`;
      return draft.activitiesNone.connections === true ? "None" : null;
    case 8:
      return majorsSummary(draft.majors);
    case 9:
      return basicsSummary(draft);
    case 10:
      return whereSummary(draft, false);
    case 11:
      return storySummary(draft);
    case 12:
      return recommendersSummary(draft.recommenders);
    default: {
      const activity = activityStepAt(step);
      return activity ? stepRailSummary(activity, draft.activities, draft.awards, draft.activitiesNone[activity] === true) : null;
    }
  }
}

export interface RecordRow {
  section: RecordSection;
  step: RecordEntryStep;
  done: boolean;
  /** The step's summary (`stepSummary`); the overview shows `unlock` instead while the section isn't done. */
  summary: string | null;
  unlock: string;
}

export interface RecordProgress {
  done: number;
  total: number;
  rows: RecordRow[];
}

/**
 * The record's completeness (review note 7): the thirteen tour steps, each done or not by `sectionDone` (a "None"
 * answer counts), with its summary and unlock line. Pass `relation: "guardian"` for a parent's view (the story reads
 * Written / Not yet without its text either way).
 */
export function recordProgress(p: StudentProfileData | null, opts: { relation?: "self" | "guardian" } = {}): RecordProgress {
  const draft = draftFromProfile(p, p?.basics.gradYear ?? null, "", { relation: opts.relation });
  const rows = RECORD_STEPS.map(({ section, step }): RecordRow => ({
    section,
    step,
    done: p !== null && sectionDone(p, section),
    summary: stepSummary(draft, step),
    unlock: SECTION_UNLOCK[section],
  }));
  return { done: rows.filter((r) => r.done).length, total: rows.length, rows };
}

/** Whether the plan shows the tour's first run in place of the plan (the built `intakeNeeded` rule). */
export function recordNeeded(ctx: Pick<PlanContext, "profile" | "student">): boolean {
  return intakeNeeded(ctx);
}

/**
 * The tour in edit mode: `/plan?for=<person>&record=1&step=<n>&back=<plan|record>` (steps.md "Edit mode"). Without a
 * step it opens at Review; `back` says where saving and closing return to (the plan when left out).
 */
/**
 * Where saving or closing the tour returns to: the plan's tabs, the household's record page, or the record shown
 * inline on the plan page (`/plan?record=1`; owner 2026-10-16: "when you hit edit on the plan page it expands to show
 * your record").
 */
export type RecordBack = "plan" | "record" | "inline";

export function recordHref(opts: { person: string | null; step?: RecordStep | null; back?: RecordBack }): string {
  const q = new URLSearchParams();
  if (opts.person) q.set("for", opts.person);
  q.set("record", "1");
  if (opts.step != null && opts.step !== RECORD_REVIEW && opts.step !== RECORD_DONE) q.set("step", String(opts.step));
  if (opts.back) q.set("back", opts.back);
  return `${ADVISOR_PATH}?${q.toString()}`;
}

/** The record overview's address (the Numbers page's, renamed): `/household/{id}/record`. */
export function recordPageHref(studentId: string): string {
  return `/household/${encodeURIComponent(studentId)}/record`;
}
