import type { Metadata } from "next";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS, topicHref } from "@/lib/profile-topics";
import { DOMAINS } from "@/lib/metrics";
import { campusTakeaway, studentBodyNotes, studentsTakeaway } from "@/lib/insights";
import { num, pct, pctSmart } from "@/lib/format";
import { historyEvents } from "@/lib/events";
import { lastYear } from "@/lib/history";
import { Panel, Block } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { HeadlineDelta } from "@/components/history/HeadlineDelta";
import { ShowMore } from "@/components/ui/show-more";
import { InfoTip } from "@/components/ui/info-tip";
import { StackedBar } from "@/components/charts/StackedBar";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { Residence } from "@/components/school/Residence";
import { Transfers } from "@/components/school/Transfers";
import { StandoutChip } from "@/components/school/StandoutChip";
import { CampusLife } from "@/components/school/CampusLife";
import { GreekLife } from "@/components/school/GreekLife";
import { CampusServices } from "@/components/school/CampusServices";
import { ReligiousLife } from "@/components/school/ReligiousLife";
import { LgbtqLife } from "@/components/school/LgbtqLife";
import { countDisplay, countText } from "@/lib/lgbtq";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "students");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;
// An empty list makes Next render each college's page on first visit and keep it (ISR); without it the route is
// dynamic on every request (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export async function generateStaticParams() {
  return [];
}

const TOPIC = "students";

