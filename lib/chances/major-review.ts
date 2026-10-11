/**
 * How the intended major is read at a college (specs/chances/major-and-grades.md): from the unit's quoted `review`
 * in data/major-admission.json, the checks a family can see for themselves. Which unit the student's first intended
 * major applies to, whether the college compares applicants within it, the subjects it names (with the student's
 * subject GPAs from the course list), its required courses checked against the list (taken, in progress, or planned
 * counts as met), and its score requirement ("gate") checked against the list's AP and IB exam scores and the SAT/ACT
 * math sections, each with its public note (lib/chances/notes.ts).
 *
 * Pure and client-safe: the only numbers here are the college's own published ones (a gate's scores). How any of this
 * moves an estimate is the method's (specs/chances/method/major-effects.md, server-only, unit U5); this module only
 * exposes what the college said and what the student's record shows. Nothing is inferred: a unit without a statement
 * says nothing, and a student with no intended major gets an empty reading.
 */
import type { School } from "../types";
import { majorFamilyName } from "../majors.ts";
import { subjectGpa } from "../student-profile.ts";
import { catalogCourse } from "./catalog.ts";
import { majorUnitFor, majorUnitsFor, universityStatement, type CuratedMajorUnit } from "./major-admission.ts";
import { admitsSeparately } from "./pool-rate.ts";
import type { CourseEntry, CourseSubject, EstimateNote, EstimateStudent, MajorConsidered, MajorEmphasis, MajorGateKind, MajorReview } from "./types.ts";

/** The value a student's `majors[0]` holds when they say they're undecided (an empty list means no major given). */
export const UNDECIDED_MAJOR = "undecided";

export type MajorReviewStudent = Pick<EstimateStudent, "majors" | "courses" | "satMath" | "actMath">;
export type MajorReviewSchool = Pick<School, "unit_id" | "name">;

/** Field paths the major's facts cite (lib/fields.ts). */
export const MAJOR_FIELDS = {
  considered: "reported.major_admission.review.major_considered",
  emphasis: "reported.major_admission.review.emphasis",
  required: "reported.major_admission.review.required_courses",
  gate: "reported.major_admission.review.gate",
} as const;

/**
 * Math- and science-heavy families (major-and-grades.md "The student's side"): computer science, engineering,
 * engineering technologies, math and statistics, physical sciences, biology, health professions. For these the course
 * picker also offers the student's regular math and science courses.
 */
export const STEM_FAMILIES: readonly string[] = ["11", "14", "15", "26", "27", "40", "51"];
export const isStemFamily = (family: string | null | undefined): boolean => !!family && STEM_FAMILIES.includes(family);

/** The course subject a college's named emphasis reads. */
export const EMPHASIS_SUBJECT: Record<MajorEmphasis, CourseSubject> = { math: "math", science: "science", cs: "cs", writing: "english", arts: "arts" };
const EMPHASIS_WORDS: Record<MajorEmphasis, string> = { math: "math", science: "science", cs: "computer science", writing: "writing", arts: "arts" };

export interface RequiredCourseCheck {
  subject: CourseSubject;
  level: string;
  quote: string;
  /** On the list as taken, in progress, or planned. */
  met: boolean;
  /** The course that meets it, or null. */
  course: CourseEntry | null;
}

/** One route through a gate: "met"; "pending" (the course is on the list without an exam score yet); "below" (a score under it); "absent" (no score or course). */
export type GateRouteStatus = "met" | "pending" | "below" | "absent";
export interface GateRouteCheck {
  kind: MajorGateKind;
  course?: string;
  min: number;
  /** "SAT Math 620+", "AP Calculus AB 3+". */
  label: string;
  status: GateRouteStatus;
  /** The student's best score on this route, or null. */
  value: number | null;
  /** For "met": the route as the note names it, "AP Calculus AB (4)" or "SAT Math (650)". */
  via: string | null;
}
/** "met": a route is met; "not_yet": none is, and testing is still open; "closed": none is and none can be (the caller says testing is over). */
export type GateStatus = "met" | "not_yet" | "closed";
export interface GateCheck {
  status: GateStatus;
  routes: GateRouteCheck[];
  metBy: GateRouteCheck | null;
}

export interface MajorReviewOptions {
  /**
   * True when no more test or exam scores can count for this application (the caller knows the season). Only then can
   * a gate be "closed"; otherwise a section score can still be retaken and the gate is "not_yet".
   */
  testingClosed?: boolean;
}

export interface MajorReviewReading {
  /** The student's first intended major (a two-digit family), or null for none or undecided. */
  family: string | null;
  undecided: boolean;
  /** The school or major that family applies to here, or null. */
  unit: CuratedMajorUnit | null;
  /** The college's university-level statement, or null. */
  statement: CuratedMajorUnit | null;
  /** How the major is considered for this student: the unit's own statement first, else the university's; null when neither says. */
  considered: MajorConsidered | null;
  /** The entry `considered` and `emphasis` come from (to cite it), or null. */
  source: CuratedMajorUnit | null;
  emphasis: MajorEmphasis[];
  /** The student's GPA in each emphasized subject (subjectGpa), null when no graded course in it. */
  subjectGpas: Partial<Record<CourseSubject, number | null>>;
  requiredCourses: RequiredCourseCheck[];
  gate: GateCheck | null;
  /** Public lines, in order: how the major is considered, the emphasis, required courses, the gate (or undecided). */
  notes: EstimateNote[];
  /** For "What you'll need in high school": "Engineering also requires: calculus, physics, chemistry", or null. */
  unitRequires: EstimateNote | null;
  /** Every field path the notes cite. */
  facts: string[];
}

