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
import type { DatasetMeta, School, SchoolType, TestPolicy } from "../lib/types";
import { lineageForPatch, validateLineage } from "../lib/lineage.ts";
import { applyProbes, filesToProbe, type FileProbe, type ReleaseCalendar } from "../lib/releases.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "schools.json");
const OVERRIDES = join(ROOT, "data", "overrides.json");
const META = join(ROOT, "data", "meta.json");
const CALENDAR = join(ROOT, "data", "release-calendar.json");
const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
/**
 * NCES moved newer releases (from the Dec 2025 provisional release on) to
 * /ipeds/complete-data-files/; older files remain at /ipeds/datacenter/data/.
 * Check both, newest location first.
 */
const IPEDS_BASES = ["https://nces.ed.gov/ipeds/complete-data-files", "https://nces.ed.gov/ipeds/datacenter/data"];
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

/** Minimal RFC-4180 CSV parser (IPEDS files quote some fields). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().toUpperCase());
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/* ------------------------------------------------------------------ */
/* 1. College Scorecard                                                */
/* ------------------------------------------------------------------ */

const RACE = "latest.student.demographics.race_ethnicity";
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
async function fetchIpeds(names: string[]): Promise<IpedsFile> {
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
    const rows = new Map(parseCsv(text).map((r) => [r.UNITID, r]));
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

/* ------------------------------------------------------------------ */
/* 3. Merge                                                            */
/* ------------------------------------------------------------------ */

function ipedsNum(row: Record<string, string> | undefined, key: string): number | null {
  const v = row?.[key];
  if (!v || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pair(row: Record<string, string> | undefined, lo: string, hi: string): [number, number] | null {
  const a = ipedsNum(row, lo);
  const b = ipedsNum(row, hi);
  return a !== null && b !== null ? [a, b] : null;
}

const roundOrNull = (v: number | null) => (v === null ? null : round(v));

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

  const race = (k: string) => numOrNull(sc[`${RACE}.${k}`]);
  const raceValues = {
    asian: race("asian"),
    black: race("black"),
    hispanic: race("hispanic"),
    white: race("white"),
    two_or_more: race("two_or_more"),
    international: race("non_resident_alien"),
    other: (race("aian") ?? 0) + (race("nhpi") ?? 0) + (race("unknown") ?? 0),
  };
  const hasRace = raceValues.white !== null && raceValues.asian !== null;

  const applicants = ipedsNum(adm, "APPLCN");
  const admitted = ipedsNum(adm, "ADMSSN");
  const enrolled = ipedsNum(adm, "ENRLT");
  // Fewer than 10 applicants makes a rate meaningless (e.g. 0 of 1 admitted).
  const rateFromCounts = applicants && applicants >= 10 && admitted !== null ? admitted / applicants : null;
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
    },
    demographics: {
      undergrad_enrollment: size,
      pell_grant_percent: numOrNull(sc["latest.aid.pell_grant_rate"]),
      first_gen_percent: (() => {
        const v = numOrNull(sc["latest.student.share_firstgeneration"]);
        return v === null ? null : round(v);
      })(),
      racial_diversity: hasRace
        ? (Object.fromEntries(Object.entries(raceValues).map(([k, v]) => [k, round(v ?? 0)])) as NonNullable<
            School["demographics"]["racial_diversity"]
          >)
        : null,
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
    },
    aid: toAid(sfa),
    links: {
      website: normalizeUrl(sc["school.school_url"]),
      price_calculator: normalizeUrl(sc["school.price_calculator_url"]),
    },
    ...(Object.keys(lineage).length ? { lineage } : {}),
  };
}

function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const url = v.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** IPEDS SFA: percents are whole numbers; suffix "2" on GRN4 fields is the file's newest year. */
function toAid(sfa: Record<string, string> | undefined): School["aid"] {
  if (!sfa) return undefined;
  const n = (k: string) => ipedsNum(sfa, k);
  const p = (k: string) => {
    const v = n(k);
    return v === null ? null : v / 100;
  };
  const bands = [1, 2, 3, 4, 5];
  const counts = bands.map((b) => n(`GRN4N${b}2`));
  const cohort = n("SCUGFFN");
  const grantCount = n("AGRNT_N");
  const aid = {
    cohort,
    any_aid_pct: p("ANYAIDP"),
    // Exact share from counts; the published percent (AGRNT_P) is rounded to a whole number.
    grant_pct: cohort && grantCount !== null ? round(grantCount / cohort) : p("AGRNT_P"),
    grant_avg: n("AGRNT_A"),
    grant_count: grantCount,
    grant_total: n("AGRNT_T"),
    institutional_pct: p("IGRNT_P"),
    institutional_avg: n("IGRNT_A"),
    pell_pct: p("PGRNT_P"),
    pell_avg: n("PGRNT_A"),
    state_pct: p("SGRNT_P"),
    loan_pct: p("LOAN_P"),
    loan_avg: n("LOAN_A"),
    by_income: counts.some((c) => c !== null)
      ? {
          counts,
          avg_grant: bands.map((b) => n(`GRN4A${b}2`)),
          granted: bands.map((b) => n(`GRN4G${b}2`)),
          total_grants: bands.map((b) => n(`GRN4T${b}2`)),
        }
      : null,
  };
  return aid.cohort === null && aid.grant_pct === null ? undefined : aid;
}

