/**
 * The Reach your score guide, pure logic (specs/planner/v3/guides/test-prep.md; build-plan.md "U5 Reach your score
 * guide"). Restores the useful parts of the deleted Scores tab (`git show c2866a9d^:lib/planner/scores.ts`): which
 * upcoming test dates to show, whether a date's scores would arrive in time for the rounds still open on the list,
 * and the standing line ("In or above the middle 50% at 5 of 8 colleges"). No I/O; tested directly
 * (tests/planner-test-guide.test.mts).
 *
 * `TestKind` is reused from lib/chances/baseline.ts (via lib/planner/standing.ts) rather than redeclared here, so the
 * guide and the rest of the planner share one type.
 */
import { positionIn, readScore, type Position } from "../chances/baseline.ts";
import type { Cycle, CycleEntry } from "./cycle.ts";
import type { InterestActRow } from "./interest-acts.ts";
import type { Season } from "./seasons.ts";
import type { StandingSchool, TestKind } from "./standing.ts";
import type { StudentProfileData } from "../student-profile.ts";

export type { TestKind };

/** Days from a test date to scores a college can use (test-prep.md "Upcoming dates"); both tests, in practice. */
export const SCORE_LAG = 14;

/** Seasons where the application season has effectively started: a senior sees only dates that can still help. */
const SENIOR_SEASONS: ReadonlySet<Season> = new Set(["senior_fall", "senior_winter", "senior_spring"]);

