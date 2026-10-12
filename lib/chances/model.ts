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
 * the weakest measure carries most of the weight. Stage 2, the pool's odds: the student's own base rate
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
import { emptyCoreAtTopLevel, type CoreAtTopLevel } from "../student-profile.ts";
import {
  gpaStanding,
  isOptionalPolicy,
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
import { activitiesReading, courseTracks, depthSnapshot, type ActivitiesResult, type CourseTracks } from "./depth.ts";
import { interestMultiplier, legacyMultiplier, recruitedFloor, recruitMultiplier, type LegacyReading } from "./hooks.ts";
import { NO_HOOKS, STANDING_LEVEL_LABELS } from "./levels.ts";
import { majorMatters, majorReviewFor, type MajorReviewReading } from "./major-review.ts";
import { noteText } from "./notes.ts";
import { poolRateFor, POOL_FIELDS, type PoolReading } from "./pool-rate.ts";
import { gpaTopShare, isWeightedReporter } from "./reading.ts";
import { rigorReading, type RigorResult } from "./rigor.ts";
import type {
  CollegeHooks,
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
export const MODEL_VERSION = "20261012.1";

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
} as const;

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

/** The highest level a tier allows (method/standing.md "Caps"); Elite has its own rule. */
function capFor(tier: SelectivityTier | null, rate: number): StandingLevel {
  if (tier === "highly_selective") return "target";
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
function place(odds: number, anyBelow: boolean, tier: SelectivityTier | null, rate: number, floor: StandingLevel | null): Placed {
  let level: StandingLevel;
  let set = false;
  if (tier === "elite") {
    // The odds aren't used: in range is a Reach, any measure below the range a High reach.
    level = anyBelow ? "high_reach" : "reach";
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
}

function fixedPart(input: ModelInput, student: StandingStudent, without: Without): Fixed {
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

  return {
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
    mult: mDepth * mWork * mLegacy * mInterest * mRecruit,
    mDepth,
    mWork,
    legacy,
    mLegacy,
    interest,
    mInterest,
    mRecruit,
    hooks,
    hooksOff,
  };
}

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
  /** The academic distance, or null with no counted measure. */
  d: number | null;
  /** Any counted measure below the range (the Elite rule). */
  anyBelow: boolean;
  /** The hidden odds, before caps and floors; null without a rate or a distance. */
  odds: number | null;
  /** A cap or floor set the level, so `closeness` is null. */
  set: boolean;
  open: boolean;
}

function decide(f: Fixed, score: ScorePart): Decision {
  const ds: number[] = [];
  if (score.read?.used && score.d !== null) ds.push(score.d);
  if (f.gpaD !== null) ds.push(f.gpaD);
  if (f.rankD !== null) ds.push(f.rankD);
  const subject = f.subjectPosition !== null ? ODDS_V3.position[f.subjectPosition] : null;
  // A withheld score is still the only measure when nothing else can be placed (the second version's rule).
  if (ds.length === 0 && subject === null && score.read && score.d !== null) ds.push(score.d);

  const plain = subject !== null ? [...ds, subject] : ds;
  let measures = plain;
  let d = combine(plain);
  if (f.trackAbove) {
    // A deep track for the major fills the slot as above, and never lowers the distance (depth never lowers a level).
    const withTrack = [...ds, ODDS_V3.position.above];
    const dt = combine(withTrack);
    if (dt !== null && (d === null || dt > d)) {
      d = dt;
      measures = withTrack;
    }
  }
  const anyBelow = measures.some((m) => m < 0);

  if (f.pool.kind === "guaranteed") return { level: "safe", label: "guaranteed", d, anyBelow, odds: null, set: true, open: false };
  const rate = f.pool.rate;
  if (rate === null) return { level: "safe", label: null, d, anyBelow, odds: null, set: true, open: true };

  const floor = f.hooksOff ? null : recruitedFloor(f.hooks.recruited, d, f.tier);
  if (d === null) return floor ? { level: floor, label: "recruited", d, anyBelow, odds: null, set: true, open: false } : { level: null, label: null, d, anyBelow, odds: null, set: false, open: false };

  const odds = Math.min(ODDS_V3.maxOdds, rate * academicMultiplier(d) * f.mult);
  const placed = place(odds, anyBelow, f.tier, rate, floor);
  return { level: placed.level, label: placed.label, d, anyBelow, odds, set: placed.set, open: false };
}

/** One college's full evaluation (with the switches the measurements use). */
function evaluate(input: ModelInput, without: Without = {}) {
  const student = standingStudentOf(input.student);
  const fixed = fixedPart(input, student, without);
  const score = scorePart(student, input);
  const decision = decide(fixed, score);
  return { student, fixed, score, decision };
}
type Evaluation = ReturnType<typeof evaluate>;

/** The fewest points on the student's own test that raise the level through the method (caps respected). */
function moveUp(input: ModelInput, ev: Evaluation): EstimateResult["moveUp"] {
  const { student, fixed, decision } = ev;
  if (!student.test || !decision.level || decision.level === "safe" || decision.label === "guaranteed" || decision.open) return null;
  if (input.standing.testPolicy === "not-considered" || ev.score.unweighed) return null;
  const { kind, score } = student.test;
  const now = LEVEL_RANK[decision.level];
  for (let sc = score + TEST_STEP[kind]; sc <= TEST_MAX[kind]; sc += TEST_STEP[kind]) {
    const next = decide(fixed, scorePart({ ...student, test: { kind, score: sc } }, input)).level;
    if (next && LEVEL_RANK[next] > now) return { points: sc - score, to: next, score: sc };
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
  if (dec.label === "guaranteed" || rate === null || dec.d === null) return { ed: "same", to: null };
  const odds = Math.min(ODDS_V3.maxOdds, rate * academicMultiplier(dec.d) * f.mult * m);
  const floor = f.hooksOff ? null : recruitedFloor(f.hooks.recruited, dec.d, f.tier);
  const to = place(odds, dec.anyBelow, f.tier, rate, floor).level;
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
  }
  const position = summaryOf(decision.d);
  if (position) notes.push(note("estimate.academics", { position: noteText(note(`estimate.position.${position}`)) }));
  if (f.pool.kind !== "guaranteed" && f.pool.rate !== null && primary) notes.push(note("estimate.pool", { pool: noteText(primary) }, primary.cite ?? f.pool.field));
  fact(f.pool.rate !== null || f.pool.kind === "guaranteed" ? f.pool.field : null);
  // A tier that capped the level is a cited fact beside it.
  if (f.tier && f.tier !== "elite" && decision.set && decision.label === null && !decision.open) fact(TIER_FIELD[f.tierPool]);

  // The score.
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
      if (acts.length > 0) used.add("activities");
      if (awards.length > 0) used.add("awards");
      fact(ratingFact);
    } else if (f.depthRating !== "considered") {
      missing.add("activities");
    }
  } else if (acts.length > 0 || awards.length > 0) {
    notes.push(note("depth.activities.not_weighed", { college: school.name }));
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

  // One prompt for the most useful new input that's missing, only where an input could still change the level (not a
  // guarantee, a recruited floor, or open admission; at an Elite college only the state or major, which can change the pool).
  for (const k of used) missing.delete(k);
  const newMissing = (["courses", "class_rank", "state", "major", "subject_grades", "high_school", "activities"] as InputKind[]).filter(
    (k) => missing.has(k) && !decision.open && (decision.label === null || (decision.label === "elite" && (k === "state" || k === "major"))),
  );
  if (newMissing[0] === "courses") notes.push(note("estimate.missing_courses"));
  else if (newMissing[0]) notes.push(note("estimate.missing_input", { input: noteInput(newMissing[0]) }));

  return { notes, facts: [...new Set(facts)], used: [...used], missing: [...missing] };
}

const INPUT_WORDS_FOR: Partial<Record<InputKind, string>> = {
  class_rank: "class rank",
  state: "state",
  major: "intended major",
  subject_grades: "math and science grades",
  high_school: "high school",
  activities: "activities",
};
const noteInput = (k: InputKind) => INPUT_WORDS_FOR[k] ?? k;

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
export function modelEstimateWithDetail(input: ModelInput): { result: EstimateResult; detail: SnapshotDetail } {
  const ev = evaluate(input);
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
  const levelWithout = (k: AblationInput) => evaluate(input, { [k]: true }).decision.level;
  const detail: SnapshotDetail = {
    position: summaryOf(dec.d),
    baseRateKind: ev.fixed.pool.kind,
    baseRate: ev.fixed.pool.rate,
    crowded: ev.fixed.crowded,
    rigorReading: ev.fixed.rigor?.reading ?? null,
    hiddenOdds: dec.odds,
    selectivityTier: ev.fixed.tier,
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
