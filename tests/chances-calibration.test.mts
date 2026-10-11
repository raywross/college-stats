/**
 * The season measurements (lib/chances/calibration.ts; specs/chances/method/outcomes.md) on synthetic outcomes: Wilson
 * intervals, the band table, the order check and the Likely-miss flag, the ordinal AUC, Brier of implied frequencies,
 * the held-out-by-season split, inputs switched off, the rigor evidence, student overrides, the sharers' mix, the public
 * summary rows and the Data page's view of them, and the "students like you" suppression (lib/chances/like-you.ts).
 * Guards show each threshold refuses what it should. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ablations,
  allCells,
  brierScore,
  decided,
  heldOutBySeason,
  impliedFrequencies,
  likelyMissFlags,
  likeYouSeasons,
  likeYouVisible,
  LIKE_YOU_MIN,
  LIKE_YOU_SUBCOUNT_MIN,
  MIN_CELL_OUTCOMES,
  orderChecks,
  ordinalAuc,
  overrideComparison,
  planCalibration,
  rateBand,
  RATE_BANDS,
  rigorLowerEvidence,
  sharersMix,
  summaryRows,
  summaryView,
  wilson,
  type OutcomeRow,
} from "../lib/chances/calibration.ts";
import { likeYouCount } from "../lib/chances/like-you.ts";
import type { Group } from "../lib/chances/snapshot.ts";

/* ------------------------------------------------------------------ */
/* Synthetic outcomes                                                  */
/* ------------------------------------------------------------------ */

let seed = 7;
/** A small deterministic generator, so the tests never flake. */
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function row(over: Partial<OutcomeRow> & { admitted?: boolean }): OutcomeRow {
  const { admitted, ...rest } = over;
  return {
    season: 2026,
    unit_id: "100",
    outcome: admitted === undefined ? "admitted" : admitted ? "admitted" : "denied",
    estimate_group: "target",
    admit_rate: 0.4,
    model_version: "2026.1",
    state: "OH",
    test_kind: "sat",
    group_changed: false,
    student_group: null,
    ...rest,
  };
}

/** n outcomes in a cell, `share` of them admitted (rounded). */
function cell(n: number, share: number, over: Partial<OutcomeRow>): OutcomeRow[] {
  const k = Math.round(n * share);
  return Array.from({ length: n }, (_, i) => row({ ...over, admitted: i < k }));
}

/** A season where the groups work: per band, Reach < Target < Likely. */
function goodSeason(season: number, model = "2026.1"): OutcomeRow[] {
  return [
    ...cell(40, 0.1, { season, estimate_group: "reach", admit_rate: 0.12, model_version: model }),
    ...cell(40, 0.35, { season, estimate_group: "target", admit_rate: 0.12, model_version: model }),
    ...cell(40, 0.9, { season, estimate_group: "likely", admit_rate: 0.12, model_version: model }),
    ...cell(35, 0.3, { season, estimate_group: "reach", admit_rate: 0.6, model_version: model }),
    ...cell(35, 0.6, { season, estimate_group: "target", admit_rate: 0.6, model_version: model }),
    ...cell(35, 0.92, { season, estimate_group: "likely", admit_rate: 0.6, model_version: model }),
  ];
}

/* ------------------------------------------------------------------ */
/* Basics                                                              */
/* ------------------------------------------------------------------ */

test("wilson: the 90% interval for 5 of 10, 0 of 20, and 20 of 20; nothing for n = 0", () => {
  const half = wilson(5, 10)!;
  assert.ok(Math.abs(half.low - 0.2693) < 0.0005 && Math.abs(half.high - 0.7307) < 0.0005, JSON.stringify(half));
  const none = wilson(0, 20)!;
  assert.equal(none.low, 0);
  assert.ok(none.high > 0.05 && none.high < 0.15);
  const all = wilson(20, 20)!;
  assert.equal(all.high, 1);
  assert.ok(all.low > 0.85);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(11, 10), null);
});

test("the band table: under 20%, 20–35%, 35–50%, 50–70%, 70%+, lower bound inclusive", () => {
  assert.deepEqual(RATE_BANDS.map((b) => b.key), ["lt20", "20-35", "35-50", "50-70", "70+"]);
  assert.equal(rateBand(0.05), "lt20");
  assert.equal(rateBand(0.2), "20-35");
  assert.equal(rateBand(0.3499), "20-35");
  assert.equal(rateBand(0.35), "35-50");
  assert.equal(rateBand(0.5), "50-70");
  assert.equal(rateBand(0.7), "70+");
  assert.equal(rateBand(1), "70+");
  assert.equal(rateBand(null), null);
  assert.equal(rateBand(1.2), null);
});

