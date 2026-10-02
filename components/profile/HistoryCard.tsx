import type { Profile } from "@/lib/profile-data";
import { CARD_TITLES, diversityValues, tenYear, type TenYear } from "@/lib/profile-cards";
import { DOMAINS } from "@/lib/metrics";
import { historyTakeaway } from "@/lib/insights";
import { INDICATORS, detailText, indicatorOf, type IndicatorKey } from "@/lib/indicators";
import { defaultWindow, historyYearLabel, type SeriesKey } from "@/lib/history";
import type { FormatKind } from "@/lib/format";
import { Sparkline } from "@/components/charts/Sparkline";
import { InfoTip } from "@/components/ui/info-tip";
import { TopicCard } from "./TopicCard";

/** The four tiles: the indicator that names each, and the series behind its sparkline (diversity is computed). */
const TILES: { key: IndicatorKey; series: SeriesKey | "diversity" }[] = [
  { key: "cost", series: "avg_paid_all" },
  { key: "applications", series: "applicants" },
  { key: "selectivity", series: "acceptance_rate" },
  { key: "diversity", series: "diversity" },
];

/**
 * Over time: the history takeaway and four sparkline tiles (cost, applications, selectivity, diversity) with the
 * ten-year direction words (specs/trend-indicators.md). A tile shows when the indicator or its series exists; with
 * only the series it reads "from → to" instead of a direction word.
 */
export async function HistoryCard({ profile: p }: { profile: Profile }) {
  const { data, school, history } = p;
  if (!history) return null;
  const { citeField } = data;
  const trendsCited = citeField("trends", school);
  const since = historyYearLabel(defaultWindow(history.files.meta, "academic")[0], "academic");

  const tiles = TILES.flatMap(({ key, series }) => {
    const def = INDICATORS[key];
    const indicator = indicatorOf(school, key);
    const ten: Pick<TenYear, "start" | "kind" | "format" | "values" | "fromTo"> | null =
      series === "diversity"
        ? (() => {
            const d = diversityValues(history.history, history.files);
            return d && { ...d, kind: "fall" as const, format: "fixed2" as FormatKind, fromTo: "" };
          })()
        : tenYear(series, history.history, history.files);
    if (!indicator && !ten) return [];
    return [
      {
        key,
        label: def.label,
        word: indicator ? def.words[indicator.direction] : ten!.fromTo || "Reported",
        detail: indicator ? detailText(indicator) : null,
        color: DOMAINS[def.domain].color,
        spark: ten,
      },
    ];
  });

  return (
    <TopicCard topic="history" unitId={school.unit_id} title={CARD_TITLES.history} takeaway={historyTakeaway(history.history, history.files)} year={`since ${since}`}>
      {tiles.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.key} className="min-w-0 rounded-2xl bg-muted/60 p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                {t.label} <InfoTip term="trend-direction" cited={trendsCited} />
              </p>
              <p className="font-display text-base leading-tight font-extrabold">{t.word}</p>
              {t.detail && <p className="text-[11px] text-muted-foreground tabular-nums">{t.detail}</p>}
              {t.spark && (
                <div className="mt-2 overflow-hidden" aria-hidden>
                  <Sparkline compact height={28} start={t.spark.start} kind={t.spark.kind} format={t.spark.format} label={`${t.label} over ten years`} series={[{ name: t.label, color: t.color, values: t.spark.values }]} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </TopicCard>
  );
}
