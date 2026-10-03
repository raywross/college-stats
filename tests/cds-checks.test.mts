/**
 * Round 3's checks on every record item (lib/cds-checks.ts; specs/college-reported-round-3.md Decision 9, tests 9,
 * 16, 17, 18): each per-item check passes on the real committed records and fails, on exactly its own codes, when one
 * value is broken; deterministic-read failures are never escalated and never count toward the breaker; the review
 * queue is keyed per college + edition + code. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { CdsCode, DocumentRecord, ItemResult } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { indexRecords, newestPassed } from "../lib/cds-records.ts";
import {
  applyChecks,
  c7Level,
  circuitBreakerV3,
  coverEdition,
  dropPassed,
  escalationFor,
  ESCALATE,
  failedC1Count,
  federalBaseline,
  itemFailureShares,
  reviewItemsFor,
  runItemChecks,
  valueOnLine,
  type CheckContext,
  type FederalBaseline,
} from "../lib/cds-checks.ts";
import { enqueueItems, REPORTED_MODELS, type ReviewItem, type ReviewQueueFile, type RunSummary } from "../lib/reported.ts";
import { restoreFederal } from "../lib/newest.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";
import { perItemTable, prBody } from "../scripts/college-reported-pr-body.mts";

const ROOT = join(import.meta.dirname, "..");
const T = CDS_TEMPLATE;
const records = indexRecords(readRecords(join(ROOT, "data", "cds-records")));
const schools = new Map((JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[]).map((s) => [s.unit_id, s]));

const VU = "221999";
const CU = "190415";
const WM = "231624";
const IL = "145637";

/** A fresh copy of a college's committed (already checked) 2025–26 document. */
const doc = (id: string): DocumentRecord => structuredClone(records.get(id)!.documents[0]);
const school = (id: string) => restoreFederal(schools.get(id)!);
const ctx = (id: string, over: Partial<CheckContext> = {}): CheckContext => ({ table: T, school: school(id), ...over });
const fed = (id: string, over: Partial<FederalBaseline>): FederalBaseline => ({ ...federalBaseline(school(id)), ...over });

/** Sets a value as a deterministic read would (cell kept). */
function set(d: DocumentRecord, code: CdsCode, v: ItemResult["v"]) {
  const it = d.items[code];
  d.items[code] = { ...it, v, status: "passed", cell: it.cell ?? `TEST!${code}` };
  delete d.items[code].failures;
}

/**
 * The failures a change adds (to the document, or to the federal baseline via `over`): code → check ids not present on
 * the unbroken document with the real baseline. Only codes with a value: a blank code is never marked failed.
 */
function added(id: string, edit: (d: DocumentRecord) => void, over: Partial<CheckContext> = {}): Map<CdsCode, Set<string>> {
  const base = runItemChecks(doc(id), ctx(id)).byCode;
  const d = doc(id);
  edit(d);
  const now = runItemChecks(d, ctx(id, over)).byCode;
  const out = new Map<CdsCode, Set<string>>();
  for (const [code, list] of Object.entries(now)) {
    if (d.items[code]?.v === undefined) continue;
    const was = new Set((base[code] ?? []).map((f) => `${f.check}|${f.detail}`));
    const fresh = list.filter((f) => !was.has(`${f.check}|${f.detail}`)).map((f) => f.check);
    if (fresh.length) out.set(code, new Set(fresh));
  }
  return out;
}

/** Asserts a change fails exactly `codes`, each with `check` among its new failures. */
function failsExactly(id: string, edit: (d: DocumentRecord) => void, check: string, codes: CdsCode[], over: Partial<CheckContext> = {}) {
  const got = added(id, edit, over);
  assert.deepEqual([...got.keys()].sort(), [...codes].sort(), `codes failing ${check}`);
  for (const k of codes) assert.ok(got.get(k)!.has(check), `${k} fails ${check} (got ${[...got.get(k)!].join(", ")})`);
}

const failedCodes = (d: DocumentRecord) => Object.keys(d.items).filter((k) => d.items[k].status === "failed").sort();
const range = (s: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `${s}.${a + i}`);

/* ---- The committed records: checked, idempotent, and failing only where the colleges' files are wrong ---- */

