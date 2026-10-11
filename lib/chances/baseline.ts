/**
 * The open baseline (specs/chances/estimate.md "Architecture"; owner assumption 8): the rules the planner redesign
 * already published (specs/planner/redesign/standing.md, scores.md, gpa.md), moved here from lib/planner/standing.ts
 * behind the estimate's contract (`EstimateResult`). Reach / Target / Likely from the student's GPA and one test
 * against the college's middle 50%, its GPA, its test policy, and its overall admit rate; whether to send the score;
 * and how many points would move the college up a group. A classification with published rules, never a probability.
 *
 * Pure (no server or browser APIs): the design preview (/plan/preview) runs it in the browser, tests pin it, and
 * lib/chances/estimate.ts falls back to it when the model (lib/chances/model.ts, server-only) can't answer. Everything
 * here is already public; the model's own rules never appear in this file.
 *
 * Every sentence also comes as a note (lib/chances/notes.ts key + values) so an `EstimateResult` carries only catalog
 * sentences; `reasons` keeps the published wording for the preview.
 */
import type { School, TestPolicy } from "../types.ts";
import { satTotal } from "../score-bands.ts";
import { actToSat, satToAct } from "../planner/concordance.ts";
import { collegeGpa, compareGpaMiddle, compareGpaRanges, type CollegeGpa, type GpaCurve, type GpaMiddle, type GpaModel } from "../planner/gpa-model.ts";
import type { EstimateNote, EstimateResult, EstimateStudent, InputKind } from "./types.ts";

export type TestKind = "sat" | "act";
export type Fit = "reach" | "target" | "likely";
export type Position = "below" | "in" | "above";
/** What to do with the score at this college: test-blind colleges don't use it; test-optional ones may not need it. */
export type SendAdvice = "send" | "consider-not-sending" | "required-missing" | "not-used";

/** The baseline's version string, recorded with each result it serves. */
export const BASELINE_VERSION = "baseline-20261010";

export interface StandingStudent {
  /** Unweighted GPA on the 4.0 scale (lib/student-profile.ts normalizes other scales). */
  gpa: number | null;
  /**
   * The unweighted range the student's GPA allows (planGpaRange, specs/planner/redesign/gpa.md "The design" 3): a
   * point for an unweighted GPA, wider for a weighted one. Absent: the point `gpa`.
   */
  gpaRange?: [number, number] | null;
  /** How the reasons show the student's GPA ("3.82", "about 3.4–4.0 unweighted (from a weighted 4.4)"). */
  gpaLabel?: string | null;
  /** The one test the student is taking, with their best (or practice) score. */
  test: { kind: TestKind; score: number } | null;
}

export interface StandingSchool {
  admitRate: number | null;
  /** SAT total, 25th–75th percentile of enrolled first-years. */
  sat: [number, number] | null;
  /** ACT composite, 25th–75th. */
  act: [number, number] | null;
  /** Average unweighted GPA of first-years; null when unreported or the college reports a weighted average. */
  gpaAverage: number | null;
  /**
   * The college's GPA, best source first (collegeGpa, lib/planner/gpa-model.ts). Absent: `gpaAverage` as a reported
   * point, else none.
   */
  gpa?: CollegeGpa | null;
  testPolicy: TestPolicy;
}

/** The field a GPA sentence's ⓘ cites. */
export type GpaCite = "reported.admission_profile.gpa.average" | "derived.gpa_band_mean" | "derived.gpa_middle_half" | "derived.gpa_estimate";
export const GPA_CITES: readonly GpaCite[] = ["reported.admission_profile.gpa.average", "derived.gpa_band_mean", "derived.gpa_middle_half", "derived.gpa_estimate"];

/** Where the score sits in the college's middle 50%, when the college reports a range the score can be read against. */
export interface ScoreRead {
  position: Position;
  used: boolean;
  kind: TestKind;
  range: [number, number];
  concorded: boolean;
}

