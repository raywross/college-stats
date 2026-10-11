/**
 * POST /api/estimate's request and response rules (specs/chances/estimate.md "Protecting the method"; owner
 * assumption 4): the body is validated and sanitized here (reusing lib/student-profile.ts's sanitizers), a signed-out
 * caller may ask about up to 20 colleges and a signed-in one up to 25, a counterfactual ("this score", "this course
 * added") changes the student before the estimate runs, and a response carries only the contract's fields. Pure, so
 * tests drive it directly; app/api/estimate/route.ts wires it to the session, the limiter, and the estimate.
 */
import { isUnitId } from "../follow-state.ts";
import { isHighSchoolId } from "../high-school-core.ts";
import { isMajorFamily } from "../majors.ts";
import { MAX_INTENDED_MAJORS, OUTSIDE_US, sanitizeCourses } from "../student-profile.ts";
import { UNDECIDED_MAJOR } from "./major-review.ts";
import { isNoteKey } from "./notes.ts";
import type { CourseEntry, EstimateNote, EstimateResult, EstimateStudent, InputKind } from "./types.ts";

/** Colleges per call (owner assumption 4): the signed-out plan holds up to 20; a signed-in caller may ask 25. */
export const MAX_COLLEGES = { signedOut: 20, signedIn: 25 } as const;

export interface Counterfactual {
  /** The student's own test at this score instead. */
  score?: number;
  /** This course added to the list (or replacing the row with its id). */
  addCourse?: CourseEntry;
}

export interface EstimateRequest {
  student: EstimateStudent;
  unitIds: string[];
  counterfactual: Counterfactual | null;
}