test("the committed records are already checked: applying the checks again changes nothing", () => {
  for (const id of [VU, CU, WM, IL]) assert.deepEqual(applyChecks(doc(id), ctx(id, { others: records.get(id)!.documents })), doc(id), id);
});

test("the committed records fail exactly where the colleges' own files are wrong", () => {
  assert.deepEqual(failedCodes(doc(VU)), ["B.2201"]); // 0.97 typed into a count
  assert.deepEqual(failedCodes(doc(CU)), ["G.001"]); // "89*---31" isn't a URL
  assert.deepEqual(failedCodes(doc(WM)), []);
  assert.deepEqual(failedCodes(doc(IL)), [...range("B", 221, 230), "B.2203", "C.110", "C.111", "C.112", "C.113"].sort());
  assert.equal(doc(IL).items["B.230"].failures![0].check, "column-3-not-all-undergrads");
  assert.equal(doc(IL).items["B.2203"].failures![0].check, "edition-mismatch"); // its label says "Fall 2025 entering cohort"
  // W&M's recommended-units total was blank with its subjects filled: summed from the parts.
  const wm = doc(WM).items["C.513"];
  assert.deepEqual([wm.v, wm.method, wm.status], [20, "derived", "passed"]);
});

/* ---- Test 9: checks on deterministic reads; never escalated; never counted ---- */

test("9: 0.97 in a count, in-state admits above applicants, and B2 column 3 below B1 each fail, unescalated and uncounted", () => {
  // Vanderbilt's B22 cohort.
  const vu = applyChecks(doc(VU), ctx(VU));
  assert.equal(vu.items["B.2201"].status, "failed");
  assert.equal(vu.items["B.2201"].failures![0].check, "type-range");
  // Illinois's code table without its visible grid: in-state admitted 32,702 > applied 29,419.
  const il = doc(IL);
  for (const k of ["C.120", "C.121", "C.122", "C.125"]) {
    const it = il.items[k];
    il.items[k] = it.code_table!.v === null ? { status: "blank" } : { v: it.code_table!.v, status: "passed", cell: it.code_table!.cell, quote: it.code_table!.quote };
  }
  const ilChecked = applyChecks(il, ctx(IL));
  for (const k of range("C", 119, 130).filter((k) => ilChecked.items[k].v !== undefined)) {
    assert.equal(ilChecked.items[k].status, "failed", k);
    assert.ok(ilChecked.items[k].failures!.some((f) => f.check === "residency-funnel"), k);
  }
  assert.equal(ilChecked.items["C.116"].status, "passed"); // the grid's failure never touches C1's totals
  // Illinois's B2 column 3 (non-degree students only).
  assert.equal(ilChecked.items["B.230"].failures![0].check, "column-3-not-all-undergrads");
  assert.equal(ilChecked.items["B.220"].status, "passed"); // column 2 publishes
  for (const d of [vu, ilChecked]) {
    assert.deepEqual(escalationFor(d, T), []);
    assert.deepEqual(itemFailureShares([d], T), []);
  }
  assert.equal(failedC1Count([{ unit_id: IL, documents: [ilChecked] }], T), 0);
});

/* ---- Universal checks ---- */

test("universal: type-range, form-vs-code (and its resolution), aid-year", () => {
  failsExactly(WM, (d) => set(d, "C.1201", 6.2), "type-range", ["C.1201"]);
  // A visible form that also fails its group's checks isn't published: the code-table value stays, failed.
  const cu = doc(CU);
  cu.items["C.2111"] = { v: 10057, status: "failed", cell: "CDS-C!AC272", form: { v: 20000, cell: "CDS-C!E327" } };
  const r = runItemChecks(cu, ctx(CU));
  assert.deepEqual(r.resolved.filter((k) => k === "C.2111"), []);
  assert.ok(r.byCode["C.2111"].some((f) => f.check === "form-vs-code"));
  // An aid-year item in a document whose H.101 names no aid year.
  failsExactly(WM, (d) => delete d.years["aid-year"], "aid-year", Object.keys(doc(WM).items).filter((k) => T.byCode.get(k)!.year_rule === "aid-year" && doc(WM).items[k].v !== undefined));
});

