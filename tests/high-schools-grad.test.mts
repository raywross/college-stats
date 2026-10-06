/**
 * Graduation rates and their history (specs/product/high-school-data.md "As built (graduation rates and history)"):
 * every ED Data Express rate spelling, Excel-mangled ranges, multi-year files, newest-class selection, the LEA/SEA
 * files being ignored, grad_history validation (each guard proven to fail on a broken row), the meta check that ties
 * the newest class to the release year, and the trend's pure display helpers. Fixture folders:
 * tests/fixtures/high-schools/federal/edx/. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HighSchool, HighSchoolMeta, HsGradHistoryEntry } from "../lib/high-school-types.ts";
import { blankHighSchool, normalizeHighSchool, parseRateRange, validateHighSchoolMeta, validateHighSchoolRow } from "../lib/high-school-core.ts";
import { citeHsField, isHsFieldPath } from "../lib/hs-fields.ts";
import {
  gradPointShort,
  gradPointWords,
  gradTrendDomain,
  gradTrendPoints,
  gradTrendSummary,
  hasGradTrend,
} from "../lib/high-school-ui.ts";
import { createAdapterContext } from "../scripts/lib/high-schools/context.mts";
import { buildAcgr, classSpan, findDataExpressFiles, isDataExpressCsv, repairRateCell, load as loadEdfacts } from "../scripts/lib/high-schools/edfacts.mts";

const EDX = join(import.meta.dirname, "fixtures", "high-schools", "federal", "edx");
const LONG_CACHE = join(import.meta.dirname, "fixtures", "high-schools", "federal", "cache");
const ROOT = join(import.meta.dirname, "..");
const quiet = { log: () => {}, warn: () => {} };

/* ------------------------------------------------------------------ */
/* Rate cells                                                          */
/* ------------------------------------------------------------------ */

test("parseRateRange: every ED Data Express spelling, plus the EDFacts codes it replaced", () => {
  const r = (raw: string) => parseRateRange(raw);
  assert.deepEqual(r("93%"), { value: 0.93, low: null, high: null, suppressed: false });
  assert.deepEqual(r("86.70%"), { value: 0.867, low: null, high: null, suppressed: false });
  assert.deepEqual(r("80-84%"), { value: null, low: 0.8, high: 0.84, suppressed: false });
  assert.deepEqual(r(">=90%"), { value: null, low: 0.9, high: 1, suppressed: false });
  assert.deepEqual(r(">50%"), { value: null, low: 0.51, high: 1, suppressed: false });
  assert.deepEqual(r("<=10%"), { value: null, low: 0, high: 0.1, suppressed: false });
  assert.deepEqual(r("<50%"), { value: null, low: 0, high: 0.49, suppressed: false });
  assert.deepEqual(r("S"), { value: null, low: null, high: null, suppressed: true });
  // Older spellings still parse the same way.
  assert.deepEqual(r("GE90"), r(">=90%"));
  assert.deepEqual(r("LT50"), r("<50%"));
  assert.deepEqual(r("90-94"), { value: null, low: 0.9, high: 0.94, suppressed: false });
  assert.deepEqual(r("85"), { value: 0.85, low: null, high: null, suppressed: false });
  assert.equal(r("PS").suppressed, true);
  // Missing and nonsense stay missing (never zero, never a midpoint).
  for (const bad of ["", ".", "NA", "101%", "94-90%", ">=", "%"]) assert.deepEqual(r(bad), { value: null, low: null, high: null, suppressed: false }, bad);
});

test("repairRateCell: ranges a spreadsheet turned into dates come back as ranges", () => {
  assert.equal(repairRateCell("14-Oct"), "10-14");
  assert.equal(repairRateCell("9-Jun"), "6-9");
  assert.equal(repairRateCell("19-Nov"), "11-19");
  assert.equal(repairRateCell("Nov-19"), "11-19");
  assert.equal(repairRateCell("80-84%"), "80-84%");
  assert.equal(repairRateCell("14-Foo"), "14-Foo");
  assert.deepEqual(parseRateRange(repairRateCell("14-Oct")), { value: null, low: 0.1, high: 0.14, suppressed: false });
});

/* ------------------------------------------------------------------ */
/* Building patches                                                    */
/* ------------------------------------------------------------------ */

const cell = (id: string, schoolYear: string, rate: string, cohort = "100") => ({ id, schoolYear, rate, cohort });

