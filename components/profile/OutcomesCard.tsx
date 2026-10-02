import type { Profile } from "@/lib/profile-data";
import { topicHref, topicOf } from "@/lib/profile-topics";
import { CARD_TITLES, tenYear } from "@/lib/profile-cards";
import { DOMAINS } from "@/lib/metrics";
import { outcomesTakeaway } from "@/lib/insights";
import { money, moneyCompact, pct } from "@/lib/format";
import { Ring } from "@/components/charts/Ring";
import { MetricLabel } from "@/components/ui/info-tip";
import { CardHeadline, CardStat, CardStats, TopicCard } from "./TopicCard";
import { TenYearLine } from "./TenYearLine";

/**
 * What it pays: the graduation ring against the national median (median earnings when no rate is reported), then
 * median earnings ten years after entry, median debt with its monthly payment, retention, and the graduation rate
 * over ten entering classes.
 */
export async function OutcomesCard({ profile: p }: { profile: Profile }) {
  const { data, school, history, earnings, grad } = p;
  const { citeField, metricMedian, rankOf } = data;
  const o = school.outcomes;
  const color = DOMAINS.value.color;
  const gradMedian = metricMedian("gradRate");
  const earningsRank = rankOf(school, "earnings");
  const retention = o?.retention_rate ?? null;
  const debt = o?.median_debt ?? null;
  const gradTen = history ? tenYear("grad_rate", history.history, history.files) : null;
  const earningsStat = earnings !== null && (
    <CardStat label="Median earnings" term="median-earnings" cited={citeField("outcomes.median_earnings_10yr", school)} value={moneyCompact(earnings)} sub="10 years after entry" />
  );

  return (
    <TopicCard topic="outcomes" unitId={school.unit_id} title={CARD_TITLES.outcomes} takeaway={outcomesTakeaway(data, school) ?? topicOf("outcomes").description}>
      {grad !== null ? (
        <CardHeadline
          value={pct(grad)}
          caption={
            <>
              <MetricLabel term="graduation-rate" cited={citeField("outcomes.graduation_rate", school)}>
                graduate within six years
              </MetricLabel>
              {gradMedian !== null && (
                <>
                  {" "}
                  · national median <b className="text-foreground">{pct(gradMedian)}</b>
                </>
              )}
            </>
          }
          aside={
            <Ring value={grad} color={color} size={80} stroke={9} label={`Graduation rate ${pct(grad)}`}>
              <span className="font-display text-sm font-extrabold">{pct(grad)}</span>
            </Ring>
          }
        />
      ) : (
        earnings !== null && (
          <CardHeadline
            value={moneyCompact(earnings)}
            caption={
              <>
                <MetricLabel term="median-earnings" cited={citeField("outcomes.median_earnings_10yr", school)}>
                  median earnings 10 years after entry
                </MetricLabel>
                {earningsRank !== null && (
                  <>
                    {" "}
                    · more than at <b className="text-foreground">{pct(earningsRank)}</b> of colleges
                  </>
                )}
              </>
            }
          />
        )
      )}

      {((grad !== null && earnings !== null) || debt !== null || retention !== null) && (
        <CardStats>
          {grad !== null && earningsStat}
          {debt !== null && (
            <CardStat
              label="Median debt"
              term="median-debt"
              cited={citeField("outcomes.median_debt", school)}
              value={moneyCompact(debt)}
              sub={
                o?.monthly_loan_payment != null ? (
                  <MetricLabel cited={citeField("outcomes.monthly_loan_payment", school)}>≈ {money(o.monthly_loan_payment)}/month for 10 years</MetricLabel>
                ) : (
                  "at graduation"
                )
              }
            />
          )}
          {retention !== null && (
            <CardStat label="Retention" term="retention-rate" cited={citeField("outcomes.retention_rate", school)} value={pct(retention)} sub="come back for year two" />
          )}
        </CardStats>
      )}

      {gradTen && <TenYearLine label="Graduation rate" text={gradTen.text} spark={{ ...gradTen, name: "Graduation rate" }} color={color} href={topicHref(school.unit_id, "history")} />}
    </TopicCard>
  );
}
