/**
 * CDS transfer admission (specs/data-expansion/cds-transfer.md): the record → block read, its per-group checks (D1
 * consistency and inference, D2 arithmetic and funnel, D2 vs the federal transfer-in count, D5 one mark per row, D9
 * dates), lineage, the card model, Compare's cell, Explore's "Admits transfers" filter with its federal fallback, and
 * the partial-coverage guard. Real records: data/cds-records/{221999,190415,231624,145637}.json. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { CdsCode, CollegeRecord, ItemResult } from "../lib/cds-sections.ts";
import { FIELDS } from "../lib/fields.ts";
import { validateSchool } from "../lib/lineage.ts";
import { countActiveFilters, parseFilters } from "../lib/params.ts";
import {
  TRANSFER_LINEAGE_PREFIX,
  checkFunnel,
  inOrder,
  mergeTransfer,
  parseRequirement,
  transferAdmitRate,
  transferFromRecord,
  type TransferFunnel,
} from "../lib/cds/transfer.ts";
import { admitsTransfers, compareTransferAdmitRate, datesSentence, transferCard } from "../lib/cds/transfer-display.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const records = readRecords(join(ROOT, "data", "cds-records"));
const record = (id: string) => structuredClone(records.find((r) => r.unit_id === id)!);
const school = (id: string) => structuredClone(schools.find((s) => s.unit_id === id)!);

/** A one-document record whose items are the given passed values (workbook cells with quotes). */
function recordWith(values: Partial<Record<CdsCode, number | string | boolean | null>>): CollegeRecord {
  const items: Record<CdsCode, ItemResult> = {};
  for (const [code, v] of Object.entries(values)) {
    items[code] = v === null ? { status: "blank" } : { v, status: "passed", cell: `CDS-D!B${code.slice(2)}`, quote: `x | ${v}` };
  }
  return {
    unit_id: "1",
    documents: [
      {
        sha256: "sha",
        edition: "2025-26",
        type: "xlsx-template",
        url: "https://example.edu/cds.xlsx",
        retrieved: "2026-10-03",
        reads: {},
        years: { edition: "2025–26", fall: "Fall 2025", "next-cycle": "Fall 2026 cycle" },
        items,
      },
    ],
  } as unknown as CollegeRecord;
}

/** A clean D2 grid: 1,000 applied (600/400), 200 admitted (120/80), 100 enrolled (60/40). */
const D2 = {
  "D.201": 600, "D.202": 400, "D.203": 0, "D.204": 1000,
  "D.205": 120, "D.206": 80, "D.207": 0, "D.208": 200,
  "D.209": 60, "D.210": 40, "D.211": 0, "D.212": 100,
} satisfies Record<string, number>;

/* ------------------------------------------------------------------ */
/* Real records                                                        */
/* ------------------------------------------------------------------ */

test("the four 2025–26 template workbooks: funnel, rate, terms, credits, materials, and dates", () => {
  const fed = (id: string) => school(id).demographics.transfer_in?.count ?? null;
  const cornell = transferFromRecord(record("190415"), { federalCount: fed("190415") });
  assert.deepEqual(cornell.outcome.failures, []);
  assert.deepEqual(cornell.block!.applicants, { men: 4391, women: 2989, unknown: 1, total: 7381 });
  assert.equal(cornell.block!.admitted!.total, 864);
  assert.equal(cornell.block!.enrolled!.total, 625);
  assert.equal(cornell.block!.admit_rate, 0.1171);
  assert.deepEqual(cornell.block!.terms, ["fall"]);
  assert.equal(cornell.block!.required_materials!.interview, "required_some");
  assert.equal(cornell.block!.min_college_gpa, null, "Cornell writes \"No minimum required\": not a minimum");
  assert.deepEqual(cornell.block!.dates, { fall: { priority: null, closing: { month: 3, day: 15 }, notification: "rolling", reply: { month: 7, day: 1 } } });

  const vu = transferFromRecord(record("221999"), { federalCount: fed("221999") }).block!;
  assert.equal(vu.admit_rate, 0.2616);
  assert.equal(vu.min_credits, 12);
  assert.equal(vu.required_materials!.high_school_transcript, "recommended");
  assert.equal(vu.dates, null);

  const wm = transferFromRecord(record("231624"), { federalCount: fed("231624") }).block!;
  assert.deepEqual(wm.terms, ["fall", "spring"]);
  assert.equal(wm.admit_rate, 0.4569);
  assert.deepEqual(wm.dates!.spring, { priority: null, closing: { month: 11, day: 1 }, notification: null, reply: null });

  const il = transferFromRecord(record("145637"), { federalCount: fed("145637") }).block!;
  assert.deepEqual(il.terms, ["fall", "spring", "summer"]);
  assert.equal(il.admit_rate, 0.4341);
});

