import type { Profile } from "@/lib/profile-data";
import { topicHref } from "@/lib/profile-topics";
import { CARD_TITLES, campusChips, diversityValues, tenYear } from "@/lib/profile-cards";
import { DOMAINS, type MetricKey } from "@/lib/metrics";
import { studentsTakeaway } from "@/lib/insights";
import { detailText, indicatorOf } from "@/lib/indicators";
import { historyYearLabel } from "@/lib/history";
import { compact, pct } from "@/lib/format";
import { StackedBar } from "@/components/charts/StackedBar";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { CardHeadline, CardStat, CardStats, TopicCard } from "./TopicCard";
import { TenYearLine } from "./TenYearLine";

/**
 * Who's on campus: undergrads with the size percentile, the diversity index with a mini race/ethnicity bar, Pell and
 * first-generation shares against the median, campus chips (setting, housing rule, athletics, programs), and the
 * diversity index over ten years (undergrads when the index can't be measured).
 */
export async function StudentsCard({ profile: p }: { profile: Profile }) {
  const { data, school, history, div } = p;
  const { citeField, metricMedian, rankOf } = data;
  const d = school.demographics;
  const rank = rankOf(school, "enrollment");
  const chips = campusChips(school);
  const diversity = indicatorOf(school, "diversity");
  const divSpark = history ? diversityValues(history.history, history.files) : null;
  const size = history ? tenYear("undergrads", history.history, history.files) : null;
  const historyHref = topicHref(school.unit_id, "history");

  /** "above the median", "about the median", "below the median" against every college that reports the measure. */
  const vsMedian = (v: number, key: MetricKey): string | undefined => {
    const m = metricMedian(key);
    if (m === null) return undefined;
    return Math.abs(v - m) < 0.02 ? "about the median" : v > m ? "above the median" : "below the median";
  };

  return (
    <TopicCard topic="students" unitId={school.unit_id} title={CARD_TITLES.students} takeaway={studentsTakeaway(data, school)}>
      <CardHeadline
        value={compact(d.undergrad_enrollment)}
        caption={
          <>
            <MetricLabel term="undergrad-enrollment" cited={citeField("demographics.undergrad_enrollment", school)}>
              undergrads
            </MetricLabel>
            {rank !== null && (
              <>
                {" "}
                · larger than <b className="text-foreground">{pct(rank)}</b> of colleges
              </>
            )}
          </>
        }
      />

      {(div !== null || d.pell_grant_percent !== null || d.first_gen_percent !== null) && (
        <CardStats>
          {div !== null && d.racial_diversity && (
            <CardStat label="Diversity index" term="diversity-index" cited={citeField("derived.diversity_index", school)} value={div.toFixed(2)}>
              <div className="mt-1.5 max-w-36">
                <StackedBar data={d.racial_diversity} height="h-1.5" showLegend={false} label={`${school.name} race and ethnicity`} />
              </div>
            </CardStat>
          )}
          {d.pell_grant_percent !== null && (
            <CardStat label="Pell Grant" term="pell-grant" cited={citeField("demographics.pell_grant_percent", school)} value={pct(d.pell_grant_percent)} sub={vsMedian(d.pell_grant_percent, "pell")} />
          )}
          {d.first_gen_percent !== null && (
            <CardStat label="First generation" term="first-gen" cited={citeField("demographics.first_gen_percent", school)} value={pct(d.first_gen_percent)} sub={vsMedian(d.first_gen_percent, "firstGen")} />
          )}
        </CardStats>
      )}

      {chips.length > 0 && (
        <div data-live className="no-scrollbar mt-4 flex gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap [&>*]:shrink-0">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
              {c.label}
              <InfoTip term={c.term} cited={citeField(c.field, school)} />
            </span>
          ))}
        </div>
      )}

      {diversity ? (
        <TenYearLine
          label={diversity.def.words[diversity.direction]}
          text={`· ${detailText(diversity)} since ${historyYearLabel(diversity.trend.since, diversity.def.kind).toLowerCase()}`}
          spark={divSpark && { ...divSpark, kind: "fall", format: "fixed2", name: "Diversity index" }}
          color={DOMAINS.diversity.color}
          href={historyHref}
        />
      ) : (
        size && <TenYearLine label="Undergrads" text={size.text} spark={{ ...size, name: "Undergrads" }} color={DOMAINS.size.color} href={historyHref} />
      )}
    </TopicCard>
  );
}
