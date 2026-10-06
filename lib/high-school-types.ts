/**
 * High school data types (specs/product/high-school-data.md). Types only: importable from the app, scripts, and tests.
 *
 * Files (data/high-schools/, or HIGH_SCHOOLS_DIR):
 *   meta.json                 HighSchoolMeta
 *   medians.json              StateMedians (public high schools only; computeStateMedians)
 *   schools/{XX}.json         HighSchoolShard (uppercase USPS; 50 states + DC)
 *   state/{xx}.json           HighSchoolStateFile (lowercase USPS; state report cards)
 *   detail/{id}.json          HighSchoolDetail (school profile PDFs)
 *
 * Names are fixed (other units build on them); fields may be added, never renamed.
 */

/** Every source a high school value can cite. State report cards are one key per state. */
export type HsSourceKey =
  | "nces-ccd"
  | "edfacts"
  | "crdc"
  | "nces-pss"
  | "hs-profile"
  | "state-ca"
  | "state-tx"
  | "state-ny"
  | "state-fl"
  | "state-il"
  | "state-sc"
  | "state-ct";

/** Release years written by the sync to meta.json `vintages`. State report years live in each state file's sections. */
export type HsVintageKey = "ccd-directory" | "ccd-enrollment" | "edfacts-acgr" | "edfacts-acgr-history" | "crdc" | "pss";

/** Page sections of a high school page; every registered field belongs to one. */
export type HsTopic = "basics" | "enrollment" | "rigor" | "outcomes" | "grading" | "where-go";

/** CCD / PSS race and ethnicity categories (the federal seven). */
export type HsRaceKey = "american_indian" | "asian" | "black" | "hispanic" | "pacific_islander" | "two_or_more" | "white";
export type RaceKey = HsRaceKey;

/** Grade-level codes as CCD and PSS write them: "PK", "KG", "1".."12", "13" (grade 13 / ungraded upper). */
export type GradeCode = "PK" | "KG" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "UG";

export type HsGrade = "9" | "10" | "11" | "12";

/** One high school: a row in data/high-schools/schools/{XX}.json. */
export interface HighSchool {
  /** Public: 12-digit NCES `ncessch`. Private: the 8-character PSS `ppin`. See isHighSchoolId. */
  id: string;
  kind: "public" | "private";
  name: string;
  /** USPS code, uppercase. */
  state: string;
  city: string | null;
  zip: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** CCD urban-centric locale label ("City: Large", "Suburb: Midsize", …). */
  locale: string | null;
  /** Public only (LEA id and name); null for private schools. */
  district: { id: string; name: string } | null;
  /** The state's own school id (CCD `ST_SCHID`), for crosswalking state report files. Public only. */
  state_school_id: string | null;
  grades: { low: string; high: string };
  status: { charter: boolean | null; magnet: boolean | null; title_i: boolean | null; virtual: boolean | null };
  /** CCD school type: "Regular school", "Special education school", "Career and technical school", "Alternative school". */
  school_type: string | null;
  /** PSS religious affiliation / orientation label; null for public schools. */
  affiliation: string | null;
  enrollment: {
    total: number | null;
    by_grade: Partial<Record<HsGrade, number | null>>;
    by_race: Partial<Record<HsRaceKey, number | null>> | null;
    female: number | null;
  };
  student_teacher_ratio: number | null;
  /** Free or reduced-price lunch eligible share (CCD), 0–1. */
  frl_share: number | null;
  /**
   * EDFacts adjusted cohort graduation rate, 0–1. An exact rate is `value` (low/high null); a range the source
   * publishes instead ("GE80", "90-94") is `low`/`high` with `value` null. Never a midpoint.
   */
  grad_rate: { value: number | null; low: number | null; high: number | null; cohort: number | null } | null;
  /**
   * The same rate for every class in the school-level ED Data Express files, oldest → newest ("Class of 2015" …), each
   * exact (`value`) or a published range (`low`/`high`), never a midpoint. `suppressed: true` marks a class whose rate
   * the source suppressed (a gap in the trend). Null when the files hold fewer than two classes for the school (one
   * entry would only repeat `grad_rate`). When `grad_rate` is set, the newest entry is that same figure.
   */
  grad_history: HsGradHistoryEntry[] | null;
  /** CRDC: AP/IB/dual enrollment counts (students). `enrollment` is CRDC's own school enrollment, the denominator for its shares. */
  rigor: {
    ap_courses: number | null;
    ap_enrolled: number | null;
    ap_exam_takers: number | null;
    ap_passed_some: number | null;
    ib_enrolled: number | null;
    dual_enrolled: number | null;
    enrollment: number | null;
  } | null;
  /** HsFieldPaths whose null means "suppressed for privacy" (or fewer than 5), not "missing". */
  suppressed?: string[];
  /** Only where a value's source or year differs from its HS_FIELDS default. Keys are registered HsFieldPaths. */
  lineage?: Record<string, HsLineage>;
}

