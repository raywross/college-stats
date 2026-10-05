/**
 * Study 1, men and women in admissions (specs/national-trends.md#study-1-men-and-women-in-admissions): recomputes the
 * national row and the Northeast's straight from the committed shards, without the shared panel helpers, and checks
 * the panel rule (both rates and 1,000+ applicants at both ends) and the floor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory } from "../lib/history.ts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { MenAndWomenFile, MenAndWomenValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "men-and-women.json"), "utf8")) as MenAndWomenFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const val = (h: SchoolHistory, k: "admit_rate_men" | "admit_rate_women" | "applicants", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const gap = (h: SchoolHistory, y: number) => {
  const m = val(h, "admit_rate_men", y);
  const w = val(h, "admit_rate_women", y);
  return m === null || w === null ? null : Math.round((m - w) * 10_000) / 10_000;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

const { from, to } = file;
const panel = shards.filter((h) => [from, to].every((y) => gap(h, y) !== null && (val(h, "applicants", y) ?? 0) >= 1000));

/** The then-now values of one set of colleges, computed the long way. */
function recompute(hs: SchoolHistory[]): Pick<MenAndWomenValues, "menHigher" | "womenHigher" | "medianGap" | "weightedMen" | "weightedWomen"> {
  const ends = (f: (y: number) => number) => [r4(f(from)), r4(f(to))] as [number, number];
  const share = (y: number, test: (g: number) => boolean) => hs.filter((h) => test(gap(h, y)!)).length / hs.length;
  const weighted = (y: number, k: "admit_rate_men" | "admit_rate_women") =>
    hs.reduce((a, h) => a + val(h, k, y)! * val(h, "applicants", y)!, 0) / hs.reduce((a, h) => a + val(h, "applicants", y)!, 0);
  return {
    menHigher: ends((y) => share(y, (g) => g >= 0.03)),
    womenHigher: ends((y) => share(y, (g) => g <= -0.03)),
    medianGap: ends((y) => median(hs.map((h) => gap(h, y)!))),
    weightedMen: ends((y) => weighted(y, "admit_rate_men")),
    weightedWomen: ends((y) => weighted(y, "admit_rate_women")),
  };
}

const pick = (v: MenAndWomenValues) => ({ menHigher: v.menHigher, womenHigher: v.womenHigher, medianGap: v.medianGap, weightedMen: v.weightedMen, weightedWomen: v.weightedWomen });

test("window: 20 falls ending with history's newest; 3-point bar; 1,000-applicant floor", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 20);
  assert.equal(file.threshold, 0.03);
  assert.equal(file.minApplicants, 1000);
  assert.equal(file.yearKind, "fall");
});

test("the panel is every college with both rates and 1,000+ applicants in both falls", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 500, `panel of ${file.n} is implausibly small`);
  for (const h of panel) for (const y of [from, to]) assert.ok(val(h, "applicants", y)! >= 1000);
});

test("national row recomputed from the shards", () => {
  assert.deepEqual(pick(file.national.values!), recompute(panel));
  // The yearly lines end on the same numbers as the then-now pair.
  const v = file.national.values!;
  const last = (a: (number | null)[]) => a[a.length - 1];
  assert.equal(last(v.lines.menHigher), v.menHigher[1]);
  assert.equal(last(v.lines.womenHigher), v.womenHigher[1]);
  assert.equal(last(v.lines.medianGap), v.medianGap[1]);
  assert.equal(v.lines.menHigher.length, to - file.lineFrom + 1);
});

test("the Northeast recomputed from the shards (today's region)", () => {
  const row = file.groupings.find((g) => g.grouping === "region")!.groups.find((r) => r.key === "Northeast")!;
  const ne = panel.filter((h) => byId.get(h.unit_id)!.location.region === "Northeast");
  assert.equal(row.n, ne.length);
  assert.deepEqual(pick(row.values!), recompute(ne));
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
  assert.ok(tooFew > 0, "today's panel has small groups (territories, for-profits), so the floor is exercised");
});
