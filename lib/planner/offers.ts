/**
 * Offers (specs/planner/offers.md "Computation"): pure math over a family's aid offer in the federal College Financing
 * Plan (CFP) layout. No I/O and no dataset imports, so the form (client), the stage panel and the dossier (server), and
 * tests all share it.
 *
 * - **CFP mapping** (`cfpView`): the letter's cost of attendance, or, when the letter doesn't state one, the site's
 *   full price for the college (flagged "cost added from IPEDS", with its year from lineage); gifts by source; net
 *   cost = COA − gift aid; out of pocket = net cost − work-study (work-study shown "if earned"); loans by kind, with
 *   Parent PLUS and private loans flagged "not aid" and left out of the headline.
 * - **Flags → questions** (`offerFlags`): the traps the form surfaces as it's filled and the stage lists as questions
 *   to ask the aid office.
 * - **Four years** (`fourYears`): tuition and housing grow at the college's own nominal trend (lib/planner/offers-server.ts
 *   reads it from history), each gift renews per its flag (unknown: shown both ways), federal loan limits step up by
 *   year, and the monthly payment on the 10-year standard plan at the award year's rate (data/reference/federal-loans.json),
 *   labelled as such so offers compare like for like; the tiered term the balance would actually get is shown beside it.
 * - **Appeal summary** (`appealSummary`): a short line the family can send when another offer is better.
 *
 * Award years are named by the July they start (2027 = 2027–28); labels come from `awardYearLabel`, never typed.
 */
import loansFile from "../../data/reference/federal-loans.json" with { type: "json" };
import type { OfferCoa, OfferGift, OfferLoan, PlanOffer } from "./types.ts";

/* ------------------------------------------------------------------ */
/* The loans reference file                                            */
/* ------------------------------------------------------------------ */

export interface LoanRate {
  award_year: number;
  first_disbursed: [string, string];
  undergraduate: number;
  parent_plus: number;
  source: string;
  source_note?: string;
}
export interface DependentLimits {
  from_award_year: number;
  years: { year: number; total: number; subsidized: number }[];
  aggregate: { total: number; subsidized: number };
  source: string;
  source_note?: string;
}
export interface PlusLimits {
  from_award_year: number;
  annual: number | null;
  aggregate: number | null;
  source: string;
  source_note?: string;
}
export interface RepaymentTiers {
  from_award_year: number;
  plan: string;
  terms: { below: number | null; years: number }[];
  source: string;
  source_note?: string;
}
export interface LoanReference {
  description?: string;
  rates: LoanRate[];
  dependent_limits: DependentLimits[];
  parent_plus_limits: PlusLimits[];
  repayment: RepaymentTiers[];
  comparison_term_years: number;
}

export const LOANS = loansFile as LoanReference;

/** "2027–28" for the award year starting July 2027. */
export function awardYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, "0")}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/\S+$/;
const isYear = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 2000 && (v as number) <= 2100;
const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
const isRate = (v: unknown): v is number => typeof v === "number" && v > 0 && v < 0.25;

