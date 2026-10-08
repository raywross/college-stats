/**
 * Early decision measures (specs/product/early-decision-strategy.md "Data"; used by the planner's rounds stage,
 * specs/planner/early-rounds.md). Pure: from a college's CDS C21 counts and the same document's C1 totals, the ED
 * admit rate, the non-ED rate, the advantage as a multiple, and the share of the class filled by ED with a stated
 * yield assumption, plus the checks the ED strategy spec asks for. No I/O; safe in client code and tests.
 *
 * Wording rules (early-rounds.md "Rules"): the advantage is a multiple of the non-ED rate ("2.7× the non-ED rate"),
 * never "your odds"; a college that offers ED without publishing counts says so.
 */

/** Share of ED admits assumed to enroll (ED is binding; a few are released for aid). Stated wherever the share shows. */
export const ED_YIELD_ASSUMED = 0.95;
/** An advantage above this multiple goes to review instead of being shown (early-decision-strategy.md "Checks"). */
export const ADVANTAGE_REVIEW_MULTIPLE = 8;

export interface EarlyCounts {
  /** C21 ED applications and admits (one pair covers every ED round). */
  edApplicants: number | null;
  edAdmitted: number | null;
  /** C1 totals from the same CDS document as the ED counts; null when they aren't from it. */
  totalApplicants: number | null;
  totalAdmitted: number | null;
  enrolled: number | null;
  /** The college offers early action too: then the non-ED pool includes EA admits and is labeled "non-ED". */
  hasEarlyAction: boolean;
}

export type EarlyCheck =
  | "ed_admitted_over_applicants"
  | "ed_applicants_over_total"
  | "ed_admitted_over_total_admitted"
  | "non_ed_pool_empty"
  | "advantage_over_review";

export const EARLY_CHECK_LABELS: Record<EarlyCheck, string> = {
  ed_admitted_over_applicants: "more ED admits than ED applicants",
  ed_applicants_over_total: "more ED applicants than applicants in all",
  ed_admitted_over_total_admitted: "more ED admits than admits in all",
  non_ed_pool_empty: "no applicants outside the ED round",
  advantage_over_review: `an ED advantage over ${ADVANTAGE_REVIEW_MULTIPLE}×, held for review`,
};

export interface EarlyMeasures {
  /** ED admitted ÷ ED applicants; null without counts or when a check failed. */
  edRate: number | null;
  /** (total admitted − ED admitted) ÷ (total applicants − ED applicants); an upper bound on RD when EA exists. */
  nonEdRate: number | null;
  /** "non-ED" when the college has EA (the pool mixes EA and RD), else "regular". */
  nonEdLabel: "non-ED" | "regular";
  /** edRate ÷ nonEdRate; null when either is missing or the multiple is held for review. */
  advantage: number | null;
  /** ED admitted × ED_YIELD_ASSUMED ÷ enrolled, at most 1; null without the counts. */
  classShare: number | null;
  /** Failed checks. Any but `advantage_over_review` blanks every measure. */
  checks: EarlyCheck[];
}

const pos = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0;

/** Every check the counts fail (an empty list when they pass or are too sparse to check). */
export function earlyChecks(c: EarlyCounts): EarlyCheck[] {
  const out: EarlyCheck[] = [];
  if (pos(c.edApplicants) && pos(c.edAdmitted) && c.edAdmitted > c.edApplicants) out.push("ed_admitted_over_applicants");
  if (pos(c.edApplicants) && pos(c.totalApplicants) && c.edApplicants > c.totalApplicants) out.push("ed_applicants_over_total");
  if (pos(c.edAdmitted) && pos(c.totalAdmitted) && c.edAdmitted > c.totalAdmitted) out.push("ed_admitted_over_total_admitted");
  if (pos(c.edApplicants) && pos(c.totalApplicants) && c.edApplicants === c.totalApplicants) out.push("non_ed_pool_empty");
  return out;
}

