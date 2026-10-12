import "server-only";
/**
 * Quad's estimate: the method's third version (specs/chances/method/standing.md; rigor-reading.md, major-effects.md)
 * behind the estimate's contract. Server-only and proprietary: nothing here reaches a client bundle, an API response,
 * or a sentence (specs/chances/README.md "Quad's estimate is proprietary"). The site sees only the `EstimateResult`:
 * the level, the label, the kinds of input used or missing, cited facts, catalog notes (lib/chances/notes.ts), the
 * move-up, `closeness` (which quarter of its level the college sits in) and the ED verdict.
 *
 * Three stages. Stage 1, how far in the pool: each measure the college says it weighs (CDS C7, else the federal
 * factors) becomes a distance `d` on the college's own range (0 at its 25th percentile, 1 at its 75th), combined so
 * the weakest measure carries most of the weight; the test checks the rest for consistency rather than joining it,
 * and inputs the college weighs that the student hasn't entered draw the distance down (Revision 1, method/standing.md
 * "Revision 1: consistency and completeness"). Stage 2, the pool's odds: the student's own base rate
 * (lib/chances/pool-rate.ts) times the academic multiplier and, where the college's C7 says it weighs them, depth,
 * work, legacy, interest, and a coach's contact. Stage 3, the level: the hidden odds against five cutoffs, capped by
 * the college's selectivity tier for the student's pool (lib/selectivity-tier.ts), floored by the college's own
 * guarantees and a recruited athlete's support. The hidden odds are an ordering device only: they leave this module
 * as `closeness` (a quarter, 0–3) and, binned, in the outcome snapshot's measurement columns; never anywhere else.
 */
import type { School } from "../types.ts";
import { edRate, sameDocumentRate } from "../cds/admissions.ts";
import { pct } from "../format.ts";
import { bandColumn, GPA_BAND_EDGES } from "../planner/gpa-model.ts";
import { tierForStudent } from "../selectivity-tier.ts";
import { stateName } from "../states.ts";
import { courseMark, emptyCoreAtTopLevel, isAdvancedKind, markPoints, type CoreAtTopLevel } from "../student-profile.ts";
import {
  gpaStanding,
  isOptionalPolicy,
  isRequiredPolicy,
  readScore,
  scoreField,
  scoreStanding,
  standingStudentOf,
  STANDING,
  TEST_LABEL,
  TEST_MAX,
  TEST_STEP,
  type Position,
  type ScoreRead,
  type SendAdvice,
  type StandingSchool,
  type StandingStudent,
} from "./baseline.ts";
import { activitiesReading, courseThemes, courseTracks, depthSnapshot, type ActivitiesResult, type CourseTracks, type ThemesResult } from "./depth.ts";
import { interestMultiplier, legacyMultiplier, recruitedFloor, recruitMultiplier, type LegacyReading } from "./hooks.ts";
import { NO_HOOKS, STANDING_LEVEL_LABELS } from "./levels.ts";
import { majorMatters, majorReviewFor, type MajorReviewReading } from "./major-review.ts";
import { INPUT_WORDS, noteText } from "./notes.ts";
import { poolRateFor, POOL_FIELDS, type PoolReading } from "./pool-rate.ts";
import { gpaTopShare, isWeightedReporter } from "./reading.ts";
import { rigorReading, type RigorResult } from "./rigor.ts";
import type {
  CollegeHooks,
  CourseEntry,
  EstimateNote,
  EstimatePool,
  EstimateResult,
  EstimateStudent,
  InputKind,
  RigorReading,
  SchoolOffering,
  SelectivityPool,
  SelectivityTier,
  StandingLabel,
  StandingLevel,
} from "./types.ts";
import type { AblationInput, SnapshotDetail } from "./snapshot.ts";

/** Recorded with every result and every outcome snapshot (specs/chances/estimate.md "Changing the method"). */
export const MODEL_VERSION = "20261012.4";

/**
 * The second version's reading constants that the third keeps: GPA crowding, which colleges' class-rank tiers count,
 * the rank sentence's words, and the major's subject grades (method/standing.md "Which measures count").
 */
export const STANDING_V2 = {
  ...STANDING,
  /** `derived.gpa_top_share` at or above this: GPAs are crowded and a GPA at or above the 25th only meets the bar. */
  crowdedShare: 0.5,
  /** C10's share of first-years with a reported rank needed before the rank counts. */
  rankSubmittedMin: 0.15,
  /** Share of ranked first-years at the student's rank or higher: at or under this the sentence says "higher than most"; at or over `rankBelow`, "lower". */
  rankAbove: 0.25,
  rankBelow: 0.75,
  /** A subject GPA at least (overall − subjectIn) is "in"; more than `subjectBelow` under is "below". */
  subjectIn: 0.1,
  subjectBelow: 0.3,
} as const;

/** Rigor can raise a crowded GPA slot but never lower it until a season measurement says so (method/standing.md). */
export const RIGOR_CAN_LOWER = false;

/**
 * The third version's numbers (method/standing.md Stages 1–3). They change only with a season measurement
 * (method/outcomes.md); the tests pin the examples they produce.
 */
export const ODDS_V3 = {
  /** `M_acad(d)`: piecewise linear between these points; the ends hold beyond them. */
  acad: [
    [-1.5, 0.08],
    [-1, 0.15],
    [-0.5, 0.4],
    [0, 0.75],
    [0.5, 1.1],
    [1, 1.6],
    [1.5, 2.2],
    [2, 2.5],
  ] as readonly (readonly [number, number])[],
  /** Each measure's distance is clamped to this. */
  dMin: -2,
  dMax: 2.5,
  /** `d = weakest × min + (1 − weakest) × mean`. */
  weakest: 0.6,
  /** A measure known only as a position. */
  position: { above: 1.25, in: 0.5, below: -0.5 } as Record<Position, number>,
  /** The summary the sentences use: `d ≥ above` → above, `d < 0` → below. */
  summaryAbove: 1,
  /** Hidden odds at or above each value reach that level (High reach below `reach`). */
  cutoffs: { reach: 0.05, target: 0.25, likely: 0.55, safe: 0.8 },
  maxOdds: 0.97,
  /** Safe needs the pool's rate at least this (or open admission, or a guarantee). */
  safeRateMin: 0.5,
  /** `M_depth`: the activities reading, or the best recognition tier, whichever is larger. */
  depth: { focused: 1.3, building: 1.1, sampling: 1 } as Record<string, number>,
  recognition: { 1: 1.8, 2: 1.25 } as Record<number, number>,
  /** `M_work`: hours a week in the school year, largest first. */
  work: [
    [20, 1.2],
    [10, 1.1],
  ] as readonly (readonly [number, number])[],
  /** `M_ed = 1 + share × (edRate / overallRate − 1)`, between 1 and `max`; for the ED sentence only. */
  ed: { share: 0.5, max: 2 },
  /**
   * Revision 1 (2026-10-12), the test as a consistency check: where the test is counted beside other measures,
   * `d = d_core + clamp(testPull × (d_test − d_core), −testDown, +testUp)`, so a test in line with the record confirms
   * it and one out of line moves it a little, never past the record.
   */
  testPull: 0.25,
  testDown: 0.3,
  testUp: 0.2,
  /**
   * Revision 1, completeness: each input the college weighs carries this weight; `completeness = present ÷ expected`
   * and `d_eff = min(d, completeness × d + (1 − completeness) × gapPrior)` (an unknown reads as below the middle;
   * a gap never raises a record already below it).
   */
  expectWeights: { gpa: 3, courses: 2, class_rank: 1, test: 1, activities: 1 } as Record<CompletenessKind, number>,
  gapPrior: -0.5,
  /**
   * Revision 2 (2026-10-12), rank nudges where the college weighs class rank or GPA: the highest that applies, never
   * stacked. A valedictorian or salutatorian expectation is stated, not known.
   */
  rankNudge: { top5: 1.05, top1: 1.08, salutatorian: 1.1, valedictorian: 1.15 } as Record<RankNudgeKind, number>,
  /** Revision 2, weighted over unweighted (4- or 5-point scales): the gap at least each value, largest first. */
  weightedGap: [
    [0.6, 1.08],
    [0.3, 1.04],
  ] as readonly (readonly [number, number])[],
  /** The same on a 100-point scale: weighting adds about ten points a course where a 4-point scale adds one. */
  weightedGap100: [
    [6, 1.08],
    [3, 1.04],
  ] as readonly (readonly [number, number])[],
  /** A weighted GPA above this on a 4- or 5-point scale isn't on that scale (a typo or another scale): unread. */
  weightedMaxPoints: 6,
  /** Revision 2, `M_theme`: one theme (a course track and an activity in the same family), two or more. */
  theme: { one: 1.1, two: 1.18 },
  /** Revision 2, Ultra selective: advanced courses at least this many, in every year from the first through now. */
  ultraAdvancedCount: 3,
  /** Revision 2, Ultra selective: the advanced courses' unweighted average at least this. */
  ultraAdvancedGpa: 3.7,
  /**
   * Revision 3 (2026-10-12), rule 1: "APs are graded on a scale of 1 to 5." A completed course's exam score read as a
   * grade on the 4-point scale for the advanced-course grades signal (the better of it and the letter grade).
   */
  examPoints: {
    ap: { 5: 4, 4: 3.7, 3: 3, 2: 2, 1: 1 },
    ib: { 7: 4, 6: 3.7, 5: 3.3, 4: 3, 3: 2, 2: 1, 1: 1 },
  } as { ap: Record<number, number>; ib: Record<number, number> },
  /** Revision 3, rule 4: advanced courses can't be taken before 10th grade, so no advanced-course check reads 9th. */
  firstAdvancedYear: 10,
  /** Revision 3, rules 3 and 4: junior year ends on this day (month-day) of the year before graduation. */
  juniorYearEnds: "06-30",
} as const;

