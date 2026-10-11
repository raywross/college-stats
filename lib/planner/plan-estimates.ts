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
import type { EstimateResult } from "@/lib/chances/types";
import type { StudentProfileData } from "@/lib/student-profile";

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
