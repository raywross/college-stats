import type { FieldPath, VintageKey } from "./fields";
import type { Direction, IndicatorKey } from "./indicators";
import type { GenderBalance } from "./student-body";
import type { Council, DirectorySummary, PolicyCheck, Tradition } from "./directories";

export type SchoolType = "public" | "private-nonprofit" | "private-forprofit";

/**
 * How SAT/ACT scores are used in admission. IPEDS ADMCON7 answers required / considered / not-considered (and
 * recommended before fall 2022); a college's Common Data Set C8 adds "required-some" ("Required for some"), which never
 * comes from federal data (specs/data-expansion/cds-test-scores-and-policy.md, Decision 1).
 */
export type TestPolicy = "required" | "required-some" | "recommended" | "considered" | "not-considered" | null;

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
    /**
     * The federal answers a newer Common Data Set C7 replaced in `factors` (specs/data-expansion/cds-admissions.md,
     * the six shared factors): present only when `applyNewest` flipped one; read by the ⓘ ("Federal data, fall 2024:
     * considered") and put back by `restoreFederal`.
     */
    federal_factors?: Partial<Record<AdmissionFactor, FactorUse | null>>;
    /**
     * The test-policy, SAT, and ACT blocks a newer college-reported C8/C9 replaced (cds-test-scores-and-policy.md,
     * Decisions 1–2; `lib/cds/test-scores.ts#applyNewestTests`). Present only then; restored byte for byte.
     */
    federal_tests?: FederalTests;
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
    /**
     * The hand-imported `aid.cds` a same-or-newer CDS record replaced (specs/data-expansion/cds-financial-aid.md): kept
     * for the ⓘ ("Replaces: … Common Data Set 2024–25: 77%"); `aid.cds` itself is removed then.
     */
    cds_previous?: CdsAidPrevious;
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
  /**
   * LGBTQ+ life (specs/lgbtq-life.md, phase 1; lib/lgbtq.ts): the federal "another gender" counts and, at public
   * colleges in a state with a law in data/state-laws.json, that law. Never ranked, averaged, filtered, or turned into
   * a "Known for" chip.
   */
  lgbtq?: LgbtqLife | null;
  /**
   * Which groups national directories list at this college, per domain (specs/campus-directories.md; lib/directories.ts
   * `summarize`): tradition, council, or LGBTQ+ kind/policy keys. The listings themselves, each credited to its
   * organization, live in the college's detail file (`directories` table). Absent when no directory lists the college.
   */
  directories?: DirectorySummary | null;
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
  /**
   * Religious life, phase 1 (specs/religious-life.md; lib/religion.ts). Present when the college is in IPEDS IC{Y};
   * `affiliation` null means IPEDS says "not applicable" (no religious affiliation). Later phases add the CDS and
   * directory blocks the spec sketches; the CDS facts read so far live under `reported.religion`.
   */
  religion?: SchoolReligion;
  links?: SchoolLinks;
  /**
   * Social accounts (specs/school-identity/social-accounts.md): handles, not URLs (`socialUrl` in lib/social.ts builds
   * the profile URL). From Wikidata, else the college's homepage footer. Absent or null when none is known.
   */
  social?: SchoolSocial | null;
  /**
   * The college's colors and mark (specs/school-identity/brand.md): colors from Wikipedia's college color data, the
   * derived accent and tints (computed at sync time, so the app does no color math), and its site icon
   * (`public/brand/{unit_id}.webp`). Decoration, never data. Absent or null when none is known.
   */
  brand?: SchoolBrand | null;
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
   * ingestion agent and checked (specs/college-reported-data.md). Newest values replace older ones in every view
   * (round 2, Decision 1); partial-coverage fields are never used in ranks, medians, sorts, or Home. Every value here
   * has an `extracted` (or `derived`) lineage record with its quote, URL, retrieval date, and year.
   * ingestion agent and checked (specs/college-reported-data.md). Values with a federal definition replace the older
   * ones in the dataset itself (`lib/newest.ts`, round 2 Decision 1), so every view shows the newest; the rest are
   * shown on profiles and Compare and never feed ranks, medians, or Home (each owning spec says exactly what may).
   * Every value here has an `extracted` (or `derived`) lineage record with its quote, URL, retrieval date, and year.
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
  /** CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md; lib/cds/residency.ts). */
  admissions_by_residency?: ReportedResidencyAdmissions;
  /** Next year's price and its detail (CDS G; specs/data-expansion/cds-cost-and-debt.md). Never replaces `cost.*`. */
  cost?: ReportedCost;
  /**
   * CDS outcome fields federal data doesn't have at this definition: 4- and 5-year graduation by aid group
   * (specs/data-expansion/cds-student-body-and-outcomes.md) and the graduating class with its borrowing (CDS H4–H5;
   * specs/data-expansion/cds-cost-and-debt.md).
   */
  outcomes?: ReportedOutcomes;
  /** CDS C2, C7, C10–C12, C21–C22 from data/cds-records (specs/data-expansion/cds-admissions.md; lib/cds/admissions.ts). */
  admission_profile?: ReportedAdmissionProfile;
  /* CDS C8/C9 (specs/data-expansion/cds-test-scores-and-policy.md): beside `admissions`, not inside it, because a
     college can publish C8/C9 without a newer C1 class (Cornell 2025–26). */
  /** C8: policy for students applying to enter in fall `cycle` (C.801–C.804). */
  test_policy?: ReportedTestPolicy | null;
  /** C8F verbatim, trimmed to 500 characters; shown as a quote. */
  test_policy_note?: string | null;
  /** Changes across the college's CDS editions and against the federal value. */
  test_policy_events?: TestPolicyEvent[] | null;
  /** C9: the first-years who entered in fall `year` and sent scores. */
  tests?: ReportedTests | null;
  /** CDS section H facts (specs/data-expansion/cds-financial-aid.md). */
  aid?: ReportedAid;
  /** CDS I-2, I-3, E1, E3 (specs/data-expansion/cds-academics.md; lib/cds/academics.ts). Alongside the federal figures. */
  academics?: ReportedAcademics;
  /** CDS section D, transfer admission (specs/data-expansion/cds-transfer.md; lib/cds/transfer.ts). */
  transfer?: ReportedTransfer;
  /** CDS F1/F4, Greek life phase 1 (specs/greek-life.md; lib/cds/greek.ts). */
  greek?: ReportedGreek;
  /** CDS C13–C18, the regular round (specs/data-expansion/cds-application-logistics.md; lib/cds/application-logistics.ts). */
  admissions_logistics?: ReportedLogistics;
  /** CDS C3–C5, high school preparation (same spec and module). */
  admissions_hs_prep?: ReportedHsPrep;
  /** CDS H14 religious-affiliation scholarships and F2 campus ministries (specs/religious-life.md; lib/cds/religion.ts). */
  religion?: ReportedReligion;
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
  /** H4: first-time students who earned a bachelor's in the class named by the document (lib/cds/cost-and-debt.ts). */
  graduating_class?: { year: number; size: number };
  /** H5: that class's borrowing, by loan source. */
  graduate_debt?: ReportedGraduateDebt;
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