/** Who's on campus (race, economic access, size, residence, transfers, who they are) and campus life. */
export default async function StudentsPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, detail, history, div, hasCampus } = p;
  const { citeField, distribution, metricMedian, rankOf } = data;
  const { demographics: d } = school;
  const body = studentBodyNotes(data, school);
  // Another gender beside the men/women shares (specs/lgbtq-life.md), under the same display rules as the block.
  const gender = school.lgbtq?.gender ?? null;
  const another = gender ? countDisplay(gender.status, gender.another, gender.undergrads) : null;
  // Conference and association moves in the last three IC years, under the athletics line (campus-services.md).
  const servicesYear = history?.history.series.athletic_association ? lastYear(history.history.series.athletic_association) : null;
  const recentMoves =
    history && servicesYear !== null
      ? historyEvents(history.history).filter((e) => ["conference", "football_conference", "athletic_association"].includes(e.key) && e.year > servicesYear - 3)
      : [];

  const items = [
    { id: "race", label: "Race & ethnicity" },
    { id: "access", label: "Economic access" },
    { id: "size", label: "Campus size" },
    { id: "residence", label: "Where they come from" },
    { id: "transfers", label: "Transfers" },
    { id: "who", label: "Who they are" },
    { id: "campus", label: "Campus life" },
  ];

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel
        level={1}
        domain="access"
        eyebrow="Students"
        title="Who's on campus"
        takeaway={studentsTakeaway(data, school)}
        delta={history && <HeadlineDelta seriesKey="undergrads" history={history.history} files={history.files} color={DOMAINS.size.color} href={topicHref(school.unit_id, "history")} />}
        school={school}
        fields={TOPIC_FIELDS[TOPIC]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Block id="race" className="md:col-span-2">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                Race & ethnicity <InfoTip term="race-ethnicity" cited={citeField("demographics.racial_diversity", school)} />
              </h3>
              {div !== null && (
                <p className="flex items-center gap-1 text-sm">
                  <span className="text-muted-foreground">Diversity index</span>
                  <b>{div.toFixed(2)}</b>
                  <InfoTip term="diversity-index" cited={citeField("derived.diversity_index", school)} />
                </p>
              )}
            </div>
            {d.racial_diversity ? <StackedBar data={d.racial_diversity} label={`${school.name} race and ethnicity`} /> : <p className="text-sm text-muted-foreground">Not reported.</p>}
            {div !== null && (
              <div className="mt-6">
                <DistributionStrip label="Diversity index vs. every college" term="diversity-index" dist={distribution("diversity")} value={div} rank={rankOf(school, "diversity")} format="fixed2" color={DOMAINS.diversity.color} />
              </div>
            )}
          </Block>
          <Block id="access" className="space-y-6">
            <h3 className="font-display text-lg font-bold">Economic access</h3>
            {d.pell_grant_percent !== null ? (
              <BenchmarkBar
                label="Pell Grant recipients"
                term="pell-grant"
                cited={citeField("demographics.pell_grant_percent", school)}
                value={d.pell_grant_percent}
                median={metricMedian("pell") ?? undefined}
                scale={[0, 1]}
                format={(v) => pct(v)}
                color={DOMAINS.access.color}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Pell Grant share not reported.</p>
            )}
            {d.first_gen_percent !== null ? (
              <BenchmarkBar
                label="First-generation students"
                term="first-gen"
                cited={citeField("demographics.first_gen_percent", school)}
                value={d.first_gen_percent}
                median={metricMedian("firstGen") ?? undefined}
                scale={[0, 1]}
                format={(v) => pct(v)}
                color={DOMAINS.access.color}
              />
            ) : (
              <p className="text-sm text-muted-foreground">First-generation share not reported.</p>
            )}
            {d.pell_grant_percent !== null && (
              <DistributionStrip label="Pell Grant share vs. every college" term="pell-grant" dist={distribution("pell")} value={d.pell_grant_percent} rank={rankOf(school, "pell")} format="pct" color={DOMAINS.access.color} />
            )}
          </Block>
          <Block id="size" className="space-y-6">
            <h3 className="flex items-center gap-1.5 font-display text-lg font-bold">
              Campus size <InfoTip term="undergrad-enrollment" cited={citeField("demographics.undergrad_enrollment", school)} />
            </h3>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-5xl font-extrabold tracking-tight">{num(d.undergrad_enrollment)}</span>
              <span className="text-sm text-muted-foreground">undergrads</span>
            </div>
            <DistributionStrip
              label="Compared to every college"
              term="undergrad-enrollment"
              dist={distribution("enrollment")}
              value={d.undergrad_enrollment}
              rank={rankOf(school, "enrollment")}
              rankPhrase="larger than"
              format="compact"
              color={DOMAINS.size.color}
            />
          </Block>
          <Residence
            id="residence"
            school={school}
            detail={detail}
            cited={citeField("demographics.residence", school)}
            rank={rankOf(school, "outOfState")}
          />
          <Transfers id="transfers" school={school} citedIn={citeField("demographics.transfer_in", school)} citedOut={citeField("outcomes.eight_year", school)} rank={rankOf(school, "transferShare")} />
          {(d.men_share != null || d.part_time_share != null || d.age_25_plus_share != null) && (
            <ShowMore id="who" label="Show men, women, part-time, and age" hint="How the student body compares with the median college" className="md:col-span-2">
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="font-display text-lg font-bold">Who they are</h3>
                  {body.manyAdults && <StandoutChip standout={{ label: "Many adult students", domain: "access", metric: "adults" }} />}
                  {body.study && <p className="w-full text-sm text-muted-foreground sm:ml-auto sm:w-auto">{body.study}</p>}
                </div>
                <div className="grid gap-6 sm:grid-cols-3">
                  {d.men_share != null && (
                    <div>
                      <BenchmarkBar
                        label="Men"
                        term="gender-balance"
                        cited={citeField("demographics.men_share", school)}
                        value={d.men_share}
                        median={metricMedian("menShare") ?? undefined}
                        scale={[0, 1]}
                        format={(v) => pct(v)}
                        color={DOMAINS.access.color}
                      />
                      {d.women_share != null && <p className="mt-1.5 text-xs text-muted-foreground">{pct(d.women_share)} women</p>}
                      {another && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                          <span>Another gender: {countText(another, "undergraduates")}</span>
                          <InfoTip term="another-gender" cited={citeField("lgbtq.gender", school)} />
                        </p>
                      )}
                    </div>
                  )}
                  {d.part_time_share != null && (
                    <BenchmarkBar
                      label="Part-time students"
                      term="part-time-student"
                      cited={citeField("demographics.part_time_share", school)}
                      value={d.part_time_share}
                      median={metricMedian("partTime") ?? undefined}
                      scale={[0, 1]}
                      format={pctSmart}
                      color={DOMAINS.access.color}
                    />
                  )}
                  {d.age_25_plus_share != null && (
                    <BenchmarkBar
                      label="Students 25 and older"
                      term="adult-students"
                      cited={citeField("demographics.age_25_plus_share", school)}
                      value={d.age_25_plus_share}
                      median={metricMedian("adults") ?? undefined}
                      scale={[0, 1]}
                      format={pctSmart}
                      color={DOMAINS.access.color}
                    />
                  )}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Degree-seeking undergraduates.
                  {d.men_share != null &&
                    " Men and women add up to 100% because federal data has colleges count each student of another or unknown gender as a man or a woman."}
                </p>
              </div>
            </ShowMore>
          )}
        </div>
      </Panel>

      {hasCampus && (
        <Panel
          id="campus"
          domain="size"
          eyebrow="Campus life"
          title="Housing, sports, faith, Greek life, and LGBTQ+ life"
          takeaway={campusTakeaway(school)}
          fields={[]}
          className="mt-14 sm:mt-20"
        >
          <div className="space-y-4">
            <CampusLife school={school} />
            <CampusServices school={school} recentMoves={recentMoves} />
            <ReligiousLife school={school} detail={detail} />
            <GreekLife school={school} detail={detail} />
            <LgbtqLife
              school={school}
              detail={detail}
              citedGender={citeField("lgbtq.gender", school)}
              citedAdmissions={citeField("lgbtq.admissions", school)}
              citedLaw={citeField("lgbtq.state_law", school)}
            />
          </div>
        </Panel>
      )}
    </TopicPage>
  );
}