test("decided outcomes: admitted, denied, wait-listed count; deferred and undecided don't", () => {
  const rows = decided([row({ outcome: "admitted" }), row({ outcome: "denied" }), row({ outcome: "waitlisted" }), row({ outcome: "deferred" }), row({ outcome: null })]);
  assert.deepEqual(rows.map((r) => r.admitted), [true, false, false]);
});

/* ------------------------------------------------------------------ */
/* Cells, order, Likely misses                                         */
/* ------------------------------------------------------------------ */

test("cells: thin cells keep their count but no share; the order holds where the groups work", () => {
  const cells = allCells(decided(goodSeason(2026)));
  assert.equal(cells.length, RATE_BANDS.length * 3);
  const likelyLow = cells.find((c) => c.group === "likely" && c.band === "lt20")!;
  assert.equal(likelyLow.n, 40);
  assert.equal(likelyLow.share, 36 / 40);
  assert.ok(likelyLow.interval!.low < 0.9 && likelyLow.interval!.high > 0.9);
  const empty = cells.find((c) => c.band === "35-50" && c.group === "reach")!;
  assert.deepEqual([empty.n, empty.share, empty.interval], [0, null, null]);
  const order = orderChecks(cells);
  assert.equal(order.find((o) => o.band === "lt20")!.holds, true);
  assert.equal(order.find((o) => o.band === "50-70")!.holds, true);
  assert.equal(order.find((o) => o.band === "70+")!.holds, null);
});

test("guard: a cell one outcome short of the minimum reports no share", () => {
  const cells = allCells(decided(cell(MIN_CELL_OUTCOMES - 1, 0.5, { estimate_group: "target", admit_rate: 0.4 })));
  assert.equal(cells.find((c) => c.group === "target" && c.band === "35-50")!.share, null);
  const enough = allCells(decided(cell(MIN_CELL_OUTCOMES, 0.5, { estimate_group: "target", admit_rate: 0.4 })));
  assert.equal(enough.find((c) => c.group === "target" && c.band === "35-50")!.share, 0.5);
});

test("the order check flags a band where Target beats Likely; the Likely-miss flag fires above 15%", () => {
  const rows = [
    ...cell(40, 0.2, { estimate_group: "reach", admit_rate: 0.3 }),
    ...cell(40, 0.8, { estimate_group: "target", admit_rate: 0.3 }),
    ...cell(40, 0.7, { estimate_group: "likely", admit_rate: 0.3 }),
  ];
  const cells = allCells(decided(rows));
  assert.equal(orderChecks(cells).find((o) => o.band === "20-35")!.holds, false);
  const misses = likelyMissFlags(cells);
  assert.equal(misses.length, 1);
  assert.equal(misses[0].band, "20-35");
  assert.ok(Math.abs(misses[0].miss - 0.3) < 1e-9);
  // 86% admitted (14% wrong) is within the rule.
  assert.deepEqual(likelyMissFlags(allCells(decided(cell(50, 0.86, { estimate_group: "likely", admit_rate: 0.3 })))), []);
});

/* ------------------------------------------------------------------ */
/* Discrimination and calibration                                      */
/* ------------------------------------------------------------------ */

test("ordinal AUC: 1 when the groups separate perfectly, 0.5 with no signal, 0 reversed, null without both outcomes", () => {
  const perfect = [
    { group: "reach" as Group, admitted: false },
    { group: "target" as Group, admitted: false },
    { group: "likely" as Group, admitted: true },
  ];
  assert.equal(ordinalAuc(perfect), 1);
  assert.equal(ordinalAuc([{ group: "target", admitted: true }, { group: "target", admitted: false }]), 0.5);
  assert.equal(ordinalAuc([{ group: "reach", admitted: true }, { group: "likely", admitted: false }]), 0);
  assert.equal(ordinalAuc([{ group: "likely", admitted: true }]), null);
  // The good season discriminates well; shuffled groups don't.
  const good = decided(goodSeason(2026)).map((r) => ({ group: r.estimate_group, admitted: r.admitted }));
  assert.ok(ordinalAuc(good)! > 0.75);
  const groups: Group[] = ["reach", "target", "likely"];
  const shuffled = good.map((r) => ({ ...r, group: groups[Math.floor(rand() * 3)] }));
  assert.ok(Math.abs(ordinalAuc(shuffled)! - 0.5) < 0.12);
});

