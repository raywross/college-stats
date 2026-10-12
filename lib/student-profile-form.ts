/**
 * Turning the `/me` profile form's `FormData` into the raw shape `sanitizeProfile()` expects (lib/student-profile.ts).
 * Pure and client-safe (no DB, no auth) so it's directly unit-testable; `app/me/actions.ts`'s `saveStudentProfile`
 * is the only "use server" wrapper, which fetches the saved profile and calls these.
 *
 * `kept` is the profile as it stood before this save (null for one never saved). It matters because several fields
 * are no longer on this form at all (household-hub.md "Household cleanup (2026-10-12)", "Trim to only the things
 * we don't have in planner"): grades and GPA (weighted GPA, class standing, the valedictorian/salutatorian
 * expectation), graduation year, tests, courses, and activities and awards moved to the planner's intake guide
 * (specs/planner/redesign/intake.md), replaced here by one link (`components/me/ProfileForm.tsx` `EditInThePlan`).
 * Their inputs are gone from the DOM entirely, not merely blank, so `form.has(name)` is false for every one of
 * them on every submit of this form — and each falls back to `kept`'s value instead of the empty default
 * `numField`/`jsonField` would otherwise produce, so saving the fields that *are* still on the form (state,
 * high school, fee waiver, first generation, majors, early-round interest, preferences) never wipes the rest.
 */
import { sanitizeCourses, type StudentProfileData } from "./student-profile.ts";
import { mergeCoursesForSave } from "./chances/courses.ts";

