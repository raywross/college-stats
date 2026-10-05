/**
 * High school helpers (specs/product/high-school-data.md): ids, states, grades, suppression, ranges, canonical row
 * order, state report merging, state medians, views, search, and the validators the sync, check:lineage, publish-data,
 * and tests run. Pure: no node:fs, no Next.js imports, so the app, scripts, and tests share it.
 */
import type {
  GradeCode,
  HighSchool,
  HighSchoolDetail,
  HighSchoolHit,
  HighSchoolMeta,
  HighSchoolShard,
  HighSchoolStateFile,
  HighSchoolView,
  HsGrade,
  HsLineage,
  HsRaceKey,
  HsStateField,
  HsStateReport,
  HsVintageKey,
  PublishedHighSchool,
  StateMedians,
} from "./high-school-types";
import {
  HS_DERIVED,
  HS_FIELDS,
  HS_STATE_FIELDS,
  isHsFieldPath,
  isHsSourceKey,
  registeredHsPathFor,
  stateFieldPath,
  type HsFieldDef,
  type HsFieldPath,
} from "./hs-fields.ts";

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/** State FIPS → USPS for the 50 states and DC (territories, BIE (59) and DoD (58) schools are out of scope). */
export const FIPS_TO_USPS: Readonly<Record<string, string>> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

export const USPS_TO_FIPS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(FIPS_TO_USPS).map(([f, u]) => [u, f]));

/** Every USPS code a high school shard can have, sorted. */
export const HS_STATES: readonly string[] = Object.values(FIPS_TO_USPS).sort();

export function fipsToUsps(fips: string): string | null {
  return FIPS_TO_USPS[fips.padStart(2, "0")] ?? null;
}

export function uspsToFips(usps: string): string | null {
  return USPS_TO_FIPS[usps.toUpperCase()] ?? null;
}

export function isUsps(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(USPS_TO_FIPS, code);
}

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

/** Public: 12-digit NCES `ncessch` whose first two digits are a state FIPS code in FIPS_TO_USPS. */
export function isPublicHighSchoolId(id: string): boolean {
  return /^\d{12}$/.test(id) && Object.prototype.hasOwnProperty.call(FIPS_TO_USPS, id.slice(0, 2));
}

/**
 * Private: the PSS `ppin`, 8 characters of upper-case letters and digits (e.g. "A9106383", "BB000073", "00000226").
 * The PSS unit verifies this against the current file; widen here (and its test) if the file disagrees.
 */
export function isPrivateHighSchoolId(id: string): boolean {
  return /^[A-Z0-9]{8}$/.test(id);
}

export function isHighSchoolId(id: unknown): id is string {
  return typeof id === "string" && (isPublicHighSchoolId(id) || isPrivateHighSchoolId(id));
}

export function kindOfHighSchoolId(id: string): "public" | "private" | null {
  return isPublicHighSchoolId(id) ? "public" : isPrivateHighSchoolId(id) ? "private" : null;
}

/** USPS of a public school's id (from its FIPS prefix); null for private ids and anything invalid. */
export function stateOfHighSchoolId(id: string): string | null {
  return isPublicHighSchoolId(id) ? FIPS_TO_USPS[id.slice(0, 2)] : null;
}

/* ------------------------------------------------------------------ */
/* Grades                                                              */
/* ------------------------------------------------------------------ */