export interface StandingResult {
  fit: Fit | null;
  /** Admits fewer than 1 in 5: a Reach whatever the numbers. */
  reachForEveryone: boolean;
  test: ScoreRead | null;
  gpa: Position | null;
  /**
   * The one GPA sentence (gpa.md "Saying what was used"), whenever the student gave a GPA; it is also the last of
   * `reasons`. `cite` is the field its ⓘ cites (null when the college has no GPA to cite).
   */
  gpaNote: { text: string; cite: GpaCite | null } | null;
  send: SendAdvice | null;
  /** Short sentences, no years (the caller cites the values with their editions). */
  reasons: string[];
  /** The same sentences as catalog notes (lib/chances/notes.ts), for an EstimateResult. */
  notes: EstimateNote[];
}

/** One constants object so the pilot can tune the rules; tests/planner-standing.test.mts pins examples. */
export const STANDING = {
  /** Below this admit rate a college is a Reach for everyone. */
  reachForEveryoneBelow: 0.2,
  /** All positions above the middle 50% and an admit rate at least this → Likely (else Target). */
  likelyAtOrAbove: 0.5,
  /** At least this admit rate: inside the range → Likely; one below with the other above → Target. */
  generousAtOrAbove: 0.7,
  /** One position above and the other inside, at an admit rate at least this → Likely (else Target). */
  likelyMixedAtOrAbove: 0.6,
  /** GPA within this of the college's average counts as "in". */
  gpaBand: 0.15,
} as const;

/** Points a retake commonly adds (specs/planner/redesign/scores.md "When to suggest another test"). */
export const RETAKE_REACH = { sat: 60, act: 2 } as const;

export const TEST_MAX = { sat: 1600, act: 36 } as const;
export const TEST_MIN = { sat: 400, act: 1 } as const;
export const TEST_STEP = { sat: 10, act: 1 } as const;
export const TEST_LABEL = { sat: "SAT", act: "ACT" } as const;

export { actToSat, satToAct };

export function positionIn(score: number, range: [number, number]): Position {
  if (score > range[1]) return "above";
  if (score < range[0]) return "below";
  return "in";
}

/** The college's range for the student's test, or the other test's range with the score concorded into it. */
export function readScore(test: NonNullable<StandingStudent["test"]>, school: Pick<StandingSchool, "sat" | "act">): { score: number; kind: TestKind; range: [number, number]; concorded: boolean } | null {
  const own = test.kind === "sat" ? school.sat : school.act;
  if (own) return { score: test.score, kind: test.kind, range: own, concorded: false };
  if (test.kind === "act" && school.sat) {
    const s = actToSat(test.score);
    return s === null ? null : { score: s, kind: "sat", range: school.sat, concorded: true };
  }
  if (test.kind === "sat" && school.act) {
    const a = satToAct(test.score);
    return a === null ? null : { score: a, kind: "act", range: school.act, concorded: true };
  }
  return null;
}

export const isOptionalPolicy = (p: TestPolicy) => p === null || p === "considered";
export const isRequiredPolicy = (p: TestPolicy) => p === "required" || p === "required-some" || p === "recommended";

/** A GPA to two decimals ("3.82"). */
export const gpaPoint = (g: number) => g.toFixed(2);
/** A GPA range to one decimal ("3.7–3.9"), or one number when both ends round alike. */
export function gpaSpan([lo, hi]: [number, number]): string {
  const a = lo.toFixed(1);
  const b = hi.toFixed(1);
  return a === b ? a : `${a}–${b}`;
}
/** A published GPA as printed, up to two decimals ("4.17", "4.3"). */
const trimGpa = (g: number) => String(Number(g.toFixed(2)));
/** The student's own span: one number for a point ("3.82"), else the range ("3.4–4.0"). */
const ownSpan = (r: [number, number]) => (r[0] === r[1] ? gpaPoint(r[0]) : gpaSpan(r));

/** The college's GPA as the standing model reads it: `gpa` when given, else `gpaAverage` as a reported point. */
function schoolGpa(school: StandingSchool): CollegeGpa {
  if (school.gpa) return school.gpa;
  const avg = school.gpaAverage;
  return avg !== null
    ? { kind: "reported", range: [avg, avg], point: avg, weighted: null, n: null }
    : { kind: "none", range: null, point: null, weighted: null, n: null };
}

