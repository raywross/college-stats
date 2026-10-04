/**
 * CDS application logistics and high school preparation (specs/data-expansion/cds-application-logistics.md): the
 * record → block read, the spec's checks (each shown to fail when broken), years, lineage, the merge, display lines,
 * Explore's gap-year chip, Compare's cells, and the partial-coverage guard. Real records:
 * data/cds-records/{221999,190415,231624,145637}.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, ReportedLogistics, School } from "../lib/types";
import type { CdsCode, CollegeRecord, DocumentRecord } from "../lib/cds-sections.ts";
import { normalizeValue } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { validateSchool } from "../lib/lineage.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import {
  checkRecommendedAtLeastRequired,
  checkRegularAfterEarly,
  checkReplyAfterNotification,
  checkUnits,
  deferAllowed,
  logisticsFromRecord,
  mergeApplicationLogistics,
  oneMark,
  readLogistics,
} from "../lib/cds/application-logistics.ts";
import {
  LOGISTICS_FILTERS,
  applyingLines,
  compareDeadlines,
  compareGapYear,
  deadlineSentence,
  depositSentence,
  feeWaiverSentence,
  gapYearSentence,
  notificationSentence,
  replySentence,
  showsHsPrep,
  unitRows,
} from "../lib/cds/application-logistics-display.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string): CollegeRecord => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string): School => structuredClone(schools.find((s) => s.unit_id === id)!);
const docOf = (r: CollegeRecord): DocumentRecord => r.documents[0];

/** Overwrites one item as a passed workbook cell (or blanks it with `undefined`). */
function set(doc: DocumentRecord, code: CdsCode, v: number | string | boolean | undefined) {
  if (v === undefined) doc.items[code] = { status: "blank" };
  else doc.items[code] = { status: "passed", v, quote: `${code} | ${typeof v === "boolean" ? (v ? "X" : "No") : v}`, cell: "CDS-C!AC1" };
}

const VU = "221999";
const CU = "190415";
const WM = "231624";
const IL = "145637";

/* ------------------------------------------------------------------ */
/* Real values                                                         */
/* ------------------------------------------------------------------ */

test("data/schools.json carries the real values for the four template workbooks", () => {
  const wm = school(WM).reported!.admissions_logistics!;
  assert.equal(wm.cycle, "Fall 2026");
  assert.deepEqual(wm.regular_closing, { month: 1, day: 5 });
  // C.1608 holds the Excel serial 46113: April 1.
  assert.equal(wm.notification?.kind, "other");
  assert.deepEqual(wm.notification?.other_date, { month: 4, day: 1 });
  assert.deepEqual(wm.reply, { kind: "fixed_date", date: { month: 5, day: 1 }, weeks: null, other_text: null });
  assert.deepEqual(wm.housing_deposit, { due: { month: 5, day: 1 }, amount: 350, refundable: "no" });
  assert.deepEqual(wm.deferred_admission, { allowed: true, max_postponement: "2 Year" });
  assert.deepEqual(wm.fee, { waiver: true, online_same: true, online_waiver: true });

  const cu = school(CU).reported!.admissions_logistics!;
  assert.deepEqual(cu.regular_closing, { month: 1, day: 2 });
  assert.equal(cu.notification?.other_text, "Early April");
  assert.deepEqual(cu.reply, { kind: "may1_or_weeks", date: null, weeks: 2, other_text: null });
  // Cornell's C.1801 is the template placeholder "Yes or No": no deferred-admission answer at all.
  assert.equal(cu.deferred_admission, null);

  const il = school(IL).reported!.admissions_logistics!;
  assert.deepEqual(il.priority_date, { month: 11, day: 1 });
  // Text in the amount cell ("$100 application fee"): amount null, the words stay in the quote.
  assert.deepEqual(il.housing_deposit, { due: null, amount: null, refundable: "no" });
  assert.match(school(IL).lineage!["reported.admissions_logistics.housing_deposit"]!.quote!, /\$100 application fee/);
  assert.equal(il.deferred_admission?.max_postponement, "1 year OR 2 years for U.S. Military");

  const vu = school(VU).reported!.admissions_hs_prep!;
  assert.equal(vu.college_prep, "required");
  assert.equal(vu.units_required?.total, 18);
  assert.equal(vu.units_recommended?.total, 21);
  // Cornell's C5 is "-" in every cell: blank, never 0.
  assert.equal(school(CU).reported!.admissions_hs_prep!.units_required, null);
  assert.equal(school(CU).reported!.admissions_hs_prep!.college_prep, "neither");
});

