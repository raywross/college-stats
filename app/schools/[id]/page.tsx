import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { getData } from "@/lib/data";
import { loadProfile } from "@/lib/profile-data";
import { OVERVIEW_FIELDS, PROFILE_FIELDS, topicHref } from "@/lib/profile-topics";
import { DOMAINS, TEST_POLICY_LABELS, admitRatio, aidGenerosity, generosityTier, satMid, selectivityTier, sizeBucket } from "@/lib/metrics";
import { similarSchools, standouts } from "@/lib/insights";
import { compact, moneyCompact, pct, pctSmart, range, typeLabel } from "@/lib/format";
import { SourceList, SourceNote } from "@/components/sources/SourceNote";
import { crestTint } from "@/lib/brand";
import { Crest } from "@/components/school/Crest";
import { StandoutChip } from "@/components/school/StandoutChip";
import { CompareButton } from "@/components/compare/CompareButton";
import { Ring } from "@/components/charts/Ring";
import { RangeBar } from "@/components/charts/RangeBar";
import { scoreScale } from "@/lib/score-scale";
import { StackedBar } from "@/components/charts/StackedBar";
import { DESIGNATION_LABELS, DESIGNATION_TERMS, SETTING_SHORT, designationsOf } from "@/lib/campus-profile";
import { InfoTip, Term } from "@/components/ui/info-tip";
import { ShowMore } from "@/components/ui/show-more";
import { TenYearTile } from "@/components/history/TenYearTile";
import { TrendIndicatorStrip } from "@/components/trends/TrendIndicators";
import { Panel } from "@/components/profile/Panel";
import { Tile } from "@/components/profile/Tile";
import { SourceExceptions } from "@/components/profile/SourceExceptions";
import { TopicLinks } from "@/components/profile/TopicLinks";
import { AnchorRedirect } from "@/components/profile/AnchorRedirect";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const school = (await getData()).getSchoolById(id);
  return { title: school ? school.name : "School not found" };
}

// Publishes regenerate profiles on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

/** Pre-render the most-applied-to profiles; the rest render on first visit and are cached. */
export async function generateStaticParams() {
  const { topBy } = await getData();
  return topBy("applicants", "desc", 50).map((s) => ({ id: s.unit_id }));
}

/* ------------------------------------------------------------------ */

/**
 * The profile overview (specs/profile-redesign.md): hero, the at-a-glance tiles, links to the topic pages, and
 * similar schools. The detail lives on the six topic pages under this route.
 */