const GPA_CITE: Record<Exclude<CollegeGpa["kind"], "none">, GpaCite> = {
  reported: "reported.admission_profile.gpa.average",
  bands: "derived.gpa_band_mean",
  estimated: "derived.gpa_estimate",
};

/** The GPA sentence's ⓘ and its note. */
export interface GpaStanding {
  position: Position | null;
  note: StandingResult["gpaNote"];
  /** The same sentence as a catalog note (cite = the GPA field), or null. */
  catalog: EstimateNote | null;
}

const note = (key: string, values: EstimateNote["values"], cite?: string | null): EstimateNote => (cite ? { key, values, cite } : { key, values });

/**
 * Where the student's GPA sits at this college, and the one sentence that says what was used (gpa.md "The design" 4
 * and 5). `testLabel` names the student's score when the college reads it ("SAT"), for the sentences that fall back
 * on it. No GPA from the student: no position and no sentence.
 */
export function gpaStanding(student: StandingStudent, school: StandingSchool, testLabel: string | null): GpaStanding {
  const own: [number, number] | null = student.gpaRange ?? (student.gpa !== null ? [student.gpa, student.gpa] : null);
  if (!own) return { position: null, note: null, catalog: null };
  const label = student.gpaLabel ?? gpaPoint(student.gpa ?? own[0]);
  // "Your GPA (3.82) is …"; a described range ("about 3.4–4.0 unweighted (from a weighted 4.4)") is set off by commas.
  const described = /^[\d.]+$/.test(label) ? 0 : 1;
  const yours = described ? `Your GPA, ${label},` : `Your GPA (${label})`;
  const college = schoolGpa(school);
  const test = testLabel ?? "";
  const onlyTest = testLabel ? `only your ${testLabel} is used` : "your GPA isn't used here";
  if (college.middle) return middleStanding(own, yours, label, described, college.middle, college.weighted, testLabel);

  if (college.kind === "none" || !college.range || college.point === null) {
    const text =
      college.weighted !== null
        ? `This college publishes only a weighted average (${trimGpa(college.weighted)}), which can't be compared with yours, and there aren't enough test scores to estimate an unweighted one, so ${onlyTest}.`
        : `This college doesn't publish a GPA average, and there aren't enough test scores to estimate one, so ${onlyTest}.`;
    const catalog = college.weighted !== null ? note("estimate.gpa.weighted_only", { weighted: trimGpa(college.weighted), test }) : note("estimate.gpa.none", { test });
    return { position: null, note: { text, cite: null }, catalog };
  }

  const cite = GPA_CITE[college.kind];
  const position = compareGpaRanges(own, college.range, STANDING.gpaBand);
  if (position === null) {
    const theirs = college.kind === "estimated" ? `its estimate (${gpaSpan(college.range)})` : `its average (${gpaPoint(college.point)})`;
    const decides = testLabel ? `Your ${testLabel} decides the group here.` : "There's no score to go on here either.";
    const catalog =
      college.kind === "estimated"
        ? note("estimate.gpa.cant_place_estimate", { own: ownSpan(own), span: gpaSpan(college.range), test }, cite)
        : note("estimate.gpa.cant_place_average", { own: ownSpan(own), avg: gpaPoint(college.point), test }, cite);
    return { position: null, note: { text: `Your GPA can't be placed against this college's: yours (${ownSpan(own)}) and ${theirs} overlap too much to say which is higher. ${decides}`, cite }, catalog };
  }
  const where = position === "in" ? "close to" : position;
  const values = { gpa: label, described, where };
  if (college.kind === "reported") {
    return { position, note: { text: `${yours} is ${where} the ${gpaPoint(college.point)} average of enrolled students.`, cite }, catalog: note("estimate.gpa.reported", { ...values, avg: gpaPoint(college.point) }, cite) };
  }
  if (college.kind === "bands") {
    return {
      position,
      note: { text: `${yours} is ${where} the ${gpaPoint(college.point)} average of enrolled students, figured from the college's GPA ranges.`, cite },
      catalog: note("estimate.gpa.bands", { ...values, avg: gpaPoint(college.point) }, cite),
    };
  }
  const why =
    college.weighted !== null
      ? `This college publishes only a weighted average (${trimGpa(college.weighted)}), so this is an estimate.`
      : "This college doesn't publish an unweighted average, so this is an estimate.";
  return {
    position,
    note: { text: `${yours} is ${where} the ${gpaSpan(college.range)} typical of colleges with similar test scores and admit rates. ${why}`, cite },
    catalog: note("estimate.gpa.estimated", { ...values, span: gpaSpan(college.range), weighted: college.weighted !== null ? trimGpa(college.weighted) : "" }, cite),
  };
}