test("universal: an item's own text must name the edition's year (B22, H4, I-2)", () => {
  failsExactly(WM, (d) => (d.items["I.201"].quote = "Fall 2024 Student to Faculty ratio | 11"), "edition-mismatch", ["I.201"]);
  failsExactly(VU, (d) => (d.items["H.401"].quote = "Provide the number of students in the 2023 undergraduate class who started … | 1561"), "edition-mismatch", ["H.401"]);
});

/** A small model-read (flattened PDF) document with its numbered line text. */
function modelDoc(): { d: DocumentRecord; lines: string[] } {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  lines[0] = "Common Data Set 2025-2026";
  lines[9] = "Total first-time, first-year who applied | 48,196";
  lines[10] = "Total first-time, first-year who were admitted | 2,593";
  lines[11] = "Total first-time, first-year who enrolled | 1,635";
  lines[14] = "Amount of application fee: | $85";
  lines[18] = "Does your institution offer an early decision plan? | Yes";
  lines[19] = "Number of early decision applications received | 6,202";
  lines[20] = "Number of applicants admitted under early decision plan | 9,000";
  lines[24] = "Fall 2025 Student to Faculty ratio | 9";
  lines[25] = "based on 7,329 students | and 935 faculty";
  lines[29] = "students who entered in Fall 2024 | 0.97";
  lines[30] = "Percent Submitting SAT Scores 24%";
  const at = (v: ItemResult["v"], line: number, page = 7): ItemResult => ({ v, status: "passed", page, line, quote: lines[line - 1] });
  const d: DocumentRecord = {
    sha256: "f".repeat(64),
    edition: "2025-26",
    type: "pdf-flat",
    url: "https://example.edu/cds.pdf",
    retrieved: "2026-10-03",
    reads: {
      C: { schema_version: 1, read_by: "claude-haiku-4-5", mode: "batch", extracted: "2026-10-03", pages: [7, 12] },
      rest: { schema_version: 1, read_by: "claude-haiku-4-5", mode: "batch", extracted: "2026-10-03", pages: [1, 30] },
    },
    years: { fall: "Fall 2025", "next-cycle": "Fall 2026 cycle", retention: "Fall 2024 cohort to Fall 2025", edition: "2025–26" },
    items: {
      "C.116": at(48196, 10),
      "C.117": at(2593, 11),
      "C.118": at(1635, 12),
      "C.901": at(0.24, 31),
      "C.1302": at(50, 15), // the line says $85
      "C.2101": at(true, 19),
      "C.2110": at(6202, 20),
      "C.2111": at(9000, 21), // > applications
      "C.1201": { status: "blank" },
      "I.201": at(9, 25, 20), // 7,329 ÷ 935 = 7.84
      "I.202": at(7329, 26, 20),
      "I.203": at(935, 26, 20),
      "B.2201": at(0.97, 30, 3),
    },
  };
  return { d, lines };
}

test("universal (model reads): the value must be on its cited line, and the line must exist", () => {
  const { d, lines } = modelDoc();
  const r = runItemChecks(d, { table: T, lines });
  assert.deepEqual(r.byCode["C.1302"].map((f) => f.check), ["number-on-line"]);
  for (const k of ["C.116", "C.117", "C.118", "C.901", "C.2110"]) assert.ok(!r.byCode[k]?.some((f) => f.check === "number-on-line"), k);
  d.items["C.116"].line = 99;
  assert.deepEqual(runItemChecks(d, { table: T, lines }).byCode["C.116"].map((f) => f.check), ["line-in-document"]);
  // Without the line text, line checks are skipped (a deterministic read has none).
  assert.equal(runItemChecks(d, { table: T }).byCode["C.1302"], undefined);
  // valueOnLine's forms: thousands separators, split digits, percents as printed, marks, month names.
  assert.ok(valueOnLine("Tuition | $3 4 , 604", 34604, { value_type: "currency" }));
  assert.ok(valueOnLine("Retention 97.8%", 0.97815, { value_type: "percent" }));
  assert.ok(!valueOnLine("Retention 95%", 0.97815, { value_type: "percent" }));
  assert.ok(valueOnLine("Study abroad | X", true, { value_type: "check" }));
  assert.ok(valueOnLine("Closing date: November 1", 11, { value_type: "month" }));
});