/**
 * Scorecard's "latest" fields don't say which year they describe. Find the
 * year-keyed field whose value matches "latest". The key's meaning varies by
 * field (checked against IPEDS in Sept 2026): for enrollment, key N = fall N;
 * for net price, key N = academic year N-1–N.
 */
async function detectScorecardYears(key: string, id: string): Promise<{ enrollment: string | null; cost: string | null }> {
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const probes = { enrollment: "student.size", cost: "cost.avg_net_price.overall" } as const;
  const fields = Object.values(probes).flatMap((f) => [`latest.${f}`, ...years.map((y) => `${y}.${f}`)]);
  const params = new URLSearchParams({ id, fields: fields.join(","), api_key: key });
  try {
    const data = (await getJson(`${API}?${params}`)) as { results: Record<string, unknown>[] };
    const row = data.results[0] ?? {};
    const find = (f: string) => years.find((y) => row[`latest.${f}`] != null && row[`${y}.${f}`] === row[`latest.${f}`]);
    const e = find(probes.enrollment);
    const c = find(probes.cost);
    return { enrollment: e ? `Fall ${e}` : null, cost: c ? `${c - 1}–${String(c).slice(2)}` : null };
  } catch {
    return { enrollment: null, cost: null };
  }
}

/** Citation details for every source and the year each release describes. */
function buildMeta(
  adm: IpedsFile,
  sfa: IpedsFile,
  ic: IpedsFile,
  sfaYears: string,
  scorecardYears: { enrollment: string | null; cost: string | null },
  cost2: IpedsFile | null
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
        edition: `${sfaYears} (${ic.name})`,
        url: ic.url,
        description:
          "Published prices for the year: tuition and fees for in-district, in-state, and out-of-state students, books and supplies, on-campus room and board, and other expenses.",
      },
      cds: {
        label: "Common Data Set",
        publisher: "Each college (voluntary, standardized template)",
        edition: "Varies by college",
        url: "https://commondataset.org/",
        description:
          "A standardized report many colleges publish on their own sites, with more detail than federal surveys: admissions for the latest class and need-based vs. merit aid (section H).",
      },
    },
    vintages: {
      "ipeds-adm": `Fall ${adm.name.slice(3)}`,
      "ipeds-sfa": sfaYears,
      "ipeds-ic": sfaYears,
      "scorecard-enrollment": scorecardYears.enrollment,
      "scorecard-cost": scorecardYears.cost,
      // Outcomes and other Scorecard fields each describe different cohorts; no single year.
      "scorecard-latest": null,
    },
  };
}

/**
 * Same-year sticker prices by residency and the estimated average paid by all
 * first-years (not just grant recipients):
 *
 *   avg paid ≈ Σ residency share × on-campus sticker price − share with grants × average grant
 *
 * Students without grants are counted at the full sticker price. Assumes
 * on-campus living costs (so it runs high at commuter-heavy schools).
 */
