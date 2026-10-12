/**
 * The AP Course Ledger adapter: matches data/high-schools/ledger/{XX}.json (written by `npm run sync-ap-ledger`;
 * ./ledger-fetch.mts) to the shards' rows, public and private, and fills `ap_ledger` (the AP courses College Board
 * authorizes the school to offer this year, as catalog keys). specs/product/high-school-data.md "AP Course Ledger".
 *
 * The Ledger has no NCES id, so schools are matched by name and place inside a state. A row and a Ledger school match
 * when their names agree after normalizing (abbreviations spelled out, "High School" and the like set aside, initials
 * joined) and they share a ZIP code or a city; a weaker name agreement needs the ZIP, or one name's words inside the
 * other's; a level word ("Junior High", "Middle") must agree. Anything with two plausible candidates is left
 * unmatched and listed in ledger/report.json for review, never guessed. Rows the Ledger doesn't list keep
 * `ap_ledger: null`, which the site reads as "not listed with College Board", not as "offers no AP courses".
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HighSchool, HsSourceInfo } from "../../../lib/high-school-types.ts";
import { LEDGER_URL, ledgerDir, type LedgerSchoolRecord, type LedgerStateFile } from "./ledger-fetch.mts";
import type { AdapterContext, AdapterInfo, AdapterResult, HighSchoolPatch } from "./types.mts";

export const info: AdapterInfo = {
  key: "ap-ledger",
  role: "enrichment",
  rowKind: "any",
  owns: ["ap_ledger"],
  sources: ["ap-ledger"],
  vintages: ["ap-ledger"],
};

export function ledgerSourceInfo(retrieved: string, year: string): HsSourceInfo {
  return {
    name: `AP Course Ledger, ${year} (the courses each school is authorized to offer as AP)`,
    publisher: "College Board",
    url: LEDGER_URL,
    retrieved,
  };
}

/* ------------------------------------------------------------------ */
/* Name matching                                                       */
/* ------------------------------------------------------------------ */

/** Abbreviations federal files and the Ledger use, spelled out before comparing. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  hs: "high school",
  h: "high",
  s: "school",
  sr: "senior",
  jr: "junior",
  sch: "school",
  schl: "school",
  acad: "academy",
  prep: "preparatory",
  st: "saint",
  ste: "sainte",
  mt: "mount",
  ctr: "center",
  cntr: "center",
  intl: "international",
  tech: "technical",
  technology: "technical",
  comm: "community",
  cmty: "community",
  co: "county",
  cty: "county",
  cnty: "county",
  twp: "township",
  elem: "elementary",
  jshs: "junior senior high school",
  jsr: "junior senior",
  "jr-sr": "junior senior",
  srhs: "senior high school",
  isd: "",
  cisd: "",
  usd: "",
  inc: "",
  ii: "2",
  iii: "3",
  iv: "4",
};

/** Words that don't tell two schools apart. */
const STOP = new Set(["high", "school", "schools", "senior", "the", "of", "and", "at", "for", "a", "an", "campus", "program", "center", "centre", "area"]);

/**
 * Words that name a school's level. "Bryant Junior High School" and "Bryant High School" share a ZIP and every other
 * word; the level word keeps them apart. "Junior Senior High School" is a high school: its "junior" doesn't count.
 */
const LEVEL = new Set(["junior", "middle", "intermediate", "elementary", "freshman", "primary"]);

/** Lower-cased words with abbreviations spelled out and punctuation gone: "Plano East Sr H S" → ["plano", "east", "senior", "high", "school"]. */
export function nameTokens(name: string): string[] {
  const raw = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const expanded: string[] = [];
  for (const t of raw) {
    const exp = ABBREVIATIONS[t];
    if (exp === undefined) expanded.push(t);
    else if (exp) expanded.push(...exp.split(" "));
  }
  // Initials written apart ("B F Darrell") and together ("BF Darrell") are the same name: join runs of single letters.
  const out: string[] = [];
  const initials: boolean[] = [];
  for (const t of expanded) {
    const last = out.length - 1;
    if (t.length === 1 && last >= 0 && initials[last]) out[last] += t;
    else {
      out.push(t);
      initials.push(t.length === 1);
    }
  }
  // A lone trailing letter is a compass point ("Half Hollow Hills High School E"), not an initial.
  const tail = out.length - 1;
  if (tail > 0 && !initials[tail - 1] && COMPASS[out[tail]]) out[tail] = COMPASS[out[tail]];
  return out;
}

