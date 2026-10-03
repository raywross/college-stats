import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { change, columnTotal, federalMatchingTotal, fullEstimate, showsPayingMore, undergraduateDiffers } from "@/lib/cds/cost-and-debt";
import { MetricLabel, SourceTip } from "@/components/ui/info-tip";

/** "up 9%" / "down 2%" / "unchanged". */
function changePhrase(c: number): string {
  const p = pct(Math.abs(c));
  return p === "0%" ? "unchanged" : `${c > 0 ? "up" : "down"} ${p}`;
}

/**
 * Next year's price (specs/data-expansion/cds-cost-and-debt.md): the college's own G1 figures for the coming year,
 * shown beside the federal price on the cost page, never replacing it, with the change from the federal year; the
 * continuing-student disclosure, the full next-year estimate, and the differential-tuition footnote (G.402). Quiet
 * style: no chip; the source, edition, and quote are in the ⓘ. Renders nothing without either part.
 */
export async function NextYearPrice({ school }: { school: School }) {
  const { citeField } = await getData();
  const ny = school.reported?.cost?.next_year;
  const detail = school.reported?.cost?.next_year_detail;
  const inState = ny ? columnTotal(ny.first_year, "in_state") : null;
  const footnote = showsPayingMore(detail) ? detail.pct_paying_more : null;
  if (inState === null && footnote === null) return null;

  const isPublic = ny?.first_year.tuition?.kind === "public";
  const priceCited = citeField("derived.next_year_price", school);
  const nextYear = priceCited.year ?? priceCited.inputs?.[0]?.year ?? null;
  const federalYear = citeField("cost.tuition_fees", school).year;
  const outOfState = ny && isPublic ? columnTotal(ny.first_year, "out_of_state") : null;
  const inStateChange = change(inState, federalMatchingTotal(school, "in_state"));
  const outChange = change(outOfState, federalMatchingTotal(school, "out_of_state"));
  const continuing = ny && undergraduateDiffers(ny) ? columnTotal(ny.undergraduate, "in_state") : null;
  const estimate = ny ? fullEstimate(ny, detail) : null;

  return (
    <div className="mt-4 rounded-2xl border border-dashed p-4 text-sm">
      {ny && inState !== null && (
        <div className="space-y-1">
          <MetricLabel term="next-year-price" cited={priceCited} className="text-xs font-semibold text-muted-foreground">
            Next year{nextYear ? ` (${nextYear})` : ""}, reported by {school.name}
          </MetricLabel>
          <p className="tabular-nums">
            {isPublic ? (
              <>
                <b className="font-display text-lg font-extrabold">{money(inState)}</b> in-state
                {outOfState !== null && outOfState !== inState && (
                  <>
                    {" "}
                    · <b className="font-display text-lg font-extrabold">{money(outOfState)}</b> out-of-state
                  </>
                )}{" "}
                <span className="text-muted-foreground">before aid</span>
              </>
            ) : (
              <>
                <b className="font-display text-lg font-extrabold">{money(inState)}</b> <span className="text-muted-foreground">before aid</span>
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Tuition, fees, and on-campus food and housing
            {inStateChange !== null && federalYear && (
              <>
                {" "}
                · <span className="inline-flex items-center gap-1">
                  {changePhrase(inStateChange)}
                  {isPublic ? " in-state" : ""}
                  {outChange !== null && outOfState !== inState ? `, ${changePhrase(outChange)} out-of-state` : ""} from {federalYear}
                  <SourceTip cited={citeField("derived.next_year_change", school)} />
                </span>
              </>
            )}
            .
          </p>
          {continuing !== null && <p className="text-xs text-muted-foreground">Continuing students pay {money(continuing)} in later years.</p>}
          {estimate && (
            <details className="group pt-1 text-xs">
              <summary className="cursor-pointer font-medium text-primary">Show the full next-year estimate</summary>
              <ul className="mt-2 space-y-1 tabular-nums">
                {estimate.parts.map((p) => (
                  <li key={p.label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{p.label}</span>
                    <span>{p.value !== null ? money(p.value) : (p.text ?? "not reported")}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 border-t pt-1 font-semibold">
                  <span>Total for a student living on campus</span>
                  <span>{estimate.total !== null ? money(estimate.total) : "partial: not every part is a number"}</span>
                </li>
              </ul>
            </details>
          )}
        </div>
      )}
      {footnote !== null && (
        <p className={`flex items-center gap-1 text-xs text-muted-foreground ${ny && inState !== null ? "mt-3" : ""}`}>
          <span>
            {pct(footnote, 1)} of full-time undergraduates at {school.name} pay more than the published tuition because tuition varies by program.
          </span>
          <SourceTip cited={citeField("reported.cost.next_year_detail.pct_paying_more", school)} />
        </p>
      )}
    </div>
  );
}
