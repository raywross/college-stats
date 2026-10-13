/**
 * The selectivity build step (specs/chances/selectivity-index.md "Data and lineage"): reads every college's published
 * figures, standardizes each input over the colleges that report it, computes the score per pool (lib/selectivity.ts), and
 * writes the tiers to `school.selectivity` with hysteresis against the last published tiers. The index itself goes to
 * data/selectivity-index.json, which only this step and its check read. Run by `npm run build-selectivity` and at the
 * end of `npm run sync-data` (after derived fields and trends); the check runs in `npm run verify`
 * (`npm run check:selectivity`). Pure apart from the file helpers at the bottom.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DatasetMeta, School, SchoolSelectivity } from "../../lib/types";
import type { SelectivityPool, SelectivityTier } from "../../lib/chances/types.ts";
import { SELECTIVITY_TIERS } from "../../lib/chances/levels.ts";
import { lineageFor } from "../../lib/lineage.ts";
import { ELITE_COUNT_RANGE, ELITE_INDEX, TOP_BAND_SCORE, collegeIndex, rawInputs, scales, selectivityScoreExact, selectivityTier, topBand } from "../../lib/selectivity.ts";

/** The pools a college can have an index for, in the order the file and `school.selectivity` list them. */
const POOLS = ["all", "in_state", "out_of_state"] as const satisfies readonly SelectivityPool[];
type Pool = (typeof POOLS)[number];

/** One college's line in data/selectivity-index.json. */
export interface CollegeIndexEntry {
  all: number;
  /** Place among every rated college by the unrounded score for all applicants (1 = hardest to get into). */
  rank: number;
  in_state?: number;
  out_of_state?: number;
  /** The tiers this build moved, by pool, with the tier they moved from (the hysteresis check reads it). */
  changed_from?: Partial<Record<Pool, SelectivityTier>>;
}

/** data/selectivity-index.json: never in public/, the search index, the data API, exports, or client code. */
export interface SelectivityIndexFile {
  /** The day the indexes last changed (a rebuild that changes nothing keeps it). */
  generated: string;
  elite_index: number;
  /** Colleges Elite for at least one pool. */
  elite_count: number;
  /** Colleges by their tier for all applicants. */
  counts: Record<SelectivityTier, number>;
  colleges: Record<string, CollegeIndexEntry>;
}

const SEL_KEY = "selectivity";

/** Top-level keys other pipelines place themselves (lib/identity.ts LATER_KEYS); `selectivity` goes before all of them. */
const LATER_KEYS = ["directories", "lineage", "trends", "reported"];

/**
 * The school with `selectivity` set (or removed), as a new object. Key order is fixed so the pipelines that re-merge
 * data/schools.json and compare bytes keep working in any order: `selectivity` goes right before the first of
 * `directories`, `lineage`, `trends`, and `reported` (else last). The directories merge re-inserts `directories` and
 * `lineage` before `trends`/`reported` or at the end, merge-reported re-appends `reported`, and identity adds its new
 * keys before the same anchors, so none of them moves `selectivity`, and rebuilding it moves nothing else.
 */
export function placeSelectivity(school: School, sel: SchoolSelectivity | undefined): School {
  const entries = Object.entries(school).filter(([k]) => k !== SEL_KEY);
  if (sel) {
    const at = entries.findIndex(([k]) => LATER_KEYS.includes(k));
    entries.splice(at < 0 ? entries.length : at, 0, [SEL_KEY, sel]);
  }
  return Object.fromEntries(entries) as unknown as School;
}

const previousTier = (prev: SchoolSelectivity | undefined, pool: Pool): SelectivityTier | null =>
  (pool === "all" ? prev?.tier : prev?.[pool]) ?? null;

export interface BuildResult {
  schools: School[];
  file: SelectivityIndexFile;
  /** Colleges whose stored tiers changed at this build. */
  changed: number;
}

/**
 * Builds every college's tiers and the index file. `previous` holds the last published tiers by unit id (the committed
 * data/schools.json); `prior` is the last index file, whose `generated` date is kept when no index moved.
 */