/** A course's name as printed: the catalog's for AP and IB, the student's own otherwise; "" for a placeholder row. */
export function courseName(c: Pick<CourseEntry, "key" | "name">): string {
  return (c.key ? catalogCourse(c.key)?.name : null) ?? c.name ?? "";
}

/** Catalog courses that cover a level without naming it (IB Mathematics: Analysis and Approaches teaches calculus). */
const LEVEL_KEYS: Record<string, readonly string[]> = {
  calculus: ["ap_calculus_ab", "ap_calculus_bc", "ib_math_aa_hl", "ib_math_aa_sl", "ib_math_ai_hl"],
  precalculus: ["ap_precalculus", "ap_calculus_ab", "ap_calculus_bc", "ib_math_aa_hl", "ib_math_aa_sl", "ib_math_ai_hl"],
};
/** Words a course name carries for a level; a later course counts for an earlier one (calculus meets precalculus). */
const LEVEL_WORDS: Record<string, readonly string[]> = {
  calculus: ["calculus", "calc"],
  precalculus: ["precalculus", "pre-calculus", "precalc", "calculus", "calc"],
  physics: ["physics"],
  chemistry: ["chemistry", "chem"],
  biology: ["biology", "bio"],
  statistics: ["statistics", "stats"],
};

/** Whether a course on the list meets a required level ("calculus", "physics") in a subject. */
export function meetsLevel(c: Pick<CourseEntry, "key" | "name" | "subject">, subject: CourseSubject, level: string): boolean {
  const lv = level.trim().toLowerCase();
  if (c.key && LEVEL_KEYS[lv]?.includes(c.key)) return true;
  if (c.subject !== subject) return false;
  const name = courseName(c).toLowerCase();
  if (!name) return false;
  // "Pre-Calculus" isn't calculus.
  if (lv === "calculus" && /\bpre-?\s?calc/.test(name)) return false;
  const words = LEVEL_WORDS[lv] ?? [lv];
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(name));
}

/** Each of a review's required courses checked against the list: taken, in progress, or planned counts as met. */
export function checkRequiredCourses(review: Pick<MajorReview, "required_courses">, courses: readonly CourseEntry[]): RequiredCourseCheck[] {
  return review.required_courses.map((r) => {
    const course = courses.find((c) => meetsLevel(c, r.subject, r.level)) ?? null;
    return { subject: r.subject, level: r.level, quote: r.quote, met: course !== null, course };
  });
}

const SECTION_LABEL: Record<"sat_math" | "act_math", string> = { sat_math: "SAT Math", act_math: "ACT Math" };

/** A gate checked against the course list's exam scores and the math section scores (see GateStatus). */
export function checkGate(gate: NonNullable<MajorReview["gate"]>, student: Pick<MajorReviewStudent, "courses" | "satMath" | "actMath">, opts: MajorReviewOptions = {}): GateCheck {
  const routes: GateRouteCheck[] = gate.any_of.map((g) => {
    if (g.kind === "sat_math" || g.kind === "act_math") {
      const v = g.kind === "sat_math" ? student.satMath : student.actMath;
      const name = SECTION_LABEL[g.kind];
      const status: GateRouteStatus = v === null || v === undefined ? "absent" : v >= g.min ? "met" : "below";
      return { kind: g.kind, min: g.min, label: `${name} ${g.min}+`, status, value: v ?? null, via: status === "met" ? `${name} (${v})` : null };
    }
    const name = (g.course && catalogCourse(g.course)?.name) || g.course || "";
    const rows = student.courses.filter((c) => c.key === g.course);
    const scores = rows.map((c) => c.exam).filter((e): e is NonNullable<typeof e> => e !== null);
    const best = scores.length ? Math.max(...scores) : null;
    const status: GateRouteStatus = best !== null && best >= g.min ? "met" : rows.some((c) => c.exam === null) ? "pending" : rows.length ? "below" : "absent";
    return { kind: g.kind, course: g.course, min: g.min, label: `${name} ${g.min}+`, status, value: best, via: status === "met" ? `${name} (${best})` : null };
  });
  const metBy = routes.find((r) => r.status === "met") ?? null;
  return { status: metBy ? "met" : opts.testingClosed ? "closed" : "not_yet", routes, metBy };
}

/** "math" when every route is a math score or a math course; else "score". */
function gateSubject(gate: NonNullable<MajorReview["gate"]>): string {
  const math = gate.any_of.every((g) => g.kind === "sat_math" || g.kind === "act_math" || (g.course && catalogCourse(g.course)?.subject === "math"));
  return math ? "math" : "score";
}