/** One residency column of the CDS C1 grid: first-time, first-year students. Missing is null, never 0. */
export interface ResidencyCounts {
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
}

/**
 * CDS C1 by residency (specs/data-expansion/cds-residency-admissions.md): applied, admitted, and enrolled first-years by
 * where they lived when applying. Stored only from a grid that passed its checks; rates are computed at render time.
 */
export interface ReportedResidencyAdmissions {
  /** Entering class from the record's C-group year (the grid heading's "Fall YYYY"), never page headers. */
  entering_term: string;
  /** Its fall year as a number. */
  year: number;
  /** CDS edition the grid was read from, e.g. "2025-26". */
  edition: string;
  in_state: ResidencyCounts;
  out_of_state: ResidencyCounts;
  international: ResidencyCounts;
  /** Kept for the sum check and the record; never shown as a rate. */
  unknown: ResidencyCounts;
  /** C1 totals of the same document (C.116–C.118): the same-class "all applicants" reference. */
  total: ResidencyCounts;
}

/* ---- CDS cost and debt (specs/data-expansion/cds-cost-and-debt.md; built by lib/cds/cost-and-debt.ts) ---- */

/** `school.reported.cost`: CDS section G, which describes the coming academic year. */
export interface ReportedCost {
  /**
   * Next year's price (G1), a separate labeled value beside the federal price: it never replaces `cost.*`, never
   * enters ranks, Explore sorts, or history. Absent while the college says its costs aren't final (G0).
   */
  next_year?: ReportedNextYearPrice;
  /** G2–G6: tuition policy, the share paying more than the G1 rate, other expenses, per-credit charges. */
  next_year_detail?: ReportedNextYearDetail;
}

export interface ReportedNextYearPrice {
  /** The academic year the prices describe, from the document's own year rule (e.g. "2026–27"). */
  entering_term: string;
  /** The headline column: what an entering first-year pays. */
  first_year: CdsCostColumn;
  /** The undergraduate column; shown only when its total differs from the first-year total by more than 1%. */
  undergraduate: CdsCostColumn;
}

/** One G1 column. Every amount is per academic year, in dollars; null when not reported or not a number. */
export interface CdsCostColumn {
  tuition: CdsTuition | null;
  fees: number | null;
  food_and_housing: number | null;
  housing_only: number | null;
  food_only: number | null;
}

export type CdsTuition =
  | { kind: "private"; amount: number | null }
  | { kind: "public"; in_district: number | null; in_state: number | null; out_of_state: number | null; nonresident_international: number | null };

/** G2–G6. A null leaf means the college didn't answer with a number; its verbatim answer, if any, is in `text`. */
export interface ReportedNextYearDetail {
  credits_per_term: { min: number | null; max: number | null } | null;
  tuition_varies_by_year: boolean | null;
  tuition_varies_by_program: boolean | null;
  /** G.402: share (0–1) of full-time undergraduates paying more than the G1 tuition because it varies by program. */
  pct_paying_more: number | null;
  /** G5; null while the college says its costs aren't final (G0), like `next_year`. */
  expenses: CdsExpenses | null;
  /** G6; null while the college says its costs aren't final (G0). */
  per_credit_hour: { private: number | null; in_district: number | null; in_state: number | null; out_of_state: number | null; nonresident: number | null } | null;
}

/** G5: books, transportation, and other expenses by where the student lives. */
export interface CdsExpenses {
  residents: { books_supplies: number | null; transportation: number | null; other: number | null };
  commuters_at_home: { books_supplies: number | null; food_only: number | null; transportation: number | null; other: number | null };
  commuters_away: { books_supplies: number | null; housing_only: number | null; food_only: number | null; food_and_housing_total: number | null; transportation: number | null; other: number | null };
  /** Non-numeric answers as printed ("varies"), keyed like "residents.transportation"; never treated as $0. */
  text?: Record<string, string>;
}

