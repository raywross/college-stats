/**
 * Majors: degrees awarded by field (specs/data-expansion/majors.md), from IPEDS Completions `C{Y}_A`. How the file
 * becomes the snapshot (`academics.bachelors_awarded`, `academics.majors_top`, `academics.bachelors_by_family`), the
 * detail table (`detail.majors`), and history (one share series per 2-digit family). Pure and client-safe (no CIP
 * table: titles are passed in or resolved server-side with lib/cip.ts), so sync-data, sync-history, tests, and
 * components share it.
 *
 * C{Y}_A has one row per college × CIP code × award level × first/second major. The fetch keeps bachelor's rows
 * (`AWLEVEL` 5, parsed as a number: C2020_A writes "05", C2025_A "5") and sums `CTOTALT` into one row per college with a
 * column per program and major, `{cip}|{1 or 2}` (scripts/lib/ipeds.mts `sum`), CIP codes already normalized
 * ("11.0701"). The institution total (`CIPCODE` 99) is kept as `99|1` for the check, never as a field.
 */
import type { MajorShare, School } from "./types";

type Row = Record<string, string> | undefined;

/** C{Y}_A's bachelor's award level. */
export const AWLEVEL_BACHELORS = 5;
/** Columns the reader needs (the header check). */
export const C_COLUMNS = ["CIPCODE", "AWLEVEL", "MAJORNUM", "CTOTALT"] as const;
/** Programs in the snapshot's top list. */
export const MAJORS_TOP_N = 5;
/** Below this many graduates in a field, a share swings too much to call it growing (majors.md: 25+). */
export const GROWTH_MIN_GRADUATES = 25;
/** A share gain smaller than this (points) isn't worth a "fastest-growing" line. */
export const GROWTH_MIN_POINTS = 0.02;

/** The summed column for one program and major (1 = first major, 2 = second major). */
export const majorColumn = (cip: string, major: 1 | 2): string => `${cip}|${major}`;
export const TOTAL_COLUMN = majorColumn("99", 1);