/** Every problem with the reference file, as lines; empty when it's valid. */
export function validateLoanReference(raw: unknown): string[] {
  const out: string[] = [];
  if (!raw || typeof raw !== "object") return ["the file must be an object"];
  const r = raw as Partial<LoanReference>;
  for (const k of ["rates", "dependent_limits", "parent_plus_limits", "repayment"] as const) {
    if (!Array.isArray(r[k]) || r[k]!.length === 0) out.push(`${k} must be a non-empty array`);
  }
  if (out.length) return out;
  const seen = new Set<number>();
  for (const [i, e] of r.rates!.entries()) {
    const at = `rates[${i}]`;
    if (!isYear(e.award_year)) out.push(`${at}: award_year must be a year`);
    else if (seen.has(e.award_year)) out.push(`${at}: award year ${e.award_year} listed twice`);
    else seen.add(e.award_year);
    if (!isRate(e.undergraduate)) out.push(`${at}: undergraduate must be a rate between 0 and 0.25`);
    if (!isRate(e.parent_plus)) out.push(`${at}: parent_plus must be a rate between 0 and 0.25`);
    if (!Array.isArray(e.first_disbursed) || e.first_disbursed.length !== 2 || !e.first_disbursed.every((d) => typeof d === "string" && ISO.test(d))) {
      out.push(`${at}: first_disbursed must be [start, end] dates`);
    } else if (isYear(e.award_year) && e.first_disbursed[0] !== `${e.award_year}-07-01`) out.push(`${at}: an award year starts July 1 of its year`);
    if (typeof e.source !== "string" || !HTTPS.test(e.source)) out.push(`${at}: source must be an https URL`);
  }
  for (const [i, e] of r.dependent_limits!.entries()) {
    const at = `dependent_limits[${i}]`;
    if (!isYear(e.from_award_year)) out.push(`${at}: from_award_year must be a year`);
    if (!Array.isArray(e.years) || e.years.length !== 4) out.push(`${at}: years must list years 1 to 4`);
    else
      e.years.forEach((y, j) => {
        if (y.year !== j + 1) out.push(`${at}: years[${j}] must be year ${j + 1}`);
        if (!isMoney(y.total) || !isMoney(y.subsidized) || y.subsidized > y.total) out.push(`${at}: year ${j + 1} needs total ≥ subsidized ≥ 0`);
        if (j > 0 && y.total < e.years[j - 1].total) out.push(`${at}: limits never step down`);
      });
    if (!e.aggregate || !isMoney(e.aggregate.total) || !isMoney(e.aggregate.subsidized)) out.push(`${at}: aggregate needs total and subsidized`);
    if (typeof e.source !== "string" || !HTTPS.test(e.source)) out.push(`${at}: source must be an https URL`);
  }
  for (const [i, e] of r.parent_plus_limits!.entries()) {
    const at = `parent_plus_limits[${i}]`;
    if (!isYear(e.from_award_year)) out.push(`${at}: from_award_year must be a year`);
    if (e.annual !== null && !isMoney(e.annual)) out.push(`${at}: annual must be dollars or null (no fixed limit)`);
    if (e.aggregate !== null && !isMoney(e.aggregate)) out.push(`${at}: aggregate must be dollars or null`);
    if (typeof e.source !== "string" || !HTTPS.test(e.source)) out.push(`${at}: source must be an https URL`);
  }
  for (const [i, e] of r.repayment!.entries()) {
    const at = `repayment[${i}]`;
    if (!isYear(e.from_award_year)) out.push(`${at}: from_award_year must be a year`);
    if (!Array.isArray(e.terms) || e.terms.length === 0) out.push(`${at}: terms must be a non-empty array`);
    else {
      if (e.terms[e.terms.length - 1].below !== null) out.push(`${at}: the last term must have below: null (everything above)`);
      e.terms.forEach((t, j) => {
        if (!Number.isInteger(t.years) || t.years < 1 || t.years > 30) out.push(`${at}: terms[${j}].years must be 1–30`);
        if (j < e.terms.length - 1 && !isMoney(t.below)) out.push(`${at}: terms[${j}].below must be dollars`);
        if (j > 0 && t.below !== null && e.terms[j - 1].below !== null && t.below <= e.terms[j - 1].below!) out.push(`${at}: terms must rise`);
      });
    }
    if (typeof e.source !== "string" || !HTTPS.test(e.source)) out.push(`${at}: source must be an https URL`);
  }
  if (!Number.isInteger(r.comparison_term_years) || r.comparison_term_years! < 1) out.push("comparison_term_years must be a whole number of years");
  return out;
}

/** The rule in force for an award year: the entry with the latest `from_award_year` at or before it. */
function inForce<T extends { from_award_year: number }>(entries: T[], awardYear: number): T | null {
  return entries.filter((e) => e.from_award_year <= awardYear).sort((a, b) => b.from_award_year - a.from_award_year)[0] ?? null;
}

/**
 * The fixed rates for loans first disbursed in an award year. Rates are announced each May, so an offer for an award
 * year not yet announced uses the newest published year (`exact: false`, and the UI says which year it used).
 */
export function ratesFor(awardYear: number, ref: LoanReference = LOANS): (LoanRate & { exact: boolean }) | null {
  const exact = ref.rates.find((r) => r.award_year === awardYear);
  if (exact) return { ...exact, exact: true };
  const before = ref.rates.filter((r) => r.award_year < awardYear).sort((a, b) => b.award_year - a.award_year)[0];
  return before ? { ...before, exact: false } : null;
}

/** Dependent undergraduate annual limits (years 1–4) in force for an award year. */
export function dependentLimits(awardYear: number, ref: LoanReference = LOANS): DependentLimits | null {
  return inForce(ref.dependent_limits, awardYear);
}

/** Parent PLUS limits in force for an award year (null fields: no fixed limit). */
export function plusLimits(awardYear: number, ref: LoanReference = LOANS): PlusLimits | null {
  return inForce(ref.parent_plus_limits, awardYear);
}

/** The standard plan's term for a balance under the rules in force (the tiered plan from July 2026); null when unknown. */
export function repaymentTerm(balance: number, awardYear: number, ref: LoanReference = LOANS): { years: number; plan: string; source: string } | null {
  const rule = inForce(ref.repayment, awardYear);
  if (!rule) return null;
  const t = rule.terms.find((x) => x.below === null || balance < x.below);
  return t ? { years: t.years, plan: rule.plan, source: rule.source } : null;
}

