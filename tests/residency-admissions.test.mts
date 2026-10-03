/**
 * CDS admissions by residency (specs/data-expansion/cds-residency-admissions.md): the record → block read, its grid
 * checks and merge window, lineage, rates and the insight, the rate "for you", Explore's chips, Compare's cells, and the
 * partial-coverage guard. Real records: data/cds-records/{221999,190415,231624,145637}.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, ReportedResidencyAdmissions, ResidencyCounts, School } from "../lib/types";
import type { CdsCode, CollegeRecord, DocumentRecord, ItemResult } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { FIELDS } from "../lib/fields.ts";
import { validateSchool } from "../lib/lineage.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import { mergeReported } from "../lib/reported-merge.ts";
import {
  RESIDENCY_CODES,
  RESIDENCY_COUNTS,
  RESIDENCY_GROUPS,
  checkGrid,
  mergeResidency,
  readGrid,
  residencyFromRecord,
  type ResidencyGrid,
} from "../lib/cds/residency.ts";
import {
  NOT_PUBLISHED,
  OUTSIDE_US,
  RESIDENCY_FILTERS,
  admissionsByResidency,
  admitRatesByResidency,
  compareAdmitRates,
  compareYields,
  rateForStudent,
  sameClassAdmitRate,
  yieldsByResidency,
} from "../lib/cds/residency-display.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string) => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);

/** The Illinois 2025–26 grid as its code table says (failed items' own values): the reading the spec rejects. */
function codeTableGrid(doc: DocumentRecord): ResidencyGrid {
  const grid = {} as ResidencyGrid;
  for (const g of RESIDENCY_GROUPS) {
    grid[g] = {} as ResidencyGrid[typeof g];
    for (const c of RESIDENCY_COUNTS) {
      const code = RESIDENCY_CODES[g][c];
      const v = doc.items[code]?.v;
      grid[g][c] = { v: typeof v === "number" ? v : null, from: "item", code };
    }
  }
  return grid;
}

const counts = (applicants: number | null, admitted: number | null, enrolled: number | null): ResidencyCounts => ({ applicants, admitted, enrolled });
const withBlock = (b: Partial<ReportedResidencyAdmissions>, state = "GA"): School =>
  ({
    location: { state },
    reported: {
      admissions_by_residency: {
        entering_term: "Fall 2025",
        year: 2025,
        edition: "2025-26",
        in_state: counts(null, null, null),
        out_of_state: counts(null, null, null),
        international: counts(null, null, null),
        unknown: counts(null, null, null),
        total: counts(null, null, null),
        ...b,
      },
    },
  }) as unknown as School;

/** A one-document record whose C1 grid cells are the given values (passed items with a cell and quote). */
function recordWith(values: Partial<Record<CdsCode, number | null>>, edition = "2025-26", extra: Partial<DocumentRecord> = {}): CollegeRecord {
  const items: Record<CdsCode, ItemResult> = {};
  for (const [code, v] of Object.entries(values)) {
    items[code] = v === null ? { status: "blank" } : { v, status: "passed", cell: `CDS-C!AC${code.slice(2)}`, quote: `x | ${v}` };
  }
  const fall = Number(edition.slice(0, 4));
  return {
    unit_id: "1",
    documents: [
      {
        sha256: `sha-${edition}`,
        edition,
        type: "xlsx-template",
        url: `https://example.edu/cds-${edition}.xlsx`,
        retrieved: "2026-10-03",
        reads: {},
        years: { fall: `Fall ${fall}` },
        items,
        ...extra,
      },
    ],
  } as unknown as CollegeRecord;
}

/** Georgia Tech-like grid (fall 2025 sample): 29.5% in-state, 10.1% other states, 7.3% international. */
const GT = {
  "C.116": 66000, "C.117": 8921, "C.118": 3700,
  "C.119": 14000, "C.120": 4130, "C.121": 2709,
  "C.122": 40000, "C.123": 4040, "C.124": 860,
  "C.125": 12000, "C.126": 750, "C.127": 131,
  "C.128": 0, "C.129": 0, "C.130": 0,
} satisfies Record<string, number>;

/* ------------------------------------------------------------------ */
/* 1–2. Illinois: code table vs visible grid                           */
/* ------------------------------------------------------------------ */

