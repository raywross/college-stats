/**
 * UI unit (specs/product/high-school-data.md "Display"): pure display helpers (lib/high-school-ui.ts) and the
 * sanitize rule for the student profile's new `basics.highSchoolId` (lib/student-profile.ts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareToMedian,
  enrollmentText,
  formatRateRange,
  admittedSummary,
  scoresDisplay,
  gpaScaleLabel,
  gradRateText,
  hsStateName,
  hsTypeBadges,
  hsValueText,
  matriculationLine,
  medianComparisonWords,
  medianSentence,
  shareText,
} from "../lib/high-school-ui.ts";
import { sanitizeProfile } from "../lib/student-profile.ts";
import { pct } from "../lib/format.ts";

/* ------------------------------------------------------------------ */
/* compareToMedian / medianComparisonWords (describe, don't grade)      */
/* ------------------------------------------------------------------ */

test("compareToMedian is null when either side is missing", () => {
  assert.equal(compareToMedian(null, 10), null);
  assert.equal(compareToMedian(10, null), null);
  assert.equal(compareToMedian(null, null), null);
});

test("compareToMedian treats values within 5% of the median as about the same", () => {
  assert.equal(compareToMedian(100, 100), "about-the-same");
  assert.equal(compareToMedian(103, 100), "about-the-same");
  assert.equal(compareToMedian(97, 100), "about-the-same");
  assert.equal(compareToMedian(120, 100), "above");
  assert.equal(compareToMedian(80, 100), "below");
});

test("compareToMedian handles a zero median without dividing by zero", () => {
  assert.equal(compareToMedian(0, 0), "about-the-same");
  assert.equal(compareToMedian(5, 0), "above");
});

test("medianComparisonWords never says better/worse, only above/below/about the same", () => {
  assert.equal(medianComparisonWords("above"), "above the state median");
  assert.equal(medianComparisonWords("below"), "below the state median");
  assert.equal(medianComparisonWords("about-the-same"), "about the same as the state median");
  assert.equal(medianComparisonWords(null), null);
  for (const w of [medianComparisonWords("above"), medianComparisonWords("below"), medianComparisonWords("about-the-same")]) {
    assert.ok(w && !/better|worse|good|bad/i.test(w), w ?? "");
  }
});

test("medianSentence combines the value, the comparison, and the median itself", () => {
  assert.equal(medianSentence(0.22, 0.18, pct), "22% — above the state median (18%)");
  assert.equal(medianSentence(null, 0.18, pct), null, "no sentence without a value");
  assert.equal(medianSentence(0.22, null, pct), null, "no sentence without a median");
});

/* ------------------------------------------------------------------ */
/* Suppression and ranges                                              */
/* ------------------------------------------------------------------ */

test("hsValueText: a count distinguishes 'fewer than 5' from 'not reported'", () => {
  assert.equal(hsValueText(12, false, (n) => String(n), "count"), "12");
  assert.equal(hsValueText(null, true, (n) => String(n), "count"), "Fewer than 5");
  assert.equal(hsValueText(null, false, (n) => String(n), "count"), "Not reported");
});

test("shareText suppressed for privacy reads differently from not reported", () => {
  assert.equal(shareText(0.4, false), "40%");
  assert.equal(shareText(null, true), "Not reported (suppressed for privacy)");
  assert.equal(shareText(null, false), "Not reported");
});

test("formatRateRange keeps an EDFacts range a range, never a midpoint", () => {
  assert.equal(formatRateRange(0.9, 0.94), "90–94%");
  assert.equal(formatRateRange(0.8, 1), "80–100%");
});

test("gradRateText: exact rate, range, suppressed, and not reported", () => {
  assert.equal(gradRateText({ value: 0.88, low: null, high: null, cohort: 290 }), "88%");
  assert.equal(gradRateText({ value: null, low: 0.9, high: 0.94, cohort: 498 }), "90–94%");
  assert.equal(gradRateText(null), "Not reported");
  assert.equal(gradRateText({ value: null, low: null, high: null, cohort: 3 }, true), "Fewer than 5 in the cohort");
  assert.equal(gradRateText({ value: null, low: null, high: null, cohort: null }, false), "Not reported");
});

test("enrollmentText", () => {
  assert.equal(enrollmentText(2140), "2,140 students");
  assert.equal(enrollmentText(null), "Not reported");
});