export function numField(form: FormData, name: string): number | null {
  const v = form.get(name);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function strField(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function boolField(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "1" || form.get(name) === "true";
}

/** Yes/No/not set, from a <select>'s "", "yes", "no" (lib/student-profile.ts's feeWaiverEligible pattern). */
export function nullableBoolField(form: FormData, name: string): boolean | null {
  const v = form.get(name);
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

export function arrField(form: FormData, name: string): string[] {
  return form.getAll(name).map(String).filter(Boolean);
}

/** "TN, CA, New England" -> ["TN", "CA", "New England"]; also accepts newline- or slash-separated lists. */
export function csvField(form: FormData, name: string): string[] {
  const raw = strField(form, name);
  return raw ? raw.split(/[,\n/]/).map((s) => s.trim()).filter(Boolean) : [];
}

export function jsonField(form: FormData, name: string): unknown {
  try {
    return JSON.parse(String(form.get(name)));
  } catch {
    return undefined;
  }
}

/** `numField`, but a field missing from the form entirely (not just blank) falls back instead of reading as null. */
export function numFieldOr(form: FormData, name: string, fallback: number | null): number | null {
  return form.has(name) ? numField(form, name) : fallback;
}

/** `strField`, with the same "missing falls back" rule as `numFieldOr`. */
export function strFieldOr(form: FormData, name: string, fallback: string | null): string | null {
  return form.has(name) ? strField(form, name) : fallback;
}

/** `boolField`, with the same "missing falls back" rule as `numFieldOr`. */
export function boolFieldOr(form: FormData, name: string, fallback: boolean): boolean {
  return form.has(name) ? boolField(form, name) : fallback;
}

/** A hidden JSON array field (ActivitiesForm/AwardsForm's pattern): falls back when the form lacks the field, or
 * when it's present but unparseable, rather than reading as `[]` either way. */
export function jsonArrFieldOr(form: FormData, name: string, fallback: unknown[]): unknown {
  if (!form.has(name)) return fallback;
  const v = jsonField(form, name);
  return v === undefined ? fallback : v;
}

export type CourseFields = { courses?: unknown; apExamsPrivate?: unknown; coreAtTopLevel?: unknown; coursePlan?: unknown; schoolOffers?: unknown };

/**
 * The course list (specs/chances/rigor-in-context.md): from a "courses" JSON field when the form carries one (the
 * planner intake's AP step, or an older course picker), else the list already saved, so a form without one never
 * erases it. A guardian's post carries no exam scores while they're private, so the saved ones are put back
 * (mergeCoursesForSave) and the privacy switch stays as saved.
 */
export function coursesFor(form: FormData, kept: StudentProfileData | null, relation: "self" | "guardian" | null): CourseFields {
  const keptAc = kept?.academics ?? null;
  // The course plan's dismissals and the student's school marks live in the same group; the form never carries them.
  const plan = keptAc ? { coursePlan: keptAc.coursePlan, schoolOffers: keptAc.schoolOffers } : {};
  if (!form.has("courses")) {
    return keptAc ? { courses: keptAc.courses, apExamsPrivate: keptAc.apExamsPrivate, coreAtTopLevel: keptAc.coreAtTopLevel, ...plan } : {};
  }
  const posted = jsonField(form, "courses");
  if (posted === undefined) return { ...plan };
  const incoming = { courses: sanitizeCourses(posted), apExamsPrivate: form.get("apExamsPrivate") !== "false" };
  const merged = keptAc ? mergeCoursesForSave({ courses: keptAc.courses, apExamsPrivate: keptAc.apExamsPrivate }, incoming, relation ?? "self") : incoming;
  const core = form.has("coreAtTopLevel") ? jsonField(form, "coreAtTopLevel") : keptAc?.coreAtTopLevel;
  return { courses: merged.courses, apExamsPrivate: merged.apExamsPrivate, coreAtTopLevel: core, ...plan };
}

/** The form's fields back into the raw shape sanitizeProfile() expects; it drops anything out of range itself. */
export function profileFromForm(form: FormData, kept: StudentProfileData | null, courses: CourseFields = {}): unknown {
  return {
    basics: {
      gradYear: numFieldOr(form, "gradYear", kept?.basics.gradYear ?? null),
      stateOfResidence: strField(form, "stateOfResidence"),
      highSchool: strField(form, "highSchool"),
      highSchoolId: strField(form, "highSchoolId"),
      feeWaiverEligible: nullableBoolField(form, "feeWaiverEligible"),
    },
    academics: {
      gpa: numFieldOr(form, "gpa", kept?.academics.gpa ?? null),
      gpaScale: strFieldOr(form, "gpaScale", kept?.academics.gpaScale ?? null) ?? "4.0",
      weightedGpa: numFieldOr(form, "weightedGpa", kept?.academics.weightedGpa ?? null),
      classRankPercentile: numFieldOr(form, "classRankPercentile", kept?.academics.classRankPercentile ?? null),
      classStanding: strFieldOr(form, "classStanding", kept?.academics.classStanding ?? null),
      courseRigorCount: numField(form, "courseRigorCount"),
      // Admission chances, next (specs/chances/depth.md, inputs-beyond-academics.md): posted whole as hidden JSON
      // fields when the intake carries them; this form doesn't, so both fall back to the saved list rather than
      // [] (the same rule as courses, above).
      activities: jsonArrFieldOr(form, "activities", kept?.academics.activities ?? []),
      awards: jsonArrFieldOr(form, "awards", kept?.academics.awards ?? []),
      firstGeneration: nullableBoolField(form, "firstGeneration"),
      rankExpectation: strFieldOr(form, "rankExpectation", kept?.academics.rankExpectation ?? null),
      ...courses,
    },
    tests: {
      satTotal: numFieldOr(form, "satTotal", kept?.tests.satTotal ?? null),
      satReading: numFieldOr(form, "satReading", kept?.tests.satReading ?? null),
      satMath: numFieldOr(form, "satMath", kept?.tests.satMath ?? null),
      actComposite: numFieldOr(form, "actComposite", kept?.tests.actComposite ?? null),
      actEnglish: numFieldOr(form, "actEnglish", kept?.tests.actEnglish ?? null),
      actMath: numFieldOr(form, "actMath", kept?.tests.actMath ?? null),
      actReading: numFieldOr(form, "actReading", kept?.tests.actReading ?? null),
      actScience: numFieldOr(form, "actScience", kept?.tests.actScience ?? null),
      superscore: boolFieldOr(form, "superscore", kept?.tests.superscore ?? false),
      plansTestOptional: boolFieldOr(form, "plansTestOptional", kept?.tests.plansTestOptional ?? false),
      // Never on this form at all (the planner's intake sets these, lib/planner/store-plan.ts saveIntake): keep
      // them as saved rather than let a plain object default wipe what the intake set.
      focus: kept?.tests.focus ?? null,
      practice: kept?.tests.practice ?? false,
      target: kept?.tests.target ?? null,
      plannedDates: kept?.tests.plannedDates ?? [],
    },
    plans: {
      intendedMajors: arrField(form, "intendedMajors"),
      earlyRoundInterest: strField(form, "earlyRoundInterest"),
    },
    preferences: {
      sizes: arrField(form, "sizes"),
      settings: arrField(form, "settings"),
      statesOrRegions: csvField(form, "statesOrRegionsText"),
      maxAverageCost: numField(form, "maxAverageCost"),
      types: arrField(form, "types"),
    },
  } satisfies Partial<Record<keyof StudentProfileData, unknown>>;
}
