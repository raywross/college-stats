/**
 * Merit aid classes (specs/product/cost-by-income.md "Merit"): whether a college gives aid to students without
 * financial need, from the strongest source it has.
 *
 * 1. The college's Common Data Set, H2A (students with no need who got non-need aid, line n, and its average, o):
 *    n = 0 is need-only; n > 0 is merit_reported, share n ÷ first-years (line a). The first-year column of the
 *    college's own record (`reported.aid.first_years`) first, else the hand-imported full-time figures (`aid.cds`).
 * 2. The college's published policy says no merit (data/aid-policies.json `need_only`): need-only.
 * 3. The IPEDS proxy: first-years with a grant but no federal aid (grant recipients − the federal-aid recipients who
 *    got grants, the "Grants, no federal aid" row of AidBreakdown) ÷ the aid cohort. At least MERIT_PROXY_MIN is
 *    merit_proxy, averaging (grant dollars − federal-aid recipients' grant dollars) ÷ those students; under it,
 *    need-only. Not used where it misleads (`proxyMisleads`): at full-need colleges (policy meets_full_need, unless
 *    it says need_only false) and colleges with their own need formula (derived.aid_methodology institutional), many
 *    aided families file no FAFSA, so their need-based grants read as "no federal aid". Those are unknown.
 * 4. Otherwise unknown.
 * Pure: safe in server and client code and in tests.
 */
import type { School } from "./types";
import type { AidPolicy } from "./aid-policies";
import { aidPolicyFor } from "./aid-policies.ts";
import { aidMethodology, h2Shares } from "./cds/financial-aid.ts";

export type MeritClass = "need_only" | "merit_reported" | "merit_proxy" | "unknown";
export interface MeritInfo {
  cls: MeritClass;
  /** 0–1: share of first-years (CDS: without need who got merit; IPEDS: with a grant but no federal aid). */
  share: number | null;
  /** Average award, dollars a year. */
  avg: number | null;
  source: "cds" | "ipeds" | "policy" | null;
}

/** The IPEDS proxy's threshold: grants without federal aid to at least this share of first-years. */
export const MERIT_PROXY_MIN = 0.02;

const sum = (xs: (number | null)[] | undefined): number | null => (xs ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

/** The IPEDS proxy alone: share of first-years with a grant but no federal aid, and their average grant. Null without the inputs. */
export function meritProxy(school: Pick<School, "aid">): { share: number; avg: number | null } | null {
  const aid = school.aid;
  const cohort = aid?.cohort ?? null;
  const grantCount = aid?.grant_count ?? null;
  const fedGranted = sum(aid?.by_income?.granted);
  if (!cohort || cohort <= 0 || grantCount === null || fedGranted === null) return null;
  const others = grantCount - fedGranted;
  if (others < 0) return null;
  const fedDollars = sum(aid?.by_income?.total_grants);
  const avg = others > 0 && aid?.grant_total != null && fedDollars !== null ? (aid.grant_total - fedDollars) / others : null;
  return { share: others / cohort, avg: avg !== null && avg > 0 ? avg : null };
}

/**
 * True where "grants without federal aid" is mostly need-based aid: at a college that says it meets full need (and
 * doesn't say it gives merit), or that figures need with its own formula (CSS Profile or its own form), many aided
 * families never file the FAFSA, so their need-based grants count as "no federal aid".
 */
export function proxyMisleads(school: Pick<School, "reported">, policy: AidPolicy | null): boolean {
  if (policy?.meets_full_need === true && policy.need_only !== false) return true;
  return aidMethodology(school.reported?.aid)?.value === "institutional";
}

/** The college's merit class (policy looked up when not passed; null for none). */
export function meritFor(school: School, policy?: AidPolicy | null): MeritInfo {
  const pol = policy === undefined ? aidPolicyFor(school.unit_id) : policy;

  const fy = school.reported?.aid?.first_years;
  if (fy && fy.n !== null) {
    if (fy.n === 0) return { cls: "need_only", share: 0, avg: null, source: "cds" };
    return { cls: "merit_reported", share: h2Shares({ a: fy.a, c: null, d: null, h: null, n: fy.n }).meritNoNeed, avg: fy.o, source: "cds" };
  }
  const cds = school.aid?.cds;
  if (cds && cds.merit_no_need !== null) {
    if (cds.merit_no_need === 0) return { cls: "need_only", share: 0, avg: null, source: "cds" };
    return { cls: "merit_reported", share: cds.undergrads ? cds.merit_no_need / cds.undergrads : null, avg: cds.merit_avg, source: "cds" };
  }

  if (pol?.need_only === true) return { cls: "need_only", share: null, avg: null, source: "policy" };
  if (proxyMisleads(school, pol)) return { cls: "unknown", share: null, avg: null, source: null };

  const proxy = meritProxy(school);
  if (proxy) {
    return proxy.share >= MERIT_PROXY_MIN
      ? { cls: "merit_proxy", share: proxy.share, avg: proxy.avg, source: "ipeds" }
      : { cls: "need_only", share: proxy.share, avg: null, source: "ipeds" };
  }
  return { cls: "unknown", share: null, avg: null, source: null };
}

/** Explore's "Offers merit aid": reported or proxy. */
export const offersMerit = (m: MeritInfo): boolean => m.cls === "merit_reported" || m.cls === "merit_proxy";