/** A fixed monthly payment that repays `principal` over `years` at an annual `rate` (monthly compounding). */
export function monthlyPayment(principal: number, rate: number, years: number): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = rate / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const GIFT_KINDS: OfferGift["kind"][] = ["federal", "state", "college_need", "college_merit", "outside"];
export const GIFT_LABELS: Record<OfferGift["kind"], string> = {
  federal: "Federal grants (Pell, SEOG)",
  state: "State grants",
  college_need: "From the college, need-based",
  college_merit: "From the college, merit",
  outside: "Outside scholarships",
};
export const LOAN_KINDS: OfferLoan["kind"][] = ["direct_sub", "direct_unsub", "parent_plus", "private", "institutional"];
export const LOAN_LABELS: Record<OfferLoan["kind"], string> = {
  direct_sub: "Federal Direct Subsidized",
  direct_unsub: "Federal Direct Unsubsidized",
  parent_plus: "Parent PLUS (a parent's loan)",
  private: "Private loan",
  institutional: "The college's own loan",
};
/** Loans that aren't aid: a parent's debt or a bank's. Never in the headline. */
export const NOT_AID: readonly OfferLoan["kind"][] = ["parent_plus", "private"];

export const COA_PARTS = ["tuition_fees", "housing_food", "books", "transport", "personal", "other"] as const;
export type CoaPart = (typeof COA_PARTS)[number];
export const COA_LABELS: Record<CoaPart, string> = {
  tuition_fees: "Tuition and fees",
  housing_food: "Housing and food",
  books: "Books and supplies",
  transport: "Transportation",
  personal: "Personal expenses",
  other: "Other",
};

/** "$12,345", rounded to the dollar. */
export function usd(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US")}`;
}

/* ------------------------------------------------------------------ */
/* The College Financing Plan view                                     */
/* ------------------------------------------------------------------ */

/** The site's full price for the college (cost.sticker by residency), used when a letter states no cost. */
export interface FallbackCoa {
  amount: number | null;
  /** The figure's year, from lineage ("2024–25"); never typed in code. */
  year: string | null;
}

export type CoaSource = "letter" | "letter_parts" | "ipeds" | "none";

export interface CfpView {
  coa: {
    total: number | null;
    source: CoaSource;
    /** The IPEDS year when the total came from the site. */
    year: string | null;
    parts: Record<CoaPart, number | null>;
  };
  gifts: { byKind: Record<OfferGift["kind"], number>; total: number };
  netCost: number | null;
  workStudy: number;
  /** Net cost − work-study (work-study only counts once it's earned). */
  outOfPocket: number | null;
  loans: {
    byKind: Record<OfferLoan["kind"], number>;
    /** Direct Subsidized + Unsubsidized: the student's federal loans. */
    studentFederal: number;
    /** Loans that count in the headline: the student's federal loans and the college's own. */
    headline: number;
    /** Parent PLUS + private: shown, flagged "not aid". */
    notAid: number;
    total: number;
  };
}

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (typeof b === "number" && Number.isFinite(b) ? b : 0), 0);
const posOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Maps an offer onto the CFP layout. `fallback` is the site's full price for the college and residency. */
export function cfpView(offer: Pick<PlanOffer, "coa" | "gift" | "work_study" | "loans">, fallback: FallbackCoa | null): CfpView {
  const coa: Partial<OfferCoa> = offer.coa ?? {};
  const parts = Object.fromEntries(COA_PARTS.map((p) => [p, posOrNull(coa[p])])) as Record<CoaPart, number | null>;
  const partsSum = sum(Object.values(parts));
  let total: number | null = null;
  let source: CoaSource = "none";
  let year: string | null = null;
  if (posOrNull(coa.total) !== null) {
    total = coa.total!;
    source = "letter";
  } else if (partsSum > 0) {
    total = partsSum;
    source = "letter_parts";
  } else if (fallback?.amount) {
    total = fallback.amount;
    source = "ipeds";
    year = fallback.year;
  }
  const byKind = Object.fromEntries(GIFT_KINDS.map((k) => [k, 0])) as Record<OfferGift["kind"], number>;
  for (const g of offer.gift ?? []) if (GIFT_KINDS.includes(g.kind) && Number.isFinite(g.amount) && g.amount > 0) byKind[g.kind] += g.amount;
  const giftTotal = sum(Object.values(byKind));
  const loanKinds = Object.fromEntries(LOAN_KINDS.map((k) => [k, 0])) as Record<OfferLoan["kind"], number>;
  for (const l of offer.loans ?? []) if (LOAN_KINDS.includes(l.kind) && Number.isFinite(l.amount) && l.amount > 0) loanKinds[l.kind] += l.amount;
  const studentFederal = loanKinds.direct_sub + loanKinds.direct_unsub;
  const notAid = loanKinds.parent_plus + loanKinds.private;
  const workStudy = posOrNull(offer.work_study) ?? 0;
  const netCost = total === null ? null : total - giftTotal;
  return {
    coa: { total, source, year, parts },
    gifts: { byKind, total: giftTotal },
    netCost,
    workStudy,
    outOfPocket: netCost === null ? null : netCost - workStudy,
    loans: { byKind: loanKinds, studentFederal, headline: studentFederal + loanKinds.institutional, notAid, total: studentFederal + loanKinds.institutional + notAid },
  };
}

