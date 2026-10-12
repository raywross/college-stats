/**
 * Shared types for the admission-chances work (specs/chances/README.md): the student's course list, the high school's
 * offering, the pool rates, how a unit reviews the intended major, and the estimate's contract. Pure, client-safe
 * types only: no runtime code, no method. Every unit imports these and never redefines them; additions are additive.
 */

/** The kind of course a student lists (rigor-in-context.md "The student's courses"). "regular": math and science only, for STEM majors. */
export type CourseKind = "ap" | "ib_hl" | "ib_sl" | "dual" | "honors" | "regular";
export type CourseSubject = "english" | "math" | "science" | "history" | "language" | "cs" | "arts" | "other";
export type CourseStatus = "taken" | "in_progress" | "planned";
/** When in the school year a course runs (the intake's "When?" chips, specs/planner/redesign/intake.md). */
export type CourseTerm = "full" | "fall" | "spring";
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
  /** AP exam score, optional. Guardians see it; `apExamsPrivate` hides it only from other students in the household. */
  exam: 1 | 2 | 3 | 4 | 5 | null;
  /** Optional (additive, intake.md): the term within `year` a course in progress or planned runs; absent means null. */
  term?: CourseTerm | null;
}

/** The rigor reading (rigor-in-context.md "The reading"); which schedules land where is the method's, never shown. */
export type RigorReading = "most" | "much" | "some" | "few_offered" | "cant_place";

/** What the student's high school offers, from the best source on record (lib/chances/offering.ts). */
export interface SchoolOffering {
  /** How many different AP courses; 0 when the school says it offers none; null when unknown. */
  apCount: number | null;
  /** Catalog keys of the AP courses, when a list is known (profile and Ledger together, either alone, pooled, or the student's marks); else null. */
  apKeys: string[] | null;
  ib: boolean | null;
  dual: boolean | null;
  /** "record": the school's profile and the AP Course Ledger together, everything either lists. */
  source: "record" | "profile" | "ledger" | "pooled" | "student" | "crdc" | null;
  /** The high school field path the offering cites (HS_FIELDS), e.g. "derived.ap_list", "detail.ap_courses", "ap_ledger", or "rigor.ap_courses"; null for pooled, student, or nothing. */
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
export type InputKind =
  | "gpa" | "test" | "sections" | "class_rank" | "courses" | "subject_grades" | "state" | "major" | "round" | "high_school"
  | "activities" | "awards" | "work" | "legacy" | "recruited" | "interest" | "class_standing";
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
  /** Admission chances, next (optional; absent reads as empty): depth.md and inputs-beyond-academics.md. */
  activities?: ActivityEntry[];
  awards?: AwardEntry[];
  classStanding?: ClassStanding | null;
  firstGeneration?: boolean | null;
  /** Weighted GPA as the school reports it (on `gpaScale`'s family); with `gpa`, a rigor signal (U14). */
  weightedGpa?: number | null;
  /** Valedictorian or salutatorian, as the student expects it (an expectation: it's decided after admissions). */
  rankExpectation?: RankExpectation | null;
  /**
   * Revision 3 (method/standing.md, owner 2026-10-12): the score the student is aiming for on their focus test
   * (profile `tests.target`), read in place of a lower or missing actual score until junior year ends.
   */
  testTarget?: { kind: "sat" | "act"; score: number } | null;
  /** The student's high school graduation year (profile `basics.gradYear`): when junior year ends. */
  gradYear?: number | null;
  /**
   * All four activity steps answered, each with an entry or "None" (owner, 2026-10-12; profile
   * `academics.activitiesNone`): Revision 1's completeness reads activities as present. No depth credit.
   */
  activitiesAnswered?: boolean;
}

export interface EstimateInput {
  student: EstimateStudent;
  unitId: string;
  /** The list row's legacy, recruited, and interest inputs for this college; absent reads as NO_HOOKS. */
  hooks?: CollegeHooks;
}

export interface EstimateResult {
  unitId: string;
  /** The level (levels.md); null when nothing can be placed ("Add a number"). */
  group: StandingLevel | null;
  label: StandingLabel | null;
  used: InputKind[];
  missing: InputKind[];
  /** Field paths to cite beside it. */
  facts: string[];
  notes: EstimateNote[];
  send: "send" | "consider-not-sending" | "required-missing" | "not-used" | null;
  moveUp: { points: number; to: StandingLevel; score: number } | null;
  /**
   * Which quarter of its level's band the college sits in, 3 = nearest the next level up; null without a level or
   * when a cap or floor set it. Orders a section "closest first" (levels.md); the only trace of the hidden odds.
   */
  closeness: 0 | 1 | 2 | 3 | null;
  /** What early decision would do here (method/standing.md "The ED sentence"); null without a level. */
  ed: "helps" | "same" | "not_advised" | null;
  /**
   * Who the student is compared with and that group's published admit rate (pool-explainer.md), for Compare's
   * sub-line: the rate's kind, the college's own published rate (0–1; null for a guarantee), and the catalog key of
   * the short "who" phrase ("pool.who.residency_in") with its values ({ state: "Indiana" }). Public facts only, never
   * the hidden odds. Absent or null without a published rate (open admission, the baseline).
   */
  pool?: EstimatePool | null;
  modelVersion: string;
}

