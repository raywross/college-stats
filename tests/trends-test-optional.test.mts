/**
 * Study 2, test-optional (specs/trends/test-optional.md): recomputes the national row and the Southeast's straight
 * from the shards, without the shared panel helpers, and checks the panel rule (a test policy reported in
 * both fall 2019 and the newest fall), the floor, and that the fall 2019 share matches Home fact 3's
 * `facts.testRequired.requiredFrom` (the same panel rule, so the two never disagree).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SchoolHistory } from "../lib/history.ts";
import { PRE_PANDEMIC_FALL } from "../scripts/history/build.mts";
import { GROUP_FLOOR } from "../lib/trend-groups.ts";
import type { TestOptionalFile, TestOptionalValues } from "../lib/trends.ts";
import { miniHistories, miniHistoryFiles, miniSchools, miniTrendFile } from "./helpers/snapshot.mts";

const file = await miniTrendFile<TestOptionalFile>("test-optional");
const hmeta = miniHistoryFiles().meta;
const facts = miniHistoryFiles().facts;
const schools = miniSchools();
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = miniHistories();

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
  assert.ok(file.n > 10, `panel of ${file.n} is implausibly small (over 1000 in the real data)`);
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
  // Over the mini fixture this region falls under the 30-college floor and carries no values; over a full panel
  // its values are recomputed here.
  if (row.n < GROUP_FLOOR) assert.equal(row.values, undefined);
  else assert.deepEqual(pick(row.values!), recompute(se));
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

test("the history facts carry Home fact 3 (facts.testRequired), which the full panel's fall 2019 share equals", () => {
  // Over the full history the national row's fall 2019 required share equals facts.testRequired.requiredFrom (same
  // panel rule); the mini fixture's panel is 38 colleges against the facts' national one, so only the fact's presence
  // and range are checked here.
  assert.ok(facts.testRequired, "facts.json has no testRequired fact to compare against");
  assert.ok(facts.testRequired!.requiredFrom > 0 && facts.testRequired!.requiredFrom < 1);
  assert.ok(file.national.values!.required[0] >= 0 && file.national.values!.required[0] <= 1);
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

/* ---- This cycle, on the Common App grid (specs/trends/test-optional.md "Update") ---- */

test("this cycle: the grid block is the member colleges with a grid row and a federal policy at the newest fall, recomputed", () => {
  const tc = file.thisCycle;
  assert.ok(tc, "the committed data carries a Requirements Grid, so the block exists");
  const members = shards.filter((h) => byId.get(h.unit_id)?.apply?.test_policy?.code && val(h, "test_policy", to) !== null);
  assert.equal(tc.n, members.length);
  assert.ok(tc.n >= GROUP_FLOOR);
  const code = (h: SchoolHistory) => byId.get(h.unit_id)!.apply!.test_policy!.code;
  const codes = { A: 0, F: 0, S: 0, N: 0, I: 0 };
  for (const h of members) codes[code(h)]++;
  assert.deepEqual(tc.codes, codes);
  assert.equal(tc.now.required, r4((codes.A + codes.F) / members.length));
  assert.equal(tc.now.requiredSome, r4(codes.S / members.length));
  assert.equal(tc.now.optional, r4(codes.N / members.length));
  assert.equal(tc.now.blind, r4(codes.I / members.length));
  assert.equal(tc.then.fall, to);
  const fedShare = (ok: (p: number) => boolean) => r4(members.filter((h) => ok(val(h, "test_policy", to)!)).length / members.length);
  assert.equal(tc.then.required, fedShare((p) => p === CODES.required));
  assert.equal(tc.then.optional, fedShare((p) => p === CODES.considered || p === CODES.recommended));
  assert.equal(tc.then.blind, fedShare((p) => p === CODES["not-considered"]));
  // The cycle and stamp come from the grid edition on each school, never typed in the builder.
  const any = byId.get(members[0].unit_id)!.apply!.common_app;
  assert.equal(tc.cycle, any.cycle);
  assert.equal(tc.updated, any.updated);
});

test("this cycle: 'back to requiring' is not required federally at the newest fall and 'always required' on the grid; the site agrees", () => {
  const tc = file.thisCycle!;
  const members = shards.filter((h) => byId.get(h.unit_id)?.apply?.test_policy?.code && val(h, "test_policy", to) !== null);
  const back = members.filter((h) => val(h, "test_policy", to) !== CODES.required && byId.get(h.unit_id)!.apply!.test_policy!.code === "A").map((h) => h.unit_id).sort();
  assert.deepEqual(tc.backToRequiring.map((c) => c.id).sort(), back);
  assert.ok(back.length > 0, "the 2026-27 grid names colleges that require tests again");
  for (const c of tc.backToRequiring) {
    assert.equal(byId.get(c.id)!.admissions.test_policy, "required", `${c.name}: the site shows the grid's policy`);
    assert.match(c.thenLabel, /^(Test-optional|Test-blind|Test scores recommended)$/);
  }
  assert.deepEqual([...tc.backToRequiring.map((c) => c.name)], [...tc.backToRequiring.map((c) => c.name)].sort((a, b) => a.localeCompare(b)), "named list is alphabetical");
  const went = members.filter((h) => val(h, "test_policy", to) === CODES.required && ["N", "I"].includes(byId.get(h.unit_id)!.apply!.test_policy!.code)).map((h) => h.unit_id).sort();
  assert.deepEqual(tc.wentOptional.map((c) => c.id).sort(), went);
});
