import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { aidPolicyFor, aidYearLabel } from "@/lib/aid-policies";
import { aidMethodology } from "@/lib/cds/financial-aid";
import { meritCitedField } from "@/lib/cost-display";
import type { AnyCited } from "@/lib/lineage";
import { CostAtIncome } from "./CostAtIncome";

/**
 * The cost curve with its slider and notes, with every citation looked up on the server (the client components get
 * plain data). Null when the college has no full price to draw a curve from.
 */
export async function CostByIncome({ school, showEstimates }: { school: School; showEstimates: boolean }) {
  const data = await getData();
  const curve = data.costCurveFor(school);
  if (!curve) return null;
  const merit = data.meritInfoFor(school);
  const policy = aidPolicyFor(school.unit_id);
  const cite = (path: Parameters<typeof data.citeField>[0]): AnyCited => data.citeField(path, school);
  const promise = curve.promises[0];
  const methodology = aidMethodology(school.reported?.aid)?.value ?? null;
  return (
    <CostAtIncome
      curve={curve}
      merit={merit}
      showEstimates={showEstimates}
      promiseYear={policy ? aidYearLabel(policy.as_of) : null}
      name={school.name}
      policy={policy}
      methodology={methodology}
      citations={{
        published: cite("cost.net_price_by_income"),
        estimate: cite("derived.cost_estimate"),
        breakPoint: cite("derived.need_aid_break_income"),
        merit: merit.cls === "unknown" ? undefined : cite(meritCitedField(merit)),
        promise: promise ? cite(promise.kind === "free_tuition" ? "aid_policy.free_tuition_under" : "aid_policy.no_contribution_under") : undefined,
      }}
      noteCited={{
        "aid_policy.home_equity": policy?.home_equity != null ? cite("aid_policy.home_equity") : undefined,
        "aid_policy.siblings": policy?.siblings ? cite("aid_policy.siblings") : undefined,
        "derived.aid_methodology": methodology ? cite("derived.aid_methodology") : undefined,
      }}
    />
  );
}
