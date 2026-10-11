/**
 * The CDS graduation-rate grid (B4–B21) against federal data, from real failing documents (no network): the systematic
 * circuit-breaker trips of 2026-10-10/11 (B.402, B.405, B.406, B.408, B.410, B.422 failing in 75–90% of model-read
 * documents). Findings: specs/data-expansion/cds-student-body-and-outcomes.md, "As built / findings (2026-10-11)".
 *
 * - Which grid holds federal's class depends on the edition (CU Denver 2024–25, Colorado School of Mines 2022–23).
 * - The CDS grid is the bachelor's-seeking subcohort, IPEDS PSGRTYPE 2 (Loyola Chicago, Troy), not the total cohort.
 * - A newer class isn't held to the older one when the previous grid proved the reading (Iowa State, Pepperdine).
 * - Line H printed as a fraction is a fraction (Yale "0.945 | 1 | 0.967 | 0.963", Mines "0.774774775").
 * - The checks still catch a genuine disagreement (Arkansas's loan/neither split), a crossed read, and, with no
 *   previous grid, an implausible jump (FAMU).
 * - A re-check without the archived lines keeps the line checks' verdicts.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "../lib/types";
import { normalizeValue, type CdsCode, type DocumentRecord, type ItemResult } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { applyChecks, federalBaseline, runItemChecks, type FederalBaseline } from "../lib/cds-checks.ts";
import { checkGrid } from "../lib/cds/student-body.ts";
import { aidGroupGradFrom, bachelorSubcohortFrom } from "../lib/graduation-groups.ts";

const T = CDS_TEMPLATE;
/** IPEDS GR2024_PELL_SSL (meta: "Entered fall 2018"). */
const GRAD_YEAR = 2018;

/* ---------------- Fakes built from the documents' printed lines ---------------- */

/** One grid as printed: lines A, B, C, G per group (Pell, loan, neither, total), and line H as printed text. */
interface Grid {
  A: number[];
  B: number[];
  C: number[];
  D?: number[];
  E?: number[];
  F?: number[];
  G: number[];
  H?: string[];
}
const LINE = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 } as const;
const code = (base: number, line: number, k: number): CdsCode => `B.${base + line * 4 + k}`;

/** A model-read document (no lines given to the checks, so the line checks don't run) with the given grids. */
function docWith(edition: string, cur: Grid | null, prev: Grid | null): DocumentRecord {
  const items: Record<CdsCode, ItemResult> = {};
  const put = (base: number, g: Grid) => {
    for (const [l, i] of Object.entries(LINE) as [keyof Grid, number][]) {
      const row = g[l];
      if (!row) continue;
      row.forEach((v, k) => {
        const c = code(base, i, k);
        const n = normalizeValue({ ...T.byCode.get(c)!, code: c }, String(v), { percentPoints: true });
        items[c] = { v: n.v as number, status: "passed", page: 5, line: 100 + i, quote: `${l} | ${v}` };
      });
    }
    // D, E, F: when not printed in the fake, split G so the grid's own arithmetic holds.
    if (!g.D) g.G.forEach((v, k) => [v, 0, 0].forEach((x, j) => (items[code(base, 3 + j, k)] = { v: x, status: "passed", page: 5, line: 103 + j, quote: `x | ${x}` })));
  };
  if (cur) put(401, cur);
  if (prev) put(501, prev);
  return {
    sha256: "f".repeat(64),
    edition,
    type: "pdf-flat",
    url: "https://example.edu/cds.pdf",
    retrieved: "2026-10-10",
    reads: { rest: { schema_version: 1, read_by: "claude-haiku-4-5-20251001", mode: "batch" } },
    years: {},
    items,
  } as DocumentRecord;
}

/** An IPEDS GR_PELL_SSL row (PG Pell, SS loan without Pell, NR neither, TT total: adjusted cohort, completers). */
function row(type: string, adj: number[], done: number[]): Record<string, string> {
  const r: Record<string, string> = { PSGRTYPE: type };
  ["PG", "SS", "NR", "TT"].forEach((p, k) => {
    r[`${p}ADJCT`] = String(adj[k]);
    r[`${p}CMTOT`] = String(done[k]);
  });
  return r;
}

