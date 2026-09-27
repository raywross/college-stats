/**
 * Builds data/schools.json for every operating 4-year U.S. college.
 *
 *   npm run sync-data                 # uses COLLEGE_SCORECARD_API_KEY from .env.local
 *   npm run sync-data -- --include-online
 *
 * Sources (merged by IPEDS unit ID):
 *   1. College Scorecard API: the institution list, location, type, undergrad size,
 *      race/ethnicity, Pell and first-gen shares, cost & outcomes.
 *   2. IPEDS Admissions survey (ADM, bulk CSV): applicants, admitted, enrolled,
 *      SAT/ACT percentiles, test submission rates, test policy. Newest year wins.
 *   3. data/overrides.json: hand-verified patches (e.g. from a school's Common Data Set)
 *      applied last, so newer primary-source figures survive every sync.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { School, SchoolType, TestPolicy } from "../lib/types";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "data", "schools.json");
const OVERRIDES = join(ROOT, "data", "overrides.json");
const API = "https://api.data.gov/ed/collegescorecard/v1/schools";
const IPEDS = "https://nces.ed.gov/ipeds/datacenter/data";
const INCLUDE_ONLINE = process.argv.includes("--include-online");

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

async function fetchIpedsAdmissions(): Promise<{ year: number; rows: Map<string, Record<string, string>> }> {
  const thisYear = new Date().getFullYear();
  for (let year = thisYear; year >= thisYear - 5; year--) {
    const res = await fetch(`${IPEDS}/ADM${year}.zip`);
    if (!res.ok) continue;
    const dir = mkdtempSync(join(tmpdir(), "ipeds-"));
    const zip = join(dir, `ADM${year}.zip`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".csv"));
    // "_rv" files are NCES's revised release; prefer them when present.
    const csv = files.find((f) => /_rv\.csv$/i.test(f)) ?? files[0];
    const text = execFileSync("unzip", ["-p", zip, csv], { encoding: "latin1", maxBuffer: 256 * 1024 * 1024 });
    const rows = new Map(parseCsv(text).map((r) => [r.UNITID, r]));
    console.log(`  IPEDS ADM${year}: ${rows.size} institutions (${csv})`);
    return { year, rows };
  }
  throw new Error("No IPEDS ADM file found in the last six years.");
}

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

function toSchool(sc: ScorecardRow, adm: Record<string, string> | undefined, admYear: number): School | null {
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

  const sources = ["College Scorecard"];
  if (adm) sources.push(`IPEDS Admissions ${admYear}`);

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
    sources,
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
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) {
    console.error("Missing COLLEGE_SCORECARD_API_KEY. Add it to .env.local (see .env.example).");
    process.exit(1);
  }

  console.log("Fetching sources…");
  const [scorecard, ipeds] = await Promise.all([fetchScorecard(key), fetchIpedsAdmissions()]);

  const stats = { online: 0, noSize: 0, withAdmissions: 0, withSat: 0, overridden: 0 };
  const overrides: Record<string, Patch> = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};

  const schools: School[] = [];
  for (const row of scorecard) {
    if (!INCLUDE_ONLINE && row["school.online_only"] === 1) {
      stats.online++;
      continue;
    }
    let school = toSchool(row, ipeds.rows.get(String(row.id)), ipeds.year);
    if (!school) {
      stats.noSize++;
      continue;
    }
    const patch = overrides[school.unit_id];
    if (patch) {
      school = deepMerge(school, patch);
      stats.overridden++;
    }
    if (school.admissions.acceptance_rate !== null) stats.withAdmissions++;
    if (school.admissions.sat_reading_25_75 && school.admissions.sat_math_25_75) stats.withSat++;
    schools.push(school);
  }

  schools.sort((a, b) => a.name.localeCompare(b.name));
  // One school per line keeps diffs readable between syncs.
  writeFileSync(OUT, `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);

  console.log(`\nWrote ${schools.length} schools to data/schools.json`);
  console.log(`  with acceptance rate: ${stats.withAdmissions}`);
  console.log(`  with SAT ranges:      ${stats.withSat}`);
  console.log(`  with net price:       ${schools.filter((s) => s.cost?.avg_net_price != null).length}`);
  console.log(`  with earnings:        ${schools.filter((s) => s.outcomes?.median_earnings_10yr != null).length}`);
  console.log(`  with grad rate:       ${schools.filter((s) => s.outcomes?.graduation_rate != null).length}`);
  console.log(`  overrides applied:    ${stats.overridden}`);
  console.log(`  skipped online-only:  ${stats.online}${INCLUDE_ONLINE ? "" : " (use --include-online to keep)"}`);
  console.log(`  skipped (no undergrads reported): ${stats.noSize}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
