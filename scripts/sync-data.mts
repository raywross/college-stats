/**
 * Builds data/schools.json for every operating 4-year U.S. college.
 *
 *   npm run sync-data                 # uses COLLEGE_SCORECARD_API_KEY from .env.local
 *   npm run sync-data -- --include-online
 *   npm run sync-data -- --releases-only  # only check NCES for upcoming releases (no API key needed)
 *
 * First, it checks NCES for the files of each upcoming release in
 * data/release-calendar.json and marks the release published once they appear.
 *
 * Sources (merged by IPEDS unit ID):
 *   1. College Scorecard API: the institution list, location, type, undergrad size,
 *      race/ethnicity, Pell and first-gen shares, cost & outcomes.
 *   2. IPEDS Admissions survey (ADM, bulk CSV): applicants, admitted, enrolled,
 *      SAT/ACT percentiles, test submission rates, test policy. Newest year wins.
 *   3. data/overrides.json: hand-verified patches (e.g. from a school's Common Data Set)
 *      applied last, so newer primary-source figures survive every sync.
 *
 * Every value's source is tracked (lib/fields.ts + school.lineage; specs/data-lineage.md).
 * The output is validated before it's written: an unregistered field, an override
 * without a source, or a release without a year stops the sync.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, RepaymentStatus, School, SchoolType, TestPolicy } from "../lib/types";
import { lineageForPatch, validateLineage } from "../lib/lineage.ts";
import { COLLEGE_SITE_SOURCE, type ReportedFile } from "../lib/reported.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { readRecords } from "./lib/college-reported/records.mts";
import { applyProbes, filesToProbe, type FileProbe, type ReleaseCalendar } from "../lib/releases.ts";
import { IPEDS_BASES, parseCsv } from "./lib/ipeds.mts";
import { MSI_FIELDS, campusProfileFrom, directoryIssues, msiFrom } from "../lib/campus-profile.ts";
import { facultySalaryFrom, fullTimeFacultyShareFrom, studentFacultyRatioFrom } from "../lib/academics.ts";
import { OM_COLUMNS, OM_LAG, OM_PIVOT, eightYearFrom, timeToDegreeCoverage } from "../lib/outcome-measures.ts";
import { fetchPivotedTable } from "./lib/om.mts";
import { GR_PELL_COHORT_TYPE, GR_PELL_COLUMNS, RACE_GROUPS, aidGroupGradFrom, raceGradFrom, scorecardRaceCohortField, scorecardRaceRateField } from "../lib/graduation-groups.ts";
import { residenceFrom } from "../lib/residence.ts";
import { addResidenceMeta, buildDetails, crossCheckDerived, detailProblems, fetchResidence, writeDetails } from "./lib/residence-sync.mts";
import { addTransferMeta, checkTransfers, fetchTransfers } from "./lib/transfers-sync.mts";
import { addLgbtq, addStateLawMeta, fetchLgbtqInputs, lgbtqSummary } from "./lib/lgbtq-sync.mts";
import { addMajorsMeta, buildMajorDetails, checkTotals, fetchCompletions, majorsFor, unknownCodes } from "./lib/majors-sync.mts";
import { mergeDetails } from "../lib/detail.ts";
import { financialAidDetails } from "../lib/cds/financial-aid.ts";
import { transferInFrom } from "../lib/transfers.ts";
import { financesFrom } from "../lib/finances.ts";
import { apCreditFrom, athleticsFrom, calendarFrom, disabilityFrom, programsFrom, servicesFrom } from "../lib/campus-services.ts";
import { addFieldOfStudyMeta, buildProgramDetails, fetchFieldOfStudy } from "./lib/field-of-study-sync.mts";
import { fetchValueLabels } from "./lib/ipeds-dictionary.mts";
import { religionFrom } from "../lib/religion.ts";
import { acceptanceRate, applicationFeeFrom, computePrices, factorsFrom, housingFrom, ipedsNum, parseShareBand, priceSuffix, promiseProgramFrom, raceShares, toAid, tuitionPlansFrom } from "../lib/derive.ts";
import { normalizeUrl, websiteMismatch } from "../lib/links.ts";
import { addIdentityMeta, applyIdentity } from "../lib/identity.ts";
import { loadIdentityInputs } from "./lib/identity-sync.mts";
import { writeAliasTable } from "./lib/aliases-sync.mts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "schools.json");
const OVERRIDES = join(ROOT, "data", "overrides.json");
const REPORTED = join(ROOT, "data", "college-reported.json");
const CDS_RECORDS = join(ROOT, "data", "cds-records");
const META = join(ROOT, "data", "meta.json");
const CALENDAR = join(ROOT, "data", "release-calendar.json");
const STATE_LAWS = join(ROOT, "data", "state-laws.json");
const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
const INCLUDE_ONLINE = process.argv.includes("--include-online");
const RELEASES_ONLY = process.argv.includes("--releases-only");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const REGION_BY_STATE: Record<string, string> = {};
const REGIONS: Record<string, string[]> = {
  Northeast: ["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA", "DE", "MD"],
  Southeast: ["AL", "AR", "FL", "GA", "KY", "LA", "MS", "NC", "SC", "TN", "VA", "WV", "DC"],
  Midwest: ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"],
  Southwest: ["AZ", "NM", "OK", "TX"],
  West: ["AK", "CA", "CO", "HI", "ID", "MT", "NV", "OR", "UT", "WA", "WY"],
};
for (const [region, states] of Object.entries(REGIONS)) for (const s of states) REGION_BY_STATE[s] = region;

const TYPE_BY_OWNERSHIP: Record<number, SchoolType> = {
  1: "public",
  2: "private-nonprofit",
  3: "private-forprofit",
};

const POLICY_BY_ADMCON7: Record<string, TestPolicy> = {
  "1": "required",
  "2": "recommended",
  "3": "not-considered",
  "5": "considered",
};

const round = (v: number, places = 4) => Math.round(v * 10 ** places) / 10 ** places;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function getJson(url: string, attempt = 1): Promise<unknown> {
  const res = await fetch(url);
  if (res.ok) return res.json();
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const wait = 1000 * 2 ** attempt;
    console.warn(`  HTTP ${res.status}, retrying in ${wait / 1000}s…`);
    await sleep(wait);
    return getJson(url, attempt + 1);
  }
  throw new Error(`HTTP ${res.status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
}

/* ------------------------------------------------------------------ */
/* 1. College Scorecard                                                */
/* ------------------------------------------------------------------ */