test("years: D2 is the document's fall, D9 the next cycle, everything else the edition", () => {
  const { lineage } = transferFromRecord(record("190415"));
  assert.equal(lineage["reported.transfer.applicants"].year, "Fall 2025");
  assert.equal(lineage["reported.transfer.admit_rate"].year, "Fall 2025");
  assert.equal(lineage["reported.transfer.admit_rate"].method, "derived");
  assert.equal(lineage["reported.transfer.dates"].year, "Fall 2026 cycle");
  assert.equal(lineage["reported.transfer.terms"].year, "2025–26");
  for (const rec of Object.values(lineage)) {
    assert.equal(rec.source, "college-site");
    assert.ok(rec.quote && rec.quote.length <= 160 && rec.url && rec.retrieved && rec.edition === "2025–26");
  }
});

test("data/schools.json carries the merged block for all four colleges, and every merged school validates", () => {
  for (const [id, rate] of [["221999", 0.2616], ["190415", 0.1171], ["231624", 0.4569], ["145637", 0.4341]] as const) {
    const s = school(id);
    assert.equal(s.reported?.transfer?.admit_rate, rate, id);
    assert.deepEqual(validateSchool(s, meta), [], id);
  }
});

/* ------------------------------------------------------------------ */
/* D1                                                                  */
/* ------------------------------------------------------------------ */

test("D1 blank with D2 filled (Illinois's pattern) is inferred true, not flagged, and the lineage says so", () => {
  const r = transferFromRecord(record("145637"));
  assert.equal(r.block!.enrolls_transfers, true);
  assert.equal(r.outcome.inferredEnrolls, true);
  assert.deepEqual(r.outcome.failures, []);
  const rec = r.lineage["reported.transfer.enrolls_transfers"];
  assert.equal(rec.method, "derived");
  assert.match(rec.quote!, /D1 left blank; inferred from D2/);
});

test("D1 \"No\" with D2 transfer applicants is a document inconsistency: D1 dropped, D2 kept", () => {
  const r = transferFromRecord(recordWith({ "D.101": false, ...D2 }));
  assert.deepEqual(r.outcome.failures.map((f) => f.check), ["transfer-d1-consistency"]);
  assert.equal(r.block!.enrolls_transfers, null);
  assert.equal(r.block!.admit_rate, 0.2);
  // A college that says no and reports no applicants: a plain "no".
  const no = transferFromRecord(recordWith({ "D.101": false }));
  assert.equal(no.block!.enrolls_transfers, false);
  assert.deepEqual(no.outcome.failures, []);
});

/* ------------------------------------------------------------------ */
/* D2                                                                  */
/* ------------------------------------------------------------------ */