test("universal (model reads): the cover's edition must be the one the document is filed under", () => {
  const { d, lines } = modelDoc();
  assert.equal(coverEdition(lines), "2025-26");
  lines[0] = "Common Data Set 2024-2025";
  const r = runItemChecks(d, { table: T, lines });
  for (const k of Object.keys(d.items).filter((k) => d.items[k].v !== undefined)) assert.ok(r.byCode[k].some((f) => f.check === "edition-mismatch"), k);
  assert.equal(r.byCode["C.1201"], undefined); // blank stays blank
});

/* ---- Per-item checks: the real records pass; one broken value fails exactly its check's codes ---- */

test("B1: rows add up; federal enrollment within 10%", () => {
  failsExactly(WM, (d) => set(d, "B.101", 657), "parts-sum", ["B.101", "B.102", "B.103", "B.104"]);
  failsExactly(WM, () => {}, "federal-disagrees", ["B.104", "B.110", "B.129", "B.135", "B.154", "B.160"], { federal: fed(WM, { undergrad_enrollment: 5000 }) });
});

test("B2: columns add up; column 3 is all undergraduates", () => {
  failsExactly(WM, (d) => set(d, "B.212", 584), "parts-sum", range("B", 211, 220));
  failsExactly(WM, (d) => set(d, "B.230", 1010), "column-3-not-all-undergrads", range("B", 221, 230));
});

test("B4–B11: completers = D + E + F, groups sum to the total, rate = completers ÷ final", () => {
  const got = added(WM, (d) => set(d, "B.425", 131));
  assert.deepEqual([...got.keys()].sort(), ["B.409", "B.413", "B.417", "B.421", "B.425", "B.426", "B.427", "B.428", "B.429"]);
  assert.ok(got.get("B.425")!.has("parts-sum") && got.get("B.429")!.has("ratio-matches"));
  // The previous grid against IPEDS GR for the same cohort.
  failsExactly(WM, () => {}, "previous-cohort-disagrees", range("B", 401, 432), { federal: fed(WM, { grad_cohorts: { pell: 200, loan_no_pell: 229, no_pell_no_loan: 1153, total: 1541 } }) });
});

test("B22: retained ≤ cohort, rate matches counts", () => {
  const got = added(WM, (d) => set(d, "B.2203", 0.9));
  assert.deepEqual([...got.keys()].sort(), ["B.2201", "B.2202", "B.2203"]);
  assert.ok(got.get("B.2203")!.has("ratio-matches"));
  assert.ok(added(WM, (d) => set(d, "B.2202", 1700)).get("B.2202")!.has("order"));
});

test("C1: sex rows sum to totals; the seven round-1 checks still run", () => {
  failsExactly(WM, (d) => set(d, "C.101", 6408), "parts-sum", ["C.101", "C.102", "C.103", "C.116"]);
  failsExactly(WM, () => {}, "plausible-change", ["C.116", "C.117"], { federal: fed(WM, { applicants: 5000 }) });
  // A "##" total is summed from its parts (method "derived"), and then publishes.
  const d = doc(WM);
  d.items["C.116"] = { status: "failed", failures: [{ check: "overflow-total", detail: '"##" is Excel\'s overflow mark; sum the parts' }] };
  const checked = applyChecks(d, ctx(WM));
  assert.deepEqual([checked.items["C.116"].v, checked.items["C.116"].method, checked.items["C.116"].status], [16895, "derived", "passed"]);
  assert.match(checked.items["C.116"].cell!, /\+/);
});

test("C1 by residency: funnel per residency, rows sum to C1, shares near federal", () => {
  failsExactly(VU, (d) => set(d, "C.120", 3000), "residency-funnel", range("C", 119, 130));
  failsExactly(VU, () => {}, "residency-vs-federal", range("C", 119, 130), { federal: fed(VU, { residence: { in_state: 0.5, out_of_state: 0.4, international: 0.1 } }) });
});

test("C2: wait-list order and the policy answer", () => {
  failsExactly(WM, (d) => set(d, "C.204", 5000), "order", ["C.203", "C.204"]);
  failsExactly(WM, (d) => set(d, "C.201", false), "inconsistent", ["C.201", "C.202", "C.203", "C.204"]);
});

