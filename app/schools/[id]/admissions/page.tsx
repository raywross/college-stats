import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS, topicHref } from "@/lib/profile-topics";
import { DOMAINS, satMid } from "@/lib/metrics";
import { admissionsTakeaway, admissionsBySex, scoresTakeaway, yieldTakeaway } from "@/lib/insights";
import { money, num, pct, pctSmart } from "@/lib/format";
import { eventYear, historyEvents } from "@/lib/events";
import { FACTOR_ERA } from "@/lib/derive";
import { LANDSCAPE_X, LANDSCAPE_Y, LANDSCAPE_ZONE } from "@/lib/chart-configs";
import { BLOCK_SCROLL, Panel, Block, NotReported } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { HeadlineDelta } from "@/components/history/HeadlineDelta";
import { ShowMore } from "@/components/ui/show-more";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";
import { Waffle } from "@/components/charts/Waffle";
import { Ring } from "@/components/charts/Ring";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { AdmissionFactors } from "@/components/school/AdmissionFactors";
import { ReadingTheRecord } from "@/components/school/ReadingTheRecord";
import { readingWithMajor } from "@/lib/chances/reading-major";
import { shortName } from "@/lib/brand";
import { ScoreCheckerWithProfile as ScoreChecker } from "@/components/me/ScoreCheckerWithProfile";
import { ResidencyAdmissions } from "@/components/school/ResidencyAdmissions";
import { publishesResidencyRates } from "@/lib/cds/residency-display";
import { WaitListLine } from "@/components/school/WaitListLine";
import { EarlyRounds } from "@/components/school/EarlyRounds";
import { GpaPanel } from "@/components/school/GpaPanel";
import { admissionProfile } from "@/lib/cds/admissions";
import { ScoreBands } from "@/components/school/ScoreBands";
import { TestPolicyBlock } from "@/components/school/TestPolicyBlock";
import { lineageFall, satTotalMedian } from "@/lib/score-bands";
import { changesRequirement, policyEventText } from "@/lib/test-policy";
import type { BandTest } from "@/lib/types";
import { TransferringInCard } from "@/components/school/TransferringInCard";
import { transferCard } from "@/lib/cds/transfer-display";
import { ApplyingBox } from "@/components/school/ApplyingBox";
import { HsPrepBox } from "@/components/school/HsPrepBox";
import { applyingLines, feeWaiverSentence, showsHsPrep } from "@/lib/cds/application-logistics-display";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "admissions");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;
// An empty list makes Next render each college's page on first visit and keep it (ISR); without it the route is
// dynamic on every request (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export async function generateStaticParams() {
  return [];
}

const TOPIC = "admissions";

