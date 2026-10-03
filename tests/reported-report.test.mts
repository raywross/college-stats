/**
 * lib/reported-report.ts: the pure helpers behind `npm run report-college-reported` (scripts/report-college-reported.mts).
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "../lib/types";
import type { ReportedFile } from "../lib/reported.ts";
import { collegeRows, mergedCount, totals } from "../lib/reported-report.ts";

const reported: ReportedFile = {
  updated: "2026-10-03",
  entries: [
    {
      unit_id: "999010",
      admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: 1865, enrolled: null, acceptance_rate: 0.04, source_kind: "class-profile" },
      lineage: {
        "reported.admissions.applicants": { source: "college-site", method: "extracted", year: "Fall 2026", url: "https://fixture.edu/profile", retrieved: "2026-10-03", quote: "46,618 applied" },
      },
      run: "run-1",
    },
    {
      unit_id: "999011",
      admissions: { entering_term: "Fall 2025", year: 2025, applicants: 20000, admitted: 10000, enrolled: 5000, acceptance_rate: 0.5, source_kind: "cds" },
      lineage: {
        "reported.admissions.applicants": { source: "college-site", method: "extracted", year: "Fall 2025", url: "https://fixture.edu/cds.pdf", retrieved: "2026-09-01", quote: "20,000 applied" },
      },
      run: "run-0",
    },
  ],
};

const names = new Map([
  ["999010", "Fixture Newly Published University"],
  ["999011", "Fixture Older Published College"],
]);

test("collegeRows lists each entry's term, kind, present values, URL, and run", () => {
  const rows = collegeRows(reported, names);
  assert.equal(rows.length, 2);
  const row = rows.find((r) => r.unit_id === "999010")!;
  assert.equal(row.name, "Fixture Newly Published University");
  assert.equal(row.term, "Fall 2026");
  assert.equal(row.kind, "class-profile");
  assert.deepEqual(row.present, ["applicants", "admitted", "rate"]); // enrolled is null
  assert.equal(row.url, "https://fixture.edu/profile");
  assert.equal(row.run, "run-1");
});

test("collegeRows falls back to the unit id when no name is given", () => {
  const rows = collegeRows(reported, new Map());
  assert.ok(rows.every((r) => r.name === r.unit_id));
});

test("totals counts by entering term and by source kind", () => {
  const rows = collegeRows(reported, names);
  const { byTerm, byKind } = totals(rows);
  assert.deepEqual(byTerm, { "Fall 2026": 1, "Fall 2025": 1 });
  assert.deepEqual(byKind, { "class-profile": 1, cds: 1 });
});

test("mergedCount counts schools that currently carry a reported block", () => {
  const schools = [
    { unit_id: "1", reported: { admissions: reported.entries[0].admissions } },
    { unit_id: "2" },
    { unit_id: "3", reported: {} },
  ] as unknown as School[];
  assert.equal(mergedCount(schools), 1);
});