export const GRADE_ORDER: readonly GradeCode[] = ["PK", "KG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "UG"];
export const HS_GRADES: readonly HsGrade[] = ["9", "10", "11", "12"];
export const HS_RACES: readonly HsRaceKey[] = ["american_indian", "asian", "black", "hispanic", "pacific_islander", "two_or_more", "white"];

/** Position in GRADE_ORDER, or -1. CCD writes "01".."09" too; those are accepted. */
export function gradeRank(code: string): number {
  const c = /^0\d$/.test(code) ? code.slice(1) : code;
  return GRADE_ORDER.indexOf(c as GradeCode);
}

/** "9" for "09", "KG" for "K"; null for codes that aren't grades (CCD's "N", "M", "-1"). */
export function normalizeGrade(code: string | null | undefined): GradeCode | null {
  if (code === null || code === undefined) return null;
  const c = code.trim().toUpperCase();
  if (c === "K") return "KG";
  const r = gradeRank(c);
  return r < 0 ? null : GRADE_ORDER[r];
}

/** The definition of a high school here: the grades offered reach grade 12 (a top grade of 13/UG counts if 12 is in range). */
export function offersGrade12(grades: { low: string; high: string }): boolean {
  const lo = gradeRank(grades.low);
  const hi = gradeRank(grades.high);
  const twelve = gradeRank("12");
  return lo >= 0 && hi >= 0 && lo <= twelve && hi >= twelve;
}

/** "9–12", "PK–12", or "12" when low and high are the same. */
export function gradeSpan(grades: { low: string; high: string }): string {
  return grades.low === grades.high ? grades.low : `${grades.low}–${grades.high}`;
}

/* ------------------------------------------------------------------ */
/* Suppression and ranges                                              */
/* ------------------------------------------------------------------ */

/** Counts under this are suppressed (shown as "fewer than 5"). */
export const SMALL_CELL = 5;

export interface SuppressOptions {
  /** "count": a number of students (small counts suppressed); "share": a 0–1 rate (only source codes suppress). */
  kind: "count" | "share";
  /** Smallest count shown; default SMALL_CELL. Zero is always shown (it identifies nobody). */
  min?: number;
  /** The source's privacy codes ("*", "PS", "-11", …): suppressed. */
  suppressedCodes?: readonly string[];
  /** The source's "not applicable / missing" codes ("-9", "N", "†", …): null but not suppressed. Unknown non-numbers are missing too. */
  missingCodes?: readonly string[];
  /** For "share": the raw value is a percent (0–100), divide by 100. */
  percent?: boolean;
}

export interface Suppressed {
  value: number | null;
  /** True when null means "suppressed for privacy", false when it means "not reported". */
  suppressed: boolean;
}

/**
 * Normalize one source cell. Small counts (1 to min − 1) and the source's privacy codes become
 * `{ value: null, suppressed: true }`; missing codes, blanks, negatives, and non-numbers become `{ value: null,
 * suppressed: false }`. Record a suppressed path in the row's `suppressed` list.
 */
export function suppress(raw: string | number | null | undefined, opts: SuppressOptions): Suppressed {
  if (raw === null || raw === undefined) return { value: null, suppressed: false };
  const text = String(raw).trim();
  if (opts.suppressedCodes?.includes(text)) return { value: null, suppressed: true };
  if (text === "" || opts.missingCodes?.includes(text)) return { value: null, suppressed: false };
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return { value: null, suppressed: false };
  if (opts.kind === "count") {
    const min = opts.min ?? SMALL_CELL;
    if (n > 0 && n < min) return { value: null, suppressed: true };
    return { value: Math.round(n), suppressed: false };
  }
  const v = opts.percent ? n / 100 : n;
  if (v > 1) return { value: null, suppressed: false };
  return { value: round(v, 4), suppressed: false };
}

export interface RateRange {
  /** An exact rate the source printed; null when it printed a range. */
  value: number | null;
  low: number | null;
  high: number | null;
  suppressed: boolean;
}

/**
 * EDFacts-style rate cells (percent text) → 0–1. "87" → exact; "90-94" → 0.90–0.94; "GE80" → 0.80–1; "GT50" →
 * 0.51–1 (whole percents); "LE10" → 0–0.10; "LT50" → 0–0.49; "PS" / "*" → suppressed; blank, "N/A", "." → missing.
 * Ranges stay ranges: never a midpoint.
 */
export function parseRateRange(raw: string | number | null | undefined, suppressedCodes: readonly string[] = ["PS", "*", "S"]): RateRange {
  const missing: RateRange = { value: null, low: null, high: null, suppressed: false };
  if (raw === null || raw === undefined) return missing;
  const t = String(raw).trim().toUpperCase();
  if (suppressedCodes.includes(t)) return { ...missing, suppressed: true };
  const pct = (s: string) => round(Number(s) / 100, 4);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}(?:\.\d+)?)$/.exec(t)) && Number(m[1]) <= 100) return { value: pct(m[1]), low: null, high: null, suppressed: false };
  if ((m = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t)) && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 100) {
    return { value: null, low: pct(m[1]), high: pct(m[2]), suppressed: false };
  }
  if ((m = /^(GE|GT|LE|LT)\s*(\d{1,3})$/.exec(t)) && Number(m[2]) <= 100) {
    const n = Number(m[2]);
    if (m[1] === "GE") return { value: null, low: pct(String(n)), high: 1, suppressed: false };
    if (m[1] === "GT") return { value: null, low: pct(String(Math.min(100, n + 1))), high: 1, suppressed: false };
    if (m[1] === "LE") return { value: null, low: 0, high: pct(String(n)), suppressed: false };
    return { value: null, low: 0, high: pct(String(Math.max(0, n - 1))), suppressed: false };
  }
  return missing;
}

export function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/* ------------------------------------------------------------------ */
/* Canonical rows (stable key order for clean diffs)                   */
/* ------------------------------------------------------------------ */

const orNull = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
const roundOrNull = (v: number | null | undefined, places: number) => (typeof v === "number" ? round(v, places) : orNull(v));

function orderedRecord<K extends string, V>(src: Partial<Record<K, V>> | null | undefined, keys: readonly K[]): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {};
  if (!src) return out;
  for (const k of keys) if (k in src) out[k] = src[k];
  // Unknown keys stay (after the known ones) so the validator can report them instead of the writer dropping them.
  for (const k of Object.keys(src).sort() as K[]) if (!keys.includes(k)) out[k] = src[k];
  return out;
}

const LINEAGE_KEYS = ["source", "year", "url", "retrieved", "method", "quote", "page"] as const;

function orderedLineage(rec: HsLineage): HsLineage {
  const out: Record<string, unknown> = {};
  for (const k of LINEAGE_KEYS) if (rec[k] !== undefined) out[k] = rec[k];
  return out as unknown as HsLineage;
}