/** Getting in: the funnel, yield, factors, the admissions map, and test scores. */
export default async function AdmissionsPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, history, counts, scores, rate, sat, yld, onMap } = p;
  const { citeField, distribution, landscapePoints, metricMedian, rankOf } = data;
  const { admissions: a } = school;
  const bySex = admissionsBySex(school);
  // The 100-square waffle needs all three counts (`counts`, lib/metrics.ts hasAdmissionCounts); the funnel rows
  // below show whichever of applicants/admitted/enrolled this college has published, since a class profile may
  // give only two of them.
  const funnelRows = a.applicants !== null || a.admitted !== null || a.enrolled !== null;
  // The bars are sized relative to applicants when known, else the largest figure present.
  const funnelDenom = a.applicants ?? (Math.max(a.admitted ?? 0, a.enrolled ?? 0) || 1);
  // Admission factor changes since the fall 2022 redesign, when both years use the same codes (lib/events.ts).
  const recentAdmissionChanges = history ? historyEvents(history.history).filter((e) => e.area === "admissions" && e.kind === "fall" && e.year > FACTOR_ERA) : [];
  // Test policy and C9 detail (specs/data-expansion/cds-test-scores-and-policy.md). The SAT and ACT blocks are never
  // mixed (a newer CDS replaces a whole block), so medians and section ranges are shown whatever their source.
  const tests = school.reported?.tests ?? null;
  const policyEvents = school.reported?.test_policy_events ?? [];
  const newestCycle = school.reported?.test_policy?.cycle ?? null;
  const recentPolicyEvents = newestCycle === null ? [] : policyEvents.filter((e) => e.cycle > newestCycle - 3);
  const satCited = citeField("admissions.sat_reading_25_75", school);
  const scoresFall = lineageFall(satCited.year);
  const scoresBeforeChange = scoresFall !== null && policyEvents.some((e) => changesRequirement(e) && e.cycle > scoresFall);
  const bandCited = Object.fromEntries(
    (["sat_composite", "act_composite", "sat_ebrw", "sat_math", "act_english", "act_math"] as const).map((k) => [k, citeField(`reported.tests.bands.${k}`, school)])
  ) as Record<BandTest, ReturnType<typeof citeField>>;
  // Counts only beside a share from the same class (the share's lineage year is the CDS class's).
  const sameClass = (path: "admissions.test_submission_rate_sat" | "admissions.test_submission_rate_act") => tests !== null && lineageFall(citeField(path, school).year) === tests.year;
  const submitted = {
    sat: sameClass("admissions.test_submission_rate_sat") ? (tests?.sat_submitters ?? null) : null,
    act: sameClass("admissions.test_submission_rate_act") ? (tests?.act_submitters ?? null) : null,
  };
  const sub ={ sat: a.test_submission_rate_sat, act: a.test_submission_rate_act };
  const lowSubmission = sub.sat !== null && sub.act !== null && sub.sat < 0.5 && sub.act < 0.5;
  const acceptanceRank = rankOf(school, "acceptance");
  const mid = satMid(school);
  // The year named in the eyebrow: the applicants count's lineage year, or the rate's when there are no counts.
  const headlineYear = citeField(a.applicants !== null ? "admissions.applicants" : "admissions.acceptance_rate", school).year;

  // The college's own CDS: early rounds, factor weights, GPA and class rank (specs/data-expansion/cds-admissions.md).
  const cdsProfile = admissionProfile(school);
  const ed = cdsProfile?.early_decision;
  const ea = cdsProfile?.early_action;
  const hasEarly = !!(ed?.offered || ea?.offered || (ed?.offered === false && ea?.offered === false));
  const hasGpa = !!(cdsProfile?.gpa || cdsProfile?.class_rank);
  // How this college reads a record (specs/chances/how-colleges-read.md): first under "What they look at".
  const reading = readingWithMajor(school, { name: shortName(school) });

  const items = [
    { id: "funnel", label: "The funnel" },
    ...(publishesResidencyRates(school) ? [{ id: "residency", label: "Where applicants live" }] : []),
    { id: "yield", label: "Yield" },
    ...(hasEarly ? [{ id: "early", label: "Applying early" }] : []),
    { id: "factors", label: "What they look at" },
    ...(transferCard(school) ? [{ id: "transfer", label: "Transferring in" }] : []),
    ...(applyingLines(school).length ? [{ id: "applying", label: "Applying" }] : []),
    ...(showsHsPrep(school) ? [{ id: "hs-prep", label: "What you'll need in high school" }] : []),
    { id: "map", label: "Admissions map" },
    ...(hasGpa ? [{ id: "gpa", label: "High school GPA" }] : []),
    { id: "scores", label: "Test scores" },
    { id: "submitted", label: "Who submitted scores" },
  ];

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel
        level={1}
        domain="admissions"
        eyebrow="Admissions"
        title={headlineYear ? `Getting in, ${headlineYear.toLowerCase()}` : "Getting in"}
        takeaway={admissionsTakeaway(data, school)}
        delta={history && <HeadlineDelta seriesKey="acceptance_rate" history={history.history} files={history.files} color={DOMAINS.admissions.color} href={topicHref(school.unit_id, "history")} />}
        school={school}
        fields={TOPIC_FIELDS[TOPIC]}
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {counts ? (
            // Below lg: the funnel says the same thing in a fifth of the height, so the waffle follows it, folded (it sits beside the funnel from lg).
            <ShowMore until="lg" label="Show out of every 100 applicants" hint="The funnel as 100 squares" className="max-lg:order-last">
              <Block title="Out of every 100 applicants…" className="h-full">
                <Waffle applicants={a.applicants!} admitted={a.admitted!} enrolled={a.enrolled!} />
              </Block>
            </ShowMore>
          ) : (
            <NotReported what="An applicant/admit/enroll breakdown" />
          )}
          <div className="flex flex-col gap-4">
            {funnelRows && (
              <Block id="funnel" title="The funnel">
                <div className="space-y-3">
                  {(
                    [
                      { label: "Applied", value: a.applicants, term: "applicants" as const, field: "admissions.applicants" as const },
                      { label: "Admitted", value: a.admitted, term: "admitted" as const, field: "admissions.admitted" as const },
                      { label: "Enrolled", value: a.enrolled, term: "enrolled" as const, field: "admissions.enrolled" as const },
                    ] satisfies { label: string; value: number | null; term: "applicants" | "admitted" | "enrolled"; field: "admissions.applicants" | "admissions.admitted" | "admissions.enrolled" }[]
                  )
                    .filter((step): step is typeof step & { value: number } => step.value !== null)
                    .map((step, i) => (
                    <div key={step.label} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                      <MetricLabel term={step.term} cited={citeField(step.field, school)} className="text-sm font-medium">
                        {step.label}
                      </MetricLabel>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-7 origin-left animate-grow-x rounded-lg"
                          style={{
                            width: `${Math.max(2, (step.value / funnelDenom) * 100) * 0.8}%`,
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
                  <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">{bySex.sentence}</p>
                )}
                <ResidencyAdmissions id="residency" variant="line" school={school} cite={citeField} color={DOMAINS.admissions.color} />
                {a.application_fee != null && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                    <MetricLabel term="application-fee" cited={citeField("admissions.application_fee", school)}>
                      {a.application_fee === 0 ? "No application fee" : `${money(a.application_fee)} to apply`}
                    </MetricLabel>
                  </p>
                )}
                {a.application_fee != null && a.application_fee !== 0 && feeWaiverSentence(school.reported?.admissions_logistics) && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                    <MetricLabel cited={citeField("reported.admissions_logistics.fee", school)}>{feeWaiverSentence(school.reported?.admissions_logistics)}</MetricLabel>
                  </p>
                )}
                {a.accepts_ap_credit != null && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                    <MetricLabel term="ap-credit" cited={citeField("admissions.accepts_ap_credit", school)}>
                      {a.accepts_ap_credit ? "Grants credit for AP exams" : "Doesn't list credit for AP exams"}
                    </MetricLabel>
                  </p>
                )}
              </Block>
            )}
            {bySex?.notable && (
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
                  Men and women <InfoTip term="admit-rate-by-sex" cited={citeField("admissions.by_sex", school)} />
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
            <ResidencyAdmissions id="residency" variant="card" school={school} cite={citeField} color={DOMAINS.admissions.color} />
            {yld !== null && (
              <Block id="yield" className="space-y-6">
                <div className="flex items-center gap-4">
                  <Ring value={yld} color={DOMAINS.admissions.color} size={88} stroke={10} label={`Yield ${pct(yld)}`}>
                    <span className="font-display text-lg font-extrabold">{pct(yld)}</span>
                  </Ring>
                  <div>
                    <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                      Yield <InfoTip term="yield" cited={citeField("derived.yield", school)} />
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
        <WaitListLine school={school} />
        {hasEarly && (
          <div className="mt-4">
            <EarlyRounds school={school} id="early" />
          </div>
        )}
        {(a.factors || cdsProfile?.factors || reading) && (
          <div id="factors" className={`mt-4 ${BLOCK_SCROLL}`}>
            {reading && <ReadingTheRecord school={school} block={reading} className="mb-4" />}
            {(a.factors || cdsProfile?.factors) && <AdmissionFactors school={school} />}
          </div>
        )}
        <TransferringInCard id="transfer" className="mt-4" school={school} cite={citeField} color={DOMAINS.admissions.color} />
        {(applyingLines(school).length > 0 || showsHsPrep(school)) && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ApplyingBox id="applying" school={school} cite={citeField} />
            <HsPrepBox id="hs-prep" school={school} cite={citeField} />
          </div>
        )}
        {recentAdmissionChanges.length > 0 && (
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            <b className="text-foreground">Recent change:</b> {recentAdmissionChanges.map((e) => `${e.text} in ${eventYear(e)}`).join("; ")}.
          </p>
        )}
        {recentPolicyEvents.length > 0 && (
          <p className="mt-3 flex max-w-3xl flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
            <b className="text-foreground">Recent change:</b> {recentPolicyEvents.map(policyEventText).join("; ")}.
            <InfoTip term="test-policy" cited={citeField("reported.test_policy_events", school)} />
          </p>
        )}
        <ShowMore id="map" until="lg" label="Show the admissions map" hint="Acceptance rate vs. SAT for 300 colleges" className="mt-4">
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

      <GpaPanel school={school} id="gpa" />

      {(scores || a.test_policy) && (
        <Panel id="scores" domain="scores" eyebrow="Test scores" title="What enrolled first-years scored" takeaway={scoresTakeaway(data, school)} fields={[]} className="mt-14 sm:mt-20">
          <div className="mb-4 rounded-3xl border bg-card p-4 sm:p-6">
            <TestPolicyBlock
              policy={a.test_policy}
              reported={school.reported?.test_policy}
              note={school.reported?.test_policy_note}
              cited={citeField("admissions.test_policy", school)}
              noteCited={citeField("reported.test_policy_note", school)}
            />
          </div>
          {scores && (
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
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
                  actEnglish: a.act_english_25_75,
                  actMath: a.act_math_25_75,
                  // ACT Reading and Science come only from the CDS class the ACT block came from.
                  actReading: sameClass("admissions.test_submission_rate_act") && tests?.act_reading?.p25 != null && tests.act_reading.p75 != null ? [tests.act_reading.p25, tests.act_reading.p75] : null,
                  actScience: sameClass("admissions.test_submission_rate_act") && tests?.act_science?.p25 != null && tests.act_science.p75 != null ? [tests.act_science.p25, tests.act_science.p75] : null,
                }}
                medians={{
                  satTotal: satTotalMedian(school),
                  satReading: a.sat_reading_median ?? null,
                  satMath: a.sat_math_median ?? null,
                  act: a.act_composite_median ?? null,
                }}
                bands={
                  tests
                    ? { sat: sameClass("admissions.test_submission_rate_sat") ? tests.bands.sat_composite : null, act: sameClass("admissions.test_submission_rate_act") ? tests.bands.act_composite : null }
                    : null
                }
              />
              {scoresBeforeChange && scoresFall !== null && (
                <p className="mt-4 text-xs text-muted-foreground">These scores are from the class that entered in fall {scoresFall}, before the change.</p>
              )}
            </div>
            {tests && (sameClass("admissions.test_submission_rate_sat") || sameClass("admissions.test_submission_rate_act")) && (
              <Block
                id="bands"
                title={
                  <>
                    Score bands <InfoTip term="score-bands" cited={bandCited.sat_composite} />
                  </>
                }
              >
                <ScoreBands tests={tests} enrolled={a.enrolled} cited={bandCited} color={DOMAINS.scores.color} />
              </Block>
            )}
            </div>
            {/* Tablets: the two small blocks side by side under the score checker. */}
            <div className={mid !== null ? "grid gap-4 md:max-lg:grid-cols-2 lg:flex lg:flex-col" : "flex flex-col gap-4"}>
              <Block
                id="submitted"
                className="flex-1"
                title={
                  <>
                    Who submitted scores? <InfoTip term="test-submission" cited={citeField("admissions.test_submission_rate_sat", school)} />
                  </>
                }
              >
                {sub.sat === null && sub.act === null ? (
                  <p className="text-sm text-muted-foreground">Submission rates aren&apos;t reported.</p>
                ) : (
                  <div className="mt-1 flex justify-around gap-4">
                    {[
                      { label: "SAT", v: sub.sat, n: submitted.sat, field: "reported.tests.sat_submitters" as const },
                      { label: "ACT", v: sub.act, n: submitted.act, field: "reported.tests.act_submitters" as const },
                    ]
                      .filter((t): t is typeof t & { v: number } => t.v !== null)
                      .map((t) => (
                        <div key={t.label} className="text-center">
                          <Ring value={t.v} color={DOMAINS.scores.color} size={96} stroke={10} label={`${t.label} submitted by ${pct(t.v)}`}>
                            <span className="font-display text-xl font-extrabold">{pct(t.v)}</span>
                          </Ring>
                          <p className="mt-2 text-xs font-semibold text-muted-foreground">submitted {t.label}</p>
                          {t.n !== null && (
                            <MetricLabel term="test-submission" cited={citeField(t.field, school)} className="text-xs text-muted-foreground tabular-nums">
                              {num(t.n)} students
                            </MetricLabel>
                          )}
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
          )}
        </Panel>
      )}
    </TopicPage>
  );
}
