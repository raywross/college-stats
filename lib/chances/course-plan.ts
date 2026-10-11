import "server-only";
/**
 * The course plan (specs/chances/course-plan.md): at most two suggestions for next year, each with its reason, or a
 * guardrail message, or a plain "you're set"; for a 9th or 10th grader a path instead. Pure given its input (no I/O),
 * but server-only because it reads the rules (course-plan-rules.ts: the grades test, the yearly cap, how many colleges
 * make a recommendation count). Pages and Server Actions call it through course-plan-server.ts and pass the browser
 * only the sentences (course-plan-view.ts). Every sentence is a note from lib/chances/notes.ts with filled-in values.
 *
 * A candidate is an AP course the school offers that the student hasn't listed, whose usual prerequisites are on the
 * list (taken or in progress; a "level:Algebra II"-style prerequisite is a course level the plan can't check, so it
 * counts as met), whose usual grade levels include next year, and whose usual successor in the subject isn't already
 * on the list. Each candidate gets the first reason that applies, in this order (a requirement before a
 * recommendation):
 *   1. required     a unit on the list requires a course (or a score a course's exam gives) the list doesn't meet yet
 *   2. recommended  the list's C8 recommendations ask for more years of a subject than the student will finish with
 *   3. top_level    next year has no advanced course in a core subject and the school offers one
 *   4. major        a course tagged for the first intended major's family (data/reference/major-course-expectations.json)
 * then the guardrails (grades first, a yearly cap, already as demanding as allowed, too late, not offered, earlier
 * years) decide whether anything is shown at all.
 */
import { majorFamilyName } from "../majors.ts";
import type { MajorAdmissionUnit } from "./types.ts";
import { catalogCourse, type CatalogCourse } from "./catalog.ts";
import { COURSE_PLAN_RULES, gradeCheck } from "./course-plan-rules.ts";
import { resolveCore, youYears } from "./courses.ts";
import { expectationsFor, type ExpectedSubject } from "./major-course-expectations.ts";
import { checkGate, checkRequiredCourses, meetsLevel } from "./major-review.ts";
import { isAdvancedKind, CORE_SUBJECT_KEYS, CORE_YEARS, type CoreAtTopLevel, type CoreSubject } from "../student-profile.ts";
import { nextYearOf, REASON_ORDER, type CoursePlanKind, type SuggestionReason } from "./course-plan-view.ts";
import type { CourseEntry, CourseSubject, EstimateNote, RigorReading, SchoolOffering } from "./types.ts";

/** A college on the student's list, as the plan reads it. */
export interface PlanCollege {
  unitId: string;
  name: string;
  /** The Dream: one college recommending a subject is enough to say so. */
  dream: boolean;
  /** Years recommended by core subject (CDS C8 `units_recommended`); a subject the college doesn't state is absent. */
  recommended: Partial<Record<CoreSubject, number>>;
  /** The unit that admits the student's first intended major here (data/major-admission.json), or null. */
  unit: MajorAdmissionUnit | null;
}

export interface PlanStudent {
  courses: readonly CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel;
  /** The grade now (9–12), or null outside high school or without a class year. */
  grade: number | null;
  /** Two-digit major families, most interested first. */
  majors: readonly string[];
  satMath: number | null;
  actMath: number | null;
}

export interface PlanInput {
  student: PlanStudent;
  offering: SchoolOffering;
  /** Whether the student has a high school on their profile (only chooses between two "no list" sentences). */
  linked: boolean;
  colleges: readonly PlanCollege[];
  /** The rigor reading now (rigor.ts), or null when it can't be placed. */
  reading: RigorReading | null;
  /** Suggestion ids the student set aside this season. */
  dismissed?: readonly string[];
}

/** One suggestion: a course (or, with no key, a subject) for next year, with its reason as a note. */
export interface PlanSuggestion {
  id: string;
  /** The catalog key, or null for a subject-level suggestion. */
  key: string | null;
  name: string;
  subject: CourseSubject;
  reason: SuggestionReason;
  note: EstimateNote;
  year: 10 | 11 | 12;
  /** College unit ids the sentence names (for the evidence line). */
  units: string[];
}