const COMPASS: Readonly<Record<string, string>> = { e: "east", w: "west", n: "north" };

/** The distinguishing words of a name (stop and level words removed); the full tokens when nothing else is left. */
export function coreTokens(name: string): Set<string> {
  const tokens = nameTokens(name);
  const core = tokens.filter((t) => !STOP.has(t) && !LEVEL.has(t));
  return new Set(core.length ? core : tokens);
}

/**
 * The level words in a name ("junior", "middle"), sorted and joined; "" for a plain (senior) high school. A
 * "Junior Senior High" or a "Middle High" school is a high school too: those words don't count there.
 */
export function levelOf(name: string): string {
  const tokens = nameTokens(name);
  const levels = new Set(tokens.filter((t) => LEVEL.has(t)));
  if (levels.has("junior") && tokens.includes("senior")) levels.delete("junior");
  if (levels.has("middle") && tokens.includes("high")) levels.delete("middle");
  return [...levels].sort().join(" ");
}

/** Jaccard similarity of two names' distinguishing words, 0–1. */
export function nameScore(a: string, b: string): number {
  const sa = coreTokens(a);
  const sb = coreTokens(b);
  if (!sa.size || !sb.size) return 0;
  let both = 0;
  for (const t of sa) if (sb.has(t)) both++;
  return both / (sa.size + sb.size - both);
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));
const normCity = (city: string | null | undefined) => (city ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
};
const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((t) => !b.has(t)));

/** Words that say nothing about which school it is, even in a name that is otherwise its city's ("The School of Los Angeles"). */
const GENERIC = new Set(["school", "schools", "senior", "the", "of", "and", "at", "for", "a", "an", "campus", "program", "area"]);

/**
 * How alike two names are once the words they share with their cities are set aside: "Marymount High School Los
 * Angeles" has nothing in common with "Los Angeles Senior High School" but the city. When a name is nothing but its
 * city ("Los Angeles Senior High"), it matches only a name with the same words beyond the generic ones.
 */
function compareNames(row: NameInfo, ledger: NameInfo, cityTokens: Set<string>): NameComparison {
  const rd = minus(row.core, cityTokens);
  const ld = minus(ledger.core, cityTokens);
  if (!rd.size || !ld.size) {
    const rs = minus(row.tokens, GENERIC);
    const ls = minus(ledger.tokens, GENERIC);
    const exact = rs.size === ls.size && isSubset(rs, ls);
    return { score: exact ? 1 : 0, subset: false, rowWithin: false, exact };
  }
  const score = jaccard(rd, ld);
  const rowWithin = isSubset(rd, ld);
  return { score, subset: rowWithin || isSubset(ld, rd), rowWithin, exact: score >= 0.999 };
}

interface NameComparison {
  score: number;
  /** One name's distinguishing words are all in the other's. */
  subset: boolean;
  /** The row's distinguishing words are all in the Ledger's: "Taylor High School" within "James E Taylor High School". */
  rowWithin: boolean;
  exact: boolean;
}

interface NameInfo {
  tokens: Set<string>;
  core: Set<string>;
  level: string;
}

const nameInfo = (name: string): NameInfo => ({ tokens: new Set(nameTokens(name)), core: coreTokens(name), level: levelOf(name) });

export type LedgerMatchRule = "exact" | "zip" | "subset" | "city" | "subset-city" | "within";

export interface LedgerMatch {
  id: string;
  ai: string;
  score: number;
  rule: LedgerMatchRule;
}