/* ------------------------------------------------------------------ */
/* Badges, states, matriculation line                                  */
/* ------------------------------------------------------------------ */

test("hsTypeBadges only lists the true statuses, in a fixed order", () => {
  assert.deepEqual(hsTypeBadges({ charter: false, magnet: true, title_i: true, virtual: false }), [
    { key: "magnet", label: "Magnet" },
    { key: "title_i", label: "Title I" },
  ]);
  assert.deepEqual(hsTypeBadges({ charter: null, magnet: null, title_i: null, virtual: null }), []);
});

test("hsStateName resolves a USPS code to its full name", () => {
  assert.equal(hsStateName("CA"), "California");
  assert.equal(hsStateName("DC"), "District of Columbia");
});

test("matriculationLine matches the quiet college-profile sentence (specs/product/high-school-data.md)", () => {
  assert.equal(matriculationLine(6, "2023–2025", "2025–26"), "6 enrolled in 2023–2025 (school profile, 2025–26)");
});

/* ------------------------------------------------------------------ */
/* basics.highSchoolId sanitize rule                                    */
/* ------------------------------------------------------------------ */

test("sanitizeProfile accepts a valid public (ncessch) or private (ppin) high school id", () => {
  assert.equal(sanitizeProfile({ basics: { highSchoolId: "060000100001" } }).basics.highSchoolId, "060000100001");
  assert.equal(sanitizeProfile({ basics: { highSchoolId: "A9900001" } }).basics.highSchoolId, "A9900001");
});

test("sanitizeProfile drops an invalid high school id rather than storing garbage", () => {
  assert.equal(sanitizeProfile({ basics: { highSchoolId: "not-an-id" } }).basics.highSchoolId, null);
  assert.equal(sanitizeProfile({ basics: { highSchoolId: 123 } }).basics.highSchoolId, null, "non-string dropped");
  assert.equal(sanitizeProfile({ basics: { highSchoolId: "12345" } }).basics.highSchoolId, null, "too short for an ncessch");
});

test("sanitizeProfile keeps the free-text high school name independent of the id", () => {
  const out = sanitizeProfile({ basics: { highSchool: "My Local High", highSchoolId: null } });
  assert.equal(out.basics.highSchool, "My Local High");
  assert.equal(out.basics.highSchoolId, null);
});

test("scoresDisplay: means read as means with sections underneath; ranges as middle 50%; nothing → null", () => {
  assert.deepEqual(scoresDisplay({ sat_mean: { erw: 641, math: 657 }, act_mean: 31, quote: "q" }), {
    label: "Mean SAT and ACT",
    value: "SAT 1298 · ACT 31",
    sub: "Reading and writing 641, math 657",
  });
  assert.deepEqual(scoresDisplay({ sat_mid50: [1080, 1320], act_mid50: [21, 29], quote: "q" }), { label: "SAT and ACT, middle 50%", value: "SAT 1080–1320 · ACT 21–29", sub: null });
  assert.equal(scoresDisplay({ quote: "q" }), null);
  assert.equal(scoresDisplay(null), null);
});

test("admittedSummary: says it's admissions, not enrollment", () => {
  const s = admittedSummary({ classes: "Class of 2026", entries: [{ name: "A", unit_id: null }, { name: "B", unit_id: "110662" }], quote: "q" });
  assert.equal(s, "2 colleges admitted at least one member of the class of 2026. This is where students were admitted, not where they enrolled.");
});

test("gpaScaleLabel: base scale in words; never '100.0 scale'", () => {
  const s = (kind: "unweighted-4" | "weighted-5" | "100-point" | "other", max: number | null, weighted: boolean) =>
    ({ kind, max, weighted, conversion: null, quote: "" });
  assert.equal(gpaScaleLabel(s("100-point", 100, false)), "100-point scale");
  assert.equal(gpaScaleLabel(s("unweighted-4", 4, false)), "4.0 scale");
  assert.equal(gpaScaleLabel(s("unweighted-4", 4, true)), "4.0 scale, weighted GPA reported");
  assert.equal(gpaScaleLabel(s("weighted-5", 5, true)), "5.0 weighted scale");
  assert.equal(gpaScaleLabel(s("other", 4.5, false)), "4.5 scale");
  assert.equal(gpaScaleLabel(s("other", 6, false)), "6.0 scale");
  assert.equal(gpaScaleLabel(s("other", null, false)), "School's own scale");
});
