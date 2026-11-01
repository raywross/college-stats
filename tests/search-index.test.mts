/**
 * The search index (lib/search-index.ts, app/search-index.json/route.ts; specs/serving-architecture.md#3-search-in-the-browser):
 * every college once, small enough to ship, the browser's matcher gives exactly the server's `searchSchools` results,
 * and the route stays static. Runs against the mini fixture (tests/helpers/snapshot.mts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import { gzipSync } from "node:zlib";
import { buildSearchIndex, matchIndex, type SearchIndex } from "../lib/search-index.ts";
import { miniAliases, miniMeta, miniReleaseCalendar, miniSchools } from "./helpers/snapshot.mts";

/**
 * lib/dataset.ts is written for the bundler (extensionless relative imports), which plain Node can't resolve
 * (tests/explore-fit.test.mts notes the same). This test must compare against the real `searchSchools`, so it
 * registers a resolve hook that retries a failed relative import with `.ts`, then imports the dataset.
 */
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
      try { return await next(specifier, context); }
      catch (error) {
        if (!specifier.startsWith(".") || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
        try { return await next(specifier + ".ts", context); } catch { return next(specifier + "/index.ts", context); }
      }
    }`),
);
const { createDataset, toIndexEntry } = await import("../lib/dataset.ts");

const ROOT = join(import.meta.dirname, "..");
const aliases = miniAliases();
const dataset = createDataset({ schools: miniSchools(), meta: miniMeta(), releaseCalendar: miniReleaseCalendar(), aliases });
const index = buildSearchIndex(dataset, aliases);

test("every college appears exactly once, in dataset order", () => {
  const all = dataset.getAllSchools();
  assert.equal(index.schools.length, all.length);
  assert.deepEqual(index.schools.map((e) => e.id), all.map((s) => s.unit_id));
  assert.equal(new Set(index.schools.map((e) => e.id)).size, all.length);
  assert.equal(index.generated, dataset.getMeta().retrieved);
});

test("each entry's display fields are exactly toIndexEntry's", () => {
  const all = dataset.getAllSchools();
  index.schools.forEach((e, i) => {
    const { applicants, ...rest } = e;
    const display = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "aliases"));
    assert.deepEqual(display, toIndexEntry(all[i]));
    assert.equal(applicants, all[i].admissions.applicants);
  });
});

test("the index carries each college's alias rows", () => {
  assert.equal(index.schools.reduce((n, e) => n + e.aliases.length, 0), aliases.length);
  const uga = index.schools.find((e) => e.name === "University of Georgia");
  assert.ok(uga);
  assert.ok(uga.aliases.some(([alias]) => alias.toLowerCase() === "uga"));
});

test("the index stays small enough to ship: per college, within the budget of 600,000 bytes raw for 1,893 colleges", () => {
  // Measured 2026-10-07 over the real data: ~522,000 raw, ~98,000 gzipped (crest brand objects ~115,000 of it, alias
  // rows ~100,000), budgets 600,000 and 150,000. The fixed entry shape (with `brand` and `aliases`) is ~275 bytes. The
  // mini fixture's 38 colleges can't show the whole file's size, so the raw budget is checked per college; its
  // colleges are bigger than most (well-known names carry more aliases), hence the factor of two.
  const json = JSON.stringify(index);
  const raw = Buffer.byteLength(json);
  const perCollege = raw / index.schools.length;
  assert.ok(perCollege < (2 * 600_000) / 1_893, `search index is ${Math.round(perCollege)} bytes per college raw`);
  assert.ok(gzipSync(json).length < raw / 3, "and compresses well");
});

const QUERIES = ["u", "uga", "georgia tech", "vand", "alabama", "MIT", "university of a"];

for (const q of QUERIES) {
  test(`matchIndex agrees with searchSchools for "${q}" (limit 8)`, () => {
    // Through JSON, as the browser receives it.
    const loaded = JSON.parse(JSON.stringify(index)) as SearchIndex;
    const expected = dataset.searchSchools(q, 8);
    const actual = matchIndex(loaded, q, { limit: 8 });
    assert.ok(expected.length > 0, `"${q}" should match something`);
    assert.deepEqual(actual.map((r) => r.id), expected.map((r) => r.id));
    assert.deepEqual(actual, expected);
  });
}

test("matchIndex honors exclude and an empty query like searchSchools", () => {
  const first = dataset.searchSchools("uga", 3);
  const skip = [first[0].id];
  assert.deepEqual(matchIndex(index, "uga", { limit: 3, exclude: skip }).map((r) => r.id), dataset.searchSchools("uga", 3, skip).map((r) => r.id));
  assert.deepEqual(matchIndex(index, "   "), []);
});

test("the route is static and imports nothing that reads the session", () => {
  const src = readFileSync(join(ROOT, "app", "search-index.json", "route.ts"), "utf8");
  assert.match(src, /^export const dynamic = "force-static";?$/m);
  assert.doesNotMatch(src, /next\/headers|@\/lib\/auth|@\/lib\/supabase-server|\bconnection\(\)/);
});