test("buildAcgr: the newest school year in the files is grad_rate; every reported class is history, oldest first", () => {
  const b = buildAcgr([
    cell("060000100101", "2020-2021", "93%", "205"),
    cell("060000100101", "2016-2017", "85", "190"),
    cell("060000100101", "2018-2019", "S", "3"),
    cell("060000100101", "2017-2018", ">=90%", "198"),
    cell("060000100102", "2018-2019", "80-84%"),
    cell("060000100102", "2017-2018", ""),
  ]);
  assert.deepEqual(b.years, [2016, 2017, 2018, 2020]);
  assert.equal(b.newest, 2020);
  const a = b.patches.find((p) => p.id === "060000100101")!;
  assert.deepEqual(a.values.grad_rate, { value: 0.93, low: null, high: null, cohort: 205 });
  assert.deepEqual(a.values.grad_history, [
    { year: "Class of 2017", value: 0.85, low: null, high: null, cohort: 190 },
    { year: "Class of 2018", value: null, low: 0.9, high: 1, cohort: 198 },
    { year: "Class of 2019", value: null, low: null, high: null, cohort: null, suppressed: true },
    { year: "Class of 2021", value: 0.93, low: null, high: null, cohort: 205 },
  ]);
  // Not reported in the newest year: no current rate (an older class is never passed off as the current one), and one
  // reported class is no history.
  const b2 = b.patches.find((p) => p.id === "060000100102")!;
  assert.equal(b2.values.grad_rate, null);
  assert.equal(b2.values.grad_history, null, "a blank cell is left out, so one class remains");
});

test("buildAcgr: a repeated school-year record is counted and ignored (first wins); unreadable years are counted", () => {
  const b = buildAcgr([cell("060000100101", "2020-2021", "93%"), cell("060000100101", "2020-2021", "50%"), cell("060000100101", "junk", "50%")]);
  assert.equal(b.duplicates, 1);
  assert.equal(b.badYear, 1);
  assert.equal(b.patches[0].values.grad_rate?.value, 0.93);
});

test("buildAcgr: small cohorts and suppressed rates follow the small-cell rule", () => {
  const b = buildAcgr([cell("060000100101", "2020-2021", "80-84%", "4"), cell("060000100102", "2020-2021", "S", "3"), cell("060000100103", "2020-2021", "S", "40")]);
  const [a, s, s40] = b.patches;
  assert.deepEqual(a.values.grad_rate, { value: null, low: 0.8, high: 0.84, cohort: null });
  assert.deepEqual(a.suppressed, ["grad_rate.cohort"]);
  assert.deepEqual(s.values.grad_rate, { value: null, low: null, high: null, cohort: null });
  assert.deepEqual(s.suppressed, ["grad_rate"]);
  assert.deepEqual(s40.values.grad_rate, { value: null, low: null, high: null, cohort: 40 }, "a suppressed rate keeps a cohort count of 5 or more");
});

test("classSpan: one class or a span", () => {
  assert.equal(classSpan([2020]), "Class of 2021");
  assert.equal(classSpan([2010, 2020, 2015]), "Classes of 2011–2021");
  assert.equal(classSpan([]), null);
});

/* ------------------------------------------------------------------ */
/* Loading folders                                                     */
/* ------------------------------------------------------------------ */

test("findDataExpressFiles: school-level files only (LEA and SEA folders ignored), newest release first", () => {
  const files = findDataExpressFiles(EDX).map((f) => f.slice(f.lastIndexOf("/") + 1));
  assert.deepEqual(files, ["SY2021_FS150_FS151_DG695_DG696_SCH.csv", "SY1819_FS150_FS151_DG695_DG696_SCH.csv", "SY1018_FS150_FS151_DG695_DG696_SCH.csv"]);
  assert.equal(isDataExpressCsv(join(EDX, "SY2021_FS150_FS151_DG695_DG696_SCH_data_files", "SY2021_FS150_FS151_DG695_DG696_SCH.csv")), true);
  assert.equal(isDataExpressCsv(join(LONG_CACHE, "acgr-sch-sy2022-23-long.csv")), false);
});