test("C5: subjects sum to the total, lab ≤ science, recommended ≥ required", () => {
  failsExactly(VU, (d) => set(d, "C.505", 4), "order", ["C.504", "C.505"]); // lab isn't compared across columns
  failsExactly(VU, (d) => (set(d, "C.515", 2), set(d, "C.521", 5)), "order", ["C.503", "C.515"]); // recommended math 2 < required 3
  failsExactly(VU, (d) => set(d, "C.501", 21), "parts-sum", ["C.501", "C.502", "C.503", "C.504", "C.506", "C.507", "C.508", "C.509", "C.510", "C.511"]);
});

test("C7: exactly one level per factor; a grid with every mark in one column fails", () => {
  assert.equal(c7Level("Very Important"), "very_important");
  assert.equal(c7Level("NC"), "not_considered");
  assert.equal(c7Level("Very Important, Important"), null);
  failsExactly(WM, (d) => set(d, "C.703", "Very Important, Important"), "one-mark", ["C.703"]);
  failsExactly(WM, (d) => range("C", 701, 718).forEach((k) => set(d, k, "Considered")), "one-mark", range("C", 701, 718));
});

test("C8: C8A agrees with the grid and with C8F's words", () => {
  failsExactly(WM, (d) => set(d, "C.801", false), "inconsistent", ["C.801", "C.802"]);
  failsExactly(WM, (d) => set(d, "C.802", "Required to be considered for admission"), "inconsistent", ["C.802", "C.8F"]);
});

test("C9: percentile order, composite ≈ EBRW + Math, number vs share, bands, federal", () => {
  const got = added(WM, (d) => set(d, "C.906", 1300));
  assert.deepEqual([...got.keys()].sort(), ["C.905", "C.906", "C.909", "C.912"]);
  assert.ok(got.get("C.906")!.has("order") && got.get("C.909")!.has("parts-sum"));
  failsExactly(WM, (d) => set(d, "C.903", 100), "ratio-matches", ["C.901", "C.903"]);
  failsExactly(WM, (d) => set(d, "C.932", 0.95), "sums-to-100", ["C.932", "C.933", "C.934", "C.935", "C.938"]); // C.936–C.937 blank
  failsExactly(WM, () => {}, "federal-disagrees", ["C.908"], { federal: fed(WM, { sat_reading_25_75: [600, 760] }) });
});

test("C10: class-rank bands in order", () => {
  failsExactly(WM, (d) => set(d, "C.1001", 0.99), "order", ["C.1001", "C.1002"]);
});

test("C11: each GPA column sums to 100%", () => {
  failsExactly(VU, (d) => set(d, "C.1101", 0.401), "sums-to-100", range("C", 1101, 1110));
});

test("C14, C16–C17, C21, C22: dates valid and in cycle order; one kind per row; ED counts in order", () => {
  failsExactly(IL, (d) => set(d, "C.1402", 10), "date-order", ["C.1402", "C.1403"]); // regular closing before EA's
  failsExactly(VU, (d) => set(d, "C.1601", true), "one-mark", ["C.1601", "C.1604"]);
  failsExactly(VU, (d) => set(d, "C.2111", 7000), "order", ["C.2110", "C.2111"]);
  failsExactly(IL, (d) => set(d, "C.2201", false), "inconsistent", ["C.2201", "C.2202", "C.2203", "C.2204", "C.2205"]);
  failsExactly(WM, (d) => set(d, "C.2103", 31), "valid-date", ["C.2102", "C.2103"]); // November 31
});

test("D2, D9: transfer funnel and sums, federal count, date order", () => {
  const got = added(WM, (d) => set(d, "D.212", 500));
  assert.deepEqual([...got.keys()].sort(), ["D.208", "D.209", "D.210", "D.211", "D.212"]);
  assert.ok(got.get("D.212")!.has("order") && got.get("D.212")!.has("parts-sum") && got.get("D.212")!.has("federal-disagrees"));
  failsExactly(WM, (d) => set(d, "D.925", 4), "date-order", ["D.925", "D.926"]);
});

