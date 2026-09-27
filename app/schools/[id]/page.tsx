import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, MapPin, TriangleAlert } from "lucide-react";
import { distribution, getSchoolById, landscapePoints, metricMedian, rankOf, topBy } from "@/lib/data";
import {
  DOMAINS,
  TEST_POLICY_LABELS,
  diversityIndex,
  hasAdmissionCounts,
  hasTestScores,
  admitRatio,
  satComposite,
  satMid,
  selectivityTier,
  sizeBucket,
  yieldRate,
  type Domain,
} from "@/lib/metrics";
import {
  admissionsTakeaway,
  scoresTakeaway,
  similarSchools,
  standouts,
  studentsTakeaway,
  yieldTakeaway,
} from "@/lib/insights";
import { compact, num, pct, pctSmart, range, typeLabel } from "@/lib/format";
import type { TermKey } from "@/lib/glossary";
import { crestTint } from "@/lib/brand";
import { Crest } from "@/components/school/Crest";
import { StandoutChip } from "@/components/school/StandoutChip";
import { SectionNav } from "@/components/school/SectionNav";
import { ScoreChecker } from "@/components/school/ScoreChecker";
import { CompareButton } from "@/components/compare/CompareButton";
import { Ring } from "@/components/charts/Ring";
import { Waffle } from "@/components/charts/Waffle";
import { RangeBar } from "@/components/charts/RangeBar";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { StackedBar } from "@/components/charts/StackedBar";
import { DistributionStrip } from "@/components/charts/DistributionStrip";
import { LandscapeScatter } from "@/components/charts/LandscapeScatter";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const school = getSchoolById(id);
  return { title: school ? school.name : "School not found" };
}

/** Pre-render the most-applied-to profiles; the rest render on first visit and are cached. */
export function generateStaticParams() {
  return topBy("applicants", "desc", 50).map((s) => ({ id: s.unit_id }));
}

/* ------------------------------------------------------------------ */

