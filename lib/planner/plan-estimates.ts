import "server-only";
/**
 * Quad's estimate for every college on a plan (specs/chances/estimate.md "In the planner"), computed on the server for
 * the plan loader (lib/planner/load.ts) and the suggestion sync (store-plan.ts syncAuto), then handed to `planView`.
 * A guardian's copy reads the course list without AP exam scores while the student keeps them private, so no sentence
 * can reveal one. Never throws: an estimate that can't be computed leaves the rows on their stored groups.
 */
import { estimateContext, estimateMany } from "@/lib/chances/estimate";
import { gradeNow, withoutExams } from "@/lib/chances/courses";
import { estimateInputFromProfile } from "@/lib/chances/snapshot";
import { citedPaths, isEstimateFactPath } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import { getData } from "@/lib/data";
import type { FieldPath } from "@/lib/fields";
import type { StudentProfileData } from "@/lib/student-profile";
import type { PlanSchool } from "./types";

export async function planEstimates(
  profile: StudentProfileData | null,
  unitIds: readonly string[],
  opts: { gradYear: number | null; today: string; hideExams?: boolean },
): Promise<Record<string, EstimateResult>> {
  if (unitIds.length === 0) return {};
  try {
    const student = estimateInputFromProfile(profile, "", null).student;
    const courses = opts.hideExams ? withoutExams(student.courses) : student.courses;
    const input = { ...student, courses };
    const ctx = await estimateContext(input, { coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(opts.gradYear, opts.today) });
    return estimateMany(input, unitIds, ctx);
  } catch (err) {
    console.error(`planner: estimates failed: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * The plan's colleges with the citations their estimates name added to `cites`, so the row drawer's "What went into
 * this estimate" can show a source beside each fact (the plan page resolves them here because the browser has no
 * dataset). Only the fields an estimate cites, only where the estimate cites them; a college without an estimate is
 * unchanged.
 */
export async function withFactCites(schools: Record<string, PlanSchool>, estimates: Record<string, EstimateResult>): Promise<Record<string, PlanSchool>> {
  const { getSchoolById, citeField } = await getData();
  const out = { ...schools };
  for (const [id, est] of Object.entries(estimates)) {
    const planSchool = schools[id];
    const school = getSchoolById(id);
    if (!planSchool || !school) continue;
    const cites = { ...planSchool.cites };
    for (const path of citedPaths(est)) if (isEstimateFactPath(path) && !(path in cites)) cites[path] = citeField(path as FieldPath, school);
    out[id] = { ...planSchool, cites };
  }
  return out;
}
