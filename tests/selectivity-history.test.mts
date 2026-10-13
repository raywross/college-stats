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
import { advance, historyRows, historyRun, inputsFor, type SelectivityAt } from "../scripts/lib/selectivity-history.mts";
import { methodProblems, readMethodSample, scoreSample } from "../scripts/lib/selectivity-method.mts";
import type { SelectivityIndexFile } from "../scripts/lib/selectivity.mts";
import { DISPLAY_MOVE_MIN, inputChanges, isDrift, tierMoves, withPrevious, type SelectivityPoint } from "../lib/admin/selectivity-history-view.ts";

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

test("UT Austin's fall 2025 Common Data Set: a score move for all applicants, and in-state and out-of-state as new pools", () => {
  const rows = historyRows(recorded(at([utBefore])), at([utNow]), { lastMethod: SELECTIVITY_METHOD });
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

test("every change is a row (no threshold): a 0.01 drift, a rank-only move; an unchanged index writes nothing", () => {
  const prev = recorded(at([harvard(91.65)]));
  assert.deepEqual(historyRows(prev, at([harvard(91.65)]), { lastMethod: SELECTIVITY_METHOD }), [], "an unchanged index");
  assert.deepEqual(historyRows(prev, at([harvard(91.66)]), { lastMethod: SELECTIVITY_METHOD }).map((r) => [r.score, r.cause]), [[91.66, "data"]]);
  const rankOnly = historyRows(prev, at([{ school: HARVARD, entry: { all: 91.65, rank: 3 } }]), { lastMethod: SELECTIVITY_METHOD });
  assert.deepEqual(rankOnly.map((r) => [r.rank, r.cause]), [[3, "data"]]);
  // An input that changed without moving the score is recorded too (the console says what changed).
  const newYear = { ...HARVARD, outcomes: { ...HARVARD.outcomes, retention_rate: (HARVARD.outcomes?.retention_rate ?? 0.97) - 0.001 } } as School;
  assert.equal(historyRows(prev, at([{ school: newYear, entry: { all: 91.65, rank: 2 } }]), { lastMethod: SELECTIVITY_METHOD }).length, 1);
});

test("a method change records every college and pool; a lost rating records an unrated row; backfill marks every row", () => {
  const same = at([utNow, harvard(91.65)]);
  const prev = recorded(same);
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

/* ------------------------------------------------------------------ */
/* Followers hear when the public tier changes (Decision 7)            */
/* ------------------------------------------------------------------ */

const { TIER_FIELDS, describeChange, diffSchools } = await import("../lib/changes.ts");
const { suppressTiers } = await import("../scripts/lib/publish-changes.mts");
const { NOTIFY_FIELDS } = await import("../lib/fields.ts");

test("UT Austin's #145 change tells followers about its two new pools, in words, with no score", () => {
  const before = { ...UT, selectivity: { tier: "highly_selective" as const, year: "Fall 2024" } } as School;
  const changes = diffSchools({ schools: [before], meta: META }, { schools: [UT], meta: META }, TIER_FIELDS);
  assert.deepEqual(changes.map((c) => [c.field, c.kind, c.new_value]), [
    ["selectivity.in_state", "appeared", "highly_selective"],
    ["selectivity.out_of_state", "appeared", "elite"],
  ]);
  assert.deepEqual(changes.map((c) => describeChange(c)), [
    "Quad's selectivity for in-state applicants: Highly selective",
    "Quad's selectivity for out-of-state applicants: Ultra selective",
  ]);
  for (const c of changes) assert.ok(typeof c.new_value === "string" && !/\d/.test(String(c.new_value)), "a tier, never a score or rank");
});

test("a tier moved only by other colleges' figures is announced; a method change isn't", () => {
  // Same inputs, different stored tier: the scales moved under it. The derived-input rule would have hidden this.
  const before = { ...HARVARD, selectivity: { ...HARVARD.selectivity!, tier: "highly_selective" as const } } as School;
  const moved = diffSchools({ schools: [before], meta: META }, { schools: [HARVARD], meta: META }, TIER_FIELDS);
  assert.deepEqual(moved.map((c) => describeChange(c)), ["Quad's selectivity is now Ultra selective (was Highly selective)"]);
  assert.deepEqual(diffSchools({ schools: [before], meta: META }, { schools: [HARVARD], meta: META }, TIER_FIELDS, { suppress: TIER_FIELDS }), []);

  assert.match(suppressTiers("2026.10.12.2", "2026.10.12.3")!, /method changed/);
  assert.equal(suppressTiers("2026.10.12.3", "2026.10.12.3"), null);
  assert.equal(suppressTiers(null, "2026.10.12.3"), null, "an index from before the method field counts as unchanged");
  assert.match(suppressTiers("missing", "2026.10.12.3")!, /no selectivity tiers/, "no burst of 'new' tiers on a first publish");
  // The band and the year never notify.
  assert.ok(!NOTIFY_FIELDS.includes("selectivity.band" as never) && !NOTIFY_FIELDS.includes("selectivity.year" as never));
});

test("the backfill and the history publish never stage follower changes", () => {
  for (const f of ["scripts/backfill-selectivity-history.mts", "scripts/publish-selectivity-history.mts", "scripts/lib/selectivity-history.mts"]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /dataset_changes|publish_changes\(|stageChanges/, f);
  }
});

test("the console hides same-tier drift under the display filter by default, never a tier change, new pool, or method row", () => {
  const prev = { score: 80, tier: "elite" as const };
  assert.equal(DISPLAY_MOVE_MIN, 0.25);
  assert.equal(isDrift({ score: 80.01, tier: "elite", cause: "data" }, prev), true);
  assert.equal(isDrift({ score: 80.3, tier: "elite", cause: "data" }, prev), false);
  assert.equal(isDrift({ score: 79.99, tier: "highly_selective", cause: "data" }, prev), false, "a tier change always shows");
  assert.equal(isDrift({ score: 80.01, tier: "elite", cause: "method" }, prev), false);
  assert.equal(isDrift({ score: 80.01, tier: "elite", cause: "data" }, null), false, "a first row always shows");
});
