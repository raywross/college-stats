/**
 * College-reported data: the seven automated checks and the conversion to a published entry.
 * See specs/college-reported-data.md. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { Extraction } from "../lib/reported";
import { runChecks, toReportedEntry, reportedToPatch } from "../lib/reported-checks.ts";
import { lineageFor, validateSchool } from "../lib/lineage.ts";

const ROOT = join(import.meta.dirname, "..");
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));

// Princeton: real federal baseline (fall 2024), no CDS override, so its lineage stays simple.
const PRINCETON = "186131";

/** A clean clone of Princeton to mutate, with any existing reported block/lineage stripped. */
function school(): School {
  const s = structuredClone(schools.find((x) => x.unit_id === PRINCETON)!);
  delete s.reported;
  return s;
}

/** A class-profile extraction for Princeton's Fall 2026 class that passes every check. */
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
      enrolled: "About 1,500 students are expected to enroll.",
      acceptance_rate: "This represents an acceptance rate of 4.0%.",
    },
    page: 1,
  };
}

const SRC = { url: "https://admission.princeton.edu/classof2030", kind: "class-profile" as const, retrieved: "2026-10-02" };

/* ---- 1. cohort-and-scope ---- */

test("check 1: cohort must be first-year and scope must be all-rounds", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const bad: Extraction = { ...goodExtraction(), scope: "early-only" };
  const failures = runChecks(bad, school());
  assert.ok(failures.some((f) => f.check === "cohort-and-scope"), JSON.stringify(failures));
});

/* ---- 2. quote-present ---- */

test("check 2: every non-null number needs a quote that contains it, tolerant of commas and '%'/'percent'", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  // Tolerant forms still pass.
  const tolerant: Extraction = {
    ...goodExtraction(),
    quotes: { ...goodExtraction().quotes, acceptance_rate: "an admit rate of about 4 percent" },
  };
  assert.deepEqual(runChecks(tolerant, school()).filter((f) => f.check === "quote-present"), []);
  // Missing quote fails.
  const noQuote: Extraction = { ...goodExtraction(), quotes: { ...goodExtraction().quotes, applicants: undefined } };
  assert.ok(runChecks(noQuote, school()).some((f) => f.check === "quote-present" && f.detail.includes("no quote")));
  // A quote that doesn't contain the number fails.
  const wrongQuote: Extraction = { ...goodExtraction(), quotes: { ...goodExtraction().quotes, applicants: "about forty thousand applications" } };
  assert.ok(runChecks(wrongQuote, school()).some((f) => f.check === "quote-present"));
});

/* ---- 3. funnel-order ---- */

test("check 3: admitted ≤ applicants, enrolled ≤ admitted", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const bad: Extraction = { ...goodExtraction(), admitted: 47000 };
  const failures = runChecks(bad, school());
  assert.ok(failures.some((f) => f.check === "funnel-order" && f.detail.includes("admitted")), JSON.stringify(failures));
});

/* ---- 4. rate-matches ---- */

test("check 4: a stated rate must match admitted ÷ applicants within 0.1 pt", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const bad: Extraction = { ...goodExtraction(), acceptance_rate: 0.1 };
  const failures = runChecks(bad, school());
  assert.ok(failures.some((f) => f.check === "rate-matches"), JSON.stringify(failures));
  // When the rate isn't stated, there's nothing to check (the rate gets computed instead).
  const unstated: Extraction = { ...goodExtraction(), acceptance_rate: null, quotes: { ...goodExtraction().quotes, acceptance_rate: undefined } };
  assert.deepEqual(runChecks(unstated, school()).filter((f) => f.check === "rate-matches"), []);
});

/* ---- 5. newer-than-federal ---- */

test("check 5: entering term must be newer than the federal admissions year; a null term fails", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const nullTerm: Extraction = { ...goodExtraction(), entering_term: null };
  assert.ok(runChecks(nullTerm, school()).some((f) => f.check === "newer-than-federal"));
  const notNewer: Extraction = { ...goodExtraction(), entering_term: "Fall 2024" };
  assert.ok(runChecks(notNewer, school()).some((f) => f.check === "newer-than-federal"));
});

/* ---- 6. plausible-change ---- */

test("check 6: applicants ×0.5–×2 and rate within ±15 pts of the federal year", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const bad: Extraction = { ...goodExtraction(), applicants: 200000, admitted: 8000, enrolled: 1500, acceptance_rate: 0.04 };
  const failures = runChecks(bad, school());
  assert.ok(failures.some((f) => f.check === "plausible-change" && f.detail.includes("applicants")), JSON.stringify(failures));
});

/* ---- 7. sources-agree ---- */

