/**
 * How the cost-by-income curve is worded (specs/product/cost-by-income.md "Wording"): incomes and prices as rounded
 * figures, ranges for modeled prices, and the word "estimate" beside every number the model produced. Every sentence
 * the curve, the income slider, the facts row and the overview card show is built here, so the rule lives in one
 * place and `tests/cost-display.test.mts` can check it across every college. Pure: no React, no data loading.
 *
 * A phrase says whether it carries a modeled figure (`estimate`); a phrase that does always contains ESTIMATE_WORD.
 * Components print phrases as given and never format an estimated price themselves.
 */
import type { School } from "./types";
import type { FieldPath } from "./fields";
import type { TermKey } from "./glossary";
import type { AidPolicy } from "./aid-policies";
import { FEDERAL_BANDS, FEDERAL_TOP, INCOME_MAX, priceAt, type CostCurve, type PriceKind } from "./cost-curve.ts";
import type { MeritInfo } from "./merit";
import { money, pctSmart } from "./format.ts";

/** The word that must sit beside every modeled figure. */
export const ESTIMATE_WORD = "estimate";

/** A sentence and whether it carries a modeled figure. */
export interface Phrase {
  text: string;
  estimate: boolean;
}

/** An estimate phrase always says so. */
export const phraseHasWord = (p: Phrase): boolean => !p.estimate || p.text.toLowerCase().includes(ESTIMATE_WORD);

/* ------------------------------------------------------------------ */
/* Figures                                                              */
/* ------------------------------------------------------------------ */

/** Modeled incomes (the break point) are rounded to $10K. */
export const roundIncome = (x: number): number => Math.round(x / 10_000) * 10_000;
/** Modeled prices are rounded to $1K. */
export const roundPrice = (x: number): number => Math.round(x / 1_000) * 1_000;