export type ParseResult = { ok: true; request: EstimateRequest } | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const intIn = (v: unknown, lo: number, hi: number): number | null => (finite(v) && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const numIn = (v: unknown, lo: number, hi: number): number | null => (finite(v) && v >= lo && v <= hi ? v : null);

const GPA_SCALES = ["4.0", "5.0", "100"] as const;
const ROUNDS = ["ed", "ed2", "ea", "rea", "rd", "rolling"] as const;
export const TEST_RANGE = { sat: [400, 1600], act: [1, 36] } as const;

/** The student's numbers, as much as is valid; anything malformed is dropped (null or empty), never an error. */
export function sanitizeEstimateStudent(input: unknown): EstimateStudent {
  const v = isObj(input) ? input : {};
  const gpaScale = GPA_SCALES.includes(v.gpaScale as (typeof GPA_SCALES)[number]) ? (v.gpaScale as string) : "4.0";
  const r = Array.isArray(v.gpaRange) && v.gpaRange.length === 2 ? [numIn(v.gpaRange[0], 0, 4), numIn(v.gpaRange[1], 0, 4)] : null;
  const gpaRange: [number, number] | null = r && r[0] !== null && r[1] !== null && r[0] <= r[1] ? [r[0], r[1]] : null;
  let test: EstimateStudent["test"] = null;
  if (isObj(v.test) && (v.test.kind === "sat" || v.test.kind === "act")) {
    const [lo, hi] = TEST_RANGE[v.test.kind];
    const score = intIn(v.test.score, lo, hi);
    if (score !== null) test = { kind: v.test.kind, score };
  }
  const state = typeof v.state === "string" ? v.state.trim().toUpperCase() : "";
  const majors = Array.isArray(v.majors)
    ? [...new Set(v.majors.filter((m): m is string => typeof m === "string" && (m === UNDECIDED_MAJOR || isMajorFamily(m))))].slice(0, MAX_INTENDED_MAJORS)
    : [];
  return {
    gpa: numIn(v.gpa, 0, 4),
    gpaScale,
    gpaRange,
    test,
    satMath: intIn(v.satMath, 200, 800),
    actMath: intIn(v.actMath, 1, 36),
    classRankPercentile: intIn(v.classRankPercentile, 1, 100),
    courses: Array.isArray(v.courses) ? sanitizeCourses(v.courses) : [],
    state: /^[A-Z]{2}$/.test(state) || state === OUTSIDE_US ? state : null,
    majors,
    round: ROUNDS.includes(v.round as (typeof ROUNDS)[number]) ? (v.round as string) : null,
    highSchoolId: typeof v.highSchoolId === "string" && isHighSchoolId(v.highSchoolId) ? v.highSchoolId : null,
    practice: v.practice === true,
  };
}

/** Validates a POST body. Colleges beyond the caller's limit are refused, not silently dropped. */
export function parseEstimateRequest(body: unknown, opts: { signedIn: boolean }): ParseResult {
  if (!isObj(body)) return { ok: false, message: "Send a JSON object with student and unitIds." };
  if (!Array.isArray(body.unitIds)) return { ok: false, message: "unitIds must be a list of college ids." };
  const unitIds = [...new Set(body.unitIds.filter(isUnitId))];
  if (unitIds.length === 0) return { ok: false, message: "unitIds must name at least one college." };
  const max = opts.signedIn ? MAX_COLLEGES.signedIn : MAX_COLLEGES.signedOut;
  if (unitIds.length > max) return { ok: false, message: `Ask about at most ${max} colleges at once${opts.signedIn ? "" : " (sign in for more)"}.` };
  const student = sanitizeEstimateStudent(body.student);

  let counterfactual: Counterfactual | null = null;
  if (body.counterfactual !== undefined && body.counterfactual !== null) {
    if (!isObj(body.counterfactual)) return { ok: false, message: "counterfactual must be an object." };
    const cf: Counterfactual = {};
    if (body.counterfactual.score !== undefined) {
      if (!student.test) return { ok: false, message: "A score counterfactual needs the student's test." };
      const [lo, hi] = TEST_RANGE[student.test.kind];
      const score = intIn(body.counterfactual.score, lo, hi);
      if (score === null) return { ok: false, message: "That score is out of range for the test." };
      cf.score = score;
    }
    if (body.counterfactual.addCourse !== undefined) {
      const [course] = sanitizeCourses([body.counterfactual.addCourse]);
      if (!course) return { ok: false, message: "That course isn't valid." };
      cf.addCourse = course;
    }
    if (cf.score !== undefined || cf.addCourse) counterfactual = cf;
  }
  return { ok: true, request: { student, unitIds, counterfactual } };
}

/** The student as the counterfactual describes them. */
export function withCounterfactual(student: EstimateStudent, cf: Counterfactual | null | undefined): EstimateStudent {
  if (!cf) return student;
  let next = student;
  if (cf.score !== undefined && next.test) next = { ...next, test: { kind: next.test.kind, score: cf.score } };
  if (cf.addCourse) {
    const add = cf.addCourse;
    next = { ...next, courses: [...next.courses.filter((c) => c.id !== add.id), add] };
  }
  return next;
}

/** A request's cost in tokens: one per five colleges (a list of 20 costs 4), so bulk asking drains the bucket faster. */
export function requestCost(unitIds: readonly string[]): number {
  return Math.max(1, Math.ceil(unitIds.length / 5));
}

/** Exactly the contract's fields, in order: a response never carries anything else (no detail, no internals). */
export const RESULT_FIELDS = ["unitId", "group", "label", "used", "missing", "facts", "notes", "send", "moveUp", "modelVersion"] as const satisfies readonly (keyof EstimateResult)[];

const GROUPS = new Set(["reach", "target", "likely"]);
const LABELS = new Set(["reach-for-everyone", "guaranteed"]);
const SENDS = new Set(["send", "consider-not-sending", "required-missing", "not-used"]);
const INPUTS = new Set<InputKind>(["gpa", "test", "sections", "class_rank", "courses", "subject_grades", "state", "major", "round", "high_school"]);

function publicNote(n: EstimateNote): EstimateNote | null {
  if (!isNoteKey(n.key)) return null;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(n.values ?? {})) if (typeof v === "string" || finite(v)) values[k] = v;
  return typeof n.cite === "string" ? { key: n.key, values, cite: n.cite } : { key: n.key, values };
}

/** A result rebuilt from the contract's fields only, with notes from the catalog only. */
export function publicResult(r: EstimateResult): EstimateResult {
  return {
    unitId: String(r.unitId),
    group: r.group && GROUPS.has(r.group) ? r.group : null,
    label: r.label && LABELS.has(r.label) ? r.label : null,
    used: (r.used ?? []).filter((k) => INPUTS.has(k)),
    missing: (r.missing ?? []).filter((k) => INPUTS.has(k)),
    facts: (r.facts ?? []).filter((f): f is string => typeof f === "string"),
    notes: (r.notes ?? []).map(publicNote).filter((n): n is EstimateNote => n !== null),
    send: r.send && SENDS.has(r.send) ? r.send : null,
    moveUp: r.moveUp && finite(r.moveUp.points) && finite(r.moveUp.score) && (r.moveUp.to === "target" || r.moveUp.to === "likely") ? { points: r.moveUp.points, to: r.moveUp.to, score: r.moveUp.score } : null,
    modelVersion: String(r.modelVersion),
  };
}
