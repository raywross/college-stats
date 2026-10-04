/**
 * CDS cost and debt (specs/data-expansion/cds-cost-and-debt.md): a college's CDS record (data/cds-records/<unit_id>.json)
 * → `school.reported.cost.{next_year, next_year_detail}` (section G, the coming academic year) and
 * `school.reported.outcomes.{graduating_class, graduate_debt}` (H4–H5, the class that just graduated), each with
 * `college-site` lineage, plus the checks that hold a block back and the totals the cost and outcomes pages show.
 *
 * Next year's price is a separate labeled value beside the federal price: it never replaces `cost.*` (history's rule 1,
 * specs/trends-data.md, needs each series' latest point to equal the snapshot), and never reaches ranks, Explore sorts,
 * percentiles, Compare, Home, or history (tests/cds-cost-and-debt.test.mts guards that). When the college marks its
 * costs "not final" (G.002), G1, G5, and G6 are held back entirely.
 *
 * Pure module: type-only imports plus lib/cds-records.ts.
 */
import type { CdsCode, CollegeRecord, DocumentRecord } from "../cds-sections.ts";
import type { FieldPath } from "../fields.ts";
import type {
  CdsCostColumn,
  CdsExpenses,
  CdsTuition,
  GraduateDebtRowKey,
  LineageRecord,
  ReportedCost,
  ReportedGraduateDebt,
  ReportedNextYearDetail,
  ReportedNextYearPrice,
  ReportedOutcomes,
  School,
} from "../types";
import { compareDocuments, itemBoolean, itemNumber, itemShare, itemText, itemValue, lineageFromItem, newestPassed, passedItem } from "../cds-records.ts";

/** The undergraduate column is disclosed when its total differs from the first-year total by more than this share. */
export const UNDERGRAD_DISCLOSURE = 0.01;
/** The differential-tuition footnote shows when G.402 is at least this share (skips near-zero noise). */
export const PAYING_MORE_FOOTNOTE = 0.05;
/** Check 1: each reported tuition + fees is at least this share of the federal tuition & fees. */
export const FEDERAL_FLOOR = 0.95;
/** Check 7: the any-loan average principal is within these multiples of the Scorecard median debt. */
export const PRINCIPAL_RATIO: readonly [number, number] = [0.5, 3];
/** Graduate debt may come from a document at most this many editions behind the college's newest. */
const DEBT_EDITIONS_BACK = 2;