/** "$240K": the income as given (the slider's own $5K steps, the axis ticks), in thousands. */
export function incomeLabel(x: number): string {
  if (x === 0) return "$0";
  const k = x / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

/** "$240K": a modeled income, rounded to $10K. */
export const roundedIncomeLabel = (x: number): string => incomeLabel(roundIncome(x));

/** "$38K" (rounded to $1K); under $1,000 the exact figure, so a small price never reads as $0. */
export function priceLabel(x: number): string {
  return Math.abs(x) < 1_000 ? money(x) : `$${Math.round(x / 1_000)}K`;
}

/** "$38K–$47K", or "$38K" when both ends round alike. */
export function priceRangeLabel(lo: number, hi: number): string {
  const a = priceLabel(lo);
  const b = priceLabel(hi);
  return a === b ? a : `${a}–${b}`;
}

/* ------------------------------------------------------------------ */
/* The price at an income                                               */
/* ------------------------------------------------------------------ */

/** The reason a figure is missing, in the college's terms. */
function missing(income: number, showEstimates: boolean): string {
  return income > FEDERAL_TOP ? (showEstimates ? "no estimate for this college" : `published data end at ${incomeLabel(FEDERAL_TOP)}`) : "no published figure for this income";
}

/** One price as a phrase: published as is, modeled with "about", a range, and "(estimate)". */
export function describePrice(p: { lo: number; hi: number; kind: PriceKind }): Phrase {
  switch (p.kind) {
    case "published":
      return { text: `${priceLabel(p.lo)} a year`, estimate: false };
    case "estimate":
      return { text: `about ${priceRangeLabel(p.lo, p.hi)} a year (${ESTIMATE_WORD})`, estimate: true };
    case "full_price":
      return { text: `the full price, about ${priceLabel(p.lo)} a year (${ESTIMATE_WORD})`, estimate: true };
    default:
      return { text: "no figure", estimate: false };
  }
}

/** "At $240K: about $38K–$47K a year (estimate)": the hover and slider readout. */
export function readout(curve: CostCurve, income: number, showEstimates: boolean): Phrase {
  const p = priceAt(curve, income, showEstimates);
  if (p.kind === "unknown") return { text: `At ${incomeLabel(income)}: ${missing(income, showEstimates)}`, estimate: false };
  const d = describePrice(p);
  return { text: `At ${incomeLabel(income)}: ${d.text}`, estimate: d.estimate };
}

/** Which part of the curve an income is on, in a sentence. */
export function partOfCurve(curve: CostCurve, income: number, showEstimates: boolean): Phrase {
  const p = priceAt(curve, income, showEstimates);
  if (p.kind === "published") {
    const i = FEDERAL_BANDS.findIndex((b) => income < b.hi);
    const band = FEDERAL_BANDS[i === -1 ? FEDERAL_BANDS.length - 1 : i];
    return { text: `Published figure: the average price families with income ${band.label} paid, from federal data.`, estimate: false };
  }
  if (p.kind === "estimate") return { text: `Our ${ESTIMATE_WORD}: need-based aid is phasing out here, so the price climbs toward the full price.`, estimate: true };
  if (p.kind === "full_price") return { text: `Past where need-based aid ends (${ESTIMATE_WORD}): families here are expected to pay the full price.`, estimate: true };
  if (income > FEDERAL_TOP) return { text: `Published data end at ${incomeLabel(FEDERAL_TOP)}; use the college's net price calculator for a number.`, estimate: false };
  return { text: "The federal data have no figure for this income band.", estimate: false };
}

/* ------------------------------------------------------------------ */
/* Where need-based aid ends                                            */
/* ------------------------------------------------------------------ */

export type NeedAidView =
  | { kind: "break_point"; mid: number; lo: number; hi: number }
  | { kind: "little_above_110k" }
  | { kind: "data_ends" };

/**
 * The need-based aid fact for a curve. The break point and the estimate behind it are shown only while estimates are
 * (the pilot's gate); with the gate closed the published part is all there is.
 */
export function needAidView(curve: CostCurve | null, showEstimates: boolean): NeedAidView {
  if (!curve) return { kind: "data_ends" };
  if (curve.status === "little_above_110k") return { kind: "little_above_110k" };
  if (curve.status === "break_point" && curve.breakIncome && showEstimates) return { kind: "break_point", ...curve.breakIncome };
  return { kind: "data_ends" };
}

/** True when the curve draws a dashed estimate (and the break point) at all. */
export const hasEstimate = (curve: CostCurve | null, showEstimates: boolean): boolean => needAidView(curve, showEstimates).kind === "break_point";

/** "about $310K" / "above $400K": the break point, rounded to $10K. */
export function breakIncomeLabel(mid: number): string {
  const r = roundIncome(mid);
  return r > INCOME_MAX ? `above ${incomeLabel(INCOME_MAX)}` : `about ${incomeLabel(r)}`;
}

/** "$290K–$330K": the break point's range. */
export function breakRangeLabel(lo: number, hi: number): string {
  const a = incomeLabel(roundIncome(lo));
  const b = incomeLabel(roundIncome(hi));
  return a === b ? a : `${a}–${b}`;
}

/* ------------------------------------------------------------------ */
/* Merit                                                                */
/* ------------------------------------------------------------------ */

/** The merit award the floor is drawn from: the average, when the college reports one. */
export function meritFloor(curve: CostCurve, merit: MeritInfo | null): { price: number; share: number | null; proxy: boolean } | null {
  if (!merit || (merit.cls !== "merit_reported" && merit.cls !== "merit_proxy") || merit.avg === null || merit.avg <= 0) return null;
  return { price: Math.max(0, curve.coa - merit.avg), share: merit.share, proxy: merit.cls === "merit_proxy" };
}

/** The field that supports a merit class's figures (their ⓘ): the policy, the CDS-based class, or the IPEDS proxy. */
export function meritCitedField(merit: MeritInfo): FieldPath {
  if (merit.source === "policy") return "aid_policy.need_only";
  return merit.source === "ipeds" ? "derived.merit_proxy" : "derived.merit_class";
}

/** "18% got one": the share behind the merit floor's label. */
const shareText = (share: number | null): string => (share === null ? "some got one" : `${pctSmart(share)} got one`);

/** The merit floor's label on the chart: never a promise, so "average award" and the share. */
export function meritFloorLabel(curve: CostCurve, merit: MeritInfo | null): string | null {
  const f = meritFloor(curve, merit);
  if (!f) return null;
  return `With an average merit award: ${priceLabel(f.price)} · ${f.proxy ? "proxy: " : ""}${shareText(f.share)}`;
}

/* ------------------------------------------------------------------ */
/* The three facts                                                      */
/* ------------------------------------------------------------------ */

export interface FactView {
  key: "full_price" | "need_aid" | "merit";
  label: string;
  term: TermKey;
  /** The field the value's ⓘ cites. */
  field: FieldPath;
  value: string;
  sub: string | null;
  /** The value carries a modeled figure; value + sub then say "estimate". */
  estimate: boolean;
}

/** The field that supplies the curve's full price (mirrors `costCurveInput`'s order). */
export function fullPriceField(school: Pick<School, "type" | "cost">): FieldPath {
  const c = school.cost;
  if (school.type === "public") return c?.sticker?.in_state != null ? "cost.sticker" : "cost.cost_of_attendance";
  if (c?.breakdown?.full_price != null) return "cost.breakdown";
  return c?.sticker?.in_state != null ? "cost.sticker" : "cost.cost_of_attendance";
}

/** The facts row: full price, where need-based aid ends, merit aid (merit only when the college has a class). */
export function costFacts(args: {
  school: Pick<School, "type" | "cost">;
  curve: CostCurve | null;
  merit: MeritInfo | null;
  showEstimates: boolean;
}): FactView[] {
  const { school, curve, merit, showEstimates } = args;
  const out: FactView[] = [];
  if (!curve) return out;

  out.push({
    key: "full_price",
    label: school.type === "public" ? "Full price, in-state" : "Full price",
    term: "cost-of-attendance",
    field: fullPriceField(school),
    value: `${money(curve.coa)} a year`,
    sub: "tuition, housing, food, books, and other costs",
    estimate: false,
  });

  const need = needAidView(curve, showEstimates);
  if (need.kind === "break_point") {
    const r = breakRangeLabel(need.lo, need.hi);
    out.push({
      key: "need_aid",
      label: "Need-based aid up to",
      term: "break-point",
      field: "derived.need_aid_break_income",
      value: breakIncomeLabel(need.mid),
      sub: `family income (${ESTIMATE_WORD}${r !== incomeLabel(roundIncome(need.mid)) ? `, likely ${r}` : ""})`,
      estimate: true,
    });
  } else if (need.kind === "little_above_110k") {
    out.push({
      key: "need_aid",
      label: "Need-based aid",
      term: "break-point",
      field: "derived.need_aid_status",
      value: `Little above ${incomeLabel(FEDERAL_TOP)}`,
      sub: "aid thins out for families above that income",
      estimate: false,
    });
  } else {
    out.push({
      key: "need_aid",
      label: "Need-based aid",
      term: "break-point",
      field: "cost.net_price_by_income",
      value: `Published data end at ${incomeLabel(FEDERAL_TOP)}`,
      sub: "use the college's net price calculator for higher incomes",
      estimate: false,
    });
  }

  const m = meritFact(merit, need.kind === "break_point");
  if (m) out.push(m);
  return out;
}

function meritFact(merit: MeritInfo | null, breakShown: boolean): FactView | null {
  if (!merit || merit.cls === "unknown") return null;
  const avg = merit.avg !== null && merit.avg > 0 ? priceLabel(merit.avg) : null;
  const base = { key: "merit" as const, label: "Merit aid", term: "merit-aid" as const, estimate: false };
  if (merit.cls === "need_only") {
    const fromProxy = merit.source === "ipeds";
    return {
      ...base,
      field: meritCitedField(merit),
      value: fromProxy ? "Little or none" : "None",
      sub: fromProxy
        ? "under 2% of first-years got a grant without federal aid"
        : breakShown
          ? "grants are need-based only, so above the point where need-based aid ends everyone pays the full price"
          : "all grants are need-based",
    };
  }
  if (merit.cls === "merit_reported") {
    return {
      ...base,
      field: "derived.merit_class",
      value: [merit.share !== null ? pctSmart(merit.share) : null, avg ? `avg ${avg}` : null].filter(Boolean).join(" · ") || "Offered",
      sub: `${merit.share !== null ? "of first-years without need got merit aid" : "the college reports merit aid to students without need"}`,
    };
  }
  return {
    ...base,
    field: "derived.merit_proxy",
    value: [merit.share !== null ? pctSmart(merit.share) : null, avg ? `avg ${avg}` : null].filter(Boolean).join(" · ") || "Likely",
    sub: "of first-years got a grant without federal aid (a proxy: at most colleges that's merit aid)",
  };
}

/* ------------------------------------------------------------------ */
/* Promises                                                             */
/* ------------------------------------------------------------------ */

/** A promise as the chart labels it: short, with "(in-state)" where it applies to residents only. */
export function promiseChartLabel(p: CostCurve["promises"][number]): string {
  const inState = p.label.endsWith("(in-state)") ? " (in-state)" : "";
  return p.kind === "free_tuition" ? `No tuition under ${incomeLabel(p.income)}${inState}` : `No family contribution under ${incomeLabel(p.income)}${inState}`;
}

/* ------------------------------------------------------------------ */
/* The table view                                                       */
/* ------------------------------------------------------------------ */

export interface TableRow {
  income: string;
  price: Phrase;
}

/** The curve as a table: the four published bands, then the incomes above $110K every $50K. */
export function tableRows(curve: CostCurve, showEstimates: boolean): TableRow[] {
  const rows: TableRow[] = FEDERAL_BANDS.map((b) => ({ income: b.label, price: describePrice(priceAt(curve, b.lo, showEstimates)) }));
  for (const income of [150_000, 200_000, 250_000, 300_000, 350_000, INCOME_MAX]) {
    const p = priceAt(curve, income, showEstimates);
    rows.push({
      income: income === INCOME_MAX ? `${incomeLabel(income)} and above` : incomeLabel(income),
      price: p.kind === "unknown" ? { text: missing(income, showEstimates), estimate: false } : describePrice(p),
    });
  }
  return rows;
}

/** The chart's description for screen readers. */
export function chartSummary(curve: CostCurve, merit: MeritInfo | null, showEstimates: boolean): Phrase {
  const need = needAidView(curve, showEstimates);
  const parts = [`Price per year by family income. Published figures up to ${incomeLabel(FEDERAL_TOP)}, from ${priceRangeLabel(Math.min(...curve.published.map((s) => s.price)), Math.max(...curve.published.map((s) => s.price)))}.`];
  if (need.kind === "break_point") parts.push(`Need-based aid ends ${breakIncomeLabel(need.mid)} (${ESTIMATE_WORD}); the full price is ${priceLabel(curve.coa)}.`);
  else if (need.kind === "little_above_110k") parts.push(`Little need-based aid above ${incomeLabel(FEDERAL_TOP)}.`);
  else parts.push(`Published data end at ${incomeLabel(FEDERAL_TOP)}.`);
  const floor = meritFloorLabel(curve, merit);
  if (floor) parts.push(`${floor}.`);
  return { text: parts.join(" "), estimate: need.kind === "break_point" };
}

/* ------------------------------------------------------------------ */
/* What can change this                                                 */
/* ------------------------------------------------------------------ */

export interface ChangeNote {
  key: "assets" | "home_equity" | "siblings" | "divorced";
  text: string;
  /** The field the note's ⓘ cites, when the note states something a source says. */
  field: FieldPath | null;
}

/**
 * The notes under the slider: what moves a real family's price off the reference family's curve. Home equity only
 * says how the college treats it when its policy does (otherwise generic, and not at all where the FAFSA decides);
 * siblings only where the college has a sibling rule; divorced parents where the college's formula is its own.
 */
export function changeNotes(args: {
  name: string;
  policy: AidPolicy | null;
  methodology: "federal" | "institutional" | "both" | null;
}): ChangeNote[] {
  const { name, policy, methodology } = args;
  const notes: ChangeNote[] = [
    { key: "assets", text: "Savings and investments above a typical amount raise the price. The curve assumes typical assets.", field: null },
  ];
  const he = policy?.home_equity ?? null;
  if (he === "ignored") notes.push({ key: "home_equity", text: `Home equity: ${name} says it doesn't count it.`, field: "aid_policy.home_equity" });
  else if (he === "full") notes.push({ key: "home_equity", text: `Home equity: ${name} counts all of it, so a valuable home can raise the price.`, field: "aid_policy.home_equity" });
  else if (he && typeof he === "object") notes.push({ key: "home_equity", text: `Home equity: ${name} counts it up to ${he.cap_multiple}× family income.`, field: "aid_policy.home_equity" });
  else if (methodology !== "federal") notes.push({ key: "home_equity", text: "Home equity: some colleges that use the CSS Profile count it. Check this college's own aid page or calculator.", field: null });
  if (policy && (policy.siblings === "split" || policy.siblings === "reduce")) {
    notes.push({
      key: "siblings",
      text: `A sibling in college may lower the parent share at ${name}${policy.siblings_note ? `: ${policy.siblings_note}` : ""}.`,
      field: "aid_policy.siblings",
    });
  }
  if (methodology === "institutional") {
    notes.push({ key: "divorced", text: "Divorced or separated parents: colleges with their own formula usually ask for both parents' finances.", field: "derived.aid_methodology" });
  }
  return notes;
}
