/**
 * NCES Private School Universe Survey (PSS), 2023–24 public-use data file (specs/product/high-school-data.md):
 * directory, enrollment by grade 9–12 and race, student-teacher ratio, and religious affiliation / orientation for
 * every private school that offers grade 12. No rigor or graduation rate: private schools aren't in CRDC or EDFacts,
 * so those stay null (not suppressed).
 *
 * Source: https://nces.ed.gov/surveys/pss/pssdata.asp — CSV zip at
 * https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip (the 2023–24 collection, the newest at build time; 2021–22
 * is the prior release). Record layout: https://nces.ed.gov/surveys/pss/pdf/layout2023_24.pdf. Column meanings and
 * value labels (grade recodes, RELIG/ORIENT, locale) are from the codebook:
 * https://nces.ed.gov/surveys/pss/pdf/codebook2023_24.pdf.
 *
 * Checked against the live file (2026-10-05): all 22,510 PPINs are exactly 8 characters of [A-Z0-9] (confirms
 * isPrivateHighSchoolId's regex, no change needed), all 51 PSTABB values are the 50 states or DC (no territories in
 * PSS), and the enrollment/race/ratio columns used here are never blank or suppressed in the public-use file (N =
 * 22,510, 0 missing per the codebook) — this file reports noise-infused counts for every school, not top/bottom-coded
 * or cell-suppressed ones, so `suppress()`'s small-cell rule (built for CRDC/EDFacts) doesn't apply here; a blank only
 * means "grade not offered" (the paired *_GRD question was "No"). `grad_rate` and `rigor` are left null, not listed in
 * `suppressed` — private schools simply have no federal data for them.
 */
import type { AdapterContext, AdapterInfo, AdapterResult } from "./types.mts";
import type { GradeCode, HighSchool, HsRaceKey } from "../../../lib/high-school-types.ts";
import { HS_RACES, blankHighSchool, isPrivateHighSchoolId, isUsps, normalizeHighSchool, offersGrade12, tidySchoolName, titleCaseName } from "../../../lib/high-school-core.ts";
import { LOCALE_LABELS } from "../../../lib/campus-profile.ts";
import { parseCsv } from "../ipeds.mts";

export const info: AdapterInfo = {
  key: "pss",
  role: "directory",
  rowKind: "private",
  owns: [
    "name", "state", "city", "zip", "address", "lat", "lng", "locale", "district", "state_school_id", "grades", "status",
    "school_type", "affiliation", "enrollment", "student_teacher_ratio", "frl_share", "grad_rate", "rigor",
  ],
  sources: ["nces-pss"],
  vintages: ["pss"],
};

const PSS_URL = "https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip";
const PSS_VINTAGE = "2023–24";

/**
 * LOGR2024 / HIGR2024 (codebook pu_order 224–225): the recoded lowest/highest grade a school offers. Codes 6–17 are
 * 1st–12th grade in order (code − 5); codes 4 "transitional kindergarten" and 5 "transitional first grade" have no
 * GradeCode of their own, so they're mapped to the nearest ordinary grade (kindergarten, first grade respectively) —
 * an approximation noted here since it's not in the shared contract. Code 1 "All Ungraded" maps to "UG", which never
 * satisfies offersGrade12 (an ungraded school's grade 12 coverage is unknowable from this code alone), so those ~284
 * schools nationally are excluded along with everything that doesn't reach grade 12.
 */
const GRADE_RECODE: Record<string, GradeCode> = {
  "1": "UG",
  "2": "PK",
  "3": "KG",
  "4": "KG",
  "5": "1",
  "6": "1",
  "7": "2",
  "8": "3",
  "9": "4",
  "10": "5",
  "11": "6",
  "12": "7",
  "13": "8",
  "14": "9",
  "15": "10",
  "16": "11",
  "17": "12",
};

/** ORIENT (codebook pu_order 229): the school's specific religious orientation, or "Nonsectarian". */
const ORIENT_LABELS: Record<string, string> = {
  "1": "Roman Catholic",
  "2": "African Methodist Episcopal",
  "3": "Amish",
  "4": "Assembly of God",
  "5": "Baptist",
  "6": "Brethren",
  "7": "Calvinist",
  "8": "Christian (no specific denomination)",
  "9": "Church of Christ",
  "10": "Church of God",
  "11": "Church of God in Christ",
  "12": "Church of the Nazarene",
  "13": "Disciples of Christ",
  "14": "Episcopal",
  "15": "Friends",
  "16": "Greek Orthodox",
  "17": "Islamic",
  "18": "Jewish",
  "19": "Latter Day Saints",
  "20": "Lutheran Church - Missouri Synod",
  "21": "Evangelical Lutheran Church in America",
  "22": "Wisconsin Evangelical Lutheran Synod",
  "23": "Other Lutheran",
  "24": "Mennonite",
  "25": "Methodist",
  "26": "Pentecostal",
  "27": "Presbyterian",
  "28": "Seventh-Day Adventist",
  "29": "Other",
  "30": "Nonsectarian",
};

/** Race/ethnicity columns (codebook pu_order 126–132, Q6A–Q6G). */
const RACE_COLUMN: Record<HsRaceKey, string> = {
  hispanic: "P320",
  white: "P330",
  black: "P325",
  asian: "P316",
  pacific_islander: "P318",
  american_indian: "P310",
  two_or_more: "P332",
};