export interface HsGradHistoryEntry {
  /** "Class of 2021": the cohort that graduated at the end of the 2020–21 school year. */
  year: string;
  value: number | null;
  low: number | null;
  high: number | null;
  cohort: number | null;
  suppressed?: true;
}

export interface HsLineage {
  source: HsSourceKey;
  year?: string | null;
  url?: string;
  retrieved?: string;
  method?: "reported" | "derived" | "extracted";
  quote?: string;
  page?: number;
}

/** data/high-schools/schools/{XX}.json: one state's rows, sorted by id, keys in canonical order (normalizeHighSchool). */
export interface HighSchoolShard {
  state: string;
  schools: HighSchool[];
}

export interface HsSourceInfo {
  name: string;
  publisher: string;
  url: string;
  /** YYYY-MM-DD the file was downloaded. */
  retrieved: string;
}

/** data/high-schools/meta.json. */
export interface HighSchoolMeta {
  /** YYYY-MM-DD the files were written. */
  generated: string;
  sources: Partial<Record<HsSourceKey, HsSourceInfo>>;
  /** "2023–24", "Class of 2022", …; null when that file hasn't been loaded yet. */
  vintages: Record<HsVintageKey, string | null>;
  counts: { public: number; private: number; byState: Record<string, number> };
}

/** Fields a state report card file can carry; all are shares 0–1. */
export type HsStateField =
  | "college_going_rate"
  | "ap_pass_rate"
  | "ela_proficiency"
  | "math_proficiency"
  | "chronic_absence"
  | "nsc_enrolled_fall"
  | "nsc_persisted"
  | "nsc_completed";

export interface HsStateSection {
  /** Unique within the file, e.g. "college-going". */
  key: string;
  /** `state-{xx}` of the file's state. */
  source: HsSourceKey;
  /** What the reader sees: "California Department of Education, College-Going Rate". */
  label: string;
  /** The period the values describe: "Class of 2022", "2023–24". */
  year: string;
  url: string;
  /** YYYY-MM-DD. */
  retrieved: string;
  /** Each HsStateField appears in at most one section of a file, so its citation is unambiguous. */
  fields: HsStateField[];
  notes?: string;
}

export type HsStateValues = Partial<Record<HsStateField, number | null>> & { suppressed?: HsStateField[] };

/** data/high-schools/state/{xx}.json (lowercase USPS). */
export interface HighSchoolStateFile {
  /** USPS, uppercase. */
  state: string;
  sections: HsStateSection[];
  /** Keyed by public `ncessch`. */
  schools: Record<string, HsStateValues>;
  /** Rows the crosswalk couldn't map (or mapped to a school not in the shard), for review. */
  unmatched?: { stateId: string; name: string; ncessch?: string; reason?: string }[];
}

/**
 * data/high-schools/medians.json: per state (USPS), the median of each key over the state's public high schools.
 * Keys are HsFieldPaths (incl. derived.*) and HsStateFields. Computed by computeStateMedians; a test recomputes it.
 */
