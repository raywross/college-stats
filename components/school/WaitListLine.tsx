import { getData } from "@/lib/data";
import { admissionProfile, waitListRate } from "@/lib/cds/admissions";
import { num, pctSmart } from "@/lib/format";
import type { School } from "@/lib/types";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * The wait-list line under the funnel (specs/data-expansion/cds-admissions.md, Display 1): all counts, admitted only,
 * policy only, or "No wait list", from the college's CDS C2. Nothing when C2 isn't published.
 */
export async function WaitListLine({ school }: { school: School }) {
  const w = admissionProfile(school)?.wait_list;
  if (!w) return null;
  const { citeField } = await getData();
  const rate = waitListRate(w);
  let text: string;
  let cited = citeField("reported.admission_profile.wait_list.policy", school);
  if (w.offered !== null && w.accepted !== null && w.admitted !== null) {
    text = `Wait list: ${num(w.offered)} offered a place, ${num(w.accepted)} accepted, ${num(w.admitted)} admitted${rate !== null ? ` (${rate > 0 && rate < 0.001 ? "under 0.1%" : pctSmart(rate)} of those who accepted)` : ""}`;
    cited = citeField("reported.admission_profile.wait_list.admitted", school);
  } else if (w.admitted !== null) {
    text = `${num(w.admitted)} admitted from the wait list`;
    cited = citeField("reported.admission_profile.wait_list.admitted", school);
  } else if (w.accepted !== null) {
    text = `Wait list: ${num(w.accepted)} accepted a place; admissions from it not published`;
    cited = citeField("reported.admission_profile.wait_list.accepted", school);
  } else if (w.policy === true) {
    text = "Uses a wait list; numbers not published";
  } else if (w.policy === false) {
    text = "No wait list";
  } else return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      <MetricLabel term="wait-list" cited={cited}>
        {text}
      </MetricLabel>
    </p>
  );
}
