import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS, topicHref } from "@/lib/profile-topics";
import { DOMAINS, satMedian, satMid } from "@/lib/metrics";
import { admissionsTakeaway, admissionsBySex, scoresTakeaway, yieldTakeaway } from "@/lib/insights";
import { money, num, pct, pctSmart } from "@/lib/format";
import { eventYear, historyEvents } from "@/lib/events";
import { FACTOR_ERA } from "@/lib/derive";
import { LANDSCAPE_X, LANDSCAPE_Y, LANDSCAPE_ZONE } from "@/lib/chart-configs";
import { BLOCK_SCROLL, Panel, Block, NotReported } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { HeadlineDelta } from "@/components/history/HeadlineDelta";
import { ShowMore } from "@/components/ui/show-more";
import { InfoTip, MetricLabel, SourceChip, Term } from "@/components/ui/info-tip";
import { Waffle } from "@/components/charts/Waffle";
import { Ring } from "@/components/charts/Ring";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { AdmissionFactors } from "@/components/school/AdmissionFactors";
import { ScoreChecker } from "@/components/school/ScoreChecker";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "admissions");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;

const TOPIC = "admissions";

/** Getting in: the funnel, yield, factors, the admissions map, and test scores. */
export default async function AdmissionsPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, history, counts, scores, rate, sat, yld, onMap } = p;
  const { citeField, distribution, landscapePoints, metricMedian, rankOf } = data;
  const { admissions: a } = school;
  const bySex = admissionsBySex(school);
  // Admission factor changes since the fall 2022 redesign, when both years use the same codes (lib/events.ts).
  const recentAdmissionChanges = history ? historyEvents(history.history).filter((e) => e.area === "admissions" && e.kind === "fall" && e.year > FACTOR_ERA) : [];
  const federalSat = citeField("admissions.sat_reading_25_75", school).isDefault && citeField("admissions.sat_math_25_75", school).isDefault;
  const federalAct = citeField("admissions.act_composite_25_75", school).isDefault;
  const sub = { sat: a.test_submission_rate_sat, act: a.test_submission_rate_act };
  const lowSubmission = sub.sat !== null && sub.act !== null && sub.sat < 0.5 && sub.act < 0.5;
  const acceptanceRank = rankOf(school, "acceptance");
  const mid = satMid(school);

  const items = [
    { id: "funnel", label: "The funnel" },
    { id: "yield", label: "Yield" },
    { id: "factors", label: "What they look at" },
    { id: "map", label: "Admissions map" },
    { id: "scores", label: "Test scores" },
    { id: "submitted", label: "Who submitted scores" },
  ];

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel
        level={1}
        domain="admissions"
        eyebrow="Admissions"
        title={a.year ? `Getting in, fall ${a.year}` : "Getting in"}
        takeaway={admissionsTakeaway(data, school)}
        delta={history && <HeadlineDelta seriesKey="acceptance_rate" history={history.history} files={history.files} color={DOMAINS.admissions.color} href={topicHref(school.unit_id, "history")} />}
        school={school}
        fields={TOPIC_FIELDS[TOPIC]}
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {counts ? (
            // Phones: the funnel says the same thing in a fifth of the height, so the waffle follows it, folded.
            <ShowMore label="Show out of every 100 applicants" hint="The funnel as 100 squares" className="max-lg:order-last">
              <Block title="Out of every 100 applicants…" className="h-full">
                <Waffle applicants={a.applicants!} admitted={a.admitted!} enrolled={a.enrolled!} />
              </Block>
            </ShowMore>
          ) : (
            <NotReported what="An applicant/admit/enroll breakdown" />
          )}
          <div className="flex flex-col gap-4">
            {counts && (
              <Block
                id="funnel"
                title={
                  <>
                    {/* Applied, admitted, and enrolled always come from the same report, so the heading carries the chip. */}
                    The funnel <SourceChip cited={citeField("admissions.applicants", school)} />
                  </>
                }
              >
                <div className="space-y-3">
                  {[
                    { label: "Applied", value: a.applicants!, term: "applicants" as const, field: "admissions.applicants" as const },
                    { label: "Admitted", value: a.admitted!, term: "admitted" as const, field: "admissions.admitted" as const },
                    { label: "Enrolled", value: a.enrolled!, term: "enrolled" as const, field: "admissions.enrolled" as const },
                  ].map((step, i) => (
                    <div key={step.label} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                      <MetricLabel term={step.term} cited={citeField(step.field, school)} chip={false} className="text-sm font-medium">
                        {step.label}
                      </MetricLabel>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-7 origin-left animate-grow-x rounded-lg"
                          style={{
                            width: `${Math.max(2, (step.value / a.applicants!) * 100) * 0.8}%`,
                            backgroundColor: `color-mix(in oklch, ${DOMAINS.admissions.color} ${100 - i * 30}%, transparent)`,
                            animationDelay: `${i * 120}ms`,
                          }}
                        />
                        <span className="text-sm font-bold tabular-nums">{num(step.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {bySex && !bySex.notable && (
                  <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                    {bySex.sentence} <SourceChip cited={citeField("admissions.by_sex", school)} />
                  </p>
                )}
                {a.application_fee != null && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                    <MetricLabel term="application-fee" cited={citeField("admissions.application_fee", school)} chip={false}>
                      {a.application_fee === 0 ? "No application fee" : `${money(a.application_fee)} to apply`}
                    </MetricLabel>
                    <SourceChip cited={citeField("admissions.application_fee", school)} />
                  </p>
                )}
                {a.accepts_ap_credit != null && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                    <MetricLabel term="ap-credit" cited={citeField("admissions.accepts_ap_credit", school)} chip={false}>
                      {a.accepts_ap_credit ? "Grants credit for AP exams" : "Doesn't list credit for AP exams"}
                    </MetricLabel>
                    <SourceChip cited={citeField("admissions.accepts_ap_credit", school)} />
                  </p>
                )}
              </Block>
            )}
            {bySex?.notable && (
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
                  Men and women <InfoTip term="admit-rate-by-sex" cited={citeField("admissions.by_sex", school)} />
                  <SourceChip cited={citeField("admissions.by_sex", school)} />
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">{bySex.sentence}</p>
                <div className="space-y-3">
                  {[
                    { label: "Women", v: bySex.women, field: "derived.admit_rate_women" as const },
                    { label: "Men", v: bySex.men, field: "derived.admit_rate_men" as const },
                  ].map((r) => (
                    <BenchmarkBar key={r.label} label={`${r.label} admitted`} cited={citeField(r.field, school)} value={r.v} scale={[0, 1]} format={pctSmart} color={DOMAINS.admissions.color} size="sm" />
                  ))}
                </div>
              </div>
            )}
            {yld !== null && (
              <Block id="yield" className="space-y-6">
                <div className="flex items-center gap-4">
                  <Ring value={yld} color={DOMAINS.admissions.color} size={88} stroke={10} label={`Yield ${pct(yld)}`}>
                    <span className="font-display text-lg font-extrabold">{pct(yld)}</span>
                  </Ring>
                  <div>
                    <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                      Yield <InfoTip term="yield" cited={citeField("derived.yield", school)} />
                      <SourceChip cited={citeField("derived.yield", school)} />
                    </h3>
                    <p className="text-sm text-muted-foreground">{yieldTakeaway(data, school)}</p>
                  </div>
                </div>
                <DistributionStrip label="Yield rate vs. every college" term="yield" dist={distribution("yield")} value={yld} rank={rankOf(school, "yield")} format="pct" color={DOMAINS.admissions.color} />
              </Block>
            )}
            {rate !== null && (
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <DistributionStrip
                  label="Acceptance rate vs. every college"
                  term="acceptance-rate"
                  dist={distribution("acceptance")}
                  value={rate}
                  rank={acceptanceRank === null ? null : 1 - acceptanceRank}
                  rankPhrase="more selective than"
                  format="pctSmart"
                  color={DOMAINS.admissions.color}
                  lowLabel="More selective"
                  highLabel="Less selective"
                />
              </div>
            )}
          </div>
        </div>
        {a.factors && (
          <div id="factors" className={`mt-4 ${BLOCK_SCROLL}`}>
            <AdmissionFactors school={school} />
          </div>
        )}
        {recentAdmissionChanges.length > 0 && (
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            <b className="text-foreground">Recent change:</b> {recentAdmissionChanges.map((e) => `${e.text} in ${eventYear(e)}`).join("; ")}.
          </p>
        )}
        <ShowMore id="map" label="Show the admissions map" hint="Acceptance rate vs. SAT for 300 colleges" className="mt-4">
          <Block title="On the admissions map">
            {onMap ? (
              <ScatterPlot focusId={school.unit_id} height={380} points={landscapePoints(undefined, 300, [school.unit_id])} x={LANDSCAPE_X} y={LANDSCAPE_Y} zone={LANDSCAPE_ZONE} />
            ) : (
              <p className="text-sm text-muted-foreground">
                The map plots acceptance rate against SAT scores. {school.name} doesn&apos;t report both, so it isn&apos;t shown.
              </p>
            )}
          </Block>
        </ShowMore>
      </Panel>

      {scores && (
        <Panel id="scores" domain="scores" eyebrow="Test scores" title="What admitted students scored" takeaway={scoresTakeaway(data, school)} fields={[]} className="mt-14 sm:mt-20">
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-3xl border bg-card p-4 sm:p-6">
              <ScoreChecker
                color={DOMAINS.scores.color}
                ranges={{
                  satTotal: sat,
                  satReading: a.sat_reading_25_75,
                  satMath: a.sat_math_25_75,
                  act: a.act_composite_25_75,
                  medianSatMid: metricMedian("sat"),
                  medianActMid: metricMedian("act"),
                  // Federal-only detail: shown only when the ranges are federal too (not a college's CDS).
                  actEnglish: federalAct ? a.act_english_25_75 : null,
                  actMath: federalAct ? a.act_math_25_75 : null,
                }}
                medians={{
                  satTotal: federalSat ? satMedian(school) : null,
                  satReading: federalSat ? (a.sat_reading_median ?? null) : null,
                  satMath: federalSat ? (a.sat_math_median ?? null) : null,
                  act: federalAct ? (a.act_composite_median ?? null) : null,
                }}
              />
            </div>
            <div className="flex flex-col gap-4">
              <Block
                id="submitted"
                className="flex-1"
                title={
                  <>
                    Who submitted scores? <InfoTip term="test-submission" cited={citeField("admissions.test_submission_rate_sat", school)} />
                    <SourceChip cited={citeField("admissions.test_submission_rate_sat", school)} />
                  </>
                }
              >
                {sub.sat === null && sub.act === null ? (
                  <p className="text-sm text-muted-foreground">Submission rates aren&apos;t reported.</p>
                ) : (
                  <div className="mt-1 flex justify-around gap-4">
                    {[
                      { label: "SAT", v: sub.sat },
                      { label: "ACT", v: sub.act },
                    ]
                      .filter((t): t is { label: string; v: number } => t.v !== null)
                      .map((t) => (
                        <div key={t.label} className="text-center">
                          <Ring value={t.v} color={DOMAINS.scores.color} size={96} stroke={10} label={`${t.label} submitted by ${pct(t.v)}`}>
                            <span className="font-display text-xl font-extrabold">{pct(t.v)}</span>
                          </Ring>
                          <p className="mt-2 text-xs font-semibold text-muted-foreground">submitted {t.label}</p>
                        </div>
                      ))}
                  </div>
                )}
                {lowSubmission ? (
                  <div
                    className="mt-5 flex gap-2.5 rounded-2xl border p-3 text-xs"
                    style={{
                      borderColor: "color-mix(in oklch, var(--warning) 50%, transparent)",
                      backgroundColor: "color-mix(in oklch, var(--warning) 10%, transparent)",
                    }}
                  >
                    <TriangleAlert className="size-4 shrink-0" style={{ color: "var(--warning)" }} />
                    <p>
                      <b>Read with care:</b> fewer than half of enrolled students submitted either test, so these ranges may run high. Learn about{" "}
                      <Term term="test-optional">test-optional</Term> admissions.
                    </p>
                  </div>
                ) : (
                  (sub.sat !== null || sub.act !== null) && (
                    <p className="mt-5 text-xs text-muted-foreground">At least half of students submitted a score, so the ranges are reasonably representative.</p>
                  )
                )}
              </Block>
              {mid !== null && (
                <div className="rounded-3xl border bg-card p-4 sm:p-6">
                  <DistributionStrip label="SAT midpoint vs. every college" term="sat" dist={distribution("sat")} value={mid} rank={rankOf(school, "sat")} format="int" color={DOMAINS.scores.color} />
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}
    </TopicPage>
  );
}
