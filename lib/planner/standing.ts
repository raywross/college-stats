/**
 * Where a student stands at one college, from their numbers (specs/planner/redesign/standing.md): Reach / Target /
 * Likely with the positions behind it, whether to send the score, and how many points would move the college up a
 * group. Pure (no server or browser APIs) so the Plan page, the score coach, and the design preview run the same
 * rules, in the browser as the student types.
 *
 * A classification with published rules, never a probability (specs/product/chances-and-fit.md). The student takes
 * one test (SAT or ACT); a college that reports only the other test's range is compared through the 2018 ACT/SAT
 * concordance, and the result says so.
 */
import type { TestPolicy } from "../types.ts";
import { actToSat, satToAct } from "./concordance.ts";
import { compareGpaRanges, type CollegeGpa } from "./gpa-model.ts";

export type TestKind = "sat" | "act";
export type Fit = "reach" | "target" | "likely";
export type Position = "below" | "in" | "above";
/** What to do with the score at this college: test-blind colleges don't use it; test-optional ones may not need it. */
export type SendAdvice = "send" | "consider-not-sending" | "required-missing" | "not-used";

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
export type GpaCite = "reported.admission_profile.gpa.average" | "derived.gpa_band_mean" | "derived.gpa_estimate";

export interface StandingResult {
  fit: Fit | null;
  /** Admits fewer than 1 in 5: a Reach whatever the numbers. */
  reachForEveryone: boolean;
  /** Where the score sits in the college's middle 50%, when the college reports a range the score can be read against. */
  test: { position: Position; used: boolean; kind: TestKind; range: [number, number]; concorded: boolean } | null;
  gpa: Position | null;
  /**
   * The one GPA sentence (gpa.md "Saying what was used"), whenever the student gave a GPA; it is also the last of
   * `reasons`. `cite` is the field its ⓘ cites (null when the college has no GPA to cite).
   */
  gpaNote: { text: string; cite: GpaCite | null } | null;
  send: SendAdvice | null;
  /** Short sentences, no years (the caller cites the values with their editions). */
  reasons: string[];
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

/** The 2018 ACT/SAT concordance now lives in ./concordance.ts (shared with the GPA model); re-exported here. */
export { actToSat, satToAct };

function positionIn(score: number, range: [number, number]): Position {
  if (score > range[1]) return "above";
  if (score < range[0]) return "below";
  return "in";
}

/** The college's range for the student's test, or the other test's range with the score concorded into it. */
function readScore(test: NonNullable<StandingStudent["test"]>, school: StandingSchool): { score: number; kind: TestKind; range: [number, number]; concorded: boolean } | null {
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

const optional = (p: TestPolicy) => p === null || p === "considered";
const required = (p: TestPolicy) => p === "required" || p === "required-some" || p === "recommended";

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

/**
 * Where the student's GPA sits at this college, and the one sentence that says what was used (gpa.md "The design" 4
 * and 5). `testLabel` names the student's score when the college reads it ("SAT"), for the sentences that fall back
 * on it. No GPA from the student: no position and no sentence.
 */
function gpaStanding(student: StandingStudent, school: StandingSchool, testLabel: string | null): { position: Position | null; note: StandingResult["gpaNote"] } {
  const own: [number, number] | null = student.gpaRange ?? (student.gpa !== null ? [student.gpa, student.gpa] : null);
  if (!own) return { position: null, note: null };
  const label = student.gpaLabel ?? gpaPoint(student.gpa ?? own[0]);
  // "Your GPA (3.82) is …"; a described range ("about 3.4–4.0 unweighted (from a weighted 4.4)") is set off by commas.
  const yours = /^[\d.]+$/.test(label) ? `Your GPA (${label})` : `Your GPA, ${label},`;
  const college = schoolGpa(school);
  const onlyTest = testLabel ? `only your ${testLabel} is used` : "your GPA isn't used here";

  if (college.kind === "none" || !college.range || college.point === null) {
    const text =
      college.weighted !== null
        ? `This college publishes only a weighted average (${trimGpa(college.weighted)}), which can't be compared with yours, and there aren't enough test scores to estimate an unweighted one, so ${onlyTest}.`
        : `This college doesn't publish a GPA average, and there aren't enough test scores to estimate one, so ${onlyTest}.`;
    return { position: null, note: { text, cite: null } };
  }

  const cite = GPA_CITE[college.kind];
  const position = compareGpaRanges(own, college.range, STANDING.gpaBand);
  if (position === null) {
    const theirs = college.kind === "estimated" ? `its estimate (${gpaSpan(college.range)})` : `its average (${gpaPoint(college.point)})`;
    const decides = testLabel ? `Your ${testLabel} decides the group here.` : "There's no score to go on here either.";
    return { position: null, note: { text: `Your GPA can't be placed against this college's: yours (${ownSpan(own)}) and ${theirs} overlap too much to say which is higher. ${decides}`, cite } };
  }
  const where = position === "in" ? "close to" : position;
  if (college.kind === "reported") return { position, note: { text: `${yours} is ${where} the ${gpaPoint(college.point)} average of enrolled students.`, cite } };
  if (college.kind === "bands") {
    return { position, note: { text: `${yours} is ${where} the ${gpaPoint(college.point)} average of enrolled students, figured from the college's GPA ranges.`, cite } };
  }
  const why =
    college.weighted !== null
      ? `This college publishes only a weighted average (${trimGpa(college.weighted)}), so this is an estimate.`
      : "This college doesn't publish an unweighted average, so this is an estimate.";
  return { position, note: { text: `${yours} is ${where} the ${gpaSpan(college.range)} typical of colleges with similar test scores and admit rates. ${why}`, cite } };
}

/** Reach / Target / Likely for one college (specs/planner/redesign/standing.md "The rules"). */
export function standingFor(student: StandingStudent, school: StandingSchool): StandingResult {
  const reasons: string[] = [];
  let test: StandingResult["test"] = null;
  let send: SendAdvice | null = null;

  if (student.test && school.testPolicy !== "not-considered") {
    const read = readScore(student.test, school);
    if (read) {
      const position = positionIn(read.score, read.range);
      // At a test-optional college a score under the middle 50% is assumed withheld: it neither helps nor counts.
      const used = !(optional(school.testPolicy) && position === "below");
      test = { position, used, kind: read.kind, range: read.range, concorded: read.concorded };
      send = used ? "send" : "consider-not-sending";
      const label = TEST_LABEL[student.test.kind];
      const where = position === "above" ? "above" : position === "below" ? "below" : "inside";
      reasons.push(
        `Your ${label} ${student.test.score} is ${where} the middle 50% of enrolled students${read.concorded ? ` (compared with its ${TEST_LABEL[read.kind]} range through the official concordance)` : ""}.`,
      );
      if (!used) reasons.push("Scores are optional here; you might apply without yours.");
    }
  } else if (school.testPolicy === "not-considered") {
    send = "not-used";
    if (student.test) reasons.push("This college doesn't look at test scores.");
  }
  if (!student.test && required(school.testPolicy)) send = "required-missing";

  const { position: gpa, note: gpaNote } = gpaStanding(student, school, test && student.test ? TEST_LABEL[student.test.kind] : null);
  if (gpaNote) reasons.push(gpaNote.text);

  const result = (fit: Fit | null, reachForEveryone = false): StandingResult => ({ fit, reachForEveryone, test, gpa, gpaNote, send, reasons });

  if (school.admitRate === null) {
    reasons.unshift("Admits everyone who applies.");
    return result("likely");
  }
  if (school.admitRate < STANDING.reachForEveryoneBelow) {
    reasons.unshift("Admits fewer than 1 in 5 applicants, so it's a Reach for everyone.");
    return result("reach", true);
  }

  const positions: Position[] = [...(test?.used ? [test.position] : []), ...(gpa ? [gpa] : [])];
  // A withheld score is still the only measure when the college reports no GPA to compare with.
  if (positions.length === 0 && test) positions.push(test.position);
  if (positions.length === 0) return result(null);

  const rate = school.admitRate;
  if (positions.every((p) => p === "above")) return result(rate >= STANDING.likelyAtOrAbove ? "likely" : "target");
  if (positions.includes("below")) {
    // A college admitting most applicants is a Target for one weak measure, a Reach only when both are below.
    const bothBelow = positions.length > 1 && positions.every((p) => p === "below");
    return result(rate >= STANDING.generousAtOrAbove && !bothBelow ? "target" : "reach");
  }
  if (positions.includes("above") && rate >= STANDING.likelyMixedAtOrAbove) return result("likely");
  return result(rate >= STANDING.generousAtOrAbove ? "likely" : "target");
}

const RANK: Record<Fit, number> = { reach: 0, target: 1, likely: 2 };

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
    if (next.fit && RANK[next.fit] > RANK[now.fit]) return { score: s, delta: s - score, from: now.fit, to: next.fit };
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
 * Whether another test is worth suggesting across the list (scores.md "When to suggest another test"): the moves a
 * common retake gain would make, smallest first. Null when no college on the list moves within RETAKE_REACH.
 */
export function retakeSuggestion(student: StandingStudent, schools: { id: string; school: StandingSchool }[]): RetakeSuggestion | null {
  if (!student.test) return null;
  const { kind, score } = student.test;
  const moves = schools
    .map(({ id, school }) => ({ id, up: scoreToMoveUp(student, school) }))
    .filter((m): m is { id: string; up: MoveUp } => m.up !== null && m.up.delta <= RETAKE_REACH[kind])
    .map(({ id, up }) => ({ id, from: up.from, to: up.to, needed: up.delta }))
    .sort((a, b) => a.needed - b.needed);
  if (moves.length === 0) return null;
  const delta = moves[moves.length - 1].needed;
  return { kind, delta, target: Math.min(score + delta, TEST_MAX[kind]), moves };
}

/** Counts per group for the list's balance line ("2 Reach · 3 Target · 2 Likely"). */
export function balance(fits: (Fit | null)[]): Record<Fit, number> {
  const out: Record<Fit, number> = { reach: 0, target: 0, likely: 0 };
  for (const f of fits) if (f) out[f]++;
  return out;
}
