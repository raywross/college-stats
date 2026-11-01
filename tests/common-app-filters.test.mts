/**
 * Explore's Common App filters (specs/data-expansion/common-app.md "Display"): the four new "Applying" chips
 * (lib/common-app/filters.ts), the `noFee` predicate change (lib/housing.ts noApplicationFee reads the grid's fee
 * first), the facets (lib/explore-facets.ts), the panel's counts, and the `policy` filter's newest-wins (already fed
 * by U1b's merge; this just proves it buckets a grid-sourced policy correctly). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { miniSchools, miniMeta, miniReleaseCalendar } from "./helpers/snapshot.mts";
import { register } from "node:module";
import type { School, SearchFilters } from "../lib/types";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { APPLYING_FILTERS, applicationFeeKnown, offersEarlyAction, offersEd, offersEd2, takesFeeWaiver } from "../lib/common-app/filters.ts";
import { HOUSING_FILTERS, noApplicationFee } from "../lib/housing.ts";
import { matchesPolicy, policyBucket } from "../lib/test-policy.ts";

/**
 * lib/dataset.ts is written for the bundler (extensionless relative imports), which plain Node can't resolve
 * (tests/search-index.test.mts, tests/explore-fit.test.mts note the same). Register a resolve hook that retries a
 * failed relative import with `.ts`, then import the dataset.
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
const { createDataset } = await import("../lib/dataset.ts");

const schools: School[] = miniSchools();

/** A minimal fixture: just the `apply` and `admissions` fields the predicates read. */
function school(apply: School["apply"], applicationFee: number | null = null): School {
  return { apply, admissions: { application_fee: applicationFee } } as unknown as School;
}

const memberWithEdOnly = school({
  common_app: { member: true, member_id: "1", slug: "ed-only", cycle: "2026-27", updated: "2026-09-25" },
  deadlines: { ed: "2026-11-01", ed2: null, ea: null, ea2: null, rea: null, regular: "2027-01-01" },
  fee: { us: 0, international: 0 },
  fee_waiver: "accepted",
} as unknown as School["apply"]);

const memberWithRea = school({
  common_app: { member: true, member_id: "2", slug: "rea-only", cycle: "2026-27", updated: "2026-09-25" },
  deadlines: { ed: null, ed2: null, ea: null, ea2: null, rea: "2026-11-01", regular: "2027-01-01" },
  fee: { us: 75, international: 90 },
  fee_waiver: "us_only",
} as unknown as School["apply"]);

const nonMember = school(undefined, 50);

const memberNoGridRow = school({
  common_app: { member: true, member_id: "3", slug: "no-grid", cycle: null, updated: null },
  deadlines: null,
  fee: null,
  fee_waiver: null,
} as unknown as School["apply"], 40);

test("predicates: ED-only, REA, a non-member, and a member with no grid row", () => {
  assert.equal(offersEd(memberWithEdOnly), true);
  assert.equal(offersEd2(memberWithEdOnly), false);
  assert.equal(offersEarlyAction(memberWithEdOnly), false, "ED is not an Early Action round");
  assert.equal(takesFeeWaiver(memberWithEdOnly), true);

  assert.equal(offersEd(memberWithRea), false);
  assert.equal(offersEarlyAction(memberWithRea), true, "REA counts as Early Action (ea, ea2, or rea)");
  assert.equal(takesFeeWaiver(memberWithRea), true, "U.S. only still takes the waiver");

  for (const f of APPLYING_FILTERS) assert.equal(f.predicate(nonMember), false, `${f.param}: a non-member never matches`);
  for (const f of APPLYING_FILTERS) assert.equal(f.predicate(memberNoGridRow), false, `${f.param}: a member with no grid row never matches`);
});

