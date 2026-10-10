/**
 * Round 3's checks on every record item (specs/college-reported-round-3.md Decision 9 and the Extraction scope table's
 * Checks column, with the tolerances of the nine specs/data-expansion/cds-*.md specs).
 *
 * - `runItemChecks(doc, ctx)`: the universal checks (type, number on its cited line, cited line exists, edition, form
 *   vs code table) and the per-item checks, as small named functions grouped by CDS item. Every failure names the
 *   template codes it applies to; it marks exactly those items failed, never others.
 * - `applyChecks(doc, ctx)`: a new DocumentRecord with statuses re-judged. Idempotent: it first undoes its own earlier
 *   work, so a record can be re-checked whenever the checks change (Build order step 8: "they re-judge stored records").
 * - `escalationFor(doc)`: which model calls to re-read with the stronger model, and for which codes.
 * - `circuitBreakerV3(…)`, `itemFailureShares`, `failedC1Count`: the round-3 breaker.
 * - `reviewItemsFor(doc, …)`, `dropPassed(…)`: review-queue entries keyed by college + edition + code.
 *
 * Checks run on deterministic reads too: colleges' own files have errors (Vanderbilt's 0.97 in a count cell, Illinois's
 * swapped C1 cells, its B2 column 3, Cornell's C21 code table). Such failures go to review; they are never escalated
 * and never count toward the breaker (the college's file is wrong, not the pipeline).
 *
 * Federal comparisons must use the college as federal data has it: pass `restoreFederal(school)` (lib/newest.ts), so
 * a re-run never compares a college with its own earlier CDS value.
 *
 * Pure module: type-only imports plus lib/cds-sections.ts, lib/reported.ts and lib/reported-checks.ts (all pure).
 */
import type { School } from "./types";
import {
  itemOfCode,
  monthDay,
  parseEdition,
  typeFailure,
  type CallKey,
  type CdsCode,
  type CollegeRecord,
  type DocumentRecord,
  type ItemFailure,
  type ItemResult,
  type MonthDay,
  type TemplateItem,
  type TemplateTable,
} from "./cds-sections.ts";
import { REPORTED_MODELS, type CheckFailure, type CheckId, type Extraction, type ReviewItem } from "./reported.ts";
import { runChecks } from "./reported-checks.ts";
import { stripLayoutTags } from "./cds-quotes.ts";

/* ------------------------------------------------------------------ */
/* Inputs and outputs                                                  */
/* ------------------------------------------------------------------ */

type Value = number | string | boolean;
type GradGroup = "pell" | "loan_no_pell" | "no_pell_no_loan" | "total";

/** The federal values the checks compare against, flattened from `School` (all nullable: missing means "not checked"). */
export interface FederalBaseline {
  /** IPEDS admissions: the fall, applicants, and rate (C1's seven checks). */
  admissions_year: number | null;
  applicants: number | null;
  acceptance_rate: number | null;
  sat_reading_25_75: [number, number] | null;
  sat_math_25_75: [number, number] | null;
  act_composite_25_75: [number, number] | null;
  /** Degree-seeking undergraduates, and the men and part-time shares (B1). */
  undergrad_enrollment: number | null;
  men_share: number | null;
  part_time_share: number | null;
  /** Scorecard's seven race/ethnicity shares (B2 column 2). */
  race: Record<"asian" | "black" | "hispanic" | "white" | "two_or_more" | "international" | "other", number> | null;
  /** IPEDS residence of first-years (C1 by residency). */
  residence: { in_state: number; out_of_state: number; international: number } | null;
  /** New transfer-ins (D2). */
  transfer_in: number | null;
  retention_rate: number | null;
  /** IPEDS GR six-year rates and cohorts by Pell/loan group (B4–B11). */
  grad_rate: Record<GradGroup, number | null> | null;
  grad_cohorts: Record<GradGroup, number | null> | null;
  /** Scorecard median federal debt of completers (H5). */
  median_debt: number | null;
  /** Scorecard tuition and fees (G1), and cost of attendance (H2A, H6 bounds). */
  tuition_in_state: number | null;
  tuition_out_of_state: number | null;
  cost_of_attendance: number | null;
  /** NCAA division (H2A: Division III gives no athletic scholarships). */
  ncaa_division: string | null;
}

/** The federal baseline of a college. Pass `restoreFederal(school)`, never a school with CDS values applied. */
export function federalBaseline(school: School): FederalBaseline {
  const a = school.admissions;
  const d = school.demographics;
  const o = school.outcomes;
  const r = d.residence;
  const hasGrad = o && [o.grad_rate_pell, o.grad_rate_loan_no_pell, o.grad_rate_no_pell_no_loan, o.grad_rate_ftft].some((x) => x != null);
  return {
    admissions_year: a.year,
    applicants: a.applicants,
    acceptance_rate: a.acceptance_rate,
    sat_reading_25_75: a.sat_reading_25_75,
    sat_math_25_75: a.sat_math_25_75,
    act_composite_25_75: a.act_composite_25_75,
    undergrad_enrollment: d.undergrad_enrollment ?? null,
    men_share: d.men_share ?? null,
    part_time_share: d.part_time_share ?? null,
    race: d.racial_diversity ?? null,
    residence: r ? { in_state: r.in_state, out_of_state: r.out_of_state, international: r.international } : null,
    transfer_in: d.transfer_in?.count ?? null,
    retention_rate: o?.retention_rate ?? null,
    grad_rate: hasGrad
      ? { pell: o!.grad_rate_pell ?? null, loan_no_pell: o!.grad_rate_loan_no_pell ?? null, no_pell_no_loan: o!.grad_rate_no_pell_no_loan ?? null, total: o!.grad_rate_ftft ?? null }
      : null,
    grad_cohorts: o?.grad_cohorts ?? null,
    median_debt: o?.median_debt ?? null,
    tuition_in_state: school.cost?.tuition_in_state ?? null,
    tuition_out_of_state: school.cost?.tuition_out_of_state ?? null,
    cost_of_attendance: school.cost?.cost_of_attendance ?? null,
    ncaa_division: school.campus?.athletics?.division ?? null,
  };
}

export interface CheckContext {
  table: TemplateTable;
  /** The college as federal data has it (`restoreFederal(school)`); null when the college isn't in the dataset. */
  school?: School | null;
  /** Defaults to `federalBaseline(school)`. */
  federal?: FederalBaseline | null;
  /** A model-read document's archived numbered line text: line n is `lines[n - 1]`. Without it, line checks are skipped. */
  lines?: readonly string[];
  /** The college's other documents (C1's "two sources agree" check, same edition only). */
  others?: readonly DocumentRecord[];
  /**
   * The document states no edition and was filed under an assumed one (manifest `edition_from: "assumed"`): its items
   * publish only when an item's own text confirms that edition (B22's falls, H4's class, I-2's fall).
   */
  editionAssumed?: boolean;
}

/** One failure, naming the template codes it applies to. */
export interface CodedFailure {
  check: CheckId;
  detail: string;
  codes: CdsCode[];
}

/** A total code summed from its printed parts ("##" overflow, or a blank total with parts): `method: "derived"`. */
export interface DerivedTotal {
  v: number;
  from: CdsCode[];
}

export interface ItemCheckResult {
  /** Every failure, after resolving form-vs-code groups. */
  failures: CodedFailure[];
  /** The same failures by code (only codes with a value are marked failed by `applyChecks`). */
  byCode: Record<CdsCode, ItemFailure[]>;
  derived: Record<CdsCode, DerivedTotal>;
  /** Template-workbook codes whose visible-form value passed every check of its group and is published instead. */
  resolved: CdsCode[];
}

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

/** "C", 101 → "C.101". */
const c = (section: string, n: number): CdsCode => `${section}.${n}`;
/** Inclusive run of codes: ("B", 201, 209) → B.201 … B.209. */
const run = (section: string, from: number, to: number): CdsCode[] => Array.from({ length: to - from + 1 }, (_, i) => c(section, from + i));
/** H2A's lettered codes: 1 → "H.2A01". */
const h2a = (i: number): CdsCode => `H.2A${String(i).padStart(2, "0")}`;

/** C1's totals and its residency grid (one status for the whole grid: cds-residency-admissions.md). */
const C1_TOTALS = ["C.116", "C.117", "C.118"];
const RESIDENCY = run("C", 119, 130);

