/**
 * Quad's selectivity (specs/chances/selectivity-index.md, second version): the scales, the filled SAT, the evidence
 * pull for a small class, figures that can't describe one class, the score and ranks, the tiers and their hysteresis,
 * per-pool tiers, `tierForStudent`, the build's key placement, the guard in `npm run verify` (and that it fails when
 * its rules are broken), and the proprietary rule: the score never reaches public/, the search index, app code, or a
 * client bundle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types.ts";
import {
  ELITE_COUNT_RANGE,
  ELITE_INDEX,
  EVIDENCE_ADMITS,
  HYSTERESIS,
  TIER_CUTOFFS,
  TOP_BAND_SCORE,
  filledReadings,
  inconsistent,
  leastSquares,
  logit,
  rawInputs,
  scales,
  selectivityScore,
  selectivityTier,
  topBand,
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
  sat75: 1200,
  yield: 0.3,
  retention: 0.8,
  graduation: 0.6,
  admitted: 5000,
  enrolled: 1500,
  undergrad: 6000,
  ...over,
});

/** A small field of colleges with every input, spread enough for the fit. */
const FIELD: RawInputs[] = [0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9].map((rate, i) =>
  raw({ admitRate: rate, sat75: 1560 - i * 60, yield: 0.8 - i * 0.07, retention: 0.98 - i * 0.03, graduation: 0.95 - i * 0.06 })
);

/* ---- Scales and the score ---- */

test("least squares recovers an exact line", () => {
  const xs = [[0, 1], [1, 0], [2, 3], [3, 1], [4, 4]];
  const beta = leastSquares(xs, xs.map(([a, b]) => 2 + 3 * a - b));
  [2, 3, -1].forEach((v, i) => assert.ok(Math.abs(beta[i] - v) < 1e-9, `${beta}`));
});

test("the scales keep the top apart: 3% and 9% admit rates read far apart, unlike percentiles", () => {
  const sc = scales(FIELD);
  const at = (rate: number) => filledReadings(raw({ admitRate: rate }), sc)!.admit_rate;
  assert.ok(at(0.03) - at(0.09) > 0.5 * (at(0.09) - at(0.5)), "the gap from 9% to 3% is a real share of the gap from 50% to 9%");
  assert.ok(logit(0) > -10 && logit(1) < 10, "0% and 100% stay finite");
});

test("a missing SAT is filled from the other inputs; a missing yield, retention, or graduation rate reads as the middle", () => {
  const sc = scales(FIELD);
  const strong = filledReadings(raw({ admitRate: 0.05, sat75: null, yield: 0.8, retention: 0.98, graduation: 0.95 }), sc)!;
  const weak = filledReadings(raw({ admitRate: 0.05, sat75: null, yield: 0.3, retention: 0.7, graduation: 0.4 }), sc)!;
  assert.ok(strong.class_strength > weak.class_strength, "a test-blind college that keeps and graduates its students reads stronger");
  const gaps = filledReadings(raw({ yield: null, retention: null, graduation: null }), sc)!;
  assert.deepEqual([gaps.yield, gaps.retention, gaps.graduation], [0, 0, 0]);
});

test("an open-admission college is unrated in every pool, whatever rate its CDS states", () => {
  const base = byName("University of Alaska Fairbanks");
  assert.equal(base.admissions.open_admission, true);
  const stated = { ...base, admissions: { ...base.admissions, acceptance_rate: 1 } } as School;
  const r = rawInputs(stated);
  assert.equal(r.admitRate, null);
  assert.equal(r.inStateRate, null);
  assert.equal(r.outOfStateRate, null);
  const notOpen = { ...stated, admissions: { ...stated.admissions, open_admission: false } } as School;
  assert.equal(rawInputs(notOpen).admitRate, 1, "the guard is the flag, not the value");
  assert.equal(rawInputs(notOpen).inStateRate !== null, true, "its residency rates read again without the flag");
});

test("the score: required admit rate, no cap at the top, two decimals", () => {
  const sc = scales(FIELD);
  assert.equal(selectivityScore(raw({ admitRate: null }), sc), null, "the admit rate is required");
  const a = selectivityScore(raw({ admitRate: 0.03, sat75: 1580, yield: 0.85, retention: 0.99, graduation: 0.98 }), sc)!;
  const b = selectivityScore(raw({ admitRate: 0.06, sat75: 1560, yield: 0.6, retention: 0.97, graduation: 0.95 }), sc)!;
  assert.ok(a > b && a <= 100, `${a} > ${b}`);
  assert.equal(Math.round(a * 100) / 100, a);
});

test("evidence: a tiny admitted class is pulled toward the middle", () => {
  const sc = scales(FIELD);
  const big = selectivityScore(raw({ admitRate: 0.05, admitted: 2000 }), sc)!;
  const tiny = selectivityScore(raw({ admitRate: 0.05, admitted: 30 }), sc)!;
  assert.ok(tiny < big, `${tiny} < ${big}`);
  // Distance from the middle (40) scales by admitted ÷ (admitted + EVIDENCE_ADMITS).
  const ratio = (tiny - 40) / (big - 40);
  const want = 30 / (30 + EVIDENCE_ADMITS) / (2000 / (2000 + EVIDENCE_ADMITS));
  assert.ok(Math.abs(ratio - want) < 0.01, `${ratio} ≈ ${want}`);
});

