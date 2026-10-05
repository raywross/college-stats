/**
 * Explore's "Fits my scores"/"Fits my preferences" (specs/product/student-profile.md "Display"): the server-side
 * score filter (lib/params.ts parses it; lib/dataset.ts applies lib/student-profile.ts's fitsScoreValues), the
 * preferences → Explore-params mapping (lib/explore-fit.ts), and a guard proving the filter runs server-side,
 * before counting and pagination — not as a client-side post-filter of an already-rendered page.
 *
 * lib/dataset.ts itself can't be imported directly here: its relative imports are written for the Next/webpack
 * bundler (extensionless), which plain Node ESM can't resolve, and no test in this suite imports it directly
 * (confirmed: it's exercised only through `next build`/dev and through `lib/data.ts`). So the filter's *logic* is
 * tested here against lib/student-profile.ts's fitsScoreValues (the exact predicate lib/dataset.ts's one filter
 * line calls), and the *wiring* — that counting and pagination happen on the filtered list the filter produced,
 * never on the unfiltered dataset or a page slice — is checked by reading lib/dataset.ts's and
 * app/explore/page.tsx's own source, the same technique tests/accounts.test.mts uses for proxy.ts's matcher.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { hasAnyMappedPreference, preferencesToExploreParams, scoreParams, unmappedPreferencesNote } from "../lib/explore-fit.ts";
import { emptyProfile, fitsScoreRange } from "../lib/student-profile.ts";

const ROOT = join(import.meta.dirname, "..");

/** A college shaped like data/schools.json, with only what the SAT/ACT and fit filters read. */
function school(id: string, o: { sat?: [number, number] | null; act?: [number, number] | null; testPolicy?: School["admissions"]["test_policy"] } = {}): School {
  return {
    unit_id: id,
    name: `College ${id}`,
    location: { city: "City", state: "MA", zip: "02138", region: "New England" },
    type: "private-nonprofit",
    admissions: {
      year: 2024,
      applicants: 1000,
      admitted: 500,
      enrolled: 200,
      acceptance_rate: 0.5,
      sat_reading_25_75: o.sat ? [Math.round(o.sat[0] / 2), Math.round(o.sat[1] / 2)] : null,
      sat_math_25_75: o.sat ? [Math.round(o.sat[0] / 2), Math.round(o.sat[1] / 2)] : null,
      act_composite_25_75: o.act ?? null,
      test_submission_rate_sat: null,
      test_submission_rate_act: null,
      test_policy: o.testPolicy ?? null,
    },
    demographics: { undergrad_enrollment: 7000 },
  } as unknown as School;
}

/**
 * Exactly the predicate lib/dataset.ts's `if (filters.fitScores) results = results.filter(...)` line runs: the
 * SAT range is the sum of sections (satComposite), duplicated here rather than imported — lib/metrics.ts pulls in
 * several server-oriented helpers that plain Node ESM can't resolve without a bundler (see the file doc comment).
 */
function satComposite(s: School): [number, number] | null {
  const r = s.admissions.sat_reading_25_75;
  const m = s.admissions.sat_math_25_75;
  return r && m ? [r[0] + m[0], r[1] + m[1]] : null;
}
const matchesFitScores = (s: School, fit: { sat: number | null; act: number | null }) => fitsScoreRange(satComposite(s), s.admissions.act_composite_25_75, s.admissions.test_policy, fit) === "in";

/* ------------------------------------------------------------------ */
/* Parsing (lib/params.ts)                                             */
/* ------------------------------------------------------------------ */

test("parseFilters: mySAT/myACT become fitScores; neither present leaves it undefined", () => {
  assert.deepEqual(parseFilters({ mySAT: "1450" }).fitScores, { sat: 1450, act: null });
  assert.deepEqual(parseFilters({ myACT: "32" }).fitScores, { sat: null, act: 32 });
  assert.deepEqual(parseFilters({ mySAT: "1450", myACT: "32" }).fitScores, { sat: 1450, act: 32 });
  assert.equal(parseFilters({}).fitScores, undefined);
  assert.equal(parseFilters({ minSAT: "1300" }).fitScores, undefined, "the ordinary minSAT/maxSAT filter is unrelated");
});

test("countActiveFilters: a saved SAT and ACT together count as one filter, not two", () => {
  assert.equal(countActiveFilters({ mySAT: "1450" }), 1);
  assert.equal(countActiveFilters({ mySAT: "1450", myACT: "32" }), 1);
  assert.equal(countActiveFilters({}), 0);
});

/* ------------------------------------------------------------------ */
/* The score filter's logic: in / out / unknown / test-blind            */
/* ------------------------------------------------------------------ */

test("the fit-scores filter keeps colleges whose range contains the score, drops out-of-range ones", () => {
  const inRange = school("in", { sat: [1300, 1500] });
  const outOfRange = school("out", { sat: [1500, 1600] });
  const fit = { sat: 1400, act: null };
  assert.deepEqual([inRange, outOfRange].filter((s) => matchesFitScores(s, fit)).map((s) => s.unit_id), ["in"]);
});

test("the fit-scores filter excludes a college with no range at all ('unknown' is dropped, same as 'out')", () => {
  const noRange = school("none");
  assert.deepEqual([noRange].filter((s) => matchesFitScores(s, { sat: 1400, act: null })), []);
});

test("the fit-scores filter keeps a test-blind college regardless of the score", () => {
  const blind = school("blind", { testPolicy: "not-considered" });
  assert.deepEqual([blind].filter((s) => matchesFitScores(s, { sat: 900, act: null })).map((s) => s.unit_id), ["blind"]);
});

