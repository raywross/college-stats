/**
 * scripts/merge-reported.mts (Decision 5, specs/college-reported-round-2.md): merges data/college-reported.json
 * into the committed data/schools.json, the same way scripts/sync-data.mts does (lib/reported-merge.ts), so the
 * data PR carries the site's figures without a separate `npm run sync-data`. `npm test`.
 *
 * Runs the real CLI (via `MERGE_REPORTED_ROOT`) against a scratch copy of a slice of the dataset (the mini fixture,
 * tests/helpers/snapshot.mts), so the line format and the lineage guard are exercised exactly as a workflow run would
 * hit them. The colleges, reported entries, CDS records, and directory lists are the mini fixture's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatasetMeta, School } from "../lib/types";
import type { Extraction } from "../lib/reported";
import type { ReportedEntry, ReportedFile } from "../lib/reported.ts";
import { toReportedEntry } from "../lib/reported-checks.ts";
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateLineage } from "../lib/lineage.ts";
import { loadDirectoriesLayer, loadReportedLayer } from "../scripts/lib/data-platform/layers.mts";
import { applyCccuMembership, stripCccuMembership } from "../scripts/lib/directories/merge.mts";
import { miniLayers, miniMeta, miniSchools } from "./helpers/snapshot.mts";

const meta: DatasetMeta = miniMeta();
const allSchools: School[] = miniSchools();

// Princeton: real federal baseline (fall 2024), no CDS override. Abraham Baldwin: a second, unrelated college, used
// for the "removed" case so the slice has more than one row (the real data's example was Abilene Christian, 222178).
const PRINCETON = "186131";
const OTHER = "138558";

function school(unitId: string): School {
  const s = structuredClone(allSchools.find((x) => x.unit_id === unitId)!);
  // A school before any statement newer than the federal one: stripReported drops the reported block and puts the
  // federal test blocks back, and the Common App block goes too, because the newest-tests step would otherwise put
  // the grid's test policy straight back (lib/common-app/test-policy.ts applyGridPolicy reads `school.apply`).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `apply` is the point
  const { apply: _apply, ...rest } = stripReported(s);
  return rest as School;
}

function goodExtraction(): Extraction {
  return {
    cohort: "first-year",
    scope: "all-rounds",
    entering_term: "Fall 2026",
    applicants: 46618,
    admitted: 1865,
    enrolled: 1500,
    acceptance_rate: 0.04,
    quotes: {
      applicants: "Princeton received 46,618 applications for the Class of 2030.",
      admitted: "The university admitted 1,865 students.",
      enrolled: "1,500 enrolled.",
      acceptance_rate: "An acceptance rate of 4.0%.",
    },
    page: 1,
  };
}

function entryFor(unitId: string): ReportedEntry {
  const s = allSchools.find((x) => x.unit_id === unitId)!;
  return toReportedEntry(goodExtraction(), s, { url: "https://example.edu/class-profile", kind: "class-profile", retrieved: "2026-10-03" }, "test-run");
}

/* ------------------------------------------------------------------ */
/* Pure function: lib/reported-merge.ts#mergeReported                  */
/* ------------------------------------------------------------------ */

test("mergeReported adds the block and lineage for a matching entry", () => {
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const { schools, merged, removed } = mergeReported([school(PRINCETON)], reported);
  assert.equal(merged, 1);
  assert.equal(removed, 0);
  const p = schools[0];
  assert.equal(p.reported?.admissions?.applicants, 46618);
  assert.equal(p.reported?.admissions?.year, 2026);
  assert.equal(p.lineage?.["reported.admissions.applicants"]?.quote, "Princeton received 46,618 applications for the Class of 2030.");
  assert.equal(p.lineage?.["reported.admissions.entering_term"]?.source, "college-site");
});

test("mergeReported is idempotent: merging twice gives the same result", () => {
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const once = mergeReported([school(PRINCETON)], reported);
  const twice = mergeReported(once.schools, reported);
  assert.deepEqual(twice.schools, once.schools);
  assert.equal(twice.merged, 1);
  assert.equal(twice.removed, 0);
});

test("mergeReported strips the block and reported lineage for a college removed from the file", () => {
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const merged = mergeReported([school(PRINCETON)], reported).schools;
  assert.ok(merged[0].reported?.admissions);

  // The next run's file no longer has Princeton.
  const { schools, merged: mergedCount, removed } = mergeReported(merged, { updated: "2026-10-04", entries: [] });
  assert.equal(mergedCount, 0);
  assert.equal(removed, 1);
  assert.equal(schools[0].reported, undefined);
  for (const key of Object.keys(schools[0].lineage ?? {})) assert.ok(!key.startsWith("reported."));
});

test("mergeReported leaves a school with no entry and no prior block untouched", () => {
  const input = school(OTHER);
  const { schools, merged, removed } = mergeReported([input], { updated: "2026-10-03", entries: [] });
  assert.equal(merged, 0);
  assert.equal(removed, 0);
  assert.equal(schools[0].reported, undefined);
  // Byte for byte: no empty `lineage: {}` added, keys in the same order, so the school's line in data/schools.json
  // doesn't change (the first merge of the pilot rewrote all 1,893 lines because of exactly that).
  assert.equal(JSON.stringify(schools[0]), JSON.stringify(school(OTHER)));
  assert.strictEqual(schools[0], input);
});

