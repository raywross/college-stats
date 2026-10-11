import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import { FEDERAL_TOP } from "@/lib/cost-curve";
import { dollarsK } from "@/lib/cost-at-income";
import { MetricLabel, InfoTip } from "@/components/ui/info-tip";
import { NetPriceAtIncome, type IncomeEntry } from "./NetPriceAtIncome";

/**
 * "What would a family like mine pay?" (specs/product/cost-by-income.md "Compare"): an income slider and each
 * college's price at that income, solid where the federal data publish it and hatched where it is our estimate. The
 * colleges' curves are worked out here, on the server (the dataset memoizes them); `showEstimates` is the accuracy
 * pilot's gate (`estimatesShown()`), passed down because the browser can't read the deployment's environment.
 */
export async function NetPriceCompare({ schools, year, showEstimates }: { schools: School[]; year?: string | null; showEstimates: boolean }) {
  const data = await getData();
  const entries: IncomeEntry[] = schools.map((s, i) => ({
    id: s.unit_id,
    name: shortName(s),
    slot: i,
    curve: data.costCurveFor(s),
    merit: data.meritInfoFor(s),
    over110: s.cost?.net_price_by_income?.[4] ?? null,
  }));
  if (!entries.some((e) => e.curve || e.over110 !== null)) {
    return (
      <div className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">
        None of these colleges report net price by family income.
      </div>
    );
  }
  const { citeField } = data;

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <MetricLabel term="cost-curve" cited={citeField("derived.cost_estimate")} className="mb-1 font-display text-base font-bold">
        What families at each income pay
      </MetricLabel>
      <p className="mb-4 text-xs text-muted-foreground">
        Up to {dollarsK(FEDERAL_TOP)}: the average net price per year for students receiving federal aid{year ? `, ${year}` : ""}; families who
        didn&apos;t file the FAFSA aren&apos;t included.{" "}
        {showEstimates ? (
          <>
            Above it: our estimate for a typical family (two parents, two children, one in college), fitted to each college&apos;s published
            average over {dollarsK(FEDERAL_TOP)}.
          </>
        ) : (
          <>Above it the published data end.</>
        )}{" "}
        For your own number, use the college&apos;s net price calculator <InfoTip term="net-price-calculator" />.
      </p>
      <NetPriceAtIncome entries={entries} showEstimates={showEstimates} />
    </div>
  );
}
