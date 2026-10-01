/**
 * Builds data/history/: year-by-year history for every college in data/schools.json (specs/trends-data.md).
 *
 *   npm run sync-history                          # everything (what CI / a release runs)
 *   npm run sync-history -- --ids 221999,170976   # write shards for just these colleges (national stats still cover all)
 *   npm run sync-history -- --refresh             # re-download every NCES file instead of using .cache/ipeds
 *   npm run sync-history -- --no-crosscheck       # skip the Urban Institute spot-check
 *   npm run sync-history -- --offline             # cached NCES, Scorecard, and CPI only (local iteration; never for a release)
 *   npm run sync-history -- --cached-nces         # cached NCES files only (when NCES is down); Scorecard and CPI online
 *
 * Steps: fetch NCES files per era (scripts/history/registry.mts), check every mapped column exists, build each
 * college's series with the same functions as sync-data (lib/derive.ts), then check before writing anything:
 *   - coverage per series and year doesn't drop more than 20% from the year before (unless allow-listed below),
 *   - each series' latest point equals today's value in data/schools.json (rule 1),
 *   - a sample matches the Urban Institute's independently harmonized copy of IPEDS.
 * Year-over-year jumps over 3× are listed for review. Downloads ~80 NCES zips and ~100 College Scorecard pages on the
 * first run (needs COLLEGE_SCORECARD_API_KEY from .env.local); both are cached for a week.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types.ts";
import {
  HISTORY_FAMILIES,
  validateHistoryMeta,
  validateShard,
  valueAt,
  type HistoryFamily,
  type HistoryFile,
  type CpiTable,
  type HistoryMeta,
  trendSummary,
  type SchoolHistory,
  type SeriesKey,
  type YearKind,
} from "../lib/history.ts";
import { fetchIpedsTable, type IpedsTable } from "./lib/ipeds.mts";
import { validateLineage } from "../lib/lineage.ts";
import { ERAS, requiredColumns, type Era, type FileChoice } from "./history/registry.mts";
import {
  bigJumps,
  buildCollege,
  buildFacts,
  buildNational,
  coverage,
  coverageDrops,
  lastPointMismatches,
  ruleOneProblems,
  missingColumns,
  netPriceMismatches,
  type CoverageException,
  type Inputs,
  type YearTable,
} from "./history/build.mts";
import { buildCpi } from "./history/cpi.mts";
import { COHORT_LAG, fetchScorecardHistory } from "./history/scorecard.mts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const OUT = join(DATA, "history");
const SHARDS = join(OUT, "schools");
const CACHE = join(ROOT, ".cache", "ipeds");
const SCORECARD_CACHE = join(ROOT, ".cache", "scorecard");
/** First year Scorecard reports undergrads (fall 1996). */
const SCORECARD_FIRST = 1996;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const IDS = option("--ids")?.split(",").map((s) => s.trim()).filter(Boolean);
const REFRESH = flag("--refresh");
const OFFLINE = flag("--offline");
/** NCES drops connections for hours at a time; files downloaded within the last week are current enough. */
const NCES_CACHED = OFFLINE || flag("--cached-nces");
const CROSSCHECK = !flag("--no-crosscheck") && !OFFLINE;
const THIS_YEAR = new Date().getFullYear();

/**
 * Coverage drops that are real, not a broken mapping. Each needs a reason; review when the build flags a new one.
 */
const EXPECTED_DROPS: CoverageException[] = [
  { series: "undergrads", year: 2001, reason: "College Scorecard has no fall 2000 enrollment for any college (checked 2026-09-28)." },
  { series: "men_share", year: 2001, reason: "Same fall 2000 gap as undergrads: no Scorecard enrollment fields that year (checked 2026-09-29)." },
  { series: "part_time_share", year: 2001, reason: "Same fall 2000 gap as undergrads: no Scorecard enrollment fields that year (checked 2026-09-29)." },
];

