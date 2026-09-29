import type { FieldPath, VintageKey } from "./fields";
import type { Direction, IndicatorKey } from "./indicators";
import type { GenderBalance } from "./student-body";

export type SchoolType = "public" | "private-nonprofit" | "private-forprofit";

/** IPEDS ADMCON7: how test scores are used in admissions. */
export type TestPolicy = "required" | "recommended" | "considered" | "not-considered" | null;

/**
 * One institution. Fields are `null` when the school doesn't report them
 * (e.g. open-admission colleges have no acceptance rate or test scores).
 */
export interface School {
  unit_id: string;
  name: string;
  location: {
    city: string;
    state: string;
    zip: string;
    region: string;
  };
  type: SchoolType;
  admissions: {
    /** Fall term the admissions figures describe; null if none reported. */
    year: number | null;
    applicants: number | null;
    admitted: number | null;
    enrolled: number | null;
    acceptance_rate: number | null;
    sat_reading_25_75: [number, number] | null;
    sat_math_25_75: [number, number] | null;
    act_composite_25_75: [number, number] | null;
    test_submission_rate_sat: number | null;
    test_submission_rate_act: number | null;
    test_policy?: TestPolicy;
    /** Applicants, admits, and enrollees who are men / women (IPEDS ADM; "another gender" and unknown count only in the totals). */
    by_sex?: { men: SexCounts; women: SexCounts } | null;
    /** True medians (IPEDS ADM, fall 2022 on), not the midpoint of the middle 50%. */
    sat_reading_median?: number | null;
    sat_math_median?: number | null;
    act_composite_median?: number | null;
    act_english_25_75?: [number, number] | null;
    act_math_25_75?: [number, number] | null;
  };
  demographics: {
    undergrad_enrollment: number;
    pell_grant_percent: number | null;
    first_gen_percent: number | null;
    /** Shares of degree-seeking undergraduates who are men / women (College Scorecard, from IPEDS fall enrollment). */
    men_share?: number | null;
    women_share?: number | null;
    /** Share of degree-seeking undergraduates studying part-time. */
    part_time_share?: number | null;
    /** Share of undergraduates aged 25 or older (IPEDS collects age every other fall, so it's a year older). */
    age_25_plus_share?: number | null;
    racial_diversity: {
      asian: number;
      black: number;
      hispanic: number;
      white: number;
      two_or_more: number;
      international: number;
      other: number;
    } | null;
  };
  /** What students pay, per year (College Scorecard; dollars). */
  cost?: {
    /**
     * Scorecard's average net price, which covers students receiving FEDERAL
     * (Title IV) aid, a lower-income-skewed group. Not shown as a headline;
     * see avg_paid_all and aided_net_price.
     */
    avg_net_price: number | null;
    /** Net price by family income for federal-aid recipients: $0–30K, $30–48K, $48–75K, $75–110K, $110K+. */
    net_price_by_income: (number | null)[] | null;
    /** Full sticker cost of attendance (tuition, fees, housing, books). */
    cost_of_attendance: number | null;
    tuition_in_state: number | null;
    tuition_out_of_state: number | null;
    /**
     * Same-year (IPEDS, e.g. 2022-23) prices and the all-student estimate.
     * Sticker = tuition & fees + books + on-campus room & board + other expenses.
     */
    year?: string;
    sticker?: ResidencyPrices;
    tuition_fees?: ResidencyPrices;
    /** Share of first-years paying each residency rate. */
    residency?: ResidencyPrices;
    /** Items that make up the sticker price beyond tuition (same year; on-campus rates). */
    components?: { books: number | null; room_board: number | null; other: number | null };
    /** Pieces of the all-student estimate, so the breakdown adds up exactly to avg_paid_all. */
    breakdown?: {
      /** Tuition & fees averaged over the residency mix (publics) or the single rate (privates). */
      tuition_fees: number;
      books: number;
      room_board: number;
      other: number;
      /** tuition_fees + books + room_board + other */
      full_price: number;
      /** share with grants × average grant, i.e. grant dollars averaged over every first-year */
      grant_per_student: number;
    } | null;
    /** Average net price for first-years who received grants (publics: in-state students). */
    aided_net_price?: number | null;
    /**
     * Estimated average paid by ALL first-years: residency-weighted sticker
     * price minus (share with grants × average grant). Students without
     * grants are counted at full price.
     */
    avg_paid_all?: number | null;
  };
  /** What happens after enrolling (College Scorecard). */
  outcomes?: {
    /** Median earnings of former students 10 / 6 years after entry (federal aid recipients). */
    median_earnings_10yr: number | null;
    median_earnings_6yr: number | null;
    /** Share completing within 150% of normal time (6 years for a 4-year degree). */
    graduation_rate: number | null;
    /** Share of full-time first-years who return for a second year. */
    retention_rate: number | null;
    /** Median federal loan debt of graduates, and the implied 10-year monthly payment. */
    median_debt: number | null;
    monthly_loan_payment: number | null;
    /** Share of all undergraduates with a federal student loan that year (College Scorecard; same year as aid). */
    federal_loan_rate?: number | null;
    /** Median federal debt of students who left (graduates and not), for Pell recipients and by family income. */
    median_debt_pell?: number | null;
    median_debt_no_pell?: number | null;
    median_debt_by_income?: { low: number | null; mid: number | null; high: number | null } | null;
    /** Where undergraduate borrowers stand 3 years into repayment, as ranges (Scorecard publishes some as bands). */
    repayment_3yr?: Partial<Record<RepaymentStatus, ShareRange>> | null;
  };
  /** Financial aid for full-time first-time undergrads (IPEDS Student Financial Aid survey). */
  aid?: {
    /** Students in the financial-aid cohort. */
    cohort: number | null;
    any_aid_pct: number | null;
    /** Any grant or scholarship (federal, state, local, institutional). Share = grant_count / cohort when both are reported. */
    grant_pct: number | null;
    grant_avg: number | null;
    /** Number of first-years receiving grants, and total grant dollars (exact inputs for the average cost). */
    grant_count?: number | null;
    grant_total?: number | null;
    institutional_pct: number | null;
    institutional_avg: number | null;
    pell_pct: number | null;
    pell_avg: number | null;
    state_pct: number | null;
    loan_pct: number | null;
    loan_avg: number | null;
    /** Students receiving federal (Title IV) aid, by family income band (same 5 bands as net price). */
    by_income: {
      counts: (number | null)[];
      avg_grant: (number | null)[];
      /** How many in each band received grants, and total grant dollars per band. */
      granted?: (number | null)[];
      total_grants?: (number | null)[];
    } | null;
    /** Richer detail from the school's Common Data Set, section H (full-time undergraduates). */
    cds?: CdsAid;
  };
  links?: {
    website: string | null;
    /** The college's federally required net price calculator. */
    price_calculator: string | null;
  };
  /**
   * Where values came from, only for fields whose source differs from the registry
   * default (lib/fields.ts). Keys are registered field paths. See specs/data-lineage.md.
   */
  lineage?: Partial<Record<FieldPath, LineageRecord>>;
  /** The Common Data Set used for this school, when any field came from it. */
  cds?: { edition: string; url: string };
  /**
   * 10-year changes from data/history/ (written by `npm run sync-history`, kept by sync-data), for Explore sorts,
   * change columns, and trend standouts without loading history files. Money is after inflation.
   */
  trends?: SchoolTrends;
}