test("mergeReported puts the newer class into admissions.*, keeping the federal funnel in admissions.federal", () => {
  const before = school(PRINCETON);
  const p = mergeReported([before], { updated: "2026-10-03", entries: [entryFor(PRINCETON)] }).schools[0];
  assert.equal(p.admissions.year, 2026);
  assert.equal(p.admissions.applicants, 46618);
  assert.equal(p.admissions.acceptance_rate, 0.04);
  assert.deepEqual(p.admissions.federal, {
    year: before.admissions.year,
    applicants: before.admissions.applicants,
    admitted: before.admissions.admitted,
    enrolled: before.admissions.enrolled,
    acceptance_rate: before.admissions.acceptance_rate,
  });
  assert.equal(p.lineage?.["admissions.applicants"]?.source, "college-site");
  assert.deepEqual(validateLineage([p], meta), []);
});

test("a hand-imported CDS college: admissions.federal holds the override's values, cited to its edition; dropping it restores them exactly", () => {
  // A CDS override (the real data's example was NYU, 193900, which the mini fixture lacks).
  const CORNELL = "190415";
  const before = school(CORNELL);
  assert.equal(before.lineage?.["admissions.applicants"]?.source, "cds");
  const merged = mergeReported([before], { updated: "2026-10-03", entries: [entryFor(CORNELL)] }).schools[0];
  assert.equal(merged.admissions.applicants, 46618);
  assert.equal(merged.admissions.federal?.applicants, before.admissions.applicants);
  assert.deepEqual(merged.lineage?.["admissions.federal"], before.lineage?.["admissions.applicants"]);
  assert.deepEqual(validateLineage([merged], meta), []);
  const dropped = mergeReported([merged], { updated: "2026-10-04", entries: [] }).schools[0];
  assert.equal(JSON.stringify(dropped), JSON.stringify(before));
});

// A real CCCU voting member (the cccu directory list), chosen only for already carrying `school.religion`
// (applyCccuMembership's condition for setting the flag at all). The real data's example was California Baptist.
const CCCU_COLLEGE = "123457"; // Simpson University

test("merge-reported and merge-directories' CCCU membership step agree on lineage key order, whichever runs first", async () => {
  const { files } = await loadDirectoriesLayer(miniLayers());
  // Start from a clean slate (the committed fixture is already a flagged CCCU member): stripCccuMembership removes
  // the flag and its lineage the same way a fresh re-merge does, so both orders below start from the same place.
  const base = stripCccuMembership(school(CCCU_COLLEGE));
  assert.ok(base.religion, "fixture must already carry a religion object");
  assert.equal(base.religion?.cccu_member, undefined, "stripCccuMembership should have cleared the flag");
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(CCCU_COLLEGE)] };

  // Order A: college-reported data merges in first (as a data run's merge-reported step does), then the directory
  // merge re-applies CCCU membership (as the college-reported workflow's new merge-directories step does).
  const reportedFirst = mergeReported([base], reported).schools[0];
  const a = applyCccuMembership([reportedFirst], files)[0];

  // Order B: the directory merge runs first, then college-reported data merges in (as a full `npm run sync-data`
  // orders them, or a second merge-directories pass over already-reported data).
  const cccuFirst = applyCccuMembership([base], files)[0];
  const b = mergeReported([cccuFirst], reported).schools[0];

  assert.ok(a.religion?.cccu_member, "the fixture must actually be a CCCU match, or this proves nothing");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "byte-identical (key order included) regardless of merge order");
  assert.deepEqual(validateLineage([a], meta), []);
});

test("the stored colleges are exactly what merging the reported layer's entries and CDS records produces (re-merge changes nothing)", async () => {
  const { file: reported, records } = await loadReportedLayer(miniLayers());
  // C1 first, then the newest groups from the CDS records (specs/data-expansion/cds-student-body-and-outcomes.md).
  // The mini fixture keeps only four colleges' CDS records (the others' record groups are in their stored rows but not
  // in its layers), so the re-merge runs over those four; the publisher's compose covers every college.
  const withRecords = allSchools.filter((s) => records.some((r) => r.unit_id === s.unit_id));
  assert.equal(withRecords.length, 4);
  const { schools } = mergeReported(withRecords, reported, { records, meta, table: CDS_TEMPLATE });
  const changed = schools.filter((s, i) => JSON.stringify(s) !== JSON.stringify(withRecords[i])).map((s) => s.unit_id);
  assert.deepEqual(changed, [], "run `npm run merge-reported`");
  // Every college with a reported block actually had something replaced or nothing newer to replace.
  for (const s of allSchools) if (s.reported?.admissions && s.admissions.federal) assert.ok(s.reported.admissions.year > (s.admissions.federal.year ?? 0));
});

test("stripping a college's block leaves no empty lineage behind", () => {
  const withBlock = mergeReported([school(PRINCETON)], { updated: "2026-10-03", entries: [entryFor(PRINCETON)] }).schools[0];
  const stripped = mergeReported([withBlock], { updated: "2026-10-04", entries: [] }).schools[0];
  assert.equal(JSON.stringify(stripped), JSON.stringify(school(PRINCETON)));
});