/** The measures for one college (see EarlyMeasures). */
export function earlyMeasures(c: EarlyCounts): EarlyMeasures {
  const nonEdLabel = c.hasEarlyAction ? "non-ED" : "regular";
  const checks = earlyChecks(c);
  const blank: EarlyMeasures = { edRate: null, nonEdRate: null, nonEdLabel, advantage: null, classShare: null, checks };
  if (checks.length > 0) return blank;

  const edRate = pos(c.edApplicants) && c.edApplicants > 0 && pos(c.edAdmitted) ? c.edAdmitted / c.edApplicants : null;
  const restApplicants = pos(c.totalApplicants) && pos(c.edApplicants) ? c.totalApplicants - c.edApplicants : null;
  const restAdmitted = pos(c.totalAdmitted) && pos(c.edAdmitted) ? c.totalAdmitted - c.edAdmitted : null;
  const nonEdRate = restApplicants !== null && restApplicants > 0 && restAdmitted !== null ? restAdmitted / restApplicants : null;
  let advantage = edRate !== null && nonEdRate !== null && nonEdRate > 0 ? edRate / nonEdRate : null;
  if (advantage !== null && advantage > ADVANTAGE_REVIEW_MULTIPLE) {
    checks.push("advantage_over_review");
    advantage = null;
  }
  const classShare = pos(c.edAdmitted) && pos(c.enrolled) && c.enrolled > 0 ? Math.min(1, (c.edAdmitted * ED_YIELD_ASSUMED) / c.enrolled) : null;
  return { edRate, nonEdRate, nonEdLabel, advantage, classShare, checks };
}

const pct = (r: number) => `${r < 0.1 ? (Math.round(r * 1000) / 10).toString() : Math.round(r * 100)}%`;

/** "2.7×": one decimal under 10. */
export function multipleLabel(m: number): string {
  return `${(Math.round(m * 10) / 10).toFixed(1)}×`;
}

/**
 * The advantage line for the rounds table: "ED admitted 24% vs 9% non-ED (CDS 2025–26) · 2.7× the non-ED rate",
 * "ED offered; counts not published", or the reason the counts aren't shown. `edition` labels the document the counts
 * came from (lineage), or null. Null when the college doesn't offer ED.
 */
export function advantageLine(offered: boolean | null, m: EarlyMeasures | null, edition: string | null): string | null {
  if (!offered) return null;
  if (!m || m.edRate === null) {
    const failed = m?.checks.filter((c) => c !== "advantage_over_review") ?? [];
    return failed.length > 0 ? `ED offered; the published counts don't add up (${failed.map((c) => EARLY_CHECK_LABELS[c]).join(", ")})` : "ED offered; counts not published";
  }
  const from = edition ? ` (CDS ${edition})` : "";
  if (m.nonEdRate === null) return `ED admitted ${pct(m.edRate)}${from}`;
  const base = `ED admitted ${pct(m.edRate)} vs ${pct(m.nonEdRate)} ${m.nonEdLabel}${from}`;
  if (m.checks.includes("advantage_over_review")) return `${base} · multiple held for review`;
  return m.advantage !== null ? `${base} · ${multipleLabel(m.advantage)} the ${m.nonEdLabel} rate` : base;
}

/** "2025–26" and "2025-26" name the same edition. */
const editionKey = (e: string | null | undefined) => (e ? e.replace(/[–—]/g, "-").trim() : null);

type Counts3 = { applicants: number | null; admitted: number | null; enrolled: number | null };

/**
 * The C1 totals from the same CDS document as a college's ED counts (the ED strategy spec's "same edition's C1
 * totals"): the funnel (`admissions.*`) when its lineage names the ED counts' file, else the residency grid's totals
 * when its edition is the ED counts' edition, else null. Never another document's totals: the rates would mix classes.
 */
export function sameDocumentTotals(school: {
  admissions?: Counts3 | null;
  lineage?: Partial<Record<string, { url?: string; edition?: string } | undefined>>;
  reported?: { admissions_by_residency?: { edition: string; total: Counts3 } | null } | null;
}): Counts3 | null {
  const ed = school.lineage?.["reported.admission_profile.early_decision.applicants"];
  if (!ed) return null;
  const same = (path: string) => !!ed.url && school.lineage?.[path]?.url === ed.url;
  const a = school.admissions;
  if (a && same("admissions.applicants") && same("admissions.admitted")) {
    return { applicants: a.applicants, admitted: a.admitted, enrolled: same("admissions.enrolled") ? a.enrolled : null };
  }
  const res = school.reported?.admissions_by_residency;
  if (res && editionKey(res.edition) !== null && editionKey(res.edition) === editionKey(ed.edition)) return { ...res.total };
  return null;
}

/** "about 48% of the class (if 95% of ED admits enroll)", or null. */
export function classShareLine(m: EarlyMeasures | null): string | null {
  if (!m || m.classShare === null) return null;
  return `about ${Math.round(m.classShare * 100)}% of the class (if ${Math.round(ED_YIELD_ASSUMED * 100)}% of ED admits enroll)`;
}
