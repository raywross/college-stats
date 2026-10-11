/**
 * Shared types for the admission-chances work (specs/chances/README.md): the student's course list, the high school's
 * offering, the pool rates, how a unit reviews the intended major, and the estimate's contract. Pure, client-safe
 * types only: no runtime code, no method. Every unit imports these and never redefines them; additions are additive.
 */

/** The kind of course a student lists (rigor-in-context.md "The student's courses"). "regular": math and science only, for STEM majors. */
export type CourseKind = "ap" | "ib_hl" | "ib_sl" | "dual" | "honors" | "regular";
export type CourseSubject = "english" | "math" | "science" | "history" | "language" | "cs" | "arts" | "other";
export type CourseStatus = "taken" | "in_progress" | "planned";
/** A letter grade, or P (pass, never counted in a GPA). */
export type Mark = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F" | "P";

/** One course on the student's list. */
export interface CourseEntry {
  id: string;
  kind: CourseKind;
  /** AP and IB: a catalog key ("ap_calculus_bc"); null for dual, honors, regular, and unnamed placeholder rows. */
  key: string | null;
  /** Dual, honors, and regular: as the student typed it (at most 60 characters); null for AP and IB. */
  name: string | null;
  subject: CourseSubject;
  year: 9 | 10 | 11 | 12;
  status: CourseStatus;
  grades: { s1: Mark | null; s2: Mark | null; final: Mark | null };
  /** AP exam score, optional; student-private by default (`apExamsPrivate`). */
  exam: 1 | 2 | 3 | 4 | 5 | null;
}

/** The rigor reading (rigor-in-context.md "The reading"); which schedules land where is the method's, never shown. */
export type RigorReading = "most" | "much" | "some" | "few_offered" | "cant_place";

/** What the student's high school offers, from the best source on record (lib/chances/offering.ts). */
export interface SchoolOffering {
  /** How many different AP courses; 0 when the school says it offers none; null when unknown. */
  apCount: number | null;
  /** Catalog keys of the AP courses, when a list is known (profile, pooled, or the student's marks); else null. */
  apKeys: string[] | null;
  ib: boolean | null;
  dual: boolean | null;
  source: "profile" | "pooled" | "student" | "crdc" | null;
  /** The high school field path the offering cites (HS_FIELDS), e.g. "detail.ap_courses" or "rigor.ap_courses"; null for pooled, student, or nothing. */
  field: string | null;
}

export type PoolRateKind = "guaranteed" | "major" | "residency" | "overall";
/** The admit rate for the student's own pool (base-rates.md). */
export interface PoolRate {
  kind: PoolRateKind;
  /** Share admitted, 0–1; null for a guarantee (a rule, not a rate) or a major that publishes no rate. */
  rate: number | null;
  label: string;
  /** The field path the rate cites. */
  field: string;
  edition: string | null;
  /** For kind "guaranteed": the program's id in data/guaranteed-admission.json. */
  programId?: string;
  scope?: "campus" | "system";
}

/** How a unit says the intended major is considered (major-and-grades.md "Data"). */
export type MajorConsidered = "no" | "pool" | "pool_and_emphasis";
export type MajorEmphasis = "math" | "science" | "cs" | "writing" | "arts";
export type MajorGateKind = "sat_math" | "act_math" | "ap" | "ib_hl";

export interface MajorReview {
  major_considered: MajorConsidered | null;
  emphasis: MajorEmphasis[];
  required_courses: { subject: CourseSubject; level: string; quote: string }[];
  /** A score requirement: any one route meets it. `course` is a catalog key for kind "ap" or "ib_hl". */
  gate: { any_of: { kind: MajorGateKind; course?: string; min: number }[] } | null;
  quote: string;
  source_url: string;
  /** ISO date the statement was read. */
  fetched: string;
  edition: string | null;
}

/** One admitting unit (the university, a school or college within it, or a major) in data/major-admission.json. */
export interface MajorAdmissionUnit {
  /** "{IPEDS unit_id}" for the university itself, else "{unit_id}:{slug}" (e.g. "190415:engineering"). */
  unit_id: string;
  unit: "university" | "school" | "major";
  name: string;
  /** Two-digit CIP families (lib/majors.ts) the unit admits; empty for a university-level statement. */
  cip_families: string[];
  direct_admit: boolean | "some" | null;
  admit_rate: { admitted: number; applied: number; year: string; quote: string; source_url: string } | null;
  /**
   * A rate the college prints as a percentage without counts (Illinois's admit rates by college), 0–1, with its
   * percentage in the quote. Only where `admit_rate` is null. Optional: absent means none.
   */
  published_rate?: { rate: number; year: string; quote: string; source_url: string } | null;
  review: MajorReview | null;
}

/** The kinds of input the estimate can use; the site lists which were used, never how. */
export type InputKind = "gpa" | "test" | "sections" | "class_rank" | "courses" | "subject_grades" | "state" | "major" | "round" | "high_school";
/** Keys of NOTES in lib/chances/notes.ts. */
export type NoteKey = string;
/** A catalog sentence the estimate picked, with the values that fill it and the field path its value cites. */
export interface EstimateNote {
  key: NoteKey;
  values: Record<string, string | number>;
  cite?: string;
}

export interface EstimateStudent {
  /** Unweighted 4.0-scale GPA (unweightedGpa4). */
  gpa: number | null;
  gpaScale: string;
  gpaRange?: [number, number] | null;
  test: { kind: "sat" | "act"; score: number } | null;
  satMath: number | null;
  actMath: number | null;
  classRankPercentile: number | null;
  courses: CourseEntry[];
  /** USPS code, or null. */
  state: string | null;
  /** Two-digit CIP families, most-interested first. */
  majors: string[];
  round: string | null;
  highSchoolId: string | null;
  practice?: boolean;
}

export interface EstimateInput {
  student: EstimateStudent;
  unitId: string;
}

export interface EstimateResult {
  unitId: string;
  group: "reach" | "target" | "likely" | null;
  label: "reach-for-everyone" | "guaranteed" | null;
  used: InputKind[];
  missing: InputKind[];
  /** Field paths to cite beside it. */
  facts: string[];
  notes: EstimateNote[];
  send: "send" | "consider-not-sending" | "required-missing" | "not-used" | null;
  moveUp: { points: number; to: "target" | "likely"; score: number } | null;
  modelVersion: string;
}