/** EstimateResult.pool. */
export interface EstimatePool {
  kind: PoolRateKind;
  rate: number | null;
  whoKey: NoteKey;
  whoValues: Record<string, string>;
}

/* ---- Admission chances, next (specs/chances/levels.md, selectivity-index.md, depth.md, inputs-beyond-academics.md) ----
 * Shared contracts for the five-level build, decided up front so its units agree; their word lists and limits are in
 * lib/chances/levels.ts. Additive: the estimate's result switches to `StandingLevel` when the method's third version
 * lands (levels.md "The estimate's contract").
 */

/** The five levels, lowest first (levels.md "The levels"). Stored values; the words may change, these don't. */
export type StandingLevel = "high_reach" | "reach" | "target" | "likely" | "safe";
/** The label on top of a level (levels.md): "elite" replaces "reach-for-everyone"; "recruited" is new. */
export type StandingLabel = "elite" | "guaranteed" | "recruited";

/** Quad's selectivity tier (selectivity-index.md "Tiers"), hardest first. Stored values. */
export type SelectivityTier = "elite" | "highly_selective" | "very_selective" | "selective" | "accessible" | "open";
/** Which applicants a tier describes: a public with residency rates has one per pool. */
export type SelectivityPool = "all" | "in_state" | "out_of_state";

/** One activity (depth.md "What the student enters"). */
export type ActivityKind = "sport" | "club" | "arts" | "service" | "work" | "research" | "family" | "other";
export type ActivityRole = "member" | "officer" | "leader";
export type HsYear = 9 | 10 | 11 | 12;
/** Recognition tier: 1 national or international · 2 state or regional · 3 school-level distinction · 4 took part. */
export type RecognitionTier = 1 | 2 | 3 | 4;
export interface ActivityEntry {
  id: string;
  /** As typed, at most 60 characters. */
  name: string;
  kind: ActivityKind;
  years: HsYear[];
  /** Per checked year; a checked year with no role is "member". The model reads these tiers. */
  roles: Partial<Record<HsYear, ActivityRole>>;
  /**
   * The catalog entry picked (data/reference/sports.json or clubs.json key), null when typed freely. Optional so
   * profiles saved before the catalogs read as typed entries.
   */
  catalogKey?: string | null;
  /** What the activity is about, from the catalog or the student's pick; ties activities to course tracks (depth). */
  family?: ActivityFamily | null;
  /** The title the student picked per year ("Varsity", "Captain", "President"), from data/reference/activity-roles.json; each maps to a tier in `roles`. */
  titles?: Partial<Record<HsYear, string>>;
  /** During the school year, 1–60; null when not given. */
  hoursPerWeek: number | null;
  recognition: RecognitionTier | null;
  relatedToMajor: boolean;
}

/** One award (inputs-beyond-academics.md "Awards"); `key` is an id in data/reference/awards.json, null for "Something else". */
export interface AwardEntry {
  id: string;
  key: string | null;
  name: string;
  tier: RecognitionTier;
  year: HsYear | null;
}

/** The class-standing pick (inputs-beyond-academics.md "Class standing"). */
export type ClassStanding = "top1" | "top5" | "top10" | "top25" | "top50" | "lower" | "no_rank";
/** An expectation the student states; never a fact until after admissions (owner, 2026-10-12). */
export type RankExpectation = "valedictorian" | "salutatorian";
/**
 * What an activity is about (U12 classifies the catalogs). The course families (CourseSubject minus "other") let an
 * activity line up with a course track; the rest describe activities with no course of their own.
 */
export type ActivityFamily = Exclude<CourseSubject, "other"> | "business" | "health" | "engineering" | "service" | "athletics" | "leadership" | "media" | "faith" | "other";

/** Depth readings (depth.md "The reading"): words, never scores. */
export type TrackReading = "deep" | "steady" | "light" | "not_offered";
export type ActivitiesReading = "focused" | "building" | "sampling";

/** The per-college list-row inputs (inputs-beyond-academics.md "Legacy", "Recruited athlete", "Demonstrated interest"). */
export type RecruitedPick = "none" | "contact" | "pre_read" | "likely_letter";
export interface CollegeHooks {
  legacy: boolean;
  /** A brother or sister went here (owner, 2026-10-12): read like legacy, gated the same way, with a smaller weight. */
  sibling: boolean;
  recruited: RecruitedPick;
  /** A visit, interview, or information request is logged in the planner for this college. */
  interest: boolean;
}
