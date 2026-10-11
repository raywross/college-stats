import "server-only";
/**
 * Quad's estimate: the method (specs/chances/method/standing.md, rigor-reading.md, major-effects.md) behind the
 * estimate's contract. Server-only and proprietary: nothing here reaches a client bundle, an API response, or a
 * sentence (specs/chances/README.md "Quad's estimate is proprietary"). The site sees only the `EstimateResult`: the
 * group, the label, the kinds of input used or missing, cited facts, and catalog notes (lib/chances/notes.ts).
 *
 * Two stages. Stage 1, in the pool? The score, GPA, class-rank, and major-subjects positions, each counted only where
 * the college says it weighs that evidence (CDS C7, else the federal factors), with GPA crowding read from the C11
 * bands (rigor fills the GPA slot at a crowded college, and never lowers it while RIGOR_CAN_LOWER is false). Stage 2,
 * the pool's odds: the student's own base rate (lib/chances/pool-rate.ts) in place of the overall admit rate, with a
 * guarantee overriding Stage 1. The score and GPA readings, the combining rules, and the cutoffs are the open
 * baseline's (lib/chances/baseline.ts); with every new input empty and no new college evidence, the result's
 * group, label, send advice, and move-up are the baseline's.
 */
import type { School } from "../types.ts";
import { pct } from "../format.ts";
import { emptyCoreAtTopLevel, type CoreAtTopLevel } from "../student-profile.ts";
import {
  FIT_RANK,
  gpaStanding,
  groupFromPositions,
  isOptionalPolicy,
  scoreField,
  scoreStanding,
  STANDING,
  standingStudentOf,
  TEST_LABEL,
  TEST_MAX,
  TEST_STEP,
  type Fit,
  type Position,
  type ScoreRead,
  type SendAdvice,
  type StandingSchool,
  type StandingStudent,
} from "./baseline.ts";
import { majorMatters, majorReviewFor, type MajorReviewReading } from "./major-review.ts";
import { noteText } from "./notes.ts";
import { poolRateFor, type PoolReading } from "./pool-rate.ts";
import { gpaTopShare } from "./reading.ts";
import { rigorReading, type RigorResult } from "./rigor.ts";
import type { EstimateNote, EstimateResult, EstimateStudent, InputKind, RigorReading, SchoolOffering } from "./types.ts";
import type { AblationInput, SnapshotDetail } from "./snapshot.ts";

/** Recorded with every result and every outcome snapshot (specs/chances/estimate.md "Changing the method"). */
export const MODEL_VERSION = "20261011.1";

/**
 * The method's own constants (method/standing.md "Rules": they change only with a pilot result). The baseline's
 * cutoffs (`STANDING` in lib/chances/baseline.ts) are reused as they are.
 */
export const STANDING_V2 = {
  ...STANDING,
  /** `derived.gpa_top_share` at or above this: GPAs are crowded and "in or above" only meets the bar. */
  crowdedShare: 0.5,
  /** C10's share of first-years with a reported rank needed before the rank position counts. */
  rankSubmittedMin: 0.15,
  /** Share of ranked first-years at the student's rank or higher: at or under this → above; at or over `rankBelow` → below. */
  rankAbove: 0.25,
  rankBelow: 0.75,
  /** A subject GPA at least (overall − subjectIn) is "in"; more than `subjectBelow` under is "below". */
  subjectIn: 0.1,
  subjectBelow: 0.3,
} as const;

/** Rigor can raise a crowded GPA slot but never lower the group until the pilot says so (method/standing.md). */
export const RIGOR_CAN_LOWER = false;

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
  /** The profile's core-subject answers, when the caller has them (the rigor reading reads them). */
  coreAtTopLevel?: CoreAtTopLevel | null;
  /** The student's grade now (9–12). */
  grade?: number | null;
}

/** Switches for the season measurements (method/outcomes.md "Each new input separately"). */
type Without = Partial<Record<AblationInput, boolean>>;

type FactorSource = "c7" | "federal" | null;

/** Whether the college says it weighs a kind of evidence, and where it says so (the fact to cite). */
interface Weighs {
  counts: boolean;
  source: FactorSource;
}

const C7_AT_LEAST_CONSIDERED = new Set(["very_important", "important", "considered"]);
const C7_AT_LEAST_IMPORTANT = new Set(["very_important", "important"]);

function c7(school: School) {
  return school.reported?.admission_profile?.factors ?? null;
}

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

const factorFact = (w: Weighs, key: "gpa" | "rigor" | "class_rank" | "test_scores"): string | null =>
  w.source === "c7" ? `reported.admission_profile.factors.${key}` : w.source === "federal" ? "admissions.factors" : null;

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