/**
 * A row with every key in canonical order, missing keys filled with null, shares rounded to 4 places, ratios to 2,
 * coordinates to 6, `suppressed` sorted and de-duplicated, `lineage` sorted by path. The writer stores exactly this;
 * validateShard rejects rows that differ from it.
 */
export function normalizeHighSchool(row: HighSchool): HighSchool {
  const r = row as Partial<HighSchool> & Pick<HighSchool, "id" | "kind" | "name" | "state">;
  const e: Partial<HighSchool["enrollment"]> = r.enrollment ?? {};
  const s: Partial<HighSchool["status"]> = r.status ?? {};
  const out: HighSchool = {
    id: r.id,
    kind: r.kind,
    name: r.name,
    state: r.state,
    city: orNull(r.city),
    zip: orNull(r.zip),
    address: orNull(r.address),
    lat: roundOrNull(r.lat, 6),
    lng: roundOrNull(r.lng, 6),
    locale: orNull(r.locale),
    district: r.district ? { id: r.district.id, name: r.district.name } : null,
    state_school_id: orNull(r.state_school_id),
    grades: { low: r.grades?.low ?? "", high: r.grades?.high ?? "" },
    status: { charter: orNull(s.charter), magnet: orNull(s.magnet), title_i: orNull(s.title_i), virtual: orNull(s.virtual) },
    school_type: orNull(r.school_type),
    affiliation: orNull(r.affiliation),
    enrollment: {
      total: orNull(e.total),
      by_grade: orderedRecord(e.by_grade, HS_GRADES),
      by_race: e.by_race ? orderedRecord(e.by_race, HS_RACES) : null,
      female: orNull(e.female),
    },
    student_teacher_ratio: roundOrNull(r.student_teacher_ratio, 2),
    frl_share: roundOrNull(r.frl_share, 4),
    grad_rate: r.grad_rate
      ? { value: roundOrNull(r.grad_rate.value, 4), low: roundOrNull(r.grad_rate.low, 4), high: roundOrNull(r.grad_rate.high, 4), cohort: orNull(r.grad_rate.cohort) }
      : null,
    rigor: r.rigor
      ? {
          ap_courses: orNull(r.rigor.ap_courses),
          ap_enrolled: orNull(r.rigor.ap_enrolled),
          ap_exam_takers: orNull(r.rigor.ap_exam_takers),
          ap_passed_some: orNull(r.rigor.ap_passed_some),
          ib_enrolled: orNull(r.rigor.ib_enrolled),
          dual_enrolled: orNull(r.rigor.dual_enrolled),
          enrollment: orNull(r.rigor.enrollment),
        }
      : null,
  };
  const known = new Set(Object.keys(out).concat(["suppressed", "lineage"]));
  // Unknown top-level keys survive (sorted) so validateHighSchoolRow names them rather than the writer losing data.
  for (const k of Object.keys(r).sort()) if (!known.has(k)) (out as unknown as Record<string, unknown>)[k] = (r as Record<string, unknown>)[k];
  if (r.suppressed?.length) out.suppressed = [...new Set(r.suppressed)].sort();
  if (r.lineage && Object.keys(r.lineage).length) {
    out.lineage = Object.fromEntries(Object.keys(r.lineage).sort().map((k) => [k, orderedLineage(r.lineage![k])]));
  }
  return out;
}

/** A blank row for adapters to fill: every field null. */
export function blankHighSchool(id: string, kind: HighSchool["kind"], name: string, state: string): HighSchool {
  return normalizeHighSchool({ id, kind, name, state } as HighSchool);
}

