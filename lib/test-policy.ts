/**
 * Test policy (CDS C8 and IPEDS ADMCON7): the five answers, how a CDS grid is read into them, the headline rule, the
 * change ("event") rules, the Explore buckets, and the words the profile uses. specs/data-expansion/
 * cds-test-scores-and-policy.md (Checks "Headline", Decision 1, Keep history?, Display, Explore).
 *
 * Pure module: type-only imports, safe for client components and Node tests.
 */
import type { School, TestPolicy, TestPolicyAnswer, TestPolicyEvent } from "./types";

/** The five answers in the CDS grid's column order. */
export const POLICY_ORDER: readonly TestPolicyAnswer[] = ["required", "required-some", "recommended", "considered", "not-considered"];

/**
 * A 2025–26 template workbook's C8 code-table text → the answer, by normalized prefix. Order matters: "Not required
 * for admission, but considered" must win over "required", and "Not considered" over "considered".
 */
const C8_TEXT: readonly [RegExp, TestPolicyAnswer][] = [
  [/^not required for admission,? but considered/, "considered"],
  [/^not considered/, "not-considered"],
  [/^required to be considered/, "required"],
  [/^required for some/, "required-some"],
  [/^recommended/, "recommended"],
  [/^considered if submitted/, "considered"],
];

/** C8 grid text ("Required to be considered for admission") → the answer; null for blanks and anything unknown. */
export function policyFromText(text: string | null | undefined): TestPolicyAnswer | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  for (const [re, answer] of C8_TEXT) if (re.test(t)) return answer;
  return null;
}

/**
 * A fillable CDS PDF's radio export values (Howard), **trimmed** first ("ADMS_CONSIDER " has a trailing space). Map by
 * export value, never by widget index: the widgets are listed REQ, REC, RFS, … not in column order.
 */
export const C8_EXPORT: Readonly<Record<string, TestPolicyAnswer>> = {
  ADMS_REQ: "required",
  ADMS_RFS: "required-some",
  ADMS_REC: "recommended",
  ADMS_CONSIDER: "considered",
  ADMS_NOT_USED: "not-considered",
};

export function policyFromExport(value: string | null | undefined): TestPolicyAnswer | null {
  return C8_EXPORT[(value ?? "").trim()] ?? null;
}

/**
 * The headline (Checks, "Headline"): the "SAT or ACT" row; else ACT Only and SAT Only when they agree; else null
 * ("varies by test", shown per test). C8A "No" with no row marked means not considered.
 */
export function headlinePolicy(g: { uses_tests: boolean | null; sat_or_act: TestPolicyAnswer | null; act_only: TestPolicyAnswer | null; sat_only: TestPolicyAnswer | null }): TestPolicyAnswer | null {
  if (g.sat_or_act) return g.sat_or_act;
  if (g.act_only && g.sat_only) return g.act_only === g.sat_only ? g.act_only : null;
  if (g.act_only || g.sat_only) return null;
  return g.uses_tests === false ? "not-considered" : null;
}

/* ------------------------------------------------------------------ */
/* Events (Keep history?)                                              */
/* ------------------------------------------------------------------ */

/** Federal → CDS compares on three tiers, so a move between recommended/required-some and considered isn't a decision. */
function tier(p: TestPolicyAnswer): 0 | 1 | 2 {
  return p === "required" ? 2 : p === "not-considered" ? 0 : 1;
}

/** A CDS edition's policy: the cycle it's for and its headline. */
export interface CyclePolicy {
  cycle: number;
  policy: TestPolicyAnswer;
}

/** A change undone within this many editions (A → B → A) is a reporting slip; both changes are dropped. */
export const POLICY_REVERSAL_EDITIONS = 2;

/**
 * Policy events from a college's CDS editions (any order) plus its federal value: edition → next edition, any change on
 * the five-answer scale except one undone within two editions; federal → the first CDS edition (only when no earlier
 * CDS edition was read), required ↔ not required and considered ↔ not considered (tiers). Oldest first.
 */