export type GraduateDebtRowKey = "any" | "federal" | "institutional" | "state" | "private";

export interface ReportedGraduateDebt {
  /** Same as `graduating_class.year`. */
  class_year: number;
  /** Number who borrowed, their share (0–1) of the class, and the average cumulative principal among them. */
  rows: Record<GraduateDebtRowKey, { number: number | null; share: number | null; avg_principal: number | null }>;
}
/* ---- CDS admissions profile (specs/data-expansion/cds-admissions.md; built by lib/cds/admissions.ts) ---- */

/**
 * `school.reported.admission_profile`. Each block comes from the newest CDS edition where it passed (at most two
 * editions behind the college's newest), so blocks may describe different classes; each value's lineage says its year.
 * A block (or a sub-object such as ED's second round) with nothing published is absent rather than null, so every
 * stored leaf is a registered, cited path; a missing number inside a block is null, never 0.
 */
export interface ReportedAdmissionProfile {
  /** C11 + C12, always from one edition. */
  gpa?: {
    /** C.1201 as published (3.895, 4.34). Never compared across colleges: it may be weighted. */
    average: number | null;
    /** `weighted` when the average is above 4.0 (or the document says so); `unweighted` only when stated. */
    scale: GpaScale;
    /** C.1202, 0–1. */
    submitted_share: number | null;
    /** Nine shares 0–1, top band (4.0) first; null = column blank or failed its checks. */
    bands: { with_test: GpaBands | null; without_test: GpaBands | null; all: GpaBands | null };
  };
  /** C10; the bands are never stored without the share whose high school reported a rank. */
  class_rank?: {
    top_tenth: number | null;
    top_quarter: number | null;
    top_half: number | null;
    bottom_half: number | null;
    bottom_quarter: number | null;
    submitted_share: number;
  };
  /** C.701–C.718; a row with no (or two) marks is null. */
  factors?: Partial<Record<C7Factor, FactorImportance | null>>;
  /** C.201–C.204. All-zero counts beside a Yes policy are blank (null). */
  wait_list?: { policy: boolean | null; offered: number | null; accepted: number | null; admitted: number | null };
  /** C.2101–C.2111; one count pair covers every ED round. */
  early_decision?: {
    offered: boolean;
    first?: { closing: MonthDayValue | null; notification: MonthDayValue | null };
    /** ED II. */
    other?: { closing: MonthDayValue | null; notification: MonthDayValue | null };
    applicants: number | null;
    admitted: number | null;
  };
  /** C.2201–C.2206; the CDS has no early action counts. */
  early_action?: { offered: boolean; closing: MonthDayValue | null; notification: MonthDayValue | null; restrictive: boolean | null };
}
export type GpaScale = "weighted" | "unweighted" | "not_stated";
export type GpaBands = [number, number, number, number, number, number, number, number, number];
export type FactorImportance = "very_important" | "important" | "considered" | "not_considered";
export type C7Factor =
  | "rigor"
  | "class_rank"
  | "gpa"
  | "test_scores"
  | "essay"
  | "recommendations"
  | "interview"
  | "extracurriculars"
  | "talent"
  | "character"
  | "first_generation"
  | "alumni_relation"
  | "geographic_residence"
  | "state_residency"
  | "religious"
  | "volunteer_work"
  | "work_experience"
  | "interest";
/** A month and day with no year (CDS dates are labeled with the edition that published them). */
export type MonthDayValue = { month: number; day: number };
/* ---- CDS C8/C9: test policy and test scores (specs/data-expansion/cds-test-scores-and-policy.md) ---- */

/** A test policy answer (never null). */
export type TestPolicyAnswer = Exclude<TestPolicy, null>;

/** CDS C8: the grid for one application cycle. */
export interface ReportedTestPolicy {
  /** The fall the applicants would enter (2027 for a 2025–26 CDS). */
  cycle: number;
  /** C.801: does the college use SAT or ACT scores in admission decisions? */
  uses_tests: boolean | null;
  /** C.802–C.804: the grid rows "SAT or ACT", "ACT Only", "SAT Only". */
  sat_or_act: TestPolicyAnswer | null;
  act_only: TestPolicyAnswer | null;
  sat_only: TestPolicyAnswer | null;
  /** The headline: the "SAT or ACT" row, else ACT Only and SAT Only when they agree; null = varies by test. */
  policy: TestPolicyAnswer | null;
}