/** A middle 50% as shown: two decimals when exact ("3.62–4.00"), one when estimated ("3.4–3.9"). */
function middleSpan(m: GpaMiddle): string {
  const digits = m.kind === "bands" ? 2 : 1;
  return `${m.shown[0].toFixed(digits)}–${m.shown[1].toFixed(digits)}`;
}

/**
 * The GPA position and sentence against the college's middle 50% (gpa.md "The design" 7): "Your GPA (3.82) is
 * inside the middle 50% of first-years' GPAs here (3.62–4.00).", with an estimate saying so.
 */
function middleStanding(own: [number, number], yours: string, label: string, described: number, middle: GpaMiddle, weighted: number | null, testLabel: string | null): GpaStanding {
  const cite: GpaCite = middle.kind === "bands" ? "derived.gpa_middle_half" : "derived.gpa_estimate";
  const span = middleSpan(middle);
  const estimated = middle.kind === "estimated" ? 1 : 0;
  const weightedText = weighted !== null ? trimGpa(weighted) : "";
  const estimate = estimated
    ? `, estimated from colleges with similar test scores; ${weighted !== null ? `this college publishes only a weighted average (${weightedText})` : "this college doesn't publish its GPA spread"}`
    : "";
  const position = compareGpaMiddle(own, middle);
  if (position === null) {
    const decides = testLabel ? `Your ${testLabel} decides the group here.` : "There's no score to go on here either.";
    return {
      position: null,
      note: { text: `Your GPA can't be placed against this college's: yours (${ownSpan(own)}) spans its middle 50% of first-years' GPAs (${span}${estimate}). ${decides}`, cite },
      catalog: note("estimate.gpa.cant_place_middle", { own: ownSpan(own), span, estimated, weighted: weightedText, test: testLabel ?? "" }, cite),
    };
  }
  const where = position === "in" ? "inside" : position;
  return {
    position,
    note: { text: `${yours} is ${where} the middle 50% of first-years' GPAs here (${span})${estimate}.`, cite },
    catalog: note(estimated ? "estimate.gpa.middle_estimated" : "estimate.gpa.middle", { gpa: label, described, where, span, weighted: weightedText }, cite),
  };
}

/** The score's part of the standing: its read, the send advice, and its sentences. */
export interface ScoreStanding {
  test: ScoreRead | null;
  send: SendAdvice | null;
  reasons: string[];
  notes: EstimateNote[];
}