const RACE = "latest.student.demographics.race_ethnicity";
const REPAYMENT = "latest.repayment.3_yr_bb_fed_repayment.ug";
/** Scorecard's repayment categories (they sum to 100%), by the site's names. */
const REPAYMENT_FIELDS: Record<RepaymentStatus, string> = {
  paid_in_full: "fullypaid",
  making_progress: "makingprogress",
  not_making_progress: "noprogress",
  deferment: "deferment",
  forbearance: "forbearance",
  delinquent: "delinquent",
  default: "default",
  discharged: "discharge",
};
const NET = "latest.cost.net_price";
const BY_INCOME = "by_income_level";
/** Scorecard's family-income bands, low to high. */
const INCOME_BANDS = ["0-30000", "30001-48000", "48001-75000", "75001-110000", "110001-plus"];
const FIELDS = [
  "id",
  "school.name",
  "school.city",
  "school.state",
  "school.zip",
  "school.ownership",
  "school.online_only",
  "school.school_url",
  "school.price_calculator_url",
  "latest.student.size",
  "latest.aid.pell_grant_rate",
  "latest.student.share_firstgeneration",
  // Student body (specs/data-expansion/student-body.md). Average age at entry is left out: its newest year is 2015.
  "latest.student.demographics.men",
  "latest.student.demographics.women",
  "latest.student.part_time_share",
  "latest.student.share_25_older",
  // Faculty (specs/data-expansion/faculty.md): full-time share, from IPEDS HR. Don't mix with the IPEDS SAL salary.
  "school.ft_faculty_rate",
  // Campus profile: minority-serving and single-sex flags (lib/campus-profile.ts).
  ...Object.values(MSI_FIELDS),
  `${RACE}.white`,
  `${RACE}.black`,
  `${RACE}.hispanic`,
  `${RACE}.asian`,
  `${RACE}.aian`,
  `${RACE}.nhpi`,
  `${RACE}.two_or_more`,
  `${RACE}.non_resident_alien`,
  `${RACE}.unknown`,
  // Admissions fallback, used only when a school is missing from IPEDS ADM.
  "latest.admissions.admission_rate.overall",
  // Cost
  "latest.cost.avg_net_price.overall",
  ...INCOME_BANDS.flatMap((b) => [`${NET}.public.${BY_INCOME}.${b}`, `${NET}.private.${BY_INCOME}.${b}`]),
  "latest.cost.attendance.academic_year",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  // Outcomes
  "latest.earnings.10_yrs_after_entry.median",
  "latest.earnings.6_yrs_after_entry.median",
  "latest.completion.consumer_rate",
  "latest.completion.completion_rate_4yr_150nt",
  "latest.student.retention_rate.four_year.full_time",
  "latest.aid.median_debt.completers.overall",
  "latest.aid.median_debt.completers.monthly_payments",
  // Loans and repayment (specs/data-expansion/loans-and-repayment.md).
  "latest.aid.federal_loan_rate",
  "latest.aid.median_debt.pell_grant",
  "latest.aid.median_debt.no_pell_grant",
  "latest.aid.median_debt.income.0_30000",
  "latest.aid.median_debt.income.30001_75000",
  "latest.aid.median_debt.income.greater_than_75000",
  ...Object.values(REPAYMENT_FIELDS).map((f) => `${REPAYMENT}.${f}`),
  // Graduation by race/ethnicity (specs/data-expansion/graduation-by-group.md): rates and cohort sizes.
  ...RACE_GROUPS.flatMap((g) => [`latest.${scorecardRaceRateField(g)}`, `latest.${scorecardRaceCohortField(g)}`]),
];

type ScorecardRow = Record<string, unknown>;

async function fetchScorecard(key: string): Promise<ScorecardRow[]> {
  const base = new URLSearchParams({
    "school.degrees_awarded.predominant": "3", // predominantly bachelor's-granting
    "school.operating": "1",
    per_page: "100",
    fields: FIELDS.join(","),
    api_key: key,
  });
  const rows: ScorecardRow[] = [];
  let page = 0;
  let total = Infinity;
  while (page * 100 < total) {
    base.set("page", String(page));
    const data = (await getJson(`${API}?${base}`)) as { metadata: { total: number }; results: ScorecardRow[] };
    total = data.metadata.total;
    rows.push(...data.results);
    process.stdout.write(`\r  Scorecard: ${rows.length}/${total}`);
    page++;
  }
  process.stdout.write("\n");
  return rows;
}

/* ------------------------------------------------------------------ */
/* 2. IPEDS Admissions (ADM)                                           */
/* ------------------------------------------------------------------ */

interface IpedsFile {
  /** e.g. "ADM2023" or "SFA2223" */
  name: string;
  url: string;
  rows: Map<string, Record<string, string>>;
}

/**
 * Download the newest available IPEDS bulk file. `names` lists candidate file
 * names newest-first; the first one NCES has published wins.
 */
async function fetchIpeds(names: string[], keepRow?: (row: Record<string, string>) => boolean): Promise<IpedsFile> {
  for (const name of names) {
    let url = "";
    let res: Response | null = null;
    for (const base of IPEDS_BASES) {
      url = `${base}/${name}.zip`;
      const r = await fetch(url);
      if (r.ok) {
        res = r;
        break;
      }
    }
    if (!res) continue;
    const dir = mkdtempSync(join(tmpdir(), "ipeds-"));
    const zip = join(dir, `${name}.zip`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".csv"));
    // "_rv" files are NCES's revised release; prefer them when present.
    const csv = files.find((f) => /_rv\.csv$/i.test(f)) ?? files[0];
    const text = execFileSync("unzip", ["-p", zip, csv], { encoding: "latin1", maxBuffer: 512 * 1024 * 1024 });
    // Files with several rows per college (GR{Y}_PELL_SSL: one per cohort type) say which row to keep.
    const rows = new Map(parseCsv(text).filter((r) => !keepRow || keepRow(r)).map((r) => [r.UNITID, r]));
    console.log(`  IPEDS ${name}: ${rows.size} institutions (${csv})`);
    return { name, url, rows };
  }
  throw new Error(`None of these IPEDS files are published yet: ${names.join(", ")}`);
}

const thisYear = new Date().getFullYear();
const recentYears = Array.from({ length: 6 }, (_, i) => thisYear - i);
/** Admissions: ADM2025, ADM2024, … */
const ADM_NAMES = recentYears.map((y) => `ADM${y}`);
/** Student Financial Aid: SFA2526, SFA2425, … (academic years) */
const SFA_NAMES = recentYears.map((y) => `SFA${String(y - 1).slice(2)}${String(y).slice(2)}`);
/** The directory: HD2026, HD2025, … (HD{Y} describes Y–Y+1). */
const HD_NAMES = [thisYear + 1, ...recentYears].map((y) => `HD${y}`);
// Institutional characteristics (not prices): IC{Y} = Y–Y+1, released each July, like HD.
const IC_CHAR_NAMES = [thisYear + 1, ...recentYears].map((y) => `IC${y}`);
// Fall enrollment part D (student-faculty ratio): EF{Y}D = fall Y, with the winter release.
const EF_D_NAMES = recentYears.map((y) => `EF${y}D`);
// Outcome Measures (8-year outcomes): OM{Y} follows students who entered in fall Y − 8, with the winter release.
const OM_NAMES = recentYears.map((y) => `OM${y}`);

/** The newest published OM file, one row per college (pivoted by cohort; scripts/lib/om.mts), cached like history. */
async function fetchOutcomeMeasures(): Promise<IpedsFile> {
  for (const name of OM_NAMES) {
    const t = await fetchPivotedTable(name, OM_PIVOT, { cacheDir: join(ROOT, ".cache", "ipeds"), maxAgeDays: 7 });
    if (!t) continue;
    const missing = OM_COLUMNS.filter((c) => !t.columns.has(c));
    if (missing.length) throw new Error(`${name} has no ${missing.join(", ")} column`);
    console.log(`  IPEDS ${name}: ${t.rows.size} institutions (${t.csv}, pivoted by ${OM_PIVOT})`);
    return { name, url: t.url, rows: t.rows };
  }
  throw new Error(`None of these IPEDS files are published yet: ${OM_NAMES.join(", ")}`);
}
// Graduation by Pell and loan status: GR{Y}_PELL_SSL = students who entered fall Y − 6 (GR2016 is the first).
const GR_PELL_NAMES = recentYears.map((y) => `GR${y}_PELL_SSL`);
/** "GR2024_PELL_SSL" → 2018, the entering class it follows. */
const grCohortYear = (name: string) => Number(name.slice(2, 6)) - 6;
// Faculty salary (specs/data-expansion/faculty.md): SAL{Y}_IS, all-ranks row. Fall Y, like EF.
const SAL_NAMES = recentYears.map((y) => `SAL${y}_IS`);
// Finance derived variables (endowment, instruction spending per student): DRVF{Y} = fiscal year Y-1–Y.
const DRVF_NAMES = recentYears.map((y) => `DRVF${y}`);

