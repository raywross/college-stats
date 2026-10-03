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
    /** Campus coordinates (IPEDS HD), for the map. */
    lat?: number | null;
    lng?: number | null;
  };
  type: SchoolType;
  admissions: {
    /** Fall term the admissions figures describe; null if none reported. */
    year: number | null;
    applicants: number | null;
    admitted: number | null;
    enrolled: number | null;
    acceptance_rate: number | null;
    /**
     * The federal (or hand-imported CDS) figures a newer college-reported class replaced (specs/college-reported-round-2.md,
     * Decision 1). Present only when `applyNewest` replaced something; read by the ⓘ tooltip ("Federal data, fall
     * 2024: 5.8%") and by yield when the shown enrolled and admitted describe different classes.
     */
    federal?: FederalAdmissions;
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
    /** Undergraduate application fee in dollars; 0 means no fee (IPEDS IC). */
    application_fee?: number | null;
    /** Grants credit for Advanced Placement exams (IPEDS IC `CREDITS3`); false = not listed. */
    accepts_ap_credit?: boolean | null;
    /** How each factor is used in admission (IPEDS ADMCON1–12, except test scores, which are `test_policy`). */
    factors?: Partial<Record<AdmissionFactor, FactorUse | null>> | null;
  };
  demographics: {
    undergrad_enrollment: number;
    /** Undergrads registered with disability services (IPEDS IC): the share when over 3%, else "3% or less". */
    disability_services?: { share: number } | { three_or_less: true } | null;
    pell_grant_percent: number | null;
    first_gen_percent: number | null;
    /** Shares of degree-seeking undergraduates who are men / women (College Scorecard, from IPEDS fall enrollment). */
    men_share?: number | null;
    women_share?: number | null;
    /** Share of degree-seeking undergraduates studying part-time. */
    part_time_share?: number | null;
    /** Share of undergraduates aged 25 or older (IPEDS collects age every other fall, so it's a year older). */
    age_25_plus_share?: number | null;
    /**
     * Where first-time undergraduates come from (IPEDS Fall Enrollment part C, even-year falls; lib/residence.ts):
     * shares of every first-year, so with residence unknown they add up to less than 1. The full home-state table is in
     * the per-college detail file (lib/detail.ts).
     */
    residence?: {
      in_state: number;
      /** Other states, DC, and U.S. territories. */
      out_of_state: number;
      international: number;
      /** First-time undergraduates counted (the shares' denominator). */
      first_years: number;
      /** The state or territory sending the most first-years (USPS code) and its share. */
      top_state: { state: string; share: number } | null;
    } | null;
    /** New transfer-in undergraduates this fall (specs/data-expansion/transfers.md; lib/transfers.ts), IPEDS EF{Y}A. */
    transfer_in?: TransferIn | null;
    racial_diversity: {
      asian: number;
      black: number;
      hispanic: number;
      white: number;
      two_or_more: number;
      international: number;
      other: number;
    } | null;
    /** The federal fall a newer CDS fall replaced (lib/newest-groups.ts); present only when enrollment or race was replaced. */
    federal?: FederalDemographics;
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
    /** Alternative tuition plans the college offers (IPEDS IC). */
    tuition_plans?: TuitionPlan[] | null;
    /** Takes part in a state or local Promise (residency-based free-tuition) program. */
    promise_program?: boolean | null;
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
    /** 8-year outcomes for every entering student (IPEDS Outcome Measures; lib/outcome-measures.ts). */
    eight_year?: EightYearOutcomes | null;
    /**
     * Graduation by group (specs/data-expansion/graduation-by-group.md; lib/graduation-groups.ts): first-time
     * full-time students finishing within 6 years (150% of normal time), IPEDS GR{Y}_PELL_SSL. Null under 30 students.
     */
    grad_rate_pell?: number | null;
    grad_rate_loan_no_pell?: number | null;
    grad_rate_no_pell_no_loan?: number | null;
    /** All students in the same file (equals Scorecard's 4-year 150% rate, not the headline consumer rate). */
    grad_rate_ftft?: number | null;
    /** Adjusted cohort sizes behind those rates. */
    grad_cohorts?: Record<"pell" | "loan_no_pell" | "no_pell_no_loan" | "total", number | null> | null;
    /** By race/ethnicity (College Scorecard `completion_rate_4yr_150_*`), null under 30 students; and the cohorts. */
    grad_rate_by_race?: Record<GradRaceGroup, number | null> | null;
    grad_cohorts_by_race?: Record<GradRaceGroup, number | null> | null;
    /** Federal outcomes a newer CDS cohort replaced (lib/newest-groups.ts); each part present only when replaced. */
    federal?: FederalOutcomes;
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
  /** Housing and campus services (IPEDS Institutional Characteristics, same year as the prices), and the campus profile. */
  /** Academics (specs/data-expansion/student-faculty-ratio.md; later majors, faculty, class sizes). */
  academics?: {
    /** Students per instructional faculty member, "N to 1" (IPEDS EF part D `STUFACR`, fall). */
    student_faculty_ratio: number | null;
    /** Faculty (specs/data-expansion/faculty.md): salary (IPEDS SAL, all ranks) and full-time share (Scorecard). */
    faculty?: {
      /** All-ranks average salary equated to a 9-month contract, nominal dollars (IPEDS SAL{Y}_IS, ARANK 7, `SAEQ9AT`). */
      avg_salary_9mo: number | null;
      /** Share of faculty who are full-time (College Scorecard `school.ft_faculty_rate`, from IPEDS HR). */
      full_time_share: number | null;
      /** Instructional staff counted in the salary figure, when available; not published in SAL_IS itself today. */
      count: number | null;
    } | null;
    /**
     * Majors (specs/data-expansion/majors.md; IPEDS Completions C{Y}_A, lib/majors.ts): bachelor's degrees awarded as a
     * first major in the year. 0 when the college reported none; null/absent when it isn't in the file.
     */
    bachelors_awarded?: number | null;
    /** The 5 programs (6-digit CIP) with the most first-major bachelor's, with each one's share of them. */
    majors_top?: MajorShare[] | null;
    /** First-major bachelor's by 2-digit CIP family (only families with any), for filters and history. */
    bachelors_by_family?: Record<string, number> | null;
    /**
     * Bachelor's programs with 4-year median earnings reported (specs/data-expansion/field-of-study.md). The full
     * per-program table (earnings, debt, graduates by 4-digit CIP) lives in the detail file (`detail.programs`),
     * not here; this count is small enough for the snapshot.
     */
    programs_with_earnings?: number | null;
  };
  /**
   * College finances (specs/data-expansion/finances.md): IPEDS Finance survey, derived per-student figures
   * (`DRVF{Y}`). Reported on three different accounting forms by sector, never comparable across forms: GASB
   * (public), FASB (private nonprofit), or for-profit. Null when the college's finance survey isn't in the file yet.
   */
  finances?: SchoolFinances | null;
  campus?: {
    /** Athletics (IPEDS IC; lib/campus-services.ts). Null when the college didn't answer. */
    athletics?: Athletics | null;
    /** ROTC, study abroad, undergraduate research, a program for students with intellectual disabilities (IPEDS IC). */
    programs?: CampusPrograms | null;
    /** Student services (IPEDS IC); false = not listed. */
    services?: { counseling: boolean; employment: boolean; placement: boolean; child_care: boolean } | null;
    /** Academic calendar (IPEDS IC `CALSYS`). */
    calendar?: CalendarSystem | null;
    /** NCES locale (IPEDS HD `LOCALE`): e.g. 11 "City: Large"; `group` is its first word. */
    setting?: { locale: number; label: string; group: SettingGroup } | null;
    /** Carnegie Classification 2025 (IPEDS HD). */
    carnegie?: {
      /** Institutional class, e.g. "Mixed Undergraduate/Graduate-Doctorate Medium". */
      ic: string | null;
      research: ResearchTier | null;
      /** Student Access and Earnings class, Carnegie's label. */
      access_earnings: string | null;
      size: string | null;
    } | null;
    /** HBCU, tribal college, land-grant (IPEDS HD). */
    designations?: HdDesignation[];
    /** Minority-serving and single-sex designations (College Scorecard flags). */
    msi?: MsiDesignation[];
    housing?: {
      /** Offers institutionally controlled housing (on or off campus). */
      offered: boolean;
      /** Beds, including any graduate housing. */
      capacity: number | null;
      /** All full-time first-time students must live in college housing (strict: no exceptions). */
      first_years_required: boolean | null;
      meal_plan: boolean | null;
      /** Meals a week in the largest plan; null when it varies or isn't a plain number (IPEDS 99). */
      meals_per_week: number | null;
    } | null;
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
  /**
   * Newer figures the college itself published (class profiles, Common Data Sets), read from its website by the
   * ingestion agent and checked (specs/college-reported-data.md). Shown on profiles next to the federal baseline,
   * never used in Explore, Compare, ranks, medians, or Home. Every value here has an `extracted` lineage record with
   * its quote, URL, retrieval date, and year.
   */
  reported?: ReportedData;
}

/** The previous admissions funnel, kept when a newer college-reported class replaces it (`admissions.federal`). */
export interface FederalAdmissions {
  year: number | null;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  acceptance_rate: number | null;
}

/** `school.reported`: one block per topic; phase 1 is admissions only. */
export interface ReportedData {
  admissions?: ReportedAdmissions;
  /** New fields from the CDS (specs/data-expansion/cds-student-body-and-outcomes.md). */
  outcomes?: ReportedOutcomes;
}

/* ---- CDS student body and outcomes (specs/data-expansion/cds-student-body-and-outcomes.md) ---- */

/** The four Pell/loan groups of the graduation grid (IPEDS GR and CDS B4–B11). */
export type GradAidGroup = "pell" | "loan_no_pell" | "no_pell_no_loan" | "total";

/** `demographics.federal`: the federal fall a newer CDS fall (B1, B2) replaced. */
export interface FederalDemographics {
  /** The federal fall replaced, e.g. 2024. */
  year: number;
  undergrad_enrollment: number;
  men_share: number | null;
  women_share: number | null;
  part_time_share: number | null;
  racial_diversity: School["demographics"]["racial_diversity"];
}

/** `outcomes.federal`: the federal retention and graduation a newer CDS cohort replaced. */
export interface FederalOutcomes {
  retention?: { entering_year: number | null; retention_rate: number | null };
  graduation?: {
    /** The entering fall of the federal class replaced, e.g. 2018. */
    entering_year: number;
    grad_rate_pell: number | null;
    grad_rate_loan_no_pell: number | null;
    grad_rate_no_pell_no_loan: number | null;
    grad_rate_ftft: number | null;
    grad_cohorts: Record<GradAidGroup, number | null> | null;
  };
}

/** `school.reported.outcomes`: CDS outcome fields federal data doesn't have at this definition. */
export interface ReportedOutcomes {
  /** Finished within 4 and 5 years, first-time full-time bachelor's-seeking students, by aid group (B4–B11 D, D+E ÷ C). Null under 30 students. */
  graduation?: {
    /** Always the class the shown six-year rates describe. */
    entering_year: number;
    within_4: Record<GradAidGroup, number | null>;
    within_5: Record<GradAidGroup, number | null>;
  };
}

/** The newest first-year, all-rounds admissions figures a college has published, newer than its federal year. */
export interface ReportedAdmissions {
  /** Fall term the class entered, e.g. "Fall 2026". */
  entering_term: string;
  /** The fall year as a number (2026), always greater than `admissions.year`. */
  year: number;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  /** As stated by the college when it stated one; otherwise admitted ÷ applicants. */
  acceptance_rate: number | null;
  /** Which kind of document supplied the figures. */
  source_kind: ReportedSourceKind;
}

export type ReportedSourceKind = "cds" | "class-profile";

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
export type TrendKey = "avg_paid_all" | "full_price" | "acceptance_rate" | "applicants" | "undergrads" | "grant_pct" | "men_share" | "federal_loan_rate" | "diversity"
  /** Pell graduation gap (neither minus Pell, points) by entering class (lib/history.ts pellGapChange). */
  | "pell_gap";
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
  /** College-reported values: the Common Data Set edition the value came from, "2025–26" (the year is the item's own). */
  edition?: string;
  /** A workbook value: the sheet and cell, "CDS-C!AC17". */
  cell?: string;
  /** A fillable-PDF value: the form field name (the template's US News PDF tag), "AP_RECD_1ST_N". */
  field?: string;
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

export type SettingGroup = "city" | "suburb" | "town" | "rural";

/** Carnegie 2025 research designation: R1, R2, or Research Colleges and Universities. */
export type ResearchTier = "R1" | "R2" | "RCU";

/** From the IPEDS directory (HD). */
export type HdDesignation = "hbcu" | "tribal" | "land_grant";

/**
 * From College Scorecard: hsi (Hispanic-Serving), pbi (Predominantly Black), aanapisi (Asian American and Native
 * American Pacific Islander-Serving), annh (Alaska Native and Native Hawaiian-Serving), nasnti (Native American-Serving
 * Nontribal), and women's or men's colleges.
 */
export type MsiDesignation = "hsi" | "pbi" | "aanapisi" | "annh" | "nasnti" | "women" | "men";

export type Designation = HdDesignation | MsiDesignation;

/** Admission factors (IPEDS ADMCON1–6, 8–12). Work experience, essay, and legacy exist from fall 2022. */
export type AdmissionFactor =
  | "gpa"
  | "class_rank"
  | "hs_record"
  | "college_prep"
  | "recommendations"
  | "competencies"
  | "english_test"
  | "other_test"
  | "work_experience"
  | "essay"
  | "legacy";

/** As of fall 2022: required, considered but not required, or not considered even if submitted. */
export type FactorUse = "required" | "considered" | "not_considered";

/** IPEDS TUITPL1–4: a tuition guarantee (locked-in rate), prepaid plan, payment plan, or other plan. */
export type TuitionPlan = "guarantee" | "prepaid" | "payment_plan" | "other";

export interface ResidencyPrices {
  in_district: number | null;
  in_state: number | null;
  out_of_state: number | null;
}

/**
 * One entering group's status 8 years after starting (IPEDS Outcome Measures): shares of its adjusted cohort, summing to
 * 1. Rates are null when the cohort is under 30 students (lib/outcome-measures.ts MIN_COHORT).
 */
/** New transfer-in undergraduates in one fall (IPEDS EF{Y}A levels 19, 39, 59; lib/transfers.ts). */
export interface TransferIn {
  count: number;
  full_time: number;
  part_time: number;
  /** Transfer-ins ÷ (transfer-ins + first-time degree-seeking undergraduates); null when both are 0. */
  share_of_new: number | null;
}

export interface EightYearGroup {
  /** Adjusted cohort: entering students, less those who died, joined the military, a church mission, or foreign aid service. */
  cohort: number;
  /** Earned a certificate or degree at this college within 8 years. */
  award: number | null;
  /**
   * Within 4 and 6 years (specs/data-expansion/time-to-degree.md): cumulative, so award_4 ≤ award_6 ≤ award. Null with
   * the rest under 30 students, and on their own when NCES's counts aren't cumulative or are blank.
   */
  award_4?: number | null;
  award_6?: number | null;
  /** No award, still enrolled at this college. */
  still_enrolled: number | null;
  /** No award here, enrolled at another college (transferred out). */
  transferred: number | null;
  /** No award, and no record of enrolling anywhere. */
  unknown: number | null;
}

/** 8-year outcomes by entering group (specs/data-expansion/outcome-measures.md). Groups are null when no one is in them. */
export interface EightYearOutcomes {
  /** The fall these students entered (OM{Y} follows fall Y − 8). */
  entering_year: number;
  /** Everyone who entered: first-time and transfer-in, full-time and part-time. */
  all: EightYearGroup;
  /** First-time students (full-time and part-time). */
  first_time: EightYearGroup | null;
  /** Students who transferred in (full-time and part-time). */
  transfer_in: EightYearGroup | null;
  /** Pell Grant recipients and everyone else, all entering students. */
  pell: Pick<EightYearGroup, "cohort" | "award" | "award_4" | "award_6"> | null;
  non_pell: Pick<EightYearGroup, "cohort" | "award" | "award_4" | "award_6"> | null;
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

/** One program in academics.majors_top: CIP 2020 code ("11.0701"), NCES title, share of first-major bachelor's. */
export interface MajorShare {
  cip: string;
  title: string;
  share: number;
}

export type Topic = "institution" | "admissions" | "enrollment" | "demographics" | "cost" | "prices" | "outcomes" | "aid" | "campus" | "academics";
/** NCAA division with the football subdivision, or null (NAIA and non-members have none). */
export type NcaaDivision = "I-FBS" | "I-FCS" | "I" | "II" | "III";
export type AthleticAssociation = "ncaa" | "naia" | "njcaa" | "nscaa" | "nccaa" | "other";
export type Sport = "football" | "basketball" | "baseball" | "track";
export type RotcBranch = "army" | "navy" | "air_force";
export type CalendarSystem = "semester" | "quarter" | "trimester" | "4-1-4" | "other" | "varies" | "continuous";
/** Explore's division filter: an NCAA division, or NAIA. */
export type DivisionFilter = NcaaDivision | "naia";

export interface Athletics {
  associations: AthleticAssociation[];
  division: NcaaDivision | null;
  /** The main conference (basketball's, else track's, baseball's, or football's), as IPEDS codes it. */
  conference: { code: number; name: string } | null;
  /** Football's conference when it differs from `conference` (e.g. Georgetown: Big East, Patriot League football). */
  football_conference: { code: number; name: string } | null;
  /** Sports the college reports NCAA/NAIA membership in (IPEDS asks about these four only). */
  sports: Sport[];
}

export interface CampusPrograms {
  rotc: RotcBranch[];
  study_abroad: boolean;
  /** Asked from IC2022 on. */
  undergrad_research: boolean | null;
  /** Comprehensive transition and postsecondary program for students with intellectual disabilities. */
  intellectual_disability_program: boolean;
}

export type SourceKey = "scorecard" | "ipeds-adm" | "ipeds-sfa" | "ipeds-ic" | "ipeds-ic-char" | "ipeds-hd" | "ipeds-ef" | "ipeds-ef-c" | "ipeds-ef-a" | "ipeds-c" | "ipeds-om" | "ipeds-sal" | "ipeds-f" | "cds"
  /** A college's own website (class profile or CDS), read by the ingestion agent (specs/college-reported-data.md). Per-value lineage carries the document. */
  | "college-site"
  /** IPEDS Graduation Rates, Pell and subsidized-loan file (GR{Y}_PELL_SSL; specs/data-expansion/graduation-by-group.md). */
  | "ipeds-gr"
  /** College Scorecard Field of Study bulk CSV: earnings and debt by 4-digit CIP (specs/data-expansion/field-of-study.md). */
  | "scorecard-fos";
/** Race/ethnicity groups for graduation rates (lib/graduation-groups.ts RACE_GROUPS). */
export type GradRaceGroup = "white" | "asian" | "hispanic" | "black" | "two_or_more" | "international" | "aian" | "nhpi";

/**
 * College finances (specs/data-expansion/finances.md): which IPEDS Finance accounting form a college reports under,
 * by sector. Never compare values across forms.
 */
export type FinanceForm = "gasb" | "fasb" | "forprofit";

/** IPEDS Finance survey, derived per-student figures (`DRVF{Y}`), fiscal year stored as its start year. */
export interface SchoolFinances {
  /** Start year of the fiscal year the figures describe (e.g. 2023 for fiscal 2023–24). */
  fiscal_year: number | null;
  /** Which accounting form reported values: GASB (public), FASB (private nonprofit), or for-profit. */
  form: FinanceForm;
  /** Endowment assets at year end per FTE student; null for for-profits (no endowment column). */
  endowment_per_student: number | null;
  instruction_per_student: number | null;
  student_services_per_student: number | null;
  academic_support_per_student: number | null;
  /** Tuition & fee revenue as a share of core revenue, 0–1. */
  tuition_share_of_revenue: number | null;
}

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
  /** Partial: new code can deploy before the publish that adds its source lands (specs/data-lineage.md). */
  sources: Partial<Record<SourceKey, SourceInfo>>;
  /** Display year of each release, e.g. { "ipeds-adm": "Fall 2024", "scorecard-cost": "2023–24" }; null = no single year. */
  vintages: Record<VintageKey, string | null>;
}

export type SizeBucket = "small" | "medium" | "large" | "xl";

export type SortKey =
  | "applicants"
  | "bachelors"
  | "completion_8yr"
  | "completion_4yr"
  | "student_faculty"
  | "instruction_spending"
  | "endowment_per_student"
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
  | "loan_rate_change"
  /** Graduation by group: the Pell graduation gap, and its 10-year change. */
  | "pell_gap"
  | "pell_gap_change"
  | "full_time_faculty"
  | "out_of_state"
  | "transfer_share";

export type ExploreView = "grid" | "table" | "chart" | "map";

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
  /** At most this many students per faculty member. */
  maxRatio?: number;
  /** At least this share of faculty are full-time (0–1; specs/data-expansion/faculty.md). */
  minFullTimeFaculty?: number;
  minCost?: number;
  maxCost?: number;
  /** Trend indicator directions to keep (lib/indicators.ts), e.g. { cost: ["down", "steady"] }. */
  trends?: Partial<Record<IndicatorKey, Direction[]>>;
  /** Gender-balance buckets to keep (lib/student-body.ts). */
  balance?: GenderBalance[];
  /** Campus profile (lib/campus-profile.ts): any of these settings, research tiers, or designations. */
  setting?: SettingGroup[];
  research?: ResearchTier[];
  designation?: Designation[];
  /** Carnegie "Opportunity Colleges and Universities" (higher access, higher earnings) only. */
  opportunity?: boolean;
  /** Campus services (lib/campus-services.ts): any of these divisions; one conference; ROTC branches; flags. */
  division?: DivisionFilter[];
  conference?: number;
  football?: boolean;
  rotc?: RotcBranch[];
  ugResearch?: boolean;
  studyAbroad?: boolean;
  /** Admission factors (lib/factors.ts): legacy not considered, essay not required, GPA required. */
  noLegacy?: boolean;
  noEssay?: boolean;
  gpaRequired?: boolean;
  /** Housing and policies (lib/housing.ts): first-years must live on campus, no application fee, tuition guarantee. */
  liveOn?: boolean;
  noFee?: boolean;
  guarantee?: boolean;
  /** Only colleges where at most 20% of undergraduates have a federal loan (lib/repayment.ts). */
  fewLoans?: boolean;
  /** Only colleges whose Pell graduation gap is under 5 points (lib/graduation-groups.ts). */
  pellGap?: boolean;
  /** Only colleges where at most 10% of undergraduates study part-time. */
  fullTime?: boolean;
  /** Only colleges where at least half of first-years come from other states (lib/residence.ts). */
  national?: boolean;
  /** Majors (lib/majors.ts): a 2-digit CIP family, and at least this many first-major bachelor's a year in it (default 1). */
  field?: string;
  fieldMin?: number;
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
}
