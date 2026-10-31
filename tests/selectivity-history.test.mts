/**
 * Quad's selectivity history (specs/chances/selectivity-history.md "Tests"): which rows a publish records
 * (scripts/lib/selectivity-history.mts historyRows: one per college, the three pools side by side, only when something
 * changed), reading every recorded row back past the 1,000-row page, the inputs each row carries, the method guard
 * (scripts/lib/selectivity-method.mts), and the console's words for a change (lib/admin/selectivity-history-view.ts).
 * The tables and functions are tested against Postgres in admin-policies.test.mts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { SELECTIVITY_METHOD } from "../lib/selectivity.ts";
import { PAGE, advance, historyRows, historyRun, inputsFor, readAllPages, recordedMap, type CollegeState, type HistoryRow, type SelectivityAt } from "../scripts/lib/selectivity-history.mts";
import { methodProblems, readMethodSample, scoreSample } from "../scripts/lib/selectivity-method.mts";
import type { SelectivityIndexFile } from "../scripts/lib/selectivity.mts";
import { DISPLAY_MOVE_MIN, inputChanges, isDrift, runChangesOf, tierMoves, withPrevious, type Pool, type SelectivityPoint } from "../lib/admin/selectivity-history-view.ts";

const ROOT = join(import.meta.dirname, "..");
const SCHOOLS: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const META: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const UT = SCHOOLS.find((s) => s.unit_id === "228778")!;
const HARVARD = SCHOOLS.find((s) => s.unit_id === "166027")!;

/** A one- or two-college "commit": the index entries and the colleges' stored tiers. */
function at(colleges: { school: School; entry: SelectivityIndexFile["colleges"][string]; selectivity?: School["selectivity"] }[], method = SELECTIVITY_METHOD): SelectivityAt {
  return {
    index: { generated: "2026-10-13", method, elite_index: 80, elite_count: 1, counts: {} as SelectivityIndexFile["counts"], colleges: Object.fromEntries(colleges.map((c) => [c.school.unit_id, c.entry])) },
    schools: colleges.map((c) => ({ ...c.school, selectivity: c.selectivity ?? c.school.selectivity })),
    meta: META,
    method,
  };
}

const utNow = { school: UT, entry: { all: 72.45, rank: 58, in_state: 68.15, out_of_state: 80.49 } };
const harvard = (all: number) => ({ school: HARVARD, entry: { all, rank: 2 } });

/** What the history holds after recording a commit from nothing. */
const recorded = (commit: SelectivityAt) => advance(new Map(), historyRows(new Map(), commit, { lastMethod: null }));
const utBefore = { school: UT, entry: { all: 70.92, rank: 61 }, selectivity: { tier: "highly_selective" as const, year: "Fall 2024" } };
const pools = (r: HistoryRow) => [r.score_all, r.tier_all, r.score_in_state, r.tier_in_state, r.score_out_of_state, r.tier_out_of_state];

test("UT Austin's fall 2025 Common Data Set: one row, with all applicants, in-state, and out-of-state side by side", () => {
  const rows = historyRows(recorded(at([utBefore])), at([utNow]), { lastMethod: SELECTIVITY_METHOD });
  assert.equal(rows.length, 1, "one row per college, not one per pool");
  assert.deepEqual(pools(rows[0]), [72.45, "highly_selective", 68.15, "highly_selective", 80.49, "elite"]);
  assert.equal(rows[0].cause, "data");
  assert.equal(rows[0].tier_year, "Fall 2025");
  assert.equal(rows[0].rank, 58);
  // The inputs are what the scores read, with the year and source of each, including each pool's own admit rate.
  assert.deepEqual(rows[0].inputs.admit_rate, { v: 0.2222, year: "Fall 2025", source: "college-site" });
  assert.equal(rows[0].inputs.admit_rate_out_of_state.v, 0.0752);
  assert.ok(rows[0].inputs.admit_rate_in_state.v! > rows[0].inputs.admit_rate_out_of_state.v!);
});

test("nothing changed, nothing recorded: re-publishing the same data writes no row and no run", () => {
  const same = at([utNow, harvard(91.65)]);
  const prev = recorded(same);
  for (let i = 0; i < 5; i++) assert.deepEqual(historyRows(prev, same, { lastMethod: SELECTIVITY_METHOD }), [], `publish ${i + 1}`);
});