/** The group a code is judged in: CDS item, except C1's residency grid, which is its own item. */
export function checkGroupOf(code: CdsCode): string {
  return RESIDENCY.includes(code) ? "C1-residency" : itemOfCode(code);
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

interface Vals {
  get(code: CdsCode): Value | undefined;
  num(code: CdsCode): number | null;
  bool(code: CdsCode): boolean | null;
  text(code: CdsCode): string | null;
  /** The value is text in a numeric item ("varies"). */
  isText(code: CdsCode): boolean;
}

function vals(map: ReadonlyMap<CdsCode, Value>): Vals {
  return {
    get: (k) => map.get(k),
    num: (k) => {
      const v = map.get(k);
      return typeof v === "number" ? v : null;
    },
    bool: (k) => {
      const v = map.get(k);
      return typeof v === "boolean" ? v : null;
    },
    text: (k) => {
      const v = map.get(k);
      return typeof v === "string" ? v : null;
    },
    isText: (k) => typeof map.get(k) === "string",
  };
}

/** Values the checks see: every item with a value (passed or failed), as read. */
function valuesOf(items: Record<CdsCode, ItemResult>): Map<CdsCode, Value> {
  const m = new Map<CdsCode, Value>();
  for (const [code, it] of Object.entries(items)) {
    if (it.v !== undefined && it.v !== null && (it.status === "passed" || it.status === "failed")) m.set(code, it.v);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Sums (with derivation of "##" and blank totals)                     */
/* ------------------------------------------------------------------ */

interface SumSpec {
  total: CdsCode;
  parts: CdsCode[];
  /** Allowed difference: 1 for counts, $1,000 for H1, 1 unit for C5. */
  tol: number;
  /** Sum a "##" or blank total from its parts (B1, C1, D2, C5, H1, I-3, B2); never the reverse. */
  derive: boolean;
  /** Codes failed when the sum is off (default: parts and total). */
  codes?: CdsCode[];
  label: string;
}

const B1_SEX = [0, 25, 50].flatMap((o): SumSpec[] => {
  const b = 101 + o;
  const sex = ["men", "women", "unknown sex"][o / 25];
  return [
    { total: c("B", b + 3), parts: run("B", b, b + 2), tol: 1, derive: true, label: `B1 full-time degree-seeking ${sex}` },
    { total: c("B", b + 5), parts: [c("B", b + 3), c("B", b + 4)], tol: 1, derive: true, label: `B1 full-time undergraduates ${sex}` },
    { total: c("B", b + 9), parts: run("B", b + 6, b + 8), tol: 1, derive: true, label: `B1 part-time degree-seeking ${sex}` },
    { total: c("B", b + 11), parts: [c("B", b + 9), c("B", b + 10)], tol: 1, derive: true, label: `B1 part-time undergraduates ${sex}` },
    { total: c("B", b + 12), parts: [c("B", b + 5), c("B", b + 11)], tol: 1, derive: true, label: `B1 undergraduates ${sex}` },
  ];
});

/** Every printed total that is the sum of printed parts, in derivation order (a derived total may feed the next). */
const SUMS: SumSpec[] = [
  ...B1_SEX,
  { total: "B.176", parts: ["B.113", "B.138", "B.163"], tol: 1, derive: true, label: "B1 total undergraduates" },
  { total: "B.178", parts: ["B.176", "B.177"], tol: 1, derive: true, label: "B1 grand total" },
  { total: "B.210", parts: run("B", 201, 209), tol: 1, derive: true, label: "B2 first-year column" },
  { total: "B.220", parts: run("B", 211, 219), tol: 1, derive: true, label: "B2 degree-seeking column" },
  { total: "B.230", parts: run("B", 221, 229), tol: 1, derive: true, label: "B2 all-undergraduates column" },
  { total: "C.116", parts: ["C.101", "C.102", "C.103"], tol: 1, derive: true, label: "C1 applicants by sex" },
  { total: "C.117", parts: ["C.104", "C.105", "C.106"], tol: 1, derive: true, label: "C1 admits by sex" },
  { total: "C.118", parts: ["C.107", "C.108", "C.109"], tol: 1, derive: true, label: "C1 enrolled by sex" },
  // Full-time + part-time = enrolled, by sex: the split cells fail, not the enrolled count (checked against C.118).
  { total: "C.107", parts: ["C.110", "C.111"], tol: 1, derive: false, codes: ["C.110", "C.111"], label: "C1 men enrolled, full- + part-time" },
  { total: "C.108", parts: ["C.112", "C.113"], tol: 1, derive: false, codes: ["C.112", "C.113"], label: "C1 women enrolled, full- + part-time" },
  { total: "C.109", parts: ["C.114", "C.115"], tol: 1, derive: false, codes: ["C.114", "C.115"], label: "C1 unknown-sex enrolled, full- + part-time" },
  { total: "C.501", parts: ["C.502", "C.503", "C.504", "C.506", "C.507", "C.508", "C.509", "C.510", "C.511"], tol: 1, derive: true, label: "C5 required units" },
  { total: "C.513", parts: ["C.514", "C.515", "C.516", "C.518", "C.519", "C.520", "C.521", "C.522", "C.523"], tol: 1, derive: true, label: "C5 recommended units" },
  { total: "D.204", parts: run("D", 201, 203), tol: 1, derive: true, label: "D2 transfer applicants by sex" },
  { total: "D.208", parts: run("D", 205, 207), tol: 1, derive: true, label: "D2 transfer admits by sex" },
  { total: "D.212", parts: run("D", 209, 211), tol: 1, derive: true, label: "D2 transfers enrolled by sex" },
  { total: "H.109", parts: run("H", 105, 108), tol: 1000, derive: true, label: "H1 need-based grants" },
  { total: "H.113", parts: run("H", 110, 112), tol: 1000, derive: true, label: "H1 need-based self-help" },
  { total: "H.121", parts: run("H", 117, 120), tol: 1000, derive: true, label: "H1 non-need grants" },
  { total: "H.124", parts: ["H.122", "H.123"], tol: 1000, derive: true, label: "H1 non-need self-help" },
  { total: "I.308", parts: run("I", 301, 307), tol: 1, derive: true, label: "I-3 class sections" },
  { total: "I.316", parts: run("I", 309, 315), tol: 1, derive: true, label: "I-3 class subsections" },
];

/** The B4 (current) and B5 (previous) grids: line L (A–H) of group k (Pell, loan, neither, total) is base + 4L + k. */
const gridCode = (base: number, line: number, k: number) => c("B", base + line * 4 + k);
const GRID_SUMS: SumSpec[] = [401, 501].flatMap((base) => {
  const which = base === 401 ? "B4" : "B5";
  const out: SumSpec[] = [];
  for (let k = 0; k < 4; k++) {
    // Final = initial − exclusions, i.e. initial = exclusions + final; completers G = D + E + F.
    out.push({ total: gridCode(base, 0, k), parts: [gridCode(base, 1, k), gridCode(base, 2, k)], tol: 1, derive: false, label: `${which} initial = exclusions + final (group ${k + 1})` });
    out.push({ total: gridCode(base, 6, k), parts: [gridCode(base, 3, k), gridCode(base, 4, k), gridCode(base, 5, k)], tol: 1, derive: false, label: `${which} completers within six years (group ${k + 1})` });
  }
  for (let line = 0; line < 7; line++) {
    out.push({ total: gridCode(base, line, 3), parts: [0, 1, 2].map((k) => gridCode(base, line, k)), tol: 1, derive: false, label: `${which} line ${"ABCDEFG"[line]}: three groups = total` });
  }
  return out;
});

/** Derives "##" and blank totals from their parts, in order, into `m`. Parts are never filled from totals. */
function deriveTotals(m: Map<CdsCode, Value>, items: Record<CdsCode, ItemResult>): Record<CdsCode, DerivedTotal> {
  const out: Record<CdsCode, DerivedTotal> = {};
  for (const s of SUMS) {
    if (!s.derive || m.has(s.total)) continue;
    const it = items[s.total];
    const overflow = it?.status === "failed" && it.failures?.some((f) => f.check === "overflow-total");
    if (it && it.status !== "blank" && !overflow) continue;
    const parts = s.parts.filter((p) => m.has(p));
    if (!parts.length || parts.some((p) => typeof m.get(p) !== "number")) continue;
    const v = round6(parts.reduce((a, p) => a + (m.get(p) as number), 0));
    m.set(s.total, v);
    out[s.total] = { v, from: parts };
  }
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/* ------------------------------------------------------------------ */
/* The check context each group function gets                          */
/* ------------------------------------------------------------------ */

interface Ctx {
  v: Vals;
  doc: DocumentRecord;
  items: Record<CdsCode, ItemResult>;
  table: TemplateTable;
  federal: FederalBaseline | null;
  school: School | null;
  others: readonly DocumentRecord[];
  lines: readonly string[] | undefined;
  derived: Record<CdsCode, DerivedTotal>;
  editionAssumed: boolean;
  fail(check: CheckId, codes: CdsCode[], detail: string): void;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : String(round6(n)));
const pct = (n: number) => `${round6(n * 100)}%`;
const sumOf = (v: Vals, codes: CdsCode[]) => codes.reduce((a, k) => a + (v.num(k) ?? 0), 0);
const anyNum = (v: Vals, codes: CdsCode[]) => codes.some((k) => v.num(k) !== null);

/** A sum check: parts (blank = 0) against the total, both present; skipped when a part is text ("varies"). */
function checkSum(x: Ctx, s: SumSpec, check: CheckId = "parts-sum") {
  const total = x.v.num(s.total);
  if (total === null || !anyNum(x.v, s.parts) || s.parts.some((p) => x.v.isText(p))) return;
  const sum = sumOf(x.v, s.parts);
  if (Math.abs(sum - total) > s.tol) {
    x.fail(check, s.codes ?? [...s.parts, s.total], `${s.label}: parts sum to ${fmt(sum)}, the total says ${fmt(total)} (allowed ±${fmt(s.tol)})`);
  }
}

/** a ≤ b (both present), with a tolerance. */
function checkLe(x: Ctx, a: CdsCode, b: CdsCode, what: string, check: CheckId = "order", codes: CdsCode[] = [a, b], tol = 0) {
  const va = x.v.num(a);
  const vb = x.v.num(b);
  if (va !== null && vb !== null && va > vb + tol) x.fail(check, codes, `${what}: ${fmt(va)} (${a}) > ${fmt(vb)} (${b})`);
}

/** A percent column sums to 100% ±1 point; a column with no value above 0 is blank, not failed. */
function checkPercentColumn(x: Ctx, parts: CdsCode[], total: CdsCode | null, label: string) {
  if (!parts.some((p) => (x.v.num(p) ?? 0) > 0) || parts.some((p) => x.v.isText(p))) return;
  const sum = sumOf(x.v, parts);
  if (Math.abs(sum - 1) > 0.01) x.fail("sums-to-100", total ? [...parts, total] : parts, `${label}: shares sum to ${pct(sum)}, not 100% ±1`);
}

/** Within `rel` of a federal value (relative), when both exist. */
function relOff(a: number, b: number) {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** A split month/day pair: null when either half is missing; "invalid" (and a valid-date failure) when not a date. */
function pairDate(x: Ctx, m: CdsCode, d: CdsCode): MonthDay | null {
  const month = x.v.num(m);
  const day = x.v.num(d);
  if (month === null || day === null) return null;
  const md = monthDay(`${month}/${day}`);
  if (!md) x.fail("valid-date", [m, d], `${m}/${d}: month ${fmt(month)}, day ${fmt(day)} isn't a calendar date`);
  return md;
}

/** Position in a cycle that starts in `startMonth` (admissions: August → July; aid: September → August). */
const cyclePos = (d: MonthDay, startMonth: number) => ((d.month - startMonth + 12) % 12) * 100 + d.day;
const md = (d: MonthDay) => `${d.month}/${d.day}`;

function checkDateOrder(x: Ctx, early: MonthDay | null, late: MonthDay | null, startMonth: number, codes: CdsCode[], what: string) {
  if (early && late && cyclePos(late, startMonth) < cyclePos(early, startMonth)) x.fail("date-order", codes, `${what}: ${md(late)} comes before ${md(early)} in the cycle`);
}

/* ------------------------------------------------------------------ */
/* Section B                                                           */
/* ------------------------------------------------------------------ */

const B1_DEGREE_SEEKING = ["B.104", "B.110", "B.129", "B.135", "B.154", "B.160"];
const B1_FIRST_TIME = ["B.101", "B.107", "B.126", "B.132", "B.151", "B.157"];

/** B1: rows add up; unknown sex is small; agrees with federal enrollment one fall older. */
function checkB1(x: Ctx) {
  for (const s of SUMS.slice(0, B1_SEX.length + 2)) checkSum(x, s);
  const ds = sumOf(x.v, B1_DEGREE_SEEKING);
  if (!anyNum(x.v, B1_DEGREE_SEEKING) || ds <= 0) return;
  const unknown = sumOf(x.v, ["B.154", "B.160"]);
  if (unknown > 0.05 * ds) x.fail("out-of-range", run("B", 151, 163), `B1 unknown-sex degree-seeking ${fmt(unknown)} is over 5% of ${fmt(ds)}`);
  const f = x.federal;
  if (!f) return;
  if (f.undergrad_enrollment && relOff(ds, f.undergrad_enrollment) > 0.1) {
    x.fail("federal-disagrees", B1_DEGREE_SEEKING, `B1 degree-seeking undergraduates ${fmt(ds)} vs federal ${fmt(f.undergrad_enrollment)} (more than 10% apart)`);
  }
  const men = sumOf(x.v, ["B.104", "B.110"]) / ds;
  if (f.men_share != null && Math.abs(men - f.men_share) > 0.05) x.fail("federal-disagrees", ["B.104", "B.110"], `B1 men ${pct(men)} of degree-seeking vs federal ${pct(f.men_share)} (more than 5 points)`);
  const pt = sumOf(x.v, ["B.110", "B.135", "B.160"]) / ds;
  if (f.part_time_share != null && Math.abs(pt - f.part_time_share) > 0.05) x.fail("federal-disagrees", ["B.110", "B.135", "B.160"], `B1 part-time ${pct(pt)} vs federal ${pct(f.part_time_share)} (more than 5 points)`);
}

/** B2: columns add up; column 1 = B1 first-time, column 2 = B1 degree-seeking, column 3 = B1 all undergraduates; shares vs federal. */
function checkB2(x: Ctx) {
  const cols = [run("B", 201, 210), run("B", 211, 220), run("B", 221, 230)];
  for (const s of SUMS.filter((s) => ["B.210", "B.220", "B.230"].includes(s.total))) checkSum(x, s);
  const vsB1 = (total: CdsCode, b1: CdsCode[], col: CdsCode[], check: CheckId, what: string) => {
    const t = x.v.num(total);
    if (t === null || !anyNum(x.v, b1)) return;
    const want = sumOf(x.v, b1);
    if (Math.abs(t - want) > Math.max(1, 0.01 * want)) x.fail(check, col, `${what}: ${total} is ${fmt(t)}, B1 says ${fmt(want)} (more than 1% apart)`);
  };
  vsB1("B.210", B1_FIRST_TIME, cols[0], "enrollment-disagrees", "B2 column 1 vs B1 first-time first-years");
  vsB1("B.220", B1_DEGREE_SEEKING, cols[1], "enrollment-disagrees", "B2 column 2 vs B1 degree-seeking undergraduates");
  vsB1("B.230", ["B.176"], cols[2], "column-3-not-all-undergrads", "B2 column 3 vs B1 total undergraduates");
  const below: string[] = [];
  for (let i = 0; i < 9; i++) {
    const deg = x.v.num(c("B", 211 + i));
    const all = x.v.num(c("B", 221 + i));
    if (deg !== null && all !== null && all < deg) below.push(`${c("B", 221 + i)} ${fmt(all)} < ${fmt(deg)}`);
  }
  if (below.length) {
    const shown = below.length > 3 ? `${below.slice(0, 3).join(", ")} and ${below.length - 3} more` : below.join(", ");
    x.fail("column-3-not-all-undergrads", cols[2], `B2 column 3 has groups below their degree-seeking count (${shown})`);
  }
  const total = x.v.num("B.220");
  const race = x.federal?.race;
  if (!race || !total) return;
  const share = (codes: CdsCode[]) => sumOf(x.v, codes) / total;
  const groups: [keyof NonNullable<FederalBaseline["race"]>, CdsCode[]][] = [
    ["international", ["B.211"]], ["hispanic", ["B.212"]], ["black", ["B.213"]], ["white", ["B.214"]],
    ["asian", ["B.216"]], ["two_or_more", ["B.218"]], ["other", ["B.215", "B.217", "B.219"]],
  ];
  for (const [g, codes] of groups) {
    const s = share(codes);
    if (Math.abs(s - race[g]) > 0.05) x.fail("federal-disagrees", [...codes, "B.220"], `B2 ${g} ${pct(s)} of degree-seeking vs Scorecard ${pct(race[g])} (more than 5 points)`);
  }
}

const GRID_GROUPS: GradGroup[] = ["pell", "loan_no_pell", "no_pell_no_loan", "total"];
/** Graduation groups smaller than this have no rate shown (graduation-by-group.md), so no federal comparison. */
const MIN_GROUP = 30;

/** B4–B11: lines add up, completers ≤ final, rate = completers ÷ final; previous grid vs IPEDS GR; current vs federal. */
function checkGrid(x: Ctx) {
  for (const s of GRID_SUMS) checkSum(x, s);
  for (const base of [401, 501]) {
    for (let k = 0; k < 4; k++) {
      checkLe(x, gridCode(base, 6, k), gridCode(base, 2, k), `B${base === 401 ? 4 : 5} completers ≤ final cohort`);
      const final = x.v.num(gridCode(base, 2, k));
      const done = x.v.num(gridCode(base, 6, k));
      const rate = x.v.num(gridCode(base, 7, k));
      if (final && done !== null && rate !== null && Math.abs(done / final - rate) > 0.005) {
        x.fail("ratio-matches", [gridCode(base, 2, k), gridCode(base, 6, k), gridCode(base, 7, k)], `six-year rate ${pct(rate)} vs completers ÷ final ${pct(done / final)} (more than 0.5 point)`);
      }
    }
  }
  const f = x.federal;
  if (!f?.grad_rate && !f?.grad_cohorts) return;
  const current = run("B", 401, 432);
  for (let k = 0; k < 4; k++) {
    const g = GRID_GROUPS[k];
    const fedRate = f.grad_rate?.[g] ?? null;
    const fedCohort = f.grad_cohorts?.[g] ?? null;
    // The previous grid describes the cohort IPEDS GR has: tight agreement, or the current grid goes to review.
    const prevFinal = x.v.num(gridCode(501, 2, k));
    const prevRate = x.v.num(gridCode(501, 7, k));
    if (prevFinal !== null && fedCohort && relOff(prevFinal, fedCohort) > 0.02) {
      x.fail("previous-cohort-disagrees", current, `B5 ${g} final cohort ${fmt(prevFinal)} vs IPEDS GR ${fmt(fedCohort)} (more than 2% apart)`);
    }
    if (prevRate !== null && fedRate !== null && Math.abs(prevRate - fedRate) > 0.01) {
      x.fail("previous-cohort-disagrees", current, `B5 ${g} six-year rate ${pct(prevRate)} vs IPEDS GR ${pct(fedRate)} (more than 1 point)`);
    }
    // The current grid is one cohort newer than federal: a loose plausibility bound. Groups under 30 students are
    // skipped (their rates aren't shown: graduation-by-group.md), and cohorts may move ±25% between entering classes
    // (the spec's ±10% failed three of the four real workbooks: Illinois's Pell cohort grew 13%, W&M's loan group
    // shrank 22%).
    const col = Array.from({ length: 8 }, (_, line) => gridCode(401, line, k));
    const rate = x.v.num(gridCode(401, 7, k));
    const final = x.v.num(gridCode(401, 2, k));
    if (final !== null && final < MIN_GROUP) continue;
    if (rate !== null && fedRate !== null && Math.abs(rate - fedRate) > 0.05) x.fail("federal-disagrees", col, `B4 ${g} six-year rate ${pct(rate)} vs federal ${pct(fedRate)} one cohort older (more than 5 points)`);
    if (final !== null && fedCohort && relOff(final, fedCohort) > 0.25) x.fail("federal-disagrees", col, `B4 ${g} final cohort ${fmt(final)} vs federal ${fmt(fedCohort)} one cohort older (more than 25% apart)`);
  }
}

/** B22: retained ≤ cohort; stated rate = retained ÷ cohort ±0.5 point; within 5 points of federal retention. */
function checkB22(x: Ctx) {
  checkLe(x, "B.2202", "B.2201", "B22 retained ≤ cohort");
  const cohort = x.v.num("B.2201");
  const kept = x.v.num("B.2202");
  const rate = x.v.num("B.2203");
  const computed = cohort && kept !== null ? kept / cohort : null;
  if (computed !== null && rate !== null && Math.abs(computed - rate) > 0.005) {
    x.fail("ratio-matches", ["B.2201", "B.2202", "B.2203"], `B22 stated rate ${pct(rate)} vs retained ÷ cohort ${pct(computed)} (more than 0.5 point)`);
  }
  const shown = computed ?? rate;
  const fed = x.federal?.retention_rate;
  if (shown !== null && fed != null && Math.abs(shown - fed) > 0.05) {
    x.fail("federal-disagrees", ["B.2201", "B.2202", "B.2203"], `B22 retention ${pct(shown)} vs federal ${pct(fed)} one cohort older (more than 5 points)`);
  }
}

/* ------------------------------------------------------------------ */
/* Section C                                                           */
/* ------------------------------------------------------------------ */

/** The C1 extraction the round-1 checks take, from the record's totals (a derived total quotes its sum). */
function c1Extraction(doc: DocumentRecord, v: Vals, derived: Record<CdsCode, DerivedTotal> = {}): Extraction {
  const q = (k: CdsCode) => (derived[k] ? `Sum of ${derived[k].from.join(" + ")} | ${derived[k].v}` : doc.items[k]?.quote);
  const quotes: Extraction["quotes"] = {};
  if (q("C.116")) quotes.applicants = q("C.116");
  if (q("C.117")) quotes.admitted = q("C.117");
  if (q("C.118")) quotes.enrolled = q("C.118");
  return {
    cohort: "first-year",
    scope: "all-rounds",
    entering_term: doc.years.fall ?? null,
    applicants: v.num("C.116"),
    admitted: v.num("C.117"),
    enrolled: v.num("C.118"),
    acceptance_rate: null,
    quotes,
    page: doc.items["C.116"]?.page ?? null,
  };
}

/** Which C1 codes a round-1 check failure is about. `newer-than-federal` is the merge's rule, not a record check. */
const C1_CHECK_CODES: Partial<Record<CheckId, CdsCode[]>> = {
  "quote-present": C1_TOTALS,
  "funnel-order": C1_TOTALS,
  "plausible-change": ["C.116", "C.117"],
  "sources-agree": C1_TOTALS,
};

/** C1: sex rows sum to totals, full + part time = enrolled by sex, and the seven round-1 checks (kept as they were). */
function checkC1(x: Ctx) {
  for (const s of SUMS.filter((s) => s.total.startsWith("C.1") && s.total.length === 5)) checkSum(x, s);
  if (!anyNum(x.v, C1_TOTALS)) return;
  const f = x.federal;
  // A School-shaped view of the federal baseline for lib/reported-checks.ts (it reads only these three fields).
  const school = { admissions: { year: f?.admissions_year ?? null, applicants: f?.applicants ?? null, acceptance_rate: f?.acceptance_rate ?? null } } as unknown as School;
  const others = x.others
    .filter((o) => o !== x.doc && o.sha256 !== x.doc.sha256 && o.edition === x.doc.edition)
    .map((o) => c1Extraction(o, vals(valuesOf(o.items))));
  for (const fl of runChecks(c1Extraction(x.doc, x.v, x.derived), school, others)) {
    const codes = C1_CHECK_CODES[fl.check];
    if (codes) x.fail(fl.check, codes, `C1: ${fl.detail}`);
  }
}

/** C1 by residency (one status for the grid): funnel per residency; rows sum to C1's totals ±1%; shares vs IPEDS. */
function checkResidency(x: Ctx) {
  if (!anyNum(x.v, RESIDENCY)) return;
  const names = ["in-state", "out-of-state", "international", "unknown"];
  for (let r = 0; r < 4; r++) {
    const [applied, admitted, enrolled] = [0, 1, 2].map((i) => c("C", 119 + r * 3 + i));
    checkLe(x, admitted, applied, `${names[r]} admitted ≤ applied`, "residency-funnel", RESIDENCY);
    checkLe(x, enrolled, admitted, `${names[r]} enrolled ≤ admitted`, "residency-funnel", RESIDENCY);
  }
  for (let i = 0; i < 3; i++) {
    const row = [0, 1, 2, 3].map((r) => c("C", 119 + r * 3 + i));
    const total = x.v.num(C1_TOTALS[i]);
    if (total === null || !anyNum(x.v, row)) continue;
    const sum = sumOf(x.v, row);
    const tol = total < 100 ? 1 : 0.01 * total;
    if (Math.abs(sum - total) > tol) x.fail("residency-sum", RESIDENCY, `${["applied", "admitted", "enrolled"][i]} by residency sums to ${fmt(sum)}, C1 total ${C1_TOTALS[i]} is ${fmt(total)} (more than 1%)`);
  }
  const res = x.federal?.residence;
  const enrolled = x.v.num("C.118") ?? sumOf(x.v, ["C.121", "C.124", "C.127", "C.130"]);
  if (!res || !enrolled) return;
  const shares: [string, CdsCode, number][] = [["in-state", "C.121", res.in_state], ["other states", "C.124", res.out_of_state], ["international", "C.127", res.international]];
  for (const [name, code, fed] of shares) {
    const n = x.v.num(code);
    if (n === null) continue;
    const s = n / enrolled;
    if (Math.abs(s - fed) > 0.1) x.fail("residency-vs-federal", RESIDENCY, `${name} enrolled ${pct(s)} of first-years vs federal ${pct(fed)} (more than 10 points)`);
  }
}

/** C2 wait list: admitted ≤ accepted ≤ offered; offered ≤ C1 applicants; admitted ≤ C1 admits; "No" with counts. */
function checkC2(x: Ctx) {
  checkLe(x, "C.203", "C.202", "wait list accepted ≤ offered");
  checkLe(x, "C.204", "C.203", "wait list admitted ≤ accepted");
  if (!x.v.num("C.203")) checkLe(x, "C.204", "C.202", "wait list admitted ≤ offered");
  checkLe(x, "C.202", "C.116", "wait list offered ≤ C1 applicants", "order", ["C.202"]);
  checkLe(x, "C.204", "C.117", "wait list admitted ≤ C1 admits", "order", ["C.204"]);
  const counts = ["C.202", "C.203", "C.204"].filter((k) => (x.v.num(k) ?? 0) > 0);
  if (x.v.bool("C.201") === false && counts.length) x.fail("inconsistent", ["C.201", ...counts], "C2 says no wait list but reports wait-list counts");
}

/** C5 units: subjects sum to the total (C.501/C.513); lab ≤ science; recommended ≥ required per subject. */
function checkC5(x: Ctx) {
  for (const s of SUMS.filter((s) => s.total === "C.501" || s.total === "C.513")) checkSum(x, s);
  checkLe(x, "C.505", "C.504", "C5 required lab units ≤ science");
  checkLe(x, "C.517", "C.516", "C5 recommended lab units ≤ science");
  for (let i = 0; i < 11; i++) {
    if (i === 4) continue; // lab is a subset, compared above
    checkLe(x, c("C", 501 + i), c("C", 513 + i), "C5 required ≤ recommended");
  }
}

/** C7 levels from words or the template's codes (VI, I, C, NC); null for anything that isn't exactly one level. */
export function c7Level(s: string): string | null {
  let t = s.toLowerCase().replace(/\s+/g, " ").trim();
  const code = { vi: "very_important", i: "important", c: "considered", nc: "not_considered" }[t];
  if (code) return code;
  const found: string[] = [];
  for (const [words, level] of [["very important", "very_important"], ["not considered", "not_considered"], ["important", "important"], ["considered", "considered"]]) {
    if (t.includes(words)) {
      found.push(level);
      t = t.split(words).join(" ");
    }
  }
  return found.length === 1 ? found[0] : null;
}

/** C7: exactly one level per factor; at least 9 of 18 marked; not every mark in one column (a misread grid). */
function checkC7(x: Ctx) {
  const rows = run("C", 701, 718);
  const levels: string[] = [];
  for (const k of rows) {
    const t = x.v.text(k);
    if (t === null) continue;
    const level = c7Level(t);
    if (!level) x.fail("one-mark", [k], `C7 ${k} "${t}" isn't exactly one of Very Important, Important, Considered, Not Considered`);
    else levels.push(level);
  }
  if (!levels.length) return;
  if (levels.length < 9) x.fail("one-mark", rows, `C7 has ${levels.length} of 18 factors marked (a column misread, not a sparse grid)`);
  else if (new Set(levels).size === 1) x.fail("one-mark", rows, `C7 marks every factor "${levels[0].replace("_", " ")}" (the column positions are off)`);
}

type TestUse = "required" | "recommended" | "considered" | "not-considered";
/** C8 grid words → one use; null for words that name none or two. */
function testUse(s: string): TestUse | null {
  const t = s.toLowerCase();
  const found = new Set<TestUse>();
  if (/not considered|not used|even if submitted|blind/.test(t)) found.add("not-considered");
  else if (/considered if submitted|not required|optional/.test(t)) found.add("considered");
  else if (/required/.test(t)) found.add("required");
  if (/recommend/.test(t)) found.add("recommended");
  return found.size === 1 ? [...found][0] : null;
}

/** C8: one use per row; C8A agrees with the grid; C8F's words don't contradict the headline policy. */
function checkC8(x: Ctx) {
  const rows = ["C.802", "C.803", "C.804"];
  const uses = new Map<CdsCode, TestUse>();
  for (const k of rows) {
    const t = x.v.text(k);
    if (t === null) continue;
    const u = testUse(t);
    if (u) uses.set(k, u);
    else if (/required/i.test(t) && /considered/i.test(t) && !/not required/i.test(t)) x.fail("one-mark", [k], `C8 ${k} "${t}" marks two policies`);
  }
  const usesTests = x.v.bool("C.801");
  if (usesTests === true && rows.every((k) => x.v.get(k) === undefined)) x.fail("inconsistent", ["C.801"], "C8A says SAT/ACT are used, but no row of the policy grid is marked");
  if (usesTests === false) {
    const marked = [...uses].filter(([, u]) => u !== "not-considered").map(([k]) => k);
    if (marked.length) x.fail("inconsistent", ["C.801", ...marked], "C8A says SAT/ACT aren't used, but the grid marks a use");
  }
  if (usesTests === true && uses.get("C.802") === "not-considered") x.fail("inconsistent", ["C.801", "C.802"], 'C8A says SAT/ACT are used, but "SAT or ACT" is marked not considered');
  const note = x.v.text("C.8F")?.toLowerCase();
  const headline = uses.get("C.802");
  if (note && headline) {
    const contradicts =
      (/test[- ]blind|not consider/.test(note) && (headline === "required" || headline === "considered")) ||
      (/optional/.test(note) && headline === "required") ||
      (/(?<!not )required/.test(note) && !/optional/.test(note) && (headline === "considered" || headline === "not-considered"));
    if (contradicts) x.fail("inconsistent", ["C.802", "C.8F"], `C8F "${x.v.text("C.8F")!.slice(0, 80)}" contradicts the "SAT or ACT" row (${headline})`);
  }
}

/** C9 percentile rows (25th, 50th, 75th) and score bands (top band first) with their lower edges. */
const C9_ROWS: [string, CdsCode[]][] = [
  ["SAT composite", run("C", 905, 907)], ["SAT EBRW", run("C", 908, 910)], ["SAT Math", run("C", 911, 913)],
  ["ACT composite", run("C", 914, 916)], ["ACT Math", run("C", 917, 919)], ["ACT English", run("C", 920, 922)],
  ["ACT Writing", run("C", 923, 925)], ["ACT Science", run("C", 926, 928)], ["ACT Reading", run("C", 929, 931)],
];
const SAT_SECTION_EDGES = [700, 600, 500, 400, 300, 200];
const SAT_COMPOSITE_EDGES = [1400, 1200, 1000, 800, 600, 400];
const ACT_EDGES = [30, 24, 18, 12, 6, 0];
/** Scores are reported to the nearest 10 (SAT) or 1 (ACT): a percentile this close to a band edge may sit on either side. */
const EDGE_SLACK = { sat: 10, act: 1 };
const C9_BANDS: { label: string; parts: CdsCode[]; total: CdsCode; edges: number[]; percentiles: CdsCode[] | null }[] = [
  { label: "SAT EBRW bands", parts: run("C", 932, 937), total: "C.938", edges: SAT_SECTION_EDGES, percentiles: run("C", 908, 910) },
  { label: "SAT Math bands", parts: run("C", 939, 944), total: "C.945", edges: SAT_SECTION_EDGES, percentiles: run("C", 911, 913) },
  { label: "SAT composite bands", parts: run("C", 946, 951), total: "C.952", edges: SAT_COMPOSITE_EDGES, percentiles: run("C", 905, 907) },
  { label: "ACT composite bands", parts: run("C", 953, 958), total: "C.959", edges: ACT_EDGES, percentiles: run("C", 914, 916) },
  { label: "ACT English bands", parts: run("C", 960, 965), total: "C.966", edges: ACT_EDGES, percentiles: run("C", 920, 922) },
  { label: "ACT Math bands", parts: run("C", 967, 972), total: "C.973", edges: ACT_EDGES, percentiles: run("C", 917, 919) },
  { label: "ACT Reading bands", parts: run("C", 974, 979), total: "C.980", edges: ACT_EDGES, percentiles: run("C", 929, 931) },
  { label: "ACT Science bands", parts: run("C", 981, 986), total: "C.987", edges: ACT_EDGES, percentiles: run("C", 926, 928) },
];

/** C9: percentile order; composite ≈ EBRW + Math (±50); number vs share; bands sum and agree with percentiles; vs federal. */
function checkC9(x: Ctx) {
  for (const [label, [p25, p50, p75]] of C9_ROWS) {
    checkLe(x, p25, p50, `${label} 25th ≤ 50th`);
    checkLe(x, p50, p75, `${label} 50th ≤ 75th`);
    if (x.v.num(p50) === null) checkLe(x, p25, p75, `${label} 25th ≤ 75th`);
  }
  for (let i = 0; i < 3; i++) {
    const [comp, ebrw, math] = [905 + i, 908 + i, 911 + i].map((n) => c("C", n));
    const vc = x.v.num(comp);
    const ve = x.v.num(ebrw);
    const vm = x.v.num(math);
    if (vc !== null && ve !== null && vm !== null && Math.abs(vc - (ve + vm)) > 50) {
      x.fail("parts-sum", [comp, ebrw, math], `SAT ${[25, 50, 75][i]}th: composite ${vc} vs EBRW + Math ${ve + vm} (more than 50 apart)`);
    }
  }
  const enrolled = x.items["C.118"]?.status === "failed" ? null : x.v.num("C.118");
  for (const [shareCode, numberCode, test] of [["C.901", "C.903", "SAT"], ["C.902", "C.904", "ACT"]] as const) {
    const n = x.v.num(numberCode);
    const s = x.v.num(shareCode);
    if (n === null || !enrolled) continue;
    if (n > enrolled) x.fail("order", [numberCode], `${test} submitters ${fmt(n)} > C1 enrolled ${fmt(enrolled)}`);
    else if (s !== null && Math.abs(s - n / enrolled) > 0.01) x.fail("ratio-matches", [shareCode, numberCode], `${test} submitting ${pct(s)} vs ${fmt(n)} ÷ C1 enrolled ${fmt(enrolled)} = ${pct(n / enrolled)} (more than 1 point)`);
  }
  for (const b of C9_BANDS) {
    checkPercentColumn(x, b.parts, b.total, b.label);
    if (!b.percentiles || !b.parts.some((p) => (x.v.num(p) ?? 0) > 0)) continue;
    // Shares from the bottom band up: the band holding the p-th percentile has p between its floor and ceiling share.
    const shares = b.parts.map((p) => x.v.num(p) ?? 0);
    for (const [p, code] of [[0.25, b.percentiles[0]], [0.75, b.percentiles[2]]] as const) {
      const score = x.v.num(code);
      if (score === null) continue;
      const slack = b.edges[0] >= 100 ? EDGE_SLACK.sat : EDGE_SLACK.act;
      // The bands the score may sit in (one, or two when it is within the reporting precision of an edge).
      const bands = [...new Set([score - slack, score, score + slack].map((s) => b.edges.findIndex((edge) => s >= edge)).filter((i) => i >= 0))];
      if (!bands.length) continue;
      const below = shares.slice(Math.max(...bands) + 1).reduce((a, s) => a + s, 0);
      const through = shares.slice(Math.min(...bands)).reduce((a, s) => a + s, 0);
      if (p < below - 0.02 || p > through + 0.02) {
        x.fail("order", [code, ...b.parts], `${b.label}: the ${p * 100}th percentile ${score} sits in bands holding ${pct(below)}–${pct(through)} of students`);
      }
    }
  }
  const f = x.federal;
  if (!f) return;
  const near = (codes: [CdsCode, CdsCode], fed: [number, number] | null, tol: number, what: string) => {
    if (!fed) return;
    codes.forEach((k, i) => {
      const val = x.v.num(k);
      if (val !== null && Math.abs(val - fed[i]) > tol) x.fail("federal-disagrees", [k], `${what} ${["25th", "75th"][i]} ${val} vs federal ${fed[i]} (more than ${tol} apart)`);
    });
  };
  near(["C.908", "C.910"], f.sat_reading_25_75, 50, "SAT EBRW");
  near(["C.911", "C.913"], f.sat_math_25_75, 50, "SAT Math");
  near(["C.914", "C.916"], f.act_composite_25_75, 3, "ACT composite");
}

/** C10: top tenth ≤ quarter ≤ half; bottom quarter ≤ bottom half; top half + bottom half = 100 ±1; share needed. */
function checkC10(x: Ctx) {
  checkLe(x, "C.1001", "C.1002", "top tenth ≤ top quarter");
  checkLe(x, "C.1002", "C.1003", "top quarter ≤ top half");
  checkLe(x, "C.1005", "C.1004", "bottom quarter ≤ bottom half");
  const top = x.v.num("C.1003");
  const bottom = x.v.num("C.1004");
  if (top !== null && bottom !== null && Math.abs(top + bottom - 1) > 0.01) x.fail("sums-to-100", ["C.1003", "C.1004"], `top half ${pct(top)} + bottom half ${pct(bottom)} isn't 100% ±1`);
  const bands = run("C", 1001, 1005);
  if (anyNum(x.v, bands) && x.v.num("C.1006") === null) x.fail("inconsistent", bands, "class-rank bands without the share of first-years who submitted a rank");
}

/** C11: each column 100% ±1; with all three columns, each "all" band lies between the other two (±1 point). */
function checkC11(x: Ctx) {
  const cols = [run("C", 1101, 1109), run("C", 1111, 1119), run("C", 1121, 1129)];
  cols.forEach((col, i) => checkPercentColumn(x, col, c("C", 1110 + i * 10), `C11 GPA column ${i + 1}`));
  const filled = cols.map((col) => col.some((k) => (x.v.num(k) ?? 0) > 0));
  if (!filled.every(Boolean)) return;
  for (let b = 0; b < 9; b++) {
    const [w, wo, all] = cols.map((col) => x.v.num(col[b]) ?? 0);
    if (all < Math.min(w, wo) - 0.01 || all > Math.max(w, wo) + 0.01) {
      x.fail("order", [cols[0][b], cols[1][b], cols[2][b]], `C11 band ${b + 1}: all students ${pct(all)} isn't between ${pct(w)} and ${pct(wo)}`);
    }
  }
}

/** C14: valid dates; the regular closing date comes on or after early decision and early action closing. */
function checkC14(x: Ctx) {
  const regular = pairDate(x, "C.1402", "C.1403");
  pairDate(x, "C.1404", "C.1405");
  const early: [MonthDay | null, string][] = [
    [x.v.bool("C.2101") === false ? null : datePeek(x, "C.2102", "C.2103"), "early decision closing"],
    [x.v.bool("C.2101") === false ? null : datePeek(x, "C.2106", "C.2107"), "other early decision closing"],
    [x.v.bool("C.2201") === false ? null : datePeek(x, "C.2202", "C.2203"), "early action closing"],
  ];
  for (const [d, what] of early) checkDateOrder(x, d, regular, 8, ["C.1402", "C.1403"], `regular closing vs ${what}`);
}

/** A split date without reporting it (its own group reports an invalid date once). */
function datePeek(x: Ctx, m: CdsCode, d: CdsCode): MonthDay | null {
  const month = x.v.num(m);
  const day = x.v.num(d);
  return month === null || day === null ? null : monthDay(`${month}/${day}`);
}

/** At most one box checked in a single-choice list; zero is blank. */
function checkOneOf(x: Ctx, codes: CdsCode[], what: string) {
  const on = codes.filter((k) => x.v.bool(k) === true);
  if (on.length > 1) x.fail("one-mark", on, `${what}: ${on.length} options checked (${on.join(", ")})`);
}

/** C16–C17: one notification kind and one reply kind; valid dates; reply on or after a concrete notification date. */
function checkC16C17(x: Ctx) {
  checkOneOf(x, ["C.1601", "C.1604", "C.1607"], "C16 notification");
  checkOneOf(x, ["C.1701", "C.1704", "C.1705", "C.1707"], "C17 reply policy");
  pairDate(x, "C.1602", "C.1603");
  const notified = pairDate(x, "C.1605", "C.1606");
  const reply = pairDate(x, "C.1702", "C.1703");
  pairDate(x, "C.1709", "C.1710");
  checkDateOrder(x, notified, reply, 8, ["C.1702", "C.1703"], "reply date vs notification date");
  const weeks = x.v.num("C.1706");
  if (weeks !== null && (weeks < 1 || weeks > 12)) x.fail("out-of-range", ["C.1706"], `C17 reply within ${weeks} weeks isn't 1–12`);
}

/** C21: ED admits ≤ ED applications ≤ C1 applicants; admits ≤ C1 admits; "No" with counts or dates; date order. */
function checkC21(x: Ctx) {
  checkLe(x, "C.2111", "C.2110", "early decision admits ≤ applications");
  checkLe(x, "C.2110", "C.116", "early decision applications ≤ C1 applicants", "order", ["C.2110"]);
  checkLe(x, "C.2111", "C.117", "early decision admits ≤ C1 admits", "order", ["C.2111"]);
  const filled = run("C", 2102, 2111).filter((k) => x.v.get(k) !== undefined);
  if (x.v.bool("C.2101") !== true && filled.length) {
    x.fail("inconsistent", ["C.2101", ...filled], `C21 doesn't say early decision is offered, but reports ${filled.join(", ")}`);
  }
  const close1 = pairDate(x, "C.2102", "C.2103");
  const note1 = pairDate(x, "C.2104", "C.2105");
  const close2 = pairDate(x, "C.2106", "C.2107");
  const note2 = pairDate(x, "C.2108", "C.2109");
  checkDateOrder(x, close1, note1, 8, ["C.2104", "C.2105"], "early decision notification vs closing");
  checkDateOrder(x, close2, note2, 8, ["C.2108", "C.2109"], "other early decision notification vs closing");
  checkDateOrder(x, close1, close2, 8, ["C.2106", "C.2107"], "other early decision closing vs first closing");
}

/** C22: valid dates; notification after closing; "No" with dates; restrictive without an offered plan. */
function checkC22(x: Ctx) {
  const close = pairDate(x, "C.2202", "C.2203");
  const note = pairDate(x, "C.2204", "C.2205");
  checkDateOrder(x, close, note, 8, ["C.2204", "C.2205"], "early action notification vs closing");
  const dates = run("C", 2202, 2205).filter((k) => x.v.get(k) !== undefined);
  if (x.v.bool("C.2201") === false && dates.length) x.fail("inconsistent", ["C.2201", ...dates], "C22 says no early action, but gives early action dates");
  if (x.v.bool("C.2206") === true && x.v.bool("C.2201") !== true) x.fail("inconsistent", ["C.2201", "C.2206"], "C22 marks a restrictive plan without an early action plan");
}

/* ------------------------------------------------------------------ */
/* Section D                                                           */
/* ------------------------------------------------------------------ */

/** D1–D2: sex columns sum to totals; enrolled ≤ admitted ≤ applied; D1 "No" with applicants; within 25% of federal. */
function checkD2(x: Ctx) {
  for (const s of SUMS.filter((s) => s.total.startsWith("D.2"))) checkSum(x, s);
  for (let i = 0; i < 4; i++) {
    checkLe(x, c("D", 205 + i), c("D", 201 + i), "D2 admitted ≤ applied");
    checkLe(x, c("D", 209 + i), c("D", 205 + i), "D2 enrolled ≤ admitted");
  }
  if (x.v.bool("D.101") === false && (x.v.num("D.204") ?? 0) > 0) x.fail("inconsistent", ["D.101", "D.204"], "D1 says no transfers are enrolled, but D2 reports transfer applicants");
  const enrolled = x.v.num("D.212");
  const fed = x.federal?.transfer_in;
  if (enrolled !== null && fed && relOff(enrolled, fed) > 0.25) {
    x.fail("federal-disagrees", run("D", 209, 212), `D2 transfers enrolled ${fmt(enrolled)} vs federal new transfers ${fmt(fed)} (more than 25% apart)`);
  }
}

/** D4–D7: credits 0–200 (GPA ranges are the type check); D5: one requirement level per material. */
function checkDPolicies(x: Ctx) {
  const credits = x.v.num("D.402");
  if (credits !== null && credits > 200) x.fail("out-of-range", ["D.402"], `D4 minimum credits ${credits} is over 200`);
  for (const k of run("D", 501, 506)) {
    const t = x.v.text(k)?.toLowerCase();
    if (!t) continue;
    const kinds = [/not required/.test(t), /recommend/.test(t), /(?<!not )required/.test(t)].filter(Boolean).length;
    if (kinds > 1) x.fail("one-mark", [k], `D5 ${k} "${x.v.text(k)}" marks more than one requirement level`);
  }
}

/** D9: valid dates; per term, closing on or after priority, reply on or after notification (rolling skips that). */
function checkD9(x: Ctx) {
  // Terms: fall, winter, spring, summer. Codes: priority 901+2t, closing 909+2t, notification 917+2t, reply 925+2t.
  const cycleStart = [9, 2, 2, 7];
  ["fall", "winter", "spring", "summer"].forEach((term, t) => {
    const at = (base: number) => pairDate(x, c("D", base + 2 * t), c("D", base + 2 * t + 1));
    const [priority, closing, notification, reply] = [901, 909, 917, 925].map(at);
    checkDateOrder(x, priority, closing, cycleStart[t], [c("D", 909 + 2 * t), c("D", 910 + 2 * t)], `D9 ${term} closing vs priority`);
    if (x.v.bool(c("D", 933 + t)) !== true) checkDateOrder(x, notification, reply, cycleStart[t], [c("D", 925 + 2 * t), c("D", 926 + 2 * t)], `D9 ${term} reply vs notification`);
  });
}

/* ------------------------------------------------------------------ */
/* Section G                                                           */
/* ------------------------------------------------------------------ */

/** G0: the net price calculator is a URL. (G.002's "not final" flag is shown as provisional, not a failure.) */
function checkG0(x: Ctx) {
  const url = x.v.text("G.001");
  if (url !== null && !/^(https?:\/\/|www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(url.trim())) x.fail("not-a-url", ["G.001"], `G.001 "${url.slice(0, 60)}" isn't a URL`);
}

/** G1: tuition + required fees ≥ 95% of federal tuition and fees; housing + food ≈ food and housing (±1%). */
function checkG1(x: Ctx) {
  const f = x.federal;
  const floor = (tuition: CdsCode, fees: CdsCode, fed: number | null | undefined, what: string) => {
    const t = x.v.num(tuition);
    if (t === null || !fed) return;
    const total = t + (x.v.num(fees) ?? 0);
    if (total < 0.95 * fed) x.fail("federal-disagrees", [tuition], `${what} tuition + fees $${fmt(total)} is under 95% of federal tuition and fees $${fmt(fed)}`);
  };
  floor("G.101", "G.111", f?.tuition_in_state, "G1 first-year");
  floor("G.102", "G.115", f?.tuition_in_state, "G1 undergraduate");
  floor("G.104", "G.111", f?.tuition_in_state, "G1 first-year in-state");
  floor("G.108", "G.115", f?.tuition_in_state, "G1 undergraduate in-state");
  floor("G.105", "G.111", f?.tuition_out_of_state, "G1 first-year out-of-state");
  floor("G.109", "G.115", f?.tuition_out_of_state, "G1 undergraduate out-of-state");
  for (const [both, housing, food] of [["G.112", "G.113", "G.114"], ["G.116", "G.117", "G.118"]]) {
    const b = x.v.num(both);
    const h = x.v.num(housing);
    const fd = x.v.num(food);
    if (b !== null && h !== null && fd !== null && Math.abs(h + fd - b) > Math.max(1, 0.01 * b)) {
      x.fail("parts-sum", [both, housing, food], `G1 housing $${fmt(h)} + food $${fmt(fd)} vs food and housing $${fmt(b)} (more than 1% apart)`);
    }
  }
}

/** The out-of-state cost of attendance × 1.1 (G1 when read, else federal): the bound for aid averages (H2A, H6). */
function costBound(x: Ctx): number | null {
  const tuition = x.v.num("G.105") ?? x.v.num("G.101");
  const g1 = tuition !== null ? tuition + (x.v.num("G.111") ?? 0) + (x.v.num("G.112") ?? 0) : null;
  const coa = g1 ?? x.federal?.cost_of_attendance ?? null;
  return coa ? coa * 1.1 : null;
}

/* ------------------------------------------------------------------ */
/* Section H                                                           */
/* ------------------------------------------------------------------ */

/** H0: at most one methodology marked. (H.101's aid year is the reader's `aid-year` failure on the aid items.) */
function checkH0(x: Ctx) {
  checkOneOf(x, ["H.102", "H.103", "H.104"], "H0 methodology");
}

/** H1: grant rows sum to "Total Scholarships/Grants" and self-help rows to "Total Self-Help", ±$1K. */
function checkH1(x: Ctx) {
  for (const s of SUMS.filter((s) => s.total.startsWith("H.1"))) checkSum(x, s);
}

/** H2 by column (first-years, full-time, part-time): line order, line I, the package bound, and line A vs B1. */
function checkH2(x: Ctx) {
  const names = ["first-year", "full-time", "part-time"];
  const aidYearStart = /^(\d{4})/.exec(x.doc.years["aid-year"] ?? "")?.[1];
  const editionStart = parseEdition(x.doc.edition)?.start;
  [201, 214, 227].forEach((base, col) => {
    const L = (letter: string) => c("H", base + "ABCDEFGHIJKLM".indexOf(letter));
    const name = `H2 ${names[col]}`;
    checkLe(x, L("B"), L("A"), `${name} B ≤ A`);
    checkLe(x, L("C"), L("B"), `${name} C ≤ B`);
    checkLe(x, L("D"), L("C"), `${name} D ≤ C`);
    for (const l of ["E", "F", "G", "H"]) checkLe(x, L(l), L("D"), `${name} ${l} ≤ D`);
    const N = h2a(1 + col * 4);
    const a = x.v.num(L("A"));
    const cc = x.v.num(L("C"));
    const n = x.v.num(N);
    if (a !== null && cc !== null && n !== null && n > a - cc) x.fail("order", [N, L("A"), L("C")], `${name} N ${fmt(n)} > A − C (${fmt(a - cc)}): students without need outnumber those not found needy`);
    const d = x.v.num(L("D"));
    const h = x.v.num(L("H"));
    const i = x.v.num(L("I"));
    if (d && h !== null && i !== null) {
      if (h === d && i < 0.99) x.fail("ratio-matches", [L("H"), L("I")], `${name}: every aided student's need was met (H = D), but I says ${pct(i)}`);
      if (i >= 0.9999 && h < 0.95 * d) x.fail("ratio-matches", [L("H"), L("I")], `${name}: I says 100% of need met, but only ${fmt(h)} of ${fmt(d)} had need fully met`);
    }
    // J (average package) contains K and L (and non-need grants): J ≥ K and K×E + L×F ≤ 1.05 × J×D.
    checkLe(x, L("K"), L("J"), `${name} K ≤ J`);
    const [e, fv, j, k, l] = ["E", "F", "J", "K", "L"].map((q) => x.v.num(L(q)));
    if (d && e !== null && fv !== null && j !== null && k !== null && l !== null && k * e + l * fv > 1.05 * j * d) {
      x.fail("order", [L("J"), L("K"), L("L")], `${name}: K×E + L×F = $${fmt(k * e + l * fv)} exceeds 1.05 × J×D = $${fmt(1.05 * j * d)}`);
    }
    // Line A against B1 when H2 describes the edition's own year (an "estimated" report): within 2%.
    if (col < 2 && aidYearStart && editionStart && Number(aidYearStart) === editionStart && a !== null) {
      const b1 = col === 0 ? ["B.101", "B.126", "B.151"] : ["B.104", "B.129", "B.154"];
      if (anyNum(x.v, b1)) {
        const want = sumOf(x.v, b1);
        if (Math.abs(a - want) > Math.max(1, 0.02 * want)) x.fail("enrollment-disagrees", [L("A")], `${name} line A ${fmt(a)} vs B1 ${fmt(want)} (more than 2% apart, same year)`);
      }
    }
  });
}

/** H2A: N and P ≤ H2 line A; averages ≤ cost of attendance; P×Q vs H1 athletic dollars; no athletic aid at NCAA III. */
function checkH2A(x: Ctx) {
  const bound = costBound(x);
  [201, 214, 227].forEach((aCode, col) => {
    const [N, O, P, Q] = [1, 2, 3, 4].map((i) => h2a(i + col * 4));
    const A = c("H", aCode);
    checkLe(x, N, A, "H2A N ≤ H2 line A", "order", [N]);
    checkLe(x, P, A, "H2A P ≤ H2 line A", "order", [P]);
    for (const avg of [O, Q]) {
      const v = x.v.num(avg);
      if (v !== null && bound && v > bound) x.fail("out-of-range", [avg], `${avg} average $${fmt(v)} exceeds the cost of attendance × 1.1 ($${fmt(Math.round(bound))})`);
    }
  });
  const [p, q] = [x.v.num("H.2A07"), x.v.num("H.2A08")];
  const athletic = (x.v.num("H.116") ?? 0) + (x.v.num("H.127") ?? 0);
  if (p && q && athletic > 0) {
    const ratio = (p * q) / athletic;
    if (ratio < 0.5 || ratio > 1.5) x.fail("ratio-matches", ["H.2A07", "H.2A08"], `H2A P × Q = $${fmt(p * q)} is ×${ratio.toFixed(2)} of H1's athletic awards $${fmt(athletic)} (need ×0.5–×1.5)`);
  }
  if (x.federal?.ncaa_division === "III") {
    const given = [3, 7, 11].map(h2a).filter((k) => (x.v.num(k) ?? 0) > 0);
    if (given.length) x.fail("inconsistent", given, "athletic scholarships at an NCAA Division III college");
  }
}

/** H4: a positive class no larger than B1's undergraduates. */
function checkH4(x: Ctx) {
  const n = x.v.num("H.401");
  if (n !== null && n <= 0) x.fail("out-of-range", ["H.401"], "H4 graduating class isn't positive");
  checkLe(x, "H.401", "B.176", "H4 graduates ≤ B1 total undergraduates", "enrollment-disagrees", ["H.401"]);
}

/** H5: each count ≤ H4; any loan ≥ each source and ≤ their sum; federal-row average ×0.5–×2 of Scorecard median debt. */
function checkH5(x: Ctx) {
  for (const k of run("H", 501, 505)) checkLe(x, k, "H.401", `H5 ${k} borrowers ≤ H4 graduates`, "order", [k]);
  for (const [any, from] of [["H.501", 502], ["H.506", 507]] as const) {
    const sources = run("H", from, from + 3);
    for (const s of sources) checkLe(x, s, any, `H5 any loan ≥ each source`, "order", [any, s]);
    const a = x.v.num(any);
    if (a !== null && anyNum(x.v, sources) && a > sumOf(x.v, sources) + (any === "H.501" ? 1 : 0.01)) {
      x.fail("parts-sum", [any, ...sources], `H5 any loan ${any === "H.501" ? fmt(a) : pct(a)} exceeds the four sources summed`);
    }
  }
  const debt = x.federal?.median_debt;
  const fedAvg = x.v.num("H.512");
  if (debt && fedAvg) {
    const ratio = fedAvg / debt;
    if (ratio < 0.5 || ratio > 2) x.fail("federal-disagrees", ["H.511", "H.512"], `H5 federal-loan average $${fmt(fedAvg)} is ×${ratio.toFixed(2)} of Scorecard's median debt $${fmt(debt)} (need ×0.5–×2)`);
  }
  const anyAvg = x.v.num("H.511");
  if (debt && anyAvg) {
    const ratio = anyAvg / debt;
    if (ratio < 0.25 || ratio > 4) x.fail("federal-disagrees", ["H.511"], `H5 any-loan average $${fmt(anyAvg)} is ×${ratio.toFixed(2)} of Scorecard's median debt $${fmt(debt)} (need ×0.25–×4)`);
  }
}

/** H6: average × number ≈ total (±5%); average ≤ cost; number ≤ B2 nonresidents × 1.05; "not available" excludes aid. */
function checkH6(x: Ctx) {
  const [n, avg, total] = [x.v.num("H.604"), x.v.num("H.605"), x.v.num("H.606")];
  if (n !== null && avg !== null && total !== null && total > 0 && relOff(n * avg, total) > 0.05) {
    x.fail("ratio-matches", ["H.604", "H.605", "H.606"], `H6 average $${fmt(avg)} × ${fmt(n)} = $${fmt(n * avg)} vs total $${fmt(total)} (more than 5% apart)`);
  }
  const bound = costBound(x);
  if (avg !== null && bound && avg > bound) x.fail("out-of-range", ["H.605"], `H6 average $${fmt(avg)} exceeds the cost of attendance × 1.1 ($${fmt(Math.round(bound))})`);
  const nonres = x.v.num("B.211");
  if (n !== null && nonres !== null && n > nonres * 1.05) x.fail("enrollment-disagrees", ["H.604"], `H6 ${fmt(n)} awards > B2 nonresident degree-seeking ${fmt(nonres)} × 1.05`);
  if (x.v.bool("H.603") === true) {
    const conflict = ["H.601", "H.602"].filter((k) => x.v.bool(k) === true).concat(run("H", 604, 606).filter((k) => (x.v.num(k) ?? 0) > 0));
    if (conflict.length) x.fail("inconsistent", ["H.603", ...conflict], "H6 says institutional aid isn't available to nonresidents, but reports some");
  }
}

/** H7–H8: FAFSA whenever any H8 form is listed; the methodology agrees with the forms. */
function checkH8(x: Ctx) {
  const forms = run("H", 801, 806).filter((k) => x.v.bool(k) === true);
  if (forms.length && x.v.bool("H.801") !== true) x.fail("inconsistent", forms, "H8 lists forms but not the FAFSA (every college here takes federal aid)");
  const im = x.v.bool("H.103") === true || x.v.bool("H.104") === true;
  const css = x.v.bool("H.803") === true || x.v.bool("H.802") === true;
  if (im && !css) x.fail("inconsistent", ["H.103", "H.104"], "institutional methodology without the CSS Profile or the college's own form");
  if (x.v.bool("H.102") === true && !im && x.v.bool("H.803") === true) x.fail("inconsistent", ["H.102", "H.803"], "federal methodology only, yet the CSS Profile is required");
}

/** H9–H11: valid dates; not both deadline and no deadline, nor dated and rolling notification; cycle order Sept → Aug. */
function checkH9H11(x: Ctx) {
  const priority = pairDate(x, "H.902", "H.903");
  const deadline = pairDate(x, "H.905", "H.906");
  const notified = pairDate(x, "H.1002", "H.1003");
  const rolling = pairDate(x, "H.1005", "H.1006");
  const reply = pairDate(x, "H.1101", "H.1102");
  if (x.v.bool("H.904") === true && x.v.bool("H.907") === true) x.fail("one-mark", ["H.904", "H.907"], "H9 checks both a deadline and no deadline");
  if (x.v.bool("H.1001") === true && x.v.bool("H.1004") === true) x.fail("one-mark", ["H.1001", "H.1004"], "H10 checks both a notification date and rolling notification");
  checkDateOrder(x, priority, deadline, 9, ["H.902", "H.903", "H.905", "H.906"], "H9 deadline vs priority date");
  checkDateOrder(x, priority, notified, 9, ["H.1002", "H.1003"], "H10 notification vs priority date");
  checkDateOrder(x, notified ?? rolling, reply, 9, ["H.1101", "H.1102"], "H11 reply vs notification");
  const weeks = x.v.num("H.1103");
  if (weeks !== null && (weeks < 1 || weeks > 12)) x.fail("out-of-range", ["H.1103"], `H11 reply within ${weeks} weeks isn't 1–12`);
}

/* ------------------------------------------------------------------ */
/* Section I and J                                                     */
/* ------------------------------------------------------------------ */

/** I-2: the stated ratio is within 0.5 of students ÷ faculty. Never compared with the federal ratio (definitions differ). */
function checkI2(x: Ctx) {
  const [ratio, students, faculty] = [x.v.num("I.201"), x.v.num("I.202"), x.v.num("I.203")];
  if (ratio !== null && students !== null && faculty) {
    const computed = students / faculty;
    if (Math.abs(ratio - computed) > 0.5) x.fail("ratio-matches", ["I.201", "I.202", "I.203"], `I-2 ratio ${ratio} vs ${fmt(students)} ÷ ${fmt(faculty)} = ${computed.toFixed(2)} (more than 0.5 apart)`);
  }
}

/** I-3: the seven size bins sum to the total, ±1 (a "##" total is summed). */
function checkI3(x: Ctx) {
  for (const s of SUMS.filter((s) => s.total.startsWith("I."))) checkSum(x, s);
}

/** J: each award level's column of shares sums to 100% ±1 (blank columns skipped). */
function checkJ(x: Ctx) {
  [101, 141, 181].forEach((base, i) => checkPercentColumn(x, run("J", base, base + 38), c("J", base + 39), `J ${["certificates", "associate", "bachelor's"][i]} column`));
}

/** The per-item check groups, as named in the scope table (for docs and tests). */
export const CHECK_GROUPS = (): string[] => Object.keys(ITEM_CHECKS);

/** Every per-item check, by group (the scope table's rows). */
const ITEM_CHECKS: Record<string, (x: Ctx) => void> = {
  B1: checkB1,
  B2: checkB2,
  "B4-B11": checkGrid,
  B22: checkB22,
  C1: checkC1,
  "C1-residency": checkResidency,
  C2: checkC2,
  "C3-C5": checkC5,
  C7: checkC7,
  C8: checkC8,
  C9: checkC9,
  C10: checkC10,
  C11: checkC11,
  // C12: the GPA range is the type check (0–5); above 4.0 sets `weighted`, not a failure (cds-admissions.md).
  // C13: fee ≥ 0 is the type check; "$50/$75" stays text.
  C14: checkC14,
  "C16-C17": checkC16C17,
  C21: checkC21,
  C22: checkC22,
  D2: checkD2,
  "D4-D7": checkDPolicies,
  D9: checkD9,
  // E1, E3: a mark on its label's line is the universal number-on-line check; blank ≠ no.
  // F1: 0–100% is the type check.
  G0: checkG0,
  G1: checkG1,
  // G3–G6: the share is the type check; "varies"/"XXXXX" stay text or blank.
  H0: checkH0,
  H1: checkH1,
  H2: checkH2,
  H2A: checkH2A,
  H4: checkH4,
  H5: checkH5,
  H6: checkH6,
  "H7-H8": checkH8,
  "H9-H11": checkH9H11,
  // H14: a non-need and a need mark may both be set; nothing to check beyond the layout's placement.
  I2: checkI2,
  I3: checkI3,
  J: checkJ,
};

/** Groups whose numeric cells must hold numbers: text there fails (student-body and residency specs). */
const TEXT_FAILS = new Set(["B1", "B2", "B4", "B5", "B22", "C1"]);

/* ------------------------------------------------------------------ */
/* Universal checks                                                    */
/* ------------------------------------------------------------------ */

const NUMERIC_TYPES = new Set(["count", "percent", "currency", "decimal", "gpa", "sat-section", "sat-composite", "act", "act-writing", "month", "day"]);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MARK = /(?:^|[\s|(])(?:x|✔|✓|☒|☑|yes|y)\*?(?:$|[\s|)])/i;

/** Whether an item was read by a model call (a value with no workbook cell or form field, from a model-read call). */
export function isModelRead(doc: DocumentRecord, code: CdsCode, table: TemplateTable): boolean {
  const it = doc.items[code];
  if (!it || it.cell || it.field) return false;
  const call = table.byCode.get(code)?.call;
  if (!call || call === "store") return false;
  const read = doc.reads[call];
  return !!read && read.mode !== "deterministic";
}

/** Numbers printed on a line, with thousands separators and printer-split digits joined ("$3 4 , 604" → 34604). */
function numbersOn(line: string): number[] {
  const out: number[] = [];
  for (const text of [line.replace(/(\d),(?=\d{3}\b)/g, "$1"), line.replace(/(\d)[\s,]+(?=\d)/g, "$1")]) {
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  }
  return out;
}

const decimalsOf = (n: number) => (String(n).split(".")[1] ?? "").length;

/** Whether a value is printed on a line: the number (as a share or percent for percent items), a mark, or the words. */
export function valueOnLine(rawLine: string, v: Value, item: Pick<TemplateItem, "value_type">): boolean {
  // Layout tags first: "@243 1,2 74" would otherwise join the tag's digits into the printer-split number.
  const line = stripLayoutTags(rawLine);
  const t = item.value_type;
  if (typeof v === "boolean") return v ? MARK.test(line) : /(?:^|[\s|])(?:no|n)(?:$|[\s|])/i.test(line);
  if (typeof v === "number") {
    const nums = numbersOn(line);
    if (t === "month" && MONTHS.some((m) => new RegExp(`\\b${m}`, "i").test(line) && MONTHS.indexOf(m) + 1 === v)) return true;
    if (t === "percent") return nums.some((n) => Math.abs(n - v) <= 0.5 * 10 ** -Math.max(decimalsOf(n), 2) + 1e-9 || Math.abs(n - v * 100) <= 0.5 * 10 ** -decimalsOf(n) + 1e-9);
    if (NUMERIC_TYPES.has(t) && t !== "count" && t !== "currency" && t !== "month" && t !== "day") return nums.some((n) => Math.abs(n - v) <= 0.5 * 10 ** -decimalsOf(n) + 1e-9);
    return nums.includes(v);
  }
  if (t === "date") {
    const d = monthDay(v);
    if (!d) return line.toLowerCase().includes(v.toLowerCase().slice(0, 20));
    const nums = numbersOn(line);
    return nums.includes(d.day) && (nums.includes(d.month) || new RegExp(`\\b${MONTHS[d.month - 1]}`, "i").test(line));
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm(line).includes(norm(v).slice(0, 20)) || (t === "choice" && MARK.test(line))) return true;
  // Text read from a column heading a mark sits under (H.101 "2025-2026 Estimated" under "@370 2025-2026"): every digit
  // group of the value is printed on the cited line.
  const groups = v.match(/\d+/g);
  return !!groups && groups.every((g) => new RegExp(`(?:^|\\D)${g}(?:\\D|$)`).test(line));
}

/** The edition a model-read document's cover states ("Common Data Set 2025-2026"), from its first 80 lines. */
export function coverEdition(lines: readonly string[]): string | null {
  for (const line of lines.slice(0, 80)) {
    const m = /common data set\s*(20\d{2})\s*[-–—/]\s*(20\d{2}|\d{2})/i.exec(line);
    if (m) return parseEdition(`${m[1]}-${m[2]}`)?.key ?? null;
  }
  return null;
}

/** Codes whose own text names a year the edition fixes (B22's cohort and census falls, H4's class, I-2's fall). */
const YEAR_TEXT_CODES = ["B.2201", "B.2202", "B.2203", "H.401", "I.201"];

function universalChecks(x: Ctx, resolved: ReadonlySet<CdsCode>) {
  const { doc, table, lines } = x;
  const tableStart = parseEdition(table.edition)?.start;
  const docStart = parseEdition(doc.edition)?.start;
  /** For an assumed edition: whether some item's own text named the year the edition implies, or another year. */
  let confirmed = false;
  let contradicted = false;
  for (const [code, it] of Object.entries(x.items)) {
    const item = table.byCode.get(code);
    const v = x.v.get(code);
    if (!item) continue;
    if (it.form && !resolved.has(code)) {
      const said = v === undefined ? "is empty" : `says ${String(v)}`;
      x.fail("form-vs-code", [code], `code table ${said}${it.cell ? ` at ${it.cell}` : ""}; the visible form says ${String(it.form.v)} at ${it.form.cell}`);
    }
    if (v === undefined) continue;
    const tf = typeFailure(item, v);
    if (tf) x.fail("type-range", [code], tf.detail);
    if (item.year_rule === "aid-year" && !doc.years["aid-year"]) {
      x.fail("aid-year", [code], `H.101 is ${x.v.get("H.101") === undefined ? "blank" : `"${String(x.v.get("H.101"))}"`}, which names no aid year`);
    }
    if (typeof v === "string" && NUMERIC_TYPES.has(item.value_type) && TEXT_FAILS.has(item.item)) {
      x.fail("type-range", [code], `text "${v.slice(0, 40)}" in a numeric cell`);
    }
    if (lines && it.method !== "derived" && isModelRead(doc, code, table)) {
      const cited = it.lines?.length ? it.lines : it.line !== undefined ? [it.line] : [];
      const outside = cited.filter((n) => !Number.isInteger(n) || n < 1 || n > lines.length);
      if (outside.length) x.fail("line-in-document", [code], `cited line ${outside.join(", ")} isn't in the document's ${lines.length} lines`);
      else if (cited.length && !cited.some((n) => valueOnLine(lines[n - 1], v, item))) {
        x.fail("number-on-line", [code], `${String(v)} isn't on line ${cited.join(", ")}: "${lines[cited[0] - 1].slice(0, 100)}"`);
      } else if (!cited.length) x.fail("line-in-document", [code], "no line cited");
    }
    if (YEAR_TEXT_CODES.includes(code) && tableStart !== undefined && docStart !== undefined) {
      const want = Number(/\b(20\d{2})\b/.exec(item.question)?.[1]) - tableStart + docStart;
      const label = it.quote?.includes(" | ") ? it.quote.slice(0, it.quote.lastIndexOf(" | ")) : (it.quote ?? "");
      const said = /\b(20\d{2})\b/.exec(label)?.[1];
      if (said && Number(said) !== want) {
        x.fail("edition-mismatch", [code], `the item's text names ${said}; the ${doc.edition} edition's is ${want}`);
        contradicted = true;
      } else if (said) confirmed = true;
    }
  }
  if (x.editionAssumed && (!confirmed || contradicted)) {
    const valued = Object.keys(x.items).filter((k) => x.v.get(k) !== undefined);
    if (valued.length) x.fail("edition-mismatch", valued, `the document states no edition; filed as ${doc.edition} until an item's text (B22, H4, I-2) confirms it`);
  }
  if (lines) {
    const stated = coverEdition(lines);
    if (stated && stated !== parseEdition(doc.edition)?.key) {
      const valued = Object.keys(x.items).filter((k) => x.v.get(k) !== undefined);
      x.fail("edition-mismatch", valued, `the cover says ${stated}; the document is filed as ${doc.edition}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Running and applying                                                */
/* ------------------------------------------------------------------ */

/** Undo applyChecks's own work: restore code-table values, drop derived totals and every check failure it adds. */
const OWN_CHECKS = new Set<string>([
  "type-range", "number-on-line", "line-in-document", "edition-mismatch", "form-vs-code", "parts-sum", "sums-to-100", "order",
  "ratio-matches", "one-mark", "inconsistent", "valid-date", "date-order", "enrollment-disagrees", "federal-disagrees",
  "residency-funnel", "residency-sum", "residency-vs-federal", "column-3-not-all-undergrads", "previous-cohort-disagrees",
  "not-a-url", "out-of-range", "quote-present", "funnel-order", "plausible-change", "sources-agree", "aid-year",
]);

function reset(items: Record<CdsCode, ItemResult>): Record<CdsCode, ItemResult> {
  const out: Record<CdsCode, ItemResult> = {};
  for (const [code, it0] of Object.entries(items)) {
    let it: ItemResult = { ...it0 };
    if (it.code_table) {
      const { v, cell, quote } = it.code_table;
      it.form = { v: it.v ?? null, cell: it.cell ?? "" };
      delete it.code_table;
      delete it.v;
      delete it.cell;
      delete it.quote;
      if (v !== null) it.v = v;
      if (cell) it.cell = cell;
      if (quote) it.quote = quote;
    }
    if (it.method === "derived") it = { status: "blank" };
    const kept = (it.failures ?? []).filter((f) => !OWN_CHECKS.has(f.check));
    if (kept.length) it.failures = kept;
    else delete it.failures;
    if (it.status === "failed" || it.status === "passed") it.status = kept.length ? "failed" : it.v !== undefined ? "passed" : it.form ? "failed" : "blank";
    out[code] = it;
  }
  return out;
}

function runAll(
  doc: DocumentRecord,
  items: Record<CdsCode, ItemResult>,
  m: Map<CdsCode, Value>,
  ctx: CheckContext,
  federal: FederalBaseline | null,
  resolved: ReadonlySet<CdsCode>,
  derived: Record<CdsCode, DerivedTotal>
): CodedFailure[] {
  const failures: CodedFailure[] = [];
  const x: Ctx = {
    v: vals(m),
    doc,
    items,
    table: ctx.table,
    federal,
    school: ctx.school ?? null,
    others: ctx.others ?? [],
    lines: ctx.lines,
    derived,
    editionAssumed: !!ctx.editionAssumed,
    fail(check, codes, detail) {
      failures.push({ check, detail, codes: [...new Set(codes)] });
    },
  };
  universalChecks(x, resolved);
  for (const fn of Object.values(ITEM_CHECKS)) fn(x);
  return failures;
}

/**
 * Runs every check on a document: the universal checks and every per-item check, after summing "##" and blank totals
 * from their parts. For a template workbook whose visible form disagrees with its code table (`form`), the form's
 * values are tried too: when they pass every check of their group (Cornell's C21, Illinois's residency grid), they are
 * the ones published (`resolved`); otherwise the group stays failed with both values kept.
 */
export function runItemChecks(doc: DocumentRecord, ctx: CheckContext): ItemCheckResult {
  const items = reset(doc.items);
  const federal = ctx.federal !== undefined ? ctx.federal : ctx.school ? federalBaseline(ctx.school) : null;
  const m = valuesOf(items);
  const derived = deriveTotals(m, items);
  let failures = runAll(doc, items, m, ctx, federal, new Set(), derived);

  const formCodes = Object.keys(items).filter((k) => items[k].form);
  const resolved = new Set<CdsCode>();
  if (formCodes.length) {
    const alt = new Map(m);
    for (const k of formCodes) {
      const fv = items[k].form!.v;
      if (fv === null || fv === undefined) alt.delete(k);
      else alt.set(k, fv);
    }
    const tried = runAll(doc, items, alt, ctx, federal, new Set(formCodes), derived);
    const groups = new Set(formCodes.map(checkGroupOf));
    for (const g of groups) {
      const inGroup = (k: CdsCode) => checkGroupOf(k) === g;
      if (!tried.some((f) => f.codes.some(inGroup))) for (const k of formCodes.filter(inGroup)) resolved.add(k);
    }
    if (resolved.size) {
      const final = new Map(m);
      for (const k of resolved) {
        const fv = items[k].form!.v;
        if (fv === null || fv === undefined) final.delete(k);
        else final.set(k, fv);
      }
      failures = runAll(doc, items, final, ctx, federal, resolved, derived);
    }
  }

  const byCode: Record<CdsCode, ItemFailure[]> = {};
  for (const f of failures) {
    for (const k of f.codes) {
      const list = (byCode[k] ??= []);
      if (!list.some((g) => g.check === f.check && g.detail === f.detail)) list.push({ check: f.check, detail: f.detail });
    }
  }
  return { failures, byCode, derived, resolved: [...resolved] };
}

const QUOTE_MAX = 160;
const shown = (v: Value | null) => (typeof v === "boolean" ? (v ? "Yes" : "No") : v === null ? "" : String(v));
function quoteFor(label: string, v: Value | null): string {
  const value = shown(v);
  const q = `${label.replace(/\s+/g, " ").trim()} | ${value}`;
  if (q.length <= QUOTE_MAX) return q;
  const room = QUOTE_MAX - value.length - 4;
  return `${label.slice(0, Math.max(room, 10))}… | ${value}`.slice(0, QUOTE_MAX);
}

/**
 * The document with every item re-judged: failures from the checks (each on exactly the codes it names; a code with
 * no value stays blank), "##" and blank totals summed from their parts (`method: "derived"`), and form values
 * published where they passed (the code table's value kept in `code_table`). Reader failures (`overflow-total` with no
 * parts, `aid-year`) are kept. Idempotent.
 */
export function applyChecks(doc: DocumentRecord, ctx: CheckContext): DocumentRecord {
  const result = runItemChecks(doc, ctx);
  const items = reset(doc.items);
  const resolved = new Set(result.resolved);
  for (const [code, it] of Object.entries(items)) {
    const item = ctx.table.byCode.get(code);
    if (resolved.has(code) && it.form) {
      const { v, cell } = it.form;
      it.code_table = { v: it.v ?? null, ...(it.cell ? { cell: it.cell } : {}), ...(it.quote ? { quote: it.quote } : {}) };
      delete it.form;
      delete it.v;
      if (v !== null) it.v = v;
      it.cell = cell;
      const label = it.code_table.quote?.includes(" | ") ? it.code_table.quote.slice(0, it.code_table.quote.lastIndexOf(" | ")) : (item?.question ?? code);
      if (item?.owner || it.code_table.quote) it.quote = quoteFor(label, v);
      else delete it.quote;
      it.failures = (it.failures ?? []).filter((f) => f.check !== "form-vs-code");
    }
    const d = result.derived[code];
    if (d) {
      const parts = d.from.map((k) => items[k]);
      const cells = parts.map((p) => p.cell).filter((x): x is string => !!x);
      const next: ItemResult = { v: d.v, status: "passed", method: "derived", quote: quoteFor(`Sum of ${d.from.join(" + ")}`, d.v) };
      if (cells.length === parts.length) next.cell = cells.join("+");
      else {
        const page = parts.find((p) => p.page !== undefined)?.page;
        const lines = [...new Set(parts.flatMap((p) => p.lines ?? (p.line !== undefined ? [p.line] : [])))].sort((a, b) => a - b);
        if (page !== undefined) next.page = page;
        if (lines.length) next.lines = lines;
      }
      const kept = (it.failures ?? []).filter((f) => f.check !== "overflow-total");
      if (kept.length) next.failures = kept;
      items[code] = next;
    }
  }
  for (const [code, list] of Object.entries(result.byCode)) {
    const it = items[code];
    if (!it || it.v === undefined) {
      if (it?.form) it.failures = mergeFailures(it.failures, list);
      continue;
    }
    it.failures = mergeFailures(it.failures, list);
  }
  for (const it of Object.values(items)) {
    if (it.failures && !it.failures.length) delete it.failures;
    if (it.failures?.length) it.status = "failed";
    else if (it.v !== undefined && (it.status === "failed" || it.status === "passed" || it.method === "derived")) it.status = "passed";
    else if (it.status === "failed") it.status = "blank";
  }
  return { ...doc, items };
}

function mergeFailures(a: ItemFailure[] | undefined, b: ItemFailure[]): ItemFailure[] {
  const out = [...(a ?? [])];
  for (const f of b) if (!out.some((g) => g.check === f.check && g.detail === f.detail)) out.push(f);
  return out;
}

/* ------------------------------------------------------------------ */
/* Escalation (Decision 9)                                             */
/* ------------------------------------------------------------------ */

/**
 * Failures a stronger model can help with: a number not on its line, a sum or order failure, an implausible change
 * against federal, two sources disagreeing (and a mark the layout couldn't tie to its row).
 */
export const ESCALATE: ReadonlySet<CheckId> = new Set<CheckId>([
  "number-on-line", "line-in-document", "parts-sum", "sums-to-100", "order", "ratio-matches", "one-mark", "date-order",
  "enrollment-disagrees", "federal-disagrees", "residency-funnel", "residency-sum", "residency-vs-federal",
  "column-3-not-all-undergrads", "previous-cohort-disagrees", "quote-present", "funnel-order", "rate-matches",
  "plausible-change", "sources-agree",
]);

/** One re-read: the failing call's pages, for its failing codes only, by the escalation model. */
export interface Escalation {
  call: CallKey;
  codes: CdsCode[];
  checks: CheckId[];
  /** The pages the original call read (the archive's line text for these pages is re-sent); null when unknown. */
  pages: [number, number] | null;
  model: string;
}

/**
 * What to escalate in a document: once per failing call, only codes read by a model whose failures include an
 * escalatable check. Never a template workbook or form PDF (a deterministic read: the college's file is wrong), never a
 * blank item, never a call the escalation model already read (a second failure is "document inconsistent").
 */
export function escalationFor(doc: DocumentRecord, table: TemplateTable, opts: { model?: string } = {}): Escalation[] {
  const model = opts.model ?? REPORTED_MODELS.escalation;
  if (doc.type === "xlsx-template" || doc.type === "pdf-form" || doc.reads.deterministic) return [];
  const byCall = new Map<CallKey, { codes: Set<CdsCode>; checks: Set<CheckId> }>();
  for (const [code, it] of Object.entries(doc.items)) {
    if (it.status !== "failed" || !isModelRead(doc, code, table)) continue;
    const checks = (it.failures ?? []).map((f) => f.check as CheckId).filter((k) => ESCALATE.has(k));
    if (!checks.length) continue;
    const call = table.byCode.get(code)!.call as CallKey;
    if (doc.reads[call]?.read_by === model) continue;
    const e = byCall.get(call) ?? { codes: new Set(), checks: new Set() };
    e.codes.add(code);
    for (const k of checks) e.checks.add(k);
    byCall.set(call, e);
  }
  return [...byCall].map(([call, e]) => ({
    call,
    codes: [...e.codes].sort(),
    checks: [...e.checks].sort(),
    pages: doc.reads[call]?.pages ?? null,
    model,
  }));
}

/* ------------------------------------------------------------------ */
/* Circuit breaker (Decision 9)                                        */
/* ------------------------------------------------------------------ */

/**
 * Round 3's breaker (no auto-merge). Note: round 2.1 (lib/reported.ts CIRCUIT_BREAKER, 2026-10-03) dropped the
 * "10% of colleges fail" trigger because it fired on blocked sites and rounding; round 3 reinstates it for C1 only,
 * counting check failures in model reads and never `unreachable`, `blank`, or deterministic-read failures.
 */
export const CIRCUIT_BREAKER_V3 = {
  /** Share of attempted colleges whose C1 failed a check in a model read. */
  maxC1FailedShare: 0.1,
  /** Share of model-read documents containing an item in which it failed… */
  maxItemFailedShare: 0.2,
  /** …once at least this many model-read documents contain it. */
  minItemDocuments: 20,
  /** Share of already-published values that changed in one run (unchanged from round 2). */
  maxChangedShare: 0.25,
} as const;

export interface ItemFailureShare {
  code: CdsCode;
  /** Model-read documents with a value for the code (passed or failed). */
  documents: number;
  /** Of those, how many failed a check. */
  failed: number;
}

/** Failures that say nothing about the pipeline. */
const NOT_COUNTED = new Set<string>(["unreachable", "newer-than-federal"]);
/** B2 column 3 publishes nothing (cds-student-body-and-outcomes.md), so it never counts. */
const NOT_COUNTED_CODES = new Set(run("B", 221, 230));

const countsAsFailure = (it: ItemResult) => it.status === "failed" && (it.failures ?? []).some((f) => !NOT_COUNTED.has(f.check));

/** Per code: model-read documents containing it and how many failed. Deterministic reads and blanks never count. */
export function itemFailureShares(docs: readonly DocumentRecord[], table: TemplateTable): ItemFailureShare[] {
  const by = new Map<CdsCode, ItemFailureShare>();
  for (const doc of docs) {
    for (const [code, it] of Object.entries(doc.items)) {
      if ((it.status !== "passed" && it.status !== "failed") || NOT_COUNTED_CODES.has(code) || !isModelRead(doc, code, table)) continue;
      const s = by.get(code) ?? { code, documents: 0, failed: 0 };
      s.documents++;
      if (countsAsFailure(it)) s.failed++;
      by.set(code, s);
    }
  }
  return [...by.values()];
}

/** Colleges whose newest document's C1 totals failed a check in a model read (the breaker's C1 count). */
export function failedC1Count(records: readonly CollegeRecord[], table: TemplateTable): number {
  return records.filter((r) => {
    const doc = r.documents[0];
    return !!doc && C1_TOTALS.some((k) => isModelRead(doc, k, table) && countsAsFailure(doc.items[k]));
  }).length;
}

/** Why the run must not auto-merge, or null. Each limit is a share strictly greater than CIRCUIT_BREAKER_V3's. */
export function circuitBreakerV3(input: {
  attempted: number;
  failedC1: number;
  itemFailureShares: readonly ItemFailureShare[];
  changed: number;
  priorValues: number;
}): string | null {
  const L = CIRCUIT_BREAKER_V3;
  const reasons: string[] = [];
  if (input.attempted > 0 && input.failedC1 / input.attempted > L.maxC1FailedShare) {
    reasons.push(`${input.failedC1} of ${input.attempted} colleges failed C1 checks (limit ${L.maxC1FailedShare * 100}%)`);
  }
  const bad = input.itemFailureShares
    .filter((s) => s.documents >= L.minItemDocuments && s.failed / s.documents > L.maxItemFailedShare)
    .sort((a, b) => b.failed / b.documents - a.failed / a.documents);
  if (bad.length) {
    reasons.push(`${bad.map((s) => `${s.code} failed in ${s.failed} of ${s.documents} model-read documents`).slice(0, 5).join("; ")} (limit ${L.maxItemFailedShare * 100}% once ${L.minItemDocuments} documents)`);
  }
  if (input.priorValues > 0 && input.changed / input.priorValues > L.maxChangedShare) {
    reasons.push(`${input.changed} of ${input.priorValues} published values changed (limit ${L.maxChangedShare * 100}%)`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

/* ------------------------------------------------------------------ */
/* Review queue entries (keyed by college + edition + code)            */
/* ------------------------------------------------------------------ */

/** One review entry per failed item of a document. Add them with `enqueueItems` (lib/reported.ts). */
export function reviewItemsFor(
  doc: DocumentRecord,
  table: TemplateTable,
  opts: { unit_id: string; name: string; run: string; queued: string }
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const [code, it] of Object.entries(doc.items)) {
    if (it.status !== "failed") continue;
    const rule = table.byCode.get(code)?.year_rule;
    out.push({
      unit_id: opts.unit_id,
      name: opts.name,
      urls: [doc.url],
      entering_term: (rule && doc.years[rule]) || null,
      failures: (it.failures ?? []).map((f): CheckFailure => ({ check: f.check as CheckId, detail: f.detail })),
      queued: opts.queued,
      run: opts.run,
      code,
      edition: doc.edition,
      sha256: doc.sha256,
      value: it.v ?? null,
    });
  }
  return out.sort((a, b) => (a.code! < b.code! ? -1 : 1));
}

/** The queue without this document's entries for codes that now pass (or are blank): a fixed item leaves the queue. */
export function dropPassed(queue: readonly ReviewItem[], unitId: string, doc: DocumentRecord): ReviewItem[] {
  return queue.filter((q) => !(q.unit_id === unitId && q.edition === doc.edition && q.code && doc.items[q.code] && doc.items[q.code].status !== "failed"));
}