/** Where the score stands (standing.md "The rules" 1). `optional` overrides the policy's test-optional reading. */
export function scoreStanding(student: StandingStudent, school: StandingSchool): ScoreStanding {
  const reasons: string[] = [];
  const notes: EstimateNote[] = [];
  let test: ScoreRead | null = null;
  let send: SendAdvice | null = null;
  if (student.test && school.testPolicy !== "not-considered") {
    const read = readScore(student.test, school);
    if (read) {
      const position = positionIn(read.score, read.range);
      // At a test-optional college a score under the middle 50% is assumed withheld: it neither helps nor counts.
      const used = !(isOptionalPolicy(school.testPolicy) && position === "below");
      test = { position, used, kind: read.kind, range: read.range, concorded: read.concorded };
      send = used ? "send" : "consider-not-sending";
      const label = TEST_LABEL[student.test.kind];
      const where = position === "above" ? "above" : position === "below" ? "below" : "inside";
      const via = read.concorded ? TEST_LABEL[read.kind] : "";
      reasons.push(`Your ${label} ${student.test.score} is ${where} the middle 50% of enrolled students${via ? ` (compared with its ${via} range through the official concordance)` : ""}.`);
      notes.push(note("estimate.score_position", { test: label, score: student.test.score, where, concorded: via }, scoreField(read.kind)));
      if (!used) {
        reasons.push("Scores are optional here; you might apply without yours.");
        notes.push(note("estimate.scores_optional", {}, "admissions.test_policy"));
      }
    }
  } else if (school.testPolicy === "not-considered") {
    send = "not-used";
    if (student.test) {
      reasons.push("This college doesn't look at test scores.");
      notes.push(note("estimate.test_blind", {}, "admissions.test_policy"));
    }
  }
  if (!student.test && isRequiredPolicy(school.testPolicy)) send = "required-missing";
  return { test, send, reasons, notes };
}

/** The field a score range cites. */
export const scoreField = (kind: TestKind) => (kind === "sat" ? "derived.sat_total" : "admissions.act_composite_25_75");

/**
 * The group from the known positions and an admit rate (standing.md "The rules" 3, the cases with positions):
 * every position above; any below; one above and the rest in; otherwise in.
 */
export function groupFromPositions(positions: readonly Position[], rate: number): Fit {
  if (positions.every((p) => p === "above")) return rate >= STANDING.likelyAtOrAbove ? "likely" : "target";
  if (positions.includes("below")) {
    // A college admitting most applicants is a Target for one weak measure, a Reach only when both are below.
    const allBelow = positions.length > 1 && positions.every((p) => p === "below");
    return rate >= STANDING.generousAtOrAbove && !allBelow ? "target" : "reach";
  }
  if (positions.includes("above") && rate >= STANDING.likelyMixedAtOrAbove) return "likely";
  return rate >= STANDING.generousAtOrAbove ? "likely" : "target";
}

/** Reach / Target / Likely for one college (specs/planner/redesign/standing.md "The rules"). */
export function standingFor(student: StandingStudent, school: StandingSchool): StandingResult {
  const score = scoreStanding(student, school);
  const { test, send } = score;
  const reasons = [...score.reasons];
  const notes = [...score.notes];

  const gpaRead = gpaStanding(student, school, test && student.test ? TEST_LABEL[student.test.kind] : null);
  const { position: gpa, note: gpaNote } = gpaRead;
  if (gpaNote) reasons.push(gpaNote.text);
  if (gpaRead.catalog) notes.push(gpaRead.catalog);

  const result = (fit: Fit | null, reachForEveryone = false): StandingResult => ({ fit, reachForEveryone, test, gpa, gpaNote, send, reasons, notes });

  if (school.admitRate === null) {
    reasons.unshift("Admits everyone who applies.");
    notes.unshift(note("estimate.open_admission", {}));
    return result("likely");
  }
  if (school.admitRate < STANDING.reachForEveryoneBelow) {
    reasons.unshift("Admits fewer than 1 in 5 applicants, so it's a Reach for everyone.");
    notes.unshift(note("estimate.reach_for_everyone", {}, "admissions.acceptance_rate"));
    return result("reach", true);
  }

  const positions: Position[] = [...(test?.used ? [test.position] : []), ...(gpa ? [gpa] : [])];
  // A withheld score is still the only measure when the college reports no GPA to compare with.
  if (positions.length === 0 && test) positions.push(test.position);
  if (positions.length === 0) return result(null);
  return result(groupFromPositions(positions, school.admitRate));
}

export const FIT_RANK: Record<Fit, number> = { reach: 0, target: 1, likely: 2 };

export interface MoveUp {
  /** The lowest score (on the student's own test) that moves the college up a group. */
  score: number;
  delta: number;
  from: Fit;
  to: Fit;
}