/** The overall position Stage 1 reports: every known position above → above; any below → below; else in. */
function summarize(positions: readonly Position[]): Position | null {
  if (positions.length === 0) return null;
  if (positions.every((p) => p === "above")) return "above";
  if (positions.includes("below")) return "below";
  return "in";
}

const note = (key: string, values: EstimateNote["values"] = {}, cite?: string | null): EstimateNote => (cite ? { key, values, cite } : { key, values });

/** The pool's sentence without its full stop and with a lowercase start, for "Your pool: …". */
function poolPhrase(n: EstimateNote): string {
  const t = noteText(n).replace(/\.$/, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Everything Stage 1 and Stage 2 work out for one college, apart from the score (so a retake can be tried cheaply). */
interface Fixed {
  pool: PoolReading;
  majorClosed: boolean;
  major: MajorReviewReading;
  gpaWeighs: Weighs;
  gpaPosition: Position | null;
  gpaSlot: Position | null;
  crowded: boolean;
  topShare: number | null;
  rigor: RigorResult | null;
  rigorWeighs: Weighs;
  rigorPosition: Position | null;
  rigorUsed: boolean;
  rankWeighs: Weighs;
  rankPosition: Position | null;
  rankQualifies: boolean;
  subjectPosition: Position | null;
  subjectFromGrades: boolean;
  subjectFromSections: boolean;
  requiredChecked: boolean;
}

const RIGOR_POSITION: Record<RigorReading, Position | null> = { most: "above", much: "in", few_offered: "in", some: "below", cant_place: null };

function rigorEntered(student: EstimateStudent, core: CoreAtTopLevel): boolean {
  return student.courses.length > 0 || Object.values(core).some((year) => Object.values(year).some((v) => v === true));
}

/** The score's read at this college under the method: unused where the college doesn't weigh tests. */
function scorePart(student: StandingStudent, input: ModelInput): { read: ScoreRead | null; send: SendAdvice | null; notes: EstimateNote[]; unweighed: boolean } {
  const base = scoreStanding(student, input.standing);
  if (student.test && base.test && testsUnweighed(input.school, input.standing)) {
    return { read: null, send: "not-used", notes: [note("estimate.not_used", { input: "test score", college: input.school.name }, "reported.admission_profile.factors.test_scores")], unweighed: true };
  }
  return { read: base.test, send: base.send, notes: base.notes, unweighed: false };
}

function fixedPart(input: ModelInput, student: StandingStudent, without: Without): Fixed {
  const { school } = input;
  const s = input.student;

  // The major: a gate no route can meet any more closes the major, and the rest is computed for the university.
  const major = majorReviewFor(s, school);
  const majorClosed = major.gate?.status === "closed";
  const poolStudent = {
    state: without.residency ? null : s.state,
    classRankPercentile: without.rank ? null : s.classRankPercentile,
    gpa: s.gpa,
    majors: majorClosed ? [] : s.majors,
    round: s.round,
  };
  const pool = poolRateFor(poolStudent, school, { overallYear: input.overallYear ?? null });

  // GPA, and crowding.
  const gpaWeighs = weighsGpa(school);
  const gpaRead = gpaStanding(student, input.standing, null);
  const gpaPosition = gpaWeighs.counts ? gpaRead.position : null;
  const topShare = gpaTopShare(school);
  const crowded = !without.crowding && topShare !== null && topShare >= STANDING_V2.crowdedShare && gpaPosition !== null;

  // Rigor (method/standing.md "The rigor position").
  const core = input.coreAtTopLevel ?? emptyCoreAtTopLevel();
  const rigorWeighs = weighsRigor(school);
  const rigor = rigorEntered(s, core) ? rigorReading({ courses: s.courses, coreAtTopLevel: core, grade: input.grade ?? null }, input.offering, { linked: input.linked ?? s.highSchoolId !== null }) : null;
  const rigorPosition = without.rigor || !rigor ? null : RIGOR_POSITION[rigor.reading];

  let gpaSlot = gpaPosition;
  let rigorUsed = false;
  if (crowded && gpaPosition !== "below") {
    // "Meets the bar": in or above adds nothing on its own; rigor decides the slot where it counts.
    gpaSlot = "in";
    if (rigorWeighs.counts && rigorPosition !== null) {
      rigorUsed = true;
      if (rigorPosition === "above") gpaSlot = "above";
      else if (rigorPosition === "below" && RIGOR_CAN_LOWER) gpaSlot = "below";
    }
  }

  // Class rank, through C10's tiers.
  const rankWeighs = weighsRank(school);
  const cr = school.reported?.admission_profile?.class_rank;
  const rankQualifies = rankWeighs.counts && !!cr && cr.submitted_share >= STANDING_V2.rankSubmittedMin;
  let rankPosition: Position | null = null;
  if (rankQualifies && !without.rank && s.classRankPercentile !== null) {
    const share = rankShareAtOrAbove(s.classRankPercentile, cr!);
    if (share !== null) rankPosition = share <= STANDING_V2.rankAbove ? "above" : share >= STANDING_V2.rankBelow ? "below" : "in";
  }

  // The major's subjects (method/major-effects.md).
  let subjectPosition: Position | null = null;
  let subjectFromGrades = false;
  let subjectFromSections = false;
  let requiredChecked = false;
  if (!majorClosed && major.family) {
    const named = major.considered === "pool_and_emphasis" ? major.emphasis.filter((e) => e === "math" || e === "science") : [];
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

  return {
    pool,
    majorClosed,
    major,
    gpaWeighs,
    gpaPosition,
    gpaSlot,
    crowded,
    topShare,
    rigor,
    rigorWeighs,
    rigorPosition,
    rigorUsed,
    rankWeighs,
    rankPosition,
    rankQualifies,
    subjectPosition,
    subjectFromGrades,
    subjectFromSections,
    requiredChecked,
  };
}

/** Stage 2: the group and label from the positions and the pool. */
function decide(f: Fixed, score: { read: ScoreRead | null }): { group: Fit | null; label: EstimateResult["label"]; positions: Position[] } {
  const positions: Position[] = [];
  if (score.read?.used) positions.push(score.read.position);
  if (f.gpaSlot) positions.push(f.gpaSlot);
  if (f.rankPosition) positions.push(f.rankPosition);
  if (f.subjectPosition) positions.push(f.subjectPosition);
  // A withheld score is still the only measure when nothing else can be placed (the baseline's rule).
  if (positions.length === 0 && score.read) positions.push(score.read.position);

  if (f.pool.kind === "guaranteed") return { group: "likely", label: "guaranteed", positions };
  const rate = f.pool.rate;
  if (rate === null) return { group: "likely", label: null, positions };
  if (rate < STANDING_V2.reachForEveryoneBelow) return { group: "reach", label: "reach-for-everyone", positions };
  if (positions.length === 0) return { group: null, label: null, positions };
  return { group: groupFromPositions(positions, rate), label: null, positions };
}

/** One college's full evaluation (with the switches the measurements use). */
function evaluate(input: ModelInput, without: Without = {}) {
  const student = standingStudentOf(input.student);
  const fixed = fixedPart(input, student, without);
  const score = scorePart(student, input);
  const decision = decide(fixed, score);
  return { student, fixed, score, decision };
}

/** The fewest points on the student's own test that move this college up one group through the method. */
function moveUp(input: ModelInput, ev: ReturnType<typeof evaluate>): EstimateResult["moveUp"] {
  const { student, fixed, decision } = ev;
  if (!student.test || !decision.group || decision.group === "likely" || decision.label !== null) return null;
  if (input.standing.testPolicy === "not-considered" || ev.score.unweighed) return null;
  const { kind, score } = student.test;
  for (let sc = score + TEST_STEP[kind]; sc <= TEST_MAX[kind]; sc += TEST_STEP[kind]) {
    const tried = scorePart({ ...student, test: { kind, score: sc } }, input);
    const next = decide(fixed, tried).group;
    if (next && FIT_RANK[next] > FIT_RANK[decision.group] && next !== "reach") return { points: sc - score, to: next, score: sc };
  }
  return null;
}

const RANK_WORDS = (p: number) => `top ${p}%`;

/** The notes, facts, and inputs the result lists, in the order a family reads them (method/standing.md "The two lines"). */
function explain(input: ModelInput, ev: ReturnType<typeof evaluate>) {
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
  } else if (f.pool.rate === null) {
    notes.push(note("estimate.open_admission"));
  } else if (decision.label === "reach-for-everyone") {
    notes.push(note("estimate.reach_for_everyone", {}, f.pool.field));
  }
  const position = summarize(decision.positions);
  if (position) notes.push(note("estimate.academics", { position: noteText(note(`estimate.position.${position}`)) }));
  if (f.pool.kind !== "guaranteed" && f.pool.rate !== null && primary) notes.push(note("estimate.pool", { pool: poolPhrase(primary) }, primary.cite ?? f.pool.field));
  fact(f.pool.rate !== null || f.pool.kind === "guaranteed" ? f.pool.field : null);

  // The score.
  notes.push(...score.notes);
  if (score.read) {
    fact(scoreField(score.read.kind));
    if (score.read.used) used.add("test");
  }
  if (score.unweighed) fact("reported.admission_profile.factors.test_scores");
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
  if (f.crowded && f.gpaPosition !== "below" && f.topShare !== null) {
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
    if (f.crowded && f.gpaPosition !== "below") {
      if (!f.rigor) missing.add("courses");
      else if (f.rigor.reading === "cant_place") missing.add("high_school");
    }
  }

  // Class rank.
  const cr = school.reported?.admission_profile?.class_rank;
  if (f.rankQualifies && cr) {
    if (f.rankPosition && s.classRankPercentile !== null) {
      used.add("class_rank");
      notes.push(note(`estimate.rank_${f.rankPosition}`, { rank: RANK_WORDS(s.classRankPercentile) }, "reported.admission_profile.class_rank.submitted_share"));
      if (cr.top_tenth !== null) notes.push(note("estimate.rank_reason", { share: pct(cr.top_tenth) }, "reported.admission_profile.class_rank.top_tenth"));
      else if (cr.top_quarter !== null) notes.push(note("estimate.rank_reason_quarter", { share: pct(cr.top_quarter) }, "reported.admission_profile.class_rank.top_quarter"));
      fact("reported.admission_profile.class_rank.submitted_share");
      fact(cr.top_tenth !== null ? "reported.admission_profile.class_rank.top_tenth" : cr.top_quarter !== null ? "reported.admission_profile.class_rank.top_quarter" : null);
      fact(factorFact(f.rankWeighs, "class_rank"));
    } else if (s.classRankPercentile === null) {
      missing.add("class_rank");
    }
  } else if (s.classRankPercentile !== null && f.rankWeighs.source === "c7" && !f.rankWeighs.counts) {
    notes.push(note("estimate.not_used", { input: "class rank", college: school.name }, "reported.admission_profile.factors.class_rank"));
    fact("reported.admission_profile.factors.class_rank");
  }

  // The major: its review's lines, and whether its subjects or required courses joined the votes.
  notes.push(...f.major.notes);
  for (const p of f.major.facts) fact(p);
  if (f.major.notes.length > 0 || f.pool.kind === "major") used.add("major");
  if (f.subjectPosition !== null || f.subjectFromGrades) used.add("subject_grades");
  if (f.subjectFromSections) used.add("sections");
  if (f.requiredChecked) used.add("courses");
  if (f.major.family && f.major.considered === "pool_and_emphasis" && f.major.emphasis.some((e) => e === "math" || e === "science") && !f.subjectFromGrades) missing.add("subject_grades");
  if (f.major.family && f.major.requiredCourses.length > 0 && s.courses.length === 0) missing.add("courses");
  if (s.majors.length === 0 && majorMatters(school.unit_id)) missing.add("major");

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

  // One prompt for the most useful new input that's missing, only where an input could still change the group (not
  // a guarantee, and not a college that's a Reach for everyone in this pool unless the state could change the pool).
  for (const k of used) missing.delete(k);
  const newMissing = (["courses", "class_rank", "state", "major", "subject_grades", "high_school"] as InputKind[]).filter(
    (k) => missing.has(k) && (decision.label === null || (decision.label === "reach-for-everyone" && (k === "state" || k === "major"))),
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
};
const noteInput = (k: InputKind) => INPUT_WORDS_FOR[k] ?? k;

/** The estimate for one college (the contract's result; no internals). */
export function modelEstimate(input: ModelInput): EstimateResult {
  return modelEstimateWithDetail(input).result;
}

/**
 * The estimate with the method's details for the outcome snapshot (lib/chances/snapshot.ts SnapshotDetail): the
 * Stage 1 position, the pool's kind and rate, crowding, the rigor reading, and the group with each new input
 * switched off. Server-only; the detail never goes into an API response or a page.
 */
export function modelEstimateWithDetail(input: ModelInput): { result: EstimateResult; detail: SnapshotDetail } {
  const ev = evaluate(input);
  const ex = explain(input, ev);
  const result: EstimateResult = {
    unitId: input.school.unit_id,
    group: ev.decision.group,
    label: ev.decision.label,
    used: ex.used,
    missing: ex.missing,
    facts: ex.facts,
    notes: ex.notes,
    send: ev.score.send,
    moveUp: moveUp(input, ev),
    modelVersion: MODEL_VERSION,
  };
  const groupWithout = (k: AblationInput) => evaluate(input, { [k]: true }).decision.group;
  const detail: SnapshotDetail = {
    position: summarize(ev.decision.positions),
    baseRateKind: ev.fixed.pool.kind,
    baseRate: ev.fixed.pool.rate,
    crowded: ev.fixed.crowded,
    rigorReading: ev.fixed.rigor?.reading ?? null,
    without: { residency: groupWithout("residency"), crowding: groupWithout("crowding"), rigor: groupWithout("rigor"), rank: groupWithout("rank") },
  };
  return { result, detail };
}

