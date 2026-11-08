/**
 * The college page's Selectivity panel in words (specs/product/admin-redesign.md "Data": "the Selectivity panel leads
 * with the tier and the one-line reason in words"): "Ultra selective: admit rate 4%, SAT 75th percentile 1570, yield
 * 83%." The scoring table and the formula stay on the page, under Details; this is the line above them.
 *
 * Pure: it reads the panel lib/admin/hidden.ts builds (by type only), so the page and the tests share it.
 */
import type { SelectivityInputRow, SelectivityPanel, SelectivityPoolView } from "./hidden.ts";
import { SELECTIVITY_TIER_LABELS } from "../chances/levels.ts";
import type { SelectivityTier } from "../chances/types.ts";

/** How many reported inputs the reason names: the ones that weigh most in this college's score. */
export const REASON_INPUTS = 3;

/** An evidence factor under this reads as "pulled toward the middle" (a small admitted class). */
export const THIN_EVIDENCE = 0.9;

const tierWord = (tier: SelectivityTier) => SELECTIVITY_TIER_LABELS[tier];

/** The tier a pool sits in: the stored one when the build stored one, else what the plain cutoffs give. */
export function poolTier(pool: Pick<SelectivityPoolView, "publishedTier" | "plainTier">): SelectivityTier {
  return pool.publishedTier ?? pool.plainTier;
}

/** One input in words: "admit rate 4%", "SAT 75th percentile 1570". The label is lowercased except an acronym. */
export function inputWords(row: Pick<SelectivityInputRow, "label" | "display">): string {
  const label = /^[A-Z]{2,}/.test(row.label) ? row.label : row.label.charAt(0).toLowerCase() + row.label.slice(1);
  return `${label} ${row.display}`;
}

/**
 * The reported inputs the reason names: the admit rate always (every reader looks for it first, and a college without
 * one isn't rated), then the other reported inputs that weigh most in the score (by the size of their contribution),
 * `count` in all, in the method's order so the sentence reads the same way for every college. Filled inputs (read as
 * the middle, or the SAT from the fit) are left out: the reason names what the college reports.
 */
export function reasonInputs(pool: Pick<SelectivityPoolView, "rows">, count: number = REASON_INPUTS): SelectivityInputRow[] {
  const reported = pool.rows.filter((r) => r.present);
  const rate = reported.filter((r) => r.input === "admit_rate");
  const others = reported.filter((r) => r.input !== "admit_rate").sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = new Set([...rate, ...others].slice(0, count));
  return reported.filter((r) => top.has(r));
}

/**
 * The tier and its reason in one sentence, for the top of the college page's Selectivity panel:
 * - rated: "Ultra selective: admit rate 4%, SAT 75th percentile 1570, yield 83%." with, when they apply, a clause for
 *   a tier the band kept ("kept from the last publish; the score alone reads Highly selective"), a small admitted class
 *   ("pulled toward the middle by a small admitted class"), and a pool in another tier ("in-state applicants: Highly
 *   selective");
 * - not rated: the reason in words.
 */
export function tierSentence(panel: Pick<SelectivityPanel, "status" | "pools">): string {
  if (panel.status === "inconsistent") return "Not rated: the college reports more first-years enrolled than undergraduates in all, so its figures can't describe one class.";
  const all = panel.pools[0];
  if (panel.status === "no_admit_rate" || !all) return "Not rated: the college publishes no admit rate.";

  const tier = poolTier(all);
  const reasons = reasonInputs(all).map(inputWords);
  const clauses: string[] = [];
  if (all.publishedTier && all.publishedTier !== all.plainTier) clauses.push(`kept from the last publish; the score alone reads ${tierWord(all.plainTier)}`);
  if (all.evidence.factor < THIN_EVIDENCE) clauses.push("pulled toward the middle by a small admitted class");
  for (const other of panel.pools.slice(1)) {
    const t = poolTier(other);
    if (t !== tier) clauses.push(`${other.label.charAt(0).toLowerCase()}${other.label.slice(1)}: ${tierWord(t)}`);
  }
  const head = reasons.length ? `${tierWord(tier)}: ${reasons.join(", ")}` : `${tierWord(tier)}, from the middle of every input (the college reports none of them)`;
  return `${[head, ...clauses].join("; ")}.`;
}