/** Which rank nudge applies (Revision 2). */
type RankNudgeKind = "top5" | "top1" | "salutatorian" | "valedictorian";

/**
 * The top of each 100-point band the profile's conversion reads (lib/student-profile.ts gpaFrom100): the student's
 * unweighted 100-point GPA, read back from its 4-point conversion at the top of its band, so the weighted gap is
 * never overstated.
 */
const HUNDRED_BAND_TOP: readonly (readonly [number, number])[] = [
  [4.0, 100],
  [3.7, 96],
  [3.3, 92],
  [3.0, 89],
  [2.7, 86],
  [2.3, 82],
  [2.0, 79],
  [1.7, 76],
  [1.3, 72],
  [1.0, 69],
  [0.7, 66],
  [0, 64],
];

/** The inputs a college can expect (Revision 1, completeness). */
type CompletenessKind = "gpa" | "courses" | "class_rank" | "test" | "activities";
const COMPLETENESS_KINDS: readonly CompletenessKind[] = ["gpa", "courses", "class_rank", "test", "activities"];

/** What the model reads beyond the student and the college (built once per request by lib/chances/estimate.ts). */
export interface ModelInput {
  student: EstimateStudent;
  school: School;
  /** The baseline's slice of the college (scores, GPA with the fitted model, policy, admit rate). */
  standing: StandingSchool;
  /** The student's high school's offering, or null when unknown. */
  offering: SchoolOffering | null;
  /** Whether the student linked a high school (only words the can't-place sentence). */
  linked?: boolean;
  /** The overall admit rate's year when the college has no lineage record for it. */
  overallYear?: string | null;
  /** The profile's core-subject answers, when the caller has them (the rigor reading and the course tracks read them). */
  coreAtTopLevel?: CoreAtTopLevel | null;
  /** The student's grade now (9–12). */
  grade?: number | null;
  /** The list row's legacy, recruited, and interest inputs for this college; absent reads as NO_HOOKS. */
  hooks?: CollegeHooks | null;
  /**
   * Revision 3, rule 7: the student's high school's state (USPS), used when the student hasn't entered a state of
   * residence (lib/chances/estimate.ts reads it from the high school record, else a public id's FIPS prefix).
   */
  schoolState?: string | null;
  /** The day the estimate is made (YYYY-MM-DD; today when absent): whether junior year is over (rules 3 and 4). */
  asOf?: string | null;
}

/** What Revision 3 read differently from what the student entered (for its sentences and the snapshot). */
interface OwnerReading {
  /** The high school's state, used because the student entered none (rule 7). */
  stateFromSchool: string | null;
  /** The target test score read in place of the actual one until junior year ends (rule 3). */
  target: { kind: "sat" | "act"; score: number } | null;
  /** The actual score the target stands in for (same test), or null when the student has none. */
  actual: number | null;
  /** Junior year isn't over yet (null when neither a graduation year nor a grade says). */
  juniorOpen: boolean | null;
}

/**
 * Revision 3, rules 3 and 4: whether the student is still before the end of junior year: by graduation year when
 * known (through June 30 of the year before it), else by grade (11 or under); null when neither is known.
 */