test("years: logistics are the next cycle (Fall 2026), high school prep the edition (2025–26), from the record", () => {
  const wm = school(WM);
  assert.equal(wm.lineage!["reported.admissions_logistics.regular_closing"]!.year, "Fall 2026 cycle");
  assert.equal(wm.lineage!["reported.admissions_hs_prep.college_prep"]!.year, "2025–26");
  // Break: a record whose next-cycle label says otherwise moves every logistics year with it.
  const r = record(WM);
  docOf(r).years["next-cycle"] = "Fall 2031 cycle";
  const { logistics, lineage } = logisticsFromRecord(r);
  assert.equal(logistics!.cycle, "Fall 2031");
  assert.equal(lineage["reported.admissions_logistics.reply"].year, "Fall 2031 cycle");
  assert.equal(deadlineSentence(logistics!), "Apply by January 5 for fall 2031.");
});

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

test("regular closing on/after early closing: W&M's January 5 passes; a regular date before its ED II closing is held", () => {
  assert.equal(readLogistics(docOf(record(WM))).outcome.failures.length, 0);
  const r = record(WM);
  set(docOf(r), "C.1402", 12);
  set(docOf(r), "C.1403", 1); // Dec 1, before ED II's Jan 5
  const { logistics, outcome } = readLogistics(docOf(r));
  assert.equal(logistics.regular_closing, null);
  assert.ok(outcome.failures.some((f) => f.check === "regular-after-early" && f.block === "regular_closing"));
  // November vs January compares within the cycle: Illinois's EA Nov 1 before regular Jan 5 passes.
  assert.equal(checkRegularAfterEarly({ month: 1, day: 5 }, [{ date: { month: 11, day: 1 }, label: "early action" }]), null);
  assert.ok(checkRegularAfterEarly({ month: 10, day: 15 }, [{ date: { month: 11, day: 1 }, label: "early action" }]));
});

test("reply on/after notification: fails when both are dates; skipped (never passed) for rolling or May 1 or N weeks", () => {
  const n = (kind: "rolling" | "by_date" | "other", d: { month: number; day: number } | null): ReportedLogistics["notification"] => ({
    kind,
    rolling_from: kind === "rolling" ? d : null,
    by_date: kind === "by_date" ? d : null,
    other_date: kind === "other" ? d : null,
    other_text: null,
  });
  const fixed = (month: number, day: number): ReportedLogistics["reply"] => ({ kind: "fixed_date", date: { month, day }, weeks: null, other_text: null });
  assert.equal(checkReplyAfterNotification(n("other", { month: 4, day: 1 }), fixed(5, 1)), "passed");
  assert.equal(checkReplyAfterNotification(n("by_date", { month: 4, day: 1 }), fixed(3, 1)), "failed");
  assert.equal(checkReplyAfterNotification(n("rolling", { month: 8, day: 15 }), fixed(5, 1)), "skipped");
  assert.equal(checkReplyAfterNotification(n("by_date", { month: 4, day: 1 }), { kind: "may1_or_weeks", date: null, weeks: 3, other_text: null }), "skipped");

  // In a record: W&M with a reply date of March 1, before its April 1 notification, holds the reply block.
  const r = record(WM);
  set(docOf(r), "C.1702", 3);
  const { logistics, outcome } = readLogistics(docOf(r));
  assert.equal(logistics.reply, null);
  assert.ok(outcome.failures.some((f) => f.check === "reply-after-notification"));
  // Cornell (other "Early April", May 1 or 2 weeks): recorded as not checkable, not as a failure.
  const cu = readLogistics(docOf(record(CU))).outcome;
  assert.ok(cu.skipped.some((s) => s.check === "reply-after-notification"));
  assert.equal(cu.failures.length, 0);
});