export function buildSelectivity(
  schools: readonly School[],
  meta: DatasetMeta,
  opts: { previous?: ReadonlyMap<string, SchoolSelectivity | undefined>; prior?: SelectivityIndexFile | null; today?: string } = {}
): BuildResult {
  const raws = schools.map(rawInputs);
  const sc = scales(raws);
  // Ranks by the unrounded score (ties broken by unit id), so every rated college has its own place.
  const exact = raws.map((r) => selectivityScoreExact(r, sc, "all"));
  const order = schools.map((_, i) => i).filter((i) => exact[i] !== null).sort((a, b) => exact[b]! - exact[a]! || schools[a].unit_id.localeCompare(schools[b].unit_id));
  const rankOf = new Map(order.map((i, r) => [i, r + 1]));
  const colleges: Record<string, CollegeIndexEntry> = {};
  const counts = Object.fromEntries(SELECTIVITY_TIERS.map((t) => [t, 0])) as Record<SelectivityTier, number>;
  let eliteCount = 0;
  let changed = 0;
  const out = schools.map((school, i) => {
    const raw = raws[i];
    const idx = collegeIndex(raw, sc);
    const before = opts.previous ? opts.previous.get(school.unit_id) : school.selectivity;
    if (idx.all === null) {
      if (before) changed++;
      return placeSelectivity(school, undefined);
    }
    const entry: CollegeIndexEntry = { all: idx.all, rank: rankOf.get(i)! };
    const sel: SchoolSelectivity = { tier: null };
    const moved: Partial<Record<Pool, SelectivityTier>> = {};
    for (const pool of POOLS) {
      const index = pool === "all" ? idx.all : idx[pool];
      if (index === undefined || index === null) continue;
      const prev = previousTier(before, pool);
      const tier = selectivityTier(index, prev)!;
      if (pool === "all") sel.tier = tier;
      else {
        entry[pool] = index;
        sel[pool] = tier;
      }
      if (prev && prev !== tier) moved[pool] = prev;
    }
    // Rule 8 (method/standing.md "Revision 3"): the top band of Ultra selective, a word beside the tier.
    const band = topBand(idx.all, sel.tier, before?.band);
    if (band) sel.band = band;
    const year = lineageFor("admissions.acceptance_rate", school, meta).year;
    if (year) sel.year = year;
    if (Object.keys(moved).length) entry.changed_from = moved;
    colleges[school.unit_id] = entry;
    counts[sel.tier!]++;
    if (sel.tier === "elite" || sel.in_state === "elite" || sel.out_of_state === "elite") eliteCount++;
    if (JSON.stringify(sel) !== JSON.stringify(before)) changed++;
    return placeSelectivity(school, sel);
  });
  const sameIndexes = !!opts.prior && JSON.stringify(stripChanges(opts.prior.colleges)) === JSON.stringify(stripChanges(colleges)) && opts.prior.elite_index === ELITE_INDEX;
  const file: SelectivityIndexFile = {
    generated: sameIndexes ? opts.prior!.generated : (opts.today ?? new Date().toLocaleDateString("en-CA")),
    elite_index: ELITE_INDEX,
    elite_count: eliteCount,
    counts,
    colleges,
  };
  return { schools: out, file, changed };
}

function stripChanges(colleges: Record<string, CollegeIndexEntry>): Record<string, Omit<CollegeIndexEntry, "changed_from">> {
  return Object.fromEntries(
    Object.entries(colleges).map(([id, e]) => {
      const rest = { ...e };
      delete rest.changed_from;
      return [id, rest];
    })
  );
}

/** One college per line, like data/schools.json, so a rebuild's diff shows the colleges that moved. */
export function formatIndexFile(file: SelectivityIndexFile): string {
  const head = JSON.stringify({ generated: file.generated, elite_index: file.elite_index, elite_count: file.elite_count, counts: file.counts });
  const lines = Object.entries(file.colleges).map(([id, e]) => `    ${JSON.stringify(id)}: ${JSON.stringify(e)}`);
  return `${head.slice(0, -1)},\n  "colleges": {\n${lines.join(",\n")}\n  }\n}\n`;
}

/* ------------------------------------------------------------------ */
/* The check (npm run check:selectivity, tests/selectivity.test.mts)   */
/* ------------------------------------------------------------------ */

/**
 * Problems with the committed tiers and index: the Elite count outside 25–50, an empty tier, a tier that moved without
 * crossing its cutoff by the hysteresis band (or holds an index outside its band), a stored tier without an index or
 * the other way round, and an index file that isn't a fresh build of data/schools.json (run `npm run build-selectivity`).
 */
