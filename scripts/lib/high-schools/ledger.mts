/**
 * The AP Course Ledger adapter: matches data/high-schools/ledger/{XX}.json (written by `npm run sync-ap-ledger`;
 * ./ledger-fetch.mts) to the shards' rows, public and private, and fills `ap_ledger` (the AP courses College Board
 * authorizes the school to offer this year, as catalog keys). specs/product/high-school-data.md "AP Course Ledger".
 *
 * The Ledger has no NCES id, so schools are matched by name and place inside a state. A row and a Ledger school match
 * when their names agree after normalizing (abbreviations spelled out, "High School" and the like set aside) and they
 * share a ZIP code or a city; a weaker name agreement needs the ZIP. Anything with two plausible candidates is left
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
const STOP = new Set(["high", "school", "schools", "senior", "junior", "the", "of", "and", "at", "for", "a", "an", "campus", "program", "center", "centre"]);

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
  return out;
}

/** The distinguishing words of a name (stop words removed); the full tokens when nothing else is left. */
export function coreTokens(name: string): Set<string> {
  const tokens = nameTokens(name);
  const core = tokens.filter((t) => !STOP.has(t));
  return new Set(core.length ? core : tokens);
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

export type LedgerMatchRule = "exact" | "zip" | "subset" | "city";

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

/** The rule a candidate satisfies, or null. */
function ruleFor(score: number, sameZip: boolean, sameCity: boolean, rowCore: Set<string>, ledgerCore: Set<string>): LedgerMatchRule | null {
  if (!sameZip && !sameCity) return null;
  if (score >= 0.999) return "exact";
  if (sameZip && score >= 0.75) return "zip";
  if (sameZip && score >= 0.5 && (isSubset(rowCore, ledgerCore) || isSubset(ledgerCore, rowCore))) return "subset";
  if (sameCity && score >= 0.75) return "city";
  return null;
}

const RULE_RANK: Record<LedgerMatchRule, number> = { exact: 4, zip: 3, subset: 2, city: 1 };

/**
 * Match one state's rows to its Ledger schools. Candidates share the row's ZIP or city; the best by rule then score
 * wins; a tie between two candidates, or two rows claiming one Ledger school equally, is ambiguous and left out.
 */
export function matchLedgerSchools(rows: readonly HighSchool[], ledger: readonly LedgerSchoolRecord[]): LedgerMatchResult {
  const byZip = new Map<string, LedgerSchoolRecord[]>();
  const byCity = new Map<string, LedgerSchoolRecord[]>();
  const ledgerCore = new Map<string, Set<string>>();
  for (const s of ledger) {
    ledgerCore.set(s.ai, coreTokens(s.name));
    if (s.zip) (byZip.get(s.zip) ?? byZip.set(s.zip, []).get(s.zip)!).push(s);
    const c = normCity(s.city);
    if (c) (byCity.get(c) ?? byCity.set(c, []).get(c)!).push(s);
  }

  type Cand = { ai: string; score: number; rule: LedgerMatchRule };
  const chosen = new Map<string, Cand>();
  const unmatchedRows: string[] = [];
  const ambiguousRows: { id: string; candidates: string[] }[] = [];

  for (const row of rows) {
    const rowCore = coreTokens(row.name);
    const seen = new Set<string>();
    const cands: Cand[] = [];
    const zip = row.zip;
    const city = normCity(row.city);
    for (const s of [...(zip ? byZip.get(zip) ?? [] : []), ...(city ? byCity.get(city) ?? [] : [])]) {
      if (seen.has(s.ai)) continue;
      seen.add(s.ai);
      const score = nameScore(row.name, s.name);
      const rule = ruleFor(score, !!zip && s.zip === zip, !!city && normCity(s.city) === city, rowCore, ledgerCore.get(s.ai)!);
      if (rule) cands.push({ ai: s.ai, score, rule });
    }
    if (!cands.length) {
      unmatchedRows.push(row.id);
      continue;
    }
    cands.sort((a, b) => RULE_RANK[b.rule] - RULE_RANK[a.rule] || b.score - a.score);
    const [best, second] = cands;
    if (second && second.rule === best.rule && Math.abs(second.score - best.score) < 1e-9) {
      ambiguousRows.push({ id: row.id, candidates: cands.filter((c) => c.rule === best.rule && Math.abs(c.score - best.score) < 1e-9).map((c) => c.ai) });
      continue;
    }
    chosen.set(row.id, best);
  }

  // One Ledger school per row: the stronger claim wins; equal claims are ambiguous.
  const claims = new Map<string, { id: string; cand: Cand }[]>();
  for (const [id, cand] of chosen) (claims.get(cand.ai) ?? claims.set(cand.ai, []).get(cand.ai)!).push({ id, cand });
  const matches: LedgerMatch[] = [];
  const used = new Set<string>();
  for (const [ai, list] of claims) {
    list.sort((a, b) => RULE_RANK[b.cand.rule] - RULE_RANK[a.cand.rule] || b.cand.score - a.cand.score);
    const [top, next] = list;
    if (next && next.cand.rule === top.cand.rule && Math.abs(next.cand.score - top.cand.score) < 1e-9) {
      for (const { id } of list) ambiguousRows.push({ id, candidates: [ai] });
      continue;
    }
    matches.push({ id: top.id, ai, score: Math.round(top.cand.score * 1000) / 1000, rule: top.cand.rule });
    used.add(ai);
    for (const { id } of list.slice(1)) unmatchedRows.push(id);
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
  const byRule: Record<LedgerMatchRule, number> = { exact: 0, zip: 0, subset: 0, city: 0 };
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
      `ap-ledger ${year}: ${files.length} states, ${report.ledger_schools} Ledger schools; ${report.matched} of ${report.rows} rows matched (exact ${byRule.exact}, zip ${byRule.zip}, subset ${byRule.subset}, city ${byRule.city}); ${withCourses} with at least one AP course; ${report.unmatched_rows} rows unmatched, ${report.ambiguous_rows} ambiguous, ${report.unused_ledger} Ledger schools unused (ledger/report.json)`,
    ],
  };
}