/** One program's bachelor's degrees: first majors and second majors, counted separately. */
export interface Program {
  cip: string;
  first: number;
  second: number;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

function count(v: string | undefined): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Every program with at least one bachelor's degree (first or second major), most first-major degrees first; ties by
 * second majors, then code. Null when the college has no row in the file (not reported, never zeros).
 */
export function programsFrom(row: Row): Program[] | null {
  if (!row) return null;
  const byCip = new Map<string, Program>();
  for (const [k, v] of Object.entries(row)) {
    const m = /^(\d{2}\.\d{4})\|([12])$/.exec(k);
    if (!m) continue;
    const p = byCip.get(m[1]) ?? byCip.set(m[1], { cip: m[1], first: 0, second: 0 }).get(m[1])!;
    if (m[2] === "1") p.first += count(v);
    else p.second += count(v);
  }
  return [...byCip.values()].filter((p) => p.first + p.second > 0).sort(compareProgram);
}

export function compareProgram(a: Program, b: Program): number {
  return b.first - a.first || b.second - a.second || a.cip.localeCompare(b.cip);
}

/** IPEDS's own institution total for first-major bachelor's (the `99` row), or null without one. */
export function totalRowFrom(row: Row): number | null {
  const v = row?.[TOTAL_COLUMN];
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * First-major bachelor's degrees by 2-digit family (only families with any), by code. Don't rely on key order (JS puts
 * "11" before "05"); familyShares() sorts by size.
 */
export function familyCounts(programs: readonly Program[]): Record<string, number> {
  const out = new Map<string, number>();
  for (const p of programs) if (p.first > 0) out.set(p.cip.slice(0, 2), (out.get(p.cip.slice(0, 2)) ?? 0) + p.first);
  return Object.fromEntries([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

export interface MajorsSnapshot {
  bachelors_awarded: number | null;
  majors_top: MajorShare[] | null;
  bachelors_by_family: Record<string, number> | null;
}

/**
 * The snapshot fields from a college's programs. `bachelors_awarded` is the sum of first-major bachelor's (it equals
 * IPEDS's 99 row; sync-data checks). A college that awarded none keeps 0 there and null shares.
 */
export function majorsSnapshot(programs: readonly Program[] | null, title: (cip: string) => string | null): MajorsSnapshot {
  if (!programs) return { bachelors_awarded: null, majors_top: null, bachelors_by_family: null };
  const total = programs.reduce((a, p) => a + p.first, 0);
  if (total <= 0) return { bachelors_awarded: 0, majors_top: null, bachelors_by_family: null };
  const majors_top = programs
    .filter((p) => p.first > 0)
    .slice(0, MAJORS_TOP_N)
    .map((p) => {
      const t = title(p.cip);
      if (!t) throw new Error(`CIP ${p.cip} has no CIP 2020 title (re-run npm run build-cip, or NCES moved to a new CIP edition)`);
      return { cip: p.cip, title: t, share: round4(p.first / total) };
    });
  return { bachelors_awarded: total, majors_top, bachelors_by_family: familyCounts(programs) };
}

/** Detail rows: `{ cip: [first majors, second majors] }`, in programsFrom's order (one object key per program). */
export type MajorRows = Record<string, [number, number]>;

export function majorRowsFrom(programs: readonly Program[]): MajorRows {
  return Object.fromEntries([...programs].sort(compareProgram).map((p) => [p.cip, [p.first, p.second]]));
}

export function programsFromRows(rows: MajorRows | undefined | null): Program[] {
  return rows ? Object.entries(rows).map(([cip, [first, second]]) => ({ cip, first, second })) : [];
}

/**
 * History reads C{Y}_A summed by family instead of by program (smaller: ~15 columns per college a year): `F|{family}`
 * holds the family's first-major bachelor's (scripts/lib/majors-sync.mts familyKey).
 */
export const familyColumn = (family: string): string => `F|${family}`;

/** A family-summed row's first-major bachelor's by family (only families with any). */
export function familiesFromRow(row: Row): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    const m = /^F\|(\d{2})$/.exec(k);
    if (m && count(v) > 0) out[m[1]] = count(v);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Families                                                            */
/* ------------------------------------------------------------------ */

/**
 * The 2-digit CIP families that award bachelor's degrees at site colleges (every family seen in C2014_A–C2025_A, plus
 * military science), with short names for charts and filters. History keeps one share series per family
 * (`major_{family}`); a family not listed here stops sync-history, so add it with a name when NCES's data has one.
 */
export const MAJOR_FAMILIES = {
  "01": "Agriculture",
  "03": "Natural resources",
  "04": "Architecture",
  "05": "Area, ethnic, and gender studies",
  "09": "Communication and journalism",
  "10": "Communications technologies",
  "11": "Computer science",
  "12": "Culinary and personal services",
  "13": "Education",
  "14": "Engineering",
  "15": "Engineering technologies",
  "16": "Foreign languages",
  "19": "Family and consumer sciences",
  "22": "Law and legal studies",
  "23": "English",
  "24": "Liberal arts and general studies",
  "25": "Library science",
  "26": "Biology",
  "27": "Math and statistics",
  "28": "Military science",
  "29": "Military technologies",
  "30": "Interdisciplinary studies",
  "31": "Parks, recreation, and kinesiology",
  "38": "Philosophy and religious studies",
  "39": "Theology",
  "40": "Physical sciences",
  "41": "Science technologies",
  "42": "Psychology",
  "43": "Criminal justice and protective services",
  "44": "Public administration and social work",
  "45": "Social sciences",
  "46": "Construction trades",
  "47": "Mechanic and repair technologies",
  "48": "Precision production",
  "49": "Transportation",
  "50": "Visual and performing arts",
  "51": "Health professions",
  "52": "Business",
  "54": "History",
} as const;

export type MajorFamily = keyof typeof MAJOR_FAMILIES;
// Sorted: JS lists integer-like keys ("11") before the others ("01"), so key order alone would put 01–09 last.
export const MAJOR_FAMILY_CODES = (Object.keys(MAJOR_FAMILIES) as MajorFamily[]).sort();

export function isMajorFamily(code: string): code is MajorFamily {
  return Object.prototype.hasOwnProperty.call(MAJOR_FAMILIES, code);
}

/** Short family name ("52" → "Business"); null for a code that isn't a bachelor's family. */
export function majorFamilyName(code: string | null | undefined): string | null {
  const fam = code?.slice(0, 2);
  return fam && isMajorFamily(fam) ? MAJOR_FAMILIES[fam] : null;
}

/** Families by first-major bachelor's, largest first, with each one's share of the total. */
export function familyShares(byFamily: Record<string, number> | null | undefined, total: number | null | undefined): { family: string; count: number; share: number }[] {
  if (!byFamily || !total) return [];
  return Object.entries(byFamily)
    .map(([family, count]) => ({ family, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/** Explore's "graduates in a field" thresholds (first-major bachelor's a year). */
export const FIELD_MIN_OPTIONS = [1, 25, 50, 100, 250] as const;

/**
 * First-major bachelor's in one family at a college: 0 when it awards bachelor's but none in that field, null when its
 * majors aren't reported (never 0 for missing data).
 */
export function graduatesInField(s: Pick<School, "academics">, family: string): number | null {
  const a = s.academics;
  if (a?.bachelors_awarded == null || !a.bachelors_by_family) return null;
  return a.bachelors_by_family[family] ?? 0;
}

/** Explore's field filter: at least `min` first-major bachelor's a year in the family (unreported colleges never match). */
export function matchesField(s: Pick<School, "academics">, family: string, min = 1): boolean {
  const n = graduatesInField(s, family);
  return n !== null && n >= Math.max(1, min);
}

/** Explore's field facet: colleges per family at each FIELD_MIN_OPTIONS threshold. */
export function fieldFacets(schools: readonly Pick<School, "academics">[]): Record<string, number[]> {
  const out: Record<string, number[]> = Object.fromEntries(MAJOR_FAMILY_CODES.map((f) => [f, FIELD_MIN_OPTIONS.map(() => 0)]));
  for (const s of schools) {
    for (const [f, n] of Object.entries(s.academics?.bachelors_by_family ?? {})) {
      if (!out[f]) continue;
      FIELD_MIN_OPTIONS.forEach((min, i) => {
        if (n >= min) out[f][i]++;
      });
    }
  }
  return out;
}

/**
 * A search matches the start of a word in the title or field name ("econ" finds Economics, not Secondary Education), or
 * the start of the CIP code ("51.38").
 */
export function matchesProgram(r: { cip: string; title: string; family: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (r.cip.startsWith(q)) return true;
  const words = (s: string | null) => (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const parts = q.split(/\s+/);
  const hay = [...words(r.title), ...words(r.family)];
  // Every word of the query must start some word of the title or field ("computer sci", "nursing").
  return parts.every((p) => hay.some((w) => w.startsWith(p.replace(/[^a-z0-9]/g, ""))));
}

/* ------------------------------------------------------------------ */
/* Growth (history)                                                    */
/* ------------------------------------------------------------------ */

/** Below this many bachelor's in either year, a field's share swings on a handful of graduates. */
export const GROWTH_MIN_TOTAL = 100;

type ShareSeries = { start: number; values: (number | null)[] } | undefined;
const at = (s: ShareSeries, year: number): number | null => (s && year >= s.start && year < s.start + s.values.length ? s.values[year - s.start] : null);

export interface FieldGrowth {
  family: MajorFamily;
  from: { year: number; share: number };
  to: { year: number; share: number };
  /** First-major bachelor's in the field in the newest year. */
  graduates: number;
}

/**
 * The profile's "fastest-growing field" (majors.md): the family whose share of first-major bachelor's grew the most
 * from the window's start (or up to 2 years later, like other 10-year changes) to its end, among fields with
 * GROWTH_MIN_GRADUATES+ graduates now and colleges with GROWTH_MIN_TOTAL+ bachelor's at both ends. Null when no field
 * gained GROWTH_MIN_POINTS. 2-digit families, not 6-digit programs: history keeps families only (6-digit codes changed
 * with CIP 2020).
 */
export function fastestGrowingField(series: Partial<Record<string, ShareSeries>>, [start, end]: [number, number]): FieldGrowth | null {
  const total = at(series.bachelors, end);
  if (total === null || total < GROWTH_MIN_TOTAL) return null;
  let from: number | null = null;
  for (let y = start; y <= start + 2 && y < end; y++) {
    const t = at(series.bachelors, y);
    if (t !== null) {
      from = t >= GROWTH_MIN_TOTAL ? y : null;
      break;
    }
  }
  if (from === null) return null;
  let best: FieldGrowth | null = null;
  for (const f of MAJOR_FAMILY_CODES) {
    const s = series[`major_${f}`];
    const a = at(s, from);
    const b = at(s, end);
    if (a === null || b === null) continue;
    const graduates = Math.round(b * total);
    if (graduates < GROWTH_MIN_GRADUATES || b - a < GROWTH_MIN_POINTS) continue;
    if (!best || b - a > best.to.share - best.from.share) best = { family: f, from: { year: from, share: a }, to: { year: end, share: b }, graduates };
  }
  return best;
}