/** Whether a college admits by school or major anywhere: a university "pool" statement or a unit that admits separately. */
export function majorMatters(unitId: string): boolean {
  const s = universityStatement(unitId)?.review?.major_considered;
  return s === "pool" || s === "pool_and_emphasis" || majorUnitsFor(unitId).some(admitsSeparately);
}

const words = (list: string[]) => (list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`);
const gpaWords = (g: number | null | undefined) => (g === null || g === undefined ? "not entered yet" : String(Math.round(g * 100) / 100));

/** The major's reading for this student at this college (see the module comment). */
export function majorReviewFor(student: MajorReviewStudent, school: MajorReviewSchool, opts: MajorReviewOptions = {}): MajorReviewReading {
  const first = student.majors[0] ?? null;
  const undecided = first === UNDECIDED_MAJOR;
  const family = first && !undecided ? first : null;
  const statement = universityStatement(school.unit_id);
  const unit = family ? majorUnitFor(school.unit_id, family) : null;
  const empty: MajorReviewReading = { family, undecided, unit, statement, considered: null, source: null, emphasis: [], subjectGpas: {}, requiredCourses: [], gate: null, notes: [], unitRequires: null, facts: [] };

  if (undecided) {
    if (!majorMatters(school.unit_id)) return empty;
    const notes: EstimateNote[] = [{ key: "major.undecided", values: { college: school.name }, cite: MAJOR_FIELDS.considered }];
    return { ...empty, notes, facts: [MAJOR_FIELDS.considered] };
  }
  if (!family) return empty;

  const majorWord = (majorFamilyName(family) ?? "this major").toLowerCase();
  const source = unit?.review?.major_considered ? unit : statement?.review?.major_considered ? statement : null;
  const considered = source?.review?.major_considered ?? null;
  const emphasis = source?.review?.emphasis ?? [];
  const notes: EstimateNote[] = [];

  if (considered === "no") notes.push({ key: "major.not_considered", values: { college: school.name }, cite: MAJOR_FIELDS.considered });
  else if (considered && source === unit && unit) notes.push({ key: "major.pool", values: { unit: unit.name, applicants: majorWord }, cite: MAJOR_FIELDS.considered });
  else if (considered) notes.push({ key: "major.line.pool", values: {}, cite: MAJOR_FIELDS.considered });

  const subjectGpas: Partial<Record<CourseSubject, number | null>> = {};
  if (considered === "pool_and_emphasis" && emphasis.length > 0) {
    for (const e of emphasis) subjectGpas[EMPHASIS_SUBJECT[e]] = subjectGpa(student.courses, EMPHASIS_SUBJECT[e]);
    const subjects = words(emphasis.map((e) => EMPHASIS_WORDS[e]));
    const who = source === unit && unit ? unit.name : school.name;
    const any = Object.values(subjectGpas).some((g) => g !== null);
    notes.push(
      any
        ? { key: "major.emphasis", values: { unit: who, subjects, yours: emphasis.map((e) => `${EMPHASIS_WORDS[e]} ${gpaWords(subjectGpas[EMPHASIS_SUBJECT[e]])}`).join(", ") }, cite: MAJOR_FIELDS.emphasis }
        : { key: "major.emphasis_no_grades", values: { unit: who, subjects }, cite: MAJOR_FIELDS.emphasis },
    );
  }

  const review = unit?.review ?? null;
  const requiredCourses = review ? checkRequiredCourses(review, student.courses) : [];
  for (const r of requiredCourses) notes.push({ key: r.met ? "major.required_met" : "major.required_missing", values: { unit: unit!.name, course: r.level }, cite: MAJOR_FIELDS.required });
  const unitRequires: EstimateNote | null = unit && requiredCourses.length > 0 ? { key: "major.unit_requires", values: { unit: unit.name, courses: requiredCourses.map((r) => r.level).join(", ") }, cite: MAJOR_FIELDS.required } : null;

  const gate = review?.gate ? checkGate(review.gate, student, opts) : null;
  if (gate && review?.gate) {
    if (gate.status === "met") notes.push({ key: "major.gate_met", values: { college: school.name, subject: gateSubject(review.gate), major: majorWord, route: gate.metBy!.via! }, cite: MAJOR_FIELDS.gate });
    else if (gate.status === "not_yet") notes.push({ key: "major.gate_not_yet", values: { major: majorWord, college: school.name, routes: gate.routes.map((r) => r.label).join(", ") }, cite: MAJOR_FIELDS.gate });
    // This sentence opens with the major.
    else notes.push({ key: "major.gate_closed", values: { major: majorWord.charAt(0).toUpperCase() + majorWord.slice(1), college: school.name }, cite: MAJOR_FIELDS.gate });
  }

  const facts = [...new Set([...notes, ...(unitRequires ? [unitRequires] : [])].map((n) => n.cite).filter((c): c is string => !!c))];
  return { family, undecided, unit, statement, considered, source, emphasis, subjectGpas, requiredCourses, gate, notes, unitRequires, facts };
}