/* ------------------------------------------------------------------ */
/* Flags → questions                                                   */
/* ------------------------------------------------------------------ */

export type OfferFlagKey =
  | "coa_missing"
  | "coa_from_site"
  | "coa_no_housing"
  | "loan_in_gifts"
  | "plus_fills_gap"
  | "private_loan"
  | "renewal_unknown"
  | "first_year_only"
  | "need_called_scholarship"
  | "outside_displacement"
  | "work_study";

export interface OfferFlag {
  key: OfferFlagKey;
  /** "trap": something that makes the offer look better than it is; "note": worth knowing. */
  severity: "trap" | "note";
  /** What the form or the stage says. */
  line: string;
  /** The question to ask the aid office, when there is one. */
  question: string | null;
  /** The gift line the flag is about (the form highlights it). */
  gift?: number;
}

const LOAN_WORDS = /\b(loans?|stafford|perkins|plus)\b/i;
const SCHOLARSHIP_WORD = /\bscholarships?\b/i;

/**
 * The traps (offers.md "Research", "Questions to ask"), in the order the stage lists them. Works on a draft as it's
 * typed (the form shows them inline) and on a saved offer (the stage turns them into questions).
 */
export function offerFlags(offer: Pick<PlanOffer, "coa" | "gift" | "work_study" | "loans">, view: CfpView, collegeName = "the college"): OfferFlag[] {
  const out: OfferFlag[] = [];
  if (view.coa.source === "ipeds" || view.coa.source === "none") {
    out.push({
      key: "coa_missing",
      severity: "trap",
      line:
        view.coa.source === "ipeds"
          ? `The letter didn't state a cost of attendance, so the site's full price${view.coa.year ? ` (${view.coa.year})` : ""} stands in. A letter without the cost can make the aid look like it covers more than it does.`
          : "The letter didn't state a cost of attendance, and the site has no full price for this college.",
      question: `What is the full cost of attendance for the year, including housing, food, books, and travel?`,
    });
  } else if (view.coa.source === "letter_parts" && view.coa.parts.housing_food === null) {
    out.push({
      key: "coa_no_housing",
      severity: "trap",
      line: "The cost lists no housing and food, so it's understated unless the student lives at home.",
      question: "What does housing and food cost for a first-year in college housing?",
    });
  }
  (offer.gift ?? []).forEach((g, i) => {
    if (LOAN_WORDS.test(g.name ?? "")) {
      out.push({ key: "loan_in_gifts", severity: "trap", gift: i, line: `"${g.name}" sounds like a loan, listed under grants. Move it to loans?`, question: `Is "${g.name}" a loan that has to be repaid?` });
    }
  });
  const gap = view.netCost === null ? null : view.netCost - view.workStudy - view.loans.headline;
  if (view.loans.byKind.parent_plus > 0) {
    const fills = gap !== null && gap > 0 && view.loans.byKind.parent_plus >= gap * 0.8;
    out.push({
      key: "plus_fills_gap",
      severity: "trap",
      line: fills
        ? `Parent PLUS (${usd(view.loans.byKind.parent_plus)}) fills the gap. It's a parent's loan, not aid: the offer leaves ${usd(gap!)} to pay.`
        : `Parent PLUS (${usd(view.loans.byKind.parent_plus)}) is a parent's loan, not aid; it's left out of the headline.`,
      question: "Is there more grant aid available, so we don't need the Parent PLUS loan?",
    });
  }
  if (view.loans.byKind.private > 0) {
    out.push({ key: "private_loan", severity: "trap", line: "A private loan is a bank's loan, not aid; it's left out of the headline.", question: "Why is a private loan in the offer, and is there federal or grant aid instead?" });
  }
  (offer.gift ?? []).forEach((g, i) => {
    if (g.kind === "college_need" || g.kind === "college_merit") {
      if (g.renewable === null) {
        out.push({ key: "renewal_unknown", severity: "trap", gift: i, line: `"${g.name || GIFT_LABELS[g.kind]}": the letter doesn't say whether it renews.`, question: `Does "${g.name || GIFT_LABELS[g.kind]}" renew for all four years, and on what conditions (GPA, credits, a major)?` });
      } else if (g.renewable === true && !g.renewal_condition) {
        out.push({ key: "renewal_unknown", severity: "note", gift: i, line: `"${g.name || GIFT_LABELS[g.kind]}" renews, but the conditions aren't written down.`, question: `What does it take to keep "${g.name || GIFT_LABELS[g.kind]}" each year?` });
      }
    }
    if (g.renewable === false || g.years === 1) {
      out.push({ key: "first_year_only", severity: "trap", gift: i, line: `"${g.name || GIFT_LABELS[g.kind]}" is for the first year only: the four-year cost goes up by ${usd(g.amount * 3)}.`, question: null });
    }
    if (g.kind === "college_need" && SCHOLARSHIP_WORD.test(g.name ?? "")) {
      out.push({
        key: "need_called_scholarship",
        severity: "note",
        gift: i,
        line: `"${g.name}" is need-based even though it's called a scholarship: it can change when the family's income does.`,
        question: `Is "${g.name}" recalculated each year from the FAFSA or CSS Profile?`,
      });
    }
    if (g.kind === "outside") {
      out.push({
        key: "outside_displacement",
        severity: "note",
        gift: i,
        line: `An outside scholarship can lower what ${collegeName} gives (award displacement).`,
        question: `If ${g.name ? `"${g.name}"` : "an outside scholarship"} comes through, which part of the offer goes down: loans and work-study, or grants?`,
      });
    }
  });
  if (view.workStudy > 0) {
    out.push({ key: "work_study", severity: "note", line: `Work-study (${usd(view.workStudy)}) is paid as the student works, not up front; it's shown as "if earned".`, question: "How many hours a week does the work-study amount assume, and are jobs easy to find?" });
  }
  return out;
}

