/**
 * The discovery seasons (lib/seasons.ts; specs/college-reported-fall-figures.md Decisions 1, 4, 6): the calendar, the
 * colleges in scope, the term patterns, and the reclassification of dated class-profile URLs. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inSeasonScope, noticePatterns, reclassifyDated, seasonOn } from "../lib/seasons.ts";
import type { RecipeSource } from "../lib/reported";
import type { School } from "../lib/types";

test("seasonOn: every window's first and last day, and the days either side", () => {
  const cases: [string, string | null][] = [
    ["2026-01-10", null],
    ["2026-03-14", null],
    ["2026-03-15", "admits"],
    ["2026-04-20", "admits"],
    ["2026-05-15", "admits"],
    ["2026-05-16", null],
    ["2026-05-31", null],
    ["2026-06-01", "systems"],
    ["2026-07-31", "systems"],
    ["2026-08-01", null],
    ["2026-08-14", null],
    ["2026-08-15", "census"],
    ["2026-11-11", "census"],
    ["2026-11-15", "census"],
    ["2026-11-16", null],
    ["2026-12-31", null],
  ];
  for (const [day, key] of cases) assert.equal(seasonOn(day)?.key ?? null, key, day);
  assert.deepEqual(seasonOn("2026-11-11"), { key: "census", term: "Fall 2026", cadence: "weekly" });
  assert.deepEqual(seasonOn("2027-04-01"), { key: "admits", term: "Fall 2027", cadence: "weekly" });
  assert.deepEqual(seasonOn("2026-06-15"), { key: "systems", term: "Fall 2026", cadence: "biweekly" });
  assert.equal(seasonOn("not a date"), null);
});

const college = (tier: string | null | undefined, rate: number | null): Pick<School, "selectivity" | "admissions"> =>
  ({ selectivity: tier === undefined ? undefined : { tier }, admissions: { acceptance_rate: rate } }) as unknown as Pick<School, "selectivity" | "admissions">;

test("inSeasonScope: the top four tiers; without a tier, an admit rate under 50%", () => {
  for (const tier of ["elite", "highly_selective", "very_selective", "selective"]) assert.equal(inSeasonScope(college(tier, 0.9)), true, tier);
  for (const tier of ["accessible", "open"]) assert.equal(inSeasonScope(college(tier, 0.1)), false, tier);
  // No selectivity block, or a tier of null (not rated): the pilot's admit-rate tiers.
  assert.equal(inSeasonScope(college(undefined, 0.3)), true);
  assert.equal(inSeasonScope(college(null, 0.12)), true);
  assert.equal(inSeasonScope(college(undefined, 0.5)), false, "50% is 'less selective'");
  assert.equal(inSeasonScope(college(undefined, 0.7)), false);
  assert.equal(inSeasonScope(college(undefined, null)), false, "no rate: open admission");
});

test("noticePatterns: the term's tokens and a link pattern", () => {
  const { tokens, text } = noticePatterns("Fall 2026");
  assert.deepEqual(tokens, ["fall 2026", "class of 2030", "class-of-2030", "classof2030", "class-2030", "2026"]);
  for (const s of [
    "Princeton offers admission to 1,865 for the Class of 2030",
    "https://news.utexas.edu/2026/09/18/ut-sets-new-records/",
    "Fall 2026 first-year profile",
    "Record number of applications",
    "University welcomes its largest first-year class",
  ]) assert.match(s, text, s);
  for (const s of ["Campus dining hours", "Commencement 2025: speakers announced", "class-of-2029 move-in"]) assert.doesNotMatch(s, text, s);
  assert.throws(() => noticePatterns("2026-27"));
});

const src = (url: string, extra: Partial<RecipeSource> = {}): RecipeSource => ({ kind: "class-profile", url, format: url.endsWith(".pdf") ? "pdf" : "html", ...extra });
const TODAY = "2026-11-11";

test("reclassifyDated: UT Austin's 2025 release becomes a Fall 2025 notice with its date", () => {
  const ut = "https://news.utexas.edu/2025/09/18/ut-sets-all-time-highs-for-enrollment-and-student-performance/";
  const { sources, changed } = reclassifyDated([src(ut)], TODAY);
  assert.equal(changed, 1);
  assert.deepEqual(sources[0], { kind: "notice", url: ut, format: "html", term: "Fall 2025", published: "2025-09-18", found_by: "reclassified" });
});

test("reclassifyDated: a class-of-2029 PDF is a Fall 2025 notice; the extraction's own term wins", () => {
  const pdf = "https://www.columbia.edu/files/class-of-2029-profile.pdf";
  const { sources } = reclassifyDated([src(pdf)], TODAY);
  assert.equal(sources[0].kind, "notice");
  assert.equal(sources[0].term, "Fall 2025");
  assert.equal(sources[0].published, undefined, "no date in the URL");
  for (const url of ["https://x.edu/Class%20of%202029.pdf", "https://x.edu/classof2029", "https://x.edu/class_2029"]) assert.equal(reclassifyDated([src(url)], TODAY).sources[0].term, "Fall 2025", url);

  const withTerm = src("https://news.example.edu/2025/03/30/admits", { extraction: { entering_term: "Fall 2025" } as RecipeSource["extraction"] });
  assert.equal(reclassifyDated([withTerm], TODAY).sources[0].term, "Fall 2025");
  const otherTerm = src("https://news.example.edu/2024/12/15/early-admits", { extraction: { entering_term: "Fall 2025" } as RecipeSource["extraction"] });
  assert.equal(reclassifyDated([otherTerm], TODAY).sources[0].term, "Fall 2025", "a December release about next fall keeps the extraction's term");
});

test("reclassifyDated leaves evergreen, current-year, and non-profile sources alone", () => {
  const evergreen = src("https://admission.harvard.edu/admissions-statistics");
  const current = src("https://news.utexas.edu/2026/09/17/ut-welcomes-class-of-2030/");
  const currentClass = src("https://admissions.example.edu/class-of-2030-profile.pdf");
  const cds = { ...src("https://ir.example.edu/cds_2024-2025.pdf"), kind: "cds" as const };
  const input = [evergreen, current, currentClass, cds];
  const out = reclassifyDated(input, TODAY);
  assert.equal(out.changed, 0);
  assert.strictEqual(out.sources, input, "nothing changed: the same array");
  // A year later, the 2026 URL is last fall's and is reclassified.
  const later = reclassifyDated([current], "2027-11-11");
  assert.equal(later.changed, 1);
  assert.equal(later.sources[0].term, "Fall 2026");
  // Out of range years are not years.
  assert.equal(reclassifyDated([src("https://x.edu/profile-2014")], TODAY).changed, 0);
});