export interface LedgerMatchResult {
  matches: LedgerMatch[];
  /** Row ids with no acceptable candidate. */
  unmatchedRows: string[];
  /** Row ids with two candidates that can't be told apart, or whose candidate another row claimed as strongly. */
  ambiguousRows: { id: string; candidates: string[] }[];
  /** Ledger AI codes no row matched (schools the directories lack: many private schools, programs, closed schools). */
  unusedLedger: string[];
}

/**
 * The rule a candidate satisfies, or null. A different level word (junior high against high school) never matches.
 * "within": the directories often drop a namesake's first name ("Taylor High School" for "James E Taylor High
 * School"); the row's words inside the Ledger's, in one ZIP, match when nothing else in the ZIP could. The other
 * direction (the Ledger's "Sultan High School" inside the row's "Sultan Virtual Academy") is a different program.
 */
function ruleFor(cmp: NameComparison, sameZip: boolean, sameCity: boolean, sameLevel: boolean): LedgerMatchRule | null {
  if (!sameLevel || (!sameZip && !sameCity)) return null;
  if (cmp.exact) return "exact";
  if (sameZip && cmp.score >= 0.75) return "zip";
  if (sameZip && cmp.score >= 0.5 && cmp.subset) return "subset";
  if (sameCity && cmp.score >= 0.75) return "city";
  if (sameCity && cmp.score >= 0.6 && cmp.subset) return "subset-city";
  if (sameZip && cmp.score >= 0.25 && cmp.rowWithin) return "within";
  return null;
}

const RULE_RANK: Record<LedgerMatchRule, number> = { exact: 6, zip: 5, subset: 4, city: 3, "subset-city": 2, within: 1 };

/**
 * Match one state's rows to its Ledger schools. Candidates share the row's ZIP or city; the best by rule, then
 * score, then the longer course list wins (the Ledger keeps an old, empty record for some schools beside the live
 * one); a tie between two candidates, or two rows claiming one Ledger school equally, is ambiguous and left out.
 */
