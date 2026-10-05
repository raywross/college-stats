import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compareHref, compareTopicOf, TABLE_GROUPS } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { METRICS } from "@/lib/metrics";
import { pct, moneyCompact } from "@/lib/format";
import { MIN_GROUP_COHORT, RACE_GROUP_LABELS, hasGradByGroup, type RaceGroup } from "@/lib/graduation-groups";
import { isShown } from "@/lib/outcome-measures";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import type { Cited } from "@/lib/lineage";
import type { TermKey } from "@/lib/glossary";
import type { School } from "@/lib/types";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import type { PageItem } from "@/components/profile/OnThisPage";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "outcomes";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/** The six race/ethnicity groups shown here (specs/data-expansion/graduation-by-group.md): the site's "All the numbers" rows,
 * not the two smaller groups (American Indian/Alaska Native, Pacific Islander) that rarely reach the cohort floor. */
const RACE_ROWS: readonly RaceGroup[] = ["white", "asian", "hispanic", "black", "two_or_more", "international"];

/** A table cell or bar's blank text: suppressed for a small cohort (never 0), or genuinely not reported. */
function blankText(cohort: number | null): string {
  return cohort !== null && cohort > 0 && cohort < MIN_GROUP_COHORT ? `Not shown: under ${MIN_GROUP_COHORT} students` : "Not reported";
}

/**
 * One group's six-year graduation rate, one bar per college (specs/data-expansion/graduation-by-group.md): the
 * blank rule distinguishes a small cohort from one that's missing entirely, and never shows 0.
 */
