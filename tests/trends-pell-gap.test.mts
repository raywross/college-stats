/**
 * Study 6, the Pell graduation gap (specs/trends/pell-gap.md): recomputes the national row from the committed
 * shards without the shared panel helpers, and checks the panel rule (both rates, 50+ students in both groups, in
 * both entering classes) and the 50-student floor on both groups in both years, plus that no rate is computed where
 * the GR file nulled it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types.ts";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { MAX_PLAUSIBLE_GAP } from "../lib/graduation-groups.ts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { PellGapFile, PellGapValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "pell-gap.json"), "utf8")) as PellGapFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

type Key = "grad_rate_pell" | "grad_rate_no_pell_no_loan" | "grad_cohort_pell" | "grad_cohort_no_pell_no_loan" | "grad_rate";
const val = (h: SchoolHistory, k: Key, y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
/**
 * Neither minus Pell, points; null unless both are reported and the gap is plausible — unrounded, exactly as
 * lib/history.ts pellGapAt computes it (the builder compares this raw value to the 10-point bar before rounding
 * anything, so the test must too, or boundary colleges can land on different sides of 10.0%).
 */
const gap = (h: SchoolHistory, y: number): number | null => {
  const pell = val(h, "grad_rate_pell", y);
  const neither = val(h, "grad_rate_no_pell_no_loan", y);
  if (pell === null || neither === null) return null;
  return Math.abs(neither - pell) > MAX_PLAUSIBLE_GAP ? null : neither - pell;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

const { from, to, minCohort, gapThreshold } = file;
const inPanel = (h: SchoolHistory, y: number) => gap(h, y) !== null && (val(h, "grad_cohort_pell", y) ?? 0) >= minCohort && (val(h, "grad_cohort_no_pell_no_loan", y) ?? 0) >= minCohort;
const panel = shards.filter((h) => [from, to].every((y) => inPanel(h, y)));

/** The then-now values of one set of colleges, computed the long way. */
function recompute(hs: SchoolHistory[]): Pick<PellGapValues, "pellRate" | "neitherRate" | "gap" | "gap10Share" | "overallRate"> {
  const ends = (f: (y: number) => number) => [r4(f(from)), r4(f(to))] as [number, number];
  return {
    pellRate: ends((y) => median(hs.map((h) => val(h, "grad_rate_pell", y)!))),
    neitherRate: ends((y) => median(hs.map((h) => val(h, "grad_rate_no_pell_no_loan", y)!))),
    gap: ends((y) => median(hs.map((h) => gap(h, y)!))),
    gap10Share: ends((y) => hs.filter((h) => gap(h, y)! >= gapThreshold).length / hs.length),
    overallRate: ends((y) => median(hs.map((h) => val(h, "grad_rate", y)).filter((v): v is number => v !== null))),
  };
}

test("window: 8 entering classes, ending with history's newest cohort; 50-student floor; 10-point bar", () => {
  assert.equal(to, hmeta.latest.cohort);
  assert.equal(from, to - 8);
  assert.equal(file.yearKind, "cohort");
  assert.equal(file.minCohort, 50);
  assert.equal(file.gapThreshold, 0.1);
});

test("the panel is every college with both rates and 50+ students in each group, in both entering classes", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 500, `panel of ${file.n} is implausibly small`);
  for (const h of panel) for (const y of [from, to]) {
    assert.ok(val(h, "grad_cohort_pell", y)! >= 50);
    assert.ok(val(h, "grad_cohort_no_pell_no_loan", y)! >= 50);
  }
});

test("national row recomputed from the shards", () => {
  const v = file.national.values!;
  const expected = recompute(panel);
  assert.deepEqual(v.pellRate, expected.pellRate);
  assert.deepEqual(v.neitherRate, expected.neitherRate);
  assert.deepEqual(v.gap, expected.gap);
  assert.deepEqual(v.gap10Share, expected.gap10Share);
  assert.deepEqual(v.overallRate, expected.overallRate);
  // The yearly lines end on the same numbers as the then-now pair.
  const last = (a: (number | null)[]) => a[a.length - 1];
  assert.equal(last(v.lines.pellRate), v.pellRate[1]);
  assert.equal(last(v.lines.neitherRate), v.neitherRate[1]);
  assert.equal(last(v.lines.gap), v.gap[1]);
  assert.equal(v.lines.gap.length, to - file.lineFrom + 1);
});

const pick = (v: PellGapValues) => ({ pellRate: v.pellRate, neitherRate: v.neitherRate, gap: v.gap, gap10Share: v.gap10Share, overallRate: v.overallRate });

test("the Midwest recomputed from the shards (today's region)", () => {
  const row = file.groupings.find((g) => g.grouping === "region")!.groups.find((r) => r.key === "Midwest")!;
  const mw = panel.filter((h) => byId.get(h.unit_id)!.location.region === "Midwest");
  assert.equal(row.n, mw.length);
  assert.deepEqual(pick(row.values!), recompute(mw));
});

test("groups under 30 colleges have no values", () => {
  let tooFew = 0;
  for (const g of file.groupings)
    for (const r of g.groups) {
      if (r.n < GROUP_FLOOR) {
        tooFew++;
        assert.equal(r.values, undefined, `${g.grouping}/${r.key}`);
      }
    }
  assert.ok(tooFew > 0, "today's panel has small groups (for-profits, territories), so the floor is exercised");
});

test("no rate is computed where the GR file nulled it (under 30 students in that group's own cohort)", () => {
  // Every panel member must have both rates reported in both years (the panel rule), so none of this study's own
  // computed medians draw on a null rate; spot-check the raw shards agree.
  for (const h of panel) for (const y of [from, to]) {
    assert.notEqual(val(h, "grad_rate_pell", y), null);
    assert.notEqual(val(h, "grad_rate_no_pell_no_loan", y), null);
  }
});

test("the 8-year outcome-measures companion uses its own, earlier year and the plain 30-college floor", () => {
  assert.ok(file.om8.year <= to, "the OM survey's newest entering class is no later than the study's");
  assert.equal(file.om8.national.n >= 30, true);
  for (const r of file.om8.byControl) if (!r.tooFew) assert.ok(r.n >= 30);
});