test("every real change is a row (no threshold): a 0.01 drift, one pool moving, a rank-only move, an input that moved", () => {
  const prev = recorded(at([harvard(91.65), utNow]));
  assert.deepEqual(
    historyRows(prev, at([harvard(91.66), utNow]), { lastMethod: SELECTIVITY_METHOD }).map((r) => [r.unit_id, r.score_all, r.cause]),
    [["166027", 91.66, "data"]],
  );
  const outOnly = historyRows(prev, at([harvard(91.65), { ...utNow, entry: { ...utNow.entry, out_of_state: 80.5 } }]), { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(outOnly.map((r) => [r.unit_id, r.score_all, r.score_out_of_state]), [["228778", 72.45, 80.5]], "one pool moved: one row carrying all three");
  const rankOnly = historyRows(prev, at([{ school: HARVARD, entry: { all: 91.65, rank: 3 } }, utNow]), { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(rankOnly.map((r) => [r.rank, r.cause]), [[3, "data"]]);
  const newYear = { ...HARVARD, outcomes: { ...HARVARD.outcomes, retention_rate: (HARVARD.outcomes?.retention_rate ?? 0.97) - 0.001 } } as School;
  assert.equal(historyRows(prev, at([{ school: newYear, entry: { all: 91.65, rank: 2 } }, utNow]), { lastMethod: SELECTIVITY_METHOD }).length, 1);
});

test("rows read back from the table compare equal to what was written (numerics as strings, keys in any order)", () => {
  const same = at([utNow]);
  const written = historyRows(new Map(), same, { lastMethod: null })[0];
  const fromDb = {
    ...written,
    score_all: String(written.score_all),
    score_in_state: String(written.score_in_state),
    score_out_of_state: String(written.score_out_of_state),
    inputs: Object.fromEntries(Object.entries(written.inputs).reverse()),
  } as unknown as CollegeState;
  assert.deepEqual(historyRows(recordedMap([fromDb]), same, { lastMethod: SELECTIVITY_METHOD }), []);
});

test("every recorded college is read back, past the 1,000-row page (the cause of the repeated rows)", async () => {
  const states = Array.from({ length: 2345 }, (_, i) => ({ unit_id: String(100000 + i) }));
  const calls: [number, number][] = [];
  const rows = await readAllPages((from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: states.slice(from, to + 1), error: null });
  }, "rows");
  assert.equal(rows.length, 2345);
  assert.deepEqual(calls, [
    [0, PAGE - 1],
    [PAGE, 2 * PAGE - 1],
    [2 * PAGE, 3 * PAGE - 1],
  ]);
});

test("a method change records every college; a lost pool or rating is recorded; a first row is new; backfill marks every row", () => {
  const same = at([utNow, harvard(91.65)]);
  const prev = recorded(same);
  const method = historyRows(prev, same, { lastMethod: "2026.10.12.2" });
  assert.equal(method.length, 2);
  assert.ok(method.every((r) => r.cause === "method"));
  assert.equal(historyRun(same, { gitCommit: "abc1234", publishedAt: "2026-10-13T00:00:00Z", lastMethod: "2026.10.12.2" }).cause, "method");

  // UT loses its residency rates: one data row with the two pools null.
  const noPools = at([{ school: UT, entry: { all: 72.45, rank: 58 }, selectivity: { tier: "highly_selective", year: "Fall 2025" } }, harvard(91.65)]);
  const lost = historyRows(prev, noPools, { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(lost.map((r) => [r.unit_id, r.cause, ...pools(r)]), [["228778", "data", 72.45, "highly_selective", null, null, null, null]]);
  // Harvard leaves the index altogether: unrated, every pool null.
  const gone = historyRows(prev, at([utNow]), { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(gone.map((r) => [r.unit_id, r.cause, ...pools(r)]), [["166027", "unrated", null, null, null, null, null, null]]);

  const first = historyRows(new Map(), same, { lastMethod: SELECTIVITY_METHOD });
  assert.ok(first.every((r) => r.cause === "new"));
  const backfill = historyRows(new Map(), same, { lastMethod: null, backfill: true });
  assert.ok(backfill.length === 2 && backfill.every((r) => r.cause === "backfill"));
  assert.equal(historyRun(same, { gitCommit: "abc1234", publishedAt: "2026-10-12T00:00:00Z", lastMethod: null, backfill: true }).cause, "backfill");
});

test("held is read only under today's method; a missing SAT is marked filled in", () => {
  const old = historyRows(new Map(), at([utNow], "2026.10.12.1"), { lastMethod: null });
  assert.ok(old.every((r) => !r.held_all && !r.held_in_state && !r.held_out_of_state));
  const noSat = { ...UT, admissions: { ...UT.admissions, sat_reading_25_75: null, sat_math_25_75: null, act_composite_25_75: null }, reported: undefined } as School;
  assert.deepEqual(inputsFor(noSat, META).sat_p75, { v: null, year: null, source: null, imputed: true });
});

test("the method guard: the committed sample matches today's method, and a changed score under an unchanged method is caught", () => {
  const sample = readMethodSample(ROOT);
  assert.ok(sample, "data/reference/selectivity-method.json is committed");
  assert.equal(sample!.method, SELECTIVITY_METHOD);
  assert.deepEqual(methodProblems(sample), []);
  const id = Object.keys(sample!.expected).find((k) => sample!.expected[k].all !== null)!;
  const tampered = { ...sample!, expected: { ...sample!.expected, [id]: { ...sample!.expected[id], all: sample!.expected[id].all! + 1 } } };
  assert.match(methodProblems(tampered)[0], /bump SELECTIVITY_METHOD/);
  assert.match(methodProblems({ ...sample!, method: "2000-01-01.1" })[0], /run npm run selectivity-method-sample/);
  // Scoring the frozen figures doesn't depend on the dataset.
  assert.deepEqual(scoreSample(sample!.inputs), sample!.expected);
});

/** A recorded point with the given pool scores (Ultra selective wherever rated). */
function point(scores: Partial<Record<Pool, number>>, publishedAt = "2026-10-13", cause: SelectivityPoint["cause"] = "data"): SelectivityPoint {
  const byPool = Object.fromEntries((["all", "in_state", "out_of_state"] as Pool[]).map((p) => [p, { score: scores[p] ?? null, tier: scores[p] === undefined ? null : ("elite" as const), held: false }]));
  return { publishedAt, rank: null, tierYear: null, band: null, cause, method: "m", gitCommit: "c", inputs: {}, pools: byPool as SelectivityPoint["pools"] };
}

test("the console says what changed in words, and finds the tier moves and Ultra selective entries", () => {
  const before = { admit_rate: { v: 0.31, year: "Fall 2024", source: "ipeds-adm" }, sat_p75: { v: 1500, year: "Fall 2024", source: "ipeds-adm" } };
  const after = {
    admit_rate: { v: 0.2222, year: "Fall 2025", source: "college-site" },
    admit_rate_out_of_state: { v: 0.0752, year: "Fall 2025", source: "college-site" },
    sat_p75: { v: 1500, year: "Fall 2024", source: "ipeds-adm" },
  };
  assert.deepEqual(inputChanges(before, after), ["admit rate 31.0% → 22.2% (Fall 2024 federal → Fall 2025 college)", "out-of-state admit rate none → 7.5% (no year → Fall 2025 college)"]);
  assert.deepEqual(inputChanges(null, after), []);

  // A run's rows (one per college) become one change per pool that moved.
  const none = { prev_score_in_state: null, prev_tier_in_state: null, prev_score_out_of_state: null, prev_tier_out_of_state: null };
  const changes = [
    {
      unit_id: "228778",
      cause: "data" as const,
      ...{ score_all: 72.45, tier_all: "highly_selective", held_all: false, score_in_state: 68.15, tier_in_state: "highly_selective", held_in_state: false, score_out_of_state: 80.49, tier_out_of_state: "elite", held_out_of_state: false },
      ...none,
      prev_score_all: 70.92,
      prev_tier_all: "highly_selective",
    },
    {
      unit_id: "166027",
      cause: "data" as const,
      ...{ score_all: 79, tier_all: "highly_selective", held_all: false, score_in_state: null, tier_in_state: null, held_in_state: false, score_out_of_state: null, tier_out_of_state: null, held_out_of_state: false },
      ...none,
      prev_score_all: 81,
      prev_tier_all: "elite",
    },
  ].flatMap(runChangesOf);
  assert.deepEqual(
    changes.map((c) => [c.unitId, c.pool, c.prevTier, c.tier]),
    [
      ["228778", "all", "highly_selective", "highly_selective"],
      ["228778", "in_state", null, "highly_selective"],
      ["228778", "out_of_state", null, "elite"],
      ["166027", "all", "elite", "highly_selective"],
    ],
  );
  const moves = tierMoves(changes);
  assert.deepEqual(
    [moves.up.map((m) => `${m.unitId} ${m.pool}`), moves.down.map((m) => m.unitId), moves.eliteIn, moves.eliteOut],
    [["228778 in_state", "228778 out_of_state"], ["166027"], ["228778"], ["166027"]],
  );

  const rows = withPrevious([point({ all: 80 }, "2026-10-01"), point({ all: 81, in_state: 70 }, "2026-10-13")]);
  assert.deepEqual(
    rows.map((r) => [r.point.pools.all.score, r.prev?.pools.all.score ?? null]),
    [
      [81, 80],
      [80, null],
    ],
  );
});

test("the college-reported workflow leaves selectivity to the publisher, which rebuilds the tiers and records the history", () => {
  const reported = readFileSync(join(ROOT, ".github/workflows/college-reported.yml"), "utf8");
  assert.doesNotMatch(reported, /run: npm run (build-selectivity|merge-reported|merge-directories)/, "no merge or build step: the publisher composes");
  assert.equal((reported.match(/event_type=publish-snapshot/g) ?? []).length, 2, "both jobs ask the publisher for a snapshot");
  assert.match(readFileSync(join(ROOT, "scripts/publish-snapshot.mts"), "utf8"), /await recordTiers\(/);
});

/* ------------------------------------------------------------------ */
/* Followers hear when the public tier changes (Decision 7)            */
/* ------------------------------------------------------------------ */

const { TIER_FIELDS, describeChange, diffSchools } = await import("../lib/changes.ts");
const { suppressTiers } = await import("../scripts/lib/publish-changes.mts");
const { NOTIFY_FIELDS } = await import("../lib/fields.ts");

test("UT Austin's #145 change tells followers about its two new pools, in words, with no score", () => {
  const before = { ...UT, selectivity: { tier: "highly_selective" as const, year: "Fall 2024" } } as School;
  const changes = diffSchools({ schools: [before], meta: META }, { schools: [UT], meta: META }, TIER_FIELDS);
  assert.deepEqual(
    changes.map((c) => [c.field, c.kind, c.new_value]),
    [
      ["selectivity.in_state", "appeared", "highly_selective"],
      ["selectivity.out_of_state", "appeared", "elite"],
    ],
  );
  assert.deepEqual(
    changes.map((c) => describeChange(c)),
    ["Quad's selectivity for in-state applicants: Highly selective", "Quad's selectivity for out-of-state applicants: Ultra selective"],
  );
  for (const c of changes) assert.ok(typeof c.new_value === "string" && !/\d/.test(String(c.new_value)), "a tier, never a score or rank");
});

test("a tier moved only by other colleges' figures is announced; a method change isn't", () => {
  // Same inputs, different stored tier: the scales moved under it. The derived-input rule would have hidden this.
  const before = { ...HARVARD, selectivity: { ...HARVARD.selectivity!, tier: "highly_selective" as const } } as School;
  const moved = diffSchools({ schools: [before], meta: META }, { schools: [HARVARD], meta: META }, TIER_FIELDS);
  assert.deepEqual(
    moved.map((c) => describeChange(c)),
    ["Quad's selectivity is now Ultra selective (was Highly selective)"],
  );
  assert.deepEqual(diffSchools({ schools: [before], meta: META }, { schools: [HARVARD], meta: META }, TIER_FIELDS, { suppress: TIER_FIELDS }), []);

  assert.match(suppressTiers("2026.10.12.2", "2026.10.12.3")!, /method changed/);
  assert.equal(suppressTiers("2026.10.12.3", "2026.10.12.3"), null);
  assert.equal(suppressTiers(null, "2026.10.12.3"), null, "an index from before the method field counts as unchanged");
  assert.match(suppressTiers("missing", "2026.10.12.3")!, /no selectivity tiers/, "no burst of 'new' tiers on a first publish");
  // The band and the year never notify.
  assert.ok(!NOTIFY_FIELDS.includes("selectivity.band" as never) && !NOTIFY_FIELDS.includes("selectivity.year" as never));
});

test("the backfill, the rebuild, and the history publish never stage follower changes", () => {
  for (const f of ["scripts/backfill-selectivity-history.mts", "scripts/rebuild-selectivity-history.mts", "scripts/lib/selectivity-history.mts"]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /dataset_changes|publish_changes\(|stageChanges/, f);
  }
});

test("the console hides same-tier drift under the display filter by default, never a tier change, new pool, or method row", () => {
  assert.equal(DISPLAY_MOVE_MIN, 0.25);
  const prev = point({ all: 80, out_of_state: 85 });
  assert.equal(isDrift(point({ all: 80.01, out_of_state: 85.1 }), prev), true, "every pool moved a little");
  assert.equal(isDrift(point({ all: 80.01, out_of_state: 85.3 }), prev), false, "one pool moved enough");
  const tierMoved = point({ all: 80.01, out_of_state: 85 });
  tierMoved.pools.all = { score: 79.99, tier: "highly_selective", held: false };
  assert.equal(isDrift(tierMoved, prev), false, "a tier change always shows");
  assert.equal(isDrift(point({ all: 80.01, out_of_state: 85, in_state: 70 }), prev), false, "a new pool always shows");
  assert.equal(isDrift(point({ all: 80.01, out_of_state: 85 }, "2026-10-13", "method"), prev), false);
  assert.equal(isDrift(point({ all: 80.01 }), null), false, "a first row always shows");
});