test("Illinois 2025–26: the code table fails residency-funnel and residency-vs-federal; the visible grid passes and is published with its cells", () => {
  const il = record("145637");
  const s = school("145637");
  const doc = il.documents[0];
  const code = checkGrid(codeTableGrid(doc), s.demographics.residence).map((f) => f.check);
  assert.ok(code.includes("residency-funnel"), code.join());
  assert.ok(code.includes("residency-vs-federal"), code.join());

  const { block, lineage } = residencyFromRecord(il, { admissionsYear: s.admissions.year, federal: s.demographics.residence });
  assert.ok(block, "the visible grid is merged");
  assert.deepEqual(block.in_state, { applicants: 29419, admitted: 14509, enrolled: 6587 });
  assert.deepEqual(block.out_of_state, { applicants: 32702, admitted: 9495, enrolled: 1210 });
  assert.deepEqual(block.international, { applicants: 20924, admitted: 6380, enrolled: 1410 });
  assert.deepEqual(block.total, { applicants: 83045, admitted: 30384, enrolled: 9207 });
  // Lineage points at the visible grid's cells for the disagreeing items, not the code table.
  assert.equal(lineage["reported.admissions_by_residency.in_state.admitted"].cell, "CDS-C!E38");
  assert.equal(lineage["reported.admissions_by_residency.out_of_state.applicants"].cell, "CDS-C!F37");
  assert.equal(lineage["reported.admissions_by_residency.in_state.admitted"].quote, "Total first-time, first-year who were admitted, In-State: 14,509");
});

test("Illinois without the visible grid's values (break: drop the grid read): nothing merged, the grid is failed", () => {
  const il = record("145637");
  for (const it of Object.values(il.documents[0].items)) delete it.form;
  const { block, outcomes } = residencyFromRecord(il);
  assert.equal(block, null);
  assert.equal(outcomes[0].status, "failed");
});

test("both sources fail (the visible grid is wrong too): one failed outcome for the edition, nothing merged", () => {
  const il = record("145637");
  il.documents[0].items["C.120"].form = { v: 40000, cell: "CDS-C!E38" }; // admitted > applied in the grid too
  const { block, outcomes } = residencyFromRecord(il);
  assert.equal(block, null);
  assert.deepEqual(outcomes.map((o) => [o.edition, o.status]), [["2025-26", "failed"]]);
  assert.ok(outcomes[0].failures.some((f) => f.check === "residency-funnel"));
});

/* ------------------------------------------------------------------ */
/* 3. Tags                                                             */
/* ------------------------------------------------------------------ */

test("codes map to the right columns: NRES is out-of-state, INTL international (never by the word 'nonresident')", () => {
  const tagPart: Record<string, string> = { in_state: "_STATE_", out_of_state: "_NRES_", international: "_INTL_", unknown: "_UNK_" };
  for (const g of ["in_state", "out_of_state", "international", "unknown"] as const) {
    for (const c of RESIDENCY_COUNTS) {
      const tag = CDS_TEMPLATE.byCode.get(RESIDENCY_CODES[g][c])?.tag ?? "";
      assert.ok(tag.includes(tagPart[g]), `${RESIDENCY_CODES[g][c]} ${tag} is ${g}`);
      assert.ok(tag.startsWith(c === "applicants" ? "AP_RECD" : c === "admitted" ? "AP_ADMT" : "EN_TOT"), `${tag} is ${c}`);
    }
  }
  assert.equal(CDS_TEMPLATE.byCode.get("C.125")?.residency, "Nonresidents", "the template's word for international");
});

/* ------------------------------------------------------------------ */
/* 5. Sums                                                             */
/* ------------------------------------------------------------------ */

test("residency-sum: Georgia Tech's 8,920 vs 8,921 passes; a 2% gap fails; a blank Unknown counts as 0", () => {
  const ok = readGrid(recordWith({ ...GT, "C.120": 4129, "C.128": null, "C.129": null, "C.130": null }).documents[0]).grid;
  assert.deepEqual(checkGrid(ok), []);
  const off = readGrid(recordWith({ ...GT, "C.123": 4040 + 180 }).documents[0]).grid;
  assert.deepEqual(checkGrid(off).map((f) => f.check), ["residency-sum"]);
});

test("a total printed as ## (no value) isn't sum-checked here (residency-total-unreadable is the checks track's)", () => {
  const g = readGrid(recordWith({ ...GT, "C.116": null, "C.117": null, "C.118": null }).documents[0]).grid;
  assert.deepEqual(checkGrid(g), []);
});