test("one mark per row: two notification options marked fails; none is blank", () => {
  assert.equal(oneMark([true, null, null]), "one");
  assert.equal(oneMark([null, null, null]), "none");
  assert.equal(oneMark([true, true, null]), "many");
  const r = record(IL);
  set(docOf(r), "C.1601", true); // rolling, and Illinois already marks "by"
  const { logistics, outcome } = readLogistics(docOf(r));
  assert.equal(logistics.notification, null);
  assert.ok(outcome.failures.some((f) => f.check === "one-mark" && f.block === "notification"));
  const blank = record(IL);
  set(docOf(blank), "C.1604", undefined);
  assert.equal(readLogistics(docOf(blank)).logistics.notification, null);
  assert.equal(readLogistics(docOf(blank)).outcome.failures.length, 0);
});

test("valid date: a deposit due February 30 is held for review; free text in a date cell is kept as text", () => {
  const r = record(WM);
  set(docOf(r), "C.1709", 2);
  set(docOf(r), "C.1710", 30);
  const { logistics, outcome } = readLogistics(docOf(r));
  assert.equal(logistics.housing_deposit, null);
  assert.ok(outcome.failures.some((f) => f.check === "valid-date" && f.block === "housing_deposit"));
  const text = record(WM);
  set(docOf(text), "C.1402", "varies");
  const read = readLogistics(docOf(text));
  assert.deepEqual(read.logistics.regular_closing, { month: null, day: null });
  assert.equal(read.outcome.failures.length, 0);
});

test('"Yes or No" (the placeholder) is blank, never true', () => {
  const item = CDS_TEMPLATE.byCode.get("C.1801")!;
  assert.deepEqual(normalizeValue(item, "Yes or No"), { status: "blank", v: null });
  assert.deepEqual(normalizeValue(item, "yes or no"), { status: "blank", v: null });
  assert.equal(deferAllowed("Yes or No"), null);
  // Even if a model read passed the words through as text, the block doesn't say "allowed".
  const r = record(CU);
  set(docOf(r), "C.1801", "Yes or No");
  assert.equal(readLogistics(docOf(r)).logistics.deferred_admission, null);
  assert.equal(deferAllowed(true), true);
});

test("C5 sums: a blank total with filled subjects is summed (W&M recommended 20); off by more than 1 fails", () => {
  // The committed record already carries the checks track's summed total (lib/cds-checks.ts, method "derived"), so
  // the merged value is 20 either way; this module's own summation is exercised on a copy with the total blanked.
  const wm = school(WM).reported!.admissions_hs_prep!.units_recommended!;
  assert.equal(wm.total, 20);
  const wmRecord = record(WM);
  docOf(wmRecord).items["C.513"] = { status: "blank" };
  const summed = readLogistics(docOf(wmRecord)).hsPrep.units_recommended!;
  assert.equal(summed.total, 20);
  assert.equal(summed.total_summed, true);
  const r = record(VU);
  set(docOf(r), "C.501", 25);
  const { hsPrep, outcome } = readLogistics(docOf(r));
  assert.equal(hsPrep.units_required, null);
  assert.ok(outcome.failures.some((f) => f.check === "units-sum"));
  // Lab is not an addend: VU's 18 = 4+3+3+2+2+1+3+0+0 with lab 2 passes.
  assert.deepEqual(checkUnits(school(VU).reported!.admissions_hs_prep!.units_required!, "required"), []);
});

