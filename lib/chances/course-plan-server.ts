import "server-only";
/**
 * Builds the course plan the planner shows (specs/chances/course-plan.md): reads the student's profile, the colleges
 * on the list (their CDS C8 recommendations and the unit that admits the first intended major), and the school's
 * offering, runs coursePlan(), and returns only sentences, ids, and citations (course-plan-view.ts). The rules (the
 * grades test, the yearly cap) stay here; the browser never sees them. The "what it changes" group line comes later,
 * from the estimate endpoint, in the card (components/planner/NextYearCard.tsx).
 */
import { getData } from "@/lib/data";
import type { Cited } from "@/lib/lineage";
import { majorUnitCitation } from "@/lib/lineage";
import type { School } from "@/lib/types";
import type { StudentProfileData } from "@/lib/student-profile";
import { gradeNow, newCourse } from "./courses";
import { AP_CATALOG, catalogCourse } from "./catalog";
import { coursePlan, type PlanCollege, type PlanResult, type PlanStudent } from "./course-plan";
import { inRegistrationWindow, nextYearOf, planSeason, type CoursePlanView, type SuggestionView } from "./course-plan-view";
import { expectationsFor } from "./major-course-expectations";
import { majorUnitFor } from "./major-admission";
import { MAJOR_FIELDS } from "./major-review";
import { noteText } from "./notes";
import { rigorReading } from "./rigor";
import { offeringFor } from "./rigor-server";
import { sentencesFrom } from "./rigor-view";
import type { CourseEntry, RigorReading } from "./types";

const RANK: Record<RigorReading, number> = { cant_place: 0, few_offered: 1, some: 2, much: 3, most: 4 };
const READING_WORDS: Partial<Record<RigorReading, string>> = { much: "much of what your school offers", most: "most of what your school offers" };

/** The college's recommended years by core subject, from CDS C8 (social studies and history count as the larger of the two). */
function recommendedYears(school: School): PlanCollege["recommended"] {
  const u = school.reported?.admissions_hs_prep?.units_recommended;
  if (!u) return {};
  const out: PlanCollege["recommended"] = {};
  if (u.english != null) out.english = u.english;
  if (u.math != null) out.math = u.math;
  if (u.science != null) out.science = u.science;
  if (u.foreign_language != null) out.language = u.foreign_language;
  const hist = Math.max(u.social_studies ?? 0, u.history ?? 0);
  if (hist > 0) out.history = hist;
  return out;
}

export interface CoursePlanArgs {
  profile: StudentProfileData;
  gradYear: number | null;
  items: readonly { unit_id: string; dream?: boolean; withdrawn_on?: string | null }[];
  today: string;
  canEdit: boolean;
}

/** The plan's card as the page sends it down; null when the student has no profile. */
export async function coursePlanViewFor(args: CoursePlanArgs): Promise<CoursePlanView | null> {
  const { profile, today } = args;
  const grade = gradeNow(args.gradYear, today);
  const season = planSeason(today);
  const saved = profile.academics.coursePlan && profile.academics.coursePlan.season === season ? profile.academics.coursePlan : null;
  const { offering } = await offeringFor(profile.basics.highSchoolId, { studentMarks: profile.academics.schoolOffers });
  const family = profile.plans.intendedMajors[0]?.slice(0, 2) ?? null;
  const data = await getData();

  const colleges: PlanCollege[] = [];
  const schools = new Map<string, School>();
  for (const item of args.items) {
    if (item.withdrawn_on) continue;
    const school = data.getSchoolById(item.unit_id);
    if (!school) continue;
    schools.set(item.unit_id, school);
    colleges.push({ unitId: item.unit_id, name: school.name, dream: item.dream === true, recommended: recommendedYears(school), unit: family ? majorUnitFor(item.unit_id, family) : null });
  }

  const student: PlanStudent = {
    courses: profile.academics.courses,
    coreAtTopLevel: profile.academics.coreAtTopLevel,
    grade,
    majors: profile.plans.intendedMajors,
    satMath: profile.tests.satMath,
    actMath: profile.tests.actMath,
  };
  const linked = profile.basics.highSchoolId !== null;
  const readingNow = rigorReading({ courses: student.courses, coreAtTopLevel: student.coreAtTopLevel, grade }, offering, { linked }).reading;
  const plan = coursePlan({ student, offering, linked, colleges, reading: readingNow, dismissed: saved?.dismissed ?? [] });

  const suggestions = plan.suggestions.map((s) => suggestionView(s, { student, offering, readingNow, linked, schools, citeField: data.citeField, family, grade }));
  return {
    kind: plan.kind,
    season,
    grade,
    nextYear: plan.nextYear ?? nextYearOf(grade),
    inWindow: inRegistrationWindow(today),
    done: saved?.done === true,
    suggestions,
    messages: sentencesFrom(plan.notes),
    path: sentencesFrom(plan.path),
    askOffering: askOffering(args.canEdit && linked && grade !== null && grade <= 11, offering.source, profile.academics.schoolOffers),
    methodNote: suggestions.some((s) => s.reason === "major" || s.reason === "top_level") || plan.kind === "path" ? "Course sequences and the majors each course relates to are editorial; the pages they were written from are linked." : null,
    telemetry: { reasons: [...new Set(plan.suggestions.map((s) => s.reason))].join(","), guardrail: plan.guardrail },
  };
}

