/**
 * `lib/newest.ts`: which class's figures a profile's admissions headline shows (specs/college-reported-round-2.md,
 * Decision 1). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newestAdmissions } from "../lib/newest.ts";
import type { School } from "../lib/types.ts";

/** A minimal admissions-only fixture; only `admissions` and `reported` matter to `newestAdmissions`. */
function school(admissions: Partial<School["admissions"]>, reported?: School["reported"]): Pick<School, "admissions" | "reported"> {
  return {
    admissions: {
      year: null,
      applicants: null,
      admitted: null,
      enrolled: null,
      acceptance_rate: null,
      sat_reading_25_75: null,
      sat_math_25_75: null,
      act_composite_25_75: null,
      test_submission_rate_sat: null,
      test_submission_rate_act: null,
      ...admissions,
    },
    reported,
  };
}

test("no reported data: federal funnel, federal paths", () => {
  const s = school({ year: 2024, applicants: 1000, admitted: 300, enrolled: 100, acceptance_rate: 0.3 });
  const n = newestAdmissions(s);
  assert.equal(n.source, "federal");
  assert.equal(n.year, 2024);
  assert.equal(n.term, "Fall 2024");
  assert.equal(n.applicants, 1000);
  assert.equal(n.acceptance_rate, 0.3);
  assert.equal(n.yield, 100 / 300);
  assert.deepEqual(n.paths, {
    applicants: "admissions.applicants",
    admitted: "admissions.admitted",
    enrolled: "admissions.enrolled",
    acceptance_rate: "admissions.acceptance_rate",
  });
  assert.equal(n.partial, null);
});

test("reported funnel newer than federal, with full counts: reported wins, yield from reported counts", () => {
  const s = school(
    { year: 2024, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: 1865, enrolled: 1500, acceptance_rate: 0.04, source_kind: "class-profile" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "reported");
  assert.equal(n.year, 2026);
  assert.equal(n.term, "Fall 2026");
  assert.equal(n.applicants, 46618);
  assert.equal(n.admitted, 1865);
  assert.equal(n.enrolled, 1500);
  assert.equal(n.acceptance_rate, 0.04);
  assert.equal(n.yield, 1500 / 1865);
  assert.deepEqual(n.paths, {
    applicants: "reported.admissions.applicants",
    admitted: "reported.admissions.admitted",
    enrolled: "reported.admissions.enrolled",
    acceptance_rate: "reported.admissions.acceptance_rate",
  });
  assert.equal(n.partial, null);
});

test("reported has only a stated rate (no counts): still qualifies as the funnel", () => {
  const s = school(
    { year: 2024, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2025", year: 2025, applicants: null, admitted: null, enrolled: null, acceptance_rate: 0.117, source_kind: "class-profile" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "reported");
  assert.equal(n.acceptance_rate, 0.117);
  assert.equal(n.applicants, null);
  // Yield needs admitted/enrolled from the same source; neither is present, so no yield is invented.
  assert.equal(n.yield, null);
});

test("reported funnel never mixes sources: enrolled missing from reported means no reported yield, not a federal one", () => {
  const s = school(
    { year: 2024, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: 1865, enrolled: null, acceptance_rate: 0.04, source_kind: "cds" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "reported");
  assert.equal(n.enrolled, null);
  assert.equal(n.yield, null);
});

test("reported not newer than federal: federal wins outright, no partial line", () => {
  const s = school(
    { year: 2026, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2025", year: 2025, applicants: 39000, admitted: 1900, enrolled: 1700, acceptance_rate: 0.0487, source_kind: "cds" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "federal");
  assert.equal(n.year, 2026);
  assert.equal(n.partial, null);
});

test("reported equal to federal year: not newer, federal wins", () => {
  const s = school(
    { year: 2025, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2025", year: 2025, applicants: 39500, admitted: 1950, enrolled: null, acceptance_rate: 0.0494, source_kind: "cds" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "federal");
  assert.equal(n.partial, null);
});

test("reported newer but applicants only: shown as a partial line under the federal funnel", () => {
  const s = school(
    { year: 2024, applicants: 40000, admitted: 2000, enrolled: 1800, acceptance_rate: 0.05 },
    { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: null, enrolled: null, acceptance_rate: null, source_kind: "class-profile" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "federal");
  assert.equal(n.applicants, 40000, "the headline funnel stays federal");
  assert.ok(n.partial);
  assert.equal(n.partial!.applicants, 46618);
  assert.equal(n.partial!.term, "Fall 2026");
  assert.deepEqual(n.partial!.paths, { applicants: "reported.admissions.applicants" });
  assert.equal(n.partial!.admitted, undefined);
  assert.equal(n.partial!.acceptance_rate, undefined);
});

test("federal has no year at all: any reported figure counts as newer", () => {
  const s = school(
    { year: null, applicants: null, admitted: null, enrolled: null, acceptance_rate: null },
    { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 10000, admitted: 4000, enrolled: null, acceptance_rate: 0.4, source_kind: "cds" } }
  );
  const n = newestAdmissions(s);
  assert.equal(n.source, "reported");
  assert.equal(n.year, 2026);
});