/**
 * The fewest points on the student's own test that would move this college up one group, holding GPA; null when
 * the college is already Likely, a Reach for everyone, test-blind, or no score up to the maximum would move it.
 */
export function scoreToMoveUp(student: StandingStudent, school: StandingSchool): MoveUp | null {
  if (!student.test) return null;
  const now = standingFor(student, school);
  if (!now.fit || now.fit === "likely" || now.reachForEveryone || school.testPolicy === "not-considered") return null;
  const { kind, score } = student.test;
  for (let s = score + TEST_STEP[kind]; s <= TEST_MAX[kind]; s += TEST_STEP[kind]) {
    const next = standingFor({ ...student, test: { kind, score: s } }, school);
    if (next.fit && FIT_RANK[next.fit] > FIT_RANK[now.fit]) return { score: s, delta: s - score, from: now.fit, to: next.fit };
  }
  return null;
}

export interface RetakeSuggestion {
  kind: TestKind;
  /** The increase that makes every listed move (the largest one needed, within RETAKE_REACH). */
  delta: number;
  target: number;
  moves: { id: string; from: Fit; to: Fit; needed: number }[];
}

/**
 * The retake card from moves already worked out (scores.md "When to suggest another test"): every move within a
 * common retake gain, smallest first, and the largest number needed among them. Null when none.
 */
export function retakeFromMoves(test: { kind: TestKind; score: number }, moves: { id: string; up: MoveUp | null }[]): RetakeSuggestion | null {
  const counted = moves
    .filter((m): m is { id: string; up: MoveUp } => m.up !== null && m.up.delta > 0 && m.up.delta <= RETAKE_REACH[test.kind])
    .map(({ id, up }) => ({ id, from: up.from, to: up.to, needed: up.delta }))
    .sort((a, b) => a.needed - b.needed);
  if (counted.length === 0) return null;
  const delta = counted[counted.length - 1].needed;
  return { kind: test.kind, delta, target: Math.min(test.score + delta, TEST_MAX[test.kind]), moves: counted };
}

/**
 * Whether another test is worth suggesting across the list (scores.md "When to suggest another test"): the moves a
 * common retake gain would make, smallest first. Null when no college on the list moves within RETAKE_REACH.
 */
export function retakeSuggestion(student: StandingStudent, schools: { id: string; school: StandingSchool }[]): RetakeSuggestion | null {
  if (!student.test) return null;
  return retakeFromMoves(student.test, schools.map(({ id, school }) => ({ id, up: scoreToMoveUp(student, school) })));
}

