import "server-only";
/**
 * Quad's estimate: the one interface every page, the planner, the API, and the outcome snapshots call
 * (specs/chances/estimate.md "Architecture"). It builds what the method needs from the dataset (the college, its GPA
 * with the fitted models, the student's high school's offering), runs the model (lib/chances/model.ts), and falls
 * back to the open baseline (lib/chances/baseline.ts) only when the model throws, logging it. Server-only: nothing
 * here or below reaches a client bundle; the browser asks POST /api/estimate.
 *
 *   const ctx = await estimateContext(student);
 *   const results = estimateMany(student, ["243780", "139755"], ctx);
 */
import { getData } from "@/lib/data";
import { stateOfHighSchoolId } from "@/lib/high-school-core";
import { getHighSchool } from "@/lib/high-schools";
import { gpaCurve, gpaModel } from "@/lib/planner/gpa-model-server";
import type { CoreAtTopLevel } from "@/lib/student-profile";
import type { School } from "@/lib/types";
import { baselineEstimate, standingSchoolFor, type StandingSchool } from "./baseline";
import { likeYouCount } from "./like-you";
import { modelEstimateWithDetail, MODEL_VERSION } from "./model";
import { offeringFor } from "./rigor-server";
import type { AppliedEstimate } from "./snapshot";
import type { AppliedEstimator } from "./snapshot-write";
import type { CollegeHooks, EstimateInput, EstimateResult, EstimateStudent, SchoolOffering } from "./types";

export { MODEL_VERSION };
export { withCounterfactual, type Counterfactual } from "./estimate-request";

/** What an estimate reads besides the student: resolved once per request so `estimate` itself is synchronous. */
export interface EstimateContext {
  schoolById: (unitId: string) => School | null;
  /** The baseline's slice of a college (scores, GPA with the fitted models, policy, admit rate). */
  standingFor: (school: School) => StandingSchool;
  /** The overall admit rate's year for a college, from lineage (never a hard-coded year). */
  overallYearFor: (school: School) => string | null;
  /** The student's high school's offering, or null when unknown. */
  offering: SchoolOffering | null;
  linked: boolean;
  coreAtTopLevel?: CoreAtTopLevel | null;
  grade?: number | null;
  /**
   * The student's high school's state (USPS), from its record, else a public id's FIPS prefix; the estimate uses it
   * when the student entered no state (method/standing.md "Revision 3", rule 7).
   */
  schoolState?: string | null;
  /** The day the estimate is made (YYYY-MM-DD); today when absent. */
  asOf?: string | null;
}

/** The high school's state: its record's, else the FIPS prefix of a public id; null for an unknown private school. */
async function highSchoolState(id: string | null): Promise<string | null> {
  if (!id) return null;
  const hs = await getHighSchool(id).catch(() => null);
  return hs?.school.state ?? stateOfHighSchoolId(id);
}

/** Builds the context for one student (one dataset read, the fitted GPA models, the high school's offering). */
export async function estimateContext(student: Pick<EstimateStudent, "highSchoolId">, extra: { coreAtTopLevel?: CoreAtTopLevel | null; grade?: number | null; asOf?: string | null } = {}): Promise<EstimateContext> {
  const [{ getSchoolById, citeField }, model, curve, offering, schoolState] = await Promise.all([
    getData(),
    gpaModel(),
    gpaCurve(),
    student.highSchoolId ? offeringFor(student.highSchoolId).then((o) => (o.offering.source ? o.offering : null)).catch(() => null) : Promise.resolve(null),
    highSchoolState(student.highSchoolId).catch(() => null),
  ]);
  const standingCache = new Map<string, StandingSchool>();
  return {
    schoolById: getSchoolById,
    standingFor: (school) => {
      let s = standingCache.get(school.unit_id);
      if (!s) standingCache.set(school.unit_id, (s = standingSchoolFor(school, model, curve)));
      return s;
    },
    overallYearFor: (school) => citeField("admissions.acceptance_rate", school)?.year ?? null,
    offering,
    linked: student.highSchoolId !== null,
    coreAtTopLevel: extra.coreAtTopLevel ?? null,
    grade: extra.grade ?? null,
    schoolState,
    asOf: extra.asOf ?? null,
  };
}

