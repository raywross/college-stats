/**
 * Quad's selectivity (specs/chances/selectivity-index.md): percentiles, the weighted mean renormalized over what a
 * college reports, the trend points, the tiers and their hysteresis, per-pool tiers, `tierForStudent`, the build's key
 * placement, the guard in `npm run verify` (and that it fails when its rules are broken), and the proprietary rule: the
 * index never reaches public/, the search index, app code, or a client bundle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { DatasetMeta, School } from "../lib/types.ts";
import {
  ELITE_COUNT_RANGE,
  ELITE_INDEX,
  HYSTERESIS,
  WEIGHTS,
  distributions,
  indexInputs,
  percentileOf,
  rawInputs,
  selectivityIndex,
  selectivityTier,
  trendPoints,
  type RawInputs,
} from "../lib/selectivity.ts";
import { chipTiers, tierForStudent, tierRank, tierText } from "../lib/selectivity-tier.ts";
import { selectivityFacts } from "../lib/selectivity-facts.ts";
import { INDEX_MARKERS, buildSelectivity, leakProblems, placeSelectivity, readIndexFile, selectivityProblems } from "../scripts/lib/selectivity.mts";
import { GLOSSARY } from "../lib/glossary.ts";
import { reachedFromClient, walk } from "./helpers/client-reach.mts";
import { parseFilters } from "../lib/params.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const SCHOOLS: School[] = JSON.parse(read("data/schools.json"));
const META: DatasetMeta = JSON.parse(read("data/meta.json"));
const FILE = readIndexFile(ROOT)!;
const byName = (name: string) => SCHOOLS.find((s) => s.name === name)!;

const raw = (over: Partial<RawInputs> = {}): RawInputs => ({
  admitRate: 0.5,
  inStateRate: null,
  outOfStateRate: null,
  sat75: null,
  gpaTopShare: null,
  yield: null,
  edShare: null,
  waitlistShare: null,
  factorsRead: null,
  selectivityTrend: null,
  applicationsTrend: null,
  ...over,
});

/* ---- Percentiles and the index ---- */

test("percentiles: the share beaten plus half the ties, in the input's direction", () => {
  const v = [0.1, 0.2, 0.2, 0.5];
  assert.equal(percentileOf(v, 0.1, true), 87.5, "the lowest rate beats three of four, plus half its own tie");
  assert.equal(percentileOf(v, 0.2, true), 50);
  assert.equal(percentileOf(v, 0.5, false), 87.5, "higher is harder for scores");
  assert.equal(percentileOf(v, 0.05, true), 100, "a pool rate below every college's rate");
  assert.equal(percentileOf([], 1, false), 50);
});

test("the index: a weighted mean renormalized over what the college reports, plus the trend, clamped", () => {
  assert.equal(selectivityIndex({ readings: { admit_rate: 80 }, trend: 0 }), 80, "the admit rate alone carries all the weight");
  const both = selectivityIndex({ readings: { admit_rate: 80, class_strength: 50 }, trend: 0 })!;
  assert.equal(both, Math.round(((WEIGHTS.admit_rate * 80 + WEIGHTS.class_strength * 50) / (WEIGHTS.admit_rate + WEIGHTS.class_strength)) * 10) / 10);
  assert.equal(selectivityIndex({ readings: { admit_rate: 80, yield: null, waitlist: undefined }, trend: 0 }), 80, "missing inputs are skipped, not zeroes");
  assert.equal(selectivityIndex({ readings: { class_strength: 99 }, trend: 0 }), null, "the admit rate is required");
  assert.equal(selectivityIndex({ readings: { admit_rate: 98 }, trend: 7 }), 100, "clamped at 100");
  assert.equal(selectivityIndex({ readings: { admit_rate: 3 }, trend: -7 }), 0, "clamped at 0");
});