export function matchLedgerSchools(rows: readonly HighSchool[], ledger: readonly LedgerSchoolRecord[]): LedgerMatchResult {
  const byZip = new Map<string, LedgerSchoolRecord[]>();
  const byCity = new Map<string, LedgerSchoolRecord[]>();
  const ledgerInfo = new Map<string, NameInfo>();
  const ledgerCourses = new Map<string, number>();
  for (const s of ledger) {
    ledgerInfo.set(s.ai, nameInfo(s.name));
    ledgerCourses.set(s.ai, s.courses.length + s.other.length);
    if (s.zip) (byZip.get(s.zip) ?? byZip.set(s.zip, []).get(s.zip)!).push(s);
    const c = normCity(s.city);
    if (c) (byCity.get(c) ?? byCity.set(c, []).get(c)!).push(s);
  }

  /** `whole` is how alike the full names are (stop words included), the tie-breaker between equal claims. */
  type Cand = { ai: string; score: number; rule: LedgerMatchRule; whole: number };
  const same = (a: Cand, b: Cand) => a.rule === b.rule && Math.abs(a.score - b.score) < 1e-9;
  const chosen = new Map<string, Cand>();
  const rowInfo = new Map<string, NameInfo>();
  const unmatchedRows: string[] = [];
  const ambiguousRows: { id: string; candidates: string[] }[] = [];

  for (const row of rows) {
    const info = nameInfo(row.name);
    rowInfo.set(row.id, info);
    const seen = new Set<string>();
    const cands: Cand[] = [];
    const zip = row.zip;
    const city = normCity(row.city);
    for (const s of [...(zip ? byZip.get(zip) ?? [] : []), ...(city ? byCity.get(city) ?? [] : [])]) {
      if (seen.has(s.ai)) continue;
      seen.add(s.ai);
      const li = ledgerInfo.get(s.ai)!;
      const cityTokens = new Set([...nameTokens(row.city ?? ""), ...nameTokens(s.city ?? "")]);
      const cmp = compareNames(info, li, cityTokens);
      const rule = ruleFor(cmp, !!zip && s.zip === zip, !!city && normCity(s.city) === city, li.level === info.level);
      if (rule) cands.push({ ai: s.ai, score: cmp.score, rule, whole: jaccard(info.tokens, li.tokens) });
    }
    if (!cands.length) {
      unmatchedRows.push(row.id);
      continue;
    }
    cands.sort((a, b) => RULE_RANK[b.rule] - RULE_RANK[a.rule] || b.score - a.score || ledgerCourses.get(b.ai)! - ledgerCourses.get(a.ai)! || b.whole - a.whole);
    const [best, second] = cands;
    if (second && same(best, second) && ledgerCourses.get(best.ai) === ledgerCourses.get(second.ai) && Math.abs(best.whole - second.whole) < 1e-9) {
      ambiguousRows.push({ id: row.id, candidates: cands.filter((c) => same(c, best)).map((c) => c.ai) });
      continue;
    }
    // The weak rule needs the ZIP to offer nothing else at all.
    if (best.rule === "within" && second) {
      ambiguousRows.push({ id: row.id, candidates: cands.map((c) => c.ai) });
      continue;
    }
    chosen.set(row.id, best);
  }

  // One Ledger school per row: the stronger claim wins (rule, score, then the whole name). Equal claims from rows
  // that are the same school listed twice (same words and level) all take it; equal claims from different schools
  // are ambiguous.
  const claims = new Map<string, { id: string; cand: Cand }[]>();
  for (const [id, cand] of chosen) (claims.get(cand.ai) ?? claims.set(cand.ai, []).get(cand.ai)!).push({ id, cand });
  const matches: LedgerMatch[] = [];
  const used = new Set<string>();
  for (const [ai, list] of claims) {
    list.sort((a, b) => RULE_RANK[b.cand.rule] - RULE_RANK[a.cand.rule] || b.cand.score - a.cand.score || b.cand.whole - a.cand.whole);
    const top = list[0];
    const tied = list.filter(({ cand }) => same(cand, top.cand) && Math.abs(cand.whole - top.cand.whole) < 1e-9);
    const sameSchool = (id: string) => {
      const a = rowInfo.get(id)!;
      const b = rowInfo.get(top.id)!;
      return a.level === b.level && a.core.size === b.core.size && isSubset(a.core, b.core);
    };
    if (tied.length > 1 && !tied.every(({ id }) => sameSchool(id))) {
      for (const { id } of list) ambiguousRows.push({ id, candidates: [ai] });
      continue;
    }
    for (const { id, cand } of tied) matches.push({ id, ai, score: Math.round(cand.score * 1000) / 1000, rule: cand.rule });
    used.add(ai);
    for (const { id } of list.slice(tied.length)) unmatchedRows.push(id);
  }
  matches.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    matches,
    unmatchedRows: unmatchedRows.sort(),
    ambiguousRows: ambiguousRows.sort((a, b) => (a.id < b.id ? -1 : 1)),
    unusedLedger: ledger.filter((s) => !used.has(s.ai)).map((s) => s.ai).sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export function readLedgerFiles(outDir: string): LedgerStateFile[] {
  const dir = ledgerDir(outDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[A-Z]{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as LedgerStateFile);
}

export function ledgerPatch(id: string, year: string, s: LedgerSchoolRecord): HighSchoolPatch {
  return { id, values: { ap_ledger: { year, ledger_id: s.ai, ledger_name: s.name, courses: [...s.courses].sort(), other: [...s.other].sort() } } };
}

export interface LedgerReport {
  generated: string;
  year: string;
  states: number;
  ledger_schools: number;
  rows: number;
  matched: number;
  by_rule: Record<LedgerMatchRule, number>;
  unmatched_rows: number;
  ambiguous_rows: number;
  unused_ledger: number;
  /** Ledger schools no row matched: review candidates for schools the directories call something else. */
  unused: { ai: string; name: string; city: string | null; state: string; zip: string | null; courses: number }[];
  ambiguous: { id: string; name: string; city: string | null; state: string; candidates: { ai: string; name: string; city: string | null }[] }[];
}

export async function load(ctx: AdapterContext): Promise<AdapterResult> {
  const files = readLedgerFiles(ctx.outDir);
  if (!files.length) {
    return { sources: {}, vintages: {}, notes: ["ap-ledger: no data/high-schools/ledger/{XX}.json files; run npm run sync-ap-ledger first (nothing changed)"] };
  }
  const years = [...new Set(files.map((f) => f.year))];
  if (years.length > 1) ctx.warn(`ap-ledger: the state files cover different years (${years.join(", ")}); the newest is cited`);
  const year = files.map((f) => f.year).sort().at(-1)!;
  const retrieved = files.map((f) => f.retrieved).sort().at(-1)!;
  const incomplete = files.filter((f) => !f.complete).map((f) => f.state);
  if (incomplete.length) ctx.warn(`ap-ledger: ${incomplete.join(", ")} not completely fetched; schools still missing stay unmatched`);

  const rowsByState = new Map<string, HighSchool[]>();
  for (const r of ctx.existing.values()) (rowsByState.get(r.state) ?? rowsByState.set(r.state, []).get(r.state)!).push(r);

  const patches: HighSchoolPatch[] = [];
  const byRule: Record<LedgerMatchRule, number> = { exact: 0, zip: 0, subset: 0, city: 0, "subset-city": 0, within: 0 };
  const report: LedgerReport = {
    generated: ctx.today,
    year,
    states: files.length,
    ledger_schools: 0,
    rows: 0,
    matched: 0,
    by_rule: byRule,
    unmatched_rows: 0,
    ambiguous_rows: 0,
    unused_ledger: 0,
    unused: [],
    ambiguous: [],
  };
  for (const file of files) {
    const rows = rowsByState.get(file.state) ?? [];
    const byAi = new Map(file.schools.map((s) => [s.ai, s]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const result = matchLedgerSchools(rows, file.schools);
    report.ledger_schools += file.schools.length;
    report.rows += rows.length;
    for (const m of result.matches) {
      patches.push(ledgerPatch(m.id, file.year === year ? file.year : year, byAi.get(m.ai)!));
      byRule[m.rule]++;
    }
    report.matched += result.matches.length;
    report.unmatched_rows += result.unmatchedRows.length;
    report.ambiguous_rows += result.ambiguousRows.length;
    report.unused_ledger += result.unusedLedger.length;
    for (const ai of result.unusedLedger) {
      const s = byAi.get(ai)!;
      report.unused.push({ ai, name: s.name, city: s.city, state: file.state, zip: s.zip, courses: s.courses.length + s.other.length });
    }
    for (const a of result.ambiguousRows) {
      const r = byId.get(a.id)!;
      report.ambiguous.push({ id: a.id, name: r.name, city: r.city, state: file.state, candidates: a.candidates.map((ai) => ({ ai, name: byAi.get(ai)!.name, city: byAi.get(ai)!.city })) });
    }
  }
  writeFileSync(join(ledgerDir(ctx.outDir), "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const withCourses = patches.filter((p) => (p.values.ap_ledger?.courses.length ?? 0) + (p.values.ap_ledger?.other.length ?? 0) > 0).length;
  return {
    patches,
    sources: { "ap-ledger": ledgerSourceInfo(retrieved, year) },
    vintages: { "ap-ledger": year },
    notes: [
      `ap-ledger ${year}: ${files.length} states, ${report.ledger_schools} Ledger schools; ${report.matched} of ${report.rows} rows matched (exact ${byRule.exact}, zip ${byRule.zip}, subset ${byRule.subset}, city ${byRule.city}, subset-city ${byRule["subset-city"]}, within ${byRule.within});${withCourses} with at least one AP course; ${report.unmatched_rows} rows unmatched, ${report.ambiguous_rows} ambiguous, ${report.unused_ledger} Ledger schools unused (ledger/report.json)`,
    ],
  };
}