function GradGroupBar({
  schools,
  label,
  term,
  cited,
  rate,
  cohort,
}: {
  schools: School[];
  label: string;
  term: TermKey;
  cited?: Cited;
  rate: (s: School) => number | null | undefined;
  cohort: (s: School) => number | null | undefined;
}) {
  return (
    <div>
      <MetricLabel term={term} cited={cited} className="mb-2 text-xs font-semibold text-muted-foreground">
        {label}
      </MetricLabel>
      <div className="space-y-2.5">
        {schools.map((s, i) => {
          const v = rate(s) ?? null;
          const c = cohort(s) ?? null;
          return (
            <div key={s.unit_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_auto]">
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                {v !== null && (
                  <span
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(2, Math.min(100, v * 100))}%`, backgroundColor: SLOT_COLORS[i] }}
                  />
                )}
              </span>
              <span className="text-right text-xs font-bold tabular-nums">
                {v !== null ? pct(v) : <span className="font-normal text-muted-foreground">{blankText(c)}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Outcomes, compared (specs/compare-redesign.md#topic-pages): earnings and finishing, borrowing, 8-year outcomes,
 * and graduation by group, headline figures first. "All the numbers" keeps every row; this page is the headline view.
 */
export default async function CompareOutcomesPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { data, schools, ids } = comparison;
  const { citeField } = data;
  const topic = compareTopicOf(TOPIC);

  const hasEarnings = schools.some((s) => s.outcomes?.median_earnings_10yr != null || s.outcomes?.graduation_rate != null || s.outcomes?.retention_rate != null);
  const hasBorrowing = schools.some((s) => s.outcomes?.median_debt != null || s.outcomes?.federal_loan_rate != null || s.outcomes?.median_debt_pell != null);
  const hasEightYear = schools.some((s) => isShown(s.outcomes?.eight_year?.all));
  const hasRace = schools.some((s) => RACE_ROWS.some((g) => s.outcomes?.grad_rate_by_race?.[g] != null));
  const hasOnTime = schools.some((s) => s.reported?.outcomes?.graduation);
  const hasGroup = schools.some((s) => hasGradByGroup(s)) || hasOnTime;
  // The CDS on-time rows, pulled from the already-built outcomes table group rather than re-derived (lib/compare-topics.ts ON_TIME_ROWS).
  const onTimeRows = (TABLE_GROUPS.find((g) => g.topic === "outcomes")?.rows ?? []).filter((r) => r[0].startsWith("Finished within "));

  const items: PageItem[] = [
    ...(hasEarnings ? [{ id: "earnings-finishing", label: "Earnings and finishing" }] : []),
    ...(hasBorrowing ? [{ id: "borrowing", label: "Borrowing" }] : []),
    ...(hasEightYear ? [{ id: "eight-year", label: "Eight-year outcomes" }] : []),
    ...(hasGroup ? [{ id: "by-group", label: "Graduation by group" }] : []),
  ];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={items}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={topic.label} fields={[]}>
        {items.length === 0 ? (
          <p className="text-muted-foreground">None of these colleges reports outcomes data.</p>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {hasEarnings && (
              <Block id="earnings-finishing" title="Earnings and finishing" className={COMPARE_BLOCK_SCROLL}>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <CompareMetric
                    variant="row"
                    label="Median earnings, 10 yrs"
                    term="median-earnings"
                    schools={schools}
                    get={METRICS.earnings.get}
                    format={moneyCompact}
                    flag={{ which: "max", text: "Highest" }}
                    cited={citeField(METRICS.earnings.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label="Graduation rate"
                    term="graduation-rate"
                    schools={schools}
                    get={METRICS.gradRate.get}
                    format={(v) => pct(v)}
                    max={1}
                    flag={{ which: "max", text: "Highest" }}
                    cited={citeField(METRICS.gradRate.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label="Retention rate"
                    term="retention-rate"
                    schools={schools}
                    get={(s) => s.outcomes?.retention_rate ?? null}
                    format={(v) => pct(v)}
                    max={1}
                    flag={{ which: "max", text: "Highest" }}
                    cited={citeField("outcomes.retention_rate")}
                  />
                </div>
              </Block>
            )}

            {hasBorrowing && (
              <Block id="borrowing" title="Borrowing" className={COMPARE_BLOCK_SCROLL}>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <CompareMetric
                    variant="row"
                    label="Median debt"
                    term={METRICS.debt.term}
                    schools={schools}
                    get={METRICS.debt.get}
                    format={moneyCompact}
                    flag={{ which: "min", text: "Lowest" }}
                    cited={citeField(METRICS.debt.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label={METRICS.loanRate.label}
                    term={METRICS.loanRate.term}
                    schools={schools}
                    get={METRICS.loanRate.get}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField(METRICS.loanRate.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label="Median debt, Pell Grant recipients"
                    term="median-debt"
                    schools={schools}
                    get={(s) => s.outcomes?.median_debt_pell ?? null}
                    format={moneyCompact}
                    flag={{ which: "min", text: "Lowest" }}
                    cited={citeField("outcomes.median_debt_pell")}
                  />
                </div>
              </Block>
            )}

            {hasEightYear && (
              <Block id="eight-year" title="Eight-year outcomes" className={COMPARE_BLOCK_SCROLL}>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <CompareMetric
                    variant="row"
                    label="Credential within 4 years, all students"
                    term="time-to-degree"
                    schools={schools}
                    get={METRICS.completion4.get}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField(METRICS.completion4.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label="Credential within 8 years, all students"
                    term="outcome-measures"
                    schools={schools}
                    get={METRICS.completion8.get}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField(METRICS.completion8.field)}
                  />
                  <CompareMetric
                    variant="row"
                    label="Enrolled at another college, 8 years on"
                    term="transfer-out"
                    schools={schools}
                    get={METRICS.transferOut.get}
                    format={(v) => pct(v)}
                    max={1}
                    cited={citeField(METRICS.transferOut.field)}
                  />
                </div>
              </Block>
            )}

            {hasGroup && (
              <Block id="by-group" title="Graduation by group" className={COMPARE_BLOCK_SCROLL}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <GradGroupBar
                    schools={schools}
                    label="Graduated in 6 years, Pell Grant recipients"
                    term="pell-graduation-gap"
                    cited={citeField("outcomes.grad_rate_pell")}
                    rate={(s) => s.outcomes?.grad_rate_pell}
                    cohort={(s) => s.outcomes?.grad_cohorts?.pell}
                  />
                  <GradGroupBar
                    schools={schools}
                    label="Graduated in 6 years, neither Pell nor subsidized loan"
                    term="pell-graduation-gap"
                    cited={citeField("outcomes.grad_rate_no_pell_no_loan")}
                    rate={(s) => s.outcomes?.grad_rate_no_pell_no_loan}
                    cohort={(s) => s.outcomes?.grad_cohorts?.no_pell_no_loan}
                  />
                </div>
                <div className="mt-5">
                  <CompareMetric
                    variant="row"
                    label="Pell graduation gap"
                    term={METRICS.pellGap.term}
                    schools={schools}
                    get={METRICS.pellGap.get}
                    format={METRICS.pellGap.format}
                    cited={citeField(METRICS.pellGap.field)}
                  />
                </div>

                {hasRace && (
                  <div className="mt-6">
                    <h4 className="mb-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      Graduated in 6 years, by race and ethnicity <InfoTip term="graduation-rate" cited={citeField("outcomes.grad_rate_by_race")} />
                    </h4>
                    <div className="overflow-x-auto rounded-2xl border">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead className="border-b bg-surface-2">
                          <tr>
                            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Group</th>
                            {schools.map((s, i) => (
                              <th key={s.unit_id} className="px-3 py-2 text-left text-xs font-bold">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                                  {shortName(s)}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y tabular-nums">
                          {RACE_ROWS.map((g) => (
                            <tr key={g}>
                              <td className="sticky left-0 z-10 max-w-36 bg-card px-3 py-2 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none">
                                {RACE_GROUP_LABELS[g]}
                              </td>
                              {schools.map((s) => {
                                const v = s.outcomes?.grad_rate_by_race?.[g] ?? null;
                                const c = s.outcomes?.grad_cohorts_by_race?.[g] ?? null;
                                return (
                                  <td key={s.unit_id} className="px-3 py-2 font-semibold">
                                    {v !== null ? pct(v) : <span className="font-normal text-muted-foreground">{blankText(c)}</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {hasOnTime && onTimeRows.length > 0 && (
                  <div className="mt-6">
                    <h4 className="mb-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                      On-time progress, from the colleges&apos; Common Data Sets <InfoTip term="on-time-graduation" cited={citeField("reported.outcomes.graduation")} />
                    </h4>
                    <div className="overflow-x-auto rounded-2xl border">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead className="border-b bg-surface-2">
                          <tr>
                            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Finished within</th>
                            {schools.map((s, i) => (
                              <th key={s.unit_id} className="px-3 py-2 text-left text-xs font-bold">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                                  {shortName(s)}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y tabular-nums">
                          {onTimeRows.map(([label, , , fmt]) => (
                            <tr key={label}>
                              <td className="sticky left-0 z-10 max-w-36 bg-card px-3 py-2 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none">
                                {label.replace("Finished within ", "")}
                              </td>
                              {schools.map((s) => {
                                const txt = fmt(s);
                                return (
                                  <td key={s.unit_id} className="px-3 py-2 font-semibold">
                                    {txt === "Not published" ? <span className="font-normal text-muted-foreground">{txt}</span> : txt}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Block>
            )}
          </div>
        )}

        <p className="pt-6">
          <Link href={compareHref(ids, "table", { hash: "outcomes" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            All outcome numbers in the table <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </Panel>
    </CompareTopicPage>
  );
}