test("the trend: more selective +5, less −5; applications ±2; steady or unknown adds nothing", () => {
  assert.equal(trendPoints("up", "up"), 7);
  assert.equal(trendPoints("down", "down"), -7);
  assert.equal(trendPoints("steady", null), 0);
  assert.equal(trendPoints(null, "up"), 2);
});

test("per pool, only the admit rate changes: each pool's rate is placed among every college's overall rate", () => {
  const all = [raw({ admitRate: 0.1 }), raw({ admitRate: 0.3 }), raw({ admitRate: 0.6 }), raw({ admitRate: 0.3, inStateRate: 0.5, outOfStateRate: 0.05, sat75: 1400 })];
  const dist = distributions(all);
  const r = all[3];
  const inState = indexInputs(r, dist, "in_state");
  const outState = indexInputs(r, dist, "out_of_state");
  assert.ok(inState.readings.admit_rate! < outState.readings.admit_rate!);
  assert.equal(inState.readings.class_strength, outState.readings.class_strength);
  assert.equal(dist.admit_rate.values.length, 4, "pool rates don't join the distribution");
});

test("the C7 count is scaled to 0–100, not percentiled", () => {
  const dist = distributions([raw({ factorsRead: 4 })]);
  assert.equal(indexInputs(raw({ factorsRead: 4 }), dist).readings.factors_read, 50);
});

/* ---- Tiers and hysteresis ---- */

test("the tiers: Elite needs the index and a pool rate under 10%; then 85, 60, 30", () => {
  assert.equal(selectivityTier(ELITE_INDEX, 0.05), "elite");
  assert.equal(selectivityTier(ELITE_INDEX, 0.12), "highly_selective", "a high index alone isn't Elite");
  assert.equal(selectivityTier(ELITE_INDEX - 0.1, 0.05), "highly_selective");
  assert.equal(selectivityTier(85, 0.2), "highly_selective");
  assert.equal(selectivityTier(60, 0.4), "selective");
  assert.equal(selectivityTier(30, 0.7), "accessible");
  assert.equal(selectivityTier(29.9, 0.9), "open");
  assert.equal(selectivityTier(null, 0.5), null, "no index, not rated");
});

test("hysteresis: a tier moves only when the index crosses a cutoff by the band", () => {
  // Up: from Selective, 86 is past 85 but not by the band; 87 is.
  assert.equal(selectivityTier(85 + HYSTERESIS - 0.1, 0.2, "selective"), "selective");
  assert.equal(selectivityTier(85 + HYSTERESIS, 0.2, "selective"), "highly_selective");
  // Down: from Highly selective, 84 holds; 83 falls.
  assert.equal(selectivityTier(85 - HYSTERESIS + 0.1, 0.2, "highly_selective"), "highly_selective");
  assert.equal(selectivityTier(85 - HYSTERESIS, 0.2, "highly_selective"), "selective");
  // Two tiers at once when the index moved that far.
  assert.equal(selectivityTier(25, 0.6, "highly_selective"), "open");
  // Into Elite needs the band too; out of Elite on the index needs the band.
  assert.equal(selectivityTier(ELITE_INDEX + 1, 0.05, "highly_selective"), "highly_selective");
  assert.equal(selectivityTier(ELITE_INDEX + HYSTERESIS, 0.05, "highly_selective"), "elite");
  assert.equal(selectivityTier(ELITE_INDEX - 1, 0.05, "elite"), "elite");
  // The Elite rate condition flips at once.
  assert.equal(selectivityTier(99, 0.11, "elite"), "highly_selective");
  // Without a previous tier, the plain rule.
  assert.equal(selectivityTier(86, 0.2, null), "highly_selective");
});

/* ---- Reading the stored tiers ---- */

const school = (selectivity: School["selectivity"], state = "GA") => ({ selectivity, location: { state } }) as Pick<School, "selectivity" | "location">;