export function testPolicyEvents(editions: readonly CyclePolicy[], federal: { policy: TestPolicy; year: number | null } | null): TestPolicyEvent[] {
  const eds = [...editions].sort((a, b) => a.cycle - b.cycle);
  const out: TestPolicyEvent[] = [];
  const first = eds[0];
  if (first && federal?.policy && federal.year !== null && federal.year < first.cycle && tier(federal.policy) !== tier(first.policy)) {
    out.push({ cycle: first.cycle, from: federal.policy, to: first.policy, from_source: "ipeds-adm", from_year: federal.year });
  }
  const slip = new Set<number>();
  for (let i = 1; i < eds.length; i++) {
    if (eds[i].policy === eds[i - 1].policy) continue;
    // Undone within two editions: drop this change and its reversal.
    for (let j = i + 1; j < i + POLICY_REVERSAL_EDITIONS && j < eds.length; j++) {
      if (eds[j].policy === eds[i - 1].policy) {
        slip.add(i);
        slip.add(j);
        break;
      }
    }
  }
  for (let i = 1; i < eds.length; i++) {
    if (eds[i].policy === eds[i - 1].policy || slip.has(i)) continue;
    out.push({ cycle: eds[i].cycle, from: eds[i - 1].policy, to: eds[i].policy, from_source: "cds", from_year: eds[i - 1].cycle });
  }
  return out.sort((a, b) => a.cycle - b.cycle);
}

/** "Requires the SAT or ACT again, for students entering in fall 2027". */
export function policyEventText(e: TestPolicyEvent): string {
  const when = `for students entering in fall ${e.cycle}`;
  if (e.to === "required") return `${e.from === "not-considered" ? "Began requiring the SAT or ACT" : "Requires the SAT or ACT again"}, ${when}`;
  if (e.to === "not-considered") return `Became test-blind, ${when}`;
  if (e.to === "required-some") return `Requires the SAT or ACT of some applicants, ${when}`;
  if (e.to === "recommended") return `Recommends the SAT or ACT, ${when}`;
  return `${e.from === "required" ? "Stopped requiring the SAT or ACT" : "Became test-optional"}, ${when}`;
}

/** True when an event moved required ↔ not required (the scores' class then predates the change). */
export function changesRequirement(e: TestPolicyEvent): boolean {
  return (e.from === "required") !== (e.to === "required");
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** Labels used across the site (TEST_POLICY_LABELS in lib/metrics.ts re-exports these). */
export const POLICY_LABELS: Record<TestPolicyAnswer, string> = {
  required: "Test scores required",
  "required-some": "Required for some applicants",
  recommended: "Test scores recommended",
  considered: "Test-optional",
  "not-considered": "Test-blind",
};

/** The admissions page's Test policy block: headline and sentence per answer. */
export const POLICY_HEADLINES: Record<TestPolicyAnswer, { headline: string; sentence: string }> = {
  required: { headline: "Required", sentence: "Send SAT or ACT scores: they're required to be considered." },
  "required-some": { headline: "Required for some applicants", sentence: "Some applicants must send scores." },
  recommended: { headline: "Recommended", sentence: "Scores are recommended, not required." },
  considered: { headline: "Optional", sentence: "Scores are considered if you send them." },
  "not-considered": { headline: "Not considered", sentence: "Scores aren't considered, even if you send them." },
};

/** Short per-test words for "varies by test": "SAT: required · ACT: optional". */
const SHORT: Record<TestPolicyAnswer, string> = {
  required: "required",
  "required-some": "required for some",
  recommended: "recommended",
  considered: "optional",
  "not-considered": "not considered",
};

export function variesText(p: { sat_only: TestPolicyAnswer | null; act_only: TestPolicyAnswer | null }): string {
  return [p.sat_only && `SAT: ${SHORT[p.sat_only]}`, p.act_only && `ACT: ${SHORT[p.act_only]}`].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ */
/* Explore (policy=required,optional,blind)                            */
/* ------------------------------------------------------------------ */

export type PolicyBucket = "required" | "optional" | "blind";

export const POLICY_BUCKETS: readonly { key: PolicyBucket; label: string }[] = [
  { key: "required", label: "Required" },
  { key: "optional", label: "Optional" },
  { key: "blind", label: "Test-blind" },
];

export function isPolicyBucket(v: string): v is PolicyBucket {
  return v === "required" || v === "optional" || v === "blind";
}

/** The Explore chip a policy falls in; "required for some" counts as Optional (open question 3). Null = no policy. */
export function policyBucket(p: TestPolicy | undefined): PolicyBucket | null {
  if (!p) return null;
  if (p === "required") return "required";
  if (p === "not-considered") return "blind";
  return "optional";
}

/** Keeps colleges whose newest policy is in one of the buckets; colleges with no policy are excluded. */
export function matchesPolicy(s: Pick<School, "admissions">, buckets: readonly PolicyBucket[]): boolean {
  const b = policyBucket(s.admissions.test_policy);
  return b !== null && buckets.includes(b);
}