test("Brier of implied frequencies: last season's shares scored on this season's outcomes", () => {
  const train = decided(goodSeason(2025));
  const implied = impliedFrequencies(train);
  assert.equal(implied.get("likely|lt20"), 0.9);
  const same = brierScore(implied, decided(goodSeason(2026)))!;
  assert.equal(same.n, 225);
  assert.ok(same.brier < 0.2, `carried-over groups score well (${same.brier})`);
  // If this season's outcomes flip, the carried-over frequencies score badly.
  const flipped = decided(goodSeason(2026)).map((r) => ({ ...r, admitted: !r.admitted }));
  assert.ok(brierScore(implied, flipped)!.brier > same.brier + 0.3);
  assert.equal(brierScore(new Map(), decided(goodSeason(2026))), null);
});

test("held out by season: trains on every earlier season and tests on the latest (never a random split)", () => {
  const rows = [...goodSeason(2024), ...goodSeason(2025), ...goodSeason(2026)];
  const split = heldOutBySeason(rows)!;
  assert.equal(split.testSeason, 2026);
  assert.ok(split.train.every((r) => r.season < 2026));
  assert.ok(split.test.every((r) => r.season === 2026));
  assert.equal(split.train.length + split.test.length, rows.length);
  const mid = heldOutBySeason(rows, 2025)!;
  assert.ok(mid.train.every((r) => r.season === 2024) && mid.test.every((r) => r.season === 2025));
  assert.equal(heldOutBySeason(goodSeason(2026)), null, "one season can't be held out");
  // Guard: no college's season ever lands on both sides.
  const trainKeys = new Set(split.train.map((r) => `${r.unit_id}|${r.season}`));
  assert.ok(split.test.every((r) => !trainKeys.has(`${r.unit_id}|${r.season}`)));
});

/* ------------------------------------------------------------------ */
/* Inputs switched off, rigor, overrides                               */
/* ------------------------------------------------------------------ */

test("ablations: an input that sharpens the groups shows a higher AUC with it than without", () => {
  // With rigor, Likely students are admitted; without it, they'd have read as Target alongside the misses.
  const rows = decided([
    ...cell(40, 0.9, { estimate_group: "likely", without_rigor: "target", without_rank: "likely" }),
    ...cell(40, 0.3, { estimate_group: "target", without_rigor: "target", without_rank: "target" }),
  ]);
  const byInput = Object.fromEntries(ablations(rows).map((a) => [a.input, a]));
  assert.equal(byInput.rigor.n, 80);
  assert.equal(byInput.rigor.changed, 40);
  assert.ok(byInput.rigor.aucWith! > byInput.rigor.aucWithout!);
  assert.equal(byInput.rank.changed, 0);
  assert.equal(byInput.rank.aucWith, byInput.rank.aucWithout);
  assert.equal(byInput.residency.n, 0);
});

test("rigor may lower a group only on non-overlapping intervals at crowded colleges", () => {
  const base = { crowded: true, position: "in" as const, admit_rate: 0.3 };
  const clear = decided([...cell(60, 0.2, { ...base, rigor_reading: "some" }), ...cell(60, 0.7, { ...base, rigor_reading: "most" })]);
  assert.equal(rigorLowerEvidence(clear).met, true);
  const close = decided([...cell(60, 0.45, { ...base, rigor_reading: "some" }), ...cell(60, 0.55, { ...base, rigor_reading: "most" })]);
  assert.equal(rigorLowerEvidence(close).met, false, "overlapping intervals aren't evidence");
  const notCrowded = decided([...cell(60, 0.2, { ...base, crowded: false, rigor_reading: "some" }), ...cell(60, 0.7, { ...base, crowded: false, rigor_reading: "most" })]);
  assert.equal(rigorLowerEvidence(notCrowded).met, false, "only crowded colleges count");
  const thin = decided([...cell(10, 0.0, { ...base, rigor_reading: "some" }), ...cell(10, 1, { ...base, rigor_reading: "most" })]);
  assert.equal(rigorLowerEvidence(thin).met, false, "thin cells aren't evidence");
});

