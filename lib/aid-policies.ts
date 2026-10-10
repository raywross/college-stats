/**
 * Colleges' published aid promises and rules (specs/product/cost-by-income.md "Published promises"): income lines
 * ("families under $200K pay no tuition"), full-need and no-loan policies, need-only (no merit), and how home equity
 * and siblings are treated. Hand-curated in data/aid-policies.json from each college's own page, checked by
 * scripts/check-aid-policies.mts in `npm run verify`, cited as college-published values (lib/fields.ts `aid_policy.*`;
 * lib/lineage.ts resolves the citation to the entry's `source`, `as_of`, and `checked`).
 * Pure: safe in server and client code and in tests.
 */
import file from "../data/aid-policies.json" with { type: "json" };

export type HomeEquityRule = "ignored" | { cap_multiple: number } | "full";
export type SiblingRule = "split" | "reduce" | "none";

export interface AidPolicy {
  unit_id: string;
  /** The award year the policy is stated for, e.g. "2025-26". */
  as_of: string;
  /** Families below this income (typical assets) pay no tuition. */
  free_tuition_under: number | null;
  /** Families below this income pay nothing toward the cost of attendance. */
  no_contribution_under: number | null;
  meets_full_need: boolean | null;
  no_loans: boolean | null;
  /** No merit aid: every grant is need-based. */
  need_only: boolean | null;
  home_equity: HomeEquityRule | null;
  siblings: SiblingRule | null;
  /** The college's own wording or rule, short ("Parent contribution × 60% per sibling"). */
  siblings_note: string | null;
  /**
   * Who the income lines apply to: "all" (the default when absent) or "in_state" (a public's promise to its own
   * state's residents, such as the Go Blue Guarantee). The curve applies an "in_state" line to the in-state price only.
   */
  applies_to?: "all" | "in_state";
  /** The college's own page the entry was checked against. */
  source: string;
  /** ISO date the entry was last checked. */
  checked: string;
  /** "page": read on the college's page; "search": quoted from the college's page in a web search result, not yet opened. */
  verified_via: "page" | "search";
}

export interface AidPolicyFile {
  description?: string;
  policies: AidPolicy[];
}

const byId = new Map((file as AidPolicyFile).policies.map((p) => [p.unit_id, p]));

/** The college's published policy, or null when none is curated. */
export function aidPolicyFor(unitId: string): AidPolicy | null {
  return byId.get(unitId) ?? null;
}

/** Every curated policy (the check script and tests). */
export function allAidPolicies(): AidPolicy[] {
  return (file as AidPolicyFile).policies;
}

/** An award year as shown: with the en dash the rest of the site uses (a hyphenated "YYYY-YY" becomes "YYYY–YY"). */
export function aidYearLabel(asOf: string): string {
  return asOf.replace("-", "–");
}

/* ------------------------------------------------------------------ */
/* Validation (scripts/check-aid-policies.mts, `npm run verify`)       */
/* ------------------------------------------------------------------ */

const AID_YEAR_RE = /^(\d{4})-(\d{2})$/;
const VERIFIED_VIA: readonly string[] = ["page", "search"];
const HOME_EQUITY_WORDS: readonly string[] = ["ignored", "full"];
const SIBLING_RULES: readonly string[] = ["split", "reduce", "none"];
const APPLIES_TO: readonly string[] = ["all", "in_state"];
const BOOLEAN_FIELDS = ["meets_full_need", "no_loans", "need_only"] as const;
/** Every key an entry must carry; null says "the college didn't state it", so a missing key is a mistake. */
const REQUIRED_KEYS = [
  "unit_id",
  "as_of",
  "free_tuition_under",
  "no_contribution_under",
  "meets_full_need",
  "no_loans",
  "need_only",
  "home_equity",
  "siblings",
  "siblings_note",
  "source",
  "checked",
  "verified_via",
] as const;

const isPositiveInteger = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** A real calendar date written YYYY-MM-DD. */
function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Problems with the aid-policies file, one line each (empty means sound). Every entry: a known, unique unit_id; an
 * https source and a real ISO `checked` date; `as_of` an award year like "2025-26" (consecutive years); income
 * thresholds positive whole dollars, with no_contribution_under no higher than free_tuition_under when both are set;
 * flags true, false, or null; home_equity "ignored", "full", `{ cap_multiple }` from 0.5 to 10, or null; siblings
 * "split", "reduce", "none", or null; verified_via "page" or "search". `knownUnitIds` is the dataset's college ids
 * (omit to skip that check).
 */