/** The college as sync-data stores it from its type 1 and type 2 rows; then the checks' federal baseline. */
function schoolFrom(t1: Record<string, string>, t2?: Record<string, string>): School {
  const total = aidGroupGradFrom(t1)!;
  const bachelor = bachelorSubcohortFrom(total, t2);
  return {
    admissions: { year: null, applicants: null, acceptance_rate: null, sat_reading_25_75: null, sat_math_25_75: null, act_composite_25_75: null },
    demographics: {},
    outcomes: {
      grad_rate_pell: total.rates.pell,
      grad_rate_loan_no_pell: total.rates.loan_no_pell,
      grad_rate_no_pell_no_loan: total.rates.no_pell_no_loan,
      grad_rate_ftft: total.rates.total,
      grad_cohorts: total.cohorts,
      ...(bachelor ? { grad_bachelor: bachelor } : {}),
    },
  } as unknown as School;
}
const baseline = (s: School, gradYear: number | null = GRAD_YEAR): FederalBaseline => federalBaseline(s, { gradYear });

/** Check ids failing any grid code. */
function gridFailures(d: DocumentRecord, federal: FederalBaseline | null) {
  const by = runItemChecks(d, { table: T, federal }).byCode;
  const out = new Map<string, Set<CdsCode>>();
  for (const [c, list] of Object.entries(by)) {
    if (!/^B\.[45]\d\d$/.test(c)) continue;
    for (const f of list) {
      if (!out.has(f.check)) out.set(f.check, new Set());
      out.get(f.check)!.add(c);
    }
  }
  return out;
}

/* ---------------- The real documents ---------------- */

// Loyola University Chicago, CDS 2025–26 (lines 280–356): the fall 2019 and fall 2018 grids, line H in points.
const LOYOLA_2019: Grid = { A: [558, 644, 1428, 2630], B: [1, 0, 1, 2], C: [557, 644, 1427, 2628], D: [316, 434, 998, 1748], E: [37, 37, 93, 167], F: [2, 7, 11, 20], G: [355, 478, 1102, 1935], H: ["63.73", "74.22", "77.22", "73.63"] };
const LOYOLA_2018: Grid = { A: [649, 457, 1664, 2770], B: [0, 0, 2, 2], C: [649, 457, 1662, 2768], D: [377, 309, 1156, 1842], E: [39, 36, 120, 195], F: [12, 6, 12, 30], G: [428, 351, 1288, 2067], H: ["65.9", "76.8", "77.5", "74.7"] };
// GR2024_PELL_SSL for Loyola (146719): type 1 counts 203 associate/certificate seekers (127 with Pell) the CDS doesn't.
const LOYOLA_T1 = row("1", [776, 463, 1732, 2971], [493, 352, 1325, 2170]);
const LOYOLA_T2 = row("2", [649, 457, 1662, 2768], [428, 351, 1288, 2067]);

// Iowa State University, CDS 2025–26 (lines 216–285): the subsidized-loan group went 1,604 → 986 between classes.
const IOWA_2019: Grid = { A: [1087, 986, 3395, 5468], B: [1, 0, 1, 2], C: [1086, 986, 3394, 5466], D: [537, 521, 2080, 3138], E: [192, 165, 586, 943], F: [28, 20, 66, 114], G: [757, 706, 2732, 4195], H: ["69.7%", "71.6%", "80.5%", "76.7%"] };
const IOWA_2018: Grid = { A: [967, 1604, 3338, 5909], B: [0, 0, 5, 5], C: [967, 1604, 3333, 5904], D: [499, 843, 2005, 3347], E: [141, 239, 590, 970], F: [26, 29, 75, 130], G: [666, 1111, 2670, 4447], H: ["68.9%", "69.3%", "80.1%", "75.3%"] };
const IOWA_T1 = row("1", [967, 1604, 3333, 5904], [666, 1111, 2670, 4447]);