test("tierForStudent: the in-state tier at home, the out-of-state tier elsewhere, else the tier for all", () => {
  const gt = school({ tier: "highly_selective", in_state: "selective", out_of_state: "elite" });
  assert.deepEqual(tierForStudent(gt, "GA"), { tier: "selective", pool: "in_state" });
  assert.deepEqual(tierForStudent(gt, "TX"), { tier: "elite", pool: "out_of_state" });
  assert.deepEqual(tierForStudent(gt, null), { tier: "highly_selective", pool: "all" });
  assert.deepEqual(tierForStudent(school({ tier: "selective" }), "GA"), { tier: "selective", pool: "all" }, "no pool tiers");
  assert.deepEqual(tierForStudent(school(undefined), "GA"), { tier: null, pool: "all" }, "not rated");
});

test("chips: both pools where they differ, the shared pool tier where they agree, nothing when not rated", () => {
  assert.deepEqual(
    chipTiers(school({ tier: "highly_selective", in_state: "selective", out_of_state: "elite" })).map((t) => [t.tier, t.pool, t.stateName]),
    [["selective", "in_state", "Georgia"], ["elite", "out_of_state", "Georgia"]]
  );
  assert.deepEqual(chipTiers(school({ tier: "selective", in_state: "accessible", out_of_state: "accessible" })).map((t) => t.tier), ["accessible"]);
  assert.deepEqual(chipTiers(school(undefined)), []);
  assert.equal(tierText(school({ tier: "highly_selective", in_state: "selective", out_of_state: "elite" })), "Selective in-state, Elite out of state");
  assert.equal(tierText(school({ tier: "open" })), "Open");
  assert.equal(tierRank("elite"), 0);
  assert.equal(tierRank(undefined), null);
});

/* ---- The build ---- */

test("placeSelectivity puts the key before directories/lineage/trends/reported, else last, and moves nothing else", () => {
  const a = { unit_id: "1", name: "A", trends: {}, reported: {} } as unknown as School;
  assert.deepEqual(Object.keys(placeSelectivity(a, { tier: "open" })), ["unit_id", "name", "selectivity", "trends", "reported"]);
  const b = { unit_id: "1", name: "B", directories: {}, lineage: {} } as unknown as School;
  assert.deepEqual(Object.keys(placeSelectivity(b, { tier: "open" })), ["unit_id", "name", "selectivity", "directories", "lineage"]);
  const c = { unit_id: "1", name: "C", social: {} } as unknown as School;
  assert.deepEqual(Object.keys(placeSelectivity(c, { tier: "open" })), ["unit_id", "name", "social", "selectivity"]);
  const placed = placeSelectivity(a, { tier: "open" });
  assert.deepEqual(Object.keys(placeSelectivity(placed, { tier: "elite" })), Object.keys(placed), "a re-run keeps the place");
  assert.deepEqual(Object.keys(placeSelectivity(placed, undefined)), ["unit_id", "name", "trends", "reported"], "a college no longer rated loses the key");
  // The directories merge re-inserts `directories` and `lineage` before trends/reported or at the end: selectivity stays put.
});

test("the committed tiers are a fresh build: rebuilding changes nothing", () => {
  const again = buildSelectivity(SCHOOLS, META, { prior: FILE });
  assert.equal(again.changed, 0);
  assert.deepEqual(again.file.counts, FILE.counts);
  assert.equal(again.file.generated, FILE.generated, "no index moved, so the date stays");
  for (let i = 0; i < SCHOOLS.length; i++) assert.equal(JSON.stringify(again.schools[i]), JSON.stringify(SCHOOLS[i]), SCHOOLS[i].name);
});