/** Lower-case, accent-free, punctuation-free "name city" key for search (the `search` column; json mode uses it too). */
export function hsSearchKey(name: string, city?: string | null): string {
  return `${name} ${city ?? ""}`
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function toHit(row: HighSchool): HighSchoolHit {
  return { id: row.id, name: row.name, city: row.city, state: row.state, kind: row.kind, district: row.district?.name ?? null, grades: gradeSpan(row.grades) };
}

/* ------------------------------------------------------------------ */
/* State reports, medians, views                                       */
/* ------------------------------------------------------------------ */

/** One school's state report values, or null when its state file has nothing for it. */
export function mergeStateReport(row: Pick<HighSchool, "id" | "state" | "kind">, stateFiles: readonly HighSchoolStateFile[]): HsStateReport | null {
  if (row.kind !== "public") return null;
  const file = stateFiles.find((f) => f.state === row.state);
  const entry = file?.schools[row.id];
  if (!file || !entry) return null;
  const values: HsStateReport["values"] = {};
  for (const f of HS_STATE_FIELDS) if (f in entry && entry[f] !== undefined) values[f] = entry[f] ?? null;
  const suppressed = HS_STATE_FIELDS.filter((f) => entry.suppressed?.includes(f));
  const used = new Set<HsStateField>([...(Object.keys(values) as HsStateField[]), ...suppressed]);
  if (!used.size) return null;
  return { values, suppressed, sections: file.sections.filter((s) => s.fields.some((f) => used.has(f))) };
}

/** The row as published to Supabase: its state report merged in, so the app reads one row. */
export function toPublishedRow(row: HighSchool, stateFiles: readonly HighSchoolStateFile[]): PublishedHighSchool {
  return { ...normalizeHighSchool(row), state_report: mergeStateReport(row, stateFiles) };
}

/** Split a published row back into the row and its state report. */
export function fromPublishedRow(p: PublishedHighSchool): { school: HighSchool; state_report: HsStateReport | null } {
  const { state_report, ...school } = p;
  return { school, state_report: state_report ?? null };
}

/** A state median needs at least this many public high schools with a value; fewer, and there's no median. */
export const MIN_MEDIAN_N = 5;

/** Keys medians.json carries, in file order: row fields, derived shares, and state report fields (`state.*`). */
export const HS_MEDIAN_KEYS: readonly HsFieldPath[] = [
  "enrollment.total",
  "student_teacher_ratio",
  "frl_share",
  "grad_rate",
  "rigor.ap_courses",
  "derived.ap_enrolled_share",
  "derived.ap_pass_share",
  "derived.ib_enrolled_share",
  "derived.dual_enrolled_share",
  ...HS_STATE_FIELDS.map(stateFieldPath),
];

/**
 * The number a school contributes to a median. Graduation rate: the exact rate, or the middle of a published range
 * no wider than 10 points (EDFacts' ranges for mid-size cohorts); open ranges ("GE80") and wider ones are left out.
 * The midpoint is used only inside the median; a school's own range is never shown as a point.
 */
export function medianInput(key: HsFieldPath, row: HighSchool, report: HsStateReport | null): number | null {
  if (key === "grad_rate") {
    const g = row.grad_rate;
    if (!g) return null;
    if (g.value !== null) return g.value;
    if (g.low !== null && g.high !== null && g.high - g.low <= 0.1 + 1e-9) return (g.low + g.high) / 2;
    return null;
  }
  if (key.startsWith("derived.")) return HS_DERIVED[key as keyof typeof HS_DERIVED](row);
  if (key.startsWith("state.")) return report?.values[key.slice("state.".length) as HsStateField] ?? null;
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), row);
  return typeof v === "number" ? v : null;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * medians.json: per state, the median of each HS_MEDIAN_KEYS key over the state's public high schools (private rows
 * never count). Keys with fewer than MIN_MEDIAN_N values are left out. Rounded to 4 places; states sorted.
 */
export function computeStateMedians(rows: readonly HighSchool[], stateFiles: readonly HighSchoolStateFile[]): StateMedians {
  const byState = new Map<string, Map<HsFieldPath, number[]>>();
  for (const row of rows) {
    if (row.kind !== "public") continue;
    const report = mergeStateReport(row, stateFiles);
    let m = byState.get(row.state);
    if (!m) byState.set(row.state, (m = new Map()));
    for (const key of HS_MEDIAN_KEYS) {
      const v = medianInput(key, row, report);
      if (v === null || !Number.isFinite(v)) continue;
      const list = m.get(key);
      if (list) list.push(v);
      else m.set(key, [v]);
    }
  }
  const out: StateMedians = {};
  for (const state of [...byState.keys()].sort()) {
    const m = byState.get(state)!;
    const entry: StateMedians[string] = {};
    for (const key of HS_MEDIAN_KEYS) {
      const list = m.get(key);
      if (list && list.length >= MIN_MEDIAN_N) entry[key] = round(median(list)!, 4);
    }
    out[state] = entry;
  }
  return out;
}

/** Everything a page needs, from the files (json mode) or a published row (supabase mode). */
export function buildHighSchoolView(
  school: HighSchool,
  parts: { stateReport: HsStateReport | null; detail: HighSchoolDetail | null; medians: StateMedians | null; meta: HighSchoolMeta },
): HighSchoolView {
  return {
    school,
    state_report: parts.stateReport,
    detail: parts.detail,
    // Medians are of the state's public high schools (labeled so); private pages may compare to them too.
    medians: parts.medians?.[school.state] ?? null,
    meta: parts.meta,
  };
}

/** Search over rows (json mode; the SQL function search_high_schools does the same in Supabase). */
export function searchRows(
  rows: Iterable<HighSchool>,
  { q, state, kind, limit }: { q: string; state?: string | null; kind?: HighSchool["kind"] | null; limit?: number },
): HighSchoolHit[] {
  const key = hsSearchKey(q);
  const tokens = key ? key.split(" ") : [];
  const st = state?.toUpperCase() || null;
  if (!tokens.length && !st) return [];
  const max = clampLimit(limit);
  const scored: { row: HighSchool; score: number }[] = [];
  for (const row of rows) {
    if (st && row.state !== st) continue;
    if (kind && row.kind !== kind) continue;
    if (!tokens.length) {
      scored.push({ row, score: 0 });
      continue;
    }
    const s = hsSearchKey(row.name, row.city);
    const words = s.split(" ");
    const allPrefix = tokens.every((t) => words.some((w) => w.startsWith(t)));
    const score = s.startsWith(key) ? 3 : allPrefix ? 2 : s.includes(key) ? 1 : 0;
    if (score) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id));
  return scored.slice(0, max).map((x) => toHit(x.row));
}