test("student overrides: compares the student's group and the estimate's, through the implied frequencies", () => {
  const season = decided(goodSeason(2026));
  const implied = impliedFrequencies(season);
  // Students who moved a Reach to Likely and were admitted were right; the estimate was not.
  const moved = decided(cell(20, 1, { estimate_group: "reach", student_group: "likely", group_changed: true, admit_rate: 0.12 }));
  const cmp = overrideComparison(moved, implied)!;
  assert.equal(cmp.n, 20);
  assert.ok(cmp.student < cmp.estimate);
  assert.equal(overrideComparison(season, implied), null, "no changed groups, nothing to compare");
});

/* ------------------------------------------------------------------ */
/* The sharers' mix and the public rows                                */
/* ------------------------------------------------------------------ */

test("sharers' mix: shares by band and state (small states pooled), and the test-optional share", () => {
  const rows = decided([
    ...cell(30, 0.5, { state: "OH", admit_rate: 0.1 }),
    ...cell(12, 0.5, { state: "IN", admit_rate: 0.6, test_kind: null }),
    ...cell(4, 0.5, { state: "VT", admit_rate: 0.6 }),
    ...cell(4, 0.5, { state: "WY", admit_rate: 0.6 }),
  ]);
  const mix = sharersMix(rows);
  assert.equal(mix.n, 50);
  assert.deepEqual(mix.bands, { lt20: 0.6, "50-70": 0.4 });
  assert.deepEqual(mix.states, [
    { state: "OH", share: 0.6 },
    { state: "IN", share: 0.24 },
    { state: "Other", share: 0.16 },
  ]);
  assert.equal(mix.testOptional, 0.24);
  assert.ok(!mix.states.some((s) => s.state === "VT" || s.state === "WY"), "a state under the minimum never shows by name");
});

test("summary rows: per model version, a total with the mix, every estimate cell, and the student-change cells", () => {
  const rows = [
    ...goodSeason(2026, "2026.1"),
    ...cell(5, 0.2, { season: 2026, estimate_group: "reach", student_group: "target", group_changed: true, admit_rate: 0.12 }),
    ...goodSeason(2025, "2025.9"),
    row({ season: 2026, estimate_group: null }),
    row({ season: 2026, model_version: null }),
  ];
  const out = summaryRows(rows, 2026, "2027-09-15");
  assert.deepEqual([...new Set(out.map((r) => r.model_version))], ["2026.1"]);
  const total = out.filter((r) => r.scope === "all");
  assert.equal(total.length, 1);
  assert.equal(total[0].n, 230, "rows without a group or a version don't count");
  assert.ok(total[0].sharers_mix && total[0].estimate_group === null && total[0].rate_band === null);
  const est = out.filter((r) => r.scope === "estimate");
  assert.equal(est.length, 15);
  const reachLow = est.find((r) => r.estimate_group === "reach" && r.rate_band === "lt20")!;
  assert.equal(reachLow.n, 45);
  assert.equal(reachLow.admitted, 5);
  assert.ok(reachLow.interval_low! <= reachLow.admitted! / reachLow.n && reachLow.interval_high! >= reachLow.admitted! / reachLow.n);
  const stu = out.filter((r) => r.scope === "student");
  const thin = stu.find((r) => r.estimate_group === "target" && r.rate_band === "lt20")!;
  assert.deepEqual([thin.n, thin.admitted, thin.interval_low, thin.interval_high], [5, null, null, null], "thin cells keep the count only");
  for (const r of out) assert.ok(!("unit_id" in r) && !("state" in r), "no row-level data");
  assert.ok(out.every((r) => r.next_summary_on === "2027-09-15"));
});

test("planCalibration: no outcomes yet → empty; otherwise the report and the rows", () => {
  assert.deepEqual(planCalibration([], 2026, null), { status: "empty" });
  assert.deepEqual(planCalibration([row({ outcome: "deferred" })], 2026, null), { status: "empty" });
  const plan = planCalibration([...goodSeason(2025), ...goodSeason(2026)], 2026, null);
  assert.equal(plan.status, "ok");
  if (plan.status !== "ok") return;
  assert.equal(plan.report.outcomes, 225);
  assert.ok(plan.report.auc.overall! > 0.75);
  assert.deepEqual(plan.report.heldOutBrier?.trainedOn, [2025]);
  assert.ok(plan.summary.length > 0);
});