test("the real dataset: Elite 30–40 and the colleges you'd expect; every tier holds colleges", () => {
  assert.ok(FILE.elite_count >= 30 && FILE.elite_count <= 40, `Elite ${FILE.elite_count}`);
  assert.equal(FILE.elite_index, ELITE_INDEX);
  for (const name of ["Harvard University", "Yale University", "Princeton University", "Massachusetts Institute of Technology", "Stanford University", "California Institute of Technology", "University of Chicago", "Brown University", "Columbia University in the City of New York", "Dartmouth College", "University of Pennsylvania", "Cornell University", "Duke University"])
    assert.equal(byName(name).selectivity?.tier, "elite", name);
  for (const t of ["highly_selective", "selective", "accessible", "open"] as const) assert.ok(FILE.counts[t] > 0, t);
  // Georgia Tech: rated per pool; out of state reads harder (its out-of-state rate is about a third of the in-state one).
  const gt = byName("Georgia Institute of Technology-Main Campus");
  const e = FILE.colleges[gt.unit_id];
  assert.ok(gt.selectivity?.in_state && gt.selectivity.out_of_state);
  assert.ok(e.in_state! < e.out_of_state!, `${e.in_state} < ${e.out_of_state}`);
});

/* ---- The guard (npm run check:selectivity) ---- */

test("the guard passes on the committed data and code", () => {
  assert.deepEqual(selectivityProblems(SCHOOLS, FILE, META), []);
  assert.deepEqual(leakProblems(ROOT), []);
});

test("the guard fails a tier that moved without crossing the band", () => {
  // A Selective college whose index sits just under the band above 60 can't be stored as anything but Selective.
  const i = SCHOOLS.findIndex((s) => s.selectivity?.tier === "selective" && !s.selectivity.in_state && FILE.colleges[s.unit_id].all < 85 - HYSTERESIS);
  const schools = SCHOOLS.map((s, j) => (j === i ? { ...s, selectivity: { ...s.selectivity!, tier: "highly_selective" as const } } : s));
  const problems = selectivityProblems(schools, FILE, META);
  assert.ok(problems.some((p) => p.includes(SCHOOLS[i].name) && p.includes("hysteresis")), problems.join("\n"));
});

test("the guard fails an Elite count outside 25–50 and an empty tier", () => {
  const [lo, hi] = ELITE_COUNT_RANGE;
  const tooFew = SCHOOLS.map((s) => (s.selectivity?.tier === "elite" ? { ...s, selectivity: { ...s.selectivity, tier: "highly_selective" as const } } : s));
  assert.ok(selectivityProblems(tooFew, FILE, META).some((p) => p.startsWith("Elite holds 0") && p.includes(`${lo}–${hi}`)));
  assert.ok(selectivityProblems(tooFew, FILE, META).some((p) => p === "no college is elite for all applicants"));
  let extra = hi + 1;
  const tooMany = SCHOOLS.map((s) => (s.selectivity && s.selectivity.tier !== "elite" && extra-- > 0 ? { ...s, selectivity: { ...s.selectivity, tier: "elite" as const } } : s));
  assert.ok(selectivityProblems(tooMany, FILE, META).some((p) => p.startsWith("Elite holds")));
});

test("the guard fails a stale index file", () => {
  const first = Object.keys(FILE.colleges)[0];
  const stale = { ...FILE, colleges: { ...FILE.colleges, [first]: { ...FILE.colleges[first], all: FILE.colleges[first].all + 0.1 } } };
  assert.ok(selectivityProblems(SCHOOLS, stale, META).some((p) => p.includes("isn't a fresh build")));
});

test("the leak guard catches the index in public/ or read by app code, and ignores comments", () => {
  const root = mkdtempSync(join(tmpdir(), "selectivity-leak-"));
  mkdirSync(join(root, "public"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "public", "x.json"), JSON.stringify({ elite_index: 94 }));
  writeFileSync(join(root, "lib", "reads.ts"), 'import { readFileSync } from "node:fs";\nexport const f = readFileSync("data/selectivity-index.json", "utf8");\n');
  writeFileSync(join(root, "app", "fine.ts"), "// the index lives in data/selectivity-index.json, which this file never reads\nexport const x = 1;\n");
  const problems = leakProblems(root);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith(join("public", "x.json"))));
  assert.ok(problems.some((p) => p.startsWith(join("lib", "reads.ts"))));
});

/* ---- Never on a page, in the search index, the data API, or a client bundle ---- */