/* ------------------------------------------------------------------ */
/* 3. Merge                                                            */
/* ------------------------------------------------------------------ */

function pair(row: Record<string, string> | undefined, lo: string, hi: string): [number, number] | null {
  const a = ipedsNum(row, lo);
  const b = ipedsNum(row, hi);
  return a !== null && b !== null ? [a, b] : null;
}

const roundOrNull = (v: number | null) => (v === null ? null : round(v));

/** Men's and women's applicants, admits, and enrollees; null when the college reports neither. */
function bySex(row: Record<string, string> | undefined): NonNullable<School["admissions"]["by_sex"]> | null {
  const side = (s: "M" | "W") => ({ applicants: ipedsNum(row, `APPLCN${s}`), admitted: ipedsNum(row, `ADMSSN${s}`), enrolled: ipedsNum(row, `ENRL${s}`) });
  const men = side("M");
  const women = side("W");
  const any = (c: typeof men) => c.applicants !== null || c.admitted !== null || c.enrolled !== null;
  return any(men) || any(women) ? { men, women } : null;
}

/** Scorecard reports public and private net price in separate fields; use whichever applies. */
function netPriceByIncome(sc: ScorecardRow, type: SchoolType): (number | null)[] | null {
  const sector = type === "public" ? "public" : "private";
  const values = INCOME_BANDS.map((b) => numOrNull(sc[`${NET}.${sector}.${BY_INCOME}.${b}`]));
  return values.some((v) => v !== null) ? values : null;
}

function toSchool(
  sc: ScorecardRow,
  adm: Record<string, string> | undefined,
  admYear: number,
  sfa: Record<string, string> | undefined
): School | null {
  const size = numOrNull(sc["latest.student.size"]);
  const state = String(sc["school.state"] ?? "");
  const type = TYPE_BY_OWNERSHIP[Number(sc["school.ownership"])];
  if (!size || size <= 0 || !type) return null;

  const racialDiversity = raceShares((k) => numOrNull(sc[`${RACE}.${k}`]));

  const applicants = ipedsNum(adm, "APPLCN");
  const admitted = ipedsNum(adm, "ADMSSN");
  const enrolled = ipedsNum(adm, "ENRLT");
  // Fewer than 10 applicants makes a rate meaningless (e.g. 0 of 1 admitted).
  const rateFromCounts = acceptanceRate(applicants, admitted);
  const scorecardRate = numOrNull(sc["latest.admissions.admission_rate.overall"]);
  const acceptance = rateFromCounts ?? (applicants !== null && applicants < 10 ? null : scorecardRate);
  const satPct = ipedsNum(adm, "SATPCT");
  const actPct = ipedsNum(adm, "ACTPCT");

  // Record values that didn't come from their field's default source (lib/fields.ts).
  const lineage: School["lineage"] = {};
  if (!adm && acceptance !== null) lineage["admissions.acceptance_rate"] = { source: "scorecard" };

  return {
    unit_id: String(sc.id),
    name: String(sc["school.name"]),
    location: {
      city: String(sc["school.city"] ?? ""),
      state,
      zip: String(sc["school.zip"] ?? "").slice(0, 5),
      region: REGION_BY_STATE[state] ?? "Territories",
    },
    type,
    admissions: {
      year: adm ? admYear : null,
      applicants,
      admitted,
      enrolled,
      acceptance_rate: acceptance === null ? null : round(Math.min(1, acceptance)),
      sat_reading_25_75: pair(adm, "SATVR25", "SATVR75"),
      sat_math_25_75: pair(adm, "SATMT25", "SATMT75"),
      act_composite_25_75: pair(adm, "ACTCM25", "ACTCM75"),
      test_submission_rate_sat: satPct === null ? null : satPct / 100,
      test_submission_rate_act: actPct === null ? null : actPct / 100,
      test_policy: POLICY_BY_ADMCON7[adm?.ADMCON7 ?? ""] ?? null,
      // Admissions detail (specs/data-expansion/admissions-detail.md). Medians exist from fall 2022.
      by_sex: bySex(adm),
      factors: factorsFrom(adm),
      sat_reading_median: ipedsNum(adm, "SATVR50"),
      sat_math_median: ipedsNum(adm, "SATMT50"),
      act_composite_median: ipedsNum(adm, "ACTCM50"),
      act_english_25_75: pair(adm, "ACTEN25", "ACTEN75"),
      act_math_25_75: pair(adm, "ACTMT25", "ACTMT75"),
    },
    demographics: {
      undergrad_enrollment: size,
      pell_grant_percent: numOrNull(sc["latest.aid.pell_grant_rate"]),
      first_gen_percent: (() => {
        const v = numOrNull(sc["latest.student.share_firstgeneration"]);
        return v === null ? null : round(v);
      })(),
      men_share: roundOrNull(numOrNull(sc["latest.student.demographics.men"])),
      women_share: roundOrNull(numOrNull(sc["latest.student.demographics.women"])),
      part_time_share: roundOrNull(numOrNull(sc["latest.student.part_time_share"])),
      age_25_plus_share: roundOrNull(numOrNull(sc["latest.student.share_25_older"])),
      racial_diversity: racialDiversity,
    },
    cost: {
      avg_net_price: numOrNull(sc["latest.cost.avg_net_price.overall"]),
      net_price_by_income: netPriceByIncome(sc, type),
      cost_of_attendance: numOrNull(sc["latest.cost.attendance.academic_year"]),
      tuition_in_state: numOrNull(sc["latest.cost.tuition.in_state"]),
      tuition_out_of_state: numOrNull(sc["latest.cost.tuition.out_of_state"]),
    },
    outcomes: {
      median_earnings_10yr: numOrNull(sc["latest.earnings.10_yrs_after_entry.median"]),
      median_earnings_6yr: numOrNull(sc["latest.earnings.6_yrs_after_entry.median"]),
      // Scorecard's headline "graduation rate"; fall back to the 4-year 150% rate.
      graduation_rate: roundOrNull(
        numOrNull(sc["latest.completion.consumer_rate"]) ?? numOrNull(sc["latest.completion.completion_rate_4yr_150nt"])
      ),
      retention_rate: roundOrNull(numOrNull(sc["latest.student.retention_rate.four_year.full_time"])),
      median_debt: numOrNull(sc["latest.aid.median_debt.completers.overall"]),
      monthly_loan_payment: (() => {
        const v = numOrNull(sc["latest.aid.median_debt.completers.monthly_payments"]);
        return v === null ? null : Math.round(v);
      })(),
      federal_loan_rate: roundOrNull(numOrNull(sc["latest.aid.federal_loan_rate"])),
      median_debt_pell: numOrNull(sc["latest.aid.median_debt.pell_grant"]),
      median_debt_no_pell: numOrNull(sc["latest.aid.median_debt.no_pell_grant"]),
      median_debt_by_income: (() => {
        const v = {
          low: numOrNull(sc["latest.aid.median_debt.income.0_30000"]),
          mid: numOrNull(sc["latest.aid.median_debt.income.30001_75000"]),
          high: numOrNull(sc["latest.aid.median_debt.income.greater_than_75000"]),
        };
        return v.low === null && v.mid === null && v.high === null ? null : v;
      })(),
      repayment_3yr: (() => {
        const out: Partial<Record<RepaymentStatus, { low: number; high: number }>> = {};
        for (const [k, f] of Object.entries(REPAYMENT_FIELDS)) {
          const r = parseShareBand(sc[`${REPAYMENT}.${f}`]);
          if (r) out[k as RepaymentStatus] = r;
        }
        return Object.keys(out).length ? out : null;
      })(),
    },
    aid: toAid(sfa),
    links: {
      website: normalizeUrl(sc["school.school_url"]),
      price_calculator: normalizeUrl(sc["school.price_calculator_url"]),
    },
    ...(Object.keys(lineage).length ? { lineage } : {}),
  };
}