export function clampLimit(limit: number | null | undefined): number {
  const n = Number.isFinite(limit) ? Math.floor(limit as number) : 20;
  return Math.min(50, Math.max(1, n));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUrl = (s: unknown) => typeof s === "string" && /^https?:\/\/\S+$/.test(s);
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isShare = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;

/** Paths of every leaf value in an object (arrays and non-plain values are leaves). */
function leaves(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) out.push(...leaves(v, prefix ? `${prefix}.${k}` : k));
  return out.length ? out : prefix ? [prefix] : [];
}

function valueAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** A stored row field: registered and neither derived, state report, nor profile. */
function isStoredPath(path: string): path is HsFieldPath {
  return isHsFieldPath(path) && !/^(derived|state|detail)\./.test(path);
}

/** A stored leaf (or a stored registered path's ancestor holding null, like a private school's `rigor`). */
function coveredLeaf(leaf: string): boolean {
  const reg = registeredHsPathFor(leaf);
  if (reg) return isStoredPath(reg);
  return (Object.keys(HS_FIELDS) as HsFieldPath[]).some((p) => isStoredPath(p) && p.startsWith(`${leaf}.`));
}

/** A path a row can list as suppressed: a stored field or a leaf below one ("enrollment.by_race.asian"). */
function isSuppressiblePath(path: string): boolean {
  const reg = registeredHsPathFor(path);
  return !!reg && isStoredPath(reg);
}

/** Every problem with one row; empty when it's valid. */
export function validateHighSchoolRow(row: HighSchool): string[] {
  const id = (row as { id?: unknown }).id;
  const where = `high school ${typeof id === "string" ? id : JSON.stringify(id)}`;
  const p: string[] = [];
  if (!isHighSchoolId(id)) return [`${where}: not a valid id (12-digit ncessch or 8-character PSS ppin)`];
  const kind = kindOfHighSchoolId(id);
  if (row.kind !== kind) p.push(`${where}: kind is ${row.kind}, but the id is a ${kind} school's`);
  if (typeof row.name !== "string" || !row.name.trim() || row.name !== row.name.trim()) p.push(`${where}: name is empty or has surrounding spaces`);
  if (!isUsps(row.state)) p.push(`${where}: state ${row.state} isn't one of the 50 states or DC`);
  else if (kind === "public" && stateOfHighSchoolId(id) !== row.state) p.push(`${where}: state ${row.state} doesn't match the id's FIPS prefix (${stateOfHighSchoolId(id)})`);
  if (row.zip !== null && row.zip !== undefined && !/^\d{5}$/.test(row.zip)) p.push(`${where}: zip ${row.zip} isn't 5 digits`);
  if (row.lat !== null && !(typeof row.lat === "number" && row.lat >= -90 && row.lat <= 90)) p.push(`${where}: lat out of range`);
  if (row.lng !== null && !(typeof row.lng === "number" && row.lng >= -180 && row.lng <= 180)) p.push(`${where}: lng out of range`);

  // Grades: valid codes, in order, reaching grade 12 (what makes it a high school here).
  if (!row.grades || gradeRank(row.grades.low) < 0 || gradeRank(row.grades.high) < 0) p.push(`${where}: grades ${JSON.stringify(row.grades)} aren't grade codes`);
  else if (!offersGrade12(row.grades)) p.push(`${where}: grades ${gradeSpan(row.grades)} don't include grade 12`);

  // Every stored leaf is registered.
  for (const leaf of leaves(row)) {
    if (leaf === "id" || leaf === "kind" || leaf.startsWith("suppressed") || leaf.startsWith("lineage")) continue;
    if (!coveredLeaf(leaf)) p.push(`${where}: ${leaf} isn't a registered field (lib/hs-fields.ts)`);
  }

  // Counts, shares, ratios.
  const counts: [string, unknown][] = [
    ["enrollment.total", row.enrollment?.total],
    ["enrollment.female", row.enrollment?.female],
    ...Object.entries(row.enrollment?.by_grade ?? {}).map(([k, v]) => [`enrollment.by_grade.${k}`, v] as [string, unknown]),
    ...Object.entries(row.enrollment?.by_race ?? {}).map(([k, v]) => [`enrollment.by_race.${k}`, v] as [string, unknown]),
    ...Object.entries(row.rigor ?? {}).map(([k, v]) => [`rigor.${k}`, v] as [string, unknown]),
    ["grad_rate.cohort", row.grad_rate?.cohort],
  ];
  for (const [path, v] of counts) if (v !== null && v !== undefined && !isCount(v)) p.push(`${where}: ${path} must be a whole number ≥ 0, got ${JSON.stringify(v)}`);
  for (const k of Object.keys(row.enrollment?.by_grade ?? {})) if (!HS_GRADES.includes(k as HsGrade)) p.push(`${where}: enrollment.by_grade.${k}: only grades 9–12`);
  for (const k of Object.keys(row.enrollment?.by_race ?? {})) if (!HS_RACES.includes(k as HsRaceKey)) p.push(`${where}: enrollment.by_race.${k} isn't a race/ethnicity category`);
  if (row.frl_share !== null && !isShare(row.frl_share)) p.push(`${where}: frl_share must be 0–1`);
  if (row.student_teacher_ratio !== null && !(typeof row.student_teacher_ratio === "number" && row.student_teacher_ratio > 0 && row.student_teacher_ratio < 200)) {
    p.push(`${where}: student_teacher_ratio out of range`);
  }
  const g = row.grad_rate;
  if (g) {
    for (const k of ["value", "low", "high"] as const) if (g[k] !== null && !isShare(g[k])) p.push(`${where}: grad_rate.${k} must be 0–1`);
    if (g.value !== null && (g.low !== null || g.high !== null)) p.push(`${where}: grad_rate is exact (value) or a range (low/high), not both`);
    if ((g.low === null) !== (g.high === null)) p.push(`${where}: grad_rate range needs both low and high`);
    if (g.low !== null && g.high !== null && g.low > g.high) p.push(`${where}: grad_rate low > high`);
  }

  // Kind-specific fields.
  if (kind === "public" && row.affiliation !== null) p.push(`${where}: affiliation is for private schools`);
  if (kind === "private") {
    if (row.district !== null) p.push(`${where}: a private school has no district`);
    if (row.state_school_id !== null) p.push(`${where}: a private school has no state school id`);
    if (row.grad_rate !== null) p.push(`${where}: private schools have no federal graduation rate (null, not suppressed)`);
    if (row.rigor !== null) p.push(`${where}: private schools have no CRDC rigor data (null, not suppressed)`);
  }

  // Suppressed paths: registered stored fields whose value is null.
  for (const s of row.suppressed ?? []) {
    if (!isSuppressiblePath(s)) p.push(`${where}: suppressed ${s} isn't a registered stored field`);
    else if (s === "grad_rate" ? !!g && (g.value !== null || g.low !== null) : valueAt(row, s) !== null && valueAt(row, s) !== undefined) {
      // A suppressed graduation rate may keep its cohort count; the rate itself must be empty.
      p.push(`${where}: ${s} is listed as suppressed but has a value`);
    }
  }
  if (row.suppressed && new Set(row.suppressed).size !== row.suppressed.length) p.push(`${where}: suppressed lists a path twice`);

  // Lineage: registered paths with a value, a known source, complete when extracted.
  for (const [path, rec] of Object.entries(row.lineage ?? {})) {
    if (!isStoredPath(path)) p.push(`${where}: lineage for ${path}, which isn't a registered stored field`);
    else if (valueAt(row, path) === null || valueAt(row, path) === undefined) p.push(`${where}: lineage for ${path}, which has no value`);
    if (!isHsSourceKey(rec.source)) p.push(`${where}: lineage ${path} cites unknown source ${rec.source}`);
    if (rec.method === "extracted" && (!rec.quote || !rec.url || !rec.retrieved || !rec.year)) p.push(`${where}: lineage ${path} is extracted but lacks quote, url, retrieved, or year`);
    if (rec.retrieved !== undefined && !isDate(rec.retrieved)) p.push(`${where}: lineage ${path} retrieved isn't YYYY-MM-DD`);
  }
  return p;
}

