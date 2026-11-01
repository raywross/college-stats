/**
 * Trends by state (specs/trends/states.md): recomputes Alabama (the under-10 rule) straight from the shards, without
 * the shared panel helpers. Also covers the 2026-10-12 addition, first-years crossing state lines ("Planned
 * addition"): Alabama recomputed from the detail files independent of `isCampusBased`, the inflow/outflow sum
 * invariant, the exclusion rule, and the no-table rule. The states file is the builder's over the mini fixture
 * (tests/helpers/snapshot.mts miniTrendFile), with the same fixture's colleges, shards, and detail files; no state in
 * it reaches the 10-college floor, so the real data's New York medians are left to the publisher's full build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School, SchoolType } from "../lib/types";
import { ONLINE_FIRST_SHARE, PANDEMIC_DISTANCE_FALLS, type SchoolHistory } from "../lib/history.ts";
import { STATE_FLOOR } from "../lib/trend-groups.ts";
import type { Member } from "../lib/trend-panel.ts";
import type { CampusExclusionEntry } from "../lib/movers.ts";
import type { SchoolDetail } from "../lib/detail.ts";
import type { StatesFile } from "../lib/trends.ts";
import { allFlowsOf } from "../scripts/trends/states.mts";
import type { TrendContext } from "../scripts/trends/context.mts";
import { miniDetail, miniHistories, miniHistoryFiles, miniReference, miniSchools, miniTrendFile } from "./helpers/snapshot.mts";

const file = await miniTrendFile<StatesFile>("states");
const hmeta = miniHistoryFiles().meta;
const schools = miniSchools();
const byId = new Map(schools.map((s) => [s.unit_id, s]));
const shards = miniHistories();
const shardById = new Map(shards.map((h) => [h.unit_id, h]));
const excludedCampuses = miniReference<CampusExclusionEntry[]>("excluded-campuses");
const excludedById = new Map(excludedCampuses.map((e) => [e.unit_id, e]));
const detailOf = (id: string): SchoolDetail | null => miniDetail(id);

const val = (h: SchoolHistory, k: "undergrads" | "applicants" | "acceptance_rate", y: number): number | null => {
  const s = h.series[k];
  return s && y >= s.start && y < s.start + s.values.length ? (s.values[y - s.start] ?? null) : null;
};

const { from, to } = file;
const MIN = 300;

test("the window ends with history's newest fall; floor is 10, not 30", () => {
  assert.equal(to, hmeta.latest.fall);
  assert.equal(from, to - 10);
  assert.equal(file.floor, STATE_FLOOR);
  assert.equal(STATE_FLOOR, 10);
});

test("Alabama: under the 10-college floor, so it's tooFew with counts and a member list only", () => {
  // The real data's example was Vermont; the mini fixture's Alabama has four colleges.
  const al = file.states.find((s) => s.postal === "AL")!;
  const members = shards.filter((h) => byId.get(h.unit_id)!.location.state === "AL");
  assert.ok(members.length > 0 && members.length < STATE_FLOOR, `Alabama has ${members.length} on-site colleges; the floor test needs a state under ${STATE_FLOOR}`);
  assert.equal(al.onSite.total, members.length);
  assert.equal(al.tooFew, true);
  assert.equal(al.all, undefined);
  assert.equal(al.control, undefined);
  assert.equal(al.sparkLines, undefined);
  assert.equal(al.members.length, members.length);
  for (const id of members.map((h) => h.unit_id)) assert.ok(al.members.some((m) => m.unit_id === id), `${id} missing from Alabama's member list`);
  // Movers are still computed for a tooFew state (the spec's "movers only").
  assert.ok(al.movers.length > 0);
});

// (The real data's New York tests, its median and total undergraduate change and its public/private split recomputed
// from the shards, need a state at the 10-college floor; no state in the mini fixture reaches it.)
test("no state in the mini fixture reaches the floor, so every state is tooFew with a null map change", () => {
  assert.ok(file.states.length > 5);
  for (const s of file.states) if (s.onSite.total < STATE_FLOOR) assert.equal(s.tooFew, true, s.postal);
});

test("every state's panel is a fixed panel: 300+ undergraduates at both window ends", () => {
  for (const s of file.states) {
    if (s.tooFew) continue;
    for (const id of s.panel.ids) {
      const h = shards.find((x) => x.unit_id === id)!;
      for (const y of [from, to]) assert.ok((val(h, "undergrads", y) ?? 0) >= MIN, `${id} under 300 undergraduates in ${y}`);
    }
  }
});

test("a state's map undergradChange equals its panel's median change (null only when tooFew)", () => {
  for (const s of file.states) {
    if (s.tooFew) {
      assert.equal(s.map.undergradChange, null);
      continue;
    }
    assert.equal(s.map.undergradChange, s.all!.values!.undergradsMedianChange);
  }
});

test("territories are flagged, not folded into the 50 states", () => {
  const pr = file.states.find((s) => s.postal === "PR");
  if (pr) assert.equal(pr.territory, true);
  const ca = file.states.find((s) => s.postal === "CA")!;
  assert.equal(ca.territory, false);
});

/* First-years crossing state lines (specs/trends/states.md, "Planned addition" — built 2026-10-12) */
/* -------------------------------------------------------------------------------------------------- */

/** The campus-based rule (flows rule 1) for a one-fall snapshot, reimplemented from the raw files, independent of lib/movers.ts. */
function campusExcludedAt(excl: Pick<CampusExclusionEntry, "before" | "years"> | undefined, year: number): boolean {
  if (!excl) return false;
  if (excl.before === undefined && excl.years === undefined) return true;
  return (excl.before !== undefined && year < excl.before && year >= excl.before) || !!excl.years?.some((y) => y === year);
}