test("recommended at least required, per subject; lab no more than science", () => {
  const vu = school(VU).reported!.admissions_hs_prep!;
  assert.deepEqual(checkRecommendedAtLeastRequired(vu.units_required, vu.units_recommended), []);
  const r = record(VU);
  set(docOf(r), "C.515", 2); // recommended math 2 < required 3
  set(docOf(r), "C.513", 19);
  const below = readLogistics(docOf(r));
  assert.equal(below.hsPrep.units_recommended, null);
  assert.ok(below.outcome.failures.some((f) => f.check === "recommended-at-least-required"));
  const lab = record(VU);
  set(docOf(lab), "C.505", 4); // required lab 4 > science 3
  const over = readLogistics(docOf(lab));
  assert.equal(over.hsPrep.units_required, null);
  assert.ok(over.outcome.failures.some((f) => f.check === "lab-within-science"));
});

/* ------------------------------------------------------------------ */
/* Lineage and merge                                                   */
/* ------------------------------------------------------------------ */

test("lineage: every stored block is cited to the college's document; dropping one fails the lineage check", () => {
  for (const id of [VU, CU, WM, IL]) assert.deepEqual(validateSchool(school(id), meta), [], id);
  const wm = school(WM);
  const rec = wm.lineage!["reported.admissions_logistics.notification"]!;
  assert.equal(rec.source, "college-site");
  assert.equal(rec.method, "extracted");
  assert.match(rec.quote!, /46113/);
  delete wm.lineage!["reported.admissions_logistics.notification"];
  assert.ok(validateSchool(wm, meta).some((e) => e.includes("reported.admissions_logistics.notification is stored without a lineage record")));
});

test("mergeApplicationLogistics is idempotent and removes the blocks when the record is gone", () => {
  const wm = school(WM);
  assert.deepEqual(mergeApplicationLogistics(wm, record(WM)), wm);
  const gone = mergeApplicationLogistics(wm, undefined);
  assert.equal(gone.reported?.admissions_logistics, undefined);
  assert.equal(gone.reported?.admissions_hs_prep, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => /admissions_(logistics|hs_prep)/.test(k)));
});

test("only the newest document: an older edition's dates never show once a newer CDS leaves them blank", () => {
  const r = record(WM);
  const older = structuredClone(docOf(r));
  older.edition = "2024-25";
  older.sha256 = "0".repeat(64);
  older.years = { ...older.years, "next-cycle": "Fall 2025 cycle" };
  set(docOf(r), "C.1402", undefined);
  set(docOf(r), "C.1403", undefined);
  r.documents.push(older);
  const { logistics } = logisticsFromRecord(r);
  assert.equal(logistics!.regular_closing, null);
  assert.equal(logistics!.cycle, "Fall 2026");
});

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

test("Applying lines for William & Mary, and nothing for a blank item", () => {
  const wm = school(WM);
  const l = wm.reported!.admissions_logistics!;
  assert.equal(deadlineSentence(l), "Apply by January 5 for fall 2026.");
  assert.equal(notificationSentence(l), "Decisions are released April 1.");
  assert.equal(notificationSentence(school(CU).reported!.admissions_logistics!), "Decisions are released: Early April.");
  assert.equal(replySentence(l), "Admitted students must reply by May 1.");
  assert.equal(depositSentence(l), "$350 housing deposit, due May 1, non-refundable.");
  assert.match(gapYearSentence(l)!, /postpone enrollment.*2 Year/);
  assert.equal(feeWaiverSentence(l), "Can be waived for applicants with financial need.");
  assert.deepEqual(applyingLines(wm).map((x) => x.key), ["regular_closing", "notification", "reply", "housing_deposit", "deferred_admission"]);
  // C15 is stored, never displayed.
  assert.ok(!applyingLines(wm).some((x) => x.key === "other_terms"));
  assert.equal(replySentence(school(CU).reported!.admissions_logistics!), "Admitted students must reply by May 1, or within 2 weeks if admitted later.");
  assert.equal(depositSentence(school(IL).reported!.admissions_logistics!), "The housing deposit is non-refundable.");
});