test("the index is in no served file: public/, the search index entries, and the traced data files", async () => {
  const { buildSearchIndex } = await import("../lib/search-index.ts");
  const index = JSON.stringify(buildSearchIndex({ getAllSchools: () => SCHOOLS, getMeta: () => META } as never, []));
  for (const m of INDEX_MARKERS) assert.ok(!index.includes(m), m);
  assert.ok(!index.includes('"selectivity"'), "the search index carries no selectivity at all");
  assert.ok(!read("next.config.ts").includes("selectivity-index"), "the index file is never traced into the deploy");
  // The stored tiers are words only.
  for (const s of SCHOOLS) if (s.selectivity) for (const v of Object.values(s.selectivity)) assert.equal(typeof v, "string", s.name);
});

const METHOD_FILES = ["lib/selectivity.ts", "lib/selectivity-facts.ts"];

test("no client component reaches the method (weights, cutoffs, ELITE_INDEX) or the facts builder", () => {
  const files = new Map([...walk("components"), ...walk("app"), ...walk("lib")]);
  for (const f of METHOD_FILES) assert.ok(files.has(f), f);
  assert.deepEqual(reachedFromClient(files, METHOD_FILES), []);
});

test("the client guard catches a client file reaching the method through a helper", () => {
  const files = new Map<string, string>([
    ["lib/selectivity.ts", "export const ELITE_INDEX = 94;"],
    ["lib/helper.ts", 'import { ELITE_INDEX } from "./selectivity.ts";\nexport const Y = ELITE_INDEX;'],
    ["components/a/Bad.tsx", '"use client";\nimport { Y } from "@/lib/helper";\nexport const B = Y;'],
    ["components/a/Fine.tsx", '"use client";\nimport { tierForStudent } from "@/lib/selectivity-tier";\nexport const F = tierForStudent;'],
    ["lib/selectivity-tier.ts", "export const tierForStudent = 1;"],
  ]);
  const found = reachedFromClient(files, ["lib/selectivity.ts"]);
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith("components/a/Bad.tsx"));
});

test("the panel's facts are published figures only: no index, percentile, weight, or cutoff", () => {
  const harvard = byName("Harvard University");
  const facts = selectivityFacts(harvard);
  assert.ok(facts.some((f) => f.label === "Admit rate" && f.field === "admissions.acceptance_rate"));
  const text = JSON.stringify(facts);
  assert.ok(!text.includes(String(FILE.colleges[harvard.unit_id].all)), "never the index");
  assert.ok(!/percentile rank|weight|index|cutoff|ELITE/i.test(text), text);
  // A public with residency rates lists both pool rates.
  const gt = selectivityFacts(byName("Georgia Institute of Technology-Main Campus"));
  assert.deepEqual(gt.filter((f) => f.label === "Admit rate").map((f) => f.field), ["admissions.acceptance_rate", "derived.admit_rate_in_state", "derived.admit_rate_out_of_state"]);
});

test("the glossary entry names the inputs, never weights or cutoffs", () => {
  const e = GLOSSARY["selectivity-tier"];
  assert.ok(e);
  for (const r of e.related ?? []) assert.ok(r in GLOSSARY, r);
  const text = `${e.short} ${e.long ?? ""} ${e.why ?? ""}`;
  assert.ok(!/\d+%|\b(45|20|94|96|85|60|30)\b|weight|cutoff|percentile/i.test(text), text);
});

test("Explore: selectivity=… keeps known tiers only; the tier sort is a sort key", () => {
  assert.deepEqual(parseFilters({ selectivity: "elite,highly_selective,bogus" }).selectivity, ["elite", "highly_selective"]);
  assert.equal(parseFilters({ selectivity: "bogus" }).selectivity, undefined);
  assert.equal(parseFilters({ sortBy: "selectivity" }).sortBy, "selectivity");
  assert.equal(parseFilters({ sortBy: "selectivity" }).sortDir, "asc", "hardest first");
});