/** A shard: right state, rows valid, sorted by id, unique, in canonical key order (the writer's output). */
export function validateShard(shard: HighSchoolShard, fileName?: string): string[] {
  const where = `high-schools/schools/${fileName ?? `${shard.state}.json`}`;
  const p: string[] = [];
  if (fileName && fileName !== `${shard.state}.json`) p.push(`${where}: file name doesn't match state ${shard.state}`);
  if (!isUsps(shard.state)) p.push(`${where}: ${shard.state} isn't one of the 50 states or DC`);
  let prev = "";
  for (const row of shard.schools) {
    p.push(...validateHighSchoolRow(row).map((x) => `${where}: ${x}`));
    if (row.state !== shard.state) p.push(`${where}: ${row.id} is in ${row.state}`);
    if (row.id <= prev) p.push(`${where}: ${row.id} is out of order or repeated (rows sorted by id)`);
    prev = row.id;
    if (JSON.stringify(normalizeHighSchool(row)) !== JSON.stringify(row)) p.push(`${where}: ${row.id} isn't in canonical form (write shards with the sync's writer)`);
  }
  return p;
}

/** A state report file: sections cite the state's source with year, URL, and date; values are 0–1 shares keyed by ncessch. */
export function validateStateFile(file: HighSchoolStateFile, opts: { fileName?: string; ids?: ReadonlySet<string> } = {}): string[] {
  const where = `high-schools/state/${opts.fileName ?? `${String(file.state).toLowerCase()}.json`}`;
  const p: string[] = [];
  if (!isUsps(file.state)) return [`${where}: state ${file.state} isn't an upper-case USPS code`];
  if (opts.fileName && opts.fileName !== `${file.state.toLowerCase()}.json`) p.push(`${where}: file name doesn't match state ${file.state}`);
  const expected = `state-${file.state.toLowerCase()}`;
  const keys = new Set<string>();
  const covered = new Set<HsStateField>();
  if (!file.sections?.length) p.push(`${where}: no sections`);
  for (const s of file.sections ?? []) {
    const sw = `${where} section ${s.key}`;
    if (!s.key || keys.has(s.key)) p.push(`${sw}: key missing or repeated`);
    keys.add(s.key);
    if (s.source !== expected) p.push(`${sw}: source ${s.source}; a ${file.state} file cites ${expected}`);
    if (!isHsSourceKey(s.source)) p.push(`${sw}: unknown source ${s.source} (add it to HsSourceKey and HS_SOURCE_VINTAGE)`);
    if (!s.label?.trim()) p.push(`${sw}: no label`);
    if (!s.year?.trim()) p.push(`${sw}: no year`);
    if (!isUrl(s.url)) p.push(`${sw}: url isn't http(s)`);
    if (!isDate(s.retrieved)) p.push(`${sw}: retrieved isn't YYYY-MM-DD`);
    for (const f of s.fields ?? []) {
      if (!HS_STATE_FIELDS.includes(f)) p.push(`${sw}: ${f} isn't a state report field`);
      else if (covered.has(f)) p.push(`${sw}: ${f} is already in another section`);
      covered.add(f);
    }
  }
  for (const [id, entry] of Object.entries(file.schools ?? {})) {
    const ew = `${where} ${id}`;
    if (!isPublicHighSchoolId(id)) p.push(`${ew}: not a public ncessch`);
    else if (stateOfHighSchoolId(id) !== file.state) p.push(`${ew}: id is a ${stateOfHighSchoolId(id)} school`);
    if (opts.ids && !opts.ids.has(id)) p.push(`${ew}: not in the ${file.state} shard (list it under unmatched)`);
    for (const [k, v] of Object.entries(entry)) {
      if (k === "suppressed") continue;
      if (!HS_STATE_FIELDS.includes(k as HsStateField)) p.push(`${ew}: ${k} isn't a state report field`);
      else if (!covered.has(k as HsStateField)) p.push(`${ew}: ${k} has no section citing it`);
      if (v !== null && !isShare(v)) p.push(`${ew}: ${k} must be a 0–1 share or null, got ${JSON.stringify(v)}`);
    }
    for (const f of entry.suppressed ?? []) {
      if (!covered.has(f)) p.push(`${ew}: suppressed ${f} has no section citing it`);
      if (entry[f] !== null && entry[f] !== undefined) p.push(`${ew}: ${f} is suppressed but has a value`);
    }
  }
  return p;
}