export type StateMedians = Record<string, Partial<Record<string, number | null>>>;

/** A number read from a school profile, with the words it came from. */
export interface CitedNum {
  v: number;
  quote: string;
  page?: number;
}

/** data/high-schools/detail/{id}.json: what a school's own profile PDF says (phase 3). */
export interface HighSchoolDetail {
  id: string;
  profile: { url: string; retrieved: string; edition: string; hash?: string };
  class_size: CitedNum | null;
  gpa_scale: {
    kind: "unweighted-4" | "weighted-5" | "100-point" | "other";
    max: number | null;
    weighted: boolean;
    /** The school's own conversion rule, verbatim. */
    conversion: string | null;
    quote: string;
    page?: number;
  } | null;
  /** Shares 0–1, summing to 1 ± 0.02. */
  gpa_distribution: { band: string; share: number }[] | null;
  ap_courses: string[] | null;
  ib_courses: string[] | null;
  scores: {
    sat_mid50?: [number, number] | null;
    act_mid50?: [number, number] | null;
    /** Mean section scores, when the profile prints means instead of ranges. */
    sat_mean?: { erw: number; math: number } | null;
    act_mean?: number | null;
    /** The year the scores describe ("2025–26"); defaults to the edition. */
    year?: string;
    quote?: string;
    page?: number;
  } | null;
  /** Where graduates enrolled. Never an admitted list: that's `admitted`. */
  matriculation: {
    /** "2023–2025". */
    classes: string;
    entries: { name: string; unit_id: string | null; count: number | null }[];
    quote?: string;
    page?: number;
  } | null;
  /** Colleges that admitted members of a class (most profiles print this instead of enrollment). Optional: older files lack it. */
  admitted?: {
    /** "Class of 2026". */
    classes: string;
    entries: { name: string; unit_id: string | null }[];
    quote: string;
    page?: number;
  } | null;
  /** The school's own figures for its latest graduating class; shares 0–1. */
  school_outcomes?: {
    class: string;
    class_size: number | null;
    grad_rate: number | null;
    college_going: number | null;
    four_year: number | null;
    two_year: number | null;
    quote: string;
    page?: number;
  } | null;
  /** The school's AP results for one year. */
  ap_stats?: { year: string; students: number | null; exams: number | null; pass_share: number | null; quote: string; page?: number } | null;
  /** Enrollment as the profile prints it (the profile's own year, usually the edition). */
  enrollment?: { year: string; total: number; by_grade: Partial<Record<"9" | "10" | "11" | "12", number>>; quote: string; page?: number } | null;
}

/** A school's state report values, merged by mergeStateReport. */
export interface HsStateReport {
  values: Partial<Record<HsStateField, number | null>>;
  suppressed: HsStateField[];
  /** Only the sections that cite something this school has (a value or a suppressed cell). */
  sections: HsStateSection[];
}

/** One row as published to Supabase `high_schools.data`: the row with its state report merged in. */
export type PublishedHighSchool = HighSchool & { state_report: HsStateReport | null };

/** Everything a high school page needs. */
export interface HighSchoolView {
  school: HighSchool;
  state_report: HsStateReport | null;
  detail: HighSchoolDetail | null;
  medians: StateMedians[string] | null;
  meta: HighSchoolMeta;
  /**
   * Values the school's own newer profile replaced (applyProfileNewest), by field path: what was there before and
   * whose it was, for the ⓘ ("NCES Common Core of Data, 2024–25: 1,086").
   */
  replaced?: Partial<Record<string, HsReplaced>>;
}

/** A value a newer school-reported figure replaced. */
export interface HsReplaced {
  value: number | null;
  year: string | null;
  label: string;
  /** Already formatted ("99–100%", "1,086"). */
  display: string;
}

/** A search result / picker entry. */
export interface HighSchoolHit {
  id: string;
  name: string;
  city: string | null;
  state: string;
  kind: "public" | "private";
  district: string | null;
  /** "9–12", "PK–12". */
  grades: string;
}