function addPrices(school: School, ic: Record<string, string> | undefined, sfa: Record<string, string> | undefined, year: string) {
  if (!ic) return;
  // Detect the column convention: IC_AY files use "…AY3" for the file's year, COST1 files use "…AY2".
  const sfx = "CHG2AY3" in ic || "CHG1AY3" in ic ? "3" : "2";
  const n = (k: string) => ipedsNum(ic, `${k}${sfx}`);
  const extras = [n("CHG4AY"), n("CHG5AY"), n("CHG6AY")];
  const onCampusExtras = extras.every((v) => v !== null) ? extras.reduce((a, b) => a! + b!, 0)! : null;
  const tf = { in_district: n("CHG1AY"), in_state: n("CHG2AY"), out_of_state: n("CHG3AY") };
  const sticker = {
    in_district: tf.in_district !== null && onCampusExtras !== null ? tf.in_district + onCampusExtras : null,
    in_state: tf.in_state !== null && onCampusExtras !== null ? tf.in_state + onCampusExtras : null,
    out_of_state: tf.out_of_state !== null && onCampusExtras !== null ? tf.out_of_state + onCampusExtras : null,
  };
  if (Object.values(tf).every((v) => v === null)) return;

  const pctOf = (k: string) => {
    const v = ipedsNum(sfa, k);
    return v === null ? null : v / 100;
  };
  let residency = { in_district: pctOf("SCFA11P"), in_state: pctOf("SCFA12P"), out_of_state: pctOf("SCFA13P") };
  const resTotal = Object.values(residency).reduce<number>((a, b) => a + (b ?? 0), 0);
  // Private colleges charge everyone the same; treat missing residency as all in-state.
  if (resTotal <= 0) residency = { in_district: 0, in_state: 1, out_of_state: 0 };
  const total = Object.values(residency).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;

  // Tuition & fees averaged over the residency mix. Room & board, books, and other costs don't vary by residency.
  let weightedTuition = 0;
  let covered = 0;
  for (const k of ["in_district", "in_state", "out_of_state"] as const) {
    const share = (residency[k] ?? 0) / total;
    if (share === 0) continue;
    const price = tf[k] ?? tf.in_state;
    if (price === null) continue;
    weightedTuition += share * price;
    covered += share;
  }
  const [books, roomBoard, other] = extras;
  const grantPct = school.aid?.grant_pct ?? null;
  const grantAvg = school.aid?.grant_avg ?? null;
  // Round each piece first so the displayed breakdown adds up exactly to the stored total.
  const breakdown =
    covered >= 0.95 && books !== null && roomBoard !== null && other !== null && grantPct !== null && grantAvg !== null
      ? (() => {
          const tuition = Math.round(weightedTuition / covered);
          const fullPrice = tuition + books + roomBoard + other;
          // Total paid ÷ students: total grant dollars spread over every first-year (exact when counts are reported).
          const total = school.aid?.grant_total ?? null;
          const cohort = school.aid?.cohort ?? null;
          const perStudent = total !== null && cohort ? total / cohort : grantPct * grantAvg;
          return { tuition_fees: tuition, books, room_board: roomBoard, other, full_price: fullPrice, grant_per_student: Math.round(perStudent) };
        })()
      : null;
  const avgPaid = breakdown ? breakdown.full_price - breakdown.grant_per_student : null;

  const aided = school.type === "public" ? ipedsNum(sfa, "NPIST2") : ipedsNum(sfa, "NPGRN2");
  school.cost = {
    ...(school.cost ?? { avg_net_price: null, net_price_by_income: null, cost_of_attendance: null, tuition_in_state: null, tuition_out_of_state: null }),
    year,
    sticker,
    tuition_fees: tf,
    residency: {
      in_district: residency.in_district === null ? null : round(residency.in_district / total),
      in_state: residency.in_state === null ? null : round(residency.in_state / total),
      out_of_state: residency.out_of_state === null ? null : round(residency.out_of_state / total),
    },
    components: { books, room_board: roomBoard, other },
    aided_net_price: aided,
    // Guard against inconsistent inputs (e.g. grants reported larger than the price).
    breakdown: avgPaid !== null && avgPaid > 0 ? breakdown : null,
    avg_paid_all: avgPaid !== null && avgPaid > 0 ? avgPaid : null,
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

  const stats = { online: 0, noSize: 0, withAdmissions: 0, withSat: 0, overridden: 0 };
  const overrides: Record<string, Patch> = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};

  const schools: School[] = [];
  for (const row of scorecard) {
    if (!INCLUDE_ONLINE && row["school.online_only"] === 1) {
      stats.online++;
      continue;
    }
    let school = toSchool(row, adm.rows.get(String(row.id)), admYear, sfa.rows.get(String(row.id)));
    if (school) addPrices(school, ic.rows.get(school.unit_id), sfa.rows.get(school.unit_id), sfaYears);
    if (!school) {
      stats.noSize++;
      continue;
    }
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
  const scorecardYears = await detectScorecardYears(key, String(scorecard[0]?.id ?? "221999"));
  const meta = buildMeta(adm, sfa, ic, sfaYears, scorecardYears, cost2);

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

  console.log(`\nWrote ${schools.length} schools to data/schools.json`);
  console.log(`  with acceptance rate: ${stats.withAdmissions}`);
  console.log(`  with SAT ranges:      ${stats.withSat}`);
  console.log(`  with net price:       ${schools.filter((s) => s.cost?.avg_net_price != null).length}`);
  console.log(`  with earnings:        ${schools.filter((s) => s.outcomes?.median_earnings_10yr != null).length}`);
  console.log(`  with grad rate:       ${schools.filter((s) => s.outcomes?.graduation_rate != null).length}`);
  console.log(`  with aid (IPEDS SFA): ${schools.filter((s) => s.aid?.grant_pct != null).length}`);
  console.log(`  with CDS aid detail:  ${schools.filter((s) => s.aid?.cds).length}`);
  console.log(`  with avg paid (all):  ${schools.filter((s) => s.cost?.avg_paid_all != null).length}`);
  console.log(`  overrides applied:    ${stats.overridden}`);
  console.log(`  skipped online-only:  ${stats.online}${INCLUDE_ONLINE ? "" : " (use --include-online to keep)"}`);
  console.log(`  skipped (no undergrads reported): ${stats.noSize}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