export interface PlanResult {
  kind: CoursePlanKind;
  nextYear: 10 | 11 | 12 | null;
  suggestions: PlanSuggestion[];
  /** Guardrail, "set", and "not offered" sentences, in order. */
  notes: EstimateNote[];
  /** One sentence per subject for a 9th or 10th grader. */
  path: EstimateNote[];
  /** The guardrail that fired, for telemetry: "" when none. */
  guardrail: "" | "weak_grades" | "already" | "full_load" | "late" | "dismissed" | "no_list";
  /** Every suggestion was dismissed: the card says so rather than "you're set". */
  allDismissed: boolean;
  /** The school's list isn't on record, so suggestions need the student's marks. */
  needsList: boolean;
}

const note = (key: string, values: EstimateNote["values"] = {}): EstimateNote => ({ key, values });

/** The subject as a sentence says it. */
export const SUBJECT_WORD: Record<CourseSubject, string> = {
  english: "English",
  math: "math",
  science: "science",
  history: "history",
  language: "world language",
  cs: "computer science",
  arts: "arts",
  other: "electives",
};

const ORDINAL = ["", "A first", "A second", "A third", "A fourth", "A fifth"];
const SENIOR_WORD: Record<number, string> = { 10: "sophomore", 11: "junior", 12: "senior" };

const isCore = (s: CourseSubject): s is CoreSubject => (CORE_SUBJECT_KEYS as readonly string[]).includes(s);

/** The AP courses the student could take next year at their school (see the module comment). */
export function eligibleCourses(student: PlanStudent, offering: SchoolOffering, nextYear: number): CatalogCourse[] {
  if (!offering.apKeys) return [];
  const listed = new Set(student.courses.map((c) => c.key).filter((k): k is string => !!k));
  const done = new Set(student.courses.filter((c) => c.key && (c.status === "taken" || c.status === "in_progress")).map((c) => c.key as string));
  const out: CatalogCourse[] = [];
  for (const key of offering.apKeys) {
    const c = catalogCourse(key);
    if (!c || !key.startsWith("ap_") || listed.has(key)) continue;
    if (!c.grades.includes(nextYear)) continue;
    if (!c.prereqs.every((p) => p.startsWith("level:") || done.has(p))) continue;
    // The usual successor in the same subject is already on the list: this one would be a step back.
    if (c.next.some((n) => listed.has(n) && catalogCourse(n)?.subject === c.subject)) continue;
    out.push(c);
  }
  return out;
}

/** Whether another eligible course in the same subject follows this one in the sequence (this isn't the school's top). */
function hasOfferedSuccessor(c: CatalogCourse, offering: SchoolOffering): boolean {
  return c.next.some((n) => offering.apKeys?.includes(n) && catalogCourse(n)?.subject === c.subject);
}

/** The best of several candidates for a subject: one with no offered successor first, then the longer sequence. */
function pick(cands: CatalogCourse[], offering: SchoolOffering, prefer?: string): CatalogCourse | null {
  if (cands.length === 0) return null;
  const preferred = prefer ? cands.find((c) => c.key === prefer) : undefined;
  if (preferred) return preferred;
  return [...cands].sort((a, b) => Number(hasOfferedSuccessor(a, offering)) - Number(hasOfferedSuccessor(b, offering)) || b.prereqs.length - a.prereqs.length)[0];
}

/** Years of a subject the student will finish with: their listed courses and core answers; null when the list can't count it. */
function yearsHave(student: PlanStudent, subject: CoreSubject): number | null {
  return youYears(student.courses, student.coreAtTopLevel, subject)?.years ?? null;
}

const advancedIn = (courses: readonly CourseEntry[], subject: CourseSubject, year: number) =>
  courses.some((c) => isAdvancedKind(c.kind) && c.subject === subject && c.year === year);

/* ------------------------------------------------------------------ */
/* The reasons                                                         */
/* ------------------------------------------------------------------ */

type Found = { reason: SuggestionReason; subject: CourseSubject; course: CatalogCourse | null; note: EstimateNote; units: string[] };

