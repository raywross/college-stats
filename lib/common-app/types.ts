/**
 * Common App data (specs/data-expansion/common-app.md): the shapes shared by the grid parser and member reader
 * (scripts/lib/common-app/), the merge into data/schools.json (scripts/lib/common-app/merge.mts), and the display
 * code that reads `school.apply`. Pure types; the brief for the build (common-app-build/brief.md) fixes them up front
 * so the units agree. Additive edits only.
 */

/** The grid's "Test policy" column (note 7): Always required, Flexible, Ignored, Never required, Sometimes required. */
export type GridTestCode = "A" | "F" | "I" | "N" | "S";
/** The grid's "English proficiency" codes: Cambridge, Duolingo, IELTS, PTE, TOEFL, none. */
export type EnglishTestCode = "C" | "D" | "I" | "P" | "T" | "N";
/** "Accepted", "U.S. only", "Not Accepted"; a blank cell is null. */
export type FeeWaiver = "accepted" | "us_only" | "not_accepted";
/** SR = SlideRoom, COL = the college's own system. */
export type Portfolio = "slideroom" | "own";
/** The grid's "School type" column (note 1). */
export type SchoolTypeCode = "coed" | "women" | "men" | "coordinate";

/** Early and regular rounds as the grid prints them: ISO dates; `regular` is "rolling" when the cell says Rolling. */
export interface GridDeadlines {
  ed: string | null;
  ed2: string | null;
  ea: string | null;
  ea2: string | null;
  rea: string | null;
  regular: string | "rolling" | null;
}

export interface GridFee {
  /** Whole dollars; "$0" is 0. Null when the cell is blank. */
  us: number | null;
  international: number | null;
}

export interface GridTestPolicy {
  code: GridTestCode;
  /** The "SAT/ACT tests used" cell as printed ("SAT without essay or ACT with science", "None", "See website"), joined across wrapped rows. */
  tests_used: string | null;
  english_tests: EnglishTestCode[];
}

export interface GridRecommendations {
  /** TE: teacher evaluations required (blank → 0). */
  teacher: number;
  /** OE: other evaluations required (blank → 0). */
  other: number;
  /** CR: counselor recommendation required. */
  counselor: boolean;
  /** MR: mid-year report required. */
  mid_year_report: boolean;
}

/** One member's row in the Requirements Grid, typed. Y-columns: Y → true, blank → false (the grid prints Y only when required). */
export interface GridRow {
  /** The name as printed, with wrapped lines joined by one space. */
  name: string;
  /** 1-based page of the PDF the row is on. */
  page: number;
  /** Joined through the Explore records (scripts/lib/common-app/names.mts); null when the name matched nothing. */
  unit_id: string | null;
  slug: string | null;
  school_type: SchoolTypeCode;
  deadlines: GridDeadlines;
  fee: GridFee;
  fee_waiver: FeeWaiver | null;
  essay_required: boolean;
  courses_grades_required: boolean;
  portfolio: Portfolio | null;
  writing_supplement: boolean;
  test_policy: GridTestPolicy;
  recommendations: GridRecommendations;
  saves_forms: boolean;
}

/** data/common-app/grid/<cycle>_<updated>.json: one parsed edition of the grid. The PDF is kept beside it. */
export interface GridEdition {
  /** "2026-27", from the grid's own title. */
  cycle: string;
  /** "2026-09-25", from the "Updated: 09-25-2026" stamp. */
  updated: string;
  source_url: string;
  /** The day the PDF was downloaded, ISO. */
  retrieved: string;
  pages: number;
  rows: GridRow[];
  /** Grid names that matched no Explore title, alias, or hand-map entry; never guessed. */
  unmatched: string[];
}

/** One Common App member, from its Explore record (page-data.json). Marketing text, quotes, photos, and logos are never kept. */
export interface Member {
  slug: string;
  title: string;
  member_id: string | null;
  /** IPEDS unit id (field_su_ipeds); null when the record has none (non-US members, some community colleges). */
  ipeds: string | null;
  /** Two-letter state, or null outside the US. */
  state: string | null;
  /** field_su_alternate_names split on commas and trimmed ("VU", "Vandy"). */
  alternate_names: string[];
  /** field_mp_fac_{need,merit,international}_fa: "Yes" → true, "No" → false, unanswered → null. */
  aid: { need: boolean | null; merit: boolean | null; international: boolean | null };
  /** URLs on the college's own site; never a commonapp.org URL. */
  links: { daca_aid: string | null; transfer_guarantee: string | null; first_year_admissions: string | null; financial_aid: string | null };
  /** field_su_ff_fy_*: "Yes" → true, null → false. */
  first_year: { essay: boolean; test_optional: boolean; fee_waiver: boolean; self_reported_scores: boolean; recommendations_required: boolean };
  /** ISO day this record was read. */
  retrieved: string;
}

/** data/common-app/members.json. */
export interface MembersFile {
  /** ISO day of the newest read. */
  retrieved: string;
  /** Where the slugs came from. */
  sitemap_url: string;
  members: Member[];
}

/** data/common-app/name-map.json: grid name → Explore slug, for names no rule matches. Checked by hand. */
export type NameMap = Record<string, string>;

/** The block stored on a member school as `school.apply` (specs/data-expansion/common-app.md "Store"). */
export interface SchoolApply {
  common_app: {
    member: true;
    member_id: string | null;
    slug: string;
    /** The grid edition the row came from; null for a member with no grid row (transfer-only, or not yet joined). */
    cycle: string | null;
    updated: string | null;
  };
  deadlines: GridDeadlines | null;
  fee: GridFee | null;
  fee_waiver: FeeWaiver | null;
  essay_required: boolean | null;
  courses_grades_required: boolean | null;
  writing_supplement: boolean | null;
  portfolio: Portfolio | null;
  test_policy: GridTestPolicy | null;
  recommendations: GridRecommendations | null;
  school_type: SchoolTypeCode | null;
  saves_forms: boolean | null;
}