// Yale University, CDS 2025–26 (lines 185–236): line H printed as fractions, "1" for 24 of 24.
const YALE_2019: Grid = { A: [307, 24, 1219, 1550], B: [0, 0, 0, 0], C: [307, 24, 1219, 1550], D: [182, 12, 624, 818], E: [95, 11, 500, 606], F: [13, 1, 55, 69], G: [290, 24, 1179, 1493], H: ["0.945", "1", "0.967", "0.963"] };
const YALE_2018: Grid = { A: [313, 27, 1233, 1573], B: [0, 0, 1, 1], C: [313, 27, 1232, 1572], D: [197, 18, 689, 904], E: [86, 9, 458, 553], F: [15, 0, 33, 48], G: [298, 27, 1180, 1505], H: ["0.952", "1", "0.958", "0.957"] };
const YALE_T1 = row("1", [312, 27, 1233, 1572], [298, 27, 1180, 1505]);

test("line H and B22 printed as fractions are fractions; other printed percents stay points", () => {
  const norm = (c: CdsCode, raw: string) => normalizeValue({ ...T.byCode.get(c)!, code: c }, raw, { percentPoints: true }).v;
  // Yale's "0.945" was stored as 0.00945 (0.945%), failing ratio-matches and the federal rate in every group.
  assert.equal(norm("B.429", "0.945"), 0.945);
  assert.equal(norm("B.430", "1"), 1, "Yale's loan group: 24 of 24");
  assert.equal(norm("B.529", "0.774774775"), 0.774774775, "Colorado School of Mines 2022–23");
  assert.equal(norm("B.2203", "0.9781"), 0.9781);
  assert.equal(norm("B.429", "63.73"), 0.6373, "Loyola prints points");
  assert.equal(norm("B.432", "51%"), 0.51, "Troy");
  // Not a quotient rate: a printed "0.5" is still 0.5% (score bands, C9: the first live run's lesson).
  const c9 = [...T.byCode.values()].find((it) => it.value_type === "percent" && it.code.startsWith("C.9"))!;
  assert.equal(normalizeValue(c9, "0.5", { percentPoints: true }).v, 0.005);
  // Yale's whole grid now passes its own arithmetic and IPEDS GR (no ratio-matches, no previous-cohort-disagrees).
  const f = gridFailures(docWith("2025-26", YALE_2019, YALE_2018), baseline(schoolFrom(YALE_T1)));
  assert.deepEqual([...f.keys()], []);
});

test("the previous grid is compared with IPEDS GR's bachelor's-seeking subcohort (Loyola Chicago, Troy)", () => {
  const s = schoolFrom(LOYOLA_T1, LOYOLA_T2);
  assert.deepEqual(s.outcomes!.grad_bachelor!.cohorts, { pell: 649, loan_no_pell: 457, no_pell_no_loan: 1662, total: 2768 });
  assert.deepEqual([...gridFailures(docWith("2025-26", LOYOLA_2019, LOYOLA_2018), baseline(s)).keys()], []);
  // Against the total cohort (the comparison before the fix), Loyola's correct reading failed all 32 current codes.
  const total = gridFailures(docWith("2025-26", LOYOLA_2019, LOYOLA_2018), baseline(schoolFrom(LOYOLA_T1)));
  assert.equal(total.get("previous-cohort-disagrees")?.size, 32);
  // Troy (102368): its CDS fall 2018 grid is type 2 to the student (737 / 251 / 665 / 1,653), type 1 is 765 / 257 / 668 / 1,690.
  const troy = schoolFrom(row("1", [765, 257, 668, 1690], [308, 138, 404, 850]), row("2", [737, 251, 665, 1653], [300, 134, 403, 837]));
  const troy2018: Grid = { A: [737, 251, 666, 1654], B: [0, 0, 1, 1], C: [737, 251, 665, 1653], G: [300, 134, 399, 833], H: ["41%", "53%", "60%", "50%"] };
  const troy2019: Grid = { A: [630, 209, 527, 1366], B: [1, 0, 1, 2], C: [629, 209, 526, 1364], G: [253, 115, 323, 691], H: ["40%", "55%", "61%", "51%"] };
  assert.equal(gridFailures(docWith("2025-26", troy2019, troy2018), baseline(troy)).get("previous-cohort-disagrees"), undefined);
  // A type 2 row equal to type 1 (most colleges) stores nothing.
  assert.equal(bachelorSubcohortFrom(aidGroupGradFrom(IOWA_T1), { ...IOWA_T1, PSGRTYPE: "2" }), null);
});