/** 1. A unit on the list requires a course (or a score a course's exam gives) the list doesn't meet yet. */
function requiredReasons(input: PlanInput, cands: CatalogCourse[]): Found[] {
  const { student, colleges } = input;
  const out: Found[] = [];
  for (const college of colleges) {
    const review = college.unit?.review;
    if (!college.unit || !review) continue;
    for (const r of checkRequiredCourses(review, student.courses)) {
      if (r.met) continue;
      const fits = cands.filter((c) => meetsLevel({ key: c.key, name: null, subject: c.subject }, r.subject, r.level));
      const course = pick(fits, input.offering);
      if (course) out.push({ reason: "required", subject: course.subject, course, units: [college.unitId], note: note("course_plan.required", { who: college.unit.name, level: r.level, course: course.name }) });
    }
    if (review.gate) {
      const check = checkGate(review.gate, { courses: [...student.courses], satMath: student.satMath, actMath: student.actMath });
      if (check.status === "met" || check.routes.some((x) => x.status === "pending")) continue;
      const routeKeys = review.gate.any_of.filter((g) => g.kind === "ap" && g.course).map((g) => g.course as string);
      const course = pick(cands.filter((c) => routeKeys.includes(c.key)), input.offering);
      if (course) out.push({ reason: "required", subject: course.subject, course, units: [college.unitId], note: note("course_plan.gate", { who: college.unit.name, what: SUBJECT_WORD[course.subject], course: course.name }) });
    }
  }
  return out;
}

/** 2. The list's C8 recommendations ask for more years of a subject than the student will finish with. */
function recommendedReasons(input: PlanInput, cands: CatalogCourse[], nextYear: number): Found[] {
  const { student, colleges } = input;
  const out: Found[] = [];
  if (colleges.length === 0) return out;
  for (const subject of CORE_SUBJECT_KEYS) {
    if (advancedIn(student.courses, subject, nextYear) || student.courses.some((c) => c.subject === subject && c.year === nextYear)) continue;
    const have = yearsHave(student, subject);
    if (have === null || have >= 4) continue;
    const want = have + 1;
    const asking = colleges.filter((c) => (c.recommended[subject] ?? 0) >= want);
    if (asking.length === 0) continue;
    const half = asking.length >= Math.ceil(colleges.length * COURSE_PLAN_RULES.recommendShare);
    const dream = asking.find((c) => c.dream);
    if (!half && !dream) continue;
    const course = pick(cands.filter((c) => c.subject === subject), input.offering);
    const base = { total: colleges.length, subject: SUBJECT_WORD[subject], have, years: want, ordinal: ORDINAL[want] ?? "Another" };
    const units = asking.map((c) => c.unitId);
    let key: string;
    let values: EstimateNote["values"];
    if (half) {
      key = course ? "course_plan.recommended" : "course_plan.recommended_subject";
      values = { ...base, count: asking.length, course: course?.name ?? "" };
    } else {
      key = course ? "course_plan.recommended_dream" : "course_plan.recommended_dream_subject";
      values = { ...base, college: dream!.name, course: course?.name ?? "" };
    }
    out.push({ reason: "recommended", subject, course, units, note: note(key, values) });
  }
  return out;
}

/** 3. Next year has no advanced course in a core subject, and the school offers one. */
function topLevelReasons(input: PlanInput, cands: CatalogCourse[], nextYear: number, order: readonly CourseSubject[]): Found[] {
  const { student, offering } = input;
  const core = resolveCore(student.courses, student.coreAtTopLevel);
  const out: Found[] = [];
  for (const subject of order) {
    if (!isCore(subject)) continue;
    if (advancedIn(student.courses, subject, nextYear)) continue;
    if ((CORE_YEARS as readonly number[]).includes(nextYear) && core[nextYear as 11 | 12][subject]) continue;
    const course = pick(cands.filter((c) => c.subject === subject), offering);
    if (!course) continue;
    const n = hasOfferedSuccessor(course, offering) ? note("course_plan.next_step", { course: course.name, subject: SUBJECT_WORD[subject] }) : note("course_plan.top_level", { course: course.name, subject: SUBJECT_WORD[subject] });
    out.push({ reason: "top_level", subject, course, units: [], note: n });
  }
  // The school's count is known but not which courses: one subject-level line, for the subject the major or the core asks about first.
  if (!offering.apKeys && (offering.apCount ?? 0) > 0) {
    const subject = order.find((s) => isCore(s) && !advancedIn(student.courses, s, nextYear));
    if (subject) out.push({ reason: "top_level", subject, course: null, units: [], note: note("course_plan.top_level_subject", { subject: SUBJECT_WORD[subject] }) });
  }
  return out;
}