/** One measure's change over the default 10-year window. */
export interface TrendSummary {
  /** Start year (a fall term). */
  since: number;
  /** Start and end values; money in end-year dollars. */
  from: number;
  to: number;
  /** Relative change, or the difference for shares (acceptance rate, grant share) and the diversity index. */
  change: number;
}

/** History series summaries, plus `diversity`: the diversity index computed from the race/ethnicity shares. */
export type TrendKey = "avg_paid_all" | "full_price" | "acceptance_rate" | "applicants" | "undergrads" | "grant_pct" | "men_share" | "federal_loan_rate" | "diversity";
export type SchoolTrends = Partial<Record<TrendKey, TrendSummary>>;

/**
 * Where one value came from. Omitted parts fall back to the source's defaults in
 * data/meta.json (release year, dataset URL, retrieval date).
 */
export interface LineageRecord {
  source: SourceKey;
  /** Display year, e.g. "Fall 2024" or "2024–25". */
  year?: string | null;
  /** The specific document (a college's CDS file), or the dataset. */
  url?: string;
  /** ISO date the value was retrieved. */
  retrieved?: string;
  /** reported = as published; derived = calculated by us; extracted = read from a document by the ingestion agent and checked. */
  method?: "reported" | "derived" | "extracted";
  /** Extracted values: the verbatim text the number came from. */
  quote?: string;
  page?: number;
}