test("the grid holding federal's class depends on the edition (CU Denver 2024–25, Mines 2022–23)", () => {
  // CU Denver 2024–25: its current grid is the fall 2018 class, equal to IPEDS GR; the previous grid is fall 2017.
  const cud = schoolFrom(row("1", [650, 230, 717, 1597], [301, 109, 327, 737]));
  const cud2018: Grid = { A: [651, 230, 719, 1600], B: [1, 0, 0, 1], C: [650, 230, 719, 1599], G: [301, 109, 327, 737], H: ["46%", "47%", "45%", "46%"] };
  const cud2017: Grid = { A: [608, 185, 619, 1412], B: [3, 0, 1, 4], C: [605, 185, 618, 1408], G: [281, 74, 311, 666], H: ["46%", "40%", "50%", "47%"] };
  assert.deepEqual([...gridFailures(docWith("2024-25", cud2018, cud2017), baseline(cud)).keys()], [], "before the fix: previous-cohort-disagrees on all 32 current codes");
  // The same 2024–25 grid read with its groups crossed (Pell ↔ loan) fails the same-class comparison on those columns.
  const crossed: Grid = { ...cud2018, A: [230, 651, 719, 1600], B: [0, 1, 0, 1], C: [230, 650, 719, 1599], G: [109, 301, 327, 737], H: ["47%", "46%", "45%", "46%"] };
  const fails = gridFailures(docWith("2024-25", crossed, cud2017), baseline(cud)).get("federal-disagrees")!;
  assert.ok(fails.has("B.401") && fails.has("B.402") && !fails.has("B.403") && !fails.has("B.404"));
  // Mines 2022–23: fall 2016 and fall 2015 classes; no federal class to compare, so no federal failure at all.
  const mines2016: Grid = { A: [111, 289, 649, 1049], B: [0, 0, 2, 2], C: [111, 289, 647, 1047], D: [69, 180, 434, 683], E: [14, 35, 92, 141], F: [3, 5, 16, 24], G: [86, 220, 542, 848], H: ["0.774774775", "0.761245675", "0.837712519", "0.809933142"] };
  const mines = schoolFrom(row("1", [145, 246, 801, 1192], [104, 186, 684, 974]));
  const f = gridFailures(docWith("2022-23", mines2016, null), baseline(mines));
  assert.equal(f.get("federal-disagrees"), undefined);
  assert.equal(f.get("previous-cohort-disagrees"), undefined);
  assert.equal(f.get("ratio-matches"), undefined, "line H read as fractions");
  // Without the federal class's year nothing is compared (the grids can't be matched to it).
  assert.deepEqual([...gridFailures(docWith("2024-25", crossed, cud2017), baseline(cud, null)).keys()], []);
});

test("a newer class isn't held to the older one when the previous grid proves the reading (Iowa State, Pepperdine)", () => {
  const iowa = baseline(schoolFrom(IOWA_T1));
  // Before: "B4 loan_no_pell final cohort 986 vs federal 1,604 one cohort older (more than 25% apart)".
  assert.deepEqual([...gridFailures(docWith("2025-26", IOWA_2019, IOWA_2018), iowa).keys()], []);
  // Pepperdine 2025–26: Pell 118 of the fall 2019 class at 75% vs IPEDS's fall 2018 143 at 83.92%; its previous grid
  // (143 / 173 / 483 / 799, 84% / 87% / 82% / 83%) is IPEDS GR exactly.
  const pep = baseline(schoolFrom(row("1", [143, 173, 483, 799], [120, 150, 396, 666])));
  const pep2019: Grid = { A: [119, 150, 455, 724], B: [1, 0, 1, 2], C: [118, 150, 454, 722], G: [89, 124, 353, 566], H: ["75%", "83%", "78%", "78%"] };
  const pep2018: Grid = { A: [143, 173, 484, 800], B: [0, 0, 1, 1], C: [143, 173, 483, 799], G: [120, 150, 396, 666], H: ["84%", "87%", "82%", "83%"] };
  assert.deepEqual([...gridFailures(docWith("2025-26", pep2019, pep2018), pep).keys()], []);
  // The publish layer agrees: the class publishes as entering fall 2019.
  const fedPep = schoolFrom(row("1", [143, 173, 483, 799], [120, 150, 396, 666])).outcomes!;
  const g = checkGrid(docWith("2025-26", pep2019, pep2018), fedPep, { gradYear: GRAD_YEAR });
  assert.deepEqual(g.problems, []);
  assert.equal(g.value?.entering_year, 2019);
});