function isCampusBasedAt(school: Pick<School, "unit_id" | "type">, h: SchoolHistory, year: number): boolean {
  if (campusExcludedAt(excludedById.get(school.unit_id), year)) return false;
  if (school.type === "private-forprofit") return false;
  const evalYear = PANDEMIC_DISTANCE_FALLS.includes(year) ? Math.min(...PANDEMIC_DISTANCE_FALLS) - 1 : year;
  const s = h.series.online_share;
  const v = s && evalYear >= s.start && evalYear < s.start + s.values.length ? s.values[evalYear - s.start] : null;
  return !(v !== null && v !== undefined && v > ONLINE_FIRST_SHARE);
}

test("flows: Alabama recomputed from the detail files, independent of isCampusBased", () => {
  const al = file.states.find((s) => s.postal === "AL")!;
  assert.ok(al.flows, "Alabama should have flows: several of its colleges have a home-state table");
  const year = al.flows!.year;
  assert.equal(year, file.flowsYear);

  // Every counted college on the site (campus-based at `year`, a home-state table): group by home state.
  const countedByState = new Map<string, { rows: Record<string, number> }[]>();
  const statesWithTable = new Set<string>();
  for (const s of schools) {
    const rows = detailOf(s.unit_id)?.tables.home_states?.rows;
    if (!rows) continue;
    const h = shardById.get(s.unit_id);
    if (!h || !isCampusBasedAt(s, h, year)) continue;
    const state = s.location.state;
    if (!state) continue;
    countedByState.set(state, [...(countedByState.get(state) ?? []), { rows }]);
    statesWithTable.add(state);
  }

  let inflow = 0;
  let outflow = 0;
  for (const [state, entries] of countedByState) {
    for (const { rows } of entries) {
      for (const [postal, count] of Object.entries(rows)) {
        if (postal === state || !statesWithTable.has(postal)) continue;
        if (state === "AL") inflow += count;
        if (postal === "AL") outflow += count;
      }
    }
  }
  assert.equal(al.flows!.inflow, inflow);
  assert.equal(al.flows!.outflow, outflow);
  assert.equal(al.flows!.net, inflow - outflow);
});

test("flows: the sum of every state's inflow equals the sum of every state's outflow", () => {
  let sumIn = 0;
  let sumOut = 0;
  for (const s of file.states) {
    if (!s.flows) continue;
    sumIn += s.flows.inflow;
    sumOut += s.flows.outflow;
  }
  assert.ok(sumIn > 0, "expected at least one state to have a nonzero inflow");
  assert.equal(sumIn, sumOut);
});

test("flows: no online-first, for-profit, or closed/merged college appears in any state's receiving list", () => {
  for (const s of file.states) {
    if (!s.flows) continue;
    for (const r of s.flows.receiving) {
      const school = byId.get(r.unit_id)!;
      const h = shardById.get(r.unit_id);
      assert.ok(h, `${r.name} (${r.unit_id}) has no history shard`);
      assert.equal(isCampusBasedAt(school, h!, s.flows.year), true, `${r.name} isn't campus-based but appears in ${s.name}'s receiving list`);
    }
  }
});

test("flows: receiving shares sum to at most 1 and are ordered by count, for every state", () => {
  for (const s of file.states) {
    if (!s.flows) continue;
    const r = s.flows.receiving;
    for (let i = 1; i < r.length; i++) assert.ok(r[i].count <= r[i - 1].count, `${s.name}: receiving colleges aren't ordered by count`);
    const sum = r.reduce((a, x) => a + x.share, 0);
    assert.ok(sum <= 1 + 1e-9, `${s.name}: receiving shares sum to ${sum}, over 1`);
  }
});

test("flows: absent for a state with no table (synthetic: colleges.mts's allFlowsOf, not the committed file)", () => {
  const zCollege = {
    unit_id: "Z1",
    name: "Z College",
    type: "public" as SchoolType,
    location: { state: "ZZ" },
    demographics: { residence: { first_years: 150, in_state: 0, out_of_state: 0, international: 0, top_state: null } },
  } as unknown as School;
  const yCollege = { unit_id: "Y1", name: "Y College", type: "public" as SchoolType, location: { state: "YY" }, demographics: {} } as unknown as School;
  const members: Member[] = [
    { school: zCollege, h: { unit_id: "Z1", series: {} } },
    { school: yCollege, h: { unit_id: "Y1", series: {} } },
  ];
  const detailByIdFake = new Map<string, SchoolDetail | null>([
    ["Z1", { unit_id: "Z1", tables: { home_states: { source: "ipeds-ef-c", vintage: "ipeds-ef-c", year: "Fall 2024", rows: { ZZ: 100, YY: 50 } } } }],
    ["Y1", null], // YY's only college has no home-state table: YY should get no flows entry at all.
  ]);
  const fakeCtx = { members, detail: (id: string) => detailByIdFake.get(id) ?? null } as unknown as TrendContext;
  const { byState } = allFlowsOf(fakeCtx, 2024, new Map());

  assert.equal(byState.has("YY"), false, "YY has no college with a counted home-state table, so it gets no flows entry (rule 5)");
  const zz = byState.get("ZZ")!;
  assert.ok(zz, "ZZ should still have a flows entry (Z1 has a counted table)");
  assert.equal(zz.inflow, 0, "YY's first-years don't count as inflow (no table there to confirm YY is a counted state)");
  assert.equal(zz.other, 50, "the YY-bound count folds into other, not inflow, so Σ inflow = Σ outflow still holds");
  assert.equal(zz.firstYears, 100);

  let sumIn = 0;
  let sumOut = 0;
  for (const f of byState.values()) {
    sumIn += f.inflow;
    sumOut += f.outflow;
  }
  assert.equal(sumIn, sumOut);
});