/** Most dates a senior sees at once. */
const SENIOR_MAX = 3;
/** Dates everyone else sees: the next few, whether or not they'd help a current deadline yet. */
const JUNIOR_MAX = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 7" from a yyyy-mm-dd. */
export function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** Whole days from one yyyy-mm-dd to another (can be negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "Register by Oct 23", "Registration closed; late registration may be open", or "Registration not open yet". */
export function registerByText(registerBy: string | null, today: string): string {
  if (!registerBy) return "Registration not open yet";
  return registerBy < today ? "Registration closed; late registration may be open" : `Register by ${dayLabel(registerBy)}`;
}

/** One college's deadline, for `inTimeText` and `datesFor`'s senior cutoff: the round label is already formatted ("ED I"). */
export interface ListDeadline {
  name: string;
  round: string;
  iso: string;
}

/**
 * Whether a test date's scores would arrive in time for the deadlines still on the list (test-prep.md "Upcoming
 * dates"), restored from the deleted scores.ts: every college in time, some, or none. Empty string with no colleges
 * to check (no deadlines given).
 */
export function inTimeText(dateIso: string, deadlines: readonly ListDeadline[]): string {
  if (deadlines.length === 0) return "";
  const ready = addDays(dateIso, SCORE_LAG);
  const late = deadlines.filter((d) => d.iso < ready);
  if (late.length === 0) return "in time for every college on your list";
  const inTime = deadlines.filter((d) => d.iso >= ready);
  if (inTime.length === 0) return "scores arrive after these deadlines";
  const name = (d: ListDeadline) => `${d.name} ${d.round}`;
  return `too late for ${late.map(name).join(", ")}; in time for ${inTime.map(name).join(", ")}`;
}

export interface TestDateEntry {
  key: string;
  date: string;
  registerBy: string | null;
  /** A date the testing agency has published without a registration window yet (no `register_by` in the cycle file). */
  projected: boolean;
  inTime: string;
  official: string;
}

/**
 * The upcoming dates for the student's own test (test-prep.md "Upcoming dates"): from the cycle's `sat_*`/`act_*`
 * entries, keyed `sat_YYYY_MM` or `act_YYYY_MM`. Juniors (and earlier) see the next four dates, whether or not a
 * deadline needs them yet; a senior (the application season has started) sees only dates whose scores would reach at
 * least one deadline still on the list.
 */
export function datesFor(test: TestKind, cycle: Cycle, season: Season, today: string, listDeadlines: readonly ListDeadline[]): TestDateEntry[] {
  const upcoming = cycle.entries
    .filter((e): e is CycleEntry & { date: string } => e.key.startsWith(`${test}_`) && typeof e.date === "string" && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const picked = SENIOR_SEASONS.has(season)
    ? (() => {
        const last = listDeadlines.reduce<string | null>((m, d) => (!m || d.iso > m ? d.iso : m), null);
        if (!last) return [];
        return upcoming.filter((e) => addDays(e.date, SCORE_LAG) <= last).slice(0, SENIOR_MAX);
      })()
    : upcoming.slice(0, JUNIOR_MAX);
  return picked.map((e) => ({
    key: e.key,
    date: e.date,
    registerBy: e.register_by ?? null,
    projected: e.register_by === undefined,
    inTime: inTimeText(e.date, listDeadlines),
    official: e.source,
  }));
}

/* ------------------------------------------------------------------ */
/* Where it stands                                                     */
/* ------------------------------------------------------------------ */

/**
 * A score read against one college's range, with the plotted value (lib/chances/baseline.ts `readScore` only
 * returns the metadata the estimate keeps; the guide's RangeBar also needs the value itself, concorded onto the
 * range's own scale when the college only publishes the other test — same rule, re-run here for the chart).
 */
export interface StandingRead {
  value: number;
  kind: TestKind;
  range: [number, number];
  position: Position;
  concorded: boolean;
}

/** `score` read against `school`'s ranges (null without a score, or without a range either test can use). */
export function scoreAt(score: number | null, test: TestKind, school: Pick<StandingSchool, "sat" | "act">): StandingRead | null {
  if (score === null) return null;
  const read = readScore({ kind: test, score }, school);
  if (!read) return null;
  return { value: read.score, kind: read.kind, range: read.range, concorded: read.concorded, position: positionIn(read.score, read.range) };
}

/** One college for the standing line: its read at the student's own score, at the target (when there is one), and whether it's test-blind. */
export interface StandingRow {
  score: StandingRead | null;
  target: StandingRead | null;
  blind: boolean;
}

/**
 * "In or above the middle 50% at 5 of 8 colleges. A 1400 would be in or above it at 7." (test-prep.md "Where it
 * stands"): built from each row's own read at the student's score and a second read at the target. Test-blind
 * colleges and ones with no published range for either test are left out of both counts (they say so on their own
 * row instead). Empty string when nothing can be counted. The second sentence shows only when the target would
 * actually change the count — never a page that quietly repeats the same number twice.
 */
export function standingCounts(rows: readonly StandingRow[], target: number | null): string {
  const scored = rows.filter((r) => !r.blind && r.score !== null);
  if (scored.length === 0) return "";
  const inOrAbove = scored.filter((r) => r.score!.position !== "below").length;
  let text = `In or above the middle 50% at ${inOrAbove} of ${scored.length} colleges.`;
  if (target !== null) {
    const targetScored = rows.filter((r) => !r.blind && r.target !== null);
    if (targetScored.length > 0) {
      const atTarget = targetScored.filter((r) => r.target!.position !== "below").length;
      if (atTarget !== inOrAbove || targetScored.length !== scored.length) text += ` A ${target} would be in or above it at ${atTarget}.`;
    }
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Study                                                                */
/* ------------------------------------------------------------------ */

export interface StudyResource {
  label: string;
  href: string;
}

/** The study list (test-prep.md "Study"): official, free resources for the student's focus test only. */
export function resourcesFor(test: TestKind): { resources: StudyResource[]; cadence: string } {
  const resources: Record<TestKind, StudyResource[]> = {
    sat: [
      { label: "Bluebook practice tests (College Board)", href: "https://satsuite.collegeboard.org/digital/bluebook" },
      { label: "Khan Academy Official SAT Practice", href: "https://www.khanacademy.org/sat" },
    ],
    act: [
      { label: "ACT's free practice tests", href: "https://www.act.org/content/act/en/products-and-services/the-act/test-prep/free-act-test-prep.html" },
      { label: "ACT's official prep guide", href: "https://www.act.org/content/act/en/products-and-services/the-act/test-prep.html" },
    ],
  };
  return {
    resources: resources[test],
    cadence: "A plan of a few hours a week for six to eight weeks is the usual advice before a retake.",
  };
}

/* ------------------------------------------------------------------ */
/* Planned and registered                                              */
/* ------------------------------------------------------------------ */

/** Whether a test date is registered, planned (not yet registered), or neither, from the profile's own records. */
export function plannedState(profile: Pick<StudentProfileData, "tests"> | null, key: string): "planned" | "registered" | null {
  if (!profile) return null;
  if (profile.tests.registeredDates.includes(key)) return "registered";
  if (profile.tests.plannedDates.includes(key)) return "planned";
  return null;
}

/** What the test guide's server `load` sends down (lib/planner/guides-server.ts "test" entry); kept here, pure, so TestGuide.tsx (a client component) never imports the server-only guides-server.ts just for this type. */
export interface TestGuideData {
  dates: TestDateEntry[];
  standing: StandingRow[];
  pending: InterestActRow[];
}