test("the Data page's view: the latest season, counts and intervals, the student comparison, nothing when empty", () => {
  assert.equal(summaryView([]), null);
  const rows = [...summaryRows(goodSeason(2025), 2025, null), ...summaryRows([...goodSeason(2026), ...cell(40, 0.8, { season: 2026, estimate_group: "reach", student_group: "likely", group_changed: true, admit_rate: 0.6 })], 2026, "2027-09-15")];
  const view = summaryView(rows)!;
  assert.equal(view.season, 2026);
  assert.deepEqual(view.modelVersions, ["2026.1"]);
  assert.equal(view.nextSummaryOn, "2027-09-15");
  assert.equal(view.total, 265);
  assert.equal(view.bands.length, 5);
  assert.equal(view.bands[0].cells.likely.share, 0.9);
  assert.equal(view.bands[2].cells.likely.share, null, "an empty band says not enough outcomes");
  assert.equal(view.student.likely.n, 40);
  assert.equal(view.student.likely.share, 0.8);
  assert.equal(view.student.reach.share, null);
  assert.ok(view.mix && view.mix.n === 265);
});

/* ------------------------------------------------------------------ */
/* "Students like you"                                                 */
/* ------------------------------------------------------------------ */

test("like-you suppression: at least 50 outcomes, and at least 10 each admitted and not", () => {
  assert.equal(LIKE_YOU_MIN, 50);
  assert.equal(LIKE_YOU_SUBCOUNT_MIN, 10);
  assert.equal(likeYouVisible(63, 47), true);
  assert.equal(likeYouVisible(50, 10), true);
  assert.equal(likeYouVisible(49, 20), false, "a cell under 50");
  assert.equal(likeYouVisible(60, 9), false, "fewer than 10 admitted");
  assert.equal(likeYouVisible(60, 51), false, "fewer than 10 not admitted");
  assert.equal(likeYouVisible(Number.NaN, 10), false);
  assert.deepEqual(likeYouSeasons(2027), [2025, 2027]);
});

function rpcClient(result: { data: unknown; error: unknown } | (() => never)) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (typeof result === "function") return result();
        return result;
      },
    } as never,
  };
}

test("likeYouCount: the cell's counts over the last three finished seasons, state only for a residency rate", async () => {
  const { calls, client } = rpcClient({ data: [{ n: 63, admitted: 47 }], error: null });
  const c = await likeYouCount({ unitId: "243780", position: "in", baseRateKind: "residency", state: "IN" }, { client, today: "2027-10-01" });
  assert.deepEqual(c, { n: 63, admitted: 47, seasons: [2025, 2027] });
  assert.equal(calls[0].fn, "chances_like_you");
  assert.deepEqual(calls[0].args, { p_unit: "243780", p_position: "in", p_base_rate_kind: "residency", p_state: "IN", p_from_season: 2025, p_to_season: 2027 });
  const other = rpcClient({ data: [{ n: 63, admitted: 47 }], error: null });
  await likeYouCount({ unitId: "243780", position: "in", baseRateKind: "overall", state: "IN" }, { client: other.client, today: "2027-10-01" });
  assert.equal(other.calls[0].args.p_state, null);
});

test("likeYouCount: null until data exists (no client, missing function, no row, a thin cell, an error)", async () => {
  const q = { unitId: "243780", position: "in" as const, baseRateKind: "overall" as const, state: null };
  assert.equal(await likeYouCount(q, { client: null }), null);
  assert.equal(await likeYouCount(q, { client: rpcClient({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }).client }), null);
  assert.equal(await likeYouCount(q, { client: rpcClient({ data: [], error: null }).client }), null);
  // Guard: even if the database returned a thin cell, this module doesn't show it.
  assert.equal(await likeYouCount(q, { client: rpcClient({ data: [{ n: 40, admitted: 20 }], error: null }).client }), null);
  assert.equal(await likeYouCount(q, { client: rpcClient({ data: [{ n: 80, admitted: 75 }], error: null }).client }), null);
  assert.equal(await likeYouCount(q, { client: rpcClient(() => { throw new Error("down"); }).client }), null);
  assert.equal(await likeYouCount({ ...q, unitId: "x; drop" }, { client: rpcClient({ data: [{ n: 63, admitted: 47 }], error: null }).client }), null);
});