/* ------------------------------------------------------------------ */
/* 6. Blank vs zero                                                    */
/* ------------------------------------------------------------------ */

test("0 is stored, blank is null; an empty grid (William & Mary: totals only) merges nothing", () => {
  const vu = residencyFromRecord(record("221999")).block!;
  assert.deepEqual(vu.unknown, { applicants: 0, admitted: 0, enrolled: 0 });
  const il = residencyFromRecord(record("145637")).block!;
  assert.deepEqual(il.unknown, { applicants: 0, admitted: null, enrolled: null });
  const wm = residencyFromRecord(record("231624"));
  assert.equal(wm.block, null);
  assert.deepEqual(wm.outcomes.map((o) => o.status), ["blank"]);
});

test("Spelman-like enrolled-only grid: counts stored, rates null, no card", () => {
  const { block } = residencyFromRecord(recordWith({ "C.116": 9000, "C.117": 3000, "C.118": 648, "C.121": 147, "C.124": 496, "C.127": 5, "C.130": 0 }));
  assert.ok(block);
  assert.deepEqual(block.in_state, { applicants: null, admitted: null, enrolled: 147 });
  const s = withBlock(block);
  assert.deepEqual(admitRatesByResidency(s), { in_state: null, out_of_state: null, international: null });
  assert.equal(admissionsByResidency(s), null);
});

/* ------------------------------------------------------------------ */
/* 7. Year                                                             */
/* ------------------------------------------------------------------ */

test("the year is the record's fall (the grid heading), never a page header", () => {
  const rec = recordWith(GT);
  (rec.documents[0] as DocumentRecord & { header?: string }).header = "Common Data Set 2024-2025";
  const { block, lineage } = residencyFromRecord(rec);
  assert.equal(block!.entering_term, "Fall 2025");
  assert.equal(block!.year, 2025);
  assert.equal(lineage["reported.admissions_by_residency.in_state.applicants"].year, "Fall 2025");
});

/* ------------------------------------------------------------------ */
/* 8. Rates                                                            */
/* ------------------------------------------------------------------ */

test("rates: none under 10 applicants; yields none under 10 admits; Unknown is never a rate; the tick is the same document's C1", () => {
  const s = withBlock({ in_state: counts(9, 5, 3), out_of_state: counts(100, 40, 9), international: counts(50, 9, 4), unknown: counts(500, 400, 300), total: counts(659, 454, 316) });
  assert.deepEqual(admitRatesByResidency(s), { in_state: null, out_of_state: 0.4, international: 0.18 });
  assert.deepEqual(yieldsByResidency(s), { in_state: null, out_of_state: 0.225, international: null });
  assert.ok(!("unknown" in admitRatesByResidency(s)));
  assert.equal(sameClassAdmitRate(s), Math.round((454 / 659) * 10000) / 10000);
  // Illinois's headline funnel is the federal fall 2024 class; the tick uses the grid's own fall 2025 totals.
  const il = schools.find((x) => x.unit_id === "145637")!;
  assert.notEqual(il.admissions.year, il.reported!.admissions_by_residency!.year);
  assert.equal(sameClassAdmitRate(il), Math.round((30384 / 83045) * 10000) / 10000);
});

/* ------------------------------------------------------------------ */
/* 9. Merge window                                                     */
/* ------------------------------------------------------------------ */

test("merge window: a passed grid more than two falls older than admissions.year isn't merged", () => {
  const rec = recordWith(GT, "2021-22");
  assert.equal(residencyFromRecord(rec, { admissionsYear: 2025 }).block, null);
  assert.equal(residencyFromRecord(rec, { admissionsYear: 2023 }).block?.year, 2021);
});

test("merge window: a newer failed grid doesn't hide an older passed one inside the window", () => {
  const older = recordWith(GT, "2024-25").documents[0];
  const newer = recordWith({ ...GT, "C.120": 20000 }, "2025-26").documents[0]; // admitted > applied
  const rec = { unit_id: "1", documents: [newer, older] } as CollegeRecord;
  const { block, outcomes } = residencyFromRecord(rec, { admissionsYear: 2025 });
  assert.equal(block?.edition, "2024-25");
  assert.deepEqual(outcomes.map((o) => o.status), ["failed", "merged"]);
});

