import type { Metadata } from "next";
import { compareTopicOf } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { INDICATORS, INDICATOR_KEYS, indicatorsOf } from "@/lib/indicators";
import { RACE_SERIES, SERIES, defaultWindow, historyYearLabel, type HistoryRange } from "@/lib/history";
import type { TrendKey } from "@/lib/types";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { TrendIndicatorCell } from "@/components/trends/TrendIndicators";
import { ThenAndNow, type ThenAndNowMetric } from "@/components/compare/ThenAndNow";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { InfoTip, Term } from "@/components/ui/info-tip";
import type { PageItem } from "@/components/profile/OnThisPage";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "history";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/** "Then & now" metrics, from school.trends (specs/trends-design.md#compare-then--now, specs/trend-indicators.md). */
const THEN_AND_NOW: { key: TrendKey; label: string; format: "money" | "pctSmart" | "num" | "fixed2" }[] = [
  { key: "avg_paid_all", label: "Avg total cost (after inflation)", format: "money" },
  { key: "acceptance_rate", label: "Acceptance rate", format: "pctSmart" },
  { key: "applicants", label: "Applicants", format: "num" },
  { key: "undergrads", label: "Undergrads", format: "num" },
  { key: "diversity", label: "Diversity index", format: "fixed2" },
];

/**
 * Over time, compared (specs/compare-redesign.md#topic-pages): the "10-year direction" table and "Then & now",
 * which sat 2,000px apart on the single page, moved verbatim onto one page. Every value cites its own history
 * editions (HistorySourceNote), so the page replaces the default MultiSourceNote with none.
 */
export default async function CompareHistoryPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { schools, historyFiles } = comparison;
  const topic = compareTopicOf(TOPIC);

  const hasIndicators = schools.some((s) => indicatorsOf(s).length > 0);

  const thenAndNow: ThenAndNowMetric[] = historyFiles
    ? THEN_AND_NOW.map((m) => {
        // The diversity index comes from the race/ethnicity shares, a fall series.
        const kind = m.key === "diversity" ? "fall" : m.key === "pell_gap" ? "cohort" : SERIES[m.key].kind;
        const [from, to] = defaultWindow(historyFiles.meta, kind);
        const withData = schools.map((sc, i) => ({ sc, i, t: sc.trends?.[m.key] })).filter((x) => x.t);
        return {
          key: m.key,
          label: m.label,
          format: m.format,
          fromLabel: historyYearLabel(from, kind),
          toLabel: historyYearLabel(to, kind),
          rows: withData.map(({ sc, i, t }) => ({
            id: sc.unit_id,
            name: shortName(sc),
            color: SLOT_COLORS[i],
            from: t!.from,
            to: t!.to,
            ...(t!.since > from ? { lateStart: historyYearLabel(t!.since, kind) } : {}),
          })),
          missing: schools.filter((sc) => !sc.trends?.[m.key]).map(shortName),
        };
      })
    : [];
  const hasThenAndNow = thenAndNow.some((m) => m.rows.length > 0);
  const hasHistory = hasIndicators || hasThenAndNow;

  const range: HistoryRange | undefined = historyFiles
    ? { academic: defaultWindow(historyFiles.meta, "academic"), fall: defaultWindow(historyFiles.meta, "fall") }
    : undefined;

  const items: PageItem[] = [
    ...(hasIndicators ? [{ id: "direction", label: "10-year direction" }] : []),
    ...(hasThenAndNow ? [{ id: "then-now", label: "Then & now" }] : []),
  ];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={items} sources={null} differences={false}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={topic.label} fields={[]}>
        {!hasHistory ? (
          <p className="text-muted-foreground">None of these colleges has ten years of history to compare.</p>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {hasIndicators && (
              <Block
                id="direction"
                title={
                  <>
                    10-year direction <InfoTip term="trend-direction" />
                  </>
                }
                className={COMPARE_BLOCK_SCROLL}
              >
                <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
                  Four directions over each college&apos;s last 10 years of federal data. Cost is{" "}
                  <Term term="inflation-adjusted">after inflation</Term>.
                </p>
                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full min-w-[480px] text-sm sm:min-w-[560px]">
                    <thead className="border-b bg-surface-2">
                      <tr>
                        <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-left text-xs font-semibold text-muted-foreground sm:px-4">Over 10 years</th>
                        {schools.map((s, i) => (
                          <th key={s.unit_id} className="px-4 py-3 text-left text-xs font-bold">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                              {shortName(s)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {INDICATOR_KEYS.map((k) => (
                        <tr key={k} className="border-b last:border-0">
                          <th scope="row" className="sticky left-0 z-10 w-32 bg-card px-3 py-3 text-left align-top shadow-[1px_0_0_var(--border)] sm:w-auto sm:px-4 sm:shadow-none">
                            <span className="block text-sm font-semibold">{INDICATORS[k].label}</span>
                            <span className="block text-[11px] font-normal text-muted-foreground">{INDICATORS[k].question}</span>
                          </th>
                          {schools.map((s) => (
                            <td key={s.unit_id} className="px-4 py-3 align-top">
                              <TrendIndicatorCell school={s} indicator={k} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historyFiles && (
                  <HistorySourceNote
                    keys={["avg_paid_all", "applicants", "acceptance_rate", ...Object.values(RACE_SERIES)]}
                    files={historyFiles}
                    range={range}
                    className="mt-4"
                  />
                )}
              </Block>
            )}

            {hasThenAndNow && historyFiles && (
              <Block id="then-now" title="Then & now" className={COMPARE_BLOCK_SCROLL}>
                <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
                  How each college changed over the last 10 years of federal data. Money is <Term term="inflation-adjusted">after inflation</Term>.
                </p>
                <ThenAndNow metrics={thenAndNow} />
                <HistorySourceNote
                  keys={["avg_paid_all", "acceptance_rate", "applicants", "undergrads", ...Object.values(RACE_SERIES)]}
                  files={historyFiles}
                  range={range}
                  className="mt-4"
                />
              </Block>
            )}
          </div>
        )}
      </Panel>
    </CompareTopicPage>
  );
}