/** A result for a college the dataset doesn't have: no group, nothing used. */
function unknownCollege(unitId: string): EstimateResult {
  return { unitId, group: null, label: null, used: [], missing: [], facts: [], notes: [], send: null, moveUp: null, closeness: null, ed: null, modelVersion: MODEL_VERSION };
}

/** The model's answer with its snapshot detail, or the baseline's (no detail) when the model throws. */
export function estimateWithDetail(input: EstimateInput, ctx: EstimateContext): AppliedEstimate {
  const school = ctx.schoolById(input.unitId);
  if (!school) return { result: unknownCollege(input.unitId), detail: null };
  let standing: StandingSchool | null = null;
  try {
    standing = ctx.standingFor(school);
    return modelEstimateWithDetail({
      student: input.student,
      school,
      standing,
      offering: ctx.offering,
      linked: ctx.linked,
      overallYear: ctx.overallYearFor(school),
      coreAtTopLevel: ctx.coreAtTopLevel ?? null,
      grade: ctx.grade ?? null,
      hooks: input.hooks ?? null,
      schoolState: ctx.schoolState ?? null,
      asOf: ctx.asOf ?? null,
    });
  } catch (err) {
    console.error(`estimate: the model failed for ${input.unitId}; serving the baseline: ${err instanceof Error ? err.message : String(err)}`);
    return { result: baselineEstimate(input.student, standing ?? ctx.standingFor(school), input.unitId), detail: null };
  }
}

/**
 * The estimate for one college and "students like you" for it (calibration.md): what happened to students with numbers
 * like theirs, a count and never a chance, or null until the data clears its thresholds. The method's details (the
 * position, the kind of rate) pick the count here and go no further.
 */
export async function estimateWithLikeYou(
  input: EstimateInput,
  ctx: EstimateContext,
): Promise<{ result: EstimateResult; likeYou: { n: number; admitted: number; seasons: [number, number]; residency: boolean } | null }> {
  const { result, detail } = estimateWithDetail(input, ctx);
  if (!detail?.position || !detail.baseRateKind) return { result, likeYou: null };
  const count = await likeYouCount({ unitId: input.unitId, position: detail.position, baseRateKind: detail.baseRateKind, state: input.student.state });
  return { result, likeYou: count ? { ...count, residency: detail.baseRateKind === "residency" } : null };
}

/** The estimate for one student at one college (the contract). */
export function estimate(input: EstimateInput, ctx: EstimateContext): EstimateResult {
  return estimateWithDetail(input, ctx).result;
}

/**
 * The estimate at several colleges, by unit id; ids the dataset doesn't have are left out. `hooks` carries each list
 * row's legacy, recruited, and logged-interest inputs by unit id (decision 5); a college without an entry has none.
 */
export function estimateMany(student: EstimateStudent, unitIds: readonly string[], ctx: EstimateContext, hooks?: Readonly<Record<string, CollegeHooks>> | null): Record<string, EstimateResult> {
  const out: Record<string, EstimateResult> = {};
  for (const unitId of new Set(unitIds)) {
    if (!ctx.schoolById(unitId)) continue;
    out[unitId] = estimate({ student, unitId, hooks: hooks?.[unitId] }, ctx);
  }
  return out;
}

/**
 * The outcome snapshot's estimator (lib/chances/snapshot-write.ts AppliedEstimator): the result the student saw
 * and the method's details, built from the saved profile's input.
 */
export const appliedEstimator: AppliedEstimator = async (input) => {
  const ctx = await estimateContext(input.student);
  return estimateWithDetail(input, ctx);
};