test("gap year: never 'No' as a headline", () => {
  const l = structuredClone(school(WM).reported!.admissions_logistics!);
  l.deferred_admission = { allowed: false, max_postponement: null };
  assert.equal(gapYearSentence(l), null);
});

test("high school block: shown only with C5 units (Cornell has C3/C4 only); lab is a note on science", () => {
  assert.equal(showsHsPrep(school(CU)), false);
  assert.equal(showsHsPrep(school(VU)), true);
  const rows = unitRows(school(VU).reported!.admissions_hs_prep!);
  const science = rows.find((r) => r.label === "Science")!;
  assert.deepEqual([science.required, science.recommended, science.lab], [3, 4, { required: 2, recommended: 3 }]);
  assert.ok(!rows.some((r) => r.label === "Lab"));
});

test("Explore: gapYear parses, counts as a filter, and matches only colleges whose CDS says yes", () => {
  assert.equal(parseFilters({ gapYear: "1" }).gapYear, true);
  assert.equal(countActiveFilters({ gapYear: "1" }), 1);
  const [gap] = LOGISTICS_FILTERS;
  // The first records' three gap-year colleges always match; a pipeline run may add more, each saying yes in its CDS.
  const matched = schools.filter(gap.test);
  for (const id of [IL, VU, WM]) assert.ok(matched.some((s) => s.unit_id === id), id);
  assert.ok(!matched.some((s) => s.unit_id === CU), "Cornell's 'Yes or No' placeholder is not a yes");
  for (const s of matched) assert.ok(s.reported?.admissions_logistics, `${s.unit_id} has the block`);
});

test("Compare: deadlines & deposit and gap year cells; null (row hidden) without data", () => {
  assert.equal(compareDeadlines(school(WM)), "Apply by January 5 · reply by May 1 · $350 housing deposit");
  assert.equal(compareGapYear(school(WM)), "Yes, up to 2 Year");
  assert.equal(compareGapYear(school(CU)), null);
  const none = schools.find((s) => !s.reported?.admissions_logistics)!;
  assert.equal(compareDeadlines(none), null);
  assert.equal(compareGapYear(none), null);
});

/* ------------------------------------------------------------------ */
/* Partial-coverage guard                                              */
/* ------------------------------------------------------------------ */

const LOGISTICS_FIELD = /admissions_logistics|admissions_hs_prep|application-logistics/;

test("partial coverage: no METRICS entry, rank, median, sort, Key difference, Known-for, or Home fact uses these fields", () => {
  for (const f of ["lib/metrics.ts", "lib/insights.ts", "lib/indicators.ts", "lib/history.ts", "app/page.tsx"]) {
    assert.ok(!LOGISTICS_FIELD.test(readFileSync(join(ROOT, f), "utf8")), `${f} uses an application-logistics field`);
  }
  const dataset = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const sorters = dataset.slice(dataset.indexOf("const SORTERS"), dataset.indexOf("};", dataset.indexOf("const SORTERS")));
  assert.ok(sorters.length > 100 && !LOGISTICS_FIELD.test(sorters), "an Explore sort uses an application-logistics field");
  const outside = dataset.replace(/^.*LOGISTICS_FILTERS.*$/gm, "");
  assert.ok(!LOGISTICS_FIELD.test(outside), "lib/dataset.ts uses an application-logistics field outside its filter");
  // Compare: never in Key differences (only the "All the numbers" rows).
  const compare = readFileSync(join(ROOT, "app", "compare", "page.tsx"), "utf8");
  // From the section heading itself, not the first mention (row comments above name "Key differences" too).
  const heading = compare.indexOf(">Key differences<");
  assert.ok(heading > 0, "the Key differences heading exists");
  const keyDiff = compare.slice(heading, heading + 4000);
  assert.ok(!/compareDeadlines|compareGapYear|admissions_logistics/.test(keyDiff), "Key differences uses an application-logistics field");
});