export function selectivityProblems(schools: readonly School[], file: SelectivityIndexFile, meta: DatasetMeta): string[] {
  const problems: string[] = [];
  const [lo, hi] = ELITE_COUNT_RANGE;
  if (file.elite_index !== ELITE_INDEX) problems.push(`data/selectivity-index.json: elite_index ${file.elite_index} isn't ELITE_INDEX (${ELITE_INDEX}); run npm run build-selectivity`);
  const elite = schools.filter((s) => s.selectivity && (s.selectivity.tier === "elite" || s.selectivity.in_state === "elite" || s.selectivity.out_of_state === "elite")).length;
  if (elite < lo || elite > hi) problems.push(`Elite holds ${elite} colleges, outside ${lo}–${hi}: revisit ELITE_INDEX in lib/selectivity.ts deliberately`);
  if (elite !== file.elite_count) problems.push(`data/selectivity-index.json: elite_count ${file.elite_count}, but ${elite} colleges are Elite`);
  for (const t of SELECTIVITY_TIERS) if (!schools.some((s) => s.selectivity?.tier === t)) problems.push(`no college is ${t} for all applicants`);

  for (const s of schools) {
    const e = file.colleges[s.unit_id];
    const where = `${s.name} (${s.unit_id})`;
    if (!e) {
      if (s.selectivity) problems.push(`${where}: has a tier but no index`);
      continue;
    }
    if (!s.selectivity) {
      problems.push(`${where}: has an index but no tier`);
      continue;
    }
    for (const pool of POOLS) {
      const index = pool === "all" ? e.all : e[pool];
      const tier = pool === "all" ? s.selectivity.tier : s.selectivity[pool];
      if (index === undefined && tier === undefined) continue;
      if (index === undefined || tier === undefined || tier === null) {
        problems.push(`${where}: ${pool} has ${index === undefined ? "a tier but no index" : "an index but no tier"}`);
        continue;
      }
      // A moved tier must be what the rule gives from where it was; an unmoved one must still be inside its band.
      const from = e.changed_from?.[pool] ?? tier;
      const want = selectivityTier(index, from);
      if (want !== tier) problems.push(`${where}: ${pool} is ${tier}${e.changed_from?.[pool] ? ` (from ${from})` : ""}, but index ${index} gives ${want} with the hysteresis band`);
    }
    // The top band (rule 8): only Ultra selective colleges, entered at TOP_BAND_SCORE, left HYSTERESIS points below it.
    const band = s.selectivity.band ?? null;
    if (band !== null && band !== "top") problems.push(`${where}: band "${band}" isn't a band`);
    if (band === "top" && s.selectivity.tier !== "elite") problems.push(`${where}: in the top band but not Ultra selective`);
    if (topBand(e.all, s.selectivity.tier, band === "top" ? "top" : null) !== band) problems.push(`${where}: ${band ? "in" : "outside"} the top band, but index ${e.all} says otherwise (TOP_BAND_SCORE ${TOP_BAND_SCORE})`);
  }
  for (const id of Object.keys(file.colleges)) if (!schools.some((s) => s.unit_id === id)) problems.push(`data/selectivity-index.json: ${id} isn't in data/schools.json`);

  // Fresh: rebuilding from the committed tiers gives the same indexes and tiers.
  const fresh = buildSelectivity(schools, meta, { prior: file });
  const freshIdx = JSON.stringify(stripChanges(fresh.file.colleges));
  if (freshIdx !== JSON.stringify(stripChanges(file.colleges))) problems.push("data/selectivity-index.json isn't a fresh build of data/schools.json: run npm run build-selectivity");
  const stale = fresh.schools.filter((s, i) => JSON.stringify(s.selectivity) !== JSON.stringify(schools[i].selectivity)).map((s) => s.name);
  if (stale.length) problems.push(`${stale.length} colleges' tiers aren't a fresh build (${stale.slice(0, 5).join("; ")}): run npm run build-selectivity`);
  return problems;
}

/** Words that mark the index file's contents: its keys. Nothing a page, an API, or a bundle serves may carry them. */
export const INDEX_MARKERS = ["selectivity-index.json", "elite_index", "selectivity_index"] as const;

/** Source text without block comments and whole-line `//` comments (rough, and enough for the check). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every file under `dir` (recursively), relative to `root`. */
function filesUnder(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  walk(abs);
  return out;
}

/**
 * Where the index must never be: any file in public/ (served as is), and any app, component, or lib file other than the
 * method and its tests naming the index file or its keys (so no page, route, the search index, or an export reads it).
 */
export function leakProblems(root: string): string[] {
  const problems: string[] = [];
  for (const f of filesUnder(root, "public")) {
    if (!/\.(json|js|txt|html|csv|md)$/.test(f)) continue;
    const text = readFileSync(join(root, f), "utf8");
    for (const m of INDEX_MARKERS) if (text.includes(m)) problems.push(`${f}: names "${m}" (the selectivity index never ships in public/)`);
  }
  // In code, a marker inside a string literal or as a property is a read; a comment naming the file isn't.
  const code = (m: string) => new RegExp(`["'\`][^"'\`\n]*${m}[^"'\`\n]*["'\`]|\\.${m}\\b|\\b${m}\\s*:`);
  for (const dir of ["app", "components", "lib"]) {
    for (const f of filesUnder(root, dir)) {
      if (!/\.(ts|tsx|mts|json)$/.test(f)) continue;
      const text = stripComments(readFileSync(join(root, f), "utf8"));
      for (const m of INDEX_MARKERS) if (code(m).test(text)) problems.push(`${f}: reads "${m}" (only the selectivity build and its check read the index)`);
    }
  }
  return problems;
}

/** Reads the committed index file, or null before the first build. */
export function readIndexFile(root: string): SelectivityIndexFile | null {
  const p = join(root, "data", "selectivity-index.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SelectivityIndexFile) : null;
}