type Lineage = Partial<Record<FieldPath, LineageRecord>>;
export type CostDebtBlock = "next_year" | "next_year_detail" | "graduating_class" | "graduate_debt";
export interface Held {
  block: CostDebtBlock;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Reading a document                                                  */
/* ------------------------------------------------------------------ */

const PUBLIC_FIRST_YEAR = ["G.103", "G.104", "G.105", "G.106"] as const;
const PUBLIC_UNDERGRAD = ["G.107", "G.108", "G.109", "G.110"] as const;

/**
 * Which G1 tuition cells a college fills, from its federal sector: G.101/G.102 are the private-college cells, G.103–G.110
 * the public ones. The first live run filed Florida's and UC San Diego's public tuition under the private cell too
 * (its template question reads only "Tuition"), so a public's private cell is never read, nor a private's public ones.
 */
export function tuitionSector(school: Pick<School, "type">): "public" | "private" {
  return school.type === "public" ? "public" : "private";
}

function tuitionOf(doc: DocumentRecord, sector: "public" | "private", privateCode: CdsCode, publicCodes: readonly CdsCode[]): CdsTuition | null {
  if (sector === "private") {
    const amount = itemNumber(doc, privateCode);
    return amount === null ? null : { kind: "private", amount };
  }
  const [d, s, o, n] = publicCodes.map((c) => itemNumber(doc, c));
  if (d === null && s === null && o === null && n === null) return null;
  return { kind: "public", in_district: d, in_state: s, out_of_state: o, nonresident_international: n };
}

function columnOf(doc: DocumentRecord, which: "first_year" | "undergraduate", sector: "public" | "private"): CdsCostColumn {
  const fy = which === "first_year";
  return {
    tuition: fy ? tuitionOf(doc, sector, "G.101", PUBLIC_FIRST_YEAR) : tuitionOf(doc, sector, "G.102", PUBLIC_UNDERGRAD),
    fees: itemNumber(doc, fy ? "G.111" : "G.115"),
    food_and_housing: itemNumber(doc, fy ? "G.112" : "G.116"),
    housing_only: itemNumber(doc, fy ? "G.113" : "G.117"),
    food_only: itemNumber(doc, fy ? "G.114" : "G.118"),
  };
}

/** The code behind the headline tuition: the private rate at a private college, the in-state rate at a public. */
function headlineTuitionCode(doc: DocumentRecord, sector: "public" | "private"): CdsCode | null {
  for (const c of sector === "private" ? ["G.101"] : ["G.104", "G.103", "G.105"]) if (itemNumber(doc, c) !== null) return c;
  return null;
}

/** G5 with every non-numeric answer ("varies", "XXXXX") kept as text, never as $0. */
function expensesOf(doc: DocumentRecord): CdsExpenses | null {
  const text: Record<string, string> = {};
  const num = (code: CdsCode, key: string): number | null => {
    const n = itemNumber(doc, code);
    if (n !== null) return n;
    const t = itemText(doc, code);
    if (t) text[key] = t;
    return null;
  };
  const e: CdsExpenses = {
    residents: { books_supplies: num("G.501", "residents.books_supplies"), transportation: num("G.502", "residents.transportation"), other: num("G.503", "residents.other") },
    commuters_at_home: {
      books_supplies: num("G.504", "commuters_at_home.books_supplies"),
      food_only: num("G.505", "commuters_at_home.food_only"),
      transportation: num("G.506", "commuters_at_home.transportation"),
      other: num("G.507", "commuters_at_home.other"),
    },
    commuters_away: {
      books_supplies: num("G.508", "commuters_away.books_supplies"),
      housing_only: num("G.509", "commuters_away.housing_only"),
      food_only: num("G.510", "commuters_away.food_only"),
      food_and_housing_total: num("G.511", "commuters_away.food_and_housing_total"),
      transportation: num("G.512", "commuters_away.transportation"),
      other: num("G.513", "commuters_away.other"),
    },
  };
  const any = [e.residents, e.commuters_at_home, e.commuters_away].some((g) => Object.values(g).some((v) => v !== null));
  if (!any && !Object.keys(text).length) return null;
  return Object.keys(text).length ? { ...e, text } : e;
}

/** "Class of 2025" → 2025. */
export function classYear(label: string | undefined): number | null {
  const m = /\b(\d{4})\b/.exec(label ?? "");
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Checks (spec Ingest 1–7): a failure holds the block back            */
/* ------------------------------------------------------------------ */

/**
 * 1. Each reported tuition + required fees is at least 95% of the matching federal tuition & fees (Scorecard's
 * `cost.tuition_in_state` / `_out_of_state` are TUITIONFEE_IN/OUT, so G1's fees are added before comparing). A private
 * rate compares to the in-state figure. A sticker price rarely falls year over year.
 */
export function checkTuitionVsFederal(col: CdsCostColumn, school: Pick<School, "cost">): string[] {
  const t = col.tuition;
  if (!t) return [];
  const fees = col.fees ?? 0;
  const pairs: [string, number | null, number | null | undefined][] =
    t.kind === "private"
      ? [["tuition", t.amount, school.cost?.tuition_in_state]]
      : [
          ["in-state tuition", t.in_state ?? t.in_district, school.cost?.tuition_in_state],
          ["out-of-state tuition", t.out_of_state, school.cost?.tuition_out_of_state],
        ];
  const out: string[] = [];
  for (const [label, reported, federal] of pairs) {
    if (reported === null || federal === null || federal === undefined || federal <= 0) continue;
    if (reported + fees < FEDERAL_FLOOR * federal) out.push(`${label} + fees ${reported + fees} is under ${FEDERAL_FLOOR * 100}% of the federal ${federal}`);
  }
  return out;
}

/** 2. Housing only + food only ≈ food and housing, within rounding, when all three are given. */
export function checkColumnAgreement(col: CdsCostColumn, label = "first-year"): string[] {
  const { food_and_housing: fh, housing_only: h, food_only: f } = col;
  if (fh === null || h === null || f === null) return [];
  return Math.abs(h + f - fh) > Math.max(5, fh * 0.005) ? [`${label}: housing ${h} + food ${f} ≠ food and housing ${fh}`] : [];
}

/** 3. G.402 is a share from 0 to 1. */
export function checkPayingMore(v: number | null): string[] {
  return v === null || (v >= 0 && v <= 1) ? [] : [`share paying more ${v} isn't 0–100%`];
}

/** 4. The graduating class is a positive whole number. */
export function checkClassSize(n: number | null): string[] {
  return n !== null && Number.isInteger(n) && n > 0 ? [] : [`graduating class size ${n} isn't a positive whole number`];
}

/** 5. Any-loan borrowers are a superset of federal borrowers: count and share are each at least the federal row's. */
export function checkAnyAtLeastFederal(rows: ReportedGraduateDebt["rows"]): string[] {
  const out: string[] = [];
  const { any, federal } = rows;
  if (any.number !== null && federal.number !== null && any.number < federal.number) out.push(`any-loan count ${any.number} < federal ${federal.number}`);
  if (any.share !== null && federal.share !== null && any.share + 1e-9 < federal.share) out.push(`any-loan share ${any.share} < federal ${federal.share}`);
  return out;
}

/**
 * 6. Any-loan is a union of the four source rows, so it is at most their sum (count exactly; shares allow 2 points
 * for four rounded percents).
 */
export function checkUnionBound(rows: ReportedGraduateDebt["rows"]): string[] {
  const out: string[] = [];
  const sources: GraduateDebtRowKey[] = ["federal", "institutional", "state", "private"];
  const sum = (k: "number" | "share") => {
    const vs = sources.map((s) => rows[s][k]);
    return vs.every((v) => v === null) ? null : vs.reduce<number>((a, v) => a + (v ?? 0), 0);
  };
  const n = sum("number");
  const s = sum("share");
  if (rows.any.number !== null && n !== null && rows.any.number > n) out.push(`any-loan count ${rows.any.number} > the four sources' ${n}`);
  if (rows.any.share !== null && s !== null && rows.any.share > s + 0.02) out.push(`any-loan share ${rows.any.share} > the four sources' ${s}`);
  return out;
}

/**
 * 7. The any-loan average principal is within ×0.5–×3 of the Scorecard median debt. The two measure different things
 * (average vs. median, every loan type vs. federal only), so the band is wide: it catches a misread decimal or a
 * six-figure mis-scan, not a real gap. (The spec's ×2 ceiling rejected Vanderbilt's real figure, $30,578 against a
 * $14,000 federal median, because its private-loan borrowers average $64,280.)
 */
export function checkPrincipalVsScorecard(rows: ReportedGraduateDebt["rows"], medianDebt: number | null | undefined): string[] {
  const avg = rows.any.avg_principal;
  if (avg === null || !medianDebt) return [];
  const [lo, hi] = PRINCIPAL_RATIO;
  return avg < lo * medianDebt || avg > hi * medianDebt ? [`any-loan average ${avg} is outside ×${lo}–×${hi} of the federal median debt ${medianDebt}`] : [];
}

/* ------------------------------------------------------------------ */
/* Record → reported blocks with lineage                               */
/* ------------------------------------------------------------------ */

export interface CostAndDebt {
  cost: ReportedCost | null;
  outcomes: ReportedOutcomes | null;
  lineage: Lineage;
  /** Blocks not published, and why (G0 "not final", or a failed check). */
  held: Held[];
}

function firstPassed(doc: DocumentRecord, codes: readonly CdsCode[]): CdsCode | null {
  return codes.find((c) => passedItem(doc, c) && itemValue(doc, c) !== null) ?? null;
}

function nextYear(doc: DocumentRecord, school: School, lineage: Lineage, held: Held[]): { price: ReportedNextYearPrice | null; final: boolean } {
  const year = doc.years["next-year"];
  const notFinal = itemBoolean(doc, "G.002") === true;
  const sector = tuitionSector(school);
  const code = headlineTuitionCode(doc, sector);
  if (!code || !year) return { price: null, final: !notFinal };
  if (notFinal) {
    const by = itemText(doc, "G.003");
    held.push({ block: "next_year", reason: `the college says its costs aren't final${by ? ` (final by ${by.replace(/^--/, "")})` : ""}` });
    return { price: null, final: false };
  }
  const price: ReportedNextYearPrice = { entering_term: year, first_year: columnOf(doc, "first_year", sector), undergraduate: columnOf(doc, "undergraduate", sector) };
  const failures = [...checkTuitionVsFederal(price.first_year, school), ...checkColumnAgreement(price.first_year), ...checkColumnAgreement(price.undergraduate, "undergraduate")];
  if (failures.length) {
    held.push({ block: "next_year", reason: failures.join("; ") });
    return { price: null, final: true };
  }
  lineage["reported.cost.next_year"] = lineageFromItem(doc, code, { year });
  if (price.first_year.fees !== null) lineage["reported.cost.next_year.first_year.fees"] = lineageFromItem(doc, "G.111", { year });
  if (price.first_year.food_and_housing !== null) lineage["reported.cost.next_year.first_year.food_and_housing"] = lineageFromItem(doc, "G.112", { year });
  return { price, final: true };
}

function nextYearDetail(doc: DocumentRecord, final: boolean, lineage: Lineage, held: Held[]): ReportedNextYearDetail | null {
  const year = doc.years["next-year"];
  if (!year) return null;
  const min = itemNumber(doc, "G.201");
  const max = itemNumber(doc, "G.202");
  let pct = itemShare(doc, "G.402");
  const pctFailures = checkPayingMore(itemNumber(doc, "G.402"));
  if (pctFailures.length) {
    held.push({ block: "next_year_detail", reason: pctFailures.join("; ") });
    pct = null;
  }
  const perCredit = [itemNumber(doc, "G.601"), itemNumber(doc, "G.602"), itemNumber(doc, "G.603"), itemNumber(doc, "G.604"), itemNumber(doc, "G.605")];
  const detail: ReportedNextYearDetail = {
    credits_per_term: min === null && max === null ? null : { min, max },
    tuition_varies_by_year: itemBoolean(doc, "G.301"),
    tuition_varies_by_program: itemBoolean(doc, "G.401"),
    pct_paying_more: pct,
    // Prices for a year the college says isn't final are held back with G1.
    expenses: final ? expensesOf(doc) : null,
    per_credit_hour: final && perCredit.some((v) => v !== null) ? { private: perCredit[0], in_district: perCredit[1], in_state: perCredit[2], out_of_state: perCredit[3], nonresident: perCredit[4] } : null,
  };
  const cite = firstPassed(doc, [
    ...(pct !== null ? ["G.402"] : []),
    "G.401",
    "G.301",
    ...(final ? ["G.501", "G.502", "G.503", "G.504", "G.506", "G.507", "G.508", "G.509", "G.510", "G.511", "G.512", "G.513", "G.601", "G.602", "G.603", "G.604", "G.605"] : []),
  ]);
  const hasValue = Object.values(detail).some((v) => v !== null);
  // G2 is store-only and unquoted in template workbooks, so it can't be the citation; without another item, no block.
  if (!hasValue || !cite) return null;
  lineage["reported.cost.next_year_detail"] = lineageFromItem(doc, cite, { year });
  if (pct !== null) lineage["reported.cost.next_year_detail.pct_paying_more"] = lineageFromItem(doc, "G.402", { year });
  return detail;
}

const DEBT_ROWS: Record<GraduateDebtRowKey, [CdsCode, CdsCode, CdsCode]> = {
  any: ["H.501", "H.506", "H.511"],
  federal: ["H.502", "H.507", "H.512"],
  institutional: ["H.503", "H.508", "H.513"],
  state: ["H.504", "H.509", "H.514"],
  private: ["H.505", "H.510", "H.515"],
};

function graduates(record: CollegeRecord, school: School, lineage: Lineage, held: Held[]): ReportedOutcomes | null {
  // H4 and H5 must describe one class, so they come from one document: the newest where H4 and an any-loan figure passed.
  const found = newestPassed(record, ["H.401"], { maxEditionsBack: DEBT_EDITIONS_BACK });
  if (!found) return null;
  const doc = found.document;
  const label = doc.years["graduating-class"];
  const year = classYear(label);
  const size = itemNumber(doc, "H.401");
  if (!label || year === null) return null;
  const sizeFailures = checkClassSize(size);
  if (sizeFailures.length) {
    held.push({ block: "graduating_class", reason: sizeFailures.join("; ") });
    return null;
  }
  const out: ReportedOutcomes = { graduating_class: { year, size: size! } };
  lineage["reported.outcomes.graduating_class"] = lineageFromItem(doc, "H.401", { year: label });

  const rows = Object.fromEntries(
    (Object.entries(DEBT_ROWS) as [GraduateDebtRowKey, [CdsCode, CdsCode, CdsCode]][]).map(([k, [n, s, a]]) => [k, { number: itemNumber(doc, n), share: itemShare(doc, s), avg_principal: itemNumber(doc, a) }])
  ) as ReportedGraduateDebt["rows"];
  if (rows.any.share === null && rows.any.avg_principal === null) return out;
  const failures = [...checkAnyAtLeastFederal(rows), ...checkUnionBound(rows), ...checkPrincipalVsScorecard(rows, school.outcomes?.median_debt)];
  if (failures.length) {
    held.push({ block: "graduate_debt", reason: failures.join("; ") });
    return out;
  }
  out.graduate_debt = { class_year: year, rows };
  lineage["reported.outcomes.graduate_debt"] = lineageFromItem(doc, firstPassed(doc, DEBT_ROWS.any)!, { year: label });
  if (rows.any.share !== null) lineage["reported.outcomes.graduate_debt.rows.any.share"] = lineageFromItem(doc, "H.506", { year: label });
  if (rows.any.avg_principal !== null) lineage["reported.outcomes.graduate_debt.rows.any.avg_principal"] = lineageFromItem(doc, "H.511", { year: label });
  return out;
}

/** A college's record → its cost and debt blocks, their lineage, and what was held back. */
export function costAndDebtFromRecord(record: CollegeRecord, school: School): CostAndDebt {
  const lineage: Lineage = {};
  const held: Held[] = [];
  // Next year's price only from the college's newest document: an older edition's "next year" has already happened.
  const newest = [...record.documents].sort(compareDocuments)[0];
  let cost: ReportedCost | null = null;
  if (newest) {
    const { price, final } = nextYear(newest, school, lineage, held);
    const detail = nextYearDetail(newest, final, lineage, held);
    if (price || detail) cost = { ...(price ? { next_year: price } : {}), ...(detail ? { next_year_detail: detail } : {}) };
  }
  const outcomes = graduates(record, school, lineage, held);
  return { cost, outcomes, lineage, held };
}

/**
 * The merge step (lib/reported-merge.ts calls it once per school, after `stripReported`): adds the cost and debt
 * blocks under `school.reported` with their lineage. Never touches `cost.*` or `outcomes.*`.
 */
export function applyCostAndDebt(school: School, record: CollegeRecord | undefined): School {
  if (!record) return school;
  const { cost, outcomes, lineage } = costAndDebtFromRecord(record, school);
  if (!cost && !outcomes) return school;
  return {
    ...school,
    // `reported.outcomes` is shared with the 4- and 5-year graduation shares (lib/cds/student-body.ts), so merge into it.
    reported: { ...school.reported, ...(cost ? { cost } : {}), ...(outcomes ? { outcomes: { ...school.reported?.outcomes, ...outcomes } } : {}) },
    lineage: { ...school.lineage, ...lineage },
  };
}

/* ------------------------------------------------------------------ */
/* What the pages show                                                 */
/* ------------------------------------------------------------------ */

export type Residency = "in_state" | "out_of_state";

/** Tuition at one residency rate (a private college's one rate for both). */
export function tuitionAt(t: CdsTuition | null, residency: Residency): number | null {
  if (!t) return null;
  if (t.kind === "private") return t.amount;
  return residency === "in_state" ? (t.in_state ?? t.in_district) : t.out_of_state;
}

/** Tuition + required fees + on-campus food and housing: the part of the price G1 covers. Null when any is missing. */
export function columnTotal(col: CdsCostColumn, residency: Residency = "in_state"): number | null {
  const t = tuitionAt(col.tuition, residency);
  return t === null || col.fees === null || col.food_and_housing === null ? null : t + col.fees + col.food_and_housing;
}

/** The federal year's matching total: tuition & fees + on-campus room & board (books and other are G5, not G1). */
export function federalMatchingTotal(school: Pick<School, "cost" | "type">, residency: Residency = "in_state"): number | null {
  const tf = school.cost?.tuition_fees;
  const rb = school.cost?.components?.room_board ?? null;
  const t = residency === "in_state" ? (tf?.in_state ?? tf?.in_district ?? null) : (tf?.out_of_state ?? null);
  return t === null || rb === null ? null : t + rb;
}

/** Relative change, or null without both values. */
export function change(next: number | null, current: number | null): number | null {
  return next === null || current === null || current <= 0 ? null : next / current - 1;
}

/** True when continuing students' total differs from first-years' by more than 1% (the disclosure). */
export function undergraduateDiffers(price: ReportedNextYearPrice, residency: Residency = "in_state"): boolean {
  const fy = columnTotal(price.first_year, residency);
  const ug = columnTotal(price.undergraduate, residency);
  return fy !== null && ug !== null && Math.abs(ug - fy) / fy > UNDERGRAD_DISCLOSURE;
}

/** Show the differential-tuition footnote. */
export function showsPayingMore(detail: ReportedNextYearDetail | undefined): detail is ReportedNextYearDetail & { pct_paying_more: number } {
  return detail?.pct_paying_more != null && detail.pct_paying_more >= PAYING_MORE_FOOTNOTE;
}

export interface FullEstimate {
  /** G1 + G5 for a student living on campus; null when partial. */
  total: number | null;
  parts: { label: string; value: number | null; text?: string }[];
  partial: boolean;
}

/**
 * The full next-year estimate for an on-campus student: G1's total + G5 residents' books, transportation, and other.
 * A non-numeric answer ("varies") is a named part with its text, never $0, and makes the total partial.
 */
export function fullEstimate(price: ReportedNextYearPrice, detail: ReportedNextYearDetail | undefined, residency: Residency = "in_state"): FullEstimate | null {
  const base = columnTotal(price.first_year, residency);
  const r = detail?.expenses?.residents;
  if (base === null || !r) return null;
  const text = detail?.expenses?.text ?? {};
  const parts: FullEstimate["parts"] = [
    { label: "Tuition, fees, food & housing", value: base },
    { label: "Books and supplies", value: r.books_supplies, text: text["residents.books_supplies"] },
    { label: "Transportation", value: r.transportation, text: text["residents.transportation"] },
    { label: "Other expenses", value: r.other, text: text["residents.other"] },
  ];
  const partial = parts.some((p) => p.value === null);
  return { total: partial ? null : parts.reduce((a, p) => a + (p.value ?? 0), 0), parts, partial };
}

/** Whether the outcomes page has a graduate-debt line to show. */
export function hasGraduateDebt(school: Pick<School, "reported">): boolean {
  const d = school.reported?.outcomes?.graduate_debt;
  return !!d && (d.rows.any.share !== null || d.rows.any.avg_principal !== null);
}
