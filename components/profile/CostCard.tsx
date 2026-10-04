import { ExternalLink } from "lucide-react";
import type { Profile } from "@/lib/profile-data";
import { topicHref, topicOf } from "@/lib/profile-topics";
import { CARD_TITLES, MIDDLE_INCOME_BAND, middleBand, tenYear } from "@/lib/profile-cards";
import type { FieldPath } from "@/lib/fields";
import type { TermKey } from "@/lib/glossary";
import { DOMAINS, INCOME_BANDS, aidGenerosity, generosityTier } from "@/lib/metrics";
import { costTakeaway } from "@/lib/insights";
import { indicatorOf } from "@/lib/indicators";
import { moneyCompact, pct } from "@/lib/format";
import { Ring } from "@/components/charts/Ring";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { CardHeadline, CardStat, CardStats, TopicCard } from "./TopicCard";
import { TenYearLine } from "./TenYearLine";

/**
 * What it costs: the average total cost against the national median with the aid-generosity ring, full price vs.
 * net price with grants vs. the middle income band as three bars, the generosity tier, the share with a federal
 * loan, the net price calculator link, and average cost over ten years.
 */
export async function CostCard({ profile: p }: { profile: Profile }) {
  const { data, school, history, avgCost, byIncome } = p;
  const { citeField, metricMedian } = data;
  const c = school.cost;
  const color = DOMAINS.value.color;
  const costCited = citeField("cost.avg_paid_all", school);
  // avg_paid_all is derived: its year is its inputs' (the same release for every input).
  const year = costCited.year ?? costCited.inputs?.[0]?.year ?? null;
  const generosity = aidGenerosity(school);
  const tier = generosityTier(generosity);
  const median = metricMedian("avgCost");
  const vsMedian = avgCost !== null && median !== null ? (Math.abs(avgCost - median) < 1000 ? "about the national median" : `${moneyCompact(Math.abs(avgCost - median))} ${avgCost < median ? "below" : "above"} the national median`) : null;
  // Net price by income covers in-state students at publics, so the full-price bar uses the in-state sticker.
  const full = c?.sticker?.in_state ?? c?.sticker?.in_district ?? null;
  const aided = c?.aided_net_price ?? null;
  const mid = middleBand(byIncome);
  const bars = (
    [
      full !== null && { label: school.type === "public" ? "Full price, in-state" : "Full price", value: full, field: "cost.sticker", term: "cost-of-attendance" },
      aided !== null && { label: "With grants", value: aided, field: "cost.aided_net_price", term: "net-price" },
      mid !== null && { label: `${INCOME_BANDS[MIDDLE_INCOME_BAND]} income`, value: mid, field: "cost.net_price_by_income", term: "net-price-by-income" },
    ] as const
  ).filter((b): b is Exclude<typeof b, false> => b !== false) as { label: string; value: number; field: FieldPath; term: TermKey }[];
  const scale = Math.max(1, ...bars.map((b) => b.value));
  const loanRate = school.outcomes?.federal_loan_rate ?? null;
  const loanMedian = metricMedian("loanRate");
  const cost = history ? tenYear("avg_paid_all", history.history, history.files) : null;
  const direction = indicatorOf(school, "cost");

  return (
    <TopicCard topic="cost" unitId={school.unit_id} title={CARD_TITLES.cost} takeaway={costTakeaway(data, school) ?? topicOf("cost").description} year={year}>
      {avgCost !== null ? (
        <CardHeadline
          value={moneyCompact(avgCost)}
          caption={
            <>
              <MetricLabel term="average-cost" cited={costCited}>
                average total cost per year, all first-years, after grants (est.)
              </MetricLabel>
              {vsMedian && <> · {vsMedian}</>}
            </>
          }
          aside={
            generosity !== null && (
              <Ring value={generosity} color={color} size={64} stroke={8} label={`Grants cover ${pct(generosity)} of the full price`}>
                <span className="font-display text-xs font-extrabold">{pct(generosity)}</span>
              </Ring>
            )
          }
          className="flex-row-reverse"
        />
      ) : aided !== null ? (
        <CardHeadline
          value={moneyCompact(aided)}
          caption={
            <MetricLabel term="net-price" cited={citeField("cost.aided_net_price", school)}>
              net price per year for first-years with grants
            </MetricLabel>
          }
        />
      ) : (
        <div>
          <MetricLabel term="average-cost" cited={costCited} className="text-[11px] font-semibold text-muted-foreground">
            Average cost
          </MetricLabel>
          <p className="font-display text-2xl font-extrabold text-muted-foreground">Not reported</p>
        </div>
      )}

      {bars.length > 1 && (
        <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-xs">
          {bars.map((b) => (
            <div key={b.field} className="contents">
              <MetricLabel term={b.term} cited={citeField(b.field, school)} className="text-muted-foreground">
                {b.label}
              </MetricLabel>
              <span className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }}>
                <span className="block h-full origin-left animate-grow-x rounded-full" style={{ width: `${Math.max(1.5, (Math.max(0, b.value) / scale) * 100)}%`, backgroundColor: color }} />
              </span>
              <span className="font-semibold tabular-nums">{moneyCompact(b.value)}</span>
            </div>
          ))}
        </div>
      )}

      <CardStats>
        {generosity !== null && (
          <CardStat label="Aid generosity" term="aid-generosity" cited={citeField("derived.aid_generosity", school)} value={tier.label} sub={`grants cover ${pct(generosity)} of full price`} />
        )}
        {loanRate !== null && (
          <CardStat
            label="Federal loans"
            term="federal-loan-rate"
            cited={citeField("outcomes.federal_loan_rate", school)}
            value={pct(loanRate)}
            sub={`of undergrads${loanMedian !== null ? ` · national median ${pct(loanMedian)}` : ""}`}
          />
        )}
        {school.links?.price_calculator && (
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-muted-foreground">Your price</p>
            <a
              href={school.links.price_calculator}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 font-display text-base leading-snug font-extrabold text-primary hover:underline"
            >
              Net price calculator <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              the college&apos;s own <Term term="net-price-calculator">estimate</Term>
            </p>
          </div>
        )}
        {(school.links?.financial_aid || school.links?.veterans) && (
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-muted-foreground">Financial aid</p>
            {school.links?.financial_aid && (
              <a
                href={school.links.financial_aid}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 font-display text-base leading-snug font-extrabold text-primary hover:underline"
              >
                Financial aid office <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
            )}
            {school.links?.veterans && (
              <a
                href={school.links.veterans}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:underline"
              >
                Veterans&apos; benefits <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            )}
          </div>
        )}
      </CardStats>

      {cost && (
        <TenYearLine
          label={direction ? `Cost ${direction.def.words[direction.direction].toLowerCase()}` : "Average cost"}
          text={`· ${cost.text}`}
          spark={{ ...cost, name: "Average cost" }}
          color={color}
          href={topicHref(school.unit_id, "history")}
        />
      )}
    </TopicCard>
  );
}