export default async function SchoolPage({ params }: Props) {
  const { id } = await params;
  const p = await loadProfile(id);
  if (!p) notFound();
  const { data, school, history, rate, sat, yld, div, avgCost, earnings, grad, ratio, ratioVs } = p;
  const { metricMedian, rankOf } = data;
  const { admissions: a, demographics: d } = school;
  const tier = selectivityTier(rate);
  const size = sizeBucket(d.undergrad_enrollment);
  const tags = standouts(data, school, { trends: true });
  const similar = similarSchools(data, school, 4);
  const designations = designationsOf(school);
  const policy = a.test_policy ? TEST_POLICY_LABELS[a.test_policy] : null;
  const historyHref = topicHref(school.unit_id, "history");

  return (
    <div>
      <AnchorRedirect unitId={school.unit_id} />
      {/* ============================== HERO ============================== */}
      <section className="relative isolate overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(ellipse 80% 90% at 15% 0%, ${crestTint(school.unit_id, 0.35)}, transparent 70%)` }}
        />
        <div className="absolute inset-0 -z-10 bg-dots opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="mx-auto max-w-6xl px-4 pt-5 pb-6 sm:px-6 sm:pt-8 sm:pb-10">
          <nav aria-label="Breadcrumb" className="mb-6 hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
            <Link href="/explore" className="hover:text-foreground">
              Explore
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <Link href={`/explore?states=${school.location.state}`} className="hover:text-foreground">
              {school.location.state}
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{school.name}</span>
          </nav>

          {/* Phones: crest beside the name, then facts, then a full-width Compare. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-4 sm:flex-nowrap sm:items-end sm:gap-6">
            <Crest id={school.unit_id} name={school.name} size="xl" className="size-14 animate-pop-in rounded-2xl text-lg shadow-xl sm:size-24 sm:rounded-3xl sm:text-2xl" />
            <div className="min-w-0 flex-1">
              <h1 className="animate-rise font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{school.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 sm:size-4" /> {school.location.city}, {school.location.state}
                  <span className="hidden sm:inline"> · {school.location.region}</span>
                </span>
                <Term term={school.type}>{typeLabel(school.type)}</Term>
                <Term term="size-tier">{size.label} campus</Term>
                {policy && <Term term="test-policy">{policy}</Term>}
                {school.campus?.setting && <Term term="locale">{SETTING_SHORT[school.campus.setting.locale]}</Term>}
                {school.campus?.carnegie?.research && (
                  <Term term="r1">{school.campus.carnegie.research === "RCU" ? "Research college" : school.campus.carnegie.research}</Term>
                )}
                {designations.map((d) => (
                  <Term key={d} term={DESIGNATION_TERMS[d]}>
                    {DESIGNATION_LABELS[d]}
                  </Term>
                ))}
              </div>
            </div>
            <CompareButton id={school.unit_id} variant="large" className="w-full sm:w-auto sm:self-end" />
          </div>

          {tags.length > 0 && (
            <div className="no-scrollbar mt-5 flex items-center gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:mt-6 sm:flex-wrap [&>*]:shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">Known for</span>
              {tags.map((t) => (
                <StandoutChip key={t.label} standout={t} size="md" />
              ))}
            </div>
          )}

          <TrendIndicatorStrip school={school} href={historyHref} className="mt-5 sm:mt-6" />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="space-y-14 pt-2 sm:space-y-24 sm:pt-4">
          {/* ============================== OVERVIEW ============================== */}
          <section id="overview" className="scroll-mt-28 sm:scroll-mt-36" aria-label="At a glance">
            <div className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:gap-4 lg:grid-flow-row lg:grid-cols-4">
              <Tile label="Acceptance rate" term="acceptance-rate" field="admissions.acceptance_rate" school={school} className="col-span-2 lg:col-span-1 lg:row-span-3">
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
                <Tile label="SAT middle 50%" term="middle-50" field="derived.sat_composite" school={school}>
                  <p className="font-display text-2xl font-extrabold whitespace-nowrap sm:text-3xl">{range(sat)}</p>
                  <RangeBar low={sat[0]} high={sat[1]} scale={scoreScale("sat", sat[0]).scale} color={DOMAINS.scores.color} medianMid={metricMedian("sat") ?? undefined} compact showScale />
                </Tile>
              )}
              {a.act_composite_25_75 && (
                <Tile label="ACT middle 50%" term="act" field="admissions.act_composite_25_75" school={school}>
                  <p className="font-display text-2xl font-extrabold whitespace-nowrap sm:text-3xl">{range(a.act_composite_25_75)}</p>
                  <RangeBar
                    low={a.act_composite_25_75[0]}
                    high={a.act_composite_25_75[1]}
                    scale={scoreScale("act", a.act_composite_25_75[0]).scale}
                    color={DOMAINS.scores.color}
                    medianMid={metricMedian("act") ?? undefined}
                    compact
                    showScale
                  />
                </Tile>
              )}
              <Tile label="Undergrads" term="undergrad-enrollment" field="demographics.undergrad_enrollment" school={school}>
                <p className="font-display text-3xl font-extrabold">{compact(d.undergrad_enrollment)}</p>
                <p className="text-xs text-muted-foreground">
                  Larger than <b className="text-foreground">{pct(rankOf(school, "enrollment") ?? 0)}</b> of colleges
                </p>
              </Tile>
              {ratio !== null && (
                <Tile label="Student-to-faculty ratio" term="student-faculty-ratio" field="academics.student_faculty_ratio" school={school}>
                  <p className="font-display text-3xl font-extrabold whitespace-nowrap">{ratio} to 1</p>
                  {ratioVs && (
                    <p className="text-xs text-muted-foreground">
                      {ratioVs.word === "fewer" ? "Fewer" : "More"} students per faculty member than at <b className="text-foreground">{pct(ratioVs.share)}</b> of colleges
                    </p>
                  )}
                </Tile>
              )}
              {yld !== null && (
                <Tile label="Yield rate" term="yield" field="derived.yield" school={school}>
                  <div className="flex items-center gap-3">
                    <Ring value={yld} color={DOMAINS.admissions.color} size={56} stroke={7} label={`Yield ${pct(yld)}`}>
                      <span className="text-xs font-bold">{pct(yld)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">of admitted students enroll</p>
                  </div>
                </Tile>
              )}
              {d.pell_grant_percent !== null && (
                <Tile label="Pell Grant recipients" term="pell-grant" field="demographics.pell_grant_percent" school={school}>
                  <div className="flex items-center gap-3">
                    <Ring value={d.pell_grant_percent} color={DOMAINS.access.color} size={56} stroke={7} label={`Pell ${pct(d.pell_grant_percent)}`}>
                      <span className="text-xs font-bold">{pct(d.pell_grant_percent)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">receive need-based federal grants</p>
                  </div>
                </Tile>
              )}
              {div !== null && d.racial_diversity && (
                <Tile label="Diversity index" term="diversity-index" field="derived.diversity_index" school={school}>
                  <p className="font-display text-3xl font-extrabold">{div.toFixed(2)}</p>
                  <StackedBar data={d.racial_diversity} height="h-2.5" showLegend={false} />
                </Tile>
              )}
              {avgCost !== null && (
                <Tile label="Average cost" term="average-cost" field="cost.avg_paid_all" school={school}>
                  <p className="font-display text-3xl font-extrabold">{moneyCompact(avgCost)}</p>
                  <p className="text-xs text-muted-foreground">total per year, all students, after grants (est.)</p>
                </Tile>
              )}
              {history && <TenYearTile history={history.history} files={history.files} href={historyHref} />}
              {aidGenerosity(school) !== null && (
                <Tile label="Aid generosity" term="aid-generosity" field="derived.aid_generosity" school={school}>
                  <div className="flex items-center gap-3">
                    <Ring value={aidGenerosity(school)!} color={DOMAINS.value.color} size={56} stroke={7} label={`Grants cover ${pct(aidGenerosity(school)!)} of the full price`}>
                      <span className="text-xs font-bold">{pct(aidGenerosity(school)!)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">
                      of full price covered by grants · <b className="text-foreground">{generosityTier(aidGenerosity(school)).label}</b>
                    </p>
                  </div>
                </Tile>
              )}
              {earnings !== null && (
                <Tile label="Median earnings" term="median-earnings" field="outcomes.median_earnings_10yr" school={school}>
                  <p className="font-display text-3xl font-extrabold">{moneyCompact(earnings)}</p>
                  <p className="text-xs text-muted-foreground">10 years after enrolling</p>
                </Tile>
              )}
              {grad !== null && (
                <Tile label="Graduation rate" term="graduation-rate" field="outcomes.graduation_rate" school={school}>
                  <div className="flex items-center gap-3">
                    <Ring value={grad} color={DOMAINS.value.color} size={56} stroke={7} label={`Graduation rate ${pct(grad)}`}>
                      <span className="text-xs font-bold">{pct(grad)}</span>
                    </Ring>
                    <p className="text-xs text-muted-foreground">finish within six years</p>
                  </div>
                </Tile>
              )}
            </div>
            <SourceExceptions fields={OVERVIEW_FIELDS} school={school} />
            <SourceNote fields={OVERVIEW_FIELDS} school={school} className="mt-4" />
          </section>

          {/* ============================== TOPIC PAGES ============================== */}
          <TopicLinks unitId={school.unit_id} available={p.topics} />

          {/* ============================== SIMILAR ============================== */}
          <Panel id="similar" eyebrow="Keep exploring" title="Schools like this one" fields={[]}>
            <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-4">
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
                  <Link href={`/compare?ids=${school.unit_id},${s.unit_id}`} className="relative z-20 mt-4 inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline">
                    Compare side-by-side <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
            <ShowMore label="Show all sources for this profile" hint="Every dataset and year behind the numbers on this profile" className="mt-10 sm:mt-12">
              <SourceList school={school} fields={PROFILE_FIELDS} />
            </ShowMore>
          </Panel>
        </div>
      </div>
    </div>
  );
}
