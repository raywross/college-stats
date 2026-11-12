/**
 * College-reported data: the seven automated checks and the conversion to a published entry.
 * See specs/college-reported-data.md. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatasetMeta, School } from "../lib/types";
import type { Extraction } from "../lib/reported";
import { normalizeExtraction, rateTolerancePts, runChecks, toReportedEntry, reportedToPatch } from "../lib/reported-checks.ts";
import { lineageFor, validateSchool } from "../lib/lineage.ts";
import { miniMeta, miniSchools } from "./helpers/snapshot.mts";

const meta: DatasetMeta = miniMeta();
const schools: School[] = miniSchools();

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
    qualifiers: {},
    enrollment_target: null,
    deposits: null,
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

test("check 4: a stated rate must match admitted ÷ applicants within the precision the college printed", () => {
  assert.deepEqual(runChecks(goodExtraction(), school()), []);
  const bad: Extraction = { ...goodExtraction(), acceptance_rate: 0.1 };
  const failures = runChecks(bad, school());
  assert.ok(failures.some((f) => f.check === "rate-matches"), JSON.stringify(failures));
  // Clemson (ten-college test, 2026-10-03): "42%" stated, 42.43% computed. A whole-percent rate allows 0.5 pt.
  const clemson: Extraction = { ...goodExtraction(), applicants: 60000, admitted: 25458, enrolled: 4000, acceptance_rate: 0.42, quotes: { ...goodExtraction().quotes, applicants: "60,000 applied", admitted: "25,458 admitted", enrolled: "4,000 enrolled", acceptance_rate: "an admit rate of 42%" } };
  assert.deepEqual(runChecks(clemson, school()).filter((f) => f.check === "rate-matches"), [], "42% vs 42.43% passes when printed without decimals");
  const clemsonPrecise: Extraction = { ...clemson, quotes: { ...clemson.quotes, acceptance_rate: "an admit rate of 42.0%" } };
  assert.ok(runChecks(clemsonPrecise, school()).some((f) => f.check === "rate-matches"), "42.0% vs 42.43% fails when printed with a decimal");
  assert.equal(rateTolerancePts("about 42 percent"), 0.5);
  assert.equal(rateTolerancePts("4.0%"), 0.1);
  assert.equal(rateTolerancePts("4.18%"), 0.05);
  assert.equal(rateTolerancePts(undefined), 0.1);
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

test("check 7: a source for a different pool (scope or cohort) is never compared", () => {
  // Vanderbilt, 2026-11-10: the CDS counts the whole cycle; the "regular decision summary" counts one round.
  const regularOnly: Extraction = { ...goodExtraction(), scope: "regular-only", applicants: 43322, admitted: 1411 };
  assert.deepEqual(runChecks(goodExtraction(), school(), [regularOnly]), []);
  const unknownScope: Extraction = { ...goodExtraction(), scope: "unknown", applicants: 999999 };
  assert.deepEqual(runChecks(goodExtraction(), school(), [unknownScope]), []);
  const transfers: Extraction = { ...goodExtraction(), cohort: "transfer", applicants: 999999 };
  assert.deepEqual(runChecks(goodExtraction(), school(), [transfers]), []);
});

test("check 7: rates are compared at the precision they were printed", () => {
  const base = goodExtraction();
  // This source computes its rate from counts: 2,040 ÷ 46,618 = 4.38%.
  const precise: Extraction = { ...base, admitted: 2040, acceptance_rate: null, quotes: { ...base.quotes, admitted: "The university admitted 2,040 students.", acceptance_rate: undefined } };
  // The other source states only a whole-percent rate: anything within half a point agrees.
  const rounded: Extraction = { ...base, applicants: null, admitted: null, enrolled: null, acceptance_rate: 0.04, quotes: { acceptance_rate: "admitted 4% of applicants" } };
  assert.deepEqual(runChecks(precise, school(), [rounded]), []);
  // Beyond the printed precision it is a disagreement.
  const far: Extraction = { ...rounded, acceptance_rate: 0.052, quotes: { acceptance_rate: "an admit rate of 5.2%" } };
  const failures = runChecks(precise, school(), [far]);
  assert.ok(failures.some((f) => f.check === "sources-agree" && f.detail.includes("acceptance_rate")), JSON.stringify(failures));
});

/* ---- Fall figures (specs/college-reported-fall-figures.md Decision 3): the three check changes ---- */

test("check 1: a multi-campus or all-undergraduate cohort fails, however clean its numbers", () => {
  for (const cohort of ["multi-campus", "all-undergraduates"] as const) {
    const failures = runChecks({ ...goodExtraction(), cohort }, school());
    assert.deepEqual(failures.map((f) => f.check), ["cohort-and-scope"], cohort);
    assert.match(failures[0].detail, /never first-year figures/);
  }
});