function fail(message: string, details: string[] = []): never {
  console.error(`\nsync-history failed: ${message}`);
  for (const d of details.slice(0, 25)) console.error(`  ${d}`);
  if (details.length > 25) console.error(`  …and ${details.length - 25} more`);
  console.error("Nothing was written.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

interface Fetched {
  family: HistoryFamily;
  era: Era;
  year: number;
  choice: FileChoice;
  table: IpedsTable;
  supplement?: IpedsTable;
}

/** Recent files are re-downloaded weekly (NCES revises the last two years); older ones are kept. */
const maxAgeFor = (year: number) => (REFRESH ? 0 : year >= THIS_YEAR - 3 ? 7 : Infinity);

async function fetchYear(era: Era, year: number, keep: ReadonlySet<string>): Promise<Fetched | null> {
  for (const choice of era.files(year)) {
    const table = await fetchIpedsTable(choice.name, { cacheDir: CACHE, maxAgeDays: maxAgeFor(year), keep, offline: NCES_CACHED });
    if (!table) continue;
    let supplement: IpedsTable | undefined;
    if (era.supplement) {
      const name = era.supplement(year);
      const t = await fetchIpedsTable(name, { cacheDir: CACHE, maxAgeDays: maxAgeFor(year), keep, offline: NCES_CACHED });
      if (!t) fail(`${choice.name} is published but its companion ${name} isn't.`);
      supplement = t;
    }
    return { family: era.family, era, year, choice, table, supplement };
  }
  return null;
}

async function fetchAll(keep: ReadonlySet<string>): Promise<Fetched[]> {
  const jobs = ERAS.flatMap((era) => {
    const to = Math.min(era.years[1], THIS_YEAR);
    return Array.from({ length: to - era.years[0] + 1 }, (_, i) => ({ era, year: era.years[0] + i }));
  });
  let done = 0;
  const results = await pool(jobs, 6, async ({ era, year }) => {
    const r = await fetchYear(era, year, keep);
    process.stdout.write(`\r  NCES files: ${++done}/${jobs.length}`);
    return r;
  });
  process.stdout.write("\n");

  // Years must be consecutive: a gap before the newest year means a file moved or failed, not "not published yet".
  const fetched = results.filter((r): r is Fetched => r !== null);
  for (const family of (Object.keys(HISTORY_FAMILIES) as HistoryFamily[]).filter((f) => !("api" in HISTORY_FAMILIES[f]))) {
    const years = fetched.filter((f) => f.family === family).map((f) => f.year).sort((a, b) => a - b);
    if (!years.length) fail(`no files found for ${family}.`);
    const expected = jobs.filter((j) => j.era.family === family && j.year <= years[years.length - 1]).map((j) => j.year);
    const missing = expected.filter((y) => !years.includes(y));
    if (missing.length) fail(`${family}: files missing for ${missing.join(", ")} though later years exist.`, missing.map((y) => ERAS.find((e) => e.family === family && y >= e.years[0] && y <= e.years[1])!.files(y).map((c) => c.name).join(" or ")));
  }

  // Every column each era reads must exist in that year's file.
  const problems: string[] = [];
  for (const f of fetched) {
    const miss = missingColumns(requiredColumns(f.era, f.choice), f.table.columns);
    if (miss.length) problems.push(`${f.table.name}: missing ${miss.join(", ")}`);
    if (f.supplement) {
      const m2 = missingColumns(f.era.supplementRequired ?? [], f.supplement.columns);
      if (m2.length) problems.push(`${f.supplement.name}: missing ${m2.join(", ")}`);
    }
  }
  if (problems.length) fail("columns the registry maps are missing (NCES changed a layout; update scripts/history/registry.mts).", problems);
  return fetched;
}

function toInputs(fetched: Fetched[]): Inputs {
  const table = (f: Fetched): YearTable => {
    let rows = f.table.rows;
    if (f.supplement) {
      // As in sync-data: COST2 columns fill in under the SFA row.
      const merged = new Map(rows);
      for (const [id, extra] of f.supplement.rows) merged.set(id, { ...extra, ...(rows.get(id) ?? {}) });
      rows = merged;
    }
    return { year: f.year, family: f.family, rows, suffix: f.choice.suffix, values: f.era.values };
  };
  const of = (...fams: HistoryFamily[]) => fetched.filter((f) => fams.includes(f.family)).sort((a, b) => a.year - b.year).map(table);
  return { admissions: of("ic-admissions", "adm"), prices: of("prices"), sfa: of("sfa"), characteristics: of("characteristics"), services: of("services"), efd: of("ef-d") };
}

/* ------------------------------------------------------------------ */
/* Cross-check against the Urban Institute's Education Data Portal     */
/* ------------------------------------------------------------------ */

const URBAN = "https://educationdata.urban.org/api/v1/college-university/ipeds";

async function urbanJson(path: string): Promise<{ results: Record<string, number>[] } | null> {
  try {
    // The portal blocks Node's default user agent.
    const res = await fetch(`${URBAN}/${path}`, {
      headers: { "User-Agent": "college-stats sync-history cross-check (+https://github.com/raywross/college-stats)", Accept: "application/json" },
    });
    return res.ok ? ((await res.json()) as { results: Record<string, number>[] }) : null;
  } catch {
    return null;
  }
}

/**
 * Spot-check era mappings against an independent harmonization of the same IPEDS files: applicants in four
 * admissions years spanning the IC → ADM move, and in-state tuition & fees in three price years. Differences fail
 * the build; an unreachable API only warns.
 */
/** Urban files graduation rates under the entering class + 5 (IPEDS GR{year}); Scorecard's year key is + 6. */
const URBAN_GRAD_LAG = COHORT_LAG - 1;

async function crossCheck(schools: School[], histories: Map<string, SchoolHistory>): Promise<{ checked: number; problems: string[]; unreachable: number }> {
  const sample = [...schools]
    .filter((s) => histories.has(s.unit_id))
    .sort((a, b) => (b.admissions.applicants ?? 0) - (a.admissions.applicants ?? 0))
    .filter((_, i) => i % 40 === 0)
    .slice(0, 12);
  const problems: string[] = [];
  let checked = 0;
  const byKind = { applicants: 0, tuition: 0, grad: 0 };
  let unreachable = 0;
  const jobs = sample.flatMap((s) => [
    ...[2001, 2008, 2013, 2019].map((y) => ({ s, y, kind: "applicants" as const })),
    ...[2004, 2012, 2020].map((y) => ({ s, y, kind: "tuition" as const })),
    // Graduation by entering class: checks Scorecard's year key → cohort mapping (COHORT_LAG) against IPEDS counts.
    ...[2008, 2015].map((y) => ({ s, y, kind: "grad" as const })),
  ]);
  await pool(jobs, 4, async ({ s, y, kind }) => {
    const h = histories.get(s.unit_id)!;
    if (kind === "applicants") {
      // Years dropped as carried-forward repeats differ from the source on purpose.
      if (h.repeated?.includes(y)) return;
      const ours = valueAt(h.series.applicants, y);
      const body = await urbanJson(`admissions-enrollment/${y}/?unitid=${s.unit_id}`);
      if (!body) return unreachable++;
      const theirs = body.results.find((r) => r.sex === 99)?.number_applied ?? null;
      const t = theirs !== null && theirs >= 0 ? theirs : null;
      if (ours === null && t === null) return;
      checked++;
      byKind.applicants++;
      if (ours !== t) problems.push(`${s.name} (${s.unit_id}) applicants fall ${y}: ours ${ours ?? "none"}, Urban ${t ?? "none"}`);
    } else if (kind === "grad") {
      const ours = valueAt(h.series.grad_rate, y);
      if (ours === null) return;
      // Urban files a graduation rate under its entering class + 5 (IPEDS GR{year}), unlike Scorecard's + 6.
      const body = await urbanJson(`grad-rates/${y + URBAN_GRAD_LAG}/?unitid=${s.unit_id}`);
      if (!body) return unreachable++;
      const row = body.results.find((r) => r.race === 99 && r.sex === 99 && r.subcohort === 99 && r.institution_level === 4 && r.cohort_year === y);
      if (!row || !(row.cohort_adj_150pct > 0)) return;
      const t = row.completers_150pct / row.cohort_adj_150pct;
      checked++;
      byKind.grad++;
      if (Math.abs(ours - t) > 0.0006) problems.push(`${s.name} (${s.unit_id}) graduation, entered fall ${y}: ours ${ours}, Urban ${t.toFixed(4)}`);
    } else {
      const ours = valueAt(h.series.tuition_in_state, y);
      const body = await urbanJson(`academic-year-tuition/${y}/?unitid=${s.unit_id}`);
      if (!body) return unreachable++;
      // `tuition_fees_published` is the published price (CHG2AY), as ours; `tuition_fees_ft` is a different item
      // (average full-time charges, TUITION2 + FEE2). Urban leaves the published price out of early years (-2).
      const theirs = body.results.find((r) => r.level_of_study === 1 && r.tuition_type === 2)?.tuition_fees_published ?? null;
      const t = theirs !== null && theirs >= 0 ? theirs : null;
      if (t === null) return;
      checked++;
      byKind.tuition++;
      if (ours !== t) problems.push(`${s.name} (${s.unit_id}) in-state tuition & fees ${y}–${String(y + 1).slice(2)}: ours ${ours ?? "none"}, Urban ${t ?? "none"}`);
    }
  });
  // A kind that never matched means the check itself broke (e.g. a year offset), not that the data agrees.
  const silent = Object.entries(byKind).filter(([, n]) => n === 0).map(([k]) => k);
  if (unreachable === 0 && silent.length) problems.push(`cross-check found nothing to compare for: ${silent.join(", ")}`);
  return { checked, problems, unreachable };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

/** One series per line, so a yearly refresh or a revision reads as a small diff. */
function formatShard(h: SchoolHistory): string {
  const lines = Object.entries(h.series).map(([k, s]) => `    ${JSON.stringify(k)}: ${JSON.stringify(s)}`);
  const repeated = h.repeated ? `,\n  "repeated": ${JSON.stringify(h.repeated)}` : "";
  return `{\n  "unit_id": ${JSON.stringify(h.unit_id)},\n  "series": {\n${lines.join(",\n")}\n  }${repeated}\n}\n`;
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const schools: School[] = JSON.parse(readFileSync(join(DATA, "schools.json"), "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
  const universe = new Set(schools.map((s) => s.unit_id));
  if (IDS) {
    const unknown = IDS.filter((id) => !universe.has(id));
    if (unknown.length) fail(`--ids not in data/schools.json: ${unknown.join(", ")} (check IDs against the dataset).`);
  }

  console.log(`Building history for ${schools.length} colleges${IDS ? ` (writing shards for ${IDS.length})` : ""}…`);
  const fetched = await fetchAll(universe);
  const inputs = toInputs(fetched);
  console.log(OFFLINE ? "Using cached College Scorecard history (offline)…" : "Fetching College Scorecard history…");
  const scorecard = await fetchScorecardHistory({
    key: process.env.COLLEGE_SCORECARD_API_KEY,
    cacheDir: SCORECARD_CACHE,
    keep: universe,
    first: SCORECARD_FIRST,
    last: THIS_YEAR,
    refresh: REFRESH,
    offline: OFFLINE,
  }).catch((err: Error) => fail(err.message));
  inputs.scorecard = { rows: scorecard, first: SCORECARD_FIRST, last: THIS_YEAR };

  const histories = new Map(schools.map((s) => [s.unit_id, buildCollege(s, inputs)]));
  const all = [...histories.values()];

  const latestOf = (fam: HistoryFamily[]) => Math.max(...fetched.filter((f) => fam.includes(f.family)).map((f) => f.year));
  const lastOfSeries = (k: "grad_rate") => Math.max(...all.flatMap((h) => (h.series[k] ? [h.series[k]!.start + h.series[k]!.values.length - 1] : [])));
  const latest: Record<YearKind, number> = {
    fall: latestOf(["ic-admissions", "adm"]),
    academic: latestOf(["prices"]),
    cohort: lastOfSeries("grad_rate"),
  };
  const window: Record<YearKind, [number, number]> = {
    fall: [latest.fall - 10, latest.fall],
    academic: [latest.academic - 10, latest.academic],
    cohort: [latest.cohort - 10, latest.cohort],
  };

  console.log(OFFLINE ? "Using the saved CPI table (offline)…" : "Fetching CPI from BLS…");
  const firstMoneyYear = Math.min(...fetched.filter((f) => f.family === "prices").map((f) => f.year));
  const cpiPath = join(OUT, "cpi.json");
  const saved: CpiTable | null = existsSync(cpiPath) ? JSON.parse(readFileSync(cpiPath, "utf8")) : null;
  const cpi: CpiTable =
    OFFLINE && saved
      ? saved
      : await buildCpi(firstMoneyYear).catch((err: Error) => {
          // BLS allows 25 keyless requests a day (set BLS_API_KEY for 500). Past school years' CPI doesn't change,
          // so the saved table is fine when it reaches the newest price year.
          if (!saved || saved.start + saved.values.length - 1 < latest.academic) fail(`CPI: ${err.message}`);
          console.warn(`  BLS unavailable (${err.message.slice(0, 80)}…); using the saved CPI table (retrieved ${saved.retrieved}).`);
          return saved;
        });
  const cpiLast = cpi.start + cpi.values.length - 1;
  if (cpiLast < latest.academic) fail(`CPI only reaches ${cpiLast}–${String(cpiLast + 1).slice(2)}; prices reach ${latest.academic}.`);

  /* ---- Checks ---- */
  console.log("Checking…");
  const shardProblems = all.flatMap((h) => validateShard(h, universe));
  if (shardProblems.length) fail("built history is malformed.", shardProblems);

  const drops = coverageDrops(coverage(all), EXPECTED_DROPS);
  if (drops.length) fail("coverage dropped more than 20% from one year to the next (a moved column or layout change?). Allow-list real drops in EXPECTED_DROPS with a reason.", drops);

  const rule1 = ruleOneProblems(lastPointMismatches(schools, histories, latest), schools);
  if (rule1.hard.length) fail("latest history points differ from data/schools.json (rule 1). Re-run npm run sync-data, or fix lib/derive.ts.", rule1.hard);
  if (rule1.soft.length) console.warn(`  ${rule1.soft.length} soft rule-1 differences (within allowance; review):\n    ${rule1.soft.slice(0, 5).join("\n    ")}`);

  const npm = netPriceMismatches(schools, histories, latest.academic);
  const withNetPrice = schools.filter((s) => s.cost?.net_price_by_income).length;
  if (npm.length > withNetPrice * 0.01) fail(`net price by income differs between IPEDS and Scorecard for ${npm.length} values.`, npm);
  if (npm.length) console.warn(`  Net price by income: ${npm.length} IPEDS values differ from Scorecard (under 1%; review):\n    ${npm.slice(0, 5).join("\n    ")}`);

  const jumps = bigJumps(all);
  if (jumps.length) console.warn(`  ${jumps.length} year-over-year jumps over 3× (usually a college's reporting error; kept as reported). First few:\n    ${jumps.slice(0, 8).join("\n    ")}`);

  if (CROSSCHECK) {
    const cc = await crossCheck(schools, histories);
    if (cc.problems.length) fail("history differs from the Urban Institute's copy of IPEDS (an era mapping is off?).", cc.problems);
    if (!cc.checked) console.warn(`  WARNING: the Urban Institute cross-check didn't run (${cc.unreachable} requests unreachable), so era mappings weren't spot-checked.`);
    else console.log(`  Urban Institute cross-check: ${cc.checked} values match${cc.unreachable ? ` (${cc.unreachable} requests unreachable)` : ""}.`);
  }

  /* ---- Metadata ---- */
  const files = {} as Record<HistoryFamily, HistoryFile[]>;
  const provisional: HistoryMeta["provisional"] = {};
  for (const fam of Object.keys(HISTORY_FAMILIES) as HistoryFamily[]) {
    files[fam] = fetched
      .filter((f) => f.family === fam)
      .sort((a, b) => a.year - b.year)
      .map((f) => ({
        year: f.year,
        file: f.supplement ? `${f.table.name} + ${f.supplement.name}` : f.table.name,
        url: f.table.url,
        revised: f.table.revised,
      }));
    if ("api" in HISTORY_FAMILIES[fam]) {
      // Scorecard fields: one entry per year any college reported, cited as the Scorecard data page.
      const keys = { "scorecard-enrollment": ["undergrads", "men_share", "part_time_share"], "scorecard-completion": ["grad_rate"], "scorecard-debt": ["median_debt"], "scorecard-loans": ["federal_loan_rate"] }[fam as string] as SeriesKey[];
      const years = [...new Set(all.flatMap((h) => keys.flatMap((k) => { const sr = h.series[k]; return sr ? sr.values.flatMap((v, i) => (v === null ? [] : [sr.start + i])) : []; })))].sort((a, b) => a - b);
      files[fam] = years.map((year) => ({ year, file: `College Scorecard API (${keys.join(", ")})`, url: meta.sources.scorecard?.url ?? "https://collegescorecard.ed.gov/data/", revised: false }));
      continue;
    }
    const list = files[fam];
    const [prev, last] = [list[list.length - 2], list[list.length - 1]];
    // Provisional: this family's files get revised a year later, and the newest hasn't been yet.
    if (prev?.revised && !last.revised) provisional[fam] = last.year;
  }
  const targets = IDS ?? [...universe];
  const hmeta: HistoryMeta = {
    built: new Date().toISOString().slice(0, 10),
    latest,
    files,
    provisional,
    schools: targets.length,
    universe: universe.size,
  };
  const metaProblems = validateHistoryMeta(hmeta, meta);
  if (metaProblems.length) fail("history metadata is inconsistent.", metaProblems);

  /* ---- Write ---- */
  mkdirSync(SHARDS, { recursive: true });
  if (!IDS) {
    // A full build replaces every shard, so colleges that left the dataset don't linger.
    for (const f of readdirSync(SHARDS)) if (f.endsWith(".json") && !universe.has(f.replace(/\.json$/, ""))) rmSync(join(SHARDS, f));
  }
  let written = 0;
  for (const id of targets) {
    const h = histories.get(id)!;
    if (!Object.keys(h.series).length) {
      if (existsSync(join(SHARDS, `${id}.json`))) rmSync(join(SHARDS, `${id}.json`));
      continue;
    }
    writeFileSync(join(SHARDS, `${id}.json`), formatShard(h));
    written++;
  }
  hmeta.schools = readdirSync(SHARDS).filter((f) => f.endsWith(".json")).length;
  writeJson(join(OUT, "national.json"), buildNational(all, window, cpi));
  writeJson(join(OUT, "facts.json"), buildFacts(all, window, cpi));
  writeJson(join(OUT, "cpi.json"), cpi);
  writeJson(join(OUT, "meta.json"), hmeta);

  // school.trends in data/schools.json: every college (like national.json), even when --ids limits the shards.
  let withTrends = 0;
  for (const s of schools) {
    const t = trendSummary(histories.get(s.unit_id)!, cpi, hmeta);
    if (Object.keys(t).length) {
      s.trends = t;
      withTrends++;
    } else delete s.trends;
  }
  const lineageProblems = validateLineage(schools, meta);
  if (lineageProblems.length) fail("trends summary fails the lineage check (register it in lib/fields.ts).", lineageProblems);
  // Same layout as sync-data: one college per line.
  writeFileSync(join(DATA, "schools.json"), `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);

  const count = (fam: HistoryFamily) => `${files[fam][0].year}–${files[fam][files[fam].length - 1].year}`;
  console.log(`\nWrote ${written} college histories to data/history/schools/ (${hmeta.schools} in the folder), plus national, facts, cpi, meta.`);
  console.log(`  10-year summaries (school.trends) in data/schools.json: ${withTrends} colleges.`);
  console.log(`  Admissions: IC ${count("ic-admissions")}, ADM ${count("adm")} · Prices ${count("prices")} · Aid ${count("sfa")}`);
  console.log(`  Scorecard: undergrads ${count("scorecard-enrollment")} · graduation (entering class) ${count("scorecard-completion")} · debt ${count("scorecard-debt")}`);
  console.log(`  Latest: fall ${latest.fall}, ${latest.academic}–${String(latest.academic + 1).slice(2)}. Provisional: ${Object.entries(provisional).map(([f, y]) => `${f} ${y}`).join(", ") || "none"}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