test("D4–D7: credits 0–200; one requirement level per D5 material", () => {
  failsExactly(VU, (d) => set(d, "D.402", 250), "out-of-range", ["D.402"]);
  failsExactly(VU, (d) => set(d, "D.504", "Required of All, Not Required"), "one-mark", ["D.504"]);
});

test("G0, G1: the calculator is a URL; tuition + fees near federal; housing + food = food and housing", () => {
  assert.deepEqual(doc(CU).items["G.001"].failures!.map((f) => f.check), ["not-a-url"]);
  failsExactly(WM, (d) => set(d, "G.105", 30000), "federal-disagrees", ["G.105"]);
  failsExactly(VU, (d) => set(d, "G.113", 16170), "parts-sum", ["G.112", "G.113", "G.114"]);
});

test("H0, H1: one methodology; grant and self-help rows sum to their totals ±$1K", () => {
  const got = added(IL, (d) => set(d, "H.103", true));
  assert.deepEqual([...got.keys()].sort(), ["H.102", "H.103"]);
  assert.ok(got.get("H.102")!.has("one-mark"));
  failsExactly(VU, (d) => set(d, "H.105", 13913483), "parts-sum", range("H", 105, 109));
});

test("H2: line order, the package bound, line A vs B1 in the same year", () => {
  failsExactly(VU, (d) => set(d, "H.202", 2000), "order", ["H.201", "H.202"]);
  failsExactly(VU, (d) => set(d, "H.211", 90000), "order", ["H.210", "H.211", "H.212"]);
  failsExactly(VU, (d) => set(d, "H.201", 1800), "enrollment-disagrees", ["H.201"]);
  // William & Mary's H2 is 2024–25 final: line A isn't compared with this edition's B1.
  assert.equal(added(WM, (d) => set(d, "H.201", 1800)).size, 0);
});

test("H2A: P × Q near H1's athletic dollars; no athletic aid at Division III", () => {
  failsExactly(VU, (d) => set(d, "H.2A07", 2000), "ratio-matches", ["H.2A07", "H.2A08"]);
  failsExactly(VU, () => {}, "inconsistent", ["H.2A03", "H.2A07"], { federal: fed(VU, { ncaa_division: "III" }) });
});

test("H4, H5, H6: class ≤ B1; borrowers in order; federal-row debt near Scorecard; H6 average × number = total", () => {
  failsExactly(VU, (d) => set(d, "H.401", 9000), "enrollment-disagrees", ["H.401"]);
  failsExactly(CU, (d) => set(d, "H.501", 1000), "order", ["H.501", "H.502"]);
  failsExactly(VU, () => {}, "federal-disagrees", ["H.511", "H.512"], { federal: fed(VU, { median_debt: 5000 }) });
  failsExactly(VU, (d) => set(d, "H.606", 10000000), "ratio-matches", ["H.604", "H.605", "H.606"]);
});

test("H8, H9–H11: FAFSA with any form; aid dates in cycle order", () => {
  failsExactly(VU, (d) => (d.items["H.801"] = { status: "blank" }), "inconsistent", ["H.803"]);
  failsExactly(VU, (d) => set(d, "H.1101", 3), "date-order", ["H.1101", "H.1102"]);
});

test("I-2, I-3, J: ratio = students ÷ faculty; bins sum to the total; degree shares sum to 100%", () => {
  failsExactly(VU, (d) => set(d, "I.201", 9), "ratio-matches", ["I.201", "I.202", "I.203"]);
  failsExactly(VU, (d) => set(d, "I.308", 1900), "parts-sum", range("I", 301, 308));
  const got = added(VU, (d) => set(d, "J.181", (doc(VU).items["J.181"].v as number ?? 0) + 0.05));
  assert.ok([...got.keys()].every((k) => k >= "J.181" && k <= "J.220") && got.has("J.181") && got.has("J.220"));
  // I-2 is never compared with the federal ratio (definitions differ): a far-off federal ratio changes nothing.
  assert.equal(added(VU, () => {}, { federal: fed(VU, { undergrad_enrollment: 7221 }) }).size, 0);
});

/* ---- Test 16: per-item publishing and the review queue ---- */