/* ------------------------------------------------------------------ */
/* 10. Lineage and the real merge                                      */
/* ------------------------------------------------------------------ */

test("data/schools.json carries the grid for Vanderbilt, Cornell, and Illinois, and none for William & Mary", () => {
  const block = (id: string) => schools.find((s) => s.unit_id === id)!.reported?.admissions_by_residency;
  assert.deepEqual(block("221999")?.in_state, { applicants: 2885, admitted: 301, enrolled: 234 });
  assert.deepEqual(block("190415")?.international, { applicants: 18566, admitted: 664, enrolled: 389 });
  assert.deepEqual(block("145637")?.in_state, { applicants: 29419, admitted: 14509, enrolled: 6587 });
  assert.equal(block("231624"), undefined);
  // The committed file is what a merge of the committed records gives (mergeReported is idempotent).
  const ids = ["221999", "190415", "231624", "145637"];
  const reported = JSON.parse(readFileSync(join(ROOT, "data", "college-reported.json"), "utf8"));
  const again = mergeReported(ids.map(school), reported, records).schools;
  for (const s of again) assert.equal(JSON.stringify(s), JSON.stringify(schools.find((x) => x.unit_id === s.unit_id)), s.name);
});

test("lineage: every stored leaf has an extracted record; dropping one fails the lineage check", () => {
  const vu = school("221999");
  assert.deepEqual(validateSchool(vu, meta), []);
  delete vu.lineage!["reported.admissions_by_residency.out_of_state.admitted"];
  assert.ok(validateSchool(vu, meta).some((e) => e.includes("reported.admissions_by_residency.out_of_state.admitted is stored without a lineage record")));
});

test("mergeResidency is idempotent and removes a block whose record is gone", () => {
  const vu = school("221999");
  // deepEqual, not JSON text: a later sibling block (e.g. reported.transfer, cds-transfer.md) may follow this one.
  assert.deepEqual(mergeResidency(vu, record("221999")), vu);
  const gone = mergeResidency(vu, undefined);
  assert.equal(gone.reported?.admissions_by_residency, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith("reported.admissions_by_residency")));
  assert.ok(gone.reported?.admissions, "the admissions block stays");
});

/* ------------------------------------------------------------------ */
/* 11. Partial-coverage guard                                          */
/* ------------------------------------------------------------------ */

const RESIDENCY_FIELD = /admissions_by_residency|admit_rate_(in_state|out_of_state|international|for_student|same_class)|yield_(in_state|out_of_state|international)|residency-display|cds\/residency/;