test("D2 arithmetic: men + women + unknown must equal the total (±1); a planted mismatch drops all of D2", () => {
  assert.deepEqual(transferFromRecord(recordWith(D2)).outcome.failures, []);
  assert.deepEqual(transferFromRecord(recordWith({ ...D2, "D.201": 601 })).outcome.failures, [], "off by one is rounding");
  const broken = transferFromRecord(recordWith({ "D.101": true, ...D2, "D.201": 650 }));
  assert.deepEqual(broken.outcome.failures.map((f) => f.check), ["transfer-d2-sum"]);
  assert.equal(broken.block!.applicants, null);
  assert.equal(broken.block!.admit_rate, null);
  assert.ok(!broken.lineage["reported.transfer.applicants"]);
  // Only the total printed: no sum to check.
  assert.deepEqual(checkFunnel({ applicants: { men: null, women: null, unknown: null, total: 50 }, admitted: null, enrolled: null }), []);
});

test("D2 funnel: enrolled ≤ admitted ≤ applicants, for the total and each sex", () => {
  const f = (over: Partial<TransferFunnel>): TransferFunnel => ({
    applicants: { men: 600, women: 400, unknown: 0, total: 1000 },
    admitted: { men: 120, women: 80, unknown: 0, total: 200 },
    enrolled: { men: 60, women: 40, unknown: 0, total: 100 },
    ...over,
  });
  assert.deepEqual(checkFunnel(f({})), []);
  const women = checkFunnel(f({ enrolled: { men: 10, women: 90, unknown: 0, total: 100 } }));
  assert.deepEqual(women.map((x) => x.check), ["transfer-d2-funnel"]);
  assert.match(women[0].detail, /women: enrolled 90 > admitted 80/);
  assert.ok(checkFunnel(f({ admitted: { men: 700, women: 400, unknown: 0, total: 1100 } })).some((x) => x.check === "transfer-d2-funnel"));
});

test("D2 vs federal: the enrolled total must be within 25% of demographics.transfer_in.count; a planted mismatch is caught", () => {
  // Real: Vanderbilt 446 vs 359, Cornell 625 vs 503 (both just inside), William & Mary 206 vs 183, Illinois 1,682 vs 1,547.
  for (const id of ["221999", "190415", "231624", "145637"]) {
    const fed = school(id).demographics.transfer_in!.count;
    assert.deepEqual(transferFromRecord(record(id), { federalCount: fed }).outcome.failures, [], id);
  }
  const planted = transferFromRecord(recordWith({ "D.101": true, ...D2 }), { federalCount: 300 });
  assert.deepEqual(planted.outcome.failures.map((f) => f.check), ["transfer-d2-vs-federal"]);
  assert.equal(planted.block!.enrolled, null);
  assert.deepEqual(transferFromRecord(recordWith(D2), { federalCount: 80 }).outcome.failures, [], "100 vs 80 is within 25%");
  assert.deepEqual(transferFromRecord(recordWith(D2), { federalCount: null }).outcome.failures, [], "no federal count: no check");
});

test("the admit rate needs at least 10 admits", () => {
  const c = (total: number) => ({ men: null, women: null, unknown: null, total });
  assert.equal(transferAdmitRate(c(1000), c(10)), 0.01);
  assert.equal(transferAdmitRate(c(1000), c(9)), null);
  assert.equal(transferAdmitRate(c(0), c(0)), null);
  assert.equal(transferAdmitRate(null, c(20)), null);
});

/* ------------------------------------------------------------------ */
/* D5                                                                  */
/* ------------------------------------------------------------------ */