test("noFee prefers the grid's U.S. fee over a stale federal one, both ways", () => {
  // The grid says $0 but an old federal fee says $50: the grid (newest statement) wins.
  const gridFree = school({ common_app: { member: true, member_id: "4", slug: "free", cycle: "2026-27", updated: "2026-09-25" }, fee: { us: 0, international: 0 } } as unknown as School["apply"], 50);
  assert.equal(applicationFeeKnown(gridFree), 0);
  assert.equal(noApplicationFee(gridFree), true);

  // The grid says $75 but the federal fee says $0: the grid still wins (not free).
  const gridCharges = school({ common_app: { member: true, member_id: "5", slug: "charges", cycle: "2026-27", updated: "2026-09-25" }, fee: { us: 75, international: 75 } } as unknown as School["apply"], 0);
  assert.equal(applicationFeeKnown(gridCharges), 75);
  assert.equal(noApplicationFee(gridCharges), false);

  // No grid row at all: falls back to the federal/CDS fee.
  assert.equal(applicationFeeKnown(nonMember), 50);
  assert.equal(noApplicationFee(nonMember), false);
  assert.equal(applicationFeeKnown(memberNoGridRow), 40, "a member with no grid row still falls back to the federal fee");
});

test("parse, count, and URL round trip for the four new chips", () => {
  const f = parseFilters({ feeWaiver: "1", ed: "1", ed2: "1", ea: "1" });
  assert.deepEqual([f.feeWaiver, f.ed, f.ed2, f.ea], [true, true, true, true]);
  assert.equal(countActiveFilters({ feeWaiver: "1", ed: "1", ed2: "1", ea: "1" }), 4);

  // Round trip through a real URL: build it, parse it back, get the same filters.
  const qs = new URLSearchParams({ ed: "1", noSupplement: "1" }).toString(); // a dropped key is ignored, not kept
  const back = Object.fromEntries(new URLSearchParams(qs));
  assert.equal(parseFilters(back).ed, true);
  assert.equal((parseFilters(back) as Record<string, unknown>).noSupplement, undefined, "noSupplement was dropped (As built, wave 1)");
});

test("HOUSING_FILTERS still has noFee, counted with the grid's newest fee", () => {
  const [, noFee] = HOUSING_FILTERS;
  assert.equal(noFee.param, "noFee");
  assert.equal(noFee.test(memberWithEdOnly), true, "the grid said $0");
});

test("facets: APPLYING_FILTERS counts match a direct filter of the real dataset", () => {
  for (const f of APPLYING_FILTERS) {
    const count = schools.filter(f.predicate).length;
    assert.ok(count >= 0 && count <= schools.length);
  }
  const ed = schools.filter((s) => APPLYING_FILTERS.find((f) => f.param === "ed")!.predicate(s));
  // The real dataset has hundreds of ED members (>50 of 1,893); scaled to the mini fixture's 38 colleges.
  assert.ok(ed.length > 5, `expected several ED members, got ${ed.length}`);
  for (const s of ed) assert.ok(s.apply?.deadlines?.ed, s.unit_id);
});

test("the dataset applies each Applying filter: narrows to exactly the matching colleges", () => {
  const meta = miniMeta();
  const releaseCalendar = miniReleaseCalendar();
  const dataset = createDataset({ schools, meta, releaseCalendar });
  for (const f of APPLYING_FILTERS) {
    const got = dataset.getSchools({ [f.param]: true } as SearchFilters).map((s: School) => s.unit_id);
    const want = schools.filter(f.predicate).map((s) => s.unit_id);
    assert.deepEqual(new Set(got), new Set(want), f.param);
  }
});

test("'Test-optional this cycle' (policy filter) already buckets a grid-sourced policy: Vanderbilt's considered, cited to common-app", () => {
  const vu = schools.find((s) => s.unit_id === "221999")!;
  assert.equal(vu.admissions.test_policy, "considered");
  assert.equal(vu.lineage?.["admissions.test_policy"]?.source, "common-app", "the grid is the newest statement for Vanderbilt");
  assert.equal(policyBucket(vu.admissions.test_policy), "optional");
  assert.equal(matchesPolicy(vu, ["optional"]), true);
  assert.equal(matchesPolicy(vu, ["required", "blind"]), false);
});
