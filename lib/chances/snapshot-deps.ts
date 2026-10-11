import "server-only";
/**
 * The app's dependencies for the applied-transition snapshot (lib/chances/snapshot-write.ts): the dataset's admit
 * rate, the high school's offering from the high school data, and the estimate. Server only.
 *
 * The estimate is the seam the estimate unit wires: pass its `AppliedEstimator` (lib/chances/estimate.ts wrapped to
 * return `{ result, detail }`) as `estimate`. Without one, snapshots record the binned inputs and leave the estimate's
 * columns empty.
 */
import { getData } from "@/lib/data";
import { getHighSchool } from "@/lib/high-schools";
import { schoolOffering } from "@/lib/chances/offering";
import type { AppliedEstimator, SnapshotDeps } from "@/lib/chances/snapshot-write";

export function snapshotDeps(supabase: SnapshotDeps["supabase"], estimate: AppliedEstimator | null = null): SnapshotDeps {
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