test("D5 one mark per row: zero and double marks fail that row only", () => {
  assert.deepEqual(parseRequirement("Required of All"), { level: "required" });
  assert.deepEqual(parseRequirement("Required of Some"), { level: "required_some" });
  assert.deepEqual(parseRequirement("Recommended of Some"), { level: "recommended_some" });
  assert.deepEqual(parseRequirement("Not Required"), { level: "not_required" });
  assert.deepEqual(parseRequirement(""), { failure: "zero" });
  assert.deepEqual(parseRequirement("X"), { failure: "zero" }, "a mark with no level named is no mark");
  assert.deepEqual(parseRequirement("Required of All Not Required"), { failure: "multiple" });
  assert.deepEqual(parseRequirement("Required of All; Recommended of All"), { failure: "multiple" });

  const grid = { "D.501": "Required of All", "D.502": "Required of All", "D.503": "Required of All; Not Required", "D.504": null, "D.505": "Not Required", "D.506": "Required of All" };
  const r = transferFromRecord(recordWith(grid));
  assert.deepEqual(r.outcome.failures.map((f) => [f.check, f.detail.slice(0, 9)]), [["transfer-d5-mark", "Essay or "], ["transfer-d5-mark", "Interview"]]);
  assert.equal(r.block!.required_materials!.essay, null);
  assert.equal(r.block!.required_materials!.interview, null);
  assert.equal(r.block!.required_materials!.college_transcript, "required");
  // An unanswered grid is not a failure: it's just not there.
  assert.deepEqual(transferFromRecord(recordWith({ ...D2 })).block!.required_materials, null);
});

/* ------------------------------------------------------------------ */
/* D9                                                                  */
/* ------------------------------------------------------------------ */

test("D9: an impossible date or a closing date before the priority date drops that term only", () => {
  const bad = transferFromRecord(recordWith({ "D.901": 2, "D.902": 30, "D.909": 3, "D.910": 1, "D.913": 11, "D.914": 1 }));
  assert.deepEqual(bad.outcome.failures.map((f) => f.check), ["transfer-d9-date"]);
  assert.deepEqual(Object.keys(bad.block!.dates!), ["spring"]);
  const order = transferFromRecord(recordWith({ "D.901": 3, "D.902": 1, "D.909": 2, "D.910": 1 }));
  assert.deepEqual(order.outcome.failures.map((f) => f.check), ["transfer-d9-order"]);
  assert.equal(order.block, null);
  // A reply date before notification fails unless the term is rolling.
  assert.deepEqual(transferFromRecord(recordWith({ "D.917": 5, "D.918": 1, "D.925": 4, "D.926": 1 })).outcome.failures.map((f) => f.check), ["transfer-d9-order"]);
  assert.deepEqual(transferFromRecord(recordWith({ "D.917": 5, "D.918": 1, "D.925": 4, "D.926": 1, "D.933": true })).outcome.failures, []);
  // A window over the new year is in order.
  assert.ok(inOrder({ month: 12, day: 1 }, { month: 3, day: 1 }));
  assert.ok(!inOrder({ month: 3, day: 1 }, { month: 2, day: 1 }));
  assert.equal(datesSentence("fall", { priority: null, closing: { month: 3, day: 15 }, notification: "rolling", reply: { month: 7, day: 1 } }), "Fall entry: apply by March 15, decisions on a rolling basis, reply by July 1");
});

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

test("mergeTransfer is idempotent and removes a block whose record is gone", () => {
  const s = school("190415");
  assert.deepEqual(mergeTransfer(s, record("190415")), s);
  const gone = mergeTransfer(s, undefined);
  assert.equal(gone.reported?.transfer, undefined);
  assert.ok(!Object.keys(gone.lineage ?? {}).some((k) => k.startsWith(TRANSFER_LINEAGE_PREFIX)));
  assert.deepEqual(validateSchool(gone, meta), []);
});

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

test("the card: shown with D1 or a rate; the two rates side by side; a college that doesn't enroll transfers gets one line", () => {
  const m = transferCard(school("190415"))!;
  // Cornell's first-year rate is 8.38% (its own document's class).
  assert.equal(m.rateSentence, "12% of transfer applicants were admitted, vs. 8.4% of first-year applicants");
  assert.equal(m.termsSentence, "Transfers may start in the fall.");
  assert.equal(transferCard(school("221999"))!.creditsSentence, "At least 12 credits completed to apply as a transfer.");
  assert.equal(transferCard(school("231624"))!.termsSentence, "Transfers may start in the fall and spring.");
  assert.equal(transferCard(school("145637"))!.termsSentence, "Transfers may start in the fall, spring, and summer.");
  const none = { admissions: { acceptance_rate: 0.5 }, reported: { transfer: { enrolls_transfers: false, admit_rate: null } } } as unknown as School;
  assert.equal(transferCard(none)!.enrolls, false);
  assert.equal(transferCard({ admissions: { acceptance_rate: 0.5 } } as unknown as School), null);
  assert.equal(transferCard({ admissions: {}, reported: { transfer: { enrolls_transfers: null, admit_rate: null } } } as unknown as School), null);
});

