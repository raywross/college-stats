import "server-only";
/**
 * The app's dependencies for the applied-transition snapshot (lib/chances/snapshot-write.ts): the dataset's admit
 * rate, the high school's offering from the high school data, and the estimate. Server only.
 *
 * The estimate defaults to Quad's estimate (lib/chances/estimate.ts `appliedEstimator`: the result the student saw and
 * the method's details); pass `null` to record only the binned inputs, leaving the estimate's columns empty.
 */
import { getData } from "@/lib/data";
import { appliedEstimator } from "@/lib/chances/estimate";
import { getHighSchool } from "@/lib/high-schools";
import { schoolOffering } from "@/lib/chances/offering";
import type { AppliedEstimator, SnapshotDeps } from "@/lib/chances/snapshot-write";

export function snapshotDeps(supabase: SnapshotDeps["supabase"], estimate: AppliedEstimator | null = appliedEstimator): SnapshotDeps {
  return {
    supabase,
    estimate,
    offeringFor: async (highSchoolId) => {
      const view = await getHighSchool(highSchoolId);
      return view ? schoolOffering({ school: view.school, detail: view.detail }) : null;
    },
    admitRateFor: async (unitId) => {
      const { getSchoolById } = await getData();
      return getSchoolById(unitId)?.admissions.acceptance_rate ?? null;
    },
  };
}
