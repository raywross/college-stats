/**
 * Quad's selectivity history (specs/chances/selectivity-history.md "Tests"): which rows a publish records
 * (scripts/lib/selectivity-history.mts historyRows), the inputs each carries, the method guard
 * (scripts/lib/selectivity-method.mts), and the console's words for a change (lib/admin/selectivity-history-view.ts).
 * The tables and functions are tested against Postgres in admin-policies.test.mts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { SELECTIVITY_METHOD } from "../lib/selectivity.ts";
import { SCORE_MOVE_MIN, advance, historyRows, historyRun, inputsFor, recordedMap, type Recorded, type SelectivityAt } from "../scripts/lib/selectivity-history.mts";
import { methodProblems, readMethodSample, scoreSample } from "../scripts/lib/selectivity-method.mts";
import type { SelectivityIndexFile } from "../scripts/lib/selectivity.mts";
import { inputChanges, tierMoves, withPrevious, type SelectivityPoint } from "../lib/admin/selectivity-history-view.ts";

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

test("UT Austin's fall 2025 Common Data Set: a score move for all applicants, and in-state and out-of-state as new pools", () => {
  const prev = recordedMap([{ unit_id: "228778", pool: "all", score: 70.92, tier: "highly_selective", tier_year: "Fall 2024", band: null }]);
  const rows = historyRows(prev, at([utNow]), { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(rows.map((r) => [r.pool, r.score, r.tier, r.cause]), [
    ["all", 72.45, "highly_selective", "data"],
    ["in_state", 68.15, "highly_selective", "new_pool"],
    ["out_of_state", 80.49, "elite", "new_pool"],
  ]);
  assert.equal(rows[0].tier_year, "Fall 2025");
  assert.equal(rows[0].rank, 58);
  // The inputs are what the score read, with the year and source of each.
  assert.deepEqual(rows[0].inputs.admit_rate, { v: 0.2222, year: "Fall 2025", source: "college-site" });
  assert.equal(rows[2].inputs.admit_rate.v, 0.0752, "the out-of-state row reads the out-of-state rate");
});

test("a 0.01 drift records nothing; drifts that add up past the threshold record a row against the last recorded one", () => {
  const start: Recorded = { unit_id: "166027", pool: "all", score: 91.65, tier: "elite", tier_year: HARVARD.selectivity?.year ?? null, band: HARVARD.selectivity?.band ?? null };
  let prev = recordedMap([start]);
  assert.deepEqual(historyRows(prev, at([harvard(91.66)]), { lastMethod: SELECTIVITY_METHOD }), []);
  const seen: number[] = [];
  for (const [i, score] of [91.75, 91.85, 91.95].entries()) {
    const rows = historyRows(prev, at([harvard(score)]), { lastMethod: SELECTIVITY_METHOD });
    if (rows.length) seen.push(i + 1);
    prev = advance(prev, rows);
  }
  assert.deepEqual(seen, [3], `0.1 a publish crosses ${SCORE_MOVE_MIN} on the third`);
});

test("a method change records every college and pool; a lost rating records an unrated row; backfill marks every row", () => {
  const prev = recordedMap([
    { unit_id: "228778", pool: "all", score: 72.45, tier: "highly_selective", tier_year: "Fall 2025", band: null },
    { unit_id: "228778", pool: "in_state", score: 68.15, tier: "highly_selective", tier_year: "Fall 2025", band: null },
    { unit_id: "228778", pool: "out_of_state", score: 80.49, tier: "elite", tier_year: "Fall 2025", band: null },
    { unit_id: "166027", pool: "all", score: 91.65, tier: "elite", tier_year: HARVARD.selectivity?.year ?? null, band: HARVARD.selectivity?.band ?? null },
  ]);
  const same = at([utNow, harvard(91.65)]);
  assert.deepEqual(historyRows(prev, same, { lastMethod: SELECTIVITY_METHOD }), [], "re-running the same commit records nothing");
  const method = historyRows(prev, same, { lastMethod: "2026.10.12.2" });
  assert.equal(method.length, 4);
  assert.ok(method.every((r) => r.cause === "method"));
  assert.equal(historyRun(same, { gitCommit: "abc1234", publishedAt: "2026-10-13T00:00:00Z", lastMethod: "2026.10.12.2" }).cause, "method");

  // UT loses its residency rates: its two pools are recorded as unrated.
  const noPools = at([{ school: UT, entry: { all: 72.45, rank: 58 }, selectivity: { tier: "highly_selective", year: "Fall 2025" } }, harvard(91.65)]);
  const lost = historyRows(prev, noPools, { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(lost.map((r) => [r.unit_id, r.pool, r.score, r.tier, r.cause]), [
    ["228778", "in_state", null, null, "unrated"],
    ["228778", "out_of_state", null, null, "unrated"],
  ]);

  const backfill = historyRows(new Map(), same, { lastMethod: null, backfill: true });
  assert.ok(backfill.length === 4 && backfill.every((r) => r.cause === "backfill"));
  assert.equal(historyRun(same, { gitCommit: "abc1234", publishedAt: "2026-10-12T00:00:00Z", lastMethod: null, backfill: true }).cause, "backfill");
});

test("held is read only under today's method; a missing SAT is marked filled in", () => {
  const old = historyRows(new Map(), at([utNow], "2026.10.12.1"), { lastMethod: null });
  assert.ok(old.every((r) => r.held === false));
  const noSat = { ...UT, admissions: { ...UT.admissions, sat_reading_25_75: null, sat_math_25_75: null, act_composite_25_75: null }, reported: undefined } as School;
  assert.deepEqual(inputsFor(noSat, "all", META).sat_p75, { v: null, year: null, source: null, imputed: true });
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

test("the console says what changed in words, and finds the tier moves and Ultra selective entries", () => {
  const before = { admit_rate: { v: 0.31, year: "Fall 2024", source: "ipeds-adm" }, sat_p75: { v: 1500, year: "Fall 2024", source: "ipeds-adm" } };
  const after = { admit_rate: { v: 0.2222, year: "Fall 2025", source: "college-site" }, sat_p75: { v: 1500, year: "Fall 2024", source: "ipeds-adm" } };
  assert.deepEqual(inputChanges(before, after), ["admit rate 31.0% → 22.2% (Fall 2024 federal → Fall 2025 college)"]);
  assert.deepEqual(inputChanges(null, after), []);

  const moves = tierMoves([
    { unitId: "228778", pool: "out_of_state", score: 80.49, tier: "elite", cause: "new_pool", held: false, prevScore: null, prevTier: null },
    { unitId: "166027", pool: "all", score: 79, tier: "highly_selective", cause: "data", held: false, prevScore: 81, prevTier: "elite" },
    { unitId: "130794", pool: "all", score: 93.9, tier: "elite", cause: "data", held: false, prevScore: 93.5, prevTier: "elite" },
  ]);
  assert.deepEqual([moves.up.map((m) => m.unitId), moves.down.map((m) => m.unitId), moves.eliteIn, moves.eliteOut], [["228778"], ["166027"], ["228778"], ["166027"]]);

  const p = (pool: SelectivityPoint["pool"], score: number, publishedAt: string): SelectivityPoint => ({
    publishedAt, pool, score, rank: null, tier: "elite", tierYear: null, band: null, held: false, cause: "data", method: "m", gitCommit: "c", inputs: {},
  });
  const rows = withPrevious([p("all", 80, "2026-10-01"), p("in_state", 70, "2026-10-01"), p("all", 81, "2026-10-13")]);
  assert.deepEqual(rows.map((r) => [r.point.pool, r.point.score, r.prev?.score ?? null]), [["all", 81, 80], ["in_state", 70, null], ["all", 80, null]]);
});

test("the college-reported workflow rebuilds selectivity after merging, and the publish workflow records the history", () => {
  const reported = readFileSync(join(ROOT, ".github/workflows/college-reported.yml"), "utf8");
  assert.equal((reported.match(/run: npm run build-selectivity/g) ?? []).length, 2, "both jobs");
  assert.ok(reported.indexOf("npm run merge-directories") < reported.indexOf("npm run build-selectivity"));
  assert.match(readFileSync(join(ROOT, ".github/workflows/publish-changes.yml"), "utf8"), /npm run publish-selectivity-history -- --head "\$SHA"/);
});
