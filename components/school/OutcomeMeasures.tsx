import { getData } from "@/lib/data";
import { pct } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { OUTCOME_GROUPS, isShown, timeToDegreeHeadline, type OutcomeGroupKey } from "@/lib/outcome-measures";
import type { EightYearGroup, School } from "@/lib/types";
import { OutcomeBar } from "@/components/charts/OutcomeBar";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";

/**
 * 8-year outcomes for everyone who starts here (specs/data-expansion/outcome-measures.md): the outcome bar with its
 * all / first-time / transfer toggle, and Pell vs non-Pell completion. Renders nothing without a shown cohort.
 */
export async function OutcomeMeasures({ school }: { school: School }) {
  const { citeField, metricMedian } = await getData();
  const o = school.outcomes?.eight_year;
  if (!o || !isShown(o.all)) return null;
  const cited = citeField("outcomes.eight_year", school);
  const color = DOMAINS.value.color;
  const groups: Partial<Record<OutcomeGroupKey, EightYearGroup>> = {};
  for (const { key } of OUTCOME_GROUPS) {
    const g = o[key];
    if (isShown(g)) groups[key] = g;
  }
  const pell = [
    { label: "Pell Grant recipients", v: o.pell?.award ?? null },
    { label: "Students without a Pell Grant", v: o.non_pell?.award ?? null },
  ];
  const median = metricMedian("completion8");
  // Time to degree (specs/data-expansion/time-to-degree.md): one row per shown group, cumulative 4/6/8-year shares.
  const steps = OUTCOME_GROUPS.flatMap(({ key, label }) => {
    const g = groups[key];
    return g && g.award_4 != null && g.award_6 != null && g.award != null ? [{ key, label, values: [g.award_4, g.award_6, g.award] }] : [];
  });
  const stepsHeadline = timeToDegreeHeadline(groups.all);

  return (
    <div className="mt-4 grid gap-6 rounded-3xl border bg-card p-4 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <h3 className="flex items-center gap-1 font-display text-lg font-bold">
          Everyone who starts here, 8 years later <InfoTip term="outcome-measures" cited={cited} />
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Students who entered in fall {o.entering_year}, including <Term term="transfer-out">transfer</Term> and part-time students. The
          graduation rate counts only first-time, full-time students and treats a transfer out as not finishing.
        </p>
        <OutcomeBar groups={groups} color={color} />
      </div>
      <div className="space-y-5">
        {pell.some((p) => p.v !== null) && (
          <div>
            <MetricLabel term="pell-grant" cited={cited} className="text-sm font-medium">
              Earned a credential within 8 years
            </MetricLabel>
            <p className="mb-3 text-xs text-muted-foreground">All entering students, by whether they had a Pell Grant.</p>
            <div className="space-y-2">
              {pell.map((p) => (
                <div key={p.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    {p.v !== null && <span className="block h-full rounded-full" style={{ width: `${p.v * 100}%`, backgroundColor: color }} />}
                  </span>
                  <span className="text-right font-semibold tabular-nums">{p.v === null ? "–" : pct(p.v)}</span>
                </div>
              ))}
            </div>
            {pell.some((p) => p.v === null) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                – Fewer than 30 students in the group <InfoTip term="adjusted-cohort" className="ml-0.5" />
              </p>
            )}
          </div>
        )}
        {steps.length > 0 && (
          <div>
            <MetricLabel term="time-to-degree" cited={cited} className="text-sm font-medium">
              How long it takes
            </MetricLabel>
            {stepsHeadline && <p className="mb-3 text-xs text-muted-foreground">{stepsHeadline}</p>}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 text-left font-normal">Earned a credential within</th>
                  <th className="pb-1 text-right font-normal">4 yrs</th>
                  <th className="pb-1 text-right font-normal">6 yrs</th>
                  <th className="pb-1 text-right font-normal">8 yrs</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.key} className="border-t">
                    <td className="py-1.5 pr-2">{s.label}</td>
                    {s.values.map((v, i) => (
                      <td key={i} className="py-1.5 text-right font-semibold tabular-nums">
                        {pct(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {steps.some((s) => s.key === "transfer_in") && (
              <p className="mt-2 text-[11px] text-muted-foreground">Transfer students&apos; clock starts when they arrive here, not when they first started college.</p>
            )}
          </div>
        )}
        {median !== null && (
          <p className="text-xs text-muted-foreground">
            National median: <b className="text-foreground">{pct(median)}</b> of all entering students earn a credential at the college they
            started at within 8 years.
          </p>
        )}
      </div>
    </div>
  );
}