test("partial coverage: no METRICS entry, distribution, rank, sort, radar axis, Key difference, Known-for, or Home fact uses residency fields", () => {
  // These modules feed ranks, medians, percentile strips, Explore sorts, the radar, Key differences, "Known for", and
  // Home facts. Only lib/dataset.ts may name the residency module, for its boolean filters.
  for (const f of ["lib/metrics.ts", "lib/insights.ts", "lib/indicators.ts", "lib/history.ts", "app/page.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!RESIDENCY_FIELD.test(src), `${f} uses a residency field`);
  }
  const dataset = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const sorters = dataset.slice(dataset.indexOf("const SORTERS"), dataset.indexOf("};", dataset.indexOf("const SORTERS")));
  assert.ok(sorters.length > 100 && !RESIDENCY_FIELD.test(sorters), "an Explore sort uses a residency field");
  const outside = dataset.replace(/^.*RESIDENCY_FILTERS.*$/gm, "");
  assert.ok(!RESIDENCY_FIELD.test(outside), "lib/dataset.ts uses a residency field outside its filters");
  // The registered derived fields exist and are computed (never stored).
  for (const k of ["derived.admit_rate_in_state", "derived.admit_rate_out_of_state", "derived.admit_rate_international", "derived.yield_in_state", "derived.yield_out_of_state", "derived.yield_international", "derived.admit_rate_for_student"] as const) {
    assert.equal((FIELDS[k] as { computed?: true }).computed, true, k);
  }
});

/* ------------------------------------------------------------------ */
/* 12. For you                                                         */
/* ------------------------------------------------------------------ */

test("for you: same state → in-state; other state → out-of-state; outside the U.S. → international; no grid → not published, never the overall rate", () => {
  const s = withBlock({ in_state: counts(1000, 295, 100), out_of_state: counts(1000, 101, 30), international: counts(1000, 73, 20) }, "GA");
  assert.deepEqual(rateForStudent(s, "GA"), { group: "in_state", rate: 0.295 });
  assert.deepEqual(rateForStudent(s, "ga"), { group: "in_state", rate: 0.295 });
  assert.deepEqual(rateForStudent(s, "TX"), { group: "out_of_state", rate: 0.101 });
  assert.deepEqual(rateForStudent(s, OUTSIDE_US), { group: "international", rate: 0.073 });
  const none = { location: { state: "VA" }, admissions: { acceptance_rate: 0.37 } } as unknown as School;
  assert.equal(rateForStudent(none, "VA").rate, null);
  assert.equal(compareAdmitRates(none), NOT_PUBLISHED);
  assert.equal(compareYields(none), NOT_PUBLISHED);
});

/* ------------------------------------------------------------------ */
/* 13. Insight                                                         */
/* ------------------------------------------------------------------ */

test("insight: Georgia Tech is notable; 43% vs 44% gets the one line; the (you) marker only with a profile state", () => {
  const gt = withBlock(residencyFromRecord(recordWith(GT)).block!, "GA");
  const r = admissionsByResidency(gt)!;
  assert.equal(r.notable, true);
  assert.equal(r.sentence, "Georgia applicants were admitted at 30%, applicants from other states at 10%, and international applicants at 6.3%.");
  assert.deepEqual(r.shown, ["in_state", "out_of_state", "international"]);
  assert.equal(r.you, null);
  assert.equal(admissionsByResidency(gt, "GA")!.you, "in_state");
  assert.equal(admissionsByResidency(gt, "NY")!.you, "out_of_state");

  const even = withBlock({ in_state: counts(1000, 430, 100), out_of_state: counts(1000, 440, 80) }, "OH");
  const e = admissionsByResidency(even)!;
  assert.equal(e.notable, false);
  assert.equal(e.sentence, "Applicants from Ohio and from other states were admitted at similar rates (43% and 44%).");

  // Small groups don't make a gap notable (UW–Eau Claire's international rate on 58 applicants).
  const small = withBlock({ in_state: counts(4614, 1790, 1158), out_of_state: counts(2113, 784, 571), international: counts(58, 41, 10) }, "WI");
  assert.equal(admissionsByResidency(small)!.notable, false);

  // Real colleges: Vanderbilt (10.4% vs 5.3%) and Cornell (through its 3.6% international rate) are notable.
  assert.equal(admissionsByResidency(schools.find((s) => s.unit_id === "221999")!)!.notable, true);
  assert.equal(admissionsByResidency(schools.find((s) => s.unit_id === "190415")!)!.notable, true);
});

test("Compare cells: three values per college, '–' for a missing one", () => {
  const s = withBlock({ in_state: counts(1000, 295, 100), out_of_state: counts(1000, 101, 30), international: counts(5, 3, 1) });
  assert.equal(compareAdmitRates(s), "30% / 10% / –");
  assert.equal(compareYields(s), "34% / 30% / –");
});

/* ------------------------------------------------------------------ */
/* Explore                                                             */
/* ------------------------------------------------------------------ */

test("Explore: byRes and oosEven parse, count as filters, and match only colleges with a grid", () => {
  const f = parseFilters({ byRes: "1", oosEven: "1" });
  assert.deepEqual([f.byRes, f.oosEven], [true, true]);
  assert.equal(countActiveFilters({ byRes: "1", oosEven: "1" }), 2);
  const [byRes, oosEven] = RESIDENCY_FILTERS;
  assert.deepEqual(schools.filter(byRes.test).map((s) => s.unit_id).sort(), ["145637", "190415", "221999"]);
  // Out-of-state at least the in-state rate minus 5 points, 200+ applicants each: Cornell (9.0% vs 13.3%) does;
  // Vanderbilt (5.3% vs 10.4%) and Illinois (29.0% vs 49.3%) don't.
  assert.deepEqual(schools.filter(oosEven.test).map((s) => s.unit_id), ["190415"]);
  const even = withBlock({ in_state: counts(1000, 430, 100), out_of_state: counts(1000, 400, 80) });
  assert.equal(oosEven.test(even), true);
  const tiny = withBlock({ in_state: counts(1000, 430, 100), out_of_state: counts(150, 100, 80) });
  assert.equal(oosEven.test(tiny), false, "under 200 out-of-state applicants");
});