/**
 * Scorecard's "latest" fields don't say which year they describe. Find the
 * year-keyed field whose value matches "latest". The key's meaning varies by
 * field (checked against IPEDS in Sept 2026): for enrollment and age, key N = fall N;
 * for net price, key N = academic year N-1–N. Age is collected in odd-numbered falls only. Retention: key N is fall N's
 * enrollment report, which counts the class that entered fall N − 1 ("Entered fall 2023" for key 2024; checked
 * 2026-10-03, specs/data-expansion/cds-student-body-and-outcomes.md#retention-year).
 */
async function detectScorecardYears(key: string, id: string): Promise<ScorecardYears> {
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const probes = { enrollment: "student.size", age: "student.share_25_older", cost: "cost.avg_net_price.overall", retention: "student.retention_rate.four_year.full_time" } as const;
  const fields = Object.values(probes).flatMap((f) => [`latest.${f}`, ...years.map((y) => `${y}.${f}`)]);
  const params = new URLSearchParams({ id, fields: fields.join(","), api_key: key });
  try {
    const data = (await getJson(`${API}?${params}`)) as { results: Record<string, unknown>[] };
    const row = data.results[0] ?? {};
    const find = (f: string) => years.find((y) => row[`latest.${f}`] != null && row[`${y}.${f}`] === row[`latest.${f}`]);
    const e = find(probes.enrollment);
    const a = find(probes.age);
    const c = find(probes.cost);
    const r = find(probes.retention);
    return { enrollment: e ? `Fall ${e}` : null, age: a ? `Fall ${a}` : null, cost: c ? `${c - 1}–${String(c).slice(2)}` : null, retention: r ? `Entered fall ${r - 1}` : null };
  } catch {
    return { enrollment: null, age: null, cost: null, retention: null };
  }
}

type ScorecardYears = { enrollment: string | null; age: string | null; cost: string | null; retention: string | null };

/** Citation details for every source and the year each release describes. */
function buildMeta(
  adm: IpedsFile,
  sfa: IpedsFile,
  ic: IpedsFile,
  sfaYears: string,
  scorecardYears: ScorecardYears,
  cost2: IpedsFile | null,
  chars: IpedsFile,
  hd: IpedsFile,
  icChar: IpedsFile,
  efd: IpedsFile,
  om: IpedsFile,
  grPell: IpedsFile,
  sal: IpedsFile,
  drvf: IpedsFile,
  drvfFiscalYear: number
): DatasetMeta {
  const scorecardCostYear = scorecardYears.cost;
  return {
    retrieved: new Date().toISOString().slice(0, 10),
    sources: {
      scorecard: {
        label: "College Scorecard",
        publisher: "U.S. Department of Education",
        edition: scorecardCostYear ? `Most recent release (cost data ${scorecardCostYear})` : "Most recent release",
        url: "https://collegescorecard.ed.gov/data/",
        description:
          "Federal data on every college receiving federal student aid: size, student demographics, Pell and first-generation shares, costs, net price by family income, earnings, graduation and retention, and student debt.",
      },
      "ipeds-adm": {
        label: "IPEDS Admissions survey",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `Fall ${adm.name.slice(3)} (${adm.name})`,
        url: adm.url,
        description:
          "Annual survey every college must complete: applicants, admits, and enrollees; SAT/ACT score ranges and submission rates; and how test scores are used in admission. The newest year may be a provisional release that NCES later revises.",
      },
      "ipeds-sfa": {
        label: "IPEDS Student Financial Aid survey",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `${sfaYears} (${sfa.name}${cost2 ? ` + ${cost2.name}` : ""})`,
        url: sfa.url,
        description:
          "Share of full-time first-year students receiving grants, Pell Grants, institutional aid, and loans, with average amounts, plus aid by family income for students receiving federal aid. The newest year may be a provisional release that NCES later revises.",
      },
      "ipeds-ic": {
        label: "IPEDS Institutional Characteristics survey",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `${sfaYears} (${ic.name} + ${chars.name})`,
        url: ic.url,
        description:
          "Published prices for the year: tuition and fees for in-district, in-state, and out-of-state students, books and supplies, on-campus room and board, and other expenses. Also housing capacity and rules, meal plans, the application fee, tuition plans, and Promise programs.",
      },
      "ipeds-hd": {
        label: "IPEDS directory (Institutional Characteristics: HD)",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `${hd.name.slice(2)}–${String(Number(hd.name.slice(2)) + 1).slice(2)} (${hd.name})`,
        url: hd.url,
        description:
          "Every college's directory entry: its city, suburb, town, or rural setting, Carnegie Classification, federal designations such as HBCU and land-grant, and its location on the map. Also the links each college reports: its website, admissions and application pages, financial aid and net price calculator offices, and veterans' and disability-services offices.",
      },
      "ipeds-ef": {
        label: "IPEDS Fall Enrollment survey (part D)",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `Fall ${efd.name.slice(2, 6)} (${efd.name})`,
        url: efd.url,
        description:
          "Each college's student-to-faculty ratio: full-time-equivalent students per full-time-equivalent instructional faculty member, not counting faculty who teach only graduate or professional students.",
      },
      "ipeds-om": {
        label: "IPEDS Outcome Measures survey",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `Students entering fall ${Number(om.name.slice(2)) - OM_LAG} (${om.name})`,
        url: om.url,
        description:
          "What happened to every student who started at each college, 8 years later: earned a degree or certificate there, still enrolled, enrolled at another college, or no record. Covers first-time and transfer students, full-time and part-time, with Pell Grant recipients separately.",
      },
      "ipeds-gr": {
        label: "IPEDS Graduation Rates survey (Pell Grant and subsidized loan recipients)",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `Entered fall ${grCohortYear(grPell.name)} (${grPell.name})`,
        url: grPell.url,
        description:
          "How many first-time, full-time students finished a degree or certificate within six years (150% of normal time), for Pell Grant recipients, students with a subsidized federal loan but no Pell Grant, and students with neither.",
      },
      "ipeds-sal": {
        label: "IPEDS Salaries survey (SAL, instructional staff, all ranks)",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `Fall ${sal.name.slice(3, 7)} (${sal.name})`,
        url: sal.url,
        description:
          "Average salary of a college's full-time instructional staff (all academic ranks combined), equated to a 9-month contract so colleges with different contract lengths can be compared.",
      },
      "ipeds-ic-char": {
        label: "IPEDS Institutional Characteristics survey (athletics, programs, services, religious affiliation)",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `${academicYear(icChar.name.slice(2))} (${icChar.name})`,
        url: icChar.url,
        description:
          "What each college offers: its athletic association, conference, and sports; ROTC, study abroad, and undergraduate research; AP credit; student services; the academic calendar; the share of undergrads registered with disability services; and its religious affiliation, if any (labels from the file's NCES data dictionary).",
      },
      "ipeds-f": {
        label: "IPEDS Finance survey, derived per-student figures",
        publisher: "National Center for Education Statistics (NCES)",
        edition: `${academicYear(String(drvfFiscalYear))} (${drvf.name})`,
        url: drvf.url,
        description:
          "Each college's endowment and spending per full-time-equivalent student, from its own finance report: endowment assets, instruction expenses, academic support, student services, and tuition's share of core revenue. Reported on one of three accounting forms by sector (public, private nonprofit, for-profit), which aren't comparable to each other.",
      },
      cds: {
        label: "Common Data Set",
        publisher: "Each college (voluntary, standardized template)",
        edition: "Varies by college",
        url: "https://commondataset.org/",
        description:
          "A standardized report many colleges publish on their own sites, with more detail than federal surveys: admissions for the latest class and need-based vs. merit aid (section H).",
      },
      "college-site": COLLEGE_SITE_SOURCE,
    },
    vintages: {
      "ipeds-adm": `Fall ${adm.name.slice(3)}`,
      "ipeds-sfa": sfaYears,
      "ipeds-ic": sfaYears,
      "ipeds-hd": `${hd.name.slice(2)}–${String(Number(hd.name.slice(2)) + 1).slice(2)}`,
      "ipeds-ic-char": academicYear(icChar.name.slice(2)),
      "ipeds-ef": `Fall ${efd.name.slice(2, 6)}`,
      "ipeds-om": `Students entering fall ${Number(om.name.slice(2)) - OM_LAG}`,
      "ipeds-gr": `Entered fall ${grCohortYear(grPell.name)}`,
      "ipeds-sal": `Fall ${sal.name.slice(3, 7)}`,
      // Set with its source by addResidenceMeta (scripts/lib/residence-sync.mts).
      "ipeds-ef-c": null,
      // Set with its source by addTransferMeta (scripts/lib/transfers-sync.mts).
      "ipeds-ef-a": null,
      // Set with its source by addMajorsMeta (scripts/lib/majors-sync.mts).
      "ipeds-c": null,
      "ipeds-f": academicYear(String(drvfFiscalYear)),
      "scorecard-enrollment": scorecardYears.enrollment,
      "scorecard-age": scorecardYears.age,
      "scorecard-cost": scorecardYears.cost,
      "scorecard-retention": scorecardYears.retention,
      // Outcomes and other Scorecard fields each describe different cohorts; no single year.
      "scorecard-latest": null,
      // Set with its source by addFieldOfStudyMeta; also no single year (every metric pools a different cohort).
      "scorecard-fos": null,
    },
  };
}