/** 4. A course tagged for the first intended major's family isn't on the list and is offered. */
function majorReasons(input: PlanInput, cands: CatalogCourse[]): Found[] {
  const family = input.student.majors[0]?.slice(0, 2);
  const exp = expectationsFor(family);
  if (!family || !exp) return [];
  const name = majorFamilyName(family) ?? "This major";
  const out: Found[] = [];
  for (const e of exp.expects) {
    const course = pick(cands.filter((c) => c.subject === e.subject && c.majors.includes(family)), input.offering, e.top);
    if (!course) continue;
    const inSequence = input.student.courses.some((c) => c.subject === e.subject && isAdvancedKind(c.kind) && c.status !== "planned");
    const tail = inSequence ? `is next in your ${SUBJECT_WORD[e.subject]} sequence` : "fits next year";
    out.push({ reason: "major", subject: e.subject, course, units: [], note: note("course_plan.major", { major: name, expects: exp.expects.map((x) => x.text).join(", "), course: course.name, subject: SUBJECT_WORD[e.subject], tail }) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The path (9th and 10th grade)                                       */
/* ------------------------------------------------------------------ */

interface Step {
  name: string;
  by: number;
}

/** The courses to take before `course` for a student who takes it in `year`, deepest first, from the catalog's prerequisites. */
function prerequisiteSteps(course: CatalogCourse, year: number, depth = 0): Step[] {
  const steps: Step[] = [];
  for (const p of course.prereqs) {
    if (p.startsWith("level:")) steps.push({ name: p.slice(6), by: year - 1 });
    else {
      const c = catalogCourse(p);
      if (!c) continue;
      steps.push({ name: c.name, by: year - 1 });
      if (depth < 2) steps.push(...prerequisiteSteps(c, year - 1, depth + 1));
    }
  }
  return steps;
}

const gradeWord = (n: number) => `${n}th grade`;

/** "To take AP Calculus AB as a senior, take Precalculus by 11th grade." for each subject tied to the first major. */
export function pathFor(student: PlanStudent, offering: SchoolOffering): EstimateNote[] {
  const family = student.majors[0]?.slice(0, 2);
  const exp = expectationsFor(family);
  if (!exp || student.grade === null) return [];
  const listed = new Set(student.courses.map((c) => c.key).filter((k): k is string => !!k));
  const out: EstimateNote[] = [];
  for (const e of exp.expects as ExpectedSubject[]) {
    const top = catalogCourse(e.top);
    if (!top || listed.has(top.key)) continue;
    if (offering.apKeys && !offering.apKeys.includes(top.key)) continue;
    const target = Math.max(...top.grades);
    const seen = new Set<string>();
    const steps = prerequisiteSteps(top, target)
      .filter((s) => s.by >= (student.grade as number) && !listed.has(s.name) && !seen.has(s.name) && (seen.add(s.name), true))
      .sort((a, b) => a.by - b.by);
    if (steps.length === 0) continue;
    const text = steps.map((s) => `${s.name} by ${gradeWord(s.by)}`);
    const joined = text.length <= 1 ? text.join("") : `${text.slice(0, -1).join(", ")} and ${text[text.length - 1]}`;
    out.push(note("course_plan.path", { course: top.name, senior: SENIOR_WORD[target] ?? "senior", steps: joined }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

/** What a suggestion that names no course is called: "A fourth year of science", or "A math course at your school's top level". */
function subjectLevelName(student: PlanStudent, f: Found): string {
  if (f.reason === "top_level") return `A course in ${SUBJECT_WORD[f.subject]} at your school's top level`;
  const have = isCore(f.subject) ? (yearsHave(student, f.subject) ?? 0) : 0;
  return `${ORDINAL[Math.min(5, have + 1)]} year of ${SUBJECT_WORD[f.subject]}`;
}

const result = (over: Partial<PlanResult>): PlanResult => ({ kind: "none", nextYear: null, suggestions: [], notes: [], path: [], guardrail: "", allDismissed: false, needsList: false, ...over });

/**
 * Next year's suggestions for a student (see the module comment). `kind` says what the card shows:
 * - `late` from September of 12th grade; `path` for a 9th or 10th grader with a major that has expectations; `none`
 *   for a student with no class year or nothing to say;
 * - `guardrail` when weak advanced grades, a schedule already as demanding as the school allows, or a full load for
 *   next year replace the suggestions (the grades test is first);
 * - `suggestions` (one or two) or `set`.
 */
export function coursePlan(input: PlanInput): PlanResult {
  const { student, offering } = input;
  const nextYear = nextYearOf(student.grade);
  if (student.grade === null) return result({});
  if (student.grade >= 12) return result({ kind: "late", notes: [note("course_plan.late")], guardrail: "late" });
  if (nextYear === null) return result({});
  if (student.grade <= 10) {
    const path = pathFor(student, offering);
    return result({ kind: path.length > 0 ? "path" : "none", nextYear, path });
  }

  // From here on, a junior choosing a senior schedule.
  const grades = gradeCheck(student.courses, student.grade);
  if (grades.weak) {
    return result({ kind: "guardrail", nextYear, guardrail: "weak_grades", notes: [grades.gpa !== null ? note("course_plan.weak_grades", { gpa: (Math.round(grades.gpa * 10) / 10).toFixed(1) }) : note("course_plan.weak_grades_recent")] });
  }
  const core = resolveCore(student.courses, student.coreAtTopLevel);
  if (input.reading === "most" && (CORE_YEARS as readonly number[]).includes(nextYear) && CORE_SUBJECT_KEYS.every((s) => core[nextYear as 11 | 12][s])) {
    return result({ kind: "guardrail", nextYear, guardrail: "already", notes: [note("course_plan.already")] });
  }
  const advancedNext = student.courses.filter((c) => isAdvancedKind(c.kind) && c.year === nextYear).length;
  const room = COURSE_PLAN_RULES.maxAdvancedPerYear - advancedNext;
  if (room <= 0) return result({ kind: "guardrail", nextYear, guardrail: "full_load", notes: [note("course_plan.full_load")] });

  const hasList = offering.apKeys !== null || (offering.apCount ?? 0) > 0;
  const cands = eligibleCourses(student, offering, nextYear);
  const family = student.majors[0]?.slice(0, 2);
  const exp = expectationsFor(family);
  const majorSubjects = exp ? exp.expects.map((e) => e.subject) : [];
  const order: CourseSubject[] = [...new Set<CourseSubject>([...majorSubjects, "math", "science", "english", "history", "language"])];

  const byReason: Record<SuggestionReason, Found[]> = {
    required: requiredReasons(input, cands),
    recommended: recommendedReasons(input, cands, nextYear),
    top_level: topLevelReasons(input, cands, nextYear, order),
    major: majorReasons(input, cands),
  };
  const dismissed = new Set(input.dismissed ?? []);
  const idOf = (f: Found) => f.course?.key ?? `subject:${f.subject}`;
  const all = REASON_ORDER.flatMap((r) => byReason[r]);

  const chosen: Found[] = [];
  const usedSubjects = new Set<CourseSubject>();
  const usedIds = new Set<string>();
  let dismissedAny = false;
  for (const f of all) {
    if (dismissed.has(idOf(f))) {
      dismissedAny = true;
      continue;
    }
    if (usedSubjects.has(f.subject) || usedIds.has(idOf(f))) continue;
    chosen.push(f);
    usedSubjects.add(f.subject);
    usedIds.add(idOf(f));
    if (chosen.length >= Math.min(COURSE_PLAN_RULES.maxSuggestions, room)) break;
  }

  const suggestions: PlanSuggestion[] = chosen.map((f) => ({
    id: idOf(f),
    key: f.course?.key ?? null,
    name: f.course?.name ?? subjectLevelName(student, f),
    subject: f.subject,
    reason: f.reason,
    note: f.note,
    year: nextYear,
    units: f.units,
  }));

  const notes: EstimateNote[] = [];
  const needsList = !hasList;
  if (suggestions.length === 0) {
    if (needsList) notes.push(note(input.linked ? "course_plan.no_list" : "course_plan.no_school"));
    else if (dismissedAny) notes.push(note("course_plan.dismissed"));
    else notes.push(note("course_plan.set"));
  }
  // A subject the major expects whose top course the school doesn't offer: said once.
  if (exp && offering.apKeys && exp.expects.some((e) => !offering.apKeys!.includes(e.top) && !student.courses.some((c) => c.key === e.top))) {
    notes.push(note("course_plan.not_offered"));
  }
  return result({
    kind: suggestions.length > 0 ? "suggestions" : "set",
    nextYear,
    suggestions,
    notes,
    allDismissed: suggestions.length === 0 && dismissedAny,
    needsList,
    guardrail: suggestions.length === 0 ? (needsList ? "no_list" : dismissedAny ? "dismissed" : "") : "",
  });
}