test("check 7: two sources for the same term must agree within 1%", () => {
  const close: Extraction = { ...goodExtraction(), applicants: 46700 };
  assert.deepEqual(runChecks(goodExtraction(), school(), [close]), []);
  const far: Extraction = { ...goodExtraction(), applicants: 48000 };
  const failures = runChecks(goodExtraction(), school(), [far]);
  assert.ok(failures.some((f) => f.check === "sources-agree"), JSON.stringify(failures));
  // A different term is never compared.
  const otherTerm: Extraction = { ...goodExtraction(), entering_term: "Fall 2025", applicants: 999999 };
  assert.deepEqual(runChecks(goodExtraction(), school(), [otherTerm]), []);
});

/* ---- toReportedEntry / reportedToPatch ---- */

test("toReportedEntry builds lineage that passes validateSchool once merged", () => {
  const s = school();
  assert.deepEqual(runChecks(goodExtraction(), s), []);
  const entry = toReportedEntry(goodExtraction(), s, SRC, "run-2026-10-02");
  assert.equal(entry.unit_id, PRINCETON);
  assert.equal(entry.admissions.year, 2026);
  assert.equal(entry.admissions.source_kind, "class-profile");
  // Stated rate is kept as stated.
  assert.equal(entry.admissions.acceptance_rate, 0.04);

  const { reported, lineage } = reportedToPatch(entry);
  s.reported = reported;
  s.lineage = { ...(s.lineage ?? {}), ...lineage };
  assert.deepEqual(validateSchool(s, meta), []);
});

test("toReportedEntry computes the rate (and its quote) when the college doesn't state one", () => {
  const s = school();
  const x: Extraction = { ...goodExtraction(), acceptance_rate: null, quotes: { ...goodExtraction().quotes, acceptance_rate: undefined } };
  assert.deepEqual(runChecks(x, s), []);
  const entry = toReportedEntry(x, s, SRC, "run-2026-10-02");
  assert.ok(entry.admissions.acceptance_rate !== null);
  assert.ok(Math.abs(entry.admissions.acceptance_rate! - 1865 / 46618) < 1e-9);
  const rec = entry.lineage["reported.admissions.acceptance_rate"]!;
  assert.equal(rec.method, "extracted");
  assert.equal(rec.quote, `${x.quotes.admitted} / ${x.quotes.applicants}`);

  const { reported, lineage } = reportedToPatch(entry);
  s.reported = reported;
  s.lineage = { ...(s.lineage ?? {}), ...lineage };
  assert.deepEqual(validateSchool(s, meta), []);
});

/* ---- The lineage guard rejects a broken reported value (each way it can break) ---- */

test("the lineage guard rejects a stored reported value with no lineage record at all", () => {
  const s = school();
  s.reported = { admissions: { entering_term: "Fall 2026", year: 2026, applicants: 46618, admitted: 1865, enrolled: 1500, acceptance_rate: 0.04, source_kind: "class-profile" } };
  // No lineage set at all.
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.applicants.*stored without a lineage record/);
});

test("the lineage guard rejects a reported value with a non-extracted method", () => {
  const s = school();
  const entry = toReportedEntry(goodExtraction(), s, SRC, "run-2026-10-02");
  const { reported, lineage } = reportedToPatch(entry);
  s.reported = reported;
  s.lineage = {
    ...(s.lineage ?? {}),
    ...lineage,
    "reported.admissions.applicants": { ...lineage["reported.admissions.applicants"]!, method: "reported" },
  };
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.applicants.*must have method "extracted"/);
});

test("the lineage guard rejects a reported year that isn't newer than the federal year", () => {
  const s = school();
  const entry = toReportedEntry(goodExtraction(), s, SRC, "run-2026-10-02");
  const { reported, lineage } = reportedToPatch(entry);
  s.reported = { admissions: { ...reported.admissions!, year: s.admissions.year! } };
  s.lineage = { ...(s.lineage ?? {}), ...lineage };
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.year .* isn't newer than the federal year/);
});

/* ---- lineageFor cites the college's own page ---- */

test("lineageFor cites the college-site source with the quote, year, and URL", () => {
  const s = school();
  const entry = toReportedEntry(goodExtraction(), s, SRC, "run-2026-10-02");
  const { reported, lineage } = reportedToPatch(entry);
  s.reported = reported;
  s.lineage = { ...(s.lineage ?? {}), ...lineage };

  const cited = lineageFor("reported.admissions.acceptance_rate", s, meta);
  assert.equal(cited.key, "college-site");
  assert.equal(cited.quote, goodExtraction().quotes.acceptance_rate);
  assert.equal(cited.year, "Fall 2026");
  assert.equal(cited.url, SRC.url);
  assert.equal(cited.method, "extracted");
});