/** A school profile detail file: cited, dated, sane numbers; matriculation names a real college when it names one. */
export function validateHighSchoolDetail(
  d: HighSchoolDetail,
  opts: { fileName?: string; schoolIds?: ReadonlySet<string>; collegeIds?: ReadonlySet<string> } = {},
): string[] {
  const where = `high-schools/detail/${opts.fileName ?? `${d.id}.json`}`;
  const p: string[] = [];
  if (!isHighSchoolId(d.id)) return [`${where}: not a valid high school id`];
  if (opts.fileName && opts.fileName !== `${d.id}.json`) p.push(`${where}: file name doesn't match id ${d.id}`);
  if (opts.schoolIds && !opts.schoolIds.has(d.id)) p.push(`${where}: no high school row has id ${d.id}`);
  if (!d.profile || !isUrl(d.profile.url)) p.push(`${where}: profile.url isn't http(s)`);
  if (!isDate(d.profile?.retrieved)) p.push(`${where}: profile.retrieved isn't YYYY-MM-DD`);
  if (!d.profile?.edition?.trim()) p.push(`${where}: profile.edition is empty`);
  if (d.class_size) {
    if (!(Number.isInteger(d.class_size.v) && d.class_size.v > 0)) p.push(`${where}: class_size must be a whole number > 0`);
    if (!d.class_size.quote?.trim()) p.push(`${where}: class_size has no quote`);
  }
  if (d.gpa_scale) {
    if (!["unweighted-4", "weighted-5", "100-point", "other"].includes(d.gpa_scale.kind)) p.push(`${where}: gpa_scale.kind ${d.gpa_scale.kind} unknown`);
    if (d.gpa_scale.max !== null && !(d.gpa_scale.max > 0)) p.push(`${where}: gpa_scale.max must be > 0`);
    if (!d.gpa_scale.quote?.trim()) p.push(`${where}: gpa_scale has no quote`);
  }
  if (d.gpa_distribution) {
    const sum = d.gpa_distribution.reduce((a, b) => a + b.share, 0);
    for (const b of d.gpa_distribution) {
      if (!b.band?.trim()) p.push(`${where}: a gpa_distribution band has no label`);
      if (!isShare(b.share)) p.push(`${where}: gpa_distribution ${b.band} share must be 0–1`);
    }
    if (Math.abs(sum - 1) > 0.02) p.push(`${where}: gpa_distribution sums to ${round(sum, 3)}, not 1 ± 0.02`);
  }
  for (const k of ["ap_courses", "ib_courses"] as const) {
    const list = d[k];
    if (list && list.some((c) => typeof c !== "string" || !c.trim())) p.push(`${where}: ${k} has an empty entry`);
  }
  const range = (r: [number, number] | null | undefined, lo: number, hi: number, name: string) => {
    if (!r) return;
    if (!(r[0] >= lo && r[1] <= hi && r[0] <= r[1])) p.push(`${where}: scores.${name} ${JSON.stringify(r)} out of range ${lo}–${hi}`);
  };
  range(d.scores?.sat_mid50, 400, 1600, "sat_mid50");
  range(d.scores?.act_mid50, 1, 36, "act_mid50");
  if (d.matriculation) {
    if (!d.matriculation.classes?.trim()) p.push(`${where}: matriculation.classes is empty`);
    for (const e of d.matriculation.entries ?? []) {
      if (!e.name?.trim()) p.push(`${where}: a matriculation entry has no name`);
      if (e.count !== null && !isCount(e.count)) p.push(`${where}: matriculation ${e.name} count must be a whole number ≥ 0`);
      if (e.count !== null && d.class_size && e.count > d.class_size.v) p.push(`${where}: matriculation ${e.name} count ${e.count} exceeds class size ${d.class_size.v}`);
      if (e.unit_id !== null && !/^\d{6}$/.test(e.unit_id)) p.push(`${where}: matriculation ${e.name} unit_id ${e.unit_id} isn't an IPEDS id`);
      else if (e.unit_id !== null && opts.collegeIds && !opts.collegeIds.has(e.unit_id)) p.push(`${where}: matriculation ${e.name} unit_id ${e.unit_id} isn't in data/schools.json`);
    }
  }
  return p;
}