/** The questions to ask the aid office, from the flags (each once). */
export function questionsToAsk(flags: OfferFlag[]): string[] {
  return [...new Set(flags.map((f) => f.question).filter((q): q is string => q !== null))];
}

/* ------------------------------------------------------------------ */
/* Four years                                                          */
/* ------------------------------------------------------------------ */

/**
 * The college's own cost trend (nominal, not inflation-adjusted), read from its history on the server: average yearly
 * growth of tuition, of housing (full price − tuition), and of the full price. `from`/`to` are the years the trend
 * covers, from lineage. Null rates: no trend for that part, shown flat.
 */
export interface OfferTrend {
  tuition: number | null;
  housing: number | null;
  fullPrice: number | null;
  from: string;
  to: string;
}

export interface YearRow {
  year: 1 | 2 | 3 | 4;
  coa: number | null;
  /** Gifts if every gift with an unknown renewal renews. */
  gift: number;
  /** Gifts if those don't renew. */
  giftIfNotRenewed: number;
  net: number | null;
  netIfNotRenewed: number | null;
  studentFederal: number;
  parentPlus: number;
  otherLoans: number;
}

export interface Payment {
  principal: number;
  rate: number;
  /** The award year whose rate was used; `exact` false when the offer's year isn't announced yet. */
  rateYear: number;
  exact: boolean;
  /** The like-for-like comparison: the 10-year standard payment. */
  termYears: number;
  monthly: number;
  /** The term the balance would actually get under the standard plan in force, when it differs from the comparison term. */
  tier: { years: number; monthly: number; plan: string } | null;
}

export interface FourYears {
  years: YearRow[];
  totals: { coa: number | null; gift: number; giftIfNotRenewed: number; net: number | null; netIfNotRenewed: number | null; studentFederal: number; parentPlus: number; otherLoans: number };
  /** Some gift's renewal is unknown, so the totals show both ways. */
  bothWays: boolean;
  /** "trend": costs grow at the college's own rate; "flat": no trend, so they're held level (and the stage says so). */
  growth: "trend" | "flat";
  student: Payment | null;
  parent: Payment | null;
}

const grow = (v: number, rate: number | null, k: number) => v * Math.pow(1 + (rate ?? 0), k - 1);

/** Whether a gift pays in year k: renewal per its flag, `years` capping it; unknown renewal counts as renewing when `assumeRenew`. */
export function giftInYear(g: OfferGift, k: number, assumeRenew: boolean): boolean {
  const cap = typeof g.years === "number" && g.years >= 1 ? g.years : null;
  if (cap !== null && k > cap) return false;
  if (k === 1) return true;
  if (g.renewable === true) return true;
  if (g.renewable === false) return cap !== null && k <= cap;
  return assumeRenew;
}

function payment(principal: number, kind: "undergraduate" | "parent_plus", awardYear: number, ref: LoanReference): Payment | null {
  if (principal <= 0) return null;
  const rates = ratesFor(awardYear, ref);
  if (!rates) return null;
  const rate = kind === "undergraduate" ? rates.undergraduate : rates.parent_plus;
  const termYears = ref.comparison_term_years;
  const tierRule = repaymentTerm(principal, awardYear, ref);
  return {
    principal,
    rate,
    rateYear: rates.award_year,
    exact: rates.exact,
    termYears,
    monthly: monthlyPayment(principal, rate, termYears),
    tier: tierRule && tierRule.years !== termYears ? { years: tierRule.years, monthly: monthlyPayment(principal, rate, tierRule.years), plan: tierRule.plan } : null,
  };
}

