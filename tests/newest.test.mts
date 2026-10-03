/**
 * `lib/newest.ts#applyNewest` / `restoreFederal`: a college's newer published class replaces its older admissions
 * figures in the dataset itself, value by value, and comes back out exactly (specs/college-reported-round-2.md,
 * Decision 1, "What replaces what"). Also `lib/metrics.ts#yieldRate`, which must never mix classes. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyNewest, restoreFederal } from "../lib/newest.ts";
import { stripReported } from "../lib/reported-merge.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sameClassYield } from "../lib/derive.ts";
import type { LineageRecord, ReportedAdmissions, School } from "../lib/types.ts";

const RETRIEVED = "2026-10-03";
const URL = "https://example.edu/class-profile";
const rec = (quote: string, year = "Fall 2026"): LineageRecord => ({ source: "college-site", method: "extracted", year, url: URL, retrieved: RETRIEVED, quote });
const CDS: LineageRecord = { source: "cds", year: "2024-25", url: "https://example.edu/cds.xlsx", retrieved: "2026-09-27" };

const FEDERAL = { year: 2024, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 };

/** A school as merge-reported builds it before `applyNewest`: federal (or CDS) funnel, a reported block and its lineage. */
function school(reported: Partial<ReportedAdmissions> | null, opts: { cds?: boolean } = {}): School {
  const admissions = {
    ...FEDERAL,
    sat_reading_25_75: null,
    sat_math_25_75: null,
    act_composite_25_75: null,
    test_submission_rate_sat: null,
    test_submission_rate_act: null,
  };
  const lineage: NonNullable<School["lineage"]> = {};
  if (opts.cds) for (const k of ["year", "applicants", "admitted", "enrolled", "acceptance_rate"] as const) lineage[`admissions.${k}`] = { ...CDS };
  const s = { unit_id: "1", name: "Example College", admissions, ...(opts.cds ? { cds: { edition: "2024-25", url: CDS.url! } } : {}) } as unknown as School;
  if (reported) {
    const r: ReportedAdmissions = { entering_term: "Fall 2026", year: 2026, applicants: null, admitted: null, enrolled: null, acceptance_rate: null, source_kind: "class-profile", ...reported };
    s.reported = { admissions: r };
    for (const k of ["entering_term", "year", "source_kind", "applicants", "admitted", "enrolled", "acceptance_rate"] as const) {
      if (r[k] != null) lineage[`reported.admissions.${k}`] = rec(`${k}: ${r[k]}`, r.entering_term);
    }
  }
  if (Object.keys(lineage).length) s.lineage = lineage;
  return s;
}

const FULL = { applicants: 46618, admitted: 1865, enrolled: 1500, acceptance_rate: 0.04 };

test("full replacement: every funnel value, the year, and admissions.federal; reported block kept", () => {
  const before = school(FULL);
  const s = applyNewest(before);
  assert.notStrictEqual(s, before);
  assert.deepEqual(
    { year: s.admissions.year, applicants: s.admissions.applicants, admitted: s.admissions.admitted, enrolled: s.admissions.enrolled, acceptance_rate: s.admissions.acceptance_rate },
    { year: 2026, ...FULL }
  );
  assert.deepEqual(s.admissions.federal, FEDERAL);
  assert.deepEqual(s.lineage!["admissions.applicants"], rec("applicants: 46618"));
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], rec("acceptance_rate: 0.04"));
  assert.deepEqual(s.lineage!["admissions.year"], rec("entering_term: Fall 2026"));
  assert.equal(s.lineage!["admissions.federal"], undefined, "federal default: no record");
  assert.deepEqual(s.reported, before.reported);
  // Never mutates its input.
  assert.equal(before.admissions.applicants, FEDERAL.applicants);
  assert.equal(before.admissions.federal, undefined);
  // admissions.federal sits right after the funnel, before the test scores.
  assert.deepEqual(Object.keys(s.admissions).slice(0, 7), ["year", "applicants", "admitted", "enrolled", "acceptance_rate", "federal", "sat_reading_25_75"]);
});

test("applicants only: applicants and year replaced; admitted and enrolled stay federal; the rate is kept, cited as calculated from the federal counts", () => {
  const s = applyNewest(school({ applicants: 50000 }));
  assert.equal(s.admissions.applicants, 50000);
  assert.equal(s.admissions.year, 2026);
  assert.equal(s.admissions.admitted, FEDERAL.admitted);
  assert.equal(s.admissions.enrolled, FEDERAL.enrolled);
  assert.equal(s.admissions.acceptance_rate, FEDERAL.acceptance_rate);
  assert.equal(s.lineage!["admissions.admitted"], undefined);
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], { source: "ipeds-adm", method: "derived", year: "Fall 2024" });
});

test("enrolled only: enrolled replaced, the year stays (enrolled alone doesn't define a class)", () => {
  const s = applyNewest(school({ enrolled: 1900 }));
  assert.equal(s.admissions.enrolled, 1900);
  assert.equal(s.admissions.year, 2024);
  assert.equal(s.lineage!["admissions.year"], undefined);
  assert.deepEqual(s.lineage!["admissions.enrolled"], rec("enrolled: 1900"));
  assert.deepEqual(s.admissions.federal, FEDERAL);
});

test("rate only: the stated rate replaces the federal one; counts and year stay federal", () => {
  const s = applyNewest(school({ acceptance_rate: 0.038 }));
  assert.equal(s.admissions.acceptance_rate, 0.038);
  assert.equal(s.admissions.applicants, FEDERAL.applicants);
  assert.equal(s.admissions.year, 2024);
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], rec("acceptance_rate: 0.038"));
});

