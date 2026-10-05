/**
 * Panel helpers for national trend studies (specs/national-trends.md#rules): fixed panels, medians, shares,
 * weighted averages, and totals over a set of colleges, plus the per-group breakdown with its floor. Pure (no I/O):
 * the builders in scripts/trends/ and the tests use the same functions, so a recomputation matches by construction.
 *
 * Inflation: use `real()` / `cpiFor()` from lib/history.ts inside a `value` function.
 */
import type { SchoolHistory, SeriesKey } from "./history";
import { valueAt } from "./history.ts";
import type { School } from "./types";
import { GROUPINGS, splitBy, type GroupingKey } from "./trend-groups.ts";
import type { GroupRow, GroupingResult } from "./trends";

/** One college in a study: today's snapshot (for grouping) and its history shard. */
export interface Member {
  school: School;
  h: SchoolHistory;
}

/** A yearly point is published only when at least this share of the panel reports that year (as Home facts do). */
export const MIN_YEAR_COVERAGE = 0.9;

/** Four decimals, as history stores shares; `|| 0` turns −0 into 0. */
export const round4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

/** One decimal of a percentage point (0.0234 → 0.023), for gaps in share units. */
export const round3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** A college's value of `key` in `year` (null when not reported). */
export const at = (m: Member, key: SeriesKey, year: number): number | null => valueAt(m.h.series[key], year);

/** True when every key is reported in `year`. */
export const reports = (m: Member, keys: readonly SeriesKey[], year: number): boolean => keys.every((k) => at(m, k, year) !== null);

/**
 * Hub rule 1: the colleges for which `ok(member, year)` holds in every one of `years` (usually the window's two
 * ends), so "then vs now" compares the same colleges.
 */
export function fixedPanel(members: readonly Member[], years: readonly number[], ok: (m: Member, year: number) => boolean): Member[] {
  return members.filter((m) => years.every((y) => ok(m, y)));
}

/** Linear-interpolated quantile of an ascending array (the same rule as the history build's national stats). */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Median of `value` over the members that have one; null when none do. */
export function medianBy(members: readonly Member[], value: (m: Member) => number | null): number | null {
  const vals = members.map(value).filter(present).sort((a, b) => a - b);
  return vals.length ? quantile(vals, 0.5) : null;
}

/** Share of members where `test` is true, over those where it isn't null; null when none qualify. */
export function shareBy(members: readonly Member[], test: (m: Member) => boolean | null): number | null {
  let yes = 0;
  let all = 0;
  for (const m of members) {
    const t = test(m);
    if (t === null) continue;
    all++;
    if (t) yes++;
  }
  return all ? yes / all : null;
}

/** Σ value × weight ÷ Σ weight over members with both (the "students" view); null when the weights sum to 0. */
export function weightedBy(members: readonly Member[], value: (m: Member) => number | null, weight: (m: Member) => number | null): number | null {
  let num = 0;
  let den = 0;
  for (const m of members) {
    const v = value(m);
    const w = weight(m);
    if (!present(v) || !present(w) || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den ? num / den : null;
}

/** Σ value over members that report one; null when none do. */
export function totalBy(members: readonly Member[], value: (m: Member) => number | null): number | null {
  const vals = members.map(value).filter(present);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/**
 * The members reporting in a given year, or null when fewer than MIN_YEAR_COVERAGE of the panel do (that year's
 * point is left out rather than computed over a different set of colleges).
 */
export function reporting(members: readonly Member[], ok: (m: Member) => boolean): Member[] | null {
  const r = members.filter(ok);
  return r.length && r.length >= members.length * MIN_YEAR_COVERAGE ? r : null;
}

/** Years `from`…`to`; with `step` 2 (residence) only the years on the step, others null in `yearly`. */
export const yearsBetween = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** One value per year from `from` to `to`; off-step years (step 2: odd years) are null, never computed. */
export function yearly(from: number, to: number, fn: (year: number) => number | null, step = 1): (number | null)[] {
  return yearsBetween(from, to).map((y) => (step > 1 && y % step !== 0 ? null : fn(y)));
}

/** The national row: every panel member, key "all". */
export function nationalRow<V>(members: readonly Member[], compute: (ms: Member[]) => V): GroupRow<V> {
  return { key: "all", label: "All colleges", n: members.length, values: compute([...members]) };
}

/**
 * One grouping's rows over the panel: groups at or over the grouping's floor get `compute(groupMembers)`; smaller
 * ones get `tooFew` and no values (hub rule 4). `floor` overrides the grouping's (e.g. a study with its own floor).
 */
export function byGroup<V>(members: readonly Member[], grouping: GroupingKey, compute: (ms: Member[]) => V, floor = GROUPINGS[grouping].floor): GroupingResult<V> {
  const groups = splitBy(members, grouping, (m) => m.school).map(({ key, label, items }): GroupRow<V> =>
    items.length >= floor ? { key, label, n: items.length, values: compute(items) } : { key, label, n: items.length, tooFew: true }
  );
  return { grouping, label: GROUPINGS[grouping].label, floor, groups };
}
