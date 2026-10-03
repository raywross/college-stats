/**
 * scripts/merge-reported.mts (Decision 5, specs/college-reported-round-2.md): merges data/college-reported.json
 * into the committed data/schools.json, the same way scripts/sync-data.mts does (lib/reported-merge.ts), so the
 * data PR carries the site's figures without a separate `npm run sync-data`. `npm test`.
 *
 * Runs the real CLI (via `MERGE_REPORTED_ROOT`) against a scratch copy of a slice of the real dataset, so the
 * line format and the lineage guard are exercised exactly as a workflow run would hit them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { Extraction } from "../lib/reported";
import type { ReportedEntry, ReportedFile } from "../lib/reported.ts";
import { toReportedEntry } from "../lib/reported-checks.ts";
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateLineage } from "../lib/lineage.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "merge-reported.mts");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const allSchools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

// Princeton: real federal baseline (fall 2024), no CDS override. Abilene Christian: a second, unrelated college,
// used for the "removed" case so the slice has more than one row.
const PRINCETON = "186131";
const OTHER = "222178";

function school(unitId: string): School {
  const s = structuredClone(allSchools.find((x) => x.unit_id === unitId)!);
  return stripReported(s); // clean, in case a prior local merge left a block in the committed file
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
  const NYU = "193900"; // CDS override 2024-25, no college-reported class in the committed data
  const before = school(NYU);
  assert.equal(before.lineage?.["admissions.applicants"]?.source, "cds");
  const merged = mergeReported([before], { updated: "2026-10-03", entries: [entryFor(NYU)] }).schools[0];
  assert.equal(merged.admissions.applicants, 46618);
  assert.equal(merged.admissions.federal?.applicants, before.admissions.applicants);
  assert.deepEqual(merged.lineage?.["admissions.federal"], before.lineage?.["admissions.applicants"]);
  assert.deepEqual(validateLineage([merged], meta), []);
  const dropped = mergeReported([merged], { updated: "2026-10-04", entries: [] }).schools[0];
  assert.equal(JSON.stringify(dropped), JSON.stringify(before));
});

test("the committed data/schools.json is exactly what merging data/college-reported.json and data/cds-records/ produces (re-merge changes nothing)", () => {
  const reported: ReportedFile = JSON.parse(readFileSync(join(ROOT, "data", "college-reported.json"), "utf8"));
  // C1 first, then the newest groups from the CDS records (specs/data-expansion/cds-student-body-and-outcomes.md).
  const { schools } = mergeReported(allSchools, reported, { records: readRecords(join(ROOT, "data", "cds-records")), meta, table: CDS_TEMPLATE });
  const changed = schools.filter((s, i) => JSON.stringify(s) !== JSON.stringify(allSchools[i])).map((s) => s.unit_id);
  assert.deepEqual(changed, [], "run `npm run merge-reported`");
  // Every college with a reported block actually had something replaced or nothing newer to replace.
  for (const s of allSchools) if (s.reported?.admissions && s.admissions.federal) assert.ok(s.reported.admissions.year > (s.admissions.federal.year ?? 0));
});

test("stripping a college's block leaves no empty lineage behind", () => {
  const withBlock = mergeReported([school(PRINCETON)], { updated: "2026-10-03", entries: [entryFor(PRINCETON)] }).schools[0];
  const stripped = mergeReported([withBlock], { updated: "2026-10-04", entries: [] }).schools[0];
  assert.equal(JSON.stringify(stripped), JSON.stringify(school(PRINCETON)));
});

/* ------------------------------------------------------------------ */
/* The CLI, against a scratch copy of real data (line format, refusal on bad lineage)  */
/* ------------------------------------------------------------------ */

function runCli(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT, ...args], {
      env: { ...process.env, MERGE_REPORTED_ROOT: dir },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

function scratchDir(schools: School[], reported: ReportedFile): string {
  const dir = mkdtempSync(join(tmpdir(), "merge-reported-"));
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "schools.json"), `[\n${schools.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`);
  writeFileSync(join(dataDir, "college-reported.json"), JSON.stringify(reported));
  writeFileSync(join(dataDir, "meta.json"), JSON.stringify(meta));
  return dir;
}

test("the CLI writes schools.json one school per line, matching sync-data's format", () => {
  const princeton = school(PRINCETON);
  const other = school(OTHER);
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const dir = scratchDir([princeton, other], reported);
  try {
    const result = runCli(dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /college-reported: 1 colleges merged, 0 removed/);

    const text = readFileSync(join(dir, "data", "schools.json"), "utf8");
    assert.equal(text, `[\n${[princeton, other].map((s) => JSON.stringify(mergeReported([s], reported).schools[0])).join(",\n")}\n]\n`);
    // Every school is its own line (plus the opening/closing bracket lines).
    const lines = text.split("\n").filter((l) => l.trim().length);
    assert.equal(lines.length, 4); // "[", princeton, "other,", "]"

    const parsed: School[] = JSON.parse(text);
    assert.equal(parsed.length, 2);
    assert.equal(parsed.find((s) => s.unit_id === PRINCETON)?.reported?.admissions?.applicants, 46618);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI is idempotent on its own output", () => {
  const princeton = school(PRINCETON);
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const dir = scratchDir([princeton], reported);
  try {
    runCli(dir);
    const once = readFileSync(join(dir, "data", "schools.json"), "utf8");
    runCli(dir);
    const twice = readFileSync(join(dir, "data", "schools.json"), "utf8");
    assert.equal(once, twice);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI removes a college's block when it drops out of college-reported.json", () => {
  const princeton = school(PRINCETON);
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const dir = scratchDir([princeton], reported);
  try {
    runCli(dir);
    const withBlock: School[] = JSON.parse(readFileSync(join(dir, "data", "schools.json"), "utf8"));
    assert.ok(withBlock[0].reported?.admissions);

    writeFileSync(join(dir, "data", "college-reported.json"), JSON.stringify({ updated: "2026-10-04", entries: [] }));
    const result = runCli(dir);
    assert.match(result.stdout, /college-reported: 0 colleges merged, 1 removed/);
    const withoutBlock: School[] = JSON.parse(readFileSync(join(dir, "data", "schools.json"), "utf8"));
    assert.equal(withoutBlock[0].reported, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI refuses to write when an entry's year isn't newer than the federal year", () => {
  const princeton = school(PRINCETON);
  const bad = entryFor(PRINCETON);
  bad.admissions.year = 2020; // not newer than Princeton's federal 2024
  const reported: ReportedFile = { updated: "2026-10-03", entries: [bad] };
  const dir = scratchDir([princeton], reported);
  try {
    const result = runCli(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isn't newer than the federal year/);
    const text = readFileSync(join(dir, "data", "schools.json"), "utf8");
    assert.doesNotMatch(text, /"reported"/); // untouched: the original (reported-less) file is still there
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--dry-run prints without writing", () => {
  const princeton = school(PRINCETON);
  const reported: ReportedFile = { updated: "2026-10-03", entries: [entryFor(PRINCETON)] };
  const dir = scratchDir([princeton], reported);
  try {
    const before = readFileSync(join(dir, "data", "schools.json"), "utf8");
    const result = runCli(dir, ["--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--dry-run, nothing written/);
    const after = readFileSync(join(dir, "data", "schools.json"), "utf8");
    assert.equal(before, after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
