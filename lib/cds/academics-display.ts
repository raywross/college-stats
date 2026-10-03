/**
 * Showing CDS academics (specs/data-expansion/cds-academics.md): class-size shares, program and core-curriculum labels,
 * open curriculum, Explore's one filter ("Has an honors program"), and Compare's "Classes under 20 students" cell.
 * Computed at render time from `school.reported.academics` (stored by lib/cds/academics.ts).
 *
 * Partial coverage: none of this feeds METRICS, ranks, medians, percentile strips, sorts, the radar, Key differences,
 * or "Known for" (tests/cds-academics.test.mts guards it).
 *
 * Pure (type-only imports plus lib/format.ts), so client components and Node tests load it directly.
 */
import type { CdsCoreAreaKey, CdsProgramKey, ReportedAcademics, School } from "../types";
import { pct } from "../format.ts";

/** The seven I-3 bins, in order. */
export const CLASS_SIZE_BINS = ["2–9", "10–19", "20–29", "30–39", "40–49", "50–99", "100+"] as const;

/* ------------------------------------------------------------------ */
/* Class sizes                                                         */
/* ------------------------------------------------------------------ */

const shareOf = (bins: readonly number[], pick: (i: number) => boolean): number | null => {
  if (bins.length !== CLASS_SIZE_BINS.length || bins.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const total = bins.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return bins.reduce((a, v, i) => a + (pick(i) ? v : 0), 0) / total;
};

/** Sections of 2–19 students (the first two bins) ÷ all sections; null without seven non-negative bins. Never stored. */
export function classSizeShareUnder20(sections: readonly number[]): number | null {
  return shareOf(sections, (i) => i < 2);
}

/** Sections of 50 or more students (the last two bins) ÷ all sections. Never stored. */
export function classSizeShareOver50(sections: readonly number[]): number | null {
  return shareOf(sections, (i) => i >= 5);
}

/** The school's under-20 share, or null without a `class_sections` record. */
export const classesUnder20 = (s: Pick<School, "reported">): number | null => {
  const c = s.reported?.academics?.class_sections;
  return c ? classSizeShareUnder20(c.sections) : null;
};

/** Compare's "Classes under 20 students" cell: the profile headline's share, or null ("–") without a record. */
export function compareClassesUnder20(s: Pick<School, "reported">): string | null {
  const v = classesUnder20(s);
  return v === null ? null : pct(v);
}

/* ------------------------------------------------------------------ */
/* Programs and core curriculum                                        */
/* ------------------------------------------------------------------ */

/** E1 programs in template order, with their chip labels (facts, never checklists). */
export const PROGRAM_LABELS: Record<CdsProgramKey, string> = {
  accelerated: "Accelerated program",
  cross_registration: "Cross-registration",
  distance_learning: "Distance learning",
  double_major: "Double major",
  dual_enrollment: "Dual enrollment",
  esl: "English as a Second Language",
  exchange: "Domestic exchange program",
  honors: "Honors program",
  independent_study: "Independent study",
  internships: "Internships",
  liberal_arts_career: "Liberal arts/career combination",
  student_designed_major: "Student-designed major",
  teacher_certification: "Teacher certification",
  weekend_college: "Weekend college",
};
export const PROGRAM_KEYS = Object.keys(PROGRAM_LABELS) as CdsProgramKey[];

/** E3 areas in template order, as the "Requires: …" list words them. */
export const CORE_AREA_LABELS: Record<CdsCoreAreaKey, string> = {
  arts: "arts",
  computer_literacy: "computer literacy",
  english: "English composition",
  foreign_languages: "a foreign language",
  history: "history",
  physical_education: "physical education",
  humanities: "humanities",
  intensive_writing: "intensive writing",
  mathematics: "math",
  philosophy: "philosophy",
  sciences: "a natural science",
  social_science: "social science",
};
export const CORE_AREA_KEYS = Object.keys(CORE_AREA_LABELS) as CdsCoreAreaKey[];

/** True only when the college marked the program. A missing key is "not seen", never "not offered". */
export function hasCdsProgram(programs: ReportedAcademics["programs"] | undefined, key: CdsProgramKey): boolean {
  return programs?.[key] === true;
}

/**
 * Throws unless every key is a known program/area set to `true` (blank ≠ no: `false` must never be stored). Used by the
 * merge before anything is written, and by the tests.
 */
export function assertOfferedOnly(map: Record<string, unknown> | undefined, known: readonly string[], what: string): void {
  if (!map) return;
  for (const [k, v] of Object.entries(map)) {
    if (!known.includes(k)) throw new Error(`${what}: unknown key "${k}"`);
    if (v !== true) throw new Error(`${what}.${k} is ${JSON.stringify(v)}: only "true" (marked) may be stored; a blank box is not "no"`);
  }
}

/** Programs the college marked, as chip labels in template order. */
export function offeredPrograms(s: Pick<School, "reported">): { key: CdsProgramKey; label: string }[] {
  const p = s.reported?.academics?.programs;
  return PROGRAM_KEYS.filter((k) => hasCdsProgram(p, k)).map((key) => ({ key, label: PROGRAM_LABELS[key] }));
}

/**
 * Required coursework: `{ kind: "areas" }` with the checked areas, `{ kind: "open" }` when the E3 section was read and
 * nothing was checked (stored as an empty object), or null when it wasn't read (absent): never "open" for a document
 * we didn't reach.
 */
export function coreCurriculum(s: Pick<School, "reported">): { kind: "areas"; areas: string[] } | { kind: "open" } | null {
  const c = s.reported?.academics?.core_curriculum;
  if (!c) return null;
  const areas = CORE_AREA_KEYS.filter((k) => c[k] === true);
  return areas.length ? { kind: "areas", areas: areas.map((k) => CORE_AREA_LABELS[k]) } : { kind: "open" };
}

/** "English composition, math, and a natural science". */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Explore: "Has an honors program" (positive only)                    */
/* ------------------------------------------------------------------ */

/** The one Explore filter. Matches only colleges whose CDS marks an honors program; nothing excludes for its absence. */
export const hasHonorsProgram = (s: Pick<School, "reported">): boolean => hasCdsProgram(s.reported?.academics?.programs, "honors");
export const HONORS_FILTER_LABEL = "Honors program";

/* ------------------------------------------------------------------ */
/* The college's own ratio                                             */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => n.toLocaleString("en-US");

/** "8 to 1" (one decimal kept when the college prints one: "12.1 to 1"). */
export const ratioText = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(1)} to 1`;

/** "(7,329 students, 935 faculty)", or "" when the counts aren't printed. */
export function ratioBasis(r: NonNullable<ReportedAcademics["student_faculty_ratio"]>): string {
  return r.students !== null && r.faculty !== null ? ` (${fmt(r.students)} students, ${fmt(r.faculty)} faculty)` : "";
}