/** 25th / 50th / 75th percentiles; a missing 50th is allowed. */
export interface Pct3 {
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

/** Shares 0–1 of enrolled first-years who sent that test, top band first, in the template's order. */
export type Bands6 = [number, number, number, number, number, number];

/** The six band columns C9 prints. */
export type BandTest = "sat_ebrw" | "sat_math" | "sat_composite" | "act_composite" | "act_english" | "act_math";

/** CDS C9: the entering class's test scores. */
export interface ReportedTests {
  /** Entering fall (2025 for a 2025–26 CDS). */
  year: number;
  /** C.901–C.902: shares 0–1 of enrolled first-years who sent each test. */
  sat_share: number | null;
  act_share: number | null;
  /** C.903–C.904: how many sent each (null unless the same document's C1 enrolled passed). */
  sat_submitters: number | null;
  act_submitters: number | null;
  /** C.905–C.907: the college's own SAT total percentiles. */
  sat_composite: Pct3 | null;
  /** C.908–C.913: SAT Evidence-Based Reading and Writing, SAT Math. */
  sat_ebrw: Pct3 | null;
  sat_math: Pct3 | null;
  /** C.914–C.922: ACT composite, Math, English. */
  act_composite: Pct3 | null;
  act_math: Pct3 | null;
  act_english: Pct3 | null;
  /** C.926–C.931: ACT Science, Reading. */
  act_science: Pct3 | null;
  act_reading: Pct3 | null;
  /** C.932–C.972: the share in each score band, per test. */
  bands: Record<BandTest, Bands6 | null>;
}

/** A test-policy change: across the college's CDS editions, or from the federal value to its first CDS. */
export interface TestPolicyEvent {
  /** The fall the new policy applies to. */
  cycle: number;
  from: TestPolicyAnswer;
  to: TestPolicyAnswer;
  from_source: "cds" | "ipeds-adm";
  /** The fall the previous policy described (a CDS's cycle, or the federal fall). */
  from_year: number;
}

/** The SAT block's dataset fields (Decision 2). */
export interface SatBlock {
  sat_reading_25_75?: [number, number] | null;
  sat_math_25_75?: [number, number] | null;
  sat_reading_median?: number | null;
  sat_math_median?: number | null;
  test_submission_rate_sat?: number | null;
}

/** The ACT block's dataset fields (Decision 2). */
export interface ActBlock {
  act_composite_25_75?: [number, number] | null;
  act_composite_median?: number | null;
  act_english_25_75?: [number, number] | null;
  act_math_25_75?: [number, number] | null;
  test_submission_rate_act?: number | null;
}

/** The policy block's dataset field (Decision 1). */
export interface PolicyBlock {
  test_policy?: TestPolicy;
}

/**
 * One replaced block, kept so `restoreFederalTests` can put it back byte for byte: the fall it described (null = the
 * dataset's IPEDS ADM release), its values (a key absent here was absent from `admissions`), and the lineage record
 * each value had (absent = the field's default source).
 */
export type KeptBlock<T> = T & {
  year: number | null;
  records?: Partial<Record<keyof T & string, LineageRecord>>;
};

/** `school.admissions.federal_tests`: the blocks a newer C8/C9 replaced. */
export interface FederalTests {
  policy?: KeptBlock<PolicyBlock>;
  sat?: KeptBlock<SatBlock>;
  act?: KeptBlock<ActBlock>;
}
/* ---- CDS financial aid (specs/data-expansion/cds-financial-aid.md) ---- */

/** CDS section H facts for filters, Compare, and the cost page (`school.reported.aid`). Null wherever the document is blank, never 0. */
export interface ReportedAid {
  /** "2025-26": the document the process facts (forms, dates, methodology) came from. */
  edition: string;
  /** H.101; null → H1, H2, H2A, H6 aren't published (a value with no year can't be cited). */
  aid_year: AidYear | null;
  /** H.102–H.104 as stated; never inferred here (`derived.aid_methodology` infers). */
  methodology: "federal" | "institutional" | "both" | null;
  /** H.801–H.808; null = the list was left blank (not "nothing required"). */
  forms: AidForms | null;
  /** H.901–H.1103. */
  dates: AidDates | null;
  /** H.601–H.605 (the total is in the detail file). */
  international: InternationalAid | null;
  /** H2/H2A first-year column, the lines shown. */
  first_years: H2Headline | null;
  /** H1 institutional grant dollars: need-based (H.107) and non-need (H.119). */
  institutional_grants: { need: number | null; non_need: number | null } | null;
}

/** H.101 parsed: `start` 2025 = 2025–26; estimated (the edition's own year) or final (last year's). */
export interface AidYear {
  start: number;
  status: "estimated" | "final";
}

export interface AidForms {
  fafsa: boolean;
  own_form: boolean;
  css_profile: boolean;
  state_form: boolean;
  noncustodial_profile: boolean;
  business_farm_supplement: boolean;
  other: string | null;
}

/** A month and day with no year: the year is the cycle in the value's lineage. */
export interface AidDay {
  month: number;
  day: number;
}

export interface AidDates {
  priority: AidDay | "unstated" | null;
  deadline: AidDay | "unstated" | null;
  no_deadline: boolean | null;
  notify_by: AidDay | null;
  notify_rolling_from: AidDay | "unstated" | null;
  reply_by: AidDay | null;
  reply_within_weeks: number | null;
}

export interface InternationalAid {
  need_based: boolean;
  non_need: boolean;
  none: boolean;
  recipients: number | null;
  average: number | null;
}

/** H2 lines by template letter: a–m, and H2A n–q. Shares are derived, never stored. */
export type H2Line = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q";
/** One H2 column; `i` (average share of need met) is a fraction 0–1. */
export type H2Column = Record<H2Line, number | null>;
export type H2Headline = Pick<H2Column, "a" | "c" | "d" | "h" | "i" | "j" | "k" | "m" | "n" | "o" | "p" | "q">;

/** H1 dollars, one column (need-based or non-need). Federal Work-Study is need-based only (null in the non-need row). */
export interface H1Row {
  federal: number | null;
  state: number | null;
  institutional: number | null;
  external: number | null;
  total_grants: number | null;
  student_loans: number | null;
  federal_work_study: number | null;
  other_work: number | null;
  total_self_help: number | null;
  parent_loans: number | null;
  tuition_waivers: number | null;
  athletic: number | null;
}

export type H14Criterion = "academics" | "alumni_affiliation" | "art" | "athletics" | "job_skills" | "rotc" | "leadership" | "music_drama" | "religious_affiliation" | "state_residency";

/** `detail.cds_aid`: all of section H with a quote per value (the per-college detail file, lib/detail.ts). */
export interface CdsAidDetail {
  document: { url: string; edition: string; retrieved: string; sha256: string };
  aid_year: AidYear | null;
  h1: { need: H1Row; non_need: H1Row } | null;
  h2: { first_years: H2Column; full_time: H2Column; part_time: H2Column } | null;
  h6: { need_based: boolean; non_need: boolean; none: boolean; recipients: number | null; average: number | null; total: number | null } | null;
  h7: { own_form: boolean; css_profile: boolean; other: boolean; other_text: string | null } | null;
  h14: Record<H14Criterion, { non_need: boolean | null; need: boolean | null }> | null;
  h15: { text: string; display: boolean } | null;
  /** Every non-null value above, by template code: the verbatim quote and where it is. */
  cite: Record<string, { quote: string; page?: number; cell?: string; line?: number; field?: string }>;
}

/** `aid.cds_previous`: the hand-imported `aid.cds` a same-or-newer CDS record replaced. */
export interface CdsAidPrevious {
  edition: string;
  url: string;
  values: CdsAid;
}
/** Seven class-size bins in CDS I-3 order: 2–9, 10–19, 20–29, 30–39, 40–49, 50–99, 100+. */
export type ClassSizeBins = [number, number, number, number, number, number, number];

/**
 * CDS academics (specs/data-expansion/cds-academics.md): class sections by size, the college's own student-to-faculty
 * ratio, special programs offered, and required coursework. Additive: nothing here replaces a federal value.
 */
export interface ReportedAcademics {
  class_sections?: {
    /** I.301–I.307. */
    sections: ClassSizeBins;
    /** I.308 as printed, or the bins' sum when the printed total is unreadable (an Excel `##`). */
    sections_total: number;
    /** I.309–I.315; null when the college didn't fill the subsection rows. */
    subsections: ClassSizeBins | null;
    /** I.316 (or the sum); null with `subsections`. */
    subsections_total: number | null;
    /** The fall the item labels itself with, e.g. "Fall 2025". */
    term: string;
    /** CDS edition read, e.g. "2025-26". */
    edition: string;
  } | null;
  /** The college's own figure, by its own CDS definition (never compared to academics.student_faculty_ratio). */
  student_faculty_ratio?: {
    /** I.201. */
    ratio: number;
    /** I.202, or null when not printed. */
    students: number | null;
    /** I.203, or null when not printed. */
    faculty: number | null;
    term: string;
  } | null;
  /** E1: only programs the college marked. A key present means "offered"; blank ≠ no, so never `false`. */
  programs?: Partial<Record<CdsProgramKey, true>>;
  /**
   * E3: a key present means the college checked that area as required. Present and empty (`{}`) means the section was
   * read and nothing was checked: an open curriculum. Absent means not read.
   */
  core_curriculum?: Partial<Record<CdsCoreAreaKey, true>>;
}

export type CdsProgramKey =
  | "accelerated"
  | "cross_registration"
  | "distance_learning"
  | "double_major"
  | "dual_enrollment"
  | "esl"
  | "exchange"
  | "honors"
  | "independent_study"
  | "internships"
  | "liberal_arts_career"
  | "student_designed_major"
  | "teacher_certification"
  | "weekend_college";

export type CdsCoreAreaKey =
  | "arts"
  | "computer_literacy"
  | "english"
  | "foreign_languages"
  | "history"
  | "physical_education"
  | "humanities"
  | "intensive_writing"
  | "mathematics"
  | "philosophy"
  | "sciences"
  | "social_science";

/** One CDS D2 row (transfer applicants, admitted, or enrolled) by sex, with the printed total. Missing is null. */
export interface TransferCounts {
  men: number | null;
  women: number | null;
  unknown: number | null;
  total: number;
}

/** Terms a transfer student may enter (CDS D3; the 2025–26 template offers all four). */
export type TransferTerm = "fall" | "winter" | "spring" | "summer";

/**
 * A CDS D5 requirement as the college marked it. The template's five choices: "Required of All", "Required of Some",
 * "Recommended of All", "Recommended of Some", "Not Required".
 */
export type TransferRequirement = "required" | "required_some" | "recommended" | "recommended_some" | "not_required";

/** CDS D5: what a transfer application needs. A row the college left unmarked (or marked twice) is null. */
export interface TransferMaterials {
  high_school_transcript: TransferRequirement | null;
  college_transcript: TransferRequirement | null;
  essay: TransferRequirement | null;
  interview: TransferRequirement | null;
  standardized_tests: TransferRequirement | null;
  statement_of_good_standing: TransferRequirement | null;
}

/** CDS D9 for one entry term: month and day, no year (the cycle is the lineage year). */
export interface TransferTermDates {
  priority: { month: number; day: number } | null;
  closing: { month: number; day: number } | null;
  notification: { month: number; day: number } | "rolling" | null;
  reply: { month: number; day: number } | null;
}

/**
 * CDS section D, transfer admission (specs/data-expansion/cds-transfer.md): the funnel (D2), whether and when transfers
 * may enter, and what they need to apply. Each value comes from a passed record item and carries its own lineage record
 * and year (D2: the fall; D9: the next cycle; the rest: the edition). Additive to `demographics.transfer_in` (a
 * federal headcount), never a replacement for it. Partial coverage: never in ranks, medians, sorts, or percentiles.
 */
export interface ReportedTransfer {
  /** D1, or true when D1 is blank and D2 reports transfer applicants (the lineage record says so). */
  enrolls_transfers: boolean | null;
  /** D1's second question: credit for course work completed elsewhere. */
  advanced_standing: boolean | null;
  applicants: TransferCounts | null;
  admitted: TransferCounts | null;
  enrolled: TransferCounts | null;
  /** admitted.total ÷ applicants.total, when at least 10 were admitted. */
  admit_rate: number | null;
  terms: TransferTerm[] | null;
  /** D4: minimum credits completed to apply as a transfer, and D4's unit ("Credit(s)", "Semester hours"). */
  min_credits: number | null;
  min_credits_unit: string | null;
  required_materials: TransferMaterials | null;
  /** D6/D7 on a 4.0 scale; null when the college states none ("No minimum required"). */
  min_hs_gpa: number | null;
  min_college_gpa: number | null;
  dates: Partial<Record<TransferTerm, TransferTermDates>> | null;
}

/**
 * CDS Greek life, phase 1 (specs/greek-life.md; lib/cds/greek.ts): F1's participation percentages (men in
 * fraternities, women in sororities, each for first-years and all undergrads) and F4's fraternity/sorority housing
 * checkbox. Each value carries its own lineage record and year (F1: the fall; `housing`: the edition). Partial
 * coverage: never in ranks, medians, sorts, or "Known for" until enough colleges report it (spec Open questions).
 */
export interface ReportedGreek {
  /** F.102: percent of first-year men who join fraternities. */
  frat_pct_first_year: number | null;
  /** F.110: percent of all undergraduate men who join fraternities. */
  frat_pct_undergrad: number | null;
  /** F.103: percent of first-year women who join sororities. */
  sor_pct_first_year: number | null;
  /** F.111: percent of all undergraduate women who join sororities. */
  sor_pct_undergrad: number | null;
  /** F.408: fraternity/sorority housing. A checked box stores `true`; unchecked or blank stores `null` (never `false`). */
  housing: boolean | null;
}

/**
 * A month/day with no year (the year lives in the field's lineage record, e.g. "Fall 2026 cycle"). Both null means the
 * cell held free text; the verbatim text is in the lineage quote. Same shape as lib/cds-dates.ts `CdsDate`.
 */
export interface CdsDate {
  month: number | null;
  day: number | null;
}

/**
 * CDS C13–C18 for the regular round (specs/data-expansion/cds-application-logistics.md): fee waivers, the closing and
 * priority dates, notification, the reply rule, the housing deposit, and deferred admission. Describes the cycle that
 * opens after the edition's own class (2025–26 edition → applying for fall 2026). Nothing here replaces a federal value.
 * Each key is null when the college's CDS left it blank; there is no fallback to an older edition.
 */
export interface ReportedLogistics {
  /** "Fall 2026": the entering class applicants in this cycle are applying for. */
  cycle: string;
  /** CDS edition, e.g. "2025-26". */
  edition: string;
  /** C.1303–C.1305. `online_same`: the online fee is the same as the paper fee. */
  fee: { waiver: boolean | null; online_same: boolean | null; online_waiver: boolean | null } | null;
  /** C.1401–C.1403: the regular round's closing date. */
  regular_closing: CdsDate | null;
  /** C.1404–C.1405. */
  priority_date: CdsDate | null;
  /** C.1501: first-years accepted for terms other than fall. Stored, never displayed. */
  other_terms: boolean | null;
  /** C.1601–C.1608. `other_date` is C.1608 when it reads as a date (W&M's Excel serial → April 1); else `other_text`. */
  notification: {
    kind: "rolling" | "by_date" | "other";
    rolling_from: CdsDate | null;
    by_date: CdsDate | null;
    other_date: CdsDate | null;
    other_text: string | null;
  } | null;
  /** C.1701–C.1708. */
  reply: {
    kind: "fixed_date" | "may1_or_weeks" | "no_set_date" | "other";
    date: CdsDate | null;
    weeks: number | null;
    other_text: string | null;
  } | null;
  /** C.1709–C.1712. A non-number in the amount cell ("varies") leaves `amount` null; the text stays in the quote. */
  housing_deposit: { due: CdsDate | null; amount: number | null; refundable: "full" | "partial" | "no" | null } | null;
  /** C.1801–C.1802. `max_postponement` is the college's own words ("2 Year"); "Yes or No" is a placeholder, never true. */
  deferred_admission: { allowed: boolean | null; max_postponement: string | null } | null;
}

/** High school units by subject (CDS C5). Lab is a subset of science, never an addend. */
export interface UnitsBySubject {
  total: number | null;
  /** True when the college left the total blank and it was summed from the subjects (C5's sum rule). */
  total_summed?: boolean;
  english: number | null;
  math: number | null;
  science: number | null;
  lab: number | null;
  foreign_language: number | null;
  social_studies: number | null;
  history: number | null;
  electives: number | null;
  computer_science: number | null;
  arts: number | null;
  /** C.512 / C.524's free-text "Other" line. */
  other_text: string | null;
}

/** CDS C3–C5 (specs/data-expansion/cds-application-logistics.md): standing admission policy, no cycle year. */
export interface ReportedHsPrep {
  /** C.301, the template's own wording, verbatim (a closed checklist). */
  completion: string | null;
  /** C.401. */
  college_prep: "required" | "recommended" | "neither" | null;
  /** C.501–C.512. */
  units_required: UnitsBySubject | null;
  /** C.513–C.524. */
  units_recommended: UnitsBySubject | null;
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

/* ---- Religious life (specs/religious-life.md, phase 1) ---- */

/** IPEDS IC `RELAFFIL`: the code and NCES's own label from the IC{Y} data dictionary (never typed by hand). */
export interface ReligiousAffiliation {
  code: number;
  label: string;
}
/** `school.religion`. */
export interface SchoolReligion {
  /** Null: IPEDS "not applicable", the college has no religious affiliation. */
  affiliation: ReligiousAffiliation | null;
  /**
   * Phase 3 (specs/religious-life.md#measures item 2; specs/campus-directories.md): true when the CCCU's own
   * member-school list names this college a full (voting) member. A membership fact, not a campus chapter: never
   * shown in the "Faith communities" list, only feeds "Known for: Faith-centered" alongside C7. Absent, never false.
   */
  cccu_member?: true;
}
/** The faith families the Explore filter groups IPEDS's ~60 affiliations into (lib/religion.ts RELAFFIL_FAMILY). */
export type FaithFilter = FaithFamily | "none";
export type FaithFamily =
  | "catholic"
  | "baptist"
  | "methodist"
  | "lutheran"
  | "presbyterian_reformed"
  | "nondenominational"
  | "other_christian"
  | "jewish"
  | "latter_day_saint"
  | "other";
/**
 * `school.reported.religion` (lib/cds/religion.ts). Stored only when a box is marked: an unmarked CDS box is "not
 * marked", never "no", so there's no false.
 */
export interface ReportedReligion {
  /** CDS H14: the college's own scholarships consider religious affiliation (H.1409 non-need, H.1418 need-based). */
  aid_by_affiliation?: { non_need: boolean; need: boolean };
  /** CDS F2 (F.201): campus ministries among the activities offered. */
  campus_ministries?: true;
}

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
/**
 * Whether a college reported its "another gender" count (IPEDS imputation flag): `reported` (a count, 0 included),
 * `withheld` (it records other genders but left the cells blank because at least one count was under 5, flag "S"),
 * or `not_collected` (it doesn't record other genders, flag "A"). Blank and 0 never mean the same thing.
 */
export type GenderReportStatus = "reported" | "withheld" | "not_collected";

/** Fall undergraduates (all, IPEDS EF{Y}A level 2) of another gender and of unknown gender (lib/lgbtq.ts). */
export interface GenderDetail {
  status: GenderReportStatus;
  /** Undergraduates whose records hold a gender other than man or woman; null unless `status` is "reported". */
  another: number | null;
  /** Undergraduates whose gender the college doesn't know (reported separately, by every college). */
  unknown: number | null;
  /** All undergraduates that fall, the denominator for the share. */
  undergrads: number | null;
}

/** First-time applicants, admits, and enrollees of another gender (IPEDS ADM `APPLCNAN`, `ADMSSNAN`, `ENRLAN`). */
export interface GenderAdmissions {
  status: GenderReportStatus;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
}

/** A state law that applies to the college because it's public (data/state-laws.json; specs/lgbtq-life.md). */
export interface StateLaw {
  state: string;
  /** Short name, e.g. "Texas SB 17 (2023)". */
  name: string;
  /** The codified section, e.g. "Texas Education Code §51.3525". */
  statute: string;
  /** Session law citation, e.g. "Acts 2023, 88th Leg., R.S., Ch. 922 (S.B. 17)". */
  act: string;
  /** ISO date the law took effect. */
  effective: string;
  /** One neutral sentence, checked against the statute text. */
  summary: string;
  /** The statute text. */
  url: string;
  /** ISO date the statute was last read. */
  checked: string;
}

export interface LgbtqLife {
  gender: GenderDetail | null;
  /** Null when the college isn't in the admissions file (open admission) or the file has no such columns. */
  admissions: GenderAdmissions | null;
  state_law: StateLaw | null;
  /**
   * Tier A policy facts from the college's own pages (lgbtq-life.md "Inclusive policies"; built by the pilot track,
   * specs/lgbtq-life.md phase 4). Absent until then. For a key also carried by a national directory's tier D lead
   * (`school.directories.lgbtq`, specs/campus-directories.md), the tier A fact here takes precedence in the profile's
   * policy checklist (lib/lgbtq-policy.ts `policyChecklist`): the directory lead never shows once the college's own
   * page has been checked for that key, even when the tier A answer is "no".
   */
  policies?: PolicyCheck[] | null;
}

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
  | "scorecard-fos"
  /** State statutes that apply to public colleges, read by hand (data/state-laws.json; specs/lgbtq-life.md). */
  | "state-law"
  /** Wikidata, joined by IPEDS id (P1771): social accounts and other names (specs/school-identity/social-accounts.md). */
  | "wikidata"
  /** English Wikipedia's college color data, cited to each college's brand guide (specs/school-identity/brand.md). */
  | "wikipedia"
  /**
   * National and official directories of campus chapters and groups (tiers B and D; specs/campus-directories.md).
   * Each listing names its organization, list URL, and the date read in the `directories` detail table's credits.
   */
  | "directory"
  /** An organization's estimate for one campus (tier C, e.g. Hillel's Jewish-student count), credited and dated. */
  | "org-estimate"
  /** A college's own policy page, checked on a date with a quote (tier A; lgbtq-life.md policies, `PolicyCheck`). */
  | "policy-page";
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

/**
 * Official links (specs/school-identity/links.md). `website` and `price_calculator` came first (College Scorecard);
 * the rest come from the IPEDS directory (HD) except `visit` and `virtual_tour`, which are found on the college's own
 * admissions page. Optional while older documents lack them; null = the college reported none.
 */
export interface SchoolLinks {
  website: string | null;
  /** The college's federally required net price calculator. */
  price_calculator: string | null;
  admissions?: string | null;
  apply?: string | null;
  financial_aid?: string | null;
  /** The campus visit page, found on the college's site (lineage: the page it was found on and the link text). */
  visit?: string | null;
  /** Kept only when a virtual tour is the only visit page found. */
  virtual_tour?: string | null;
  veterans?: string | null;
  disability_services?: string | null;
}

/** Social networks, in the order the profile shows them (the order students use them, not alphabetical). */
export type SocialNetwork = "instagram" | "youtube" | "tiktok" | "x" | "facebook" | "linkedin";

/** One handle per network: Instagram/TikTok/X handle, YouTube channel id (`UC…`), Facebook page id or name, LinkedIn slug. */
export type SchoolSocial = Partial<Record<SocialNetwork, string>>;

export interface SchoolBrand {
  /** Hex colors in brand order, e.g. ["#BA0C2F", "#FFFFFF", "#000000"]. */
  colors: string[] | null;
  /**
   * The colors' names in the same order, e.g. ["red", null, "black"], when the source gives them; null where it names
   * no color (Wikipedia's module leaves the white text-color slot unnamed).
   */
  names: (string | null)[] | null;
  /** The first color that is neither white, black, nor gray (else the first color). */
  accent: string | null;
  /** The monogram's text color on the accent: whichever gives at least 4.5:1 contrast. */
  on_accent: "white" | "black" | null;
  /**
   * The crest gradient's end (hex): the next brand color after the accent, or the accent darkened or lightened when
   * that color is black, gray, or white; always 4.5:1 or more against `on_accent`. Optional: older documents lack it.
   */
  crest_to?: string | null;
  /** The accent re-lit for the light theme's hero tint, e.g. "oklch(0.72 0.16 20)". */
  tint_light: string | null;
  /** The accent re-lit for the dark theme's hero tint. */
  tint_dark: string | null;
  /** The college's site icon, stored as public/brand/{unit_id}.webp (192 px). Null = no acceptable icon, or removed. */
  logo: { source_url: string; retrieved: string; width: number } | null;
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
  /**
   * "Fits my scores" (specs/product/student-profile.md): the signed-in student's own saved SAT total and/or ACT
   * composite (URL params `mySAT`/`myACT`, lib/params.ts), applied server-side with lib/student-profile.ts
   * `fitsScoreRange` against `satComposite` (the sum of sections — the same range `minSAT`/`maxSAT` above use;
   * never the college's own reported total) — "in" (within the college's middle 50%, or the college is
   * test-blind) passes; "out" and "unknown" (no reported range for a score given) are both excluded. Either
   * number may be null if the student saved only the other test.
   */
  fitScores?: { sat: number | null; act: number | null };
  minEnroll?: number;
  maxEnroll?: number;
  /**
   * At least this many applicants / undergraduates at the START of the ten-year window (school.trends `from`), the
   * floors the Biggest movers lists use (specs/trends/top-10-lists.md), so "See all in Explore" shows the same colleges.
   */
  minApplicants?: number;
  minUndergrads?: number;
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
  /** Publishes first-years' GPA (CDS C11/C12; lib/cds/admissions.ts hasGpaData). */
  gpa?: boolean;
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
  /** Where applicants live (lib/cds/residency-display.ts): publishes admit rates by residency; admits out-of-state about as often. */
  byRes?: boolean;
  oosEven?: boolean;
  /** Test policy buckets to keep (lib/test-policy.ts): each college's newest policy; colleges with none are excluded. */
  policy?: ("required" | "optional" | "blind")[];
  /** CDS financial aid (lib/cds/financial-aid.ts): no CSS Profile required; the college aids international students. */
  aidForms?: "no-css";
  intlAid?: boolean;
  /** Has an honors program, from the college's CDS E1 (lib/cds/academics-display.ts). Positive only: no "exclude". */
  honors?: boolean;
  /** Admits transfer students (lib/cds/transfer-display.ts): the CDS D1/D2 answer, else the federal transfer-in count. */
  transfers?: boolean;
  /** Fraternity or sorority participation at least this share (0–1) of undergrad men or women (lib/cds/greek-display.ts). Colleges that don't report either percentage are excluded. */
  minGreek?: number;
  /** Allows deferred admission, a gap year (CDS C18; lib/cds/application-logistics-display.ts). */
  gapYear?: boolean;
  /** Religious affiliation (lib/religion.ts): faith families, or "none" for colleges with no affiliation. */
  faith?: FaithFilter[];
  /** Has a named community of this tradition, from national directories (specs/campus-directories.md; lib/directories.ts `school.directories.faith`). */
  faithGroup?: Tradition[];
  /**
   * LGBTQ+ policy facts only, never the gender-identity counts (lib/lgbtq-policy.ts; specs/lgbtq-life.md "Where it
   * appears"): a listed center, gender-inclusive housing, nondiscrimination covering gender identity.
   */
  lgbtqCenter?: boolean;
  lgbtqHousing?: boolean;
  lgbtqNondiscrimination?: boolean;
  /** National chapter directories (specs/campus-directories.md, specs/greek-life.md phase 4): has a listed chapter in any of these councils. */
  greekCouncils?: Council[];
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
}