test("the checks still catch real disagreement: Arkansas's split, FAMU's jump with no previous grid", () => {
  // Arkansas 2025–26 (106397): Pell and total equal IPEDS, but the CDS counts 1,436 subsidized-loan students where
  // IPEDS has 774 (and 2,596 vs 3,258 neither): the college's two reports differ, so the current grid goes to review.
  const ark = baseline(schoolFrom(row("1", [938, 774, 3258, 4970], [519, 532, 2454, 3505])));
  const ark2018: Grid = { A: [939, 1437, 2601, 4977], B: [1, 1, 5, 7], C: [938, 1436, 2596, 4970], G: [519, 1002, 1984, 3505], H: ["55.3", "69.8", "76.4", "70.5"] };
  const ark2019: Grid = { A: [823, 1307, 2432, 4562], B: [1, 3, 2, 6], C: [822, 1304, 2430, 4556], G: [473, 906, 1851, 3230], H: ["57.5", "69.5", "76.2", "70.9"] };
  const f = gridFailures(docWith("2025-26", ark2019, ark2018), ark);
  assert.equal(f.get("previous-cohort-disagrees")?.size, 32);
  // FAMU 2025–26 leaves the fall 2018 grid unfilled: the fall 2019 Pell rate 57.7% against federal 49.58% one class
  // older stays a federal-disagrees for review (nothing proves the reading).
  const famu = baseline(schoolFrom(row("1", [962, 158, 282, 1402], [477, 88, 183, 748])));
  const famu2019: Grid = { A: [849, 144, 280, 1273], B: [1, 0, 0, 1], C: [848, 144, 280, 1272], G: [489, 94, 199, 782], H: ["57.7", "65.3", "71.1", "61.5"] };
  const ff = gridFailures(docWith("2025-26", famu2019, null), famu).get("federal-disagrees")!;
  assert.ok(ff.has("B.401") && ff.has("B.429"));
  // A previous grid printed as zeros by a fillable form (Howard, Earlham) isn't a class to compare.
  const zeros: Grid = { A: [0, 0, 0, 0], B: [0, 0, 0, 0], C: [0, 0, 0, 0], G: [0, 0, 0, 0] };
  assert.equal(gridFailures(docWith("2025-26", famu2019, zeros), famu).get("previous-cohort-disagrees"), undefined);
});

test("a re-check without the archived lines keeps the line checks' verdicts", () => {
  const d = docWith("2025-26", IOWA_2019, IOWA_2018);
  d.items["B.405"] = { ...d.items["B.405"], status: "failed", failures: [{ check: "number-on-line", detail: "363 isn't on line 189" }] };
  const again = applyChecks(d, { table: T, federal: baseline(schoolFrom(IOWA_T1)) });
  assert.equal(again.items["B.405"].status, "failed", "before the fix: passed, the failure dropped");
  assert.deepEqual(again.items["B.405"].failures?.map((f) => f.check), ["number-on-line"]);
  // With the lines, the check runs again (here the number is on its line, so it passes).
  const lines = Array.from({ length: 120 }, (_, i) => (i === 100 ? "B | 1 | 0 | 1 | 2" : "x"));
  const withLines = applyChecks(d, { table: T, federal: baseline(schoolFrom(IOWA_T1)), lines });
  assert.equal(withLines.items["B.405"].failures?.some((f) => f.check === "number-on-line") ?? false, false);
});

