/**
 * Study 2, test-optional (specs/trends/test-optional.md): recomputes the national row and the Southeast's straight
 * from the committed shards, without the shared panel helpers, and checks the panel rule (a test policy reported in
 * both fall 2019 and the newest fall), the floor, and that the fall 2019 share matches Home fact 3's
 * `facts.testRequired.requiredFrom` (the same panel rule, so the two never disagree).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { HistoryMeta, SchoolHistory, TrendFacts } from "../lib/history.ts";
import { PRE_PANDEMIC_FALL } from "../scripts/history/build.mts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { TestOptionalFile, TestOptionalValues } from "../lib/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const HISTORY = join(ROOT, "data", "history");
const file = JSON.parse(readFileSync(join(HISTORY, "trends", "test-optional.json"), "utf8")) as TestOptionalFile;
const hmeta = JSON.parse(readFileSync(join(HISTORY, "meta.json"), "utf8")) as HistoryMeta;
const facts = JSON.parse(readFileSync(join(HISTORY, "facts.json"), "utf8")) as TrendFacts;
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = readdirSync(join(HISTORY, "schools"))
  .filter((f) => f.endsWith(".json") && byId.has(f.replace(/\.json$/, "")))
  .map((f) => JSON.parse(readFileSync(join(HISTORY, "schools", f), "utf8")) as SchoolHistory);

const CODES = { required: 1, recommended: 2, "not-considered": 3, considered: 5 } as const;
const val = (h: SchoolHistory, k: "test_policy" | "sat_submit" | "act_submit", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? s.values[y - s.start] : null;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
};
const r4 = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

const { from, to } = file;

test("the window is fixed at fall 2019 (the pandemic baseline), not a rolling window", () => {
  assert.equal(from, PRE_PANDEMIC_FALL);
  assert.equal(from, 2019);
  assert.equal(to, hmeta.latest.fall);
  assert.equal(file.yearKind, "fall");
  assert.equal(file.blindFrom, 2022);
});

const panel = shards.filter((h) => [from, to].every((y) => val(h, "test_policy", y) !== null));

test("the panel is every college reporting a test policy in both fall 2019 and the newest fall", () => {
  assert.equal(file.n, panel.length);
  assert.ok(file.n > 1000, `panel of ${file.n} is implausibly small`);
  for (const h of panel) for (const y of [from, to]) assert.ok(val(h, "test_policy", y) !== null);
});

/** The then-now values of one set of colleges, computed the long way. */
function recompute(hs: SchoolHistory[]): Pick<TestOptionalValues, "required" | "satSubmitMedian" | "actSubmitMedian"> {
  const ends = (f: (y: number) => number) => [r4(f(from)), r4(f(to))] as [number, number];
  const share = (y: number, test: (h: SchoolHistory) => boolean) => hs.filter(test).length / hs.length;
  return {
    required: ends((y) => share(y, (h) => val(h, "test_policy", y) === CODES.required)),
    satSubmitMedian: ends((y) => median(hs.map((h) => val(h, "sat_submit", y)).filter((v): v is number => v !== null))),
    actSubmitMedian: ends((y) => median(hs.map((h) => val(h, "act_submit", y)).filter((v): v is number => v !== null))),
  };
}

const pick = (v: TestOptionalValues) => ({ required: v.required, satSubmitMedian: v.satSubmitMedian, actSubmitMedian: v.actSubmitMedian });

test("national row recomputed from the shards", () => {
  assert.deepEqual(pick(file.national.values!), recompute(panel));
  const v = file.national.values!;
  const last = (a: (number | null)[]) => a[a.length - 1];
  assert.equal(last(v.lines.required), v.required[1]);
  assert.equal(v.lines.required.length, to - file.lineFrom + 1);
  // The test-blind line starts at blindFrom, not lineFrom.
  assert.equal(v.lines.blind.length, to - file.blindFrom + 1);
});

test("the Southeast recomputed from the shards (today's region)", () => {
  const row = file.groupings.find((g) => g.grouping === "region")!.groups.find((r) => r.key === "Southeast")!;
  const se = panel.filter((h) => byId.get(h.unit_id)!.location.region === "Southeast");
  assert.equal(row.n, se.length);
  assert.deepEqual(pick(row.values!), recompute(se));
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

test("fall 2019's required share matches Home fact 3 (facts.testRequired.requiredFrom): same panel rule", () => {
  assert.ok(facts.testRequired, "facts.json has no testRequired fact to compare against");
  assert.equal(file.national.values!.required[0], facts.testRequired!.requiredFrom);
});

test("score-range groups are mutually exclusive and only cover colleges with both SAT percentiles in both years", () => {
  const keys = file.scoreRanges.map((r) => r.key);
  assert.deepEqual(keys, ["dropped", "required-both", "optional-both"]);
  for (const r of file.scoreRanges) {
    if (r.tooFew) {
      assert.equal(r.p25, undefined);
      assert.equal(r.p75, undefined);
    } else {
      assert.ok(r.n >= GROUP_FLOOR, `${r.key} has ${r.n} colleges, under the floor, but wasn't marked tooFew`);
      assert.ok(r.p25 && r.p75);
    }
  }
});

test("colleges that went back to requiring tests weren't required in fall 2022 but are required now", () => {
  for (const c of file.wentBackToRequiring) {
    const h = shards.find((s) => s.unit_id === c.id);
    assert.ok(h, `${c.id} has no history shard`);
    assert.notEqual(val(h!, "test_policy", file.blindFrom), CODES.required);
    assert.equal(val(h!, "test_policy", to), CODES.required);
  }
});
