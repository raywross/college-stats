import type { Metadata } from "next";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS } from "@/lib/profile-topics";
import { DOMAINS } from "@/lib/metrics";
import { outcomesTakeaway } from "@/lib/insights";
import { moneyCompact, pct } from "@/lib/format";
import { VALUE_X, VALUE_Y, valueZone } from "@/lib/chart-configs";
import { BLOCK_SCROLL, Panel, Block } from "@/components/profile/Panel";
import { isShown } from "@/lib/outcome-measures";
import { hasGradByGroup } from "@/lib/graduation-groups";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { ShowMore } from "@/components/ui/show-more";
import { InfoTip } from "@/components/ui/info-tip";
import { Ring } from "@/components/charts/Ring";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { OutcomeMeasures } from "@/components/school/OutcomeMeasures";
import { GraduationByGroup } from "@/components/school/GraduationByGroup";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "outcomes");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;

const TOPIC = "outcomes";

/** Earnings, staying and finishing, 8-year outcomes, graduation by group, and the cost vs. earnings map. */
export default async function OutcomesPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, earnings, grad, onValueMap } = p;
  const { citeField, distribution, metricMedian, rankOf, valuePoints } = data;
  const o = school.outcomes;

  const items = [
    { id: "earnings", label: "Earnings" },
    { id: "finishing", label: "Staying and finishing" },
    { id: "eight-year", label: "8 years later" },
    { id: "by-group", label: "Graduation by group" },
    { id: "map", label: "Cost vs. earnings" },
  ];

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel level={1} domain="value" eyebrow="Outcomes" title="What it pays" takeaway={outcomesTakeaway(data, school)} school={school} fields={TOPIC_FIELDS[TOPIC]}>
        {(earnings !== null || grad !== null) && (
          <div className="grid gap-4 md:grid-cols-2">
            <Block id="earnings" className="space-y-6">
              <h3 className="font-display text-lg font-bold">Earnings</h3>
              <DistributionStrip label="Median earnings vs. every college" term="median-earnings" dist={distribution("earnings")} value={earnings} rank={rankOf(school, "earnings")} format="moneyCompact" color={DOMAINS.value.color} />
              {earnings !== null && o?.median_earnings_6yr != null && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Earnings climb with time</p>
                  {[
                    { label: "6 years after entry", v: o.median_earnings_6yr },
                    { label: "10 years after entry", v: earnings },
                  ].map((row, i) => (
                    <div key={row.label} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${DOMAINS.value.color} 16%, transparent)` }}>
                        <span
                          className="block h-full origin-left animate-grow-x rounded-full"
                          style={{
                            width: `${(row.v / Math.max(earnings, o.median_earnings_6yr!)) * 100}%`,
                            backgroundColor: DOMAINS.value.color,
                            animationDelay: `${i * 100}ms`,
                          }}
                        />
                      </span>
                      <span className="font-semibold tabular-nums">{moneyCompact(row.v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Block>
            <Block id="finishing">
              <h3 className="mb-5 font-display text-lg font-bold">Staying and finishing</h3>
              <div className="flex flex-wrap justify-around gap-6">
                {[
                  { label: "come back for year two", v: o?.retention_rate ?? null, term: "retention-rate" as const, name: "Retention", field: "outcomes.retention_rate" as const },
                  { label: "graduate within six years", v: grad, term: "graduation-rate" as const, name: "Graduation", field: "outcomes.graduation_rate" as const },
                ]
                  .filter((r): r is typeof r & { v: number } => r.v !== null)
                  .map((r) => (
                    <div key={r.name} className="text-center">
                      <Ring value={r.v} color={DOMAINS.value.color} size={112} stroke={12} label={`${r.name} rate ${pct(r.v)}`}>
                        <span className="font-display text-2xl font-extrabold">{pct(r.v)}</span>
                      </Ring>
                      <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold">
                        {r.name} <InfoTip term={r.term} cited={citeField(r.field, school)} />
                      </p>
                      <p className="text-[11px] text-muted-foreground">{r.label}</p>
                    </div>
                  ))}
              </div>
              {grad !== null && (
                <p className="mt-5 text-xs text-muted-foreground">
                  National median graduation rate: <b className="text-foreground">{pct(metricMedian("gradRate") ?? 0)}</b>
                </p>
              )}
            </Block>
          </div>
        )}

        {isShown(o?.eight_year?.all) && (
          <div id="eight-year" className={BLOCK_SCROLL}>
            <OutcomeMeasures school={school} />
          </div>
        )}
        {hasGradByGroup(school) && (
          <div id="by-group" className={BLOCK_SCROLL}>
            <GraduationByGroup school={school} />
          </div>
        )}

        {onValueMap && (
          <ShowMore id="map" until="lg" label="Show the cost vs. earnings map" hint={`Where ${school.name} sits among 300 colleges`} className="mt-4">
            <Block>
              <h3 className="mb-1 font-display text-lg font-bold">Cost vs. earnings</h3>
              <p className="mb-3 text-xs text-muted-foreground">The 300 most-applied-to colleges plus {school.name}. Top-left is lower cost and higher earnings.</p>
              <ScatterPlot focusId={school.unit_id} height={380} points={valuePoints(undefined, 300, [school.unit_id])} x={VALUE_X} y={VALUE_Y} zone={valueZone(metricMedian("avgCost"), metricMedian("earnings"))} />
            </Block>
          </ShowMore>
        )}
      </Panel>
    </TopicPage>
  );
}