test("figures that can't describe one class (more first-years than undergraduates) leave a college unrated", () => {
  const sc = scales(FIELD);
  assert.ok(inconsistent(raw({ enrolled: 233, undergrad: 41 })));
  assert.equal(selectivityScore(raw({ enrolled: 233, undergrad: 41 }), sc), null);
  assert.ok(!inconsistent(raw({ undergrad: null })));
});

test("per pool, only the admit rate changes; pool rates don't move the scales", () => {
  const r = raw({ admitRate: 0.3, inStateRate: 0.5, outOfStateRate: 0.1 });
  const sc = scales([...FIELD, r]);
  const inState = filledReadings(r, sc, "in_state")!;
  const outState = filledReadings(r, sc, "out_of_state")!;
  assert.ok(inState.admit_rate < outState.admit_rate);
  assert.equal(inState.yield, outState.yield);
  assert.deepEqual(scales([...FIELD, r]).mean, scales([...FIELD, { ...r, inStateRate: 0.9, outOfStateRate: 0.01 }]).mean);
});

/* ---- Tiers and hysteresis ---- */

test("the tiers: Ultra selective (key elite), then the cutoffs, from the score alone", () => {
  const { highly_selective: hs, very_selective: vs, selective: se, accessible: ac } = TIER_CUTOFFS;
  assert.equal(selectivityTier(ELITE_INDEX), "elite");
  assert.equal(selectivityTier(ELITE_INDEX - 0.01), "highly_selective");
  assert.equal(selectivityTier(hs), "highly_selective");
  assert.equal(selectivityTier(hs - 0.01), "very_selective");
  assert.equal(selectivityTier(vs), "very_selective");
  assert.equal(selectivityTier(vs - 0.01), "selective");
  assert.equal(selectivityTier(se), "selective");
  assert.equal(selectivityTier(ac), "accessible");
  assert.equal(selectivityTier(ac - 0.01), "open");
  assert.equal(selectivityTier(null), null, "no score, not rated");
});