/**
 * Four years of an offer. Year 1 is the letter. Later years: tuition grows at the college's tuition trend; housing and
 * the other living costs at its housing trend; a cost stated only as a total (or the site's full price) at the
 * full-price trend. Gifts keep their amounts and renew per their flags. The student's federal loans step up with the
 * annual limits when year 1 is at the limit (else stay level); Parent PLUS stays level within its limits; other loans
 * stay level. Payments: the student's federal loans at the undergraduate rate, Parent PLUS at the PLUS rate (private
 * and college loans have no published rate, so no payment). Interest that builds during college isn't added.
 */
export function fourYears(
  offer: Pick<PlanOffer, "award_year" | "coa" | "gift" | "work_study" | "loans">,
  view: CfpView,
  trend: OfferTrend | null,
  ref: LoanReference = LOANS,
): FourYears {
  const p = view.coa.parts;
  const tuition = view.coa.source === "ipeds" ? 0 : (p.tuition_fees ?? 0);
  const living = view.coa.source === "ipeds" ? 0 : sum([p.housing_food, p.books, p.transport, p.personal, p.other]);
  const rest = view.coa.total === null ? 0 : Math.max(0, view.coa.total - tuition - living);
  const limits = dependentLimits(offer.award_year, ref);
  const plus = plusLimits(offer.award_year, ref);
  const a1 = view.loans.studentFederal;
  const l1 = limits?.years[0].total ?? null;
  const gifts = offer.gift ?? [];
  const bothWays = gifts.some((g) => g.renewable === null && !(typeof g.years === "number" && g.years <= 1));
  const otherLoans = view.loans.byKind.private + view.loans.byKind.institutional;
  const years: YearRow[] = [];
  let plusSoFar = 0;
  for (const k of [1, 2, 3, 4] as const) {
    const coa = view.coa.total === null ? null : grow(tuition, trend?.tuition ?? null, k) + grow(living, trend?.housing ?? null, k) + grow(rest, trend?.fullPrice ?? trend?.tuition ?? null, k);
    const gift = sum(gifts.filter((g) => giftInYear(g, k, true)).map((g) => g.amount));
    const giftIfNotRenewed = sum(gifts.filter((g) => giftInYear(g, k, false)).map((g) => g.amount));
    let studentFederal = a1;
    if (k > 1 && limits && l1 !== null && a1 > 0) {
      const lk = limits.years[k - 1].total;
      studentFederal = a1 >= l1 ? lk : Math.min(a1, lk);
    }
    let parentPlus = view.loans.byKind.parent_plus;
    if (plus?.annual != null) parentPlus = Math.min(parentPlus, plus.annual);
    if (plus?.aggregate != null) parentPlus = Math.max(0, Math.min(parentPlus, plus.aggregate - plusSoFar));
    plusSoFar += parentPlus;
    years.push({ year: k, coa, gift, giftIfNotRenewed, net: coa === null ? null : coa - gift, netIfNotRenewed: coa === null ? null : coa - giftIfNotRenewed, studentFederal, parentPlus, otherLoans });
  }
  const total = (f: (y: YearRow) => number | null) => (years.some((y) => f(y) === null) ? null : sum(years.map(f)));
  const studentTotal = sum(years.map((y) => y.studentFederal));
  const parentTotal = sum(years.map((y) => y.parentPlus));
  return {
    years,
    totals: {
      coa: total((y) => y.coa),
      gift: sum(years.map((y) => y.gift)),
      giftIfNotRenewed: sum(years.map((y) => y.giftIfNotRenewed)),
      net: total((y) => y.net),
      netIfNotRenewed: total((y) => y.netIfNotRenewed),
      studentFederal: studentTotal,
      parentPlus: parentTotal,
      otherLoans: sum(years.map((y) => y.otherLoans)),
    },
    bothWays,
    growth: trend && (trend.tuition !== null || trend.housing !== null || trend.fullPrice !== null) ? "trend" : "flat",
    student: payment(studentTotal, "undergraduate", offer.award_year, ref),
    parent: payment(parentTotal, "parent_plus", offer.award_year, ref),
  };
}

/**
 * Average yearly growth of a series over its last `span` years with values (nominal): (last / first)^(1/years) − 1.
 * Null with fewer than two values, a non-positive start, or a gap of more than half the span.
 */