export function juniorYearOpen(gradYear: number | null | undefined, grade: number | null | undefined, asOf: string): boolean | null {
  if (typeof gradYear === "number" && Number.isInteger(gradYear)) return asOf <= `${gradYear - 1}-${ODDS_V3.juniorYearEnds}`;
  if (typeof grade === "number") return grade <= 11;
  return null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The student as Revision 3 reads them (owner, 2026-10-12): the target test score in place of a lower or missing
 * actual one until junior year ends (rule 3), "My school doesn't rank" as unanswered (rule 5: the pick is the
 * student's perceived standing, a proxy like weighted GPA), and the high school's state where the student entered none
 * (rule 7). Everything downstream reads this student.
 */
function ownerReading(input: ModelInput): { input: ModelInput; reading: OwnerReading } {
  const s = input.student;
  const juniorOpen = juniorYearOpen(s.gradYear ?? null, input.grade ?? null, input.asOf ?? todayIso());
  let test = s.test;
  let target: OwnerReading["target"] = null;
  const t = s.testTarget ?? null;
  if (juniorOpen === true && t && (!test || (test.kind === t.kind && t.score > test.score))) {
    test = { kind: t.kind, score: t.score };
    target = test;
  }
  const school = input.schoolState && /^[A-Z]{2}$/.test(input.schoolState) ? input.schoolState : null;
  const stateFromSchool = !s.state && school ? school : null;
  const student: EstimateStudent = {
    ...s,
    test,
    state: s.state ?? stateFromSchool,
    classStanding: s.classStanding === "no_rank" ? null : (s.classStanding ?? null),
  };
  const actual = target && s.test && s.test.kind === target.kind ? s.test.score : null;
  return { input: { ...input, student }, reading: { stateFromSchool, target, actual, juniorOpen } };
}

/** Rule 1: a completed advanced course's exam score as a 4-point grade (AP 1–5, IB 1–7), or null without one. */
function examGradePoints(c: CourseEntry): number | null {
  if (c.exam === null || c.exam === undefined) return null;
  const table = c.kind === "ap" ? ODDS_V3.examPoints.ap : c.kind === "ib_hl" || c.kind === "ib_sl" ? ODDS_V3.examPoints.ib : null;
  return table ? (table[c.exam] ?? null) : null;
}

/** Rule 1: a completed advanced course's grade: the better of its letter grade and its exam score's reading. */
function completedGradePoints(c: CourseEntry): number | null {
  const letter = markPoints(courseMark(c));
  const exam = examGradePoints(c);
  if (letter === null) return exam;
  if (exam === null) return letter;
  return Math.max(letter, exam);
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Rule 1, the advanced-course grades signal at an Ultra selective college: completed courses read by the better of
 * the letter grade and the exam score; a course in progress has no grade yet and never counts against the student
 * (its semester grades are read only where they raise the average); with nothing completed, the signal passes.
 * `ungraded`: a completed course has neither a letter grade nor an exam score, and nothing else meets the bar.
 */
function advancedGrades(courses: readonly CourseEntry[]): { pass: boolean; ungraded: boolean } {
  const adv = courses.filter((c) => isAdvancedKind(c.kind));
  const taken = adv.filter((c) => c.status === "taken");
  const done = taken.map(completedGradePoints).filter((p): p is number => p !== null);
  const now = adv
    .filter((c) => c.status === "in_progress")
    .map((c) => markPoints(courseMark(c)))
    .filter((p): p is number => p !== null);
  const bar = ODDS_V3.ultraAdvancedGpa - 1e-9;
  if (done.length > 0) return { pass: Math.max(mean(done), now.length > 0 ? mean([...done, ...now]) : 0) >= bar, ungraded: false };
  if (now.length > 0 && mean(now) >= bar) return { pass: true, ungraded: false };
  if (taken.length > 0) return { pass: false, ungraded: true };
  return { pass: true, ungraded: false };
}

/** Switches for the season measurements (method/outcomes.md "Each new input separately"). */
type Without = Partial<Record<AblationInput, boolean>>;

type FactorSource = "c7" | "federal" | null;
type Importance = "very_important" | "important" | "considered" | "not_considered";

/** Whether the college says it weighs a kind of evidence, and where it says so (the fact to cite). */
interface Weighs {
  counts: boolean;
  source: FactorSource;
}

const C7_AT_LEAST_CONSIDERED = new Set(["very_important", "important", "considered"]);
const C7_AT_LEAST_IMPORTANT = new Set(["very_important", "important"]);
const IMPORTANCE_RANK: Record<Importance, number> = { not_considered: 0, considered: 1, important: 2, very_important: 3 };
const IMPORTANCE_WORDS: Record<Importance, string> = { very_important: "very important", important: "important", considered: "considered", not_considered: "not considered" };
const LEVEL_RANK: Record<StandingLevel, number> = { high_reach: 0, reach: 1, target: 2, likely: 3, safe: 4 };

function c7(school: School) {
  return school.reported?.admission_profile?.factors ?? null;
}
const factorPath = (key: string) => `reported.admission_profile.factors.${key}`;

/** GPA counts where C7 rates it at least considered, else where IPEDS requires or considers it; with neither on record, as in the baseline. */
function weighsGpa(school: School): Weighs {
  const v = c7(school)?.gpa;
  if (v) return { counts: C7_AT_LEAST_CONSIDERED.has(v), source: "c7" };
  const f = school.admissions?.factors?.gpa;
  if (f) return { counts: f === "required" || f === "considered", source: "federal" };
  return { counts: true, source: null };
}

/** Rigor counts where C7 rates it at least important, else where IPEDS requires the high school record. */
function weighsRigor(school: School): Weighs {
  const v = c7(school)?.rigor;
  if (v) return { counts: C7_AT_LEAST_IMPORTANT.has(v), source: "c7" };
  const f = school.admissions?.factors?.hs_record;
  if (f) return { counts: f === "required", source: "federal" };
  return { counts: false, source: null };
}

/** Class rank counts only where C7 rates it at least considered. */
function weighsRank(school: School): Weighs {
  const v = c7(school)?.class_rank;
  return v ? { counts: C7_AT_LEAST_CONSIDERED.has(v), source: "c7" } : { counts: false, source: null };
}

/** A test-optional college whose C7 says tests aren't considered doesn't use the score. */
function testsUnweighed(school: School, standing: StandingSchool): boolean {
  return isOptionalPolicy(standing.testPolicy) && c7(school)?.test_scores === "not_considered";
}

const factorFact = (w: Weighs, key: "gpa" | "rigor" | "class_rank" | "test_scores"): string | null => (w.source === "c7" ? factorPath(key) : w.source === "federal" ? "admissions.factors" : null);

/**
 * Share of ranked first-years at the student's rank or higher, from C10's cumulative tiers (top tenth, quarter, half)
 * with an even spread inside each tier. `topPct` is the student's "top X%". Null without a tier to read.
 */
export function rankShareAtOrAbove(topPct: number, cr: { top_tenth: number | null; top_quarter: number | null; top_half: number | null }): number | null {
  const points: [number, number][] = [[0, 0]];
  for (const [at, share] of [
    [10, cr.top_tenth],
    [25, cr.top_quarter],
    [50, cr.top_half],
  ] as const) {
    if (share === null || share === undefined) continue;
    const prev = points[points.length - 1][1];
    points.push([at, Math.min(1, Math.max(prev, share))]);
  }
  if (points.length === 1) return null;
  points.push([100, 1]);
  const p = Math.min(100, Math.max(0, topPct));
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (p <= x1) return y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* Stage 1: distances                                                  */
/* ------------------------------------------------------------------ */

const clampD = (d: number) => Math.min(ODDS_V3.dMax, Math.max(ODDS_V3.dMin, d));

/** `(x − p25) / (p75 − p25)`, clamped; null when the range has no width. */
function rangeDistance(x: number, p25: number, p75: number): number | null {
  return p75 > p25 ? clampD((x - p25) / (p75 - p25)) : null;
}

/**
 * The share of first-years whose GPA is below `gpa`, from a C11 column (top band first, GPA_BAND_EDGES), with an even
 * spread inside the student's band; the 4.0 band is a point, half of it counted below a 4.0.
 */
export function shareBelowGpa(shares: readonly (number | null)[], gpa: number): number | null {
  const total = shares.reduce<number>((a, b) => a + (b ?? 0), 0);
  if (!(total > 0)) return null;
  let below = 0;
  for (let i = 0; i < GPA_BAND_EDGES.length; i++) {
    const share = shares[i] ?? 0;
    const [lo, hi] = GPA_BAND_EDGES[i];
    if (lo === hi) below += gpa >= hi - 1e-9 ? share / 2 : 0;
    else if (gpa >= hi - 1e-9) below += share;
    else if (gpa > lo) below += (share * (gpa - lo)) / (hi - lo);
  }
  return Math.min(1, below / total);
}

/**
 * The GPA's distance (method/standing.md "The distance of each measure"): from the C11 bands where the college reports
 * them, else from the middle 50% (exact or fitted), else the position's fixed value. Null where the baseline's reading
 * can't place the GPA (none, or a weighted range spanning the college's).
 */
function gpaDistance(student: StandingStudent, school: School, standing: StandingSchool, position: Position | null): number | null {
  if (position === null) return null;
  const own = student.gpaRange ?? (student.gpa !== null ? ([student.gpa, student.gpa] as [number, number]) : null);
  if (!own) return null;
  const g = (own[0] + own[1]) / 2;
  if (!isWeightedReporter(school)) {
    const col = bandColumn(school.reported?.admission_profile?.gpa?.bands);
    const below = col ? shareBelowGpa(col.shares, g) : null;
    if (below !== null) return clampD((below - 0.25) / 0.5);
  }
  const m = standing.gpa?.middle;
  if (m) {
    const d = rangeDistance(g, (m.p25[0] + m.p25[1]) / 2, (m.p75[0] + m.p75[1]) / 2);
    if (d !== null) return d;
  }
  return ODDS_V3.position[position];
}

/** `M_acad(d)`, piecewise linear (ODDS_V3.acad). */
export function academicMultiplier(d: number): number {
  const pts = ODDS_V3.acad;
  if (d <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (d <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (d - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** `0.6 × min + 0.4 × mean` over the counted measures; null with none. */
function combine(ds: readonly number[]): number | null {
  if (ds.length === 0) return null;
  const min = Math.min(...ds);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return ODDS_V3.weakest * min + (1 - ODDS_V3.weakest) * mean;
}

/** The summary position the sentences use. */
function summaryOf(d: number | null): Position | null {
  if (d === null) return null;
  return d >= ODDS_V3.summaryAbove ? "above" : d < 0 ? "below" : "in";
}

/* ------------------------------------------------------------------ */
/* Stage 3: levels                                                     */
/* ------------------------------------------------------------------ */

function levelForOdds(odds: number): StandingLevel {
  const c = ODDS_V3.cutoffs;
  if (odds < c.reach) return "high_reach";
  if (odds < c.target) return "reach";
  if (odds < c.likely) return "target";
  if (odds < c.safe) return "likely";
  return "safe";
}

/** The odds band of each level, for `closeness`. */
const BAND: Record<StandingLevel, [number, number]> = {
  high_reach: [0, ODDS_V3.cutoffs.reach],
  reach: [ODDS_V3.cutoffs.reach, ODDS_V3.cutoffs.target],
  target: [ODDS_V3.cutoffs.target, ODDS_V3.cutoffs.likely],
  likely: [ODDS_V3.cutoffs.likely, ODDS_V3.cutoffs.safe],
  safe: [ODDS_V3.cutoffs.safe, ODDS_V3.maxOdds],
};

function quarterOf(odds: number, level: StandingLevel): 0 | 1 | 2 | 3 {
  const [lo, hi] = BAND[level];
  const q = Math.floor(((odds - lo) / (hi - lo)) * 4);
  return Math.min(3, Math.max(0, q)) as 0 | 1 | 2 | 3;
}

/** The highest level a tier allows (method/standing.md "Caps"); Ultra selective (`elite`) has its own rule. */
function capFor(tier: SelectivityTier | null, rate: number): StandingLevel {
  if (tier === "highly_selective") return "target";
  if (tier === "very_selective") return "likely";
  if (tier === "selective") return rate >= ODDS_V3.safeRateMin ? "safe" : "likely";
  return "safe";
}

interface Placed {
  level: StandingLevel;
  /** A cap or floor set the level (the odds didn't). */
  set: boolean;
  label: StandingLabel | null;
}

/** The level from the odds, then the tier's cap and the Safe rule, then a recruited floor. */
function place(odds: number, consistent: boolean, tier: SelectivityTier | null, rate: number, floor: StandingLevel | null): Placed {
  let level: StandingLevel;
  let set = false;
  if (tier === "elite") {
    // The odds aren't used: Reach only when every signal is consistent with an excellent, well-rounded record
    // (Revision 1); anything missing or short is a High reach.
    level = consistent ? "reach" : "high_reach";
    set = true;
  } else {
    level = levelForOdds(odds);
    const cap = capFor(tier, rate);
    if (LEVEL_RANK[level] > LEVEL_RANK[cap]) {
      level = cap;
      set = true;
    }
  }
  // Safe needs most applicants like the student admitted, whatever the tier.
  if (level === "safe" && rate < ODDS_V3.safeRateMin) {
    level = "likely";
    set = true;
  }
  let label: StandingLabel | null = tier === "elite" ? "elite" : null;
  if (floor) {
    if (LEVEL_RANK[floor] > LEVEL_RANK[level]) {
      level = floor;
      set = true;
    }
    label = "recruited";
  }
  return { level, set, label };
}

/* ------------------------------------------------------------------ */
/* The fixed part: everything but the score                           */
/* ------------------------------------------------------------------ */

const RIGOR_POSITION: Record<RigorReading, Position | null> = { most: "above", much: "in", few_offered: "in", some: "below", cant_place: null };

function rigorEntered(student: EstimateStudent, core: CoreAtTopLevel): boolean {
  return student.courses.length > 0 || Object.values(core).some((year) => Object.values(year).some((v) => v === true));
}

const bestImportance = (...vs: (Importance | null | undefined)[]): Importance | null =>
  vs.reduce<Importance | null>((best, v) => (v && (!best || IMPORTANCE_RANK[v] > IMPORTANCE_RANK[best]) ? v : best), null);

/** Everything Stages 1 and 2 work out for one college apart from the score (so a retake can be tried cheaply). */
interface Fixed {
  pool: PoolReading;
  tier: SelectivityTier | null;
  tierPool: SelectivityPool;
  majorClosed: boolean;
  major: MajorReviewReading;
  gpaWeighs: Weighs;
  gpaPosition: Position | null;
  /** The GPA's measured distance, before crowding. */
  gpaRawD: number | null;
  /** The GPA slot's distance after crowding and rigor. */
  gpaD: number | null;
  crowded: boolean;
  /** Crowded and the GPA at or above the 25th: "meets the bar". */
  meetsBar: boolean;
  topShare: number | null;
  rigor: RigorResult | null;
  rigorWeighs: Weighs;
  rigorPosition: Position | null;
  rigorUsed: boolean;
  rankWeighs: Weighs;
  rankPosition: Position | null;
  rankD: number | null;
  rankQualifies: boolean;
  subjectPosition: Position | null;
  subjectFromGrades: boolean;
  subjectFromSections: boolean;
  requiredChecked: boolean;
  /** The major's course track fills the major-subjects slot as above (depth.md "Against the intended major"). */
  trackAbove: boolean;
  majorSlotOpen: boolean;
  tracks: CourseTracks;
  activities: ActivitiesResult;
  /** The college's rating of extracurriculars or talent, whichever is higher. */
  depthRating: Importance | null;
  workRating: Importance | null;
  /** The product of the multipliers beyond the academic one. */
  mult: number;
  mDepth: number;
  mWork: number;
  legacy: LegacyReading | null;
  mLegacy: number;
  interest: { multiplier: number; rating: Importance | null } | null;
  mInterest: number;
  mRecruit: number;
  hooks: CollegeHooks;
  /** Whether the hooks are switched off (the floors with them). */
  hooksOff: boolean;
  /** Revision 1: the share of the expected inputs' weight the student entered (1 when nothing is expected). */
  completeness: number;
  /** The expected inputs the student hasn't entered, in COMPLETENESS_KINDS order. */
  gaps: CompletenessKind[];
  /** Whether a test is expected here (required, or weighed and the student has one). */
  testExpected: boolean;
  /** The Ultra selective consistency check, apart from the test (which the score part reads). */
  consistency: Consistency;
  /** Revision 2: course tracks and activities in the same family. */
  themes: ThemesResult;
  /** Revision 2, `M_theme`: where the college rates extracurriculars or talent at least considered. */
  mTheme: number;
  /** Revision 2: the rank nudge that applies here (the highest), or null. */
  rankNudge: RankNudgeKind | null;
  /** Whether the college weighs class rank or GPA (the rank nudge's gate). */
  rankNudgeOpen: boolean;
  mRank: number;
  /** Revision 2: the weighted GPA's lead over the unweighted, where it's readable. */
  weightedGap: WeightedGap | null;
  /** Whether the college weighs rigor or GPA (the weighted-GPA nudge's gate). */
  rigorNudgeOpen: boolean;
  mWeighted: number;
  /** Revision 3, rule 8: an Ultra selective college in the top band (`selectivity.band`), for this student's pool. */
  topBand: boolean;
  /** Rule 8's standouts apart from the test: national or state recognition, or the top of the class. */
  standout: boolean;
}

/** The Ultra selective rule's signals apart from the test: all met, and the ones the student hasn't entered. */
interface Consistency {
  pass: boolean;
  /** Inputs the student hasn't entered that the rule needs (named in the incomplete sentence). */
  missing: InputKind[];
  /** Revision 2: parts of the record the rule needs that aren't kinds of input (named in the same sentence). */
  extra: ElitePiece[];
}

/** Revision 2: what the Ultra selective rule can ask for beyond the input kinds. */
type ElitePiece = "advanced_grades" | "this_year_courses";

interface WeightedGap {
  /** Weighted minus unweighted, on the student's scale. */
  gap: number;
  /** A 100-point scale (its own steps). */
  hundred: boolean;
}

/** Revision 2: the highest rank nudge the student's class standing or expectation gives, or null. Never stacked. */
function rankNudgeOf(s: EstimateStudent): RankNudgeKind | null {
  const kinds: RankNudgeKind[] = [];
  if (s.rankExpectation === "valedictorian" || s.rankExpectation === "salutatorian") kinds.push(s.rankExpectation);
  const pick = s.classStanding ?? null;
  const pct = pick === "no_rank" ? null : s.classRankPercentile;
  if (pick === "top1" || (pct !== null && pct <= 1)) kinds.push("top1");
  else if (pick === "top5" || (pct !== null && pct <= 5)) kinds.push("top5");
  return kinds.reduce<RankNudgeKind | null>((best, k) => (best === null || ODDS_V3.rankNudge[k] > ODDS_V3.rankNudge[best] ? k : best), null);
}

/**
 * Revision 2: the weighted GPA's lead over the unweighted one on the student's own scale, or null where it can't be
 * read (no weighted GPA, no unweighted one, a 4.0-scale GPA entered above 4.0, or a weighted figure off the scale).
 */
function weightedGapOf(s: EstimateStudent): WeightedGap | null {
  const w = s.weightedGpa;
  if (typeof w !== "number" || !Number.isFinite(w) || s.gpa === null) return null;
  const g = s.gpa;
  if (s.gpaScale === "100") {
    const top = HUNDRED_BAND_TOP.find(([at]) => g >= at - 1e-9)?.[1] ?? null;
    return top === null ? null : { gap: w - top, hundred: true };
  }
  if (w > ODDS_V3.weightedMaxPoints) return null;
  if (s.gpaScale === "5.0") return { gap: w - (g * 5) / 4, hundred: false };
  // A 4.0-scale GPA entered above 4.0 is itself weighted (read as a range): the unweighted one isn't known.
  if (s.gpaRange && s.gpaRange[1] - s.gpaRange[0] > 1e-9) return null;
  return { gap: w - g, hundred: false };
}

function weightedMultiplier(g: WeightedGap | null): number {
  if (!g) return 1;
  const steps = g.hundred ? ODDS_V3.weightedGap100 : ODDS_V3.weightedGap;
  return steps.find(([min]) => g.gap >= min - 1e-9)?.[1] ?? 1;
}

function fixedPart(input: ModelInput, student: StandingStudent, without: Without, owner: OwnerReading): Fixed {
  const { school } = input;
  const s = input.student;
  const hooks = input.hooks ?? NO_HOOKS;

  // The major: a gate no route can meet any more closes the major, and the rest is computed for the university.
  const major = majorReviewFor(s, school);
  const majorClosed = major.gate?.status === "closed";
  const state = without.residency ? null : s.state;
  const poolStudent = {
    state,
    classRankPercentile: without.rank ? null : s.classRankPercentile,
    gpa: s.gpa,
    majors: majorClosed ? [] : s.majors,
    round: s.round,
  };
  const pool = poolRateFor(poolStudent, school, { overallYear: input.overallYear ?? null });
  const { tier, pool: tierPool } = tierForStudent(school, state);

  // GPA, and crowding.
  const gpaWeighs = weighsGpa(school);
  const gpaRead = gpaStanding(student, input.standing, null);
  const gpaPosition = gpaWeighs.counts ? gpaRead.position : null;
  const gpaRawD = gpaDistance(student, school, input.standing, gpaPosition);
  // A weighted reporter's bands pile everyone into the top band, so they can't show crowding (how-colleges-read.md).
  const topShare = isWeightedReporter(school) ? null : gpaTopShare(school);
  const crowded = !without.crowding && topShare !== null && topShare >= STANDING_V2.crowdedShare && gpaRawD !== null;
  const meetsBar = crowded && gpaRawD !== null && gpaRawD >= 0;

  // Rigor (method/standing.md "Crowding"): fills the slot at a crowded college.
  const core = input.coreAtTopLevel ?? emptyCoreAtTopLevel();
  const rigorWeighs = weighsRigor(school);
  const rigor = rigorEntered(s, core) ? rigorReading({ courses: s.courses, coreAtTopLevel: core, grade: input.grade ?? null }, input.offering, { linked: input.linked ?? s.highSchoolId !== null }) : null;
  const rigorPosition = without.rigor || !rigor ? null : RIGOR_POSITION[rigor.reading];

  let gpaD = gpaRawD;
  let rigorUsed = false;
  if (meetsBar) {
    gpaD = ODDS_V3.position.in;
    if (rigorWeighs.counts && rigorPosition !== null) {
      rigorUsed = true;
      if (rigorPosition === "above") gpaD = ODDS_V3.position.above;
      else if (rigorPosition === "below" && RIGOR_CAN_LOWER) gpaD = ODDS_V3.position.below;
    }
  }

  // Class rank, through C10's tiers.
  const rankWeighs = weighsRank(school);
  const cr = school.reported?.admission_profile?.class_rank;
  const rankQualifies = rankWeighs.counts && !!cr && cr.submitted_share >= STANDING_V2.rankSubmittedMin;
  let rankPosition: Position | null = null;
  let rankD: number | null = null;
  if (rankQualifies && !without.rank && s.classRankPercentile !== null) {
    const share = rankShareAtOrAbove(s.classRankPercentile, cr!);
    if (share !== null) {
      rankD = clampD((0.75 - share) / 0.5);
      rankPosition = share <= STANDING_V2.rankAbove ? "above" : share >= STANDING_V2.rankBelow ? "below" : "in";
    }
  }

  // The major's subjects (method/major-effects.md), extended by the course track (depth.md).
  let subjectPosition: Position | null = null;
  let subjectFromGrades = false;
  let subjectFromSections = false;
  let requiredChecked = false;
  const named = !majorClosed && major.family && major.considered === "pool_and_emphasis" ? major.emphasis.filter((e) => e === "math" || e === "science") : [];
  if (!majorClosed && major.family) {
    const marks: Position[] = [];
    if (named.length > 0 && s.gpa !== null) {
      for (const e of named) {
        const g = major.subjectGpas[e];
        if (g === null || g === undefined) continue;
        subjectFromGrades = true;
        const diff = g - s.gpa;
        if (diff >= -STANDING_V2.subjectIn - 1e-9) marks.push("in");
        else if (diff < -STANDING_V2.subjectBelow - 1e-9) marks.push("below");
      }
    }
    if (named.includes("math")) {
      const satMath = school.admissions?.sat_math_25_75 ?? null;
      const actMath = school.admissions?.act_math_25_75 ?? null;
      if (s.satMath !== null && satMath) {
        subjectFromSections = true;
        if (s.satMath < satMath[0]) marks.push("below");
      } else if (s.actMath !== null && actMath) {
        subjectFromSections = true;
        if (s.actMath < actMath[0]) marks.push("below");
      }
    }
    if (major.requiredCourses.length > 0 && s.courses.length > 0) {
      requiredChecked = true;
      if (major.requiredCourses.some((r) => !r.met)) marks.push("below");
    }
    subjectPosition = marks.includes("below") ? "below" : marks.includes("in") ? "in" : null;
  }
  const activityList = s.activities ?? [];
  const tracks = courseTracks({ courses: s.courses, coreAtTopLevel: core, offering: input.offering, majors: s.majors, activities: activityList });
  const majorSlotOpen = !majorClosed && !!major.family && (named.length > 0 || major.requiredCourses.length > 0 || major.gate !== null);
  const trackAbove = !without.depth && majorSlotOpen && tracks.majorDeep && subjectPosition !== "below";

  // Depth (the activities reading and recognition), gated by the college's extracurriculars or talent rating.
  const activities = activitiesReading(activityList, s.awards ?? []);
  const f = c7(school);
  const depthRating = bestImportance(f?.extracurriculars as Importance | undefined, f?.talent as Importance | undefined);
  const rawDepth = Math.max(activities.reading ? (ODDS_V3.depth[activities.reading] ?? 1) : 1, activities.recognition ? (ODDS_V3.recognition[activities.recognition] ?? 1) : 1);
  const depthOpen = depthRating === "very_important" || depthRating === "important" ? 1 : depthRating === "considered" ? 0.5 : 0;
  const mDepth = without.depth ? 1 : 1 + (rawDepth - 1) * depthOpen;

  // Work, where the college weighs work experience and the work entry isn't already one of the top two activities.
  const workRating = (f?.work_experience as Importance | undefined) ?? null;
  const hours = activities.workHours;
  const workCountedByDepth = activities.workInTopTwo && depthOpen > 0;
  const mWork = workRating && C7_AT_LEAST_CONSIDERED.has(workRating) && hours !== null && !workCountedByDepth ? (ODDS_V3.work.find(([h]) => hours >= h)?.[1] ?? 1) : 1;

  // The list row's inputs.
  const hooksOff = !!without.hooks;
  const legacy = hooks.legacy ? legacyMultiplier(school) : null;
  const mLegacy = legacy && !hooksOff ? legacy.multiplier : 1;
  const interest = hooks.interest ? interestMultiplier(school) : null;
  const mInterest = interest && !without.interest ? interest.multiplier : 1;
  const mRecruit = hooksOff ? 1 : recruitMultiplier(hooks.recruited);

  // Revision 2: rank nudges where the college weighs class rank or GPA; the weighted GPA's lead where it weighs rigor
  // or GPA; themes (a course track and an activity in the same family) where it rates activities at all.
  const rankNudgeOpen = gpaWeighs.counts || rankWeighs.counts;
  const rankNudge = without.rank || !rankNudgeOpen ? null : rankNudgeOf(s);
  const mRank = rankNudge ? ODDS_V3.rankNudge[rankNudge] : 1;
  const rigorNudgeOpen = gpaWeighs.counts || rigorWeighs.counts;
  const gap = weightedGapOf(s);
  const mWeighted = without.rigor || !rigorNudgeOpen ? 1 : weightedMultiplier(gap);
  const themes = courseThemes({ courses: s.courses, coreAtTopLevel: core, activities: activityList });
  const themeOpen = depthRating !== null && C7_AT_LEAST_CONSIDERED.has(depthRating);
  const themeCount = themes.themes.length;
  const mTheme = without.depth || !themeOpen || themeCount === 0 ? 1 : themeCount >= 2 ? ODDS_V3.theme.two : ODDS_V3.theme.one;

  // Revision 1, completeness: the inputs this college weighs (C7, else the federal factors, as read above), and which
  // the student entered. A test is expected where the college requires one, or weighs one the student has; a test the
  // student doesn't have at a test-optional college isn't a gap. "My school doesn't rank" is unanswered
  // (Revision 3, rule 5; ownerReading clears it).
  const policy = input.standing.testPolicy;
  const testExpected = policy !== "not-considered" && !testsUnweighed(school, input.standing) && f?.test_scores !== "not_considered" && (isRequiredPolicy(policy) || s.test !== null);
  const expected: Record<CompletenessKind, boolean> = {
    gpa: gpaWeighs.counts,
    courses: rigorWeighs.counts,
    class_rank: rankWeighs.counts,
    test: testExpected,
    activities: depthRating !== null && C7_AT_LEAST_CONSIDERED.has(depthRating),
  };
  const rankAnswered = s.classRankPercentile !== null || (s.classStanding ?? null) !== null;
  const present: Record<CompletenessKind, boolean> = {
    gpa: student.gpaRange !== null || s.gpa !== null,
    courses: rigorEntered(s, core),
    class_rank: rankAnswered,
    test: s.test !== null,
    // Owner, 2026-10-12: "None" on every activity step is an answer, not a gap (the reading stays empty: no depth).
    activities: activityList.length > 0 || (s.awards ?? []).length > 0 || s.activitiesAnswered === true,
  };
  let expectedWeight = 0;
  let presentWeight = 0;
  const gaps: CompletenessKind[] = [];
  for (const k of COMPLETENESS_KINDS) {
    if (!expected[k]) continue;
    expectedWeight += ODDS_V3.expectWeights[k];
    if (present[k]) presentWeight += ODDS_V3.expectWeights[k];
    else gaps.push(k);
  }
  const completeness = expectedWeight > 0 ? presentWeight / expectedWeight : 1;

  // Revision 1, Ultra selective: Reach only when every signal is consistent with an excellent, well-rounded record
  // (the test is checked with the score). Missing counts as short.
  const cMissing: InputKind[] = [];
  let cPass = true;
  const check = (ok: boolean, missingKind: InputKind | null) => {
    if (ok) return;
    cPass = false;
    if (missingKind) cMissing.push(missingKind);
  };
  check(gpaD !== null && gpaD >= 0, present.gpa ? null : "gpa");
  const reading = rigor?.reading ?? null;
  check(reading === "most" || reading === "much", reading === null ? "courses" : reading === "cant_place" ? "high_school" : null);
  const standingPick = s.classStanding ?? null;
  const topStanding = standingPick === "top1" || standingPick === "top5" || (s.classRankPercentile !== null && s.classRankPercentile <= ULTRA_RANK_TOP);
  check(topStanding, rankAnswered ? null : "class_rank");
  const rounded = activities.reading === "focused" || activities.reading === "building" || activities.recognition === 1 || activities.recognition === 2;
  check(rounded, present.activities ? null : "activities");

  // Revision 2 (owner, 2026-10-12: "depth, great academics, consistency in things like APs, great grades in your APs,
  // clubs that overlap with your academics"): depth with a theme, an advanced course every year from the first through
  // now (at least three), and strong grades in them.
  const extra: ElitePiece[] = [];
  const deep = activities.reading === "focused" || activities.reading === "building";
  check(deep && themeCount > 0, present.activities ? null : "activities");
  // Revision 3, rule 4: no advanced-course check reads 9th grade (they can't be taken before 10th), so consistency
  // runs from 10th or the first advanced course, whichever is later, through now; before junior year ends, senior
  // year is assumed to continue at junior year's number of advanced courses (a count, never a grade).
  const advanced = s.courses.filter((c) => isAdvancedKind(c.kind));
  const sofar = advanced.filter((c) => c.status !== "planned").map((c) => c.year as number);
  const now = input.grade ?? (sofar.length > 0 ? Math.max(...sofar) : null);
  const advYears = new Set(advanced.map((c) => c.year as number));
  const first = advYears.size > 0 ? Math.max(ODDS_V3.firstAdvancedYear, Math.min(...advYears)) : null;
  const skipped: number[] = [];
  if (first !== null && now !== null) for (let y = first; y <= now; y++) if (!advYears.has(y)) skipped.push(y);
  const inYear = (y: number) => advanced.filter((c) => c.year === y).length;
  const projected = owner.juniorOpen === true ? Math.max(0, inYear(11) - inYear(12)) : 0;
  const steadyAdvanced = advanced.length + projected >= ODDS_V3.ultraAdvancedCount && skipped.length === 0;
  check(steadyAdvanced, null);
  if (!steadyAdvanced && advanced.length > 0 && skipped.length === 1 && skipped[0] === now) extra.push("this_year_courses");
  // Revision 3, rule 1: exam scores are grades; courses in progress never count against.
  const grades = advancedGrades(s.courses);
  check(grades.pass, null);
  if (grades.ungraded) extra.push("advanced_grades");

  // Revision 3, rule 8 (owner, 2026-10-12): at the top band of Ultra selective, Reach also takes one standout. The
  // test's (at or above the 75th percentile, a junior's target included) is read with the score.
  const topBand = tier === "elite" && school.selectivity?.band === "top";
  const topOfClass = s.rankExpectation === "valedictorian" || s.rankExpectation === "salutatorian" || s.classStanding === "top1" || (s.classRankPercentile !== null && s.classRankPercentile <= 1);
  const standout = activities.recognition === 1 || activities.recognition === 2 || topOfClass;

  return {
    topBand,
    standout,
    pool,
    tier,
    tierPool,
    majorClosed,
    major,
    gpaWeighs,
    gpaPosition,
    gpaRawD,
    gpaD,
    crowded,
    meetsBar,
    topShare,
    rigor,
    rigorWeighs,
    rigorPosition,
    rigorUsed,
    rankWeighs,
    rankPosition,
    rankD,
    rankQualifies,
    subjectPosition,
    subjectFromGrades,
    subjectFromSections,
    requiredChecked,
    trackAbove,
    majorSlotOpen,
    tracks,
    activities,
    depthRating,
    workRating,
    mult: mDepth * mWork * mLegacy * mInterest * mRecruit * mRank * mWeighted * mTheme,
    mDepth,
    mWork,
    legacy,
    mLegacy,
    interest,
    mInterest,
    mRecruit,
    hooks,
    hooksOff,
    completeness,
    gaps,
    testExpected,
    consistency: { pass: cPass, missing: [...new Set(cMissing)], extra },
    themes,
    mTheme,
    rankNudge,
    rankNudgeOpen,
    mRank,
    weightedGap: gap,
    rigorNudgeOpen,
    mWeighted,
  };
}

/** Class standing at or above this ("top X%") passes the Ultra selective rule where the school ranks (owner, 2026-10-12: top 5%). */
const ULTRA_RANK_TOP = 5;

/* ------------------------------------------------------------------ */
/* The score                                                           */
/* ------------------------------------------------------------------ */

interface ScorePart {
  read: ScoreRead | null;
  send: SendAdvice | null;
  notes: EstimateNote[];
  unweighed: boolean;
  /** The score's distance on the college's range (the other test concorded in), or null. */
  d: number | null;
}

/** The score's read at this college under the method: unused where the college doesn't weigh tests. */
function scorePart(student: StandingStudent, input: ModelInput): ScorePart {
  const base = scoreStanding(student, input.standing);
  if (student.test && base.test && testsUnweighed(input.school, input.standing)) {
    return { read: null, send: "not-used", notes: [note("estimate.not_used", { input: "test score", college: input.school.name }, factorPath("test_scores"))], unweighed: true, d: null };
  }
  const placed = student.test && base.test ? readScore(student.test, input.standing) : null;
  return { read: base.test, send: base.send, notes: base.notes, unweighed: false, d: placed ? rangeDistance(placed.score, placed.range[0], placed.range[1]) : null };
}

const note = (key: string, values: EstimateNote["values"] = {}, cite?: string | null): EstimateNote => (cite ? { key, values, cite } : { key, values });

/* ------------------------------------------------------------------ */
/* Deciding                                                            */
/* ------------------------------------------------------------------ */

interface Decision {
  level: StandingLevel | null;
  label: StandingLabel | null;
  /** The academic distance (the test as a consistency check on the rest), or null with no counted measure. */
  d: number | null;
  /** The distance the odds read: `d` drawn toward the gap prior by the missing inputs' share. */
  dEff: number | null;
  /** Every signal the Ultra selective rule reads is met (the test included). */
  consistent: boolean;
  /** Inputs the Ultra selective rule needs that the student hasn't entered (the test included). */
  consistencyMissing: InputKind[];
  /** The hidden odds, before caps and floors; null without a rate or a distance. */
  odds: number | null;
  /** A cap or floor set the level, so `closeness` is null. */
  set: boolean;
  open: boolean;
  /** Revision 3, rule 8: a top-band college and none of its standouts (the sentence names them). */
  noStandout: boolean;
}

function decide(f: Fixed, score: ScorePart): Decision {
  // The core: every measure but the test (the GPA slot after crowding and rigor, class rank, the major's subjects).
  const core: number[] = [];
  if (f.gpaD !== null) core.push(f.gpaD);
  if (f.rankD !== null) core.push(f.rankD);
  const subject = f.subjectPosition !== null ? ODDS_V3.position[f.subjectPosition] : null;
  let dCore = combine(subject !== null ? [...core, subject] : core);
  if (f.trackAbove) {
    // A deep track for the major fills the slot as above, and never lowers the distance (depth never lowers a level).
    const dt = combine([...core, ODDS_V3.position.above]);
    if (dt !== null && (dCore === null || dt > dCore)) dCore = dt;
  }

  // The test as a consistency check (Revision 1): it moves the core a little toward itself, within limits; alone, it
  // is the distance. A withheld score is still the only measure when nothing else can be placed.
  const testCounted = !!score.read?.used && score.d !== null;
  let d: number | null = null;
  if (dCore !== null && testCounted) d = dCore + Math.min(ODDS_V3.testUp, Math.max(-ODDS_V3.testDown, ODDS_V3.testPull * (score.d! - dCore)));
  else if (dCore !== null) d = dCore;
  else if (score.read && score.d !== null) d = score.d;
  // Completeness (Revision 1): the missing inputs' share of the weight reads as the gap prior. Gaps lower the distance
  // and never raise it: a record already below the prior isn't helped by leaving inputs out.
  const dEff = d === null ? null : Math.min(d, f.completeness * d + (1 - f.completeness) * ODDS_V3.gapPrior);

  // The Ultra selective rule's test signal: in or above the range where counted; missing where one is expected.
  const consistencyMissing = [...f.consistency.missing];
  let consistent = f.consistency.pass;
  if (testCounted) {
    if (score.d! < 0) consistent = false;
  } else if (f.gaps.includes("test")) {
    consistent = false;
    consistencyMissing.push("test");
  }

  // Revision 3, rule 8: the top band needs one standout too: the test at or above the college's 75th percentile (the
  // score read, so a junior's target counts), national or state recognition, or the top of the class.
  const noStandout = f.topBand && !f.standout && !(score.d !== null && score.d >= 1 - 1e-9);
  if (noStandout) consistent = false;

  const base = { d, dEff, consistent, consistencyMissing, noStandout };
  if (f.pool.kind === "guaranteed") return { ...base, level: "safe", label: "guaranteed", odds: null, set: true, open: false };
  const rate = f.pool.rate;
  if (rate === null) return { ...base, level: "safe", label: null, odds: null, set: true, open: true };

  const floor = f.hooksOff ? null : recruitedFloor(f.hooks.recruited, d, f.tier);
  if (d === null || dEff === null) return floor ? { ...base, level: floor, label: "recruited", odds: null, set: true, open: false } : { ...base, level: null, label: null, odds: null, set: false, open: false };

  const odds = Math.min(ODDS_V3.maxOdds, rate * academicMultiplier(dEff) * f.mult);
  const placed = place(odds, consistent, f.tier, rate, floor);
  return { ...base, level: placed.level, label: placed.label, odds, set: placed.set, open: false };
}

/** One college's full evaluation (with the switches the measurements use). */
function evaluate(input: ModelInput, reading: OwnerReading, without: Without = {}) {
  const student = standingStudentOf(input.student);
  const fixed = fixedPart(input, student, without, reading);
  const score = scorePart(student, input);
  const decision = decide(fixed, score);
  return { student, fixed, score, decision, reading };
}
type Evaluation = ReturnType<typeof evaluate>;

/** The fewest points on the student's own test that raise the level through the method (caps respected); from the target while it's read. */
function moveUp(input: ModelInput, ev: Evaluation): EstimateResult["moveUp"] {
  const { student, fixed, decision } = ev;
  if (!student.test || !decision.level || decision.level === "safe" || decision.label === "guaranteed" || decision.open) return null;
  if (input.standing.testPolicy === "not-considered" || ev.score.unweighed) return null;
  const { kind, score } = student.test;
  const now = LEVEL_RANK[decision.level];
  for (let sc = score + TEST_STEP[kind]; sc <= TEST_MAX[kind]; sc += TEST_STEP[kind]) {
    const next = decide(fixed, scorePart({ ...student, test: { kind, score: sc } }, input)).level;
    // Revision 3: while the target stands in for the score, the points count from the actual score the student has.
    if (next && LEVEL_RANK[next] > now) return { points: sc - (ev.reading.actual ?? score), to: next, score: sc };
  }
  return null;
}

/** `M_ed` for this college from its C21 counts, or null when it doesn't offer ED or the counts aren't on record. */
function edMultiplier(school: School): number | null {
  const ed = school.reported?.admission_profile?.early_decision;
  if (!ed || ed.offered === false) return null;
  const edShare = edRate(ed);
  const overall = sameDocumentRate(school) ?? school.admissions?.acceptance_rate ?? null;
  if (edShare === null || !overall) return null;
  return Math.min(ODDS_V3.ed.max, Math.max(1, 1 + ODDS_V3.ed.share * (edShare / overall - 1)));
}

/** What early decision would do here (method/standing.md "The ED sentence"), with the level it would reach. */
function edVerdict(input: ModelInput, ev: Evaluation): { ed: EstimateResult["ed"]; to: StandingLevel | null } {
  const { decision: dec, fixed: f } = ev;
  if (!dec.level) return { ed: null, to: null };
  if (dec.level === "high_reach") return { ed: "not_advised", to: null };
  const m = edMultiplier(input.school);
  if (m === null) return { ed: null, to: null };
  const rate = f.pool.rate;
  if (dec.label === "guaranteed" || rate === null || dec.d === null || dec.dEff === null) return { ed: "same", to: null };
  const odds = Math.min(ODDS_V3.maxOdds, rate * academicMultiplier(dec.dEff) * f.mult * m);
  const floor = f.hooksOff ? null : recruitedFloor(f.hooks.recruited, dec.d, f.tier);
  const to = place(odds, dec.consistent, f.tier, rate, floor).level;
  return LEVEL_RANK[to] > LEVEL_RANK[dec.level] ? { ed: "helps", to } : { ed: "same", to: null };
}

/* ------------------------------------------------------------------ */
/* Explaining                                                          */
/* ------------------------------------------------------------------ */

const RANK_WORDS = (p: number) => `top ${p}%`;
const TIER_FIELD: Record<SelectivityPool, string> = { all: "selectivity.tier", in_state: "selectivity.in_state", out_of_state: "selectivity.out_of_state" };

/** The structured "who you're compared with" for Compare's sub-line (the published rate only). */
function poolOf(p: PoolReading): EstimatePool | null {
  if (p.kind === "guaranteed") return { kind: "guaranteed", rate: null, whoKey: "pool.who.guaranteed", whoValues: {} };
  if (p.rate === null) return null;
  const primary = p.notes[0];
  const v = (k: string) => String(primary?.values[k] ?? "");
  if (p.field === POOL_FIELDS.inState) return { kind: p.kind, rate: p.rate, whoKey: "pool.who.residency_in", whoValues: { state: v("state") } };
  if (p.field === POOL_FIELDS.outOfState) return { kind: p.kind, rate: p.rate, whoKey: "pool.who.residency_out", whoValues: { state: v("state") } };
  if (p.field === POOL_FIELDS.international) return { kind: p.kind, rate: p.rate, whoKey: "pool.who.international", whoValues: {} };
  if (p.field === POOL_FIELDS.majorRate) return { kind: p.kind, rate: p.rate, whoKey: "pool.who.major", whoValues: { unit: v("unit") } };
  return { kind: p.kind, rate: p.rate, whoKey: "pool.who.overall", whoValues: {} };
}

/** "Not used here: … (X doesn't weigh it)" where C7 says so; "(X doesn't say it weighs it)" without C7. */
function notUsed(school: School, input: string, rating: Importance | null, factor: string): EstimateNote {
  return rating ? note("estimate.not_used", { input, college: school.name }, factorPath(factor)) : note("estimate.not_said", { input, college: school.name });
}

/** The notes, facts, and inputs the result lists, in the order a family reads them (method/standing.md "The two lines"). */
function explain(input: ModelInput, ev: Evaluation, ed: ReturnType<typeof edVerdict>) {
  const { school, student: s } = input;
  const { fixed: f, score, decision, student } = ev;
  const notes: EstimateNote[] = [];
  const facts: string[] = [];
  const used = new Set<InputKind>();
  const missing = new Set<InputKind>();
  const fact = (p: string | null | undefined) => {
    if (p) facts.push(p);
  };

  // The label, then the two stage lines.
  const primary = f.pool.notes[0] ?? null;
  if (decision.label === "guaranteed") {
    const program = (primary?.values.program as string | undefined) ?? "";
    notes.push(note("estimate.guaranteed", { program }, f.pool.field));
  } else if (decision.open) {
    notes.push(note("estimate.open_admission"));
  } else if (decision.label === "recruited") {
    notes.push(note("estimate.recruited"));
  } else if (decision.label === "elite") {
    notes.push(note("estimate.elite", {}, TIER_FIELD[f.tierPool]));
    fact(TIER_FIELD[f.tierPool]);
    // Revision 3, rule 8: what would lift it at the very top, in words only.
    if (decision.noStandout) notes.push(note("estimate.top_band"));
  }
  const position = summaryOf(decision.d);
  if (position) notes.push(note("estimate.academics", { position: noteText(note(`estimate.position.${position}`)) }));
  if (f.pool.kind !== "guaranteed" && f.pool.rate !== null && primary) notes.push(note("estimate.pool", { pool: noteText(primary) }, primary.cite ?? f.pool.field));
  fact(f.pool.rate !== null || f.pool.kind === "guaranteed" ? f.pool.field : null);
  // Revision 3, rule 7: the high school's state stands in for the student's own, and the sentence says so.
  if (ev.reading.stateFromSchool) notes.push(note("estimate.state_from_school", { state: stateName(ev.reading.stateFromSchool) }));
  // A tier that capped the level is a cited fact beside it.
  if (f.tier && f.tier !== "elite" && decision.set && decision.label === null && !decision.open) fact(TIER_FIELD[f.tierPool]);

  // The score (Revision 3, rule 3: the target, said as one, until junior year ends).
  if (ev.reading.target) notes.push(note("estimate.test_target", { test: TEST_LABEL[ev.reading.target.kind], score: ev.reading.target.score }));
  notes.push(...score.notes);
  if (score.read) {
    fact(scoreField(score.read.kind));
    if (score.read.used) used.add("test");
  }
  if (score.unweighed) fact(factorPath("test_scores"));
  else if (input.standing.testPolicy !== null && (score.send !== null || score.read)) fact("admissions.test_policy");
  if (!s.test && input.standing.testPolicy !== "not-considered" && !testsUnweighed(school, input.standing) && (input.standing.sat || input.standing.act)) missing.add("test");

  // GPA, with the sentence the baseline shows, then crowding.
  const gpaRead = gpaStanding(student, input.standing, score.read && student.test ? TEST_LABEL[student.test.kind] : null);
  if (f.gpaWeighs.counts) {
    if (gpaRead.catalog) notes.push(gpaRead.catalog);
    if (gpaRead.note?.cite) fact(gpaRead.note.cite);
    if (f.gpaPosition !== null) used.add("gpa");
    fact(factorFact(f.gpaWeighs, "gpa"));
  } else if (student.gpaRange) {
    notes.push(note("estimate.not_used", { input: "GPA", college: school.name }, factorFact(f.gpaWeighs, "gpa")));
    fact(factorFact(f.gpaWeighs, "gpa"));
  }
  if (!student.gpaRange && f.gpaWeighs.counts && (input.standing.gpa?.kind ?? (input.standing.gpaAverage !== null ? "reported" : "none")) !== "none") missing.add("gpa");
  if (f.meetsBar && f.topShare !== null) {
    notes.push(note("estimate.gpa_meets_bar", { gpa: student.gpaLabel ?? "", share: pct(f.topShare) }, "derived.gpa_top_share"));
    fact("derived.gpa_top_share");
  }

  // Rigor: shown where the college weighs it; it counts only in a crowded GPA slot, and only upward for now.
  if (f.rigorWeighs.counts) {
    if (f.rigor && f.rigor.notes[0]) {
      notes.push(f.rigor.notes[0]);
      fact(factorFact(f.rigorWeighs, "rigor"));
    }
    if (f.rigorUsed) {
      used.add("courses");
      if (f.rigor && f.rigor.reading !== "cant_place") used.add("high_school");
    }
    if (f.meetsBar) {
      if (!f.rigor) missing.add("courses");
      else if (f.rigor.reading === "cant_place") missing.add("high_school");
    }
  }

  // Class rank (or the class-standing pick behind it).
  const cr = school.reported?.admission_profile?.class_rank;
  if (f.rankQualifies && cr) {
    if (f.rankPosition && s.classRankPercentile !== null) {
      used.add("class_rank");
      if (s.classStanding && s.classStanding !== "no_rank") used.add("class_standing");
      notes.push(note(`estimate.rank_${f.rankPosition}`, { rank: RANK_WORDS(s.classRankPercentile) }, "reported.admission_profile.class_rank.submitted_share"));
      if (cr.top_tenth !== null) notes.push(note("estimate.rank_reason", { share: pct(cr.top_tenth) }, "reported.admission_profile.class_rank.top_tenth"));
      else if (cr.top_quarter !== null) notes.push(note("estimate.rank_reason_quarter", { share: pct(cr.top_quarter) }, "reported.admission_profile.class_rank.top_quarter"));
      fact("reported.admission_profile.class_rank.submitted_share");
      fact(cr.top_tenth !== null ? "reported.admission_profile.class_rank.top_tenth" : cr.top_quarter !== null ? "reported.admission_profile.class_rank.top_quarter" : null);
      fact(factorFact(f.rankWeighs, "class_rank"));
    } else if (s.classRankPercentile === null && s.classStanding !== "no_rank") {
      missing.add("class_rank");
    }
  } else if (s.classRankPercentile !== null && f.rankWeighs.source === "c7" && !f.rankWeighs.counts) {
    notes.push(note("estimate.not_used", { input: "class rank", college: school.name }, factorPath("class_rank")));
    fact(factorPath("class_rank"));
  }

  // Revision 2: the rank nudge (the expectation said as one) where the college weighs class rank or GPA; else, for a
  // stated expectation, "not used here".
  if (f.rankNudge) {
    const rankFact = factorFact(f.rankWeighs.counts ? f.rankWeighs : f.gpaWeighs, f.rankWeighs.counts ? "class_rank" : "gpa");
    if (f.rankNudge === "valedictorian" || f.rankNudge === "salutatorian") notes.push(note("estimate.rank_expectation", { title: f.rankNudge, college: school.name }, rankFact));
    else if (f.rankPosition === null) notes.push(note("estimate.rank_top", { rank: f.rankNudge === "top1" ? "top 1%" : "top 5%", college: school.name }, rankFact));
    used.add("class_standing");
    fact(rankFact);
  } else if (s.rankExpectation && !f.rankNudgeOpen) {
    const rated = f.rankWeighs.source === "c7" ? "class_rank" : f.gpaWeighs.source === "c7" ? "gpa" : null;
    notes.push(rated ? note("estimate.not_used", { input: "class standing", college: school.name }, factorPath(rated)) : note("estimate.not_said", { input: "class standing", college: school.name }));
    if (rated) fact(factorPath(rated));
  }
  // Revision 2: a weighted GPA well above the unweighted one, where the college weighs rigor or GPA.
  if (f.mWeighted > 1 && typeof s.weightedGpa === "number") {
    const rigorFact = factorFact(f.rigorWeighs.counts ? f.rigorWeighs : f.gpaWeighs, f.rigorWeighs.counts ? "rigor" : "gpa");
    notes.push(note("estimate.weighted_above", { weighted: String(s.weightedGpa), college: school.name }, rigorFact));
    used.add("gpa");
    fact(rigorFact);
  }

  // The major: its review's lines, and whether its subjects or required courses joined the measures.
  notes.push(...f.major.notes);
  for (const p of f.major.facts) fact(p);
  if (f.major.notes.length > 0 || f.pool.kind === "major") used.add("major");
  if (f.subjectPosition !== null || f.subjectFromGrades) used.add("subject_grades");
  if (f.subjectFromSections) used.add("sections");
  if (f.requiredChecked) used.add("courses");
  if (f.major.family && f.major.considered === "pool_and_emphasis" && f.major.emphasis.some((e) => e === "math" || e === "science") && !f.subjectFromGrades) missing.add("subject_grades");
  if (f.major.family && f.major.requiredCourses.length > 0 && s.courses.length === 0) missing.add("courses");
  if (s.majors.length === 0 && majorMatters(school.unit_id)) missing.add("major");

  // Depth: the major's course track where the unit states what it reads, then the activities.
  if (f.majorSlotOpen && s.courses.length > 0) {
    for (const t of f.tracks.families) if (t.expected && t.reading !== "not_offered" && t.years > 0) notes.push(t.note);
    if (f.trackAbove) used.add("courses");
  }
  const acts = s.activities ?? [];
  const awards = s.awards ?? [];
  const depthOpen = f.depthRating === "very_important" || f.depthRating === "important" || f.depthRating === "considered";
  if (depthOpen) {
    const ratingFact = factorPath(c7(school)?.extracurriculars === f.depthRating ? "extracurriculars" : "talent");
    if (acts.length > 0 || awards.length > 0) {
      notes.push(...f.activities.notes.filter((n) => n.key !== "depth.activities.none"));
      // Revision 2: the theme sentence (a course track and an activity in the same family) and what would make one.
      notes.push(...f.themes.notes);
      if (f.mTheme > 1) used.add("courses");
      if (acts.length > 0) used.add("activities");
      if (awards.length > 0) used.add("awards");
      fact(ratingFact);
    } else if (f.depthRating !== "considered" && s.activitiesAnswered !== true) {
      missing.add("activities");
    }
  } else if (acts.length > 0 || awards.length > 0) {
    notes.push(note("depth.activities.not_weighed", { college: school.name }));
    // Revision 2: an Ultra selective college's own rule reads depth across courses and activities, so its suggestions show.
    if (f.tier === "elite") notes.push(...f.themes.notes.filter((n) => n.key !== "depth.theme"));
  }

  // Work and family responsibilities.
  const hours = f.activities.workHours;
  if (hours !== null && hours >= ODDS_V3.work[ODDS_V3.work.length - 1][0]) {
    if (f.workRating && C7_AT_LEAST_CONSIDERED.has(f.workRating)) {
      notes.push(note("estimate.work", { hours }, factorPath("work_experience")));
      used.add("work");
      fact(factorPath("work_experience"));
    } else {
      notes.push(notUsed(school, "work hours", f.workRating, "work_experience"));
      if (f.workRating) fact(factorPath("work_experience"));
    }
  }

  // The list row: legacy, recruiting, interest.
  if (f.hooks.legacy && f.legacy) {
    if (f.legacy.ban) {
      const sectors = f.legacy.ban.sectors;
      const scope = sectors.includes("public") && sectors.includes("private") ? "all" : sectors[0];
      notes.push(note("hooks.legacy_banned", { state: stateName(f.legacy.ban.state), scope, law: f.legacy.ban.law }));
    } else if (f.legacy.rating && f.legacy.rating !== "not_considered") {
      notes.push(note("hooks.legacy_used", { college: school.name, rating: IMPORTANCE_WORDS[f.legacy.rating] }, factorPath("alumni_relation")));
      used.add("legacy");
      fact(factorPath("alumni_relation"));
    } else {
      notes.push(note("hooks.legacy_not_weighed", { college: school.name }, f.legacy.rating ? factorPath("alumni_relation") : null));
      if (f.legacy.rating) fact(factorPath("alumni_relation"));
    }
  }
  if (f.hooks.recruited !== "none") {
    notes.push(note("hooks.recruited"));
    used.add("recruited");
  }
  if (f.hooks.interest && f.interest) {
    if (f.interest.rating && f.interest.rating !== "not_considered") {
      notes.push(note("hooks.interest", { college: school.name }, factorPath("interest")));
      used.add("interest");
      fact(factorPath("interest"));
    } else {
      notes.push(notUsed(school, "shown interest", f.interest.rating, "interest"));
      if (f.interest.rating) fact(factorPath("interest"));
    }
  }

  // First generation: noted where the college rates it, never estimated (inputs-beyond-academics.md).
  const fg = (c7(school)?.first_generation as Importance | undefined) ?? null;
  if (s.firstGeneration === true && fg && fg !== "not_considered") {
    notes.push(note("estimate.first_generation", { college: school.name, rating: IMPORTANCE_WORDS[fg] }, factorPath("first_generation")));
    fact(factorPath("first_generation"));
  }

  // The pool's other lines (a guarantee's limits, residency beside a major rate, "you may qualify", the ED fact).
  notes.push(...f.pool.notes.slice(1));
  for (const p of f.pool.facts) fact(p);
  if (f.pool.kind === "residency") used.add("state");
  if (f.pool.kind === "guaranteed") {
    const check = f.pool.programs.find((c) => c.program.id === f.pool.programId);
    if (check?.program.rule.resident) used.add("state");
    if (check?.program.rule.class_rank_top_pct !== null && check?.program.rule.class_rank_top_pct !== undefined) used.add("class_rank");
    if (check?.program.rule.gpa_min !== null && check?.program.rule.gpa_min !== undefined) used.add("gpa");
  }
  for (const c of f.pool.programs) if (c.status === "may_qualify") for (const m of c.missing) missing.add(m);
  if (!s.state && school.reported?.admissions_by_residency) missing.add("state");

  // The ED sentence, where the student's round is early decision.
  if ((s.round === "ed" || s.round === "ed2") && ed.ed) {
    if (ed.ed === "helps" && ed.to) notes.push(note("ed.helps", { level: STANDING_LEVEL_LABELS[ed.to] }));
    else notes.push(note(`ed.${ed.ed}`));
    used.add("round");
  }

  // Revision 1: every input the college weighs that the student hasn't entered is missing, and at an Ultra selective
  // college every input its rule reads (a guarantee, a recruited floor, or open admission asks for nothing more).
  const settled = decision.open || decision.label === "guaranteed" || decision.label === "recruited";
  const asks: InputKind[] = settled ? [] : [...f.gaps, ...(f.tier === "elite" ? decision.consistencyMissing : [])];
  // Revision 2: at an Ultra selective college, the parts of the record its rule reads that aren't on file yet.
  const extraAsks: ElitePiece[] = settled || f.tier !== "elite" ? [] : f.consistency.extra;
  for (const k of asks) missing.add(k);

  // One prompt for the most useful new input that's missing, only where an input could still change the level.
  for (const k of used) missing.delete(k);
  const newMissing = PROMPT_ORDER.filter((k) => missing.has(k) && !decision.open && (decision.label === null || decision.label === "elite"));
  if (newMissing[0] === "courses") notes.push(note("estimate.missing_courses"));
  else if (newMissing[0]) notes.push(note("estimate.missing_input", { input: noteInput(newMissing[0]) }));
  // And the gaps by name: what the estimate doesn't have yet (never how much they count).
  const gapKinds = INCOMPLETE_ORDER.filter((k) => asks.includes(k) && !used.has(k));
  const gapWords = [...gapKinds.map((k) => INCOMPLETE_WORDS[k] ?? k), ...extraAsks.map((k) => ELITE_PIECE_WORDS[k])];
  if (gapWords.length > 0) notes.push(note("estimate.incomplete", { inputs: listWords(gapWords) }));

  return { notes, facts: [...new Set(facts)], used: [...used], missing: [...missing] };
}

const noteInput = (k: InputKind) => INPUT_WORDS[k] ?? k;

/** The order the one prompt picks in: the inputs colleges weigh most first. */
const PROMPT_ORDER: readonly InputKind[] = ["gpa", "courses", "class_rank", "state", "major", "subject_grades", "high_school", "activities", "test"];
/** The incomplete sentence's kinds, in order, and their words. */
const INCOMPLETE_ORDER: readonly InputKind[] = ["gpa", "courses", "high_school", "class_rank", "test", "activities"];
const INCOMPLETE_WORDS: Partial<Record<InputKind, string>> = {
  gpa: "GPA",
  courses: "courses",
  high_school: "high school",
  class_rank: "class standing",
  test: "test score",
  activities: "activities",
};
/** Revision 2's pieces in the incomplete sentence's words. */
const ELITE_PIECE_WORDS: Record<ElitePiece, string> = {
  advanced_grades: "advanced-course grades",
  this_year_courses: "advanced courses this year",
};
/** "a", "a and b", "a, b, and c". */
function listWords(words: string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/**
 * The method's Stage 1 readings for one college, for the method's own tests only (server-only, like everything here;
 * never in a result, a sentence, a response, telemetry, or an export): the distance with the test as a consistency
 * check, the distance the odds read after completeness, and completeness itself.
 */
export function stageOneReadings(input: ModelInput): { d: number | null; dEff: number | null; completeness: number } {
  const { input: read, reading } = ownerReading(input);
  const ev = evaluate(read, reading);
  return { d: ev.decision.d, dEff: ev.decision.dEff, completeness: ev.fixed.completeness };
}

/** The estimate for one college (the contract's result; no internals). */
export function modelEstimate(input: ModelInput): EstimateResult {
  return modelEstimateWithDetail(input).result;
}

/**
 * The estimate with the method's details for the outcome snapshot (lib/chances/snapshot.ts SnapshotDetail): the
 * Stage 1 position, the pool's kind and rate, crowding, the rigor reading, the hidden odds, the tier, the Depth
 * readings (no names), and the level with each input switched off. Server-only; the detail never goes into an API
 * response or a page.
 */
export function modelEstimateWithDetail(raw: ModelInput): { result: EstimateResult; detail: SnapshotDetail } {
  const { input, reading } = ownerReading(raw);
  const ev = evaluate(input, reading);
  const ed = edVerdict(input, ev);
  const ex = explain(input, ev, ed);
  const dec = ev.decision;
  const result: EstimateResult = {
    unitId: input.school.unit_id,
    group: dec.level,
    label: dec.label,
    used: ex.used,
    missing: ex.missing,
    facts: ex.facts,
    notes: ex.notes,
    send: ev.score.send,
    moveUp: moveUp(input, ev),
    closeness: dec.level && dec.odds !== null && !dec.set ? quarterOf(dec.odds, dec.level) : null,
    ed: ed.ed,
    pool: poolOf(ev.fixed.pool),
    modelVersion: MODEL_VERSION,
  };
  const levelWithout = (k: AblationInput) => evaluate(input, reading, { [k]: true }).decision.level;
  const detail: SnapshotDetail = {
    position: summaryOf(dec.d),
    baseRateKind: ev.fixed.pool.kind,
    baseRate: ev.fixed.pool.rate,
    crowded: ev.fixed.crowded,
    rigorReading: ev.fixed.rigor?.reading ?? null,
    hiddenOdds: dec.odds,
    selectivityTier: ev.fixed.tier,
    completeness: ev.fixed.completeness,
    stateUsed: input.student.state,
    depth: depthSnapshot(ev.fixed.tracks, input.student.activities ?? [], ev.fixed.activities),
    without: {
      residency: levelWithout("residency"),
      crowding: levelWithout("crowding"),
      rigor: levelWithout("rigor"),
      rank: levelWithout("rank"),
      depth: levelWithout("depth"),
      hooks: levelWithout("hooks"),
      interest: levelWithout("interest"),
    },
  };
  return { result, detail };
}