/** "2025" → "2025–26". */
const academicYear = (y: string) => `${y}–${String(Number(y) + 1).slice(2)}`;

/** Athletics, programs, services, AP credit, calendar, and disability services (lib/campus-services.ts). */
function addServices(school: School, row: Record<string, string> | undefined) {
  school.campus = {
    ...(school.campus ?? {}),
    athletics: athleticsFrom(row),
    programs: programsFrom(row),
    services: servicesFrom(row),
    calendar: calendarFrom(row),
  };
  school.admissions.accepts_ap_credit = apCreditFrom(row);
  school.demographics.disability_services = disabilityFrom(row);
}

/** Graduation by Pell/loan status (IPEDS GR{Y}_PELL_SSL) and by race/ethnicity (Scorecard); lib/graduation-groups.ts. */
function addGradByGroup(school: School, row: Record<string, string> | undefined, sc: ScorecardRow) {
  if (!school.outcomes) return;
  const aid = aidGroupGradFrom(row);
  school.outcomes.grad_rate_pell = aid?.rates.pell ?? null;
  school.outcomes.grad_rate_loan_no_pell = aid?.rates.loan_no_pell ?? null;
  school.outcomes.grad_rate_no_pell_no_loan = aid?.rates.no_pell_no_loan ?? null;
  school.outcomes.grad_rate_ftft = aid?.rates.total ?? null;
  school.outcomes.grad_cohorts = aid?.cohorts ?? null;
  const race = raceGradFrom((f) => numOrNull(sc[`latest.${f}`]));
  school.outcomes.grad_rate_by_race = race?.rates ?? null;
  school.outcomes.grad_cohorts_by_race = race?.cohorts ?? null;
}

/** Setting, Carnegie classes, designations, and coordinates (lib/campus-profile.ts). */
function addProfile(school: School, row: Record<string, string> | undefined, sc: ScorecardRow) {
  const p = campusProfileFrom(row);
  school.location.lat = p.lat;
  school.location.lng = p.lng;
  school.campus = { ...(school.campus ?? {}), setting: p.setting, carnegie: p.carnegie, designations: p.designations, msi: msiFrom(sc) };
}

/** The first candidate file NCES has published that carries the housing and policy columns. */
async function fetchCharacteristics(names: string[]): Promise<IpedsFile> {
  for (const name of names) {
    const file = await fetchIpeds([name]).catch(() => null);
    if (file && [...file.rows.values()].some((r) => "ROOMCAP" in r && "APPLFEEU" in r)) return file;
  }
  throw new Error(`No housing and policy columns in any of: ${names.join(", ")}`);
}

/** Housing, application fee, tuition plans, and Promise program (lib/derive.ts, shared with sync-history). */
function addCharacteristics(school: School, row: Record<string, string> | undefined) {
  if (!row) return;
  school.campus = { ...(school.campus ?? {}), housing: housingFrom(row) };
  school.admissions.application_fee = applicationFeeFrom(row);
  if (school.cost) {
    school.cost.tuition_plans = tuitionPlansFrom(row);
    school.cost.promise_program = promiseProgramFrom(row);
  }
}

/** Same-year IPEDS prices and the all-student average cost (lib/derive.ts, shared with sync-history). */
function addPrices(school: School, ic: IpedsFile, sfa: Record<string, string> | undefined, year: string) {
  const prices = computePrices(school.type, ic.rows.get(school.unit_id), priceSuffix(ic.name), sfa, school.aid);
  if (!prices) return;
  // full_price and approx feed the history build; the snapshot keeps full_price inside the breakdown.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { full_price, approx, ...cost } = prices;
  school.cost = {
    ...(school.cost ?? { avg_net_price: null, net_price_by_income: null, cost_of_attendance: null, tuition_in_state: null, tuition_out_of_state: null }),
    year,
    ...cost,
  };
}

type Patch = { [key: string]: unknown };

function deepMerge<T>(target: T, patch: Patch): T {
  const out = structuredClone(target) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("_")) continue; // comments / provenance notes
    const cur = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)
        ? deepMerge(cur, v as Patch)
        : v;
  }
  return out as T;
}

/* ------------------------------------------------------------------ */
/* Release calendar                                                    */
/* ------------------------------------------------------------------ */

/** Whether an IPEDS file is on NCES (either location), and when it was last modified. */
async function probeIpedsFile(name: string): Promise<FileProbe> {
  for (const base of IPEDS_BASES) {
    const res = await fetch(`${base}/${name}.zip`, { method: "HEAD" });
    if (!res.ok) continue;
    const modified = res.headers.get("last-modified");
    return { exists: true, lastModified: modified ? new Date(modified).toISOString().slice(0, 10) : null };
  }
  return { exists: false, lastModified: null };
}