test("Compare: the transfer acceptance rate, blank (null, never 0) without data", () => {
  assert.equal(compareTransferAdmitRate(school("190415")), "12%");
  assert.equal(compareTransferAdmitRate({} as School), null);
  assert.equal(compareTransferAdmitRate({ reported: { transfer: { admit_rate: null } } } as unknown as School), null);
});

test("Explore \"Admits transfers\": the CDS answer first, else the federal transfer-in count", () => {
  const mk = (cds: boolean | null | undefined, fed: number | null) =>
    ({ reported: cds === undefined ? undefined : { transfer: { enrolls_transfers: cds } }, demographics: { transfer_in: fed === null ? null : { count: fed } } }) as unknown as School;
  assert.equal(admitsTransfers(mk(true, 0)), true);
  assert.equal(admitsTransfers(mk(false, 50)), false, "the college's own \"no\" wins");
  assert.equal(admitsTransfers(mk(undefined, 50)), true, "federal fallback");
  assert.equal(admitsTransfers(mk(null, 50)), true, "D1 dropped: federal fallback");
  assert.equal(admitsTransfers(mk(undefined, 0)), false);
  assert.equal(admitsTransfers(mk(undefined, null)), false);
  assert.equal(parseFilters({ transfers: "1" }).transfers, true);
  assert.equal(parseFilters({}).transfers, undefined);
  assert.equal(countActiveFilters({ transfers: "1" }), 1);
  // Most colleges match through the federal count.
  assert.ok(schools.filter(admitsTransfers).length > 1500);
});

/* ------------------------------------------------------------------ */
/* Partial-coverage guard                                              */
/* ------------------------------------------------------------------ */

const TRANSFER_FIELD = /reported\??\.transfer|reported\.transfer|transfer-display|cds\/transfer|admitsTransfers|TRANSFER_FILTER/;

test("partial coverage: reported.transfer never reaches METRICS, rankOf, a percentile, a median, a sort, or Home facts", () => {
  // The pattern catches the ways code would reach the block (proved here so the guard can't silently match nothing).
  for (const planted of ["s.reported?.transfer?.admit_rate", "school.reported.transfer", 'import { x } from "./cds/transfer.ts"', "admitsTransfers(s)"]) {
    assert.ok(TRANSFER_FIELD.test(planted), planted);
  }
  for (const f of ["lib/metrics.ts", "lib/insights.ts", "lib/indicators.ts", "lib/history.ts", "lib/compare.ts", "app/page.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!TRANSFER_FIELD.test(src), `${f} uses a CDS transfer field`);
  }
  // lib/dataset.ts may name the module only for the boolean filter.
  const dataset = readFileSync(join(ROOT, "lib", "dataset.ts"), "utf8");
  const sorters = dataset.slice(dataset.indexOf("const SORTERS"), dataset.indexOf("};", dataset.indexOf("const SORTERS")));
  assert.ok(sorters.length > 100 && !TRANSFER_FIELD.test(sorters), "an Explore sort uses a transfer field");
  const outside = dataset.replace(/^.*TRANSFER_FILTER.*$/gm, "");
  assert.ok(!TRANSFER_FIELD.test(outside), "lib/dataset.ts uses a transfer field outside its filter");
  // Stored fields are registered and never computed into a rank.
  for (const k of ["reported.transfer.admit_rate", "reported.transfer.applicants", "reported.transfer.dates"] as const) {
    assert.equal(FIELDS[k].source, "college-site", k);
  }
});