test("16: a failing H2 code doesn't stop C1 publishing; the queue holds one item per college + edition + code", () => {
  const d = doc(VU);
  set(d, "H.202", 2000);
  const checked = applyChecks(d, ctx(VU));
  assert.equal(checked.items["H.202"].status, "failed");
  for (const k of ["C.116", "C.117", "C.118"]) assert.equal(checked.items[k].status, "passed");
  assert.equal(newestPassed({ unit_id: VU, documents: [checked] }, ["C.116", "C.117", "C.118"])!.document, checked);

  const items = reviewItemsFor(checked, T, { unit_id: VU, name: "Vanderbilt University", run: "r2", queued: "2026-10-03" });
  assert.deepEqual(items.map((i) => i.code), ["B.2201", "H.201", "H.202"]);
  assert.equal(items[2].entering_term, "2025–26 estimated");
  const c1: ReviewItem = { unit_id: VU, name: "Vanderbilt University", urls: [], entering_term: "Fall 2026", failures: [], queued: "", run: "r1" };
  const oldH2: ReviewItem = { ...items[1], run: "r1", value: 1 };
  const otherEdition: ReviewItem = { ...items[1], edition: "2024-25", run: "r1" };
  const queue = enqueueItems([c1, oldH2, otherEdition], items);
  assert.equal(queue.length, 5);
  assert.ok(queue.includes(c1) && queue.includes(otherEdition) && !queue.includes(oldH2));
  // A round-2 entry for the college replaces only the round-2 entry.
  const again = enqueueItems(queue, [{ ...c1, run: "r3" }]);
  assert.equal(again.length, 5);
  assert.equal(again.filter((i) => !i.code)[0].run, "r3");
  // Once H2 is fixed, its entries leave the queue; the others stay.
  const fixed = applyChecks(doc(VU), ctx(VU));
  assert.deepEqual(dropPassed(again, VU, fixed).map((i) => `${i.code ?? "C1"} ${i.edition ?? ""}`).sort(), ["B.2201 2025-26", "C1 ", "H.201 2024-25"]);
});

test("the PR body lists per-item review rows beside the round-2 table", () => {
  const items = reviewItemsFor(doc(CU), T, { unit_id: CU, name: "Cornell University", run: "r1", queued: "2026-10-03" });
  const rows = perItemTable(items);
  assert.ok(rows.some((r) => r.includes("| Cornell University (190415) | 2025-26 | G0 · G.001 |") && r.includes("not-a-url")));
  const summary = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "college-reported", "run-summary.json"), "utf8")) as RunSummary;
  const queue: ReviewQueueFile = { updated: "2026-10-03", items: items.map((i) => ({ ...i, run: summary.run })) };
  const body = prBody(summary, queue);
  assert.match(body, /\| College \| Edition \| Item \| Value \| Failed checks \| URL \|/);
  assert.doesNotMatch(body, /Nothing from this run needs a person/);
  assert.doesNotMatch(body, /\| College \| Term \| Failed checks \| URL \|/); // no round-2 items this run
});

/* ---- Test 17: escalation scope ---- */

test("17: escalation re-reads only the failing call's pages and codes; blank, deterministic, and type failures never escalate", () => {
  const { d, lines } = modelDoc();
  const checked = applyChecks(d, { table: T, lines });
  assert.equal(checked.items["C.1201"].status, "blank");
  assert.equal(checked.items["B.2201"].failures![0].check, "type-range");
  const esc = escalationFor(checked, T);
  assert.deepEqual(esc, [
    { call: "C", codes: ["C.1302", "C.2110", "C.2111"], checks: ["number-on-line", "order"], pages: [7, 12], model: REPORTED_MODELS.escalation },
    { call: "rest", codes: ["I.201", "I.202", "I.203"], checks: ["ratio-matches"], pages: [1, 30], model: REPORTED_MODELS.escalation },
  ]);
  // Never: a template workbook, a document with nothing read (blocked or missing), or a call the escalation model read.
  assert.deepEqual(escalationFor({ ...checked, type: "xlsx-template" }, T), []);
  assert.deepEqual(escalationFor({ ...checked, reads: {} }, T), []);
  const reread = { ...checked, reads: { ...checked.reads, C: { ...checked.reads.C!, read_by: REPORTED_MODELS.escalation } } };
  assert.deepEqual(escalationFor(reread, T).map((e) => e.call), ["rest"]);
  for (const k of ["unreachable", "newer-than-federal", "type-range", "edition-mismatch", "form-vs-code", "aid-year"] as const) assert.ok(!ESCALATE.has(k), k);
});