/** A non-negative whole number, or null for blank ("valid skip": the paired grade/question wasn't applicable). */
function count(raw: string | undefined): number | null {
  const t = raw?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function float(raw: string | undefined): number | null {
  const t = raw?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * STTCH_RT (codebook pu_order 356) is a created ratio with no stated missing code, but a handful of the smallest
 * schools (one part-time teacher, noise-infused enrollment) land far outside any plausible school ratio — up to
 * 1,656:1 in the 2023–24 file. The shared row validator requires 0 < ratio < 200 (the same bound CCD/CRDC rows use);
 * values outside it are left null here rather than failing the sync, the same call CCD will make for its own staff
 * file outliers.
 */
function plausibleRatio(raw: string | undefined): number | null {
  const v = float(raw);
  return v !== null && v > 0 && v < 200 ? v : null;
}

export interface PssLoadResult {
  rows: HighSchool[];
  /** Rows dropped before the grade-12 filter: bad id, state not one of the 50 + DC, or an unrecognized grade code. */
  droppedId: number;
  droppedState: number;
  droppedGrade: number;
  /** Rows read that don't reach grade 12 (the expected majority; PSS covers PK–8 schools too). */
  belowGrade12: number;
}

/**
 * Parse the PSS public-use CSV text into private high school rows (grade 12 only). Pure (no network/fs), so tests
 * exercise it directly with an in-memory CSV; `load` below does the fetching and unzipping.
 */
export function parsePssCsv(csvText: string): PssLoadResult {
  const records = parseCsv(csvText);
  const rows: HighSchool[] = [];
  let droppedId = 0;
  let droppedState = 0;
  let droppedGrade = 0;
  let belowGrade12 = 0;

  for (const r of records) {
    const id = (r.PPIN ?? "").trim().toUpperCase();
    if (!isPrivateHighSchoolId(id)) {
      droppedId++;
      continue;
    }
    const state = (r.PSTABB ?? "").trim().toUpperCase();
    if (!isUsps(state)) {
      droppedState++;
      continue;
    }
    const low = GRADE_RECODE[(r.LOGR2024 ?? "").trim()];
    const high = GRADE_RECODE[(r.HIGR2024 ?? "").trim()];
    if (!low || !high) {
      droppedGrade++;
      continue;
    }
    const grades = { low, high };
    if (!offersGrade12(grades)) {
      belowGrade12++;
      continue;
    }

    const row = blankHighSchool(id, "private", tidySchoolName(r.PINST ?? ""), state);
    row.city = r.PCITY ? titleCaseName(r.PCITY) : null;
    row.zip = /^\d{5}$/.test((r.PZIP ?? "").trim()) ? r.PZIP.trim() : null;
    row.address = r.PADDRS ? titleCaseName(r.PADDRS) : null;
    row.lat = float(r.LATITUDE24);
    row.lng = float(r.LONGITUDE24);
    const localeCode = Number((r.ULOCALE24 ?? "").trim());
    row.locale = Number.isFinite(localeCode) ? (LOCALE_LABELS[localeCode] ?? null) : null;
    row.grades = grades;
    row.affiliation = ORIENT_LABELS[(r.ORIENT ?? "").trim()] ?? null;

    const total = count(r.NUMSTUDS);
    const males = count(r.MALES);
    row.enrollment = {
      total,
      by_grade: { "9": count(r.P270), "10": count(r.P280), "11": count(r.P290), "12": count(r.P300) },
      by_race: Object.fromEntries(HS_RACES.map((k) => [k, count(r[RACE_COLUMN[k]])])) as HighSchool["enrollment"]["by_race"],
      // MALES and NUMSTUDS are independently noise-infused (2 of 22,510 rows have males > total); when that leaves no
      // sane subtraction, female is left null rather than published negative.
      female: total !== null && males !== null && males <= total ? total - males : null,
    };
    row.student_teacher_ratio = plausibleRatio(r.STTCH_RT);

    rows.push(normalizeHighSchool(row));
  }

  return { rows, droppedId, droppedState, droppedGrade, belowGrade12 };
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const zip = await ctx.fetchCached(PSS_URL, { file: "pss2324_pu_csv.zip", maxAgeDays: 90 });
  const csvName = ctx.listZip(zip).find((f) => /\.csv$/i.test(f));
  if (!csvName) throw new Error(`pss: ${zip} has no CSV entry`);
  const text = ctx.readZipEntry(zip, csvName);
  const { rows, droppedId, droppedState, droppedGrade, belowGrade12 } = parsePssCsv(text);

  const byState = new Map<string, number>();
  for (const row of rows) byState.set(row.state, (byState.get(row.state) ?? 0) + 1);
  const states = [...byState.keys()].sort();

  ctx.log(`pss: ${rows.length} private high schools offering grade 12, across ${states.length} states/DC`);
  if (droppedId || droppedState || droppedGrade) {
    ctx.warn(`pss: dropped ${droppedId} bad ppin, ${droppedState} non-US-state, ${droppedGrade} unrecognized grade code`);
  }

  return {
    rows,
    sources: {
      "nces-pss": {
        name: "Private School Universe Survey (PSS), 2023–24 public-use data file",
        publisher: "National Center for Education Statistics",
        url: "https://nces.ed.gov/surveys/pss/pssdata.asp",
        retrieved: ctx.today,
      },
    },
    vintages: { pss: PSS_VINTAGE },
    notes: [
      `pss: ${rows.length} rows from the 2023–24 public-use file (${belowGrade12} private schools read don't reach grade 12 and were left out; ${droppedId} bad ppin, ${droppedState} outside the 50 states/DC, ${droppedGrade} unrecognized grade recode)`,
    ],
  };
}