/** Counts per group for the list's balance line ("2 Reach · 3 Target · 2 Likely"). */
export function balance(fits: (Fit | null)[]): Record<Fit, number> {
  const out: Record<Fit, number> = { reach: 0, target: 0, likely: 0 };
  for (const f of fits) if (f) out[f]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* The college and the student as the baseline reads them              */
/* ------------------------------------------------------------------ */

/**
 * The college's average first-year GPA as the standing model reads it (standing.md "The rules"): only an unweighted
 * average on the 4.0 scale (CDS C12), else null.
 */
export function standingGpaAverage(school: Pick<School, "reported">): number | null {
  const gpa = school.reported?.admission_profile?.gpa;
  return gpa?.average != null && gpa.average <= 4 && gpa.scale !== "weighted" ? gpa.average : null;
}

/** The standing model's inputs for a college (the same slice lib/planner/context.ts planSchoolFor builds). */
export function standingSchoolFor(school: School, gpaModel: GpaModel | null = null, gpaCurve: GpaCurve | null = null): StandingSchool {
  return {
    admitRate: school.admissions?.acceptance_rate ?? null,
    sat: satTotal(school),
    act: school.admissions?.act_composite_25_75 ?? null,
    gpaAverage: standingGpaAverage(school),
    gpa: collegeGpa(school, gpaModel, gpaCurve),
    testPolicy: school.admissions?.test_policy ?? null,
  };
}

const trimNumber = (n: number) => String(Number(n.toFixed(2)));

/**
 * How the sentences show an estimate input's GPA: "3.82" for an unweighted point; "about 3.4–4.0 unweighted (from a
 * weighted 4.4)" for a weighted one (whose range is [w − 1, min(4, w)], so w is recovered from it); "about 3.7
 * unweighted (from a 100-point scale)".
 */
export function gpaLabelOf(student: Pick<EstimateStudent, "gpa" | "gpaScale" | "gpaRange">): string | null {
  const range = student.gpaRange ?? (student.gpa !== null ? ([student.gpa, student.gpa] as [number, number]) : null);
  if (!range) return null;
  if (range[0] === range[1]) return student.gpaScale === "100" ? `about ${range[0].toFixed(1)} unweighted (from a 100-point scale)` : gpaPoint(range[0]);
  const weighted = range[1] < 4 ? range[1] : range[0] + 1;
  return `about ${range[0].toFixed(1)}–${range[1].toFixed(1)} unweighted (from a weighted ${trimNumber(weighted)})`;
}

/** The estimate's student as the standing rules read them. */
export function standingStudentOf(student: Pick<EstimateStudent, "gpa" | "gpaScale" | "gpaRange" | "test">): StandingStudent {
  const range = student.gpaRange ?? (student.gpa !== null ? ([student.gpa, student.gpa] as [number, number]) : null);
  return { gpa: student.gpa, gpaRange: range, gpaLabel: gpaLabelOf(student), test: student.test };
}

/* ------------------------------------------------------------------ */
/* The baseline behind the estimate's contract                         */
/* ------------------------------------------------------------------ */

/** The facts the baseline's result rests on (registered field paths). */
function baselineFacts(r: StandingResult, school: StandingSchool): string[] {
  const out: string[] = [];
  if (school.admitRate !== null) out.push("admissions.acceptance_rate");
  if (r.test) out.push(scoreField(r.test.kind));
  if (school.testPolicy !== null && (r.send !== null || r.test)) out.push("admissions.test_policy");
  if (r.gpaNote?.cite) out.push(r.gpaNote.cite);
  return [...new Set(out)];
}

/** The inputs the baseline used and the ones it would have used (GPA and the one test only). */
function baselineInputs(student: StandingStudent, school: StandingSchool, r: StandingResult): { used: InputKind[]; missing: InputKind[] } {
  const used: InputKind[] = [];
  const missing: InputKind[] = [];
  if (r.gpa !== null) used.push("gpa");
  if (r.test?.used) used.push("test");
  const college = school.gpa ?? (school.gpaAverage !== null ? { kind: "reported" } : { kind: "none" });
  if (student.gpa === null && !student.gpaRange && college.kind !== "none") missing.push("gpa");
  if (!student.test && school.testPolicy !== "not-considered" && (school.sat || school.act || isRequiredPolicy(school.testPolicy))) missing.push("test");
  return { used, missing };
}

/** The baseline's answer for one college as an EstimateResult (estimate.md "The open baseline"). */
export function baselineEstimate(input: Pick<EstimateStudent, "gpa" | "gpaScale" | "gpaRange" | "test">, school: StandingSchool, unitId: string): EstimateResult {
  const student = standingStudentOf(input);
  const r = standingFor(student, school);
  const up = scoreToMoveUp(student, school);
  const { used, missing } = baselineInputs(student, school, r);
  return {
    unitId,
    group: r.fit,
    label: r.reachForEveryone ? "reach-for-everyone" : null,
    used,
    missing,
    facts: baselineFacts(r, school),
    notes: r.notes,
    send: r.send,
    moveUp: up && up.to !== "reach" ? { points: up.delta, to: up.to, score: up.score } : null,
    modelVersion: BASELINE_VERSION,
  };
}

/** The baseline for several colleges at once (the design preview, tests). */
export function baselineEstimates(input: Pick<EstimateStudent, "gpa" | "gpaScale" | "gpaRange" | "test">, schools: Record<string, StandingSchool>): Record<string, EstimateResult> {
  return Object.fromEntries(Object.entries(schools).map(([id, s]) => [id, baselineEstimate(input, s, id)]));
}
