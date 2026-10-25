/**
 * "This season on the Common App" (specs/data-expansion/common-app.md "National and state figures";
 * common-app-build/brief.md, unit U5): lib/common-app/trends.ts's reader and validator, and the shape rules the
 * component (components/trends/CommonAppSeason.tsx) relies on. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { citationFor, newestSeason, rowFor, seasonsIn, validateCommonAppTrends, type CommonAppTrendsFile } from "../lib/common-app/trends.ts";

const ROOT = join(import.meta.dirname, "..");
const committed: CommonAppTrendsFile = JSON.parse(readFileSync(join(ROOT, "data", "trends", "common-app.json"), "utf8"));

/** A minimal valid file, for tests that break one rule at a time. */
function baseFile(): CommonAppTrendsFile {
  return {
    description: "test fixture",
    reports: [{ id: "r1", title: "Test report", date: "2026-08-20", url: "https://www.commonapp.org/files/x.pdf", pages: 10 }],
    rows: [{ season: "2025-26", measure: "applicants", value: 1000, unit: "count", report: "r1", page: 2, quote: "1,000 applicants applied." }],
  };
}

test("the validator passes on the committed file", () => {
  assert.deepEqual(validateCommonAppTrends(committed), []);
});

test("the committed file has two seasons, newest 2025-26", () => {
  const seasons = seasonsIn(committed);
  assert.deepEqual(seasons, ["2024-25", "2025-26"]);
  assert.equal(newestSeason(committed), "2025-26");
});

test("rowFor finds a row and returns undefined for a missing one", () => {
  assert.ok(rowFor(committed, "2025-26", "applicants"));
  assert.equal(rowFor(committed, "2025-26", "share_reporting_scores"), undefined);
  assert.equal(rowFor(committed, "1999-00" as never, "applicants"), undefined);
});

test("validateCommonAppTrends rejects a non-object", () => {
  assert.ok(validateCommonAppTrends(null).length > 0);
  assert.ok(validateCommonAppTrends("nope").length > 0);
});

test("fails: an unknown measure", () => {
  const f = baseFile();
  (f.rows[0] as { measure: string }).measure = "made_up_measure";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("vocabulary")));
});

test("fails: a report id that doesn't resolve", () => {
  const f = baseFile();
  f.rows[0].report = "no-such-report";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("does not resolve")));
});

test("fails: a non-ISO report date", () => {
  const f = baseFile();
  f.reports[0].date = "August 20, 2026";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("yyyy-mm-dd")));
});

test("fails: a report url off commonapp.org", () => {
  const f = baseFile();
  f.reports[0].url = "https://example.com/report.pdf";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("commonapp.org")));
});

test("fails: a page below 1", () => {
  const f = baseFile();
  f.rows[0].page = 0;
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("page must be")));
});

test("fails: a page past the report's own page count", () => {
  const f = baseFile();
  f.rows[0].page = 999;
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("past")));
});

test("fails: a quote missing the value's digits", () => {
  const f = baseFile();
  f.rows[0].quote = "Some unrelated sentence with no number in it.";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("digits")));
});

test("fails: a duplicate season×measure pair", () => {
  const f = baseFile();
  f.rows.push({ ...f.rows[0] });
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("duplicate")));
});

test("fails: a season that isn't YYYY-YY with consecutive years", () => {
  const f = baseFile();
  (f.rows[0] as { season: string }).season = "2025-27";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("YYYY-YY")));
});

test("fails: an unknown unit", () => {
  const f = baseFile();
  (f.rows[0] as { unit: string }).unit = "percent";
  assert.ok(validateCommonAppTrends(f).some((p) => p.includes("count/ratio/share/growth")));
});

test("citationFor links only to the Common App homepage, with the report's title and quote", () => {
  const row = rowFor(committed, "2025-26", "applicants")!;
  const cited = citationFor(row, committed);
  assert.equal(cited.url, "https://www.commonapp.org");
  assert.equal(cited.key, "common-app");
  assert.equal(cited.label, "Common App");
  assert.equal(cited.quote, row.quote);
  assert.equal(cited.page, row.page);
  assert.match(cited.document ?? "", /End-of-season report/);
  assert.ok(cited.year && cited.year.length > 0);
});

test("the component file has no quoted 20\\d\\d-\\d\\d cycle literal", () => {
  const text = readFileSync(join(ROOT, "components", "trends", "CommonAppSeason.tsx"), "utf8");
  assert.doesNotMatch(text, /["'`]20\d\d[-–]\d\d["'`]/);
});