test("no stated rate but both counts: admitted ÷ applicants, derived from the college's two quotes", () => {
  const s = applyNewest(school({ applicants: 50000, admitted: 2500 }));
  assert.equal(s.admissions.acceptance_rate, 0.05);
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], {
    source: "college-site",
    method: "derived",
    year: "Fall 2026",
    url: URL,
    retrieved: RETRIEVED,
    quote: "applicants: 50000 / admitted: 2500",
  });
});

test("a previous rate of null stays null, with no record", () => {
  const before = school({ applicants: 50000 });
  before.admissions.acceptance_rate = null;
  const s = applyNewest(before);
  assert.equal(s.admissions.acceptance_rate, null);
  assert.equal(s.lineage!["admissions.acceptance_rate"], undefined);
});

test("not newer, no reported block, or nothing published: the same object back", () => {
  const same = school({ ...FULL, year: 2024, entering_term: "Fall 2024" });
  assert.strictEqual(applyNewest(same), same);
  const none = school(null);
  assert.strictEqual(applyNewest(none), none);
  const empty = school({});
  assert.strictEqual(applyNewest(empty), empty);
});

test("federal has no year at all: any reported class counts as newer", () => {
  const before = school({ applicants: 50000 });
  before.admissions.year = null;
  const s = applyNewest(before);
  assert.equal(s.admissions.year, 2026);
  assert.equal(s.admissions.federal?.year, null);
});

test("a hand-imported CDS override is replaced the same way: admissions.federal holds the CDS values, cited to the CDS", () => {
  const s = applyNewest(school({ applicants: 50000, enrolled: 1700 }, { cds: true }));
  assert.deepEqual(s.admissions.federal, FEDERAL);
  assert.deepEqual(s.lineage!["admissions.federal"], CDS);
  assert.deepEqual(s.lineage!["admissions.applicants"], rec("applicants: 50000"));
  assert.deepEqual(s.lineage!["admissions.admitted"], CDS, "not replaced: keeps its CDS record");
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], { ...CDS, method: "derived" }, "kept rate: calculated from the CDS counts");
  // Key order of an override's lineage is kept (records rewritten in place).
  assert.deepEqual(Object.keys(s.lineage!).slice(0, 5), ["admissions.year", "admissions.applicants", "admissions.admitted", "admissions.enrolled", "admissions.acceptance_rate"]);
});

test("idempotent: applying to an applied school returns it unchanged", () => {
  for (const r of [FULL, { applicants: 50000 }, { enrolled: 1900 }, { acceptance_rate: 0.03 }]) {
    const once = applyNewest(school(r));
    assert.strictEqual(applyNewest(once), once);
  }
});

test("restoreFederal (and stripReported) put back exactly what was there, byte for byte", () => {
  for (const cds of [false, true]) {
    for (const r of [FULL, { applicants: 50000 }, { enrolled: 1900 }, { acceptance_rate: 0.03 }, { applicants: 50000, admitted: 2500 }]) {
      const before = school(r, { cds });
      const applied = applyNewest(before);
      assert.equal(JSON.stringify(restoreFederal(applied)), JSON.stringify(before), `${JSON.stringify(r)} cds=${cds}`);
      // The college dropped from college-reported.json: no reported block, no reported lineage, federal funnel back.
      assert.equal(JSON.stringify(stripReported(applied)), JSON.stringify(stripReported(before)));
    }
  }
  // Nothing to restore: same object.
  const plain = school(null);
  assert.strictEqual(restoreFederal(plain), plain);
});

test("a value whose lineage isn't the funnel's own (e.g. a Scorecard-only rate) is left alone, so it can be restored", () => {
  const before = school({ acceptance_rate: 0.03, applicants: 50000 });
  before.lineage!["admissions.acceptance_rate"] = { source: "scorecard" };
  const s = applyNewest(before);
  assert.equal(s.admissions.applicants, 50000);
  assert.equal(s.admissions.acceptance_rate, FEDERAL.acceptance_rate);
  assert.deepEqual(s.lineage!["admissions.acceptance_rate"], { source: "scorecard" });
  assert.equal(JSON.stringify(restoreFederal(s)), JSON.stringify(before));
});

/* ---- Yield never mixes classes (lib/metrics.ts#yieldRate) ---- */

// lib/metrics.ts#yieldRate is `sameClassYield` (lib/metrics.ts imports without .ts extensions, so Node can't load it).
const yieldRate = sameClassYield;

test("lib/metrics.ts#yieldRate is sameClassYield", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "lib", "metrics.ts"), "utf8");
  assert.match(src, /export function yieldRate\(s: School\): number \| null \{\s*return sameClassYield\(s\);\s*\}/);
});

test("mixed-class yield uses the previous class's pair; same-class yield uses the newest pair", () => {
  const mixed = applyNewest(school({ enrolled: 1900 })); // enrolled fall 2026, admitted fall 2024
  assert.equal(yieldRate(mixed), FEDERAL.enrolled / FEDERAL.admitted);
  const same = applyNewest(school(FULL));
  assert.equal(yieldRate(same), FULL.enrolled / FULL.admitted);
  const cdsMixed = applyNewest(school({ enrolled: 1700 }, { cds: true }));
  assert.equal(yieldRate(cdsMixed), FEDERAL.enrolled / FEDERAL.admitted);
  assert.equal(yieldRate(school(null)), FEDERAL.enrolled / FEDERAL.admitted);
});