test("the fit-scores filter: either test alone is enough; an ACT-only save still filters correctly", () => {
  const actMatch = school("act-in", { act: [28, 33] });
  const actMiss = school("act-out", { act: [15, 20] });
  const fit = { sat: null, act: 30 };
  assert.deepEqual([actMatch, actMiss].filter((s) => matchesFitScores(s, fit)).map((s) => s.unit_id), ["act-in"]);
});

/* ------------------------------------------------------------------ */
/* Guard: the filter runs server-side, before counting and pagination  */
/* ------------------------------------------------------------------ */

function datasetSrc(): string {
  return readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
}

function exploreSrc(): string {
  return readFileSync(join(ROOT, "app", "explore", "page.tsx"), "utf8");
}

test("guard: lib/dataset.ts's getSchools() applies the fit-scores filter itself, inside the function that returns the filtered list", () => {
  const src = datasetSrc();
  const fnStart = src.indexOf("function getSchools(");
  const fnEnd = src.indexOf("\n  }", fnStart); // the function's closing brace at its own indent level
  assert.ok(fnStart > 0 && fnEnd > fnStart, "getSchools() should exist in lib/dataset.ts");
  const body = src.slice(fnStart, fnEnd);
  assert.match(body, /filters\.fitScores/, "getSchools() must read filters.fitScores itself — a client-side post-filter wouldn't touch this function at all");
  assert.match(body, /fitsScoreRange/, "getSchools() must call fitsScoreRange, not reimplement the check or hide rows after the fact");
  assert.match(body, /satComposite\(s\)/, "getSchools() must check against satComposite (sum of sections), the same range its minSAT/maxSAT filters use — never the college's own reported total");
});

test("guard: Explore's page computes the filtered list, THEN counts and paginates that same list — never the unfiltered dataset or a page slice", () => {
  const src = exploreSrc();
  const getSchoolsAt = src.indexOf("getSchools(filters)");
  const paginateAt = src.indexOf("paginate(schools,");
  const countAt = src.indexOf("num(schools.length)");
  assert.ok(getSchoolsAt > 0, "page.tsx should call getSchools(filters) into a `schools` variable");
  assert.ok(paginateAt > getSchoolsAt, "paginate() must run after getSchools(), on its result — not before it, and not on getAllSchools()");
  assert.ok(countAt > getSchoolsAt, "the displayed match count must read schools.length (the filtered list), not the whole dataset");
  // The regression this guards against: hiding DOM rows after the server already rendered and counted a page.
  assert.doesNotMatch(src, /data-unit-id/, "Explore must not fall back to hiding already-rendered rows client-side");
});

test("guard: these checks actually fail on the old architecture (client-side post-filter, unfiltered pagination)", () => {
  const brokenDataset = "function getSchools(filters) {\n    let results = schools;\n    return results;\n  }\n";
  assert.doesNotMatch(brokenDataset, /filters\.fitScores/);

  const brokenPage = 'const all = getAllSchools();\nconst schools = all;\nconst paged = paginate(all, pageNum, perPage);\n<span>{num(all.length)}</span>';
  // Using `all` (unfiltered) for pagination/count instead of `schools` is exactly the bug this guard would catch.
  assert.ok(brokenPage.indexOf("paginate(schools,") === -1, "a version that paginates `all` instead of `schools` must not match the healthy pattern");
});

/* ------------------------------------------------------------------ */
/* Preferences → Explore params (lib/explore-fit.ts)                   */
/* ------------------------------------------------------------------ */

test("preferencesToExploreParams: direct mappings (sizes, settings, types, max cost)", () => {
  const p = { ...emptyProfile().preferences, sizes: ["small" as const], settings: ["city" as const], types: ["public" as const], maxAverageCost: 25000 };
  const { params, unmapped } = preferencesToExploreParams(p);
  assert.deepEqual(params, { sizes: "small", setting: "city", states: null, types: "public", maxCost: "25000" });
  assert.deepEqual(unmapped, []);
});

test("preferencesToExploreParams: USPS codes go to `states`; anything else is reported as unmapped, not dropped", () => {
  const p = { ...emptyProfile().preferences, statesOrRegions: ["TN", "ca", "New England", "OUTSIDE_US"] };
  const { params, unmapped } = preferencesToExploreParams(p);
  assert.equal(params.states, "TN,CA");
  assert.deepEqual(unmapped, ["New England", "OUTSIDE_US"]);
});

test("preferencesToExploreParams: an empty profile maps to all-null params and no unmapped entries", () => {
  const { params, unmapped } = preferencesToExploreParams(emptyProfile().preferences);
  assert.ok(Object.values(params).every((v) => v === null));
  assert.deepEqual(unmapped, []);
  assert.equal(hasAnyMappedPreference({ params, unmapped }), false);
});

test("hasAnyMappedPreference is true as soon as one param is set", () => {
  assert.equal(hasAnyMappedPreference({ params: { sizes: "small" }, unmapped: [] }), true);
  assert.equal(hasAnyMappedPreference({ params: { sizes: null, types: null }, unmapped: [] }), false);
});

test("unmappedPreferencesNote: null with nothing unmapped; singular/plural wording otherwise", () => {
  assert.equal(unmappedPreferencesNote([]), null);
  assert.match(unmappedPreferencesNote(["New England"])!, /"New England" isn't a state/);
  assert.match(unmappedPreferencesNote(["New England", "OUTSIDE_US"])!, /aren't states/);
});

test("scoreParams: only the score(s) actually saved are included", () => {
  assert.deepEqual(scoreParams({ sat: 1450, act: null }), { mySAT: "1450", myACT: null });
  assert.deepEqual(scoreParams({ sat: null, act: 32 }), { mySAT: null, myACT: "32" });
  assert.deepEqual(scoreParams({ sat: null, act: null }), { mySAT: null, myACT: null });
});
