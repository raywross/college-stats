import type { Profile } from "@/lib/profile-data";
import { topicHref, topicOf } from "@/lib/profile-topics";
import { admissionsTitle, tenYear } from "@/lib/profile-cards";
import { DOMAINS, admitRatioFromRate, selectivityTier } from "@/lib/metrics";
import { admissionsTakeaway } from "@/lib/insights";
import { num, pct, pctSmart, range } from "@/lib/format";
import { scoreScale } from "@/lib/score-scale";
import { Ring } from "@/components/charts/Ring";
import { RangeBar } from "@/components/charts/RangeBar";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";
import { CardHeadline, CardStat, CardStats, TopicCard } from "./TopicCard";
import { TenYearLine } from "./TenYearLine";

/**
 * Getting in: the acceptance ring with "1 in N" and the selectivity tier (or the open-admission state), applied,
 * admitted, and yield, the SAT and ACT middle 50% bars, and applications over ten years with the acceptance rate.
 */
export async function AdmissionsCard({ profile: p }: { profile: Profile }) {
  const { data, school, history, counts, rate, sat, yld } = p;
  const { citeField, metricMedian } = data;
  const a = school.admissions;
  const color = DOMAINS.admissions.color;
  // The fall the headline figure describes, from lineage (the counts' release, or the rate's when counts aren't reported).
  const year = citeField(counts ? "admissions.applicants" : "admissions.acceptance_rate", school).year;
  const tier = selectivityTier(rate);
  const apps = history ? tenYear("applicants", history.history, history.files) : null;
  const rateTen = history ? tenYear("acceptance_rate", history.history, history.files) : null;
  const act = a.act_composite_25_75;

  return (
    <TopicCard topic="admissions" unitId={school.unit_id} title={admissionsTitle(admitRatioFromRate(rate))} takeaway={admissionsTakeaway(data, school) ?? topicOf("admissions").description} year={year}>
      {rate !== null ? (
        <CardHeadline
          value={pctSmart(rate)}
          caption={
            <>
              <MetricLabel term="acceptance-rate" cited={citeField("admissions.acceptance_rate", school)}>
                acceptance rate
              </MetricLabel>
              <span className="mt-1.5 flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                {tier.label}
                <InfoTip term="selectivity" />
              </span>
            </>
          }
          aside={
            <Ring value={rate} color={color} size={80} stroke={9} label={`Acceptance rate ${pctSmart(rate)}`}>
              <span className="font-display text-sm font-extrabold">{pctSmart(rate)}</span>
            </Ring>
          }
        />
      ) : (
        <div>
          <MetricLabel term="acceptance-rate" cited={citeField("admissions.acceptance_rate", school)} className="text-[11px] font-semibold text-muted-foreground">
            Acceptance rate
          </MetricLabel>
          <p className="font-display text-2xl font-extrabold text-muted-foreground">Not reported</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Usually means <Term term="open-admission">open admission</Term>: most applicants are accepted.
          </p>
        </div>
      )}
      {counts && (
        <CardStats>
          <CardStat label="Applied" term="applicants" cited={citeField("admissions.applicants", school)} value={num(a.applicants!)} />
          <CardStat label="Admitted" term="admitted" cited={citeField("admissions.admitted", school)} value={num(a.admitted!)} />
          {yld !== null && <CardStat label="Yield" term="yield" cited={citeField("derived.yield", school)} value={pct(yld)} sub="of admits enroll" />}
        </CardStats>
      )}

      {(sat || act) && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          {sat && (
            <div className="min-w-0">
              <MetricLabel term="middle-50" cited={citeField("derived.sat_composite", school)} className="flex-wrap text-[11px] font-semibold text-muted-foreground">
                SAT middle 50%
              </MetricLabel>
              <p className="mt-0.5 mb-1 font-display text-xl font-extrabold whitespace-nowrap">{range(sat)}</p>
              <RangeBar low={sat[0]} high={sat[1]} scale={scoreScale("sat", sat[0]).scale} color={DOMAINS.scores.color} medianMid={metricMedian("sat") ?? undefined} compact showScale />
            </div>
          )}
          {act && (
            <div className="min-w-0">
              <MetricLabel term="act" cited={citeField("admissions.act_composite_25_75", school)} className="flex-wrap text-[11px] font-semibold text-muted-foreground">
                ACT middle 50%
              </MetricLabel>
              <p className="mt-0.5 mb-1 font-display text-xl font-extrabold whitespace-nowrap">{range(act)}</p>
              <RangeBar low={act[0]} high={act[1]} scale={scoreScale("act", act[0]).scale} color={DOMAINS.scores.color} medianMid={metricMedian("act") ?? undefined} compact showScale />
            </div>
          )}
        </div>
      )}

      {apps && (
        <TenYearLine
          label="Applications"
          text={`${apps.text}${rateTen ? ` · admit rate ${rateTen.fromTo}` : ""}`}
          spark={{ ...apps, name: "Applications" }}
          color={color}
          href={topicHref(school.unit_id, "history")}
        />
      )}
    </TopicCard>
  );
}