export const HS_VINTAGE_KEYS: readonly HsVintageKey[] = ["ccd-directory", "ccd-enrollment", "edfacts-acgr", "crdc", "pss"];

/** meta.json: complete, counts match the rows, and every source the rows cite is described. */
export function validateHighSchoolMeta(meta: HighSchoolMeta, rows: readonly HighSchool[]): string[] {
  const p: string[] = [];
  if (!isDate(meta.generated)) p.push("high-schools/meta.json: generated isn't YYYY-MM-DD");
  for (const k of HS_VINTAGE_KEYS) if (!(k in (meta.vintages ?? {}))) p.push(`high-schools/meta.json: vintages.${k} missing (null if not loaded)`);
  for (const [k, s] of Object.entries(meta.sources ?? {})) {
    if (!isHsSourceKey(k)) p.push(`high-schools/meta.json: unknown source ${k}`);
    if (!s?.name || !s.publisher || !isUrl(s.url) || !isDate(s.retrieved)) p.push(`high-schools/meta.json: source ${k} needs name, publisher, http(s) url, and retrieved date`);
  }
  const pub = rows.filter((r) => r.kind === "public").length;
  const byState: Record<string, number> = {};
  for (const r of rows) byState[r.state] = (byState[r.state] ?? 0) + 1;
  if (meta.counts?.public !== pub || meta.counts?.private !== rows.length - pub) {
    p.push(`high-schools/meta.json: counts say ${meta.counts?.public} public + ${meta.counts?.private} private; the shards have ${pub} + ${rows.length - pub}`);
  }
  if (JSON.stringify(sortKeys(meta.counts?.byState ?? {})) !== JSON.stringify(sortKeys(byState))) p.push("high-schools/meta.json: counts.byState doesn't match the shards");

  // Every source a stored value cites (its default for the row's kind, or its lineage record).
  const used = new Set<string>();
  const stored = (Object.keys(HS_FIELDS) as HsFieldPath[]).filter(isStoredPath);
  for (const r of rows) {
    for (const path of stored) {
      const v = valueAt(r, path);
      if (v === null || v === undefined) continue;
      const def: HsFieldDef = HS_FIELDS[path];
      const src = r.lineage?.[path]?.source ?? (r.kind === "private" && def.source === "nces-ccd" ? "nces-pss" : def.source);
      used.add(src);
    }
  }
  for (const s of used) if (!meta.sources?.[s as keyof HighSchoolMeta["sources"]]) p.push(`high-schools/meta.json: rows cite ${s}, which meta.sources doesn't describe`);
  return p;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** medians.json equals what computeStateMedians gives for the current shards and state files. */
export function validateMedians(medians: StateMedians, rows: readonly HighSchool[], stateFiles: readonly HighSchoolStateFile[]): string[] {
  const expected = computeStateMedians(rows, stateFiles);
  if (JSON.stringify(expected) === JSON.stringify(medians)) return [];
  const states = [...new Set([...Object.keys(expected), ...Object.keys(medians)])].sort();
  const off = states.filter((s) => JSON.stringify(expected[s]) !== JSON.stringify(medians[s]));
  return [`high-schools/medians.json is stale for ${off.slice(0, 5).join(", ") || "key order"}${off.length > 5 ? ` and ${off.length - 5} more` : ""} (rerun the sync, which recomputes it)`];
}
