/**
 * Explore's render cost (specs/serving-architecture.md section 5): the filter-panel counts are built once per dataset
 * (`facets()`), and the source note merges per-college arrays worked out once (`sourcesForSchoolsFast`). Runs against
 * the real files in data/. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Dataset } from "../lib/dataset.ts";
import type { SearchFilters } from "../lib/types.ts";

const ROOT = join(import.meta.dirname, "..");

// lib/dataset.ts and its imports are written for the Next bundler (extensionless relative imports, "@/" paths), which
// plain Node can't resolve; map them to files for this test only. (module.registerHooks is in Node 22.15+ and 24;
// the installed @types/node predates it.)
type ResolveResult = { url: string; shortCircuit?: boolean };
type NextResolve = (specifier: string, context: { parentURL?: string }) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): ResolveResult }): void;
};
function asFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(candidate) && !candidate.endsWith("/") && /\.tsx?$/.test(candidate)) return candidate;
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    let base: string | null = null;
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:"))
      base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const file = base && !/\.tsx?$/.test(base) ? asFile(base) : null;
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const { createDataset } = await import("../lib/dataset.ts");
const { buildFacets } = await import("../lib/explore-facets.ts");
const { METRICS } = await import("../lib/metrics.ts");

const read = (file: string) => JSON.parse(readFileSync(join(ROOT, "data", file), "utf8"));
const files = { schools: read("schools.json"), meta: read("meta.json"), releaseCalendar: read("release-calendar.json"), aliases: read("aliases.json") };

/** The field list app/explore/page.tsx hands MultiSourceNote (plus the map and home-distance additions). */
const EXPLORE_FIELDS = [...Object.values(METRICS).map((m) => m.field), "academics.majors_top"] as const;
const EXPLORE_MAP_FIELDS = [...EXPLORE_FIELDS, "location.lat", "campus.setting"] as const;
const EXPLORE_HOME_FIELDS = [...EXPLORE_FIELDS, "location.lat"] as const;

const FILTERS: [name: string, filters: SearchFilters][] = [
  ["unfiltered", {}],
  ["search: boston", { q: "boston" }],
  ["California publics", { states: ["CA"], types: ["public"] }],
];

function fresh(): Dataset {
  return createDataset({ ...files, schools: structuredClone(files.schools) });
}

test("facets() computes once per dataset and returns the same object after that", () => {
  const data = fresh();
  const first = data.facets();
  assert.equal(data.facets(), first);
  assert.notEqual(fresh().facets(), first, "each dataset keeps its own");
});

test("facets() equals what the Explore page builds from the same dataset", () => {
  const data = fresh();
  const facets = data.facets();
  assert.deepEqual(facets, buildFacets(data));
  // Spot checks that don't go through buildFacets: the counts describe every college, whatever the filter.
  const all = data.getAllSchools();
  assert.equal(facets.states.reduce((a, s) => a + s.count, 0), all.length);
  assert.equal(facets.types.reduce((a, t) => a + t.count, 0), all.length);
  assert.equal(facets.regions.reduce((a, r) => a + r.count, 0), all.length);
  assert.deepEqual(facets.arBins, data.histogram("acceptance", 20, [0, 1]));
  assert.equal(facets.states.find((s) => s.value === "CA")?.count, all.filter((s) => s.location.state === "CA").length);
});

test("sourcesForSchoolsFast returns the same sources, in the same order, as sourcesForSchools", () => {
  const data = fresh();
  for (const [name, filters] of FILTERS) {
    const list = data.getSchools(filters);
    assert.ok(list.length > 0, `${name} matches colleges`);
    for (const fields of [EXPLORE_FIELDS, EXPLORE_MAP_FIELDS, EXPLORE_HOME_FIELDS]) {
      const slow = data.sourcesForSchools(fields, list);
      assert.deepEqual(data.sourcesForSchoolsFast(fields, list), slow, `${name} (cold)`);
      assert.deepEqual(data.sourcesForSchoolsFast(fields, list), slow, `${name} (memoized)`);
    }
  }
  assert.deepEqual(data.sourcesForSchoolsFast(EXPLORE_FIELDS, []), []);
});

test("sourcesForSchoolsFast keeps each field list apart and sees a school's own sources (a CDS override)", () => {
  const data = fresh();
  const all = data.getAllSchools();
  const withCds = all.find((s) => s.cds);
  assert.ok(withCds, "the dataset has a college with its own Common Data Set");
  for (const fields of [["admissions.acceptance_rate"], ["admissions.acceptance_rate", "location.lat"], [...EXPLORE_FIELDS]] as const) {
    assert.deepEqual(data.sourcesForSchoolsFast(fields, [withCds]), data.sourcesForSchools(fields, [withCds]));
  }
  assert.deepEqual(data.sourcesForSchoolsFast(EXPLORE_FIELDS, all), data.sourcesForSchools(EXPLORE_FIELDS, all));
});

test("an unfiltered Explore round is cheap on the second call", () => {
  const data = fresh();
  const round = () => {
    const t = performance.now();
    const list = data.getSchools({});
    data.facets();
    data.sourcesForSchoolsFast(EXPLORE_FIELDS, list);
    return performance.now() - t;
  };
  const first = round();
  const second = round();
  console.log(`explore round: first ${first.toFixed(1)} ms, second ${second.toFixed(1)} ms`);
  assert.ok(second < 150, `second round took ${second.toFixed(1)} ms`);
  assert.ok(second < first, "the memos are what make the second round cheap");
});