/**
 * Mark releases in data/release-calendar.json published once NCES has their files,
 * so the Data page never lists a release as upcoming after it ships. A network
 * failure only warns: the calendar is left as it was.
 */
async function updateReleaseCalendar() {
  const calendar = JSON.parse(readFileSync(CALENDAR, "utf8")) as ReleaseCalendar;
  const files = filesToProbe(calendar);
  if (!files.length) return;
  console.log(`Checking NCES for upcoming releases (${files.join(", ")})…`);
  let probes: Map<string, FileProbe>;
  try {
    probes = new Map(await Promise.all(files.map(async (f) => [f, await probeIpedsFile(f)] as const)));
  } catch (err) {
    console.warn(`  Couldn't reach NCES; release calendar unchanged (${err instanceof Error ? err.message : err})`);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { calendar: next, published } = applyProbes(calendar, probes, today);
  for (const [f, p] of probes) console.log(`  ${f}: ${p.exists ? `on NCES (modified ${p.lastModified ?? "?"})` : "not yet"}`);
  if (!published.length) return;
  writeFileSync(CALENDAR, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`  Marked published: ${published.join(", ")}. Review data/release-calendar.json and run the full sync to use them.`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  await updateReleaseCalendar();
  if (RELEASES_ONLY) return;

  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) {
    console.error("Missing COLLEGE_SCORECARD_API_KEY. Add it to .env.local (see .env.example).");
    process.exit(1);
  }

  console.log("Fetching sources…");
  const [scorecard, adm, sfa] = await Promise.all([fetchScorecard(key), fetchIpeds(ADM_NAMES), fetchIpeds(SFA_NAMES)]);
  const admYear = Number(adm.name.slice(3));
  const sfaYears = `20${sfa.name.slice(3, 5)}–${sfa.name.slice(5, 7)}`;
  const startYear = `20${sfa.name.slice(3, 5)}`;
  const endYear = `20${sfa.name.slice(5, 7)}`;
  // From the 2023-24 release on, NCES moved residency, income-band aid, and net price out of
  // SFA into COST2_{endYear}. Merge it in when the SFA file no longer carries those columns.
  const sfaHasIncome = [...sfa.rows.values()].some((r) => "GRN4N12" in r);
  let cost2: IpedsFile | null = null;
  if (!sfaHasIncome) {
    cost2 = await fetchIpeds([`COST2_${endYear}`]);
    for (const [id, extra] of cost2.rows) sfa.rows.set(id, { ...extra, ...(sfa.rows.get(id) ?? {}) });
  }
  // Prices must describe the same academic year as the aid data. Older layout: IC{start}_AY
  // ("…AY3" columns = that year); newer: COST1_{end} ("…AY2" columns = that year).
  const ic = await fetchIpeds([`IC${startYear}_AY`, `COST1_${endYear}`]);
  // Housing and policies for the same academic year (specs/data-expansion/housing-and-policies.md): IC{start} until
  // NCES moved them into COST1_{end}. A file only counts if it has them (IC2024 exists as a one-row stub).
  const chars = await fetchCharacteristics([`IC${startYear}`, `COST1_${endYear}`]);
  // Campus profile (specs/data-expansion/campus-profile.md): the newest directory, HD{Y} = Y–Y+1, usually a year ahead.
  const hd = await fetchIpeds(HD_NAMES);
  // Student-faculty ratio (specs/data-expansion/student-faculty-ratio.md).
  const efd = await fetchIpeds(EF_D_NAMES);
  if (![...efd.rows.values()].some((r) => "STUFACR" in r)) throw new Error(`${efd.name} has no STUFACR column`);
  // 8-year outcomes (specs/data-expansion/outcome-measures.md).
  const om = await fetchOutcomeMeasures();
  const omEntering = Number(om.name.slice(2)) - OM_LAG;
  // Graduation by Pell and loan status (specs/data-expansion/graduation-by-group.md): the total cohort row only.
  const grPell = await fetchIpeds(GR_PELL_NAMES, (r) => r.PSGRTYPE === GR_PELL_COHORT_TYPE);
  const grMissing = GR_PELL_COLUMNS.filter((c) => ![...grPell.rows.values()].some((r) => c in r));
  if (grMissing.length || grPell.rows.size < 1000) throw new Error(`${grPell.name}: missing ${grMissing.join(", ") || "rows"} (cohort type ${GR_PELL_COHORT_TYPE})`);
  // Faculty salary (specs/data-expansion/faculty.md): only the all-ranks row (ARANK 7); facultySalaryFrom asserts it.
  const sal = await fetchIpeds(SAL_NAMES, (r) => r.ARANK === "7");
  if (![...sal.rows.values()].some((r) => "ARANK" in r && "SAEQ9AT" in r)) throw new Error(`${sal.name} has no ARANK/SAEQ9AT columns`);
  if (sal.rows.size < 1000) throw new Error(`${sal.name}: only ${sal.rows.size} colleges with an all-ranks (ARANK 7) row`);
  // Finances (specs/data-expansion/finances.md): DRVF{Y}, picked newest-first like the others.
  const drvf = await fetchIpeds(DRVF_NAMES);
  if (![...drvf.rows.values()].some((r) => "F1INSTFT" in r || "F2INSTFT" in r || "F3INSTFT" in r))
    throw new Error(`${drvf.name} has no F1INSTFT/F2INSTFT/F3INSTFT column`);
  // DRVF{Y} describes fiscal year (Y-1)–Y; stored by its start year, like other academic-year fields.
  const drvfFiscalYear = Number(drvf.name.slice(4)) - 1;
  if (![...hd.rows.values()].some((r) => "LOCALE" in r && "CARNEGIEIC" in r)) throw new Error(`${hd.name} has no LOCALE/CARNEGIEIC columns`);
  // Where first-years come from (specs/data-expansion/residence.md): the newest even-year EF{Y}C.
  const efc = await fetchResidence(join(ROOT, ".cache", "ipeds"), thisYear);
  // Transfers in (specs/data-expansion/transfers.md): the newest EF{Y}A, every fall.
  const efa = await fetchTransfers(join(ROOT, ".cache", "ipeds"), thisYear);
  // LGBTQ+ life (specs/lgbtq-life.md): another-gender counts from EF{Y}A and ADM{Y} (the newest files that still have
  // them; NCES stopped asking from 2025–26) and the state-law table.
  const lgbtqInputs = await fetchLgbtqInputs(
    { name: efa.table.name, url: efa.table.url, year: efa.year, rows: efa.table.rows },
    { name: adm.name, url: adm.url, year: admYear, rows: adm.rows },
    join(ROOT, ".cache", "ipeds"),
    STATE_LAWS,
  );
  // Majors (specs/data-expansion/majors.md): the newest C{Y}_A, bachelor's degrees by program.
  const completions = await fetchCompletions(join(ROOT, ".cache", "ipeds"), thisYear);
  const strayCodes = unknownCodes(completions.table);
  if (strayCodes.length) throw new Error(`C${completions.year}_A uses codes that aren't in CIP 2020 (data/reference/cip2020.json): ${strayCodes.slice(0, 10).join(", ")}`);
  // Campus services (specs/data-expansion/campus-services.md): the newest IC{Y}, a year ahead of the price files.
  const icChar = await fetchIpeds(IC_CHAR_NAMES);
  if (![...icChar.rows.values()].some((r) => "ATHASSOC" in r && "CONFNO2" in r && "SLO5" in r && "CALSYS" in r))
    throw new Error(`${icChar.name} has no athletics/program columns`);
  // Religious affiliation (specs/religious-life.md): RELAFFIL from the same IC{Y}, labels from its data dictionary.
  if (![...icChar.rows.values()].some((r) => "RELAFFIL" in r)) throw new Error(`${icChar.name} has no RELAFFIL column`);
  const relaffil = await fetchValueLabels(icChar.name, "RELAFFIL", join(ROOT, ".cache", "ipeds"));
  console.log(`  IPEDS ${icChar.name}_Dict: ${relaffil.labels.size} RELAFFIL labels`);
  // Earnings and debt by major (specs/data-expansion/field-of-study.md): College Scorecard's bulk CSV, cached under
  // .cache/scorecard (dated URL, discovered from the data page every refresh).
  const fos = await fetchFieldOfStudy(join(ROOT, ".cache", "scorecard"), { maxAgeDays: 7 });

  const stats = { online: 0, noSize: 0, withAdmissions: 0, withSat: 0, overridden: 0 };
  const overrides: Record<string, Patch> = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
  // School identity (specs/school-identity/): the committed Wikidata, site probe, and brand files, applied per school.
  const identity = loadIdentityInputs(ROOT);

  const schools: School[] = [];
  // Scorecard and the directory should describe the same college under each id (campus-profile.md, "As built").
  const directoryWarnings: string[] = [];
  // Homepages that disagree by more than scheme, "www.", or a trailing slash (links.md, Ingest); HD wins either way.
  const websiteWarnings: string[] = [];
  for (const row of scorecard) {
    if (!INCLUDE_ONLINE && row["school.online_only"] === 1) {
      stats.online++;
      continue;
    }
    let school = toSchool(row, adm.rows.get(String(row.id)), admYear, sfa.rows.get(String(row.id)));
    if (school) addPrices(school, ic, sfa.rows.get(school.unit_id), sfaYears);
    if (school) addCharacteristics(school, chars.rows.get(school.unit_id));
    if (school) addProfile(school, hd.rows.get(school.unit_id), row);
    if (school) directoryWarnings.push(...directoryIssues(hd.rows.get(school.unit_id), school));
    if (school) addServices(school, icChar.rows.get(school.unit_id));
    if (school) {
      const religion = religionFrom(icChar.rows.get(school.unit_id), relaffil.labels);
      if (religion) school.religion = religion;
    }
    if (school) {
      const salary = facultySalaryFrom(sal.rows.get(school.unit_id));
      const fullTimeShare = fullTimeFacultyShareFrom(row["school.ft_faculty_rate"]);
      school.academics = {
        student_faculty_ratio: studentFacultyRatioFrom(efd.rows.get(school.unit_id)),
        faculty: salary === null && fullTimeShare === null ? null : { avg_salary_9mo: salary, full_time_share: fullTimeShare, count: null },
        ...majorsFor(completions.table, school.unit_id),
      };
    }
    if (school?.outcomes) school.outcomes.eight_year = eightYearFrom(om.rows.get(school.unit_id), omEntering);
    if (school) addGradByGroup(school, grPell.rows.get(school.unit_id), row);
    if (school) school.demographics.residence = residenceFrom(efc.table.rows.get(school.unit_id), school.location.state);
    if (school) school.demographics.transfer_in = transferInFrom(efa.table.rows.get(school.unit_id));
    if (school) school.finances = financesFrom(drvf.rows.get(school.unit_id), drvfFiscalYear);
    if (school) addLgbtq(school, lgbtqInputs);
    if (!school) {
      stats.noSize++;
      continue;
    }
    // Links from the directory, the site probe's finds, social accounts, colors and mark (lib/identity.ts).
    const scorecardWebsite = school.links?.website ?? null;
    applyIdentity(school, identity, hd.rows.get(school.unit_id));
    const hdWebsiteWarning = websiteMismatch(school, normalizeUrl(hd.rows.get(school.unit_id)?.WEBADDR), scorecardWebsite);
    if (hdWebsiteWarning) websiteWarnings.push(hdWebsiteWarning);
    const patch = overrides[school.unit_id];
    if (patch) {
      // Every value the patch sets is attributed to the patch's source (throws if it names none).
      const patchLineage = lineageForPatch(school.unit_id, patch);
      school = deepMerge(school, patch);
      school.lineage = { ...(school.lineage ?? {}), ...patchLineage };
      stats.overridden++;
    }
    if (school.admissions.acceptance_rate !== null) stats.withAdmissions++;
    if (school.admissions.sat_reading_25_75 && school.admissions.sat_math_25_75) stats.withSat++;
    schools.push(school);
  }

  schools.sort((a, b) => a.name.localeCompare(b.name));
  // school.trends comes from `npm run sync-history`; keep it until that runs again (run both: npm run sync-all).
  if (existsSync(OUT)) {
    const previous = new Map((JSON.parse(readFileSync(OUT, "utf8")) as School[]).map((s) => [s.unit_id, s.trends]));
    for (const s of schools) {
      const t = previous.get(s.unit_id);
      if (t) s.trends = t;
    }
  }
  const scorecardYears = await detectScorecardYears(key, String(scorecard[0]?.id ?? "221999"));
  const meta = buildMeta(adm, sfa, ic, sfaYears, scorecardYears, cost2, chars, hd, icChar, efd, om, grPell, sal, drvf, drvfFiscalYear);
  addResidenceMeta(meta, efc.table, efc.year);
  addTransferMeta(meta, efa.table, efa.year);
  addFieldOfStudyMeta(meta, fos);
  addStateLawMeta(meta, lgbtqInputs.laws);
  addIdentityMeta(meta, identity);
  // College-reported data (specs/college-reported-data.md, Decision 5 of specs/college-reported-round-2.md): the
  // ingestion agent's published values, keyed by unit_id, merged the same way scripts/merge-reported.mts re-merges
  // them into the committed data/schools.json later (lib/reported-merge.ts), so the two can't disagree. Adds
  // `school.reported` and lineage for `reported.*` paths only; never touches a federal field. `schools` here was
  // just built fresh from Scorecard/IPEDS, so no school has a `reported` block yet to strip.
  let reportedMerged = 0;
  // CDS records (data/cds-records/, round 3) merge in the same call, after buildMeta (the newest groups need meta's
  // federal years); their detail tables join the sync's below.
  const cdsRecords = readRecords(CDS_RECORDS);
  if (existsSync(REPORTED) || cdsRecords.length) {
    const reportedFile: ReportedFile = existsSync(REPORTED) ? JSON.parse(readFileSync(REPORTED, "utf8")) : { updated: "", entries: [] };
    const merged = mergeReported(schools, reportedFile, { records: cdsRecords, meta, table: CDS_TEMPLATE });
    schools.splice(0, schools.length, ...merged.schools);
    reportedMerged = merged.merged;
  }

  // Transfers in: the level codes must still mean transfer-ins and first-time students (lib/transfers.ts).
  const transfersChecked = await checkTransfers(efa.table, efa.year, schools.map((s) => s.unit_id), join(ROOT, ".cache", "ipeds"));

  // Residence: the per-state rows must add up to NCES's own derived counts, and the detail files must check out.
  const derived = await crossCheckDerived(schools, efc.table, efc.year, join(ROOT, ".cache", "ipeds"));
  if (derived.differ.length > derived.checked * 0.01) throw new Error(`EF${efc.year}C differs from DRVEF${efc.year} for ${derived.differ.length} of ${derived.checked} colleges:\n  ${derived.differ.slice(0, 10).join("\n  ")}`);
  // Majors: programs must add up to IPEDS's own total row (lib/majors.ts), then join residence in the detail files.
  addMajorsMeta(meta, completions.table, completions.year);
  const totals = checkTotals(schools, completions.table);
  if (totals.differ.length > totals.checked * 0.01) throw new Error(`C${completions.year}_A programs don't add up to the total row for ${totals.differ.length} of ${totals.checked} colleges:\n  ${totals.differ.slice(0, 10).join("\n  ")}`);
  // Field of study: a `programs` table per college (new or existing detail file) and the snapshot count.
  const programs = buildProgramDetails(schools, fos, meta);
  // A handful of retired CIP codes is expected (see programEarningsFrom); many means CIP changed under us.
  if (programs.unknown.length > 25) throw new Error(`Field of Study uses ${programs.unknown.length} codes that aren't in CIP 2020:\n  ${programs.unknown.slice(0, 10).join("\n  ")}`);
  if (programs.unknown.length) console.warn(`  ⚠ Field of Study: left out ${programs.unknown.length} program(s) whose code isn't in CIP 2020: ${programs.unknown.join("; ")}`);
  for (const s of schools) s.academics!.programs_with_earnings = programs.counts.get(s.unit_id) ?? null;
  const details = mergeDetails(buildDetails(schools, efc.table, meta), buildMajorDetails(schools, completions.table, meta), programs.details, financialAidDetails(schools, cdsRecords));
  const detailIssues = detailProblems(schools, details, meta);
  if (detailIssues.length) throw new Error(`Detail files failed their checks:\n  ${detailIssues.slice(0, 20).join("\n  ")}`);

  // Time to degree (specs/data-expansion/time-to-degree.md): a few colleges' 4/6-year counts may be blank or not
  // cumulative, but if many are, NCES changed the file and the 4/6/8 steps can't be trusted.
  const timeToDegree = timeToDegreeCoverage(schools);
  if (timeToDegree.missing > timeToDegree.shown * 0.01)
    throw new Error(`${om.name}: ${timeToDegree.missing} of ${timeToDegree.shown} shown 8-year groups have no 4/6-year shares (blank or not cumulative)`);

  // Nothing is written unless every value's lineage checks out.
  const problems = validateLineage(schools, meta);
  if (problems.length) {
    console.error(`\nLineage check failed (${problems.length}); nothing written:`);
    for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
    if (problems.length > 30) console.error(`  …and ${problems.length - 30} more`);
    process.exit(1);
  }
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  // One school per line keeps diffs readable between syncs.
  writeFileSync(OUT, `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  writeDetails(join(ROOT, "data", "detail", "schools"), details);
  // Short names for search (specs/school-identity/aliases.md), from this HD file's IALIAS column and the identity files.
  writeAliasTable(ROOT, { schools, hdRows: hd.rows, wikidata: identity.wikidata });
  console.log(`  residence (EF${efc.year}C): ${schools.filter((s) => s.demographics.residence).length} colleges, ${details.length} detail files; DRVEF${efc.year} agrees for ${derived.checked - derived.differ.length} of ${derived.checked}`);
  console.log(`  field of study: ${programs.counts.size} colleges with bachelor's programs, ${schools.filter((s) => (s.academics?.programs_with_earnings ?? 0) > 0).length} with at least one earnings figure (${fos.url})`);

  console.log(`\nWrote ${schools.length} schools to data/schools.json`);
  console.log(`  with acceptance rate: ${stats.withAdmissions}`);
  console.log(`  with SAT ranges:      ${stats.withSat}`);
  console.log(`  with net price:       ${schools.filter((s) => s.cost?.avg_net_price != null).length}`);
  console.log(`  with earnings:        ${schools.filter((s) => s.outcomes?.median_earnings_10yr != null).length}`);
  console.log(`  with grad rate:       ${schools.filter((s) => s.outcomes?.graduation_rate != null).length}`);
  console.log(`  with 8-year outcomes: ${schools.filter((s) => s.outcomes?.eight_year?.all.award != null).length}`);
  console.log(`  with transfer-ins:    ${schools.filter((s) => s.demographics.transfer_in != null).length} (EF${efa.year}A; level codes checked for ${transfersChecked} colleges)`);
  console.log(`  LGBTQ+ life:          ${lgbtqSummary(schools, lgbtqInputs)}`);
  console.log(`  with 4-year finish:   ${schools.filter((s) => s.outcomes?.eight_year?.all.award_4 != null).length} (${timeToDegree.missing} shown groups without 4/6-year shares)`);
  console.log(`  with Pell grad rate:  ${schools.filter((s) => s.outcomes?.grad_rate_pell != null).length} (${grPell.name})`);
  console.log(`  with Black grad rate: ${schools.filter((s) => s.outcomes?.grad_rate_by_race?.black != null).length}`);
  console.log(`  with aid (IPEDS SFA): ${schools.filter((s) => s.aid?.grant_pct != null).length}`);
  console.log(`  with finances (DRVF): ${schools.filter((s) => s.finances != null).length}`);
  console.log(`  with CDS aid detail:  ${schools.filter((s) => s.aid?.cds).length}`);
  console.log(`  with avg paid (all):  ${schools.filter((s) => s.cost?.avg_paid_all != null).length}`);
  console.log(`  with faculty salary:  ${schools.filter((s) => s.academics?.faculty?.avg_salary_9mo != null).length}`);
  console.log(`  with full-time share: ${schools.filter((s) => s.academics?.faculty?.full_time_share != null).length}`);
  console.log(`  with majors:          ${schools.filter((s) => s.academics?.majors_top != null).length} (C${completions.year}_A; programs match the total row for ${totals.checked - totals.differ.length} of ${totals.checked})`);
  console.log(`  religious affiliation: ${schools.filter((s) => s.religion?.affiliation).length} affiliated, ${schools.filter((s) => s.religion && !s.religion.affiliation).length} none, ${schools.filter((s) => !s.religion).length} not in ${icChar.name}`);
  console.log(`  overrides applied:    ${stats.overridden}`);
  console.log(`  college-reported:     ${reportedMerged} colleges`);
  if (directoryWarnings.length) {
    console.warn(`  directory mismatches: ${directoryWarnings.length} (check the id still means the same college)`);
    for (const w of directoryWarnings.slice(0, 20)) console.warn(`    ${w}`);
    if (directoryWarnings.length > 20) console.warn(`    …and ${directoryWarnings.length - 20} more`);
  } else console.log(`  directory mismatches: 0`);
  if (websiteWarnings.length) {
    console.warn(`  website mismatches (HD vs. Scorecard, beyond scheme/www/slash): ${websiteWarnings.length}`);
    for (const w of websiteWarnings.slice(0, 20)) console.warn(`    ${w}`);
    if (websiteWarnings.length > 20) console.warn(`    …and ${websiteWarnings.length - 20} more`);
  } else console.log(`  website mismatches (HD vs. Scorecard): 0`);
  console.log(`  skipped online-only:  ${stats.online}${INCLUDE_ONLINE ? "" : " (use --include-online to keep)"}`);
  console.log(`  skipped (no undergrads reported): ${stats.noSize}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