/* ---- Test 18: the breaker ---- */

/** A model-read document whose C.1201 passed or failed a check (and whose C.116 is blank or failed). */
function readDoc(i: number, opts: { fail?: boolean; c1Fail?: boolean; deterministic?: boolean; blank?: boolean } = {}): DocumentRecord {
  const it: ItemResult = opts.blank ? { status: "blank" } : opts.fail ? { v: 6.1, status: "failed", page: 9, line: 3, quote: "6.1", failures: [{ check: "type-range", detail: "GPA" }] } : { v: 3.9, status: "passed", page: 9, line: 3, quote: "3.9" };
  if (opts.deterministic && it.status !== "blank") it.cell = "CDS-C!AC120";
  const c116: ItemResult = opts.c1Fail ? { v: 100, status: "failed", page: 7, line: 2, quote: "100", failures: [{ check: "order", detail: "x" }] } : { status: "blank" };
  if (opts.deterministic && opts.c1Fail) c116.cell = "CDS-C!AC17";
  return {
    sha256: String(i).padStart(64, "0"),
    edition: "2025-26",
    type: opts.deterministic ? "xlsx-template" : "pdf-flat",
    url: `https://example.edu/${i}.pdf`,
    retrieved: "2026-10-03",
    reads: opts.deterministic
      ? { deterministic: { schema_version: 1, read_by: "xlsx-template", mode: "deterministic", extracted: "2026-10-03" } }
      : { C: { schema_version: 1, read_by: "claude-haiku-4-5", mode: "batch", extracted: "2026-10-03" } },
    years: { fall: "Fall 2025" },
    items: { "C.1201": it, "C.116": c116 },
  };
}

test("18: one code failing in more than 20% of 20+ model-read documents trips the breaker; deterministic, blank, unreachable never count", () => {
  const trip = (docs: DocumentRecord[]) => circuitBreakerV3({ attempted: 100, failedC1: 0, itemFailureShares: itemFailureShares(docs, T), changed: 0, priorValues: 0 });
  const docs = (n: number, failing: number) => Array.from({ length: n }, (_, i) => readDoc(i, { fail: i < failing }));
  assert.equal(trip(docs(25, 5)), null); // exactly 20%
  assert.match(trip(docs(25, 6))!, /C\.1201 failed in 6 of 25 model-read documents/);
  assert.equal(trip(docs(19, 10)), null); // fewer than 20 documents
  // 30 template workbooks all failing C.1201, and blanks, add nothing.
  const det = Array.from({ length: 30 }, (_, i) => readDoc(100 + i, { fail: true, deterministic: true }));
  const blanks = Array.from({ length: 30 }, (_, i) => readDoc(200 + i, { blank: true }));
  assert.deepEqual(itemFailureShares([...det, ...blanks], T), []);
  assert.equal(trip([...docs(25, 5), ...det, ...blanks]), null);
  // C1: more than 10% of attempted colleges; deterministic C1 failures don't count; unreachable colleges aren't C1 failures.
  const c1 = (id: string, o: Parameters<typeof readDoc>[1]) => ({ unit_id: id, documents: [readDoc(Number(id), o)] });
  assert.equal(failedC1Count([c1("1", { c1Fail: true }), c1("2", { c1Fail: true, deterministic: true }), c1("3", {})], T), 1);
  const unreachable = c1("4", { c1Fail: true });
  unreachable.documents[0].items["C.116"].failures = [{ check: "unreachable", detail: "403" }];
  assert.equal(failedC1Count([unreachable], T), 0);
  assert.equal(circuitBreakerV3({ attempted: 100, failedC1: 10, itemFailureShares: [], changed: 0, priorValues: 0 }), null);
  assert.match(circuitBreakerV3({ attempted: 100, failedC1: 11, itemFailureShares: [], changed: 0, priorValues: 0 })!, /11 of 100 colleges failed C1/);
  assert.match(circuitBreakerV3({ attempted: 10, failedC1: 0, itemFailureShares: [], changed: 26, priorValues: 100 })!, /26 of 100 published values changed/);
});