/** Borrower status 3 years into repayment (College Scorecard `repayment.3_yr_bb_fed_repayment.ug.*`); they sum to 100%. */
export type RepaymentStatus =
  | "paid_in_full"
  | "making_progress"
  | "not_making_progress"
  | "deferment"
  | "forbearance"
  | "delinquent"
  | "default"
  | "discharged";

/** A share published either exactly (low = high) or as a band ("0.27-0.28", "<=0.02"). */
export interface ShareRange {
  low: number;
  high: number;
}

export interface SexCounts {
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
}

export interface ResidencyPrices {
  in_district: number | null;
  in_state: number | null;
  out_of_state: number | null;
}

export interface CdsAid {
  /** Full-time degree-seeking undergrads (H2 line A). */
  undergrads: number | null;
  applied_need: number | null;
  has_need: number | null;
  need_fully_met: number | null;
  /** Average share of need met, 0..1 (H2 line I). */
  pct_need_met: number | null;
  avg_package: number | null;
  avg_need_grant: number | null;
  avg_need_loan: number | null;
  /** Students with no need who got merit (non-need) aid, and its average (H2A N, O). */
  merit_no_need: number | null;
  merit_avg: number | null;
}

export type Topic = "institution" | "admissions" | "enrollment" | "demographics" | "cost" | "prices" | "outcomes" | "aid";
export type SourceKey = "scorecard" | "ipeds-adm" | "ipeds-sfa" | "ipeds-ic" | "cds";

export interface SourceInfo {
  /** Full citation name, e.g. "College Scorecard". */
  label: string;
  publisher: string;
  /** Which release/edition, e.g. "Fall 2023 (ADM2023)". */
  edition: string;
  url: string;
  description: string;
}

/** Written by the sync script to data/meta.json. */
export interface DatasetMeta {
  retrieved: string;
  sources: Record<SourceKey, SourceInfo>;
  /** Display year of each release, e.g. { "ipeds-adm": "Fall 2024", "scorecard-cost": "2023–24" }; null = no single year. */
  vintages: Record<VintageKey, string | null>;
}

export type SizeBucket = "small" | "medium" | "large" | "xl";

export type SortKey =
  | "applicants"
  | "name"
  | "acceptance_rate"
  | "enrollment"
  | "sat"
  | "pell"
  | "first_gen"
  | "diversity"
  | "avg_cost"
  | "aid_generosity"
  | "net_price"
  | "earnings"
  | "grad_rate"
  | "avg_cost_change"
  | "admit_rate_change"
  | "size_change"
  | "apps_change"
  | "diversity_change"
  | "men_share"
  | "part_time"
  | "men_share_change"
  | "admit_gap"
  | "loan_rate"
  | "loan_rate_change";

export type ExploreView = "grid" | "table" | "chart";

export interface SearchFilters {
  q?: string;
  states?: string[];
  regions?: string[];
  types?: SchoolType[];
  sizes?: SizeBucket[];
  minAR?: number;
  maxAR?: number;
  minSAT?: number;
  maxSAT?: number;
  minACT?: number;
  maxACT?: number;
  minEnroll?: number;
  maxEnroll?: number;
  minCost?: number;
  maxCost?: number;
  /** Trend indicator directions to keep (lib/indicators.ts), e.g. { cost: ["down", "steady"] }. */
  trends?: Partial<Record<IndicatorKey, Direction[]>>;
  /** Gender-balance buckets to keep (lib/student-body.ts). */
  balance?: GenderBalance[];
  /** Only colleges where at most 20% of undergraduates have a federal loan (lib/repayment.ts). */
  fewLoans?: boolean;
  /** Only colleges where at most 10% of undergraduates study part-time. */
  fullTime?: boolean;
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
}