function Panel({
  id,
  domain,
  eyebrow,
  title,
  takeaway,
  children,
}: {
  id: string;
  domain?: Domain;
  eyebrow: string;
  title: string;
  takeaway?: string;
  children: ReactNode;
}) {
  const color = domain ? DOMAINS[domain].color : "var(--primary)";
  return (
    <section id={id} className="scroll-mt-36">
      <p className="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase" style={{ color }}>
        <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-foreground/70">{eyebrow}</span>
      </p>
      <h2 className="font-display text-3xl font-extrabold tracking-tight">{title}</h2>
      {takeaway && <p className="mt-2 max-w-3xl text-lg text-muted-foreground">{takeaway}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Tile({
  label,
  term,
  children,
  className,
}: {
  label: string;
  term?: TermKey;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col rounded-3xl border bg-card p-5 ${className ?? ""}`}>
      <MetricLabel term={term} className="text-xs font-semibold text-muted-foreground">
        {label}
      </MetricLabel>
      <div className="mt-3 flex flex-1 flex-col justify-between gap-3">{children}</div>
    </div>
  );
}

function NotReported({ what }: { what: string }) {
  return (
    <div className="rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">
      {what} isn&apos;t reported for this college.
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default async function SchoolPage({ params }: Props) {
  const { id } = await params;
  const school = getSchoolById(id);
  if (!school) notFound();

  const { admissions: a, demographics: d } = school;
  const rate = a.acceptance_rate;
  const tier = selectivityTier(rate);
  const size = sizeBucket(d.undergrad_enrollment);
  const tags = standouts(school);
  const similar = similarSchools(school, 4);
  const sat = satComposite(school);
  const yld = yieldRate(school);
  const div = diversityIndex(school);
  const counts = hasAdmissionCounts(school);
  const scores = hasTestScores(school);
  const onMap = rate !== null && satMid(school) !== null;
  const sub = { sat: a.test_submission_rate_sat, act: a.test_submission_rate_act };
  const lowSubmission = sub.sat !== null && sub.act !== null && sub.sat < 0.5 && sub.act < 0.5;
  const acceptanceRank = rankOf(school, "acceptance");
  const policy = a.test_policy ? TEST_POLICY_LABELS[a.test_policy] : null;

  const sections = [
    { id: "overview", label: "Overview" },
    ...(rate !== null || counts ? [{ id: "admissions", label: "Admissions", color: DOMAINS.admissions.color }] : []),
    ...(scores ? [{ id: "scores", label: "Test scores", color: DOMAINS.scores.color }] : []),
    { id: "students", label: "Students", color: DOMAINS.access.color },
    { id: "ranks", label: "How it ranks" },
    { id: "similar", label: "Similar schools" },
  ];

  return (
    <div>
      {/* ============================== HERO ============================== */}
      <section className="relative isolate overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(ellipse 80% 90% at 15% 0%, ${crestTint(school.unit_id, 0.35)}, transparent 70%)` }}
        />
        <div className="absolute inset-0 -z-10 bg-dots opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-10 sm:px-6 sm:pt-8">
          <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/explore" className="hover:text-foreground">Explore</Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <Link href={`/explore?states=${school.location.state}`} className="hover:text-foreground">
              {school.location.state}
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{school.name}</span>
          </nav>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <Crest id={school.unit_id} name={school.name} size="xl" className="animate-pop-in shadow-xl" />
            <div className="min-w-0 flex-1">
              <h1 className="animate-rise font-display text-4xl leading-[1.02] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                {school.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" /> {school.location.city}, {school.location.state} · {school.location.region}
                </span>
                <Term term={school.type}>{typeLabel(school.type)}</Term>
                <Term term="size-tier">{size.label} campus</Term>
                {policy && <Term term="test-policy">{policy}</Term>}
              </div>
            </div>
            <CompareButton id={school.unit_id} variant="large" className="self-start sm:self-end" />
          </div>

          {tags.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Known for</span>
              {tags.map((t) => (
                <StandoutChip key={t.label} standout={t} size="md" />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionNav sections={sections} />

        <div className="space-y-20 pt-10 sm:space-y-24">
          {/* ============================== OVERVIEW ============================== */}
          <section id="overview" className="scroll-mt-36" aria-label="At a glance">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Tile label="Acceptance rate" term="acceptance-rate" className="col-span-2 lg:col-span-1 lg:row-span-2">
                {rate !== null ? (
                  <div className="flex items-center gap-4 lg:flex-col lg:items-start">
                    <Ring value={rate} color={DOMAINS.admissions.color} size={112} stroke={12} label={`Acceptance rate ${pctSmart(rate)}`}>
                      <span className="font-display text-2xl font-extrabold">{pctSmart(rate)}</span>
                    </Ring>
                    <div>
                      <p className="font-display text-3xl font-extrabold">{admitRatio(school)}</p>
                      <p className="text-sm text-muted-foreground">applicants admitted</p>
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAINS.admissions.color }} />
                        {tier.label}
                        <InfoTip term="selectivity" />
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="font-display text-2xl font-extrabold text-muted-foreground">Not reported</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Usually means <Term term="open-admission">open admission</Term>: most applicants are accepted.
                    </p>
                  </div>
                )}
              </Tile>
              {sat && (
                <Tile label="SAT middle 50%" term="middle-50">
                  <p className="font-display text-2xl font-extrabold whitespace-nowrap sm:text-3xl">{range(sat)}</p>
                  <RangeBar low={sat[0]} high={sat[1]} scale={[400, 1600]} color={DOMAINS.scores.color} medianMid={metricMedian("sat") ?? undefined} compact />
                </Tile>
              )}
              {a.act_composite_25_75 && (
                <Tile label="ACT middle 50%" term="act">
                  <p className="font-display text-2xl font-extrabold whitespace-nowrap sm:text-3xl">{range(a.act_composite_25_75)}</p>
                  <RangeBar
                    low={a.act_composite_25_75[0]}
                    high={a.act_composite_25_75[1]}
                    scale={[1, 36]}
                    color={DOMAINS.scores.color}
                    medianMid={metricMedian("act") ?? undefined}
                    compact
                  />
                </Tile>
              )}
              <Tile label="Undergrads" term="undergrad-enrollment">
                <p className="font-display text-3xl font-extrabold">{compact(d.undergrad_enrollment)}</p>
                <p className="text-xs text-muted-foreground">
                  Larger than <b className="text-foreground">{pct(rankOf(school, "enrollment") ?? 0)}</b> of colleges
                </p>
              </Tile>
              {yld !== null && (
                <Tile label="Yield rate" term="yield">
                  <div className="flex items-center gap-3">
                    <Ring value={yld} color={DOMAINS.admissions.color} size={56} stroke={7} label={`Yield ${pct(yld)}`}>
                      <span className="text-xs font-bold">{pct(yld)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">of admitted students enroll</p>
                  </div>
                </Tile>
              )}
              {d.pell_grant_percent !== null && (
                <Tile label="Pell Grant recipients" term="pell-grant">
                  <div className="flex items-center gap-3">
                    <Ring value={d.pell_grant_percent} color={DOMAINS.access.color} size={56} stroke={7} label={`Pell ${pct(d.pell_grant_percent)}`}>
                      <span className="text-xs font-bold">{pct(d.pell_grant_percent)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">receive need-based federal grants</p>
                  </div>
                </Tile>
              )}
              {div !== null && d.racial_diversity && (
                <Tile label="Diversity index" term="diversity-index">
                  <p className="font-display text-3xl font-extrabold">{div.toFixed(2)}</p>
                  <StackedBar data={d.racial_diversity} height="h-2.5" showLegend={false} />
                </Tile>
              )}
            </div>
          </section>

          {/* ============================== ADMISSIONS ============================== */}
          {(rate !== null || counts) && (
            <Panel
              id="admissions"
              domain="admissions"
              eyebrow="Admissions"
              title={a.year ? `Getting in, fall ${a.year}` : "Getting in"}
              takeaway={admissionsTakeaway(school)}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                {counts ? (
                  <div className="rounded-3xl border bg-card p-5 sm:p-6">
                    <h3 className="mb-4 font-display text-lg font-bold">Out of every 100 applicants…</h3>
                    <Waffle applicants={a.applicants!} admitted={a.admitted!} enrolled={a.enrolled!} />
                  </div>
                ) : (
                  <NotReported what="An applicant/admit/enroll breakdown" />
                )}
                <div className="flex flex-col gap-4">
                  {counts && (
                    <div className="rounded-3xl border bg-card p-5 sm:p-6">
                      <h3 className="mb-4 font-display text-lg font-bold">The funnel</h3>
                      <div className="space-y-3">
                        {[
                          { label: "Applied", value: a.applicants!, term: "applicants" as const },
                          { label: "Admitted", value: a.admitted!, term: "admitted" as const },
                          { label: "Enrolled", value: a.enrolled!, term: "enrolled" as const },
                        ].map((step, i) => (
                          <div key={step.label} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                            <MetricLabel term={step.term} className="text-sm font-medium">
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
                    </div>
                  )}
                  {yld !== null && (
                    <div className="flex items-center gap-4 rounded-3xl border bg-card p-5 sm:p-6">
                      <Ring value={yld} color={DOMAINS.admissions.color} size={88} stroke={10} label={`Yield ${pct(yld)}`}>
                        <span className="font-display text-lg font-extrabold">{pct(yld)}</span>
                      </Ring>
                      <div>
                        <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                          Yield <InfoTip term="yield" />
                        </h3>
                        <p className="text-sm text-muted-foreground">{yieldTakeaway(school)}</p>
                      </div>
                    </div>
                  )}
                  {rate !== null && (
                    <div className="rounded-3xl border bg-card p-5 sm:p-6">
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
            </Panel>
          )}

          {/* ============================== TEST SCORES ============================== */}
          {scores && (
            <Panel id="scores" domain="scores" eyebrow="Test scores" title="What admitted students scored" takeaway={scoresTakeaway(school)}>
              <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                <div className="rounded-3xl border bg-card p-5 sm:p-6">
                  <ScoreChecker
                    color={DOMAINS.scores.color}
                    ranges={{
                      satTotal: sat,
                      satReading: a.sat_reading_25_75,
                      satMath: a.sat_math_25_75,
                      act: a.act_composite_25_75,
                      medianSatMid: metricMedian("sat"),
                      medianActMid: metricMedian("act"),
                    }}
                  />
                </div>
                <div className="rounded-3xl border bg-card p-5 sm:p-6">
                  <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                    Who submitted scores? <InfoTip term="test-submission" />
                  </h3>
                  {sub.sat === null && sub.act === null ? (
                    <p className="mt-4 text-sm text-muted-foreground">Submission rates aren&apos;t reported.</p>
                  ) : (
                    <div className="mt-5 flex justify-around gap-4">
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
                        <b>Read with care:</b> fewer than half of enrolled students submitted either test, so these ranges
                        may run high. Learn about <Term term="test-optional">test-optional</Term> admissions.
                      </p>
                    </div>
                  ) : (
                    (sub.sat !== null || sub.act !== null) && (
                      <p className="mt-5 text-xs text-muted-foreground">
                        At least half of students submitted a score, so the ranges are reasonably representative.
                      </p>
                    )
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* ============================== STUDENTS ============================== */}
          <Panel id="students" domain="access" eyebrow="Students" title="Who's on campus" takeaway={studentsTakeaway(school)}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border bg-card p-5 sm:p-6 lg:col-span-2">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                    Race & ethnicity <InfoTip term="race-ethnicity" />
                  </h3>
                  {div !== null && (
                    <p className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">Diversity index</span>
                      <b>{div.toFixed(2)}</b>
                      <InfoTip term="diversity-index" />
                    </p>
                  )}
                </div>
                {d.racial_diversity ? (
                  <StackedBar data={d.racial_diversity} label={`${school.name} race and ethnicity`} />
                ) : (
                  <p className="text-sm text-muted-foreground">Not reported.</p>
                )}
              </div>
              <div className="space-y-6 rounded-3xl border bg-card p-5 sm:p-6">
                <h3 className="font-display text-lg font-bold">Economic access</h3>
                {d.pell_grant_percent !== null ? (
                  <BenchmarkBar
                    label="Pell Grant recipients"
                    term="pell-grant"
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
                    value={d.first_gen_percent}
                    median={metricMedian("firstGen") ?? undefined}
                    scale={[0, 1]}
                    format={(v) => pct(v)}
                    color={DOMAINS.access.color}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">First-generation share not reported.</p>
                )}
              </div>
              <div className="space-y-6 rounded-3xl border bg-card p-5 sm:p-6">
                <h3 className="font-display text-lg font-bold">Campus size</h3>
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
              </div>
            </div>
          </Panel>

          {/* ============================== RANKS ============================== */}
          <Panel id="ranks" eyebrow="Context" title="How it ranks nationally">
            <p className="-mt-3 mb-6 flex items-center gap-1 text-sm text-muted-foreground">
              Each chart shows every college that reports the measure; the pin marks {school.name}.
              <InfoTip term="percentile-rank" />
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-8 rounded-3xl border bg-card p-5 sm:p-6">
                <DistributionStrip label="SAT midpoint" term="sat" dist={distribution("sat")} value={satMid(school)} rank={rankOf(school, "sat")} format="int" color={DOMAINS.scores.color} />
                <DistributionStrip label="Yield rate" term="yield" dist={distribution("yield")} value={yld} rank={rankOf(school, "yield")} format="pct" color={DOMAINS.admissions.color} />
                <DistributionStrip label="Pell Grant share" term="pell-grant" dist={distribution("pell")} value={d.pell_grant_percent} rank={rankOf(school, "pell")} format="pct" color={DOMAINS.access.color} />
                <DistributionStrip label="Diversity index" term="diversity-index" dist={distribution("diversity")} value={div} rank={rankOf(school, "diversity")} format="fixed2" color={DOMAINS.diversity.color} />
              </div>
              <div className="rounded-3xl border bg-card p-5 sm:p-6">
                <h3 className="mb-3 font-display text-lg font-bold">On the admissions map</h3>
                {onMap ? (
                  <LandscapeScatter focusId={school.unit_id} height={380} points={landscapePoints(undefined, 300, [school.unit_id])} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The map plots acceptance rate against SAT scores. {school.name} doesn&apos;t report both, so it isn&apos;t shown.
                  </p>
                )}
              </div>
            </div>
          </Panel>

          {/* ============================== SIMILAR ============================== */}
          <Panel id="similar" eyebrow="Keep exploring" title="Schools like this one">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {similar.map(({ school: s, reasons }) => (
                <div key={s.unit_id} className="group relative flex flex-col rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10">
                  <Link href={`/schools/${s.unit_id}`} className="absolute inset-0 z-10 rounded-3xl" aria-label={s.name} />
                  <div className="flex items-start justify-between gap-2">
                    <Crest id={s.unit_id} name={s.name} size="md" />
                    <CompareButton id={s.unit_id} variant="icon" />
                  </div>
                  <p className="mt-3 font-display font-bold group-hover:text-primary">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      s.admissions.acceptance_rate !== null && `${pctSmart(s.admissions.acceptance_rate)} admit`,
                      satMid(s) !== null && `SAT ${satMid(s)}`,
                      `${compact(s.demographics.undergrad_enrollment)} undergrads`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {reasons.map((r) => (
                      <span key={r} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        {r}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={`/compare?ids=${school.unit_id},${s.unit_id}`}
                    className="relative z-20 mt-4 inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline"
                  >
                    Compare side-by-side <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-10 text-center text-xs text-muted-foreground">
              Sources: {(school.sources ?? ["College Scorecard"]).join(" · ")}. IPEDS unit ID {school.unit_id}. National
              comparisons include every 4-year college that reports the measure.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