function askOffering(eligible: boolean, source: string | null, marks: string[]): CoursePlanView["askOffering"] {
  // Asked when the school's list isn't on record (only a count, or nothing, or the student's own marks to change).
  if (!eligible || (source !== null && source !== "crdc" && source !== "student")) return null;
  return { catalog: AP_CATALOG.courses.map((c) => ({ key: c.key, name: c.name, subject: c.subject })), marks };
}

interface Ctx {
  student: PlanStudent;
  offering: Parameters<typeof coursePlan>[0]["offering"];
  readingNow: RigorReading;
  linked: boolean;
  schools: Map<string, School>;
  citeField: (path: never, school?: School) => Cited;
  family: string | null;
  grade: number | null;
}

function suggestionView(s: PlanResult["suggestions"][number], ctx: Ctx): SuggestionView {
  const cite = ctx.citeField as unknown as (path: string, school?: School) => Cited;
  const evidence: SuggestionView["evidence"] = [];
  if (s.reason === "recommended") {
    for (const id of s.units.slice(0, 3)) {
      const school = ctx.schools.get(id);
      if (school) evidence.push({ label: school.name, cite: cite("reported.admissions_hs_prep.units_recommended", school) });
    }
  } else if (s.reason === "required") {
    for (const id of s.units.slice(0, 1)) {
      const school = ctx.schools.get(id);
      if (!school) continue;
      const unit = ctx.family ? majorUnitFor(id, ctx.family) : null;
      const base = cite(MAJOR_FIELDS.required, school);
      const unitCite = unit ? majorUnitCitation(MAJOR_FIELDS.required, unit, school) ?? majorUnitCitation(MAJOR_FIELDS.gate, unit, school) : null;
      evidence.push({ label: unit?.name ?? school.name, cite: unitCite ? { ...base, ...unitCite.source, quote: unitCite.quote } : base });
    }
  } else if (s.reason === "major") {
    for (const src of (expectationsFor(ctx.family)?.sources ?? []).slice(0, 2)) evidence.push({ label: src.label, cite: null, href: src.url });
  }
  const course = s.key ? catalogCourse(s.key) : null;
  if (course) evidence.push({ label: `College Board: ${course.name}`, cite: null, href: course.url });

  let readingLine: string | null = null;
  if (s.key) {
    const row: CourseEntry = newCourse({ kind: "ap", key: s.key, grade: ctx.grade, year: s.year });
    const after = rigorReading({ courses: [...ctx.student.courses, row], coreAtTopLevel: ctx.student.coreAtTopLevel, grade: ctx.grade }, ctx.offering, { linked: ctx.linked }).reading;
    const label = READING_WORDS[after];
    if (label && RANK[after] > RANK[ctx.readingNow] && ctx.readingNow !== "cant_place") readingLine = noteText({ key: "course_plan.reading_moves", values: { label } });
  }
  return { id: s.id, key: s.key, name: s.name, subject: s.subject, reason: s.reason, sentence: noteText(s.note), year: s.year, readingLine, evidence };
}