test("check 2: an approximate figure's printed number must be in its quote; so must a class goal and deposits", () => {
  const approx: Extraction = {
    ...goodExtraction(),
    applicants: 46000,
    acceptance_rate: null,
    qualifiers: { applicants: "approx" },
    quotes: { ...goodExtraction().quotes, applicants: "More than 46,000 students applied.", acceptance_rate: undefined },
  };
  assert.deepEqual(runChecks(approx, school()), []);
  const wrong = { ...approx, quotes: { ...approx.quotes, applicants: "Nearly 50,000 students applied." } };
  assert.ok(runChecks(wrong, school()).some((f) => f.check === "quote-present" && f.detail.includes("applicants=46000")));
  const target: Extraction = { ...goodExtraction(), enrollment_target: 1450, deposits: 1600, quotes: { ...goodExtraction().quotes, enrollment_target: "a target class of 1,450", deposits: "1,600 deposits" } };
  assert.deepEqual(runChecks(target, school()), []);
  const noQuote = { ...target, quotes: { ...target.quotes, deposits: undefined } };
  assert.ok(runChecks(noQuote, school()).some((f) => f.check === "quote-present" && f.detail === "deposits=1600 has no quote"));
});

test("check 4 is skipped when a figure it compares is approximate", () => {
  // "about 4.2%" against 1,865 ÷ 46,618 (4.0%) passes; the same rate printed as exact fails (0.2 pt off, 0.1 allowed).
  const approx: Extraction = { ...goodExtraction(), acceptance_rate: 0.042, qualifiers: { acceptance_rate: "approx" }, quotes: { ...goodExtraction().quotes, acceptance_rate: "about 4.2% were admitted" } };
  assert.deepEqual(runChecks(approx, school()).filter((f) => f.check === "rate-matches"), []);
  assert.ok(runChecks({ ...approx, qualifiers: {} }, school()).some((f) => f.check === "rate-matches"));
});

test("check 7 compares exact figures only", () => {
  const rounded: Extraction = { ...goodExtraction(), applicants: 40000, acceptance_rate: null, qualifiers: { applicants: "approx" }, quotes: { ...goodExtraction().quotes, applicants: "more than 40,000 applied", acceptance_rate: undefined } };
  assert.deepEqual(runChecks(goodExtraction(), school(), [rounded]), [], "46,618 doesn't disagree with 'more than 40,000'");
  // The same 40,000 printed as an exact count does disagree: the guard is the qualifier.
  const exact = { ...rounded, qualifiers: {} };
  assert.ok(runChecks(goodExtraction(), school(), [exact]).some((f) => f.check === "sources-agree" && f.detail.includes("applicants")));
  // An approximate stated rate isn't compared either.
  const aboutRate: Extraction = { ...goodExtraction(), acceptance_rate: 0.05, qualifiers: { acceptance_rate: "approx" }, quotes: { ...goodExtraction().quotes, acceptance_rate: "about 5%" } };
  assert.deepEqual(runChecks(goodExtraction(), school(), [aboutRate]).filter((f) => f.check === "sources-agree"), []);
});

test("an extraction stored without the fall-figures keys is checked as all exact", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the new keys is the point
  const { qualifiers: _q, enrollment_target: _t, deposits: _d, ...stored } = goodExtraction();
  assert.deepEqual(normalizeExtraction(stored), goodExtraction());
  assert.deepEqual(runChecks(stored, school(), [stored]), []);
});

test("the lineage guard rejects a class goal or deposits stored without an extracted record", () => {
  const s = school();
  const x: Extraction = { ...goodExtraction(), enrollment_target: 1450, deposits: 1600, quotes: { ...goodExtraction().quotes, enrollment_target: "a target class of 1,450", deposits: "1,600 deposits" } };
  const { reported, lineage } = reportedToPatch(toReportedEntry(x, s, SRC, "run-2026-11-11"));
  // Enrolled is stated, so the census count replaces deposits.
  assert.equal(reported.admissions!.deposits, undefined);
  assert.equal(reported.admissions!.enrollment_target, 1450);
  s.reported = reported;
  s.lineage = { ...(s.lineage ?? {}), ...lineage };
  assert.deepEqual(validateSchool(s, meta), []);
  delete s.lineage["reported.admissions.enrollment_target"];
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.enrollment_target is stored without a lineage record/);
  s.reported = { admissions: { ...reported.admissions!, deposits: 1600 } };
  assert.match(validateSchool(s, meta).join("\n"), /reported\.admissions\.deposits is stored without a lineage record/);
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