test("load: Data Express folders in the cache, a multi-year file among them; years, source, and vintages from the data", async () => {
  const ctx = createAdapterContext({ root: ROOT, outDir: tmpdir(), cacheDir: EDX, offline: true, ...quiet });
  const res = await loadEdfacts(ctx);
  const by = new Map(res.patches!.map((p) => [p.id, p]));
  assert.equal(res.vintages["edfacts-acgr"], "Class of 2021");
  assert.equal(res.vintages["edfacts-acgr-history"], "Classes of 2017–2021");
  assert.equal(res.sources.edfacts!.url, "https://eddataexpress.ed.gov/download/data-library");
  assert.match(res.sources.edfacts!.name, /school level, 2016–17 to 2020–21 school years/);
  assert.match(res.sources.edfacts!.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  // The LEA folder's 2019–20 row never shows up.
  assert.ok(![...by.values()].some((p) => p.values.grad_history?.some((e) => e.year === "Class of 2020")));
  const a = by.get("060000100101")!;
  assert.deepEqual(a.values.grad_rate, { value: 0.93, low: null, high: null, cohort: 205 }, "the subgroup row and the repeated 50% row are ignored");
  assert.deepEqual(a.values.grad_history!.map((e) => e.year), ["Class of 2017", "Class of 2018", "Class of 2019", "Class of 2021"]);
  assert.equal(by.get("480000200201")!.values.grad_rate!.low, 0.9);
  assert.equal(by.get("060000100103")!.values.grad_rate!.high, 0.1);
  assert.equal(by.get("060000100105")!.values.grad_rate!.high, 0.49);
  // A school gone before the newest year: history (with repaired ranges), no current rate.
  const gone = by.get("060000100106")!;
  assert.equal(gone.values.grad_rate, null);
  assert.deepEqual(gone.values.grad_history, [
    { year: "Class of 2017", value: null, low: null, high: null, cohort: null, suppressed: true },
    { year: "Class of 2018", value: null, low: 0.1, high: 0.14, cohort: 40 },
    { year: "Class of 2019", value: null, low: 0.06, high: 0.09, cohort: 44 },
  ]);
  // Every patch makes a valid row.
  for (const p of res.patches!) {
    const row = normalizeHighSchool({ ...blankHighSchool(p.id, "public", "Fixture", p.id.startsWith("48") ? "TX" : "CA"), grades: { low: "9", high: "12" }, ...p.values, suppressed: p.suppressed });
    assert.deepEqual(validateHighSchoolRow(row), [], p.id);
  }
});

test("load: --edfacts-file with one Data Express CSV, --edfacts-dir with a folder, and --edfacts-retrieved", async () => {
  const one = join(EDX, "SY1819_FS150_FS151_DG695_DG696_SCH_data_files", "SY1819_FS150_FS151_DG695_DG696_SCH.csv");
  const empty = mkdtempSync(join(tmpdir(), "hs-grad-"));
  try {
    const r1 = await loadEdfacts(createAdapterContext({ root: ROOT, outDir: empty, cacheDir: empty, offline: true, flags: { "edfacts-file": one, "edfacts-retrieved": "2026-10-05" }, ...quiet }));
    assert.equal(r1.vintages["edfacts-acgr"], "Class of 2019");
    assert.equal(r1.sources.edfacts!.retrieved, "2026-10-05");
    assert.equal(r1.patches!.length, 2);
    const r2 = await loadEdfacts(createAdapterContext({ root: ROOT, outDir: empty, cacheDir: empty, offline: true, flags: { "edfacts-dir": EDX }, ...quiet }));
    assert.equal(r2.vintages["edfacts-acgr"], "Class of 2021");
    await assert.rejects(loadEdfacts(createAdapterContext({ root: ROOT, outDir: empty, cacheDir: empty, offline: true, flags: { "edfacts-dir": empty }, ...quiet })), /no ED Data Express school-level file/);
    await assert.rejects(loadEdfacts(createAdapterContext({ root: ROOT, outDir: empty, cacheDir: empty, offline: true, flags: { "edfacts-file": one, "edfacts-retrieved": "Oct 5" }, ...quiet })), /YYYY-MM-DD/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("load: the old EDFacts long file still works when no Data Express folder is cached", async () => {
  const res = await loadEdfacts(createAdapterContext({ root: ROOT, outDir: tmpdir(), cacheDir: LONG_CACHE, offline: true, ...quiet }));
  assert.equal(res.vintages["edfacts-acgr"], "Class of 2023");
  assert.equal(res.vintages["edfacts-acgr-history"], "Class of 2023");
  assert.ok(res.patches!.every((p) => p.values.grad_history === null));
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const H = (o: Partial<HsGradHistoryEntry> & { year: string }): HsGradHistoryEntry => ({ value: null, low: null, high: null, cohort: null, ...o });

function goodRow(): HighSchool {
  return normalizeHighSchool({
    ...blankHighSchool("060000100101", "public", "Fixture Union High School", "CA"),
    grades: { low: "9", high: "12" },
    grad_rate: { value: 0.93, low: null, high: null, cohort: 205 },
    grad_history: [H({ year: "Class of 2019", low: 0.9, high: 0.94, cohort: 190 }), H({ year: "Class of 2020", suppressed: true }), H({ year: "Class of 2021", value: 0.93, cohort: 205 })],
  });
}

test("grad_history: registered (source edfacts), canonical key order, and a good row passes", () => {
  assert.ok(isHsFieldPath("grad_history"));
  const row = goodRow();
  assert.deepEqual(validateHighSchoolRow(row), []);
  const keys = Object.keys(row);
  assert.equal(keys[keys.indexOf("grad_rate") + 1], "grad_history");
  assert.deepEqual(Object.keys(row.grad_history![1]), ["year", "value", "low", "high", "cohort", "suppressed"]);
  // Key order is fixed whatever order the entry arrived in.
  const shuffled = normalizeHighSchool({ ...row, grad_history: [{ cohort: 1, high: 0.5, low: 0.4, value: null, year: "Class of 2019" }, ...row.grad_history!.slice(1)] as HsGradHistoryEntry[] });
  assert.deepEqual(Object.keys(shuffled.grad_history![0]), ["year", "value", "low", "high", "cohort"]);
});

test("grad_history: each guard fails on a broken row", () => {
  const broken = (mutate: (h: HsGradHistoryEntry[], row: HighSchool) => void, re: RegExp) => {
    const row = structuredClone(goodRow());
    mutate(row.grad_history!, row);
    const problems = validateHighSchoolRow(row);
    assert.ok(problems.some((p) => re.test(p)), `${re}: ${JSON.stringify(problems)}`);
  };
  broken((h) => h.splice(0, 2), /at least two classes/);
  broken((h) => (h[0].year = "2019"), /Class of YYYY/);
  broken((h) => h.reverse(), /out of order/);
  broken((h) => (h[1] = { ...h[0] }), /listed twice/);
  broken((h) => (h[0].high = 1.2), /high must be 0–1/);
  broken((h) => (h[0].value = 0.92), /exact .* not both/);
  broken((h) => (h[0].high = null), /needs both low and high/);
  broken((h) => ((h[0].low = 0.95), (h[0].high = 0.9)), /low > high/);
  broken((h) => (h[0].cohort = 2.5), /cohort must be a whole number/);
  broken((h) => ((h[1] as unknown as { suppressed: boolean }).suppressed = false), /suppressed is true or absent/);
  broken((h) => (h[1].value = 0.5), /suppressed but has a rate/);
  broken((h) => delete h[1].suppressed, /no rate and not suppressed/);
  broken((h) => ((h[0] as unknown as Record<string, unknown>).mid = 0.92), /unknown key mid/);
  broken((h) => (h[2].value = 0.9), /newest class .* doesn't match grad_rate/);
  broken((_h, row) => (row.suppressed = ["grad_rate"]), /listed as suppressed but has a value|doesn't match grad_rate/);
  broken((_h, row) => ((row as unknown as Record<string, unknown>).grad_history = "x"), /grad_history must be a list or null/);
  // Private schools carry no history.
  const priv = normalizeHighSchool({ ...blankHighSchool("A9900001", "private", "Fixture Academy", "CA"), grades: { low: "9", high: "12" }, grad_history: goodRow().grad_history });
  assert.ok(validateHighSchoolRow(priv).some((p) => /no federal graduation rate history/.test(p)));
});

test("meta: a row whose history ends in another class than the release year fails", () => {
  const row = goodRow();
  const meta: HighSchoolMeta = {
    generated: "2026-10-05",
    sources: {
      edfacts: { name: "ED Data Express", publisher: "U.S. Department of Education", url: "https://eddataexpress.ed.gov/download/data-library", retrieved: "2026-10-05" },
      "nces-ccd": { name: "Common Core of Data", publisher: "NCES", url: "https://nces.ed.gov/ccd/files.asp", retrieved: "2026-10-05" },
    },
    vintages: { "ccd-directory": null, "ccd-enrollment": null, "edfacts-acgr": "Class of 2021", "edfacts-acgr-history": "Classes of 2019–2021", crdc: null, pss: null },
    counts: { public: 1, private: 0, byState: { CA: 1 } },
  };
  assert.deepEqual(validateHighSchoolMeta(meta, [row]), []);
  assert.ok(validateHighSchoolMeta({ ...meta, vintages: { ...meta.vintages, "edfacts-acgr": "Class of 2023" } }, [row]).some((p) => /history ends in another class/.test(p)));
  const noKey = { ...meta, vintages: { ...meta.vintages } } as HighSchoolMeta;
  delete (noKey.vintages as Partial<HighSchoolMeta["vintages"]>)["edfacts-acgr-history"];
  assert.ok(validateHighSchoolMeta(noKey, [row]).some((p) => /edfacts-acgr-history missing/.test(p)));
  // The citation names the history's own span.
  assert.equal(citeHsField("grad_history", row, meta).year, "Classes of 2019–2021");
  assert.equal(citeHsField("grad_rate", row, meta).year, "Class of 2021");
});

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

const fixtureHistory: HsGradHistoryEntry[] = [
  H({ year: "Class of 2019", value: 0.86, cohort: 470 }),
  H({ year: "Class of 2020", suppressed: true }),
  H({ year: "Class of 2022", value: 0.91, cohort: 505 }),
  H({ year: "Class of 2023", low: 0.9, high: 0.94, cohort: 498 }),
];

test("gradTrendPoints: one point per class, skipped classes as gaps", () => {
  const pts = gradTrendPoints(fixtureHistory);
  assert.deepEqual(pts.map((p) => [p.year, p.kind]), [[2019, "exact"], [2020, "suppressed"], [2021, "missing"], [2022, "exact"], [2023, "range"]]);
  assert.deepEqual(gradTrendPoints(null), []);
});

test("hasGradTrend: two rated classes needed; a single class (the Class of 2021-only release) shows just the stat", () => {
  assert.equal(hasGradTrend(fixtureHistory), true);
  assert.equal(hasGradTrend(null), false);
  assert.equal(hasGradTrend([H({ year: "Class of 2021", value: 0.93 })]), false);
  assert.equal(hasGradTrend([H({ year: "Class of 2020", suppressed: true }), H({ year: "Class of 2021", value: 0.93 })]), false, "a suppressed class isn't a point");
  assert.equal(hasGradTrend([H({ year: "Class of 2020", low: 0.9, high: 1 }), H({ year: "Class of 2021", value: 0.93 })]), true);
});

test("gradTrendSummary: first and last rated classes, ranges as ranges, suppressed and missing classes named", () => {
  assert.equal(
    gradTrendSummary(fixtureHistory),
    "From 86% (Class of 2019) to between 90% and 94% (Class of 2023). Suppressed for privacy: Class of 2020. Not reported: Class of 2021.",
  );
  assert.equal(gradTrendSummary([H({ year: "Class of 2015", value: 0.88 }), H({ year: "Class of 2016", value: 0.93 })]), "From 88% (Class of 2015) to 93% (Class of 2016).");
  assert.equal(gradTrendSummary([H({ year: "Class of 2021", value: 0.93 })]), null);
});

test("gradPointWords / gradPointShort: open ranges in words, never a midpoint", () => {
  const p = (o: object) => ({ kind: "range" as const, value: null, low: null, high: null, ...o });
  assert.equal(gradPointWords(p({ low: 0.9, high: 1 })), "90% or higher");
  assert.equal(gradPointWords(p({ low: 0, high: 0.49 })), "49% or lower");
  assert.equal(gradPointWords(p({ low: 0.8, high: 0.84 })), "between 80% and 84%");
  assert.equal(gradPointShort(p({ low: 0.9, high: 1 })), "≥90%");
  assert.equal(gradPointShort(p({ low: 0, high: 0.1 })), "≤10%");
  assert.equal(gradPointShort(p({ low: 0.8, high: 0.84 })), "80–84%");
  assert.equal(gradPointShort({ kind: "exact", value: 0.93, low: null, high: null }), "93%");
  assert.equal(gradPointWords({ kind: "suppressed", value: null, low: null, high: null }), "suppressed for privacy");
});

test("gradTrendDomain: floor at the nearest 10% below the lowest bound, never above 50%; top at 100%", () => {
  assert.deepEqual(gradTrendDomain(gradTrendPoints(fixtureHistory)), [0.5, 1]);
  assert.deepEqual(gradTrendDomain(gradTrendPoints([H({ year: "Class of 2020", low: 0, high: 0.49 }), H({ year: "Class of 2021", value: 0.37 })])), [0, 1]);
  assert.deepEqual(gradTrendDomain(gradTrendPoints([H({ year: "Class of 2020", value: 0.42 }), H({ year: "Class of 2021", value: 0.6 })])), [0.4, 1]);
});