export function growthRate(points: { year: number; value: number | null }[], span = 5): { rate: number; from: number; to: number } | null {
  const have = points.filter((p): p is { year: number; value: number } => p.value !== null && Number.isFinite(p.value)).sort((a, b) => a.year - b.year);
  if (have.length < 2) return null;
  const last = have[have.length - 1];
  const first = have.filter((p) => p.year >= last.year - span)[0];
  const n = last.year - first.year;
  if (n < 1 || first.value <= 0 || last.value <= 0) return null;
  const inWindow = have.filter((p) => p.year >= first.year).length;
  if (inWindow < Math.ceil((n + 1) / 2)) return null;
  return { rate: Math.pow(last.value / first.value, 1 / n) - 1, from: first.year, to: last.year };
}

/* ------------------------------------------------------------------ */
/* Comparing offers                                                    */
/* ------------------------------------------------------------------ */

export type OfferSortKey = "list" | "coa" | "gift" | "net" | "borrowing" | "four_year" | "monthly" | "earnings" | "grad_rate" | "distance" | "visit";

export const OFFER_SORTS: { key: OfferSortKey; label: string; dir: "asc" | "desc" }[] = [
  { key: "list", label: "Your list order", dir: "asc" },
  { key: "net", label: "Net cost, lowest first", dir: "asc" },
  { key: "four_year", label: "Four-year net cost, lowest first", dir: "asc" },
  { key: "gift", label: "Gift aid, most first", dir: "desc" },
  { key: "coa", label: "Cost of attendance, lowest first", dir: "asc" },
  { key: "borrowing", label: "Borrowing, least first", dir: "asc" },
  { key: "monthly", label: "Monthly payment, lowest first", dir: "asc" },
  { key: "earnings", label: "Earnings, highest first", dir: "desc" },
  { key: "grad_rate", label: "Graduation rate, highest first", dir: "desc" },
  { key: "distance", label: "Distance, nearest first", dir: "asc" },
  { key: "visit", label: "Visit rating, highest first", dir: "desc" },
];

/** Sorts rows by a key's value; values that aren't known go last whichever way, and ties keep the list order. */
export function sortOffers<T extends { position: number }>(rows: T[], key: OfferSortKey, value: (row: T, key: OfferSortKey) => number | null): T[] {
  const spec = OFFER_SORTS.find((s) => s.key === key) ?? OFFER_SORTS[0];
  return [...rows].sort((a, b) => {
    if (key === "list") return a.position - b.position;
    const va = value(a, key);
    const vb = value(b, key);
    if (va === null && vb === null) return a.position - b.position;
    if (va === null) return 1;
    if (vb === null) return -1;
    const d = spec.dir === "asc" ? va - vb : vb - va;
    return d !== 0 ? d : a.position - b.position;
  });
}

/**
 * The appeal line (offers.md "Appeal support"): when another admit's offer gives more gift aid, a short summary the
 * family can send. Family-entered numbers only; not a letter generator. Null when no other offer is better.
 */
export function appealSummary(
  target: { name: string; view: CfpView; awardYear: number },
  others: { name: string; view: CfpView }[],
  budget: number | null = null,
): string | null {
  const better = others.filter((o) => o.view.gifts.total > target.view.gifts.total).sort((a, b) => b.view.gifts.total - a.view.gifts.total)[0];
  if (!better) return null;
  const diff = better.view.gifts.total - target.view.gifts.total;
  const lines = [
    `We'd like to make ${target.name} work, and we're hoping you can take another look at our aid for ${awardYearLabel(target.awardYear)}.`,
    `${better.name} offered ${usd(diff)} more in grants and scholarships for the first year (${usd(better.view.gifts.total)} against ${usd(target.view.gifts.total)} from ${target.name}).`,
  ];
  if (better.view.netCost !== null && target.view.netCost !== null) {
    lines.push(`That puts the net cost at ${usd(better.view.netCost)} there and ${usd(target.view.netCost)} with you.`);
  }
  if (budget !== null && target.view.netCost !== null && target.view.netCost > budget) lines.push(`What our family can pay is about ${usd(budget)} a year.`);
  lines.push("We can send the other offer if that helps. Thank you for considering it.");
  return lines.join(" ");
}

/* ------------------------------------------------------------------ */
/* The form's draft                                                    */
/* ------------------------------------------------------------------ */

/** What the form submits (store-offers.ts saveOffer normalizes it again on the server). */
export interface OfferDraft {
  award_year: number;
  letter_date: string | null;
  coa: OfferCoa;
  gift: OfferGift[];
  work_study: number | null;
  loans: OfferLoan[];
}

const money = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 500_000 ? Math.round(n) : null;
};