export function validateAidPolicies(input: AidPolicyFile, knownUnitIds?: Set<string>): string[] {
  if (!input || !Array.isArray(input.policies)) return ['aid-policies: "policies" must be an array'];
  const errors: string[] = [];
  const seen = new Set<string>();
  input.policies.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      errors.push(`aid-policies[${i}]: not an object`);
      return;
    }
    const where = `aid-policies[${i}] ${typeof p.unit_id === "string" ? p.unit_id : "(no unit_id)"}`;
    const rec = p as unknown as Record<string, unknown>;
    for (const k of REQUIRED_KEYS) if (!(k in rec)) errors.push(`${where}: missing "${k}" (use null for what the college didn't state)`);
    if (typeof p.unit_id !== "string" || !/^\d+$/.test(p.unit_id)) errors.push(`${where}: unit_id must be a numeric string`);
    else {
      if (seen.has(p.unit_id)) errors.push(`${where}: duplicate unit_id`);
      seen.add(p.unit_id);
      if (knownUnitIds && !knownUnitIds.has(p.unit_id)) errors.push(`${where}: unit_id isn't a college in the dataset`);
    }
    const year = typeof p.as_of === "string" ? AID_YEAR_RE.exec(p.as_of) : null;
    if (!year || (Number(year[1]) + 1) % 100 !== Number(year[2])) errors.push(`${where}: as_of must be an award year of consecutive years, "YYYY-YY", got ${JSON.stringify(p.as_of)}`);
    if (!isHttpsUrl(p.source)) errors.push(`${where}: source must be an https URL (the college's own page)`);
    if (!isIsoDate(p.checked)) errors.push(`${where}: checked must be a real ISO date (YYYY-MM-DD), got ${JSON.stringify(p.checked)}`);
    if (!VERIFIED_VIA.includes(p.verified_via)) errors.push(`${where}: verified_via must be "page" or "search"`);
    for (const k of ["free_tuition_under", "no_contribution_under"] as const) {
      if (p[k] !== null && !isPositiveInteger(p[k])) errors.push(`${where}: ${k} must be a positive whole number of dollars or null, got ${JSON.stringify(p[k])}`);
    }
    if (isPositiveInteger(p.free_tuition_under) && isPositiveInteger(p.no_contribution_under) && p.no_contribution_under > p.free_tuition_under) {
      errors.push(`${where}: no_contribution_under (${p.no_contribution_under}) is above free_tuition_under (${p.free_tuition_under})`);
    }
    for (const k of BOOLEAN_FIELDS) {
      if (p[k] !== null && typeof p[k] !== "boolean") errors.push(`${where}: ${k} must be true, false, or null`);
    }
    const he: unknown = p.home_equity;
    if (he !== null && he !== undefined) {
      if (typeof he === "string") {
        if (!HOME_EQUITY_WORDS.includes(he)) errors.push(`${where}: home_equity "${he}" isn't "ignored", "full", or { cap_multiple }`);
      } else if (typeof he === "object" && "cap_multiple" in he) {
        const m = (he as { cap_multiple: unknown }).cap_multiple;
        if (typeof m !== "number" || !(m >= 0.5 && m <= 10)) errors.push(`${where}: home_equity cap_multiple must be a number from 0.5 to 10, got ${JSON.stringify(m)}`);
      } else errors.push(`${where}: home_equity must be "ignored", "full", { cap_multiple }, or null`);
    }
    if (p.siblings !== null && !SIBLING_RULES.includes(p.siblings)) errors.push(`${where}: siblings must be "split", "reduce", "none", or null`);
    if (p.siblings_note !== null && (typeof p.siblings_note !== "string" || !p.siblings_note.trim())) errors.push(`${where}: siblings_note must be a non-empty string or null`);
    else if (p.siblings_note !== null && p.siblings === null) errors.push(`${where}: siblings_note without a siblings rule`);
    if (p.applies_to !== undefined && !APPLIES_TO.includes(p.applies_to)) errors.push(`${where}: applies_to must be "all" or "in_state"`);
  });
  return errors;
}