test("hysteresis: a tier moves only when the score crosses a cutoff by the band", () => {
  const hs = TIER_CUTOFFS.highly_selective;
  assert.equal(selectivityTier(hs + HYSTERESIS - 0.1, "very_selective"), "very_selective");
  assert.equal(selectivityTier(hs + HYSTERESIS, "very_selective"), "highly_selective");
  assert.equal(selectivityTier(hs - HYSTERESIS + 0.1, "highly_selective"), "highly_selective");
  assert.equal(selectivityTier(hs - HYSTERESIS, "highly_selective"), "very_selective");
  assert.equal(selectivityTier(TIER_CUTOFFS.accessible - 5, "highly_selective"), "open", "two tiers at once when the score moved that far");
  assert.equal(selectivityTier(ELITE_INDEX + 1, "highly_selective"), "highly_selective");
  assert.equal(selectivityTier(ELITE_INDEX + HYSTERESIS, "highly_selective"), "elite");
  assert.equal(selectivityTier(ELITE_INDEX - 1, "elite"), "elite");
  assert.equal(selectivityTier(hs + 1, null), "highly_selective", "without a previous tier, the plain rule");
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
  assert.equal(tierText(school({ tier: "highly_selective", in_state: "selective", out_of_state: "elite" })), "Selective in-state, Ultra selective out of state");
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

test("the real dataset: the colleges you'd expect in Elite, every tier filled, no ties for a rank, none at 100", () => {
  const [lo, hi] = ELITE_COUNT_RANGE;
  assert.ok(FILE.elite_count >= lo && FILE.elite_count <= hi, `Elite ${FILE.elite_count}`);
  assert.equal(FILE.elite_index, ELITE_INDEX);
  for (const name of ["Harvard University", "Yale University", "Princeton University", "Massachusetts Institute of Technology", "Stanford University", "California Institute of Technology", "University of Chicago", "Brown University", "Columbia University in the City of New York", "Dartmouth College", "University of Pennsylvania", "Cornell University", "Duke University"])
    assert.equal(byName(name).selectivity?.tier, "elite", name);
  for (const t of ["highly_selective", "selective", "accessible", "open"] as const) assert.ok(FILE.counts[t] > 0, t);
  const entries = Object.values(FILE.colleges);
  assert.deepEqual(entries.map((e) => e.rank).sort((x, y) => x - y), entries.map((_, i) => i + 1), "ranks 1..n, each once");
  assert.ok(entries.every((e) => e.all < 100), "nothing pinned at the top of the scale");
  // The first version tied these at 100 or put NYU and Northeastern above them.
  const rank = (name: string) => FILE.colleges[byName(name).unit_id].rank;
  for (const name of ["Massachusetts Institute of Technology", "Stanford University", "Yale University", "Columbia University in the City of New York"])
    for (const below of ["New York University", "Northeastern University"]) assert.ok(rank(name) < rank(below), `${name} above ${below}`);
  // Small or inconsistent records don't lead.
  assert.ok(rank("Curtis Institute of Music") > 60 && rank("Washington University of Science and Technology") > 60);
  assert.equal(byName("University of North Texas Health Science Center").selectivity, undefined, "more first-years than undergraduates: unrated");
  // Georgia Tech: rated per pool; out of state reads harder.
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
  // A Selective college whose score sits under the band above the next cutoff can't be stored as anything but Selective.
  const i = SCHOOLS.findIndex((s) => s.selectivity?.tier === "selective" && !s.selectivity.in_state && FILE.colleges[s.unit_id].all < TIER_CUTOFFS.highly_selective - HYSTERESIS);
  const schools = SCHOOLS.map((s, j) => (j === i ? { ...s, selectivity: { ...s.selectivity!, tier: "highly_selective" as const } } : s));
  const problems = selectivityProblems(schools, FILE, META);
  assert.ok(problems.some((p) => p.includes(SCHOOLS[i].name) && p.includes("hysteresis")), problems.join("\n"));
});

test("the guard fails an Elite count outside its band and an empty tier", () => {
  const [lo, hi] = ELITE_COUNT_RANGE;
  // Elite for some pool counts too (UT Austin, fall 2025: Elite out of state only), so every pool is demoted.
  const notElite = <T,>(t: T) => (t === "elite" ? ("highly_selective" as const) : t);
  const tooFew = SCHOOLS.map((s) =>
    s.selectivity ? { ...s, selectivity: { ...s.selectivity, tier: notElite(s.selectivity.tier), ...(s.selectivity.in_state ? { in_state: notElite(s.selectivity.in_state) } : {}), ...(s.selectivity.out_of_state ? { out_of_state: notElite(s.selectivity.out_of_state) } : {}) } } : s
  );
  assert.ok(selectivityProblems(tooFew, FILE, META).some((p) => p.startsWith("Elite holds 0") && p.includes(`${lo}–${hi}`)));
  assert.ok(selectivityProblems(tooFew, FILE, META).some((p) => p === "no college is elite for all applicants"));
  let extra = hi + 1;
  const tooMany = SCHOOLS.map((s) => (s.selectivity && s.selectivity.tier !== "elite" && extra-- > 0 ? { ...s, selectivity: { ...s.selectivity, tier: "elite" as const } } : s));
  assert.ok(selectivityProblems(tooMany, FILE, META).some((p) => p.startsWith("Elite holds")));
});

/* ---- The top band of Ultra selective (method/standing.md "Revision 3", rule 8) ---- */

test("the top band: Ultra selective at TOP_BAND_SCORE or more to enter, leaving only the hysteresis band below", () => {
  assert.equal(TOP_BAND_SCORE, 90);
  assert.equal(topBand(90, "elite"), "top");
  assert.equal(topBand(89.99, "elite"), null);
  assert.equal(topBand(95, "highly_selective"), null, "Ultra selective only");
  assert.equal(topBand(null, "elite"), null);
  assert.equal(topBand(88.5, "elite", "top"), "top", "inside the band below: stays");
  assert.equal(topBand(88, "elite", "top"), null, "exactly the band below: leaves");
});

test("the top band on the committed data: Yale, Chicago, Harvard, Stanford, MIT, Princeton, Penn; a word, never the score", () => {
  const top = SCHOOLS.filter((x) => x.selectivity?.band === "top").map((x) => x.name).sort();
  assert.deepEqual(top, ["Harvard University", "Massachusetts Institute of Technology", "Princeton University", "Stanford University", "University of Chicago", "University of Pennsylvania", "Yale University"]);
  for (const x of SCHOOLS) if (x.selectivity?.band) assert.equal(x.selectivity.tier, "elite", x.name);
  assert.equal(byName("Brown University").selectivity?.band, undefined, "Brown is just under");
  assert.equal(byName("Vanderbilt University").selectivity?.band, undefined);
  for (const x of SCHOOLS) if (x.selectivity) assert.deepEqual(Object.keys(x.selectivity).filter((k) => !["tier", "in_state", "out_of_state", "band", "year"].includes(k)), [], x.name);
});

test("the guard fails a top band the score doesn't support, and a missing one it does", () => {
  // Columbia (87.5) sits more than the hysteresis band under the cutoff (Brown, at 89.6, could stay if it had been in).
  const brown = SCHOOLS.findIndex((x) => x.name === "Columbia University in the City of New York");
  const harvard = SCHOOLS.findIndex((x) => x.name === "Harvard University");
  const added = SCHOOLS.map((x, j) => (j === brown ? { ...x, selectivity: { ...x.selectivity!, band: "top" as const } } : x));
  assert.ok(selectivityProblems(added, FILE, META).some((p) => p.includes("Columbia University") && p.includes("top band")));
  const dropped = SCHOOLS.map((x, j) => (j === harvard ? { ...x, selectivity: { tier: x.selectivity!.tier, year: x.selectivity!.year } } : x));
  assert.ok(selectivityProblems(dropped, FILE, META).some((p) => p.includes("Harvard University") && p.includes("top band")));
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