/** Cleans a draft (from the form or a request) into the stored shape; returns problems when it can't be saved. */
export function normalizeDraft(raw: unknown): { ok: true; draft: OfferDraft } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") return { ok: false, message: "That offer is empty." };
  const r = raw as Record<string, unknown>;
  const awardYear = Number(r.award_year);
  if (!Number.isInteger(awardYear) || awardYear < 2000 || awardYear > 2100) return { ok: false, message: "Pick the award year." };
  const letter = typeof r.letter_date === "string" && ISO.test(r.letter_date) ? r.letter_date : null;
  const c = (r.coa ?? {}) as Record<string, unknown>;
  const coa: OfferCoa = {
    tuition_fees: money(c.tuition_fees),
    housing_food: money(c.housing_food),
    books: money(c.books),
    transport: money(c.transport),
    personal: money(c.personal),
    other: money(c.other),
    total: money(c.total),
    stated_by_college: c.stated_by_college === true,
  };
  const gift: OfferGift[] = [];
  for (const g of Array.isArray(r.gift) ? r.gift.slice(0, 20) : []) {
    const x = g as Record<string, unknown>;
    const amount = money(x.amount);
    if (!amount || !GIFT_KINDS.includes(x.kind as OfferGift["kind"])) continue;
    const years = Number(x.years);
    gift.push({
      kind: x.kind as OfferGift["kind"],
      name: String(x.name ?? "").trim().slice(0, 120),
      amount,
      renewable: x.renewable === true ? true : x.renewable === false ? false : null,
      renewal_condition: typeof x.renewal_condition === "string" && x.renewal_condition.trim() ? x.renewal_condition.trim().slice(0, 300) : null,
      years: Number.isInteger(years) && years >= 1 && years <= 6 ? years : null,
    });
  }
  const loans: OfferLoan[] = [];
  for (const l of Array.isArray(r.loans) ? r.loans.slice(0, 10) : []) {
    const x = l as Record<string, unknown>;
    const amount = money(x.amount);
    if (!amount || !LOAN_KINDS.includes(x.kind as OfferLoan["kind"])) continue;
    loans.push({ kind: x.kind as OfferLoan["kind"], amount });
  }
  const anything = Object.values(coa).some((v) => typeof v === "number") || gift.length > 0 || loans.length > 0 || money(r.work_study) !== null;
  if (!anything) return { ok: false, message: "Add at least one number from the letter." };
  return { ok: true, draft: { award_year: awardYear, letter_date: letter, coa, gift, work_study: money(r.work_study), loans } };
}

/* ------------------------------------------------------------------ */
/* The college facts an offer is read against                          */
/* ------------------------------------------------------------------ */

/**
 * What the stage shows beside an offer, cut from the dataset on the server (lib/planner/offers-server.ts) with every
 * figure's citation resolved (`citeField`; the ⓘ popover takes it). Serializable.
 */
export interface OfferFacts {
  unit_id: string;
  /** Which full price applies: the student's state against the college's (a public's in-state rate), or one rate. */
  residency: "in_state" | "out_of_state" | "single";
  /** The site's full price for that residency (cost.sticker), the COA fallback. */
  fullPrice: FallbackCoa;
  fullPriceCite: unknown;
  /** The college's own nominal cost trend from history, or null without one. */
  trend: OfferTrend | null;
  /** Where the trend comes from (IPEDS files and years, from history's lineage). */
  trendSources: { label: string; years: string; url: string }[];
  avgCost: number | null;
  avgCostCite: unknown;
  generosity: { share: number; label: string; cite: unknown } | null;
  earnings: number | null;
  earningsCite: unknown;
  debt: number | null;
  debtCite: unknown;
  gradRate: number | null;
  gradRateCite: unknown;
}

/** CDS C2 wait-list history for a college, cited (the wait-list rows of the stage and the decide task). */
export interface WaitListFacts {
  unit_id: string;
  offered: number | null;
  accepted: number | null;
  admitted: number | null;
  cites: { offered?: unknown; accepted?: unknown; admitted?: unknown };
}

/** "Offered 1,200 a place; 600 accepted; 45 admitted" (null when the college publishes none of it). */
export function waitListLine(w: Pick<WaitListFacts, "offered" | "accepted" | "admitted"> | null): string | null {
  if (!w) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  const parts: string[] = [];
  if (w.offered !== null) parts.push(`offered ${n(w.offered)} a place`);
  if (w.accepted !== null) parts.push(`${n(w.accepted)} accepted one`);
  if (w.admitted !== null) parts.push(`${n(w.admitted)} admitted from it`);
  if (!parts.length) return null;
  const line = parts.join("; ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The share of those who stayed on the wait list who got in, when both counts are published. */
export function waitListOdds(w: Pick<WaitListFacts, "accepted" | "admitted"> | null): number | null {
  return w && w.accepted && w.admitted !== null && w.accepted > 0 ? Math.min(1, w.admitted / w.accepted) : null;
}

/** An offer the family entered (confirmed), as opposed to a notes-only row holding pros and cons for an admit without one. */
export function isEnteredOffer(o: Pick<PlanOffer, "confirmed_at">): boolean {
  return o.confirmed_at !== null;
}
