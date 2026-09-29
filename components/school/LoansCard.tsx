import { getData } from "@/lib/data";
import { money, pct } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { rangeLabel, repaymentGroups } from "@/lib/repayment";
import type { School } from "@/lib/types";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { InfoTip, MetricLabel, SourceChip } from "@/components/ui/info-tip";

/**
 * Borrowing and repayment (specs/data-expansion/loans-and-repayment.md): how many undergrads borrow, median debt by
 * background, and where borrowers stand 3 years into repayment. Renders nothing when none of it is reported.
 */
export async function LoansCard({ school }: { school: School }) {
  const { citeField, metricMedian } = await getData();
  const o = school.outcomes;
  const rate = o?.federal_loan_rate ?? null;
  const inc = o?.median_debt_by_income;
  const debts = [
    { label: "Pell Grant recipients", v: o?.median_debt_pell ?? null },
    { label: "No Pell Grant", v: o?.median_debt_no_pell ?? null },
    { label: "Family income under $30K", v: inc?.low ?? null },
    { label: "$30K–$75K", v: inc?.mid ?? null },
    { label: "Over $75K", v: inc?.high ?? null },
  ].filter((d): d is { label: string; v: number } => d.v !== null);
  const maxDebt = Math.max(...debts.map((d) => d.v), 1);
  const groups = repaymentGroups(school);
  if (rate === null && !debts.length && !groups) return null;
  const color = DOMAINS.value.color;

  return (
    <div className="grid gap-6 rounded-3xl border bg-card p-4 sm:p-6 lg:grid-cols-2">
      <div className="space-y-6">
        {rate !== null && (
          <div>
            <BenchmarkBar
              label="Undergrads with a federal loan"
              term="federal-loan-rate"
              cited={citeField("outcomes.federal_loan_rate", school)}
              value={rate}
              median={metricMedian("loanRate") ?? undefined}
              scale={[0, 1]}
              format={(v) => pct(v)}
              color={color}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{loanRatePhrase(rate)}</p>
          </div>
        )}
        {debts.length > 0 && (
          <div>
            <MetricLabel term="median-debt" cited={citeField("outcomes.median_debt_by_income", school)} className="text-sm font-medium">
              Median federal debt, by background
            </MetricLabel>
            <p className="mb-3 text-xs text-muted-foreground">Everyone who borrowed and left, whether or not they graduated.</p>
            <div className="space-y-2">
              {debts.map((d) => (
                <div key={d.label} className="grid grid-cols-[9.5rem_1fr_4rem] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${(d.v / maxDebt) * 100}%`, backgroundColor: color }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{money(d.v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {groups && (
        <div>
          <h4 className="flex items-center gap-1 text-sm font-medium">
            Three years into repayment <InfoTip term="repayment-status" cited={citeField("outcomes.repayment_3yr", school)} />
            <SourceChip cited={citeField("outcomes.repayment_3yr", school)} />
          </h4>
          <p className="mb-3 text-xs text-muted-foreground">Where former undergraduates stand on their federal loans.</p>
          <div className="flex h-4 overflow-hidden rounded-full" role="img" aria-label={groups.map((g) => `${g.label} ${rangeLabel(g)}`).join(", ")}>
            {groups.map((g) => (
              <span key={g.key} style={{ width: `${g.share * 100}%`, backgroundColor: g.color }} title={`${g.label}: ${rangeLabel(g)}`} />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.key} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: g.color }} aria-hidden />
                <span className="text-muted-foreground">{g.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{rangeLabel(g)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">Some shares are published as a small range to protect privacy.</p>
        </div>
      )}
    </div>
  );
}

/** "About 1 in 10 undergrads borrows federally." */
function loanRatePhrase(rate: number): string {
  if (rate === 0) return "No undergrads took federal loans (some colleges don't take part in the federal loan program).";
  if (rate < 0.05) return "Very few undergrads borrow federally.";
  const n = Math.round(1 / rate);
  return n <= 10 && Math.abs(1 / n - rate) < 0.04 ? `About 1 in ${n} undergrads borrows federally.` : `${pct(rate)} of undergrads borrow federally.`;
}
