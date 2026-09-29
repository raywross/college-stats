import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Calculator, ChevronRight, ExternalLink, MapPin, TriangleAlert } from "lucide-react";
import { getData, getHistory, getHistoryFiles } from "@/lib/data";
import type { Cited } from "@/lib/lineage";
import {
  DOMAINS,
  TEST_POLICY_LABELS,
  diversityIndex,
  hasAdmissionCounts,
  hasTestScores,
  admitRatio,
  aidGenerosity,
  generosityTier,
  paybackYears,
  satComposite,
  satMid,
  selectivityTier,
  sizeBucket,
  yieldRate,
  type Domain,
} from "@/lib/metrics";
import {
  admissionsTakeaway,
  costTakeaway,
  historyTakeaway,
  outcomesTakeaway,
  scoresTakeaway,
  similarSchools,
  standouts,
  studentsTakeaway,
  studentBodyNotes,
  yieldTakeaway,
} from "@/lib/insights";
import { compact, money, moneyCompact, num, pct, pctSmart, range, typeLabel } from "@/lib/format";
import type { TermKey } from "@/lib/glossary";
import type { School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { SourceList, SourceNote } from "@/components/sources/SourceNote";
import { AidBreakdown } from "@/components/charts/AidBreakdown";
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
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { LANDSCAPE_X, LANDSCAPE_Y, LANDSCAPE_ZONE, VALUE_X, VALUE_Y, valueZone } from "@/lib/chart-configs";
import { NetPriceByIncome } from "@/components/charts/NetPriceByIncome";
import { WhatStudentsPay } from "@/components/school/WhatStudentsPay";
import { AidGenerosityCard } from "@/components/school/AidGenerosityCard";
import { InfoTip, MetricLabel, SourceChip, Term } from "@/components/ui/info-tip";
import { ShowMore } from "@/components/ui/show-more";
import { OverTime } from "@/components/history/OverTime";
import { TenYearTile } from "@/components/history/TenYearTile";
import { HeadlineDelta } from "@/components/history/HeadlineDelta";
import { TrendIndicatorStrip } from "@/components/trends/TrendIndicators";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { historyYearLabel, type NationalHistory, type SeriesKey } from "@/lib/history";

/** Series each "Over time" group shows; they drive the group's source footnote. */
const HISTORY_GROUPS = {
  cost: ["avg_paid_all", "full_price", "sticker_in_state", "sticker_out_of_state", "aided_net_price", "net_price_income_1"],
  aid: ["grant_pct", "grant_avg", "aid_generosity"],
  admissions: ["applicants", "admitted", "enrolled", "acceptance_rate", "yield"],
  scores: ["sat_25", "sat_75", "act_25", "act_75", "sat_submit", "test_policy"],
  students: ["undergrads", "race_white", "men_share", "part_time_share"],
  outcomes: ["grad_rate", "median_debt"],
} as const satisfies Record<string, readonly SeriesKey[]>;

/** National series the charts draw as a band (keeps the page payload small). */
const BANDED: readonly SeriesKey[] = ["avg_paid_all", "grant_pct", "grant_avg", "acceptance_rate", "sat_25", "sat_75", "act_25", "act_75", "grad_rate", "median_debt", "men_share", "part_time_share"];

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
 * The values each section shows. Drives its source footnote and the notice when
 * some values come from a different source. Showing a new value? Add its field here.
 */
const SECTION_FIELDS = {
  overview: [
    "admissions.acceptance_rate",
    "derived.sat_composite",
    "admissions.act_composite_25_75",
    "demographics.undergrad_enrollment",
    "derived.yield",
    "demographics.pell_grant_percent",
    "derived.diversity_index",
    "cost.avg_paid_all",
    "derived.aid_generosity",
    "outcomes.median_earnings_10yr",
    "outcomes.graduation_rate",
    "trends",
  ],
  admissions: ["admissions.applicants", "admissions.admitted", "admissions.enrolled", "admissions.acceptance_rate", "derived.yield"],
  scores: [
    "admissions.sat_reading_25_75",
    "admissions.sat_math_25_75",
    "admissions.act_composite_25_75",
    "admissions.test_submission_rate_sat",
    "admissions.test_submission_rate_act",
    "admissions.test_policy",
  ],
  students: [
    "demographics.racial_diversity",
    "derived.diversity_index",
    "demographics.pell_grant_percent",
    "demographics.first_gen_percent",
    "demographics.undergrad_enrollment",
    "demographics.men_share",
    "demographics.women_share",
    "demographics.part_time_share",
    "demographics.age_25_plus_share",
  ],
  cost: [
    "cost.avg_paid_all",
    "cost.sticker",
    "cost.tuition_fees",
    "cost.residency",
    "cost.aided_net_price",
    "cost.net_price_by_income",
    "derived.aid_generosity",
    "aid.grant_pct",
    "aid.grant_avg",
    "aid.institutional_pct",
    "aid.pell_pct",
    "aid.loan_pct",
    "aid.by_income",
    "outcomes.median_debt",
    "outcomes.monthly_loan_payment",
    "derived.payback_years",
    "outcomes.median_earnings_10yr",
    "outcomes.median_earnings_6yr",
    "outcomes.retention_rate",
    "outcomes.graduation_rate",
  ],
  ranks: ["derived.sat_mid", "derived.yield", "demographics.pell_grant_percent", "derived.diversity_index", "admissions.acceptance_rate"],
} as const satisfies Record<string, readonly FieldPath[]>;

const PROFILE_FIELDS: readonly FieldPath[] = [...new Set([...Object.values(SECTION_FIELDS).flat(), "aid.cds" as const, "location.city" as const])];

/** "Figures marked CDS 2024-25 come from …": one line per non-default source among a section's values. */
async function SourceExceptions({ fields, school }: { fields: readonly FieldPath[]; school: School }) {
  const { citeField } = await getData();
  const seen = new Map<string, Cited>();
  for (const f of fields) {
    const c = citeField(f, school);
    if (!c.isDefault) seen.set(`${c.key}${c.url}${c.year}`, c);
  }
  if (!seen.size) return null;
  return (
    <div className="mt-3 flex max-w-3xl flex-col gap-1.5">
      {[...seen.values()].map((c) => (
        <p key={`${c.key}${c.url}`} className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <SourceChip cited={c} />
          <span>
            Figures marked like this come from{" "}
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
              {c.label}
            </a>
            {c.year ? `, ${c.year}` : ""}. Everything else here is federal data.
          </span>
        </p>
      ))}
    </div>
  );
}

function Panel({
  id,
  domain,
  eyebrow,
  title,
  takeaway,
  children,
  school,
  fields,
  delta,
}: {
  id: string;
  domain?: Domain;
  eyebrow: string;
  title: string;
  takeaway?: string;
  /** A "since" line under the takeaway (HeadlineDelta). */
  delta?: ReactNode;
  children: ReactNode;
  school?: School;
  /** Values this section shows (registered paths); their sources close the section. Required so nothing goes uncited. */
  fields: readonly FieldPath[];
}) {
  const color = domain ? DOMAINS[domain].color : "var(--primary)";
  return (
    <section id={id} className="scroll-mt-28 sm:scroll-mt-36">
      <p className="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase" style={{ color }}>
        <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-foreground/70">{eyebrow}</span>
      </p>
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
      {takeaway && <p className="mt-2 max-w-3xl text-base text-muted-foreground sm:text-lg">{takeaway}</p>}
      {delta}
      {school && <SourceExceptions fields={fields} school={school} />}
      <div className="mt-5 sm:mt-6">{children}</div>
      {school && fields.length > 0 && <SourceNote fields={fields} school={school} className="mt-4" />}
    </section>
  );
}

async function Tile({
  label,
  term,
  field,
  school,
  children,
  className,
}: {
  label: string;
  term?: TermKey;
  /** The value this tile shows; its source appears in the (i) popover. */
  field: FieldPath;
  school: School;
  children: ReactNode;
  className?: string;
}) {
  const { citeField } = await getData();
  return (
    <div className={`flex flex-col rounded-3xl border bg-card p-4 sm:p-5 ${className ?? ""}`}>
      <MetricLabel term={term} cited={citeField(field, school)} className="flex-wrap text-xs font-semibold text-muted-foreground">
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
  const data = await getData();
  const { citeField, distribution, getSchoolById, landscapePoints, metricMedian, rankOf, valuePoints } = data;
  const school = getSchoolById(id);
  if (!school) notFound();
  const [history, historyFiles] = await Promise.all([getHistory(school.unit_id), getHistoryFiles()]);
  const hasHistory = history !== null && historyFiles !== null && Object.keys(history.series).length > 0;

  const { admissions: a, demographics: d } = school;
  const rate = a.acceptance_rate;
  const tier = selectivityTier(rate);
  const size = sizeBucket(d.undergrad_enrollment);
  const tags = standouts(data, school, { trends: true });
  const similar = similarSchools(data, school, 4);
  const sat = satComposite(school);
  const yld = yieldRate(school);
  const div = diversityIndex(school);
  const body = studentBodyNotes(data, school);
  const counts = hasAdmissionCounts(school);
  const scores = hasTestScores(school);
  const onMap = rate !== null && satMid(school) !== null;
  const sub = { sat: a.test_submission_rate_sat, act: a.test_submission_rate_act };
  const lowSubmission = sub.sat !== null && sub.act !== null && sub.sat < 0.5 && sub.act < 0.5;
  const acceptanceRank = rankOf(school, "acceptance");
  const policy = a.test_policy ? TEST_POLICY_LABELS[a.test_policy] : null;
  const c = school.cost;
  const o = school.outcomes;
  const avgCost = c?.avg_paid_all ?? null;
  const earnings = o?.median_earnings_10yr ?? null;
  const grad = o?.graduation_rate ?? null;
  const byIncome = c?.net_price_by_income ?? null;
  const payback = paybackYears(school);
  const hasValue = avgCost !== null || !!c?.sticker || earnings !== null || grad !== null || byIncome !== null;
  const onValueMap = avgCost !== null && earnings !== null;

  const sections = [
    { id: "overview", label: "Overview" },
    ...(rate !== null || counts ? [{ id: "admissions", label: "Admissions", color: DOMAINS.admissions.color }] : []),
    ...(scores ? [{ id: "scores", label: "Test scores", color: DOMAINS.scores.color }] : []),
    { id: "students", label: "Students", color: DOMAINS.access.color },
    ...(hasValue ? [{ id: "cost", label: "Cost & outcomes", color: DOMAINS.value.color }] : []),
    ...(hasHistory ? [{ id: "history", label: "Over time" }] : []),
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
        <div className="mx-auto max-w-6xl px-4 pt-5 pb-6 sm:px-6 sm:pt-8 sm:pb-10">
          <nav aria-label="Breadcrumb" className="mb-6 hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
            <Link href="/explore" className="hover:text-foreground">Explore</Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <Link href={`/explore?states=${school.location.state}`} className="hover:text-foreground">
              {school.location.state}
            </Link>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{school.name}</span>
          </nav>

          {/* Phones: crest beside the name, then facts, then a full-width Compare. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-4 sm:flex-nowrap sm:items-end sm:gap-6">
            <Crest
              id={school.unit_id}
              name={school.name}
              size="xl"
              className="size-14 animate-pop-in rounded-2xl text-lg shadow-xl sm:size-24 sm:rounded-3xl sm:text-2xl"
            />
            <div className="min-w-0 flex-1">
              <h1 className="animate-rise font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                {school.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 sm:size-4" /> {school.location.city}, {school.location.state}
                  <span className="hidden sm:inline"> · {school.location.region}</span>
                </span>
                <Term term={school.type}>{typeLabel(school.type)}</Term>
                <Term term="size-tier">{size.label} campus</Term>
                {policy && <Term term="test-policy">{policy}</Term>}
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

          <TrendIndicatorStrip school={school} className="mt-5 sm:mt-6" />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionNav sections={sections} />

        <div className="space-y-14 pt-6 sm:space-y-24 sm:pt-10">
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
                  <RangeBar low={sat[0]} high={sat[1]} scale={[400, 1600]} color={DOMAINS.scores.color} medianMid={metricMedian("sat") ?? undefined} compact />
                </Tile>
              )}
              {a.act_composite_25_75 && (
                <Tile label="ACT middle 50%" term="act" field="admissions.act_composite_25_75" school={school}>
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
              <Tile label="Undergrads" term="undergrad-enrollment" field="demographics.undergrad_enrollment" school={school}>
                <p className="font-display text-3xl font-extrabold">{compact(d.undergrad_enrollment)}</p>
                <p className="text-xs text-muted-foreground">
                  Larger than <b className="text-foreground">{pct(rankOf(school, "enrollment") ?? 0)}</b> of colleges
                </p>
              </Tile>
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
              {hasHistory && <TenYearTile history={history} files={historyFiles} />}
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
            <SourceExceptions fields={SECTION_FIELDS.overview} school={school} />
            <SourceNote fields={SECTION_FIELDS.overview} school={school} className="mt-4" />
          </section>

          {/* ============================== ADMISSIONS ============================== */}
          {(rate !== null || counts) && (
            <Panel
              id="admissions"
              domain="admissions"
              eyebrow="Admissions"
              title={a.year ? `Getting in, fall ${a.year}` : "Getting in"}
              takeaway={admissionsTakeaway(data, school)}
              delta={hasHistory && <HeadlineDelta seriesKey="acceptance_rate" history={history} files={historyFiles} color={DOMAINS.admissions.color} />}
              school={school}
              fields={SECTION_FIELDS.admissions}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                {counts ? (
                  // Phones: the funnel says the same thing in a fifth of the height, so the waffle follows it, folded.
                  <ShowMore label="Show out of every 100 applicants" hint="The funnel as 100 squares" className="max-lg:order-last">
                    <div className="h-full rounded-3xl border bg-card p-4 sm:p-6">
                      <h3 className="mb-4 font-display text-lg font-bold">Out of every 100 applicants…</h3>
                      <Waffle applicants={a.applicants!} admitted={a.admitted!} enrolled={a.enrolled!} />
                    </div>
                  </ShowMore>
                ) : (
                  <NotReported what="An applicant/admit/enroll breakdown" />
                )}
                <div className="flex flex-col gap-4">
                  {counts && (
                    <div className="rounded-3xl border bg-card p-4 sm:p-6">
                      {/* Applied, admitted, and enrolled always come from the same report, so the heading carries the chip. */}
                      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
                        The funnel <SourceChip cited={citeField("admissions.applicants", school)} />
                      </h3>
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
                    </div>
                  )}
                  {yld !== null && (
                    <div className="flex items-center gap-4 rounded-3xl border bg-card p-4 sm:p-6">
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
            </Panel>
          )}

          {/* ============================== TEST SCORES ============================== */}
          {scores && (
            <Panel id="scores" domain="scores" eyebrow="Test scores" title="What admitted students scored" takeaway={scoresTakeaway(data, school)} school={school} fields={SECTION_FIELDS.scores}>
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
                    }}
                  />
                </div>
                <div className="rounded-3xl border bg-card p-4 sm:p-6">
                  <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                    Who submitted scores? <InfoTip term="test-submission" cited={citeField("admissions.test_submission_rate_sat", school)} />
                    <SourceChip cited={citeField("admissions.test_submission_rate_sat", school)} />
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
          <Panel
            id="students"
            domain="access"
            eyebrow="Students"
            title="Who's on campus"
            takeaway={studentsTakeaway(data, school)}
            delta={hasHistory && <HeadlineDelta seriesKey="undergrads" history={history} files={historyFiles} color={DOMAINS.size.color} />}
            school={school}
            fields={SECTION_FIELDS.students}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border bg-card p-4 sm:p-6 lg:col-span-2">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <h3 className="flex items-center gap-1 font-display text-lg font-bold">
                    Race & ethnicity <InfoTip term="race-ethnicity" cited={citeField("demographics.racial_diversity", school)} />
                    <SourceChip cited={citeField("demographics.racial_diversity", school)} />
                  </h3>
                  {div !== null && (
                    <p className="flex items-center gap-1 text-sm">
                      <span className="text-muted-foreground">Diversity index</span>
                      <b>{div.toFixed(2)}</b>
                      <InfoTip term="diversity-index" cited={citeField("derived.diversity_index", school)} />
                    </p>
                  )}
                </div>
                {d.racial_diversity ? (
                  <StackedBar data={d.racial_diversity} label={`${school.name} race and ethnicity`} />
                ) : (
                  <p className="text-sm text-muted-foreground">Not reported.</p>
                )}
              </div>
              <div className="space-y-6 rounded-3xl border bg-card p-4 sm:p-6">
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
              </div>
              <div className="space-y-6 rounded-3xl border bg-card p-4 sm:p-6">
                <h3 className="flex items-center gap-1.5 font-display text-lg font-bold">
                  Campus size <SourceChip cited={citeField("demographics.undergrad_enrollment", school)} />
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
              </div>
              {(d.men_share != null || d.part_time_share != null || d.age_25_plus_share != null) && (
                <ShowMore label="Show men, women, part-time, and age" hint="How the student body compares with the median college" className="lg:col-span-2">
                  <div className="rounded-3xl border bg-card p-4 sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <h3 className="font-display text-lg font-bold">Who they are</h3>
                      {body.manyAdults && (
                        <StandoutChip standout={{ label: "Many adult students", domain: "access", metric: "adults" }} />
                      )}
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
                    <p className="mt-4 text-xs text-muted-foreground">Degree-seeking undergraduates.</p>
                  </div>
                </ShowMore>
              )}
            </div>
          </Panel>

          {/* ============================== COST & OUTCOMES ============================== */}
          {hasValue && (
            <Panel
              id="cost"
              domain="value"
              eyebrow="Cost & outcomes"
              title="What it costs, what it pays"
              takeaway={costTakeaway(data, school)}
              delta={hasHistory && <HeadlineDelta seriesKey="avg_paid_all" history={history} files={historyFiles} color={DOMAINS.value.color} />}
              school={school}
              fields={SECTION_FIELDS.cost}
            >
              {school.links?.price_calculator && (
                <a
                  href={school.links.price_calculator}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mb-4 flex items-center gap-3 rounded-2xl border border-dashed p-4 transition-colors hover:border-primary/40"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-pop text-pop-foreground">
                    <Calculator className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <b>Your family&apos;s price will differ.</b>{" "}
                    <span className="text-muted-foreground">
                      Get a personal estimate from {school.name}&apos;s official <Term term="net-price-calculator">net price calculator</Term>.
                    </span>
                  </span>
                  <ExternalLink className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </a>
              )}
              <WhatStudentsPay school={school} />

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-3xl border bg-card p-4 sm:p-6">
                  <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
                    What families at each income level pay <InfoTip term="net-price-by-income" cited={citeField("cost.net_price_by_income", school)} />
                  </h3>
                  <p className="mb-5 text-xs text-muted-foreground">
                    Average net price per year for students receiving federal aid
                    {citeField("cost.net_price_by_income", school).year ? `, ${citeField("cost.net_price_by_income", school).year}` : ""}. Families who didn&apos;t file the FAFSA aren&apos;t included.
                  </p>
                  {byIncome ? (
                    <NetPriceByIncome values={byIncome} average={null} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Net price by family income isn&apos;t reported.</p>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  {(o?.median_debt != null || payback !== null) && (
                    <div className="grid grid-cols-2 gap-4 rounded-3xl border bg-card p-4 sm:p-6">
                      {o?.median_debt != null && (
                        <div>
                          <MetricLabel term="median-debt" cited={citeField("outcomes.median_debt", school)} className="text-xs font-semibold text-muted-foreground">
                            Median debt at graduation
                          </MetricLabel>
                          <p className="mt-2 font-display text-3xl font-extrabold">{moneyCompact(o.median_debt)}</p>
                          {o.monthly_loan_payment != null && (
                            <p className="text-xs text-muted-foreground">≈ {money(o.monthly_loan_payment)}/month for 10 years</p>
                          )}
                        </div>
                      )}
                      {payback !== null && (
                        <div>
                          <MetricLabel term="payback" cited={citeField("derived.payback_years", school)} className="text-xs font-semibold text-muted-foreground">
                            Payback estimate
                          </MetricLabel>
                          <p className="mt-2 font-display text-3xl font-extrabold">{payback.toFixed(1)} yrs</p>
                          <p className="text-xs text-muted-foreground">of median salary to cover 4 years of net price</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {school.aid && (
                <div className="mt-10">
                  <h3 className="mb-3 font-display text-xl font-extrabold tracking-tight sm:mb-1 sm:text-2xl">Who actually gets aid</h3>
                  <p className="mb-4 hidden max-w-3xl text-muted-foreground sm:block">
                    Some colleges cover most of their price with grants; others cover little. Here&apos;s how generous this one is,
                    how many students get grants, where the money comes from, and how it varies with family income.
                  </p>
                  <ShowMore label="Show who gets aid" hint="How generous grants are, who gets them, where aid comes from, and aid by family income">
                    <div className="space-y-4">
                      <AidGenerosityCard school={school} />
                      <AidBreakdown school={school} />
                    </div>
                  </ShowMore>
                </div>
              )}

              {(earnings !== null || grad !== null) && (
                <>
                  <p className="mt-10 mb-4 max-w-3xl text-base text-muted-foreground sm:text-lg">{outcomesTakeaway(data, school)}</p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-6 rounded-3xl border bg-card p-4 sm:p-6">
                      <h3 className="font-display text-lg font-bold">Earnings</h3>
                      <DistributionStrip
                        label="Median earnings vs. every college"
                        term="median-earnings"
                        dist={distribution("earnings")}
                        value={earnings}
                        rank={rankOf(school, "earnings")}
                        format="moneyCompact"
                        color={DOMAINS.value.color}
                      />
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
                    </div>
                    <div className="rounded-3xl border bg-card p-4 sm:p-6">
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
                    </div>
                  </div>
                </>
              )}

              {onValueMap && (
                <ShowMore label="Show the cost vs. earnings map" hint={`Where ${school.name} sits among 300 colleges`} className="mt-4">
                <div className="rounded-3xl border bg-card p-4 sm:p-6">
                  <h3 className="mb-1 font-display text-lg font-bold">Cost vs. earnings</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    The 300 most-applied-to colleges plus {school.name}. Top-left is lower cost and higher earnings.
                  </p>
                  <ScatterPlot
                    focusId={school.unit_id}
                    height={380}
                    points={valuePoints(undefined, 300, [school.unit_id])}
                    x={VALUE_X}
                    y={VALUE_Y}
                    zone={valueZone(metricMedian("avgCost"), metricMedian("earnings"))}
                  />
                </div>
                </ShowMore>
              )}
            </Panel>
          )}

          {/* ============================== OVER TIME ============================== */}
          {hasHistory && (
            <Panel id="history" eyebrow="Over time" title="How it's changed" takeaway={historyTakeaway(history, historyFiles)} school={school} fields={[]}>
              <OverTime
                isPublic={school.type === "public"}
                history={history}
                national={Object.fromEntries(BANDED.flatMap((k) => (historyFiles.national.series[k] ? [[k, historyFiles.national.series[k]]] : []))) as NationalHistory["series"]}
                cpi={historyFiles.cpi}
                latest={historyFiles.meta.latest}
                provisional={{
                  fall: historyFiles.meta.provisional.adm ?? null,
                  academic: historyFiles.meta.provisional.sfa ?? historyFiles.meta.provisional.prices ?? null,
                  cohort: null,
                }}
                sources={{
                  cost: <HistorySourceNote keys={HISTORY_GROUPS.cost} files={historyFiles} />,
                  aid: <HistorySourceNote keys={HISTORY_GROUPS.aid} files={historyFiles} />,
                  admissions: (
                    <>
                      {!citeField("admissions.applicants", school).isDefault && (
                        <p className="mb-1.5">
                          These charts use federal data every year, so they end at {historyYearLabel(historyFiles.meta.latest.fall, "fall").toLowerCase()}; the
                          admissions figures above come from {citeField("admissions.applicants", school).label}
                          {citeField("admissions.applicants", school).year ? `, ${citeField("admissions.applicants", school).year}` : ""}.
                        </p>
                      )}
                      <HistorySourceNote keys={HISTORY_GROUPS.admissions} files={historyFiles} />
                    </>
                  ),
                  scores: <HistorySourceNote keys={HISTORY_GROUPS.scores} files={historyFiles} />,
                  students: <HistorySourceNote keys={HISTORY_GROUPS.students} files={historyFiles} />,
                  outcomes: <HistorySourceNote keys={HISTORY_GROUPS.outcomes} files={historyFiles} />,
                }}
                colors={{
                  value: DOMAINS.value.color,
                  admissions: DOMAINS.admissions.color,
                  scores: DOMAINS.scores.color,
                  size: DOMAINS.size.color,
                  diversity: DOMAINS.diversity.color,
                }}
              />
            </Panel>
          )}

          {/* ============================== RANKS ============================== */}
          <Panel id="ranks" eyebrow="Context" title="How it ranks nationally" school={school} fields={SECTION_FIELDS.ranks}>
            <p className="-mt-3 mb-6 flex items-center gap-1 text-sm text-muted-foreground">
              Each chart shows every college that reports the measure; the pin marks {school.name}.
              <InfoTip term="percentile-rank" />
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-8 rounded-3xl border bg-card p-4 sm:p-6">
                <DistributionStrip label="SAT midpoint" term="sat" dist={distribution("sat")} value={satMid(school)} rank={rankOf(school, "sat")} format="int" color={DOMAINS.scores.color} />
                <DistributionStrip label="Yield rate" term="yield" dist={distribution("yield")} value={yld} rank={rankOf(school, "yield")} format="pct" color={DOMAINS.admissions.color} />
                <DistributionStrip label="Pell Grant share" term="pell-grant" dist={distribution("pell")} value={d.pell_grant_percent} rank={rankOf(school, "pell")} format="pct" color={DOMAINS.access.color} />
                <DistributionStrip label="Diversity index" term="diversity-index" dist={distribution("diversity")} value={div} rank={rankOf(school, "diversity")} format="fixed2" color={DOMAINS.diversity.color} />
              </div>
              <ShowMore label="Show the admissions map" hint="Acceptance rate vs. SAT for 300 colleges">
              <div className="h-full rounded-3xl border bg-card p-4 sm:p-6">
                <h3 className="mb-3 font-display text-lg font-bold">On the admissions map</h3>
                {onMap ? (
                  <ScatterPlot
                    focusId={school.unit_id}
                    height={380}
                    points={landscapePoints(undefined, 300, [school.unit_id])}
                    x={LANDSCAPE_X}
                    y={LANDSCAPE_Y}
                    zone={LANDSCAPE_ZONE}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The map plots acceptance rate against SAT scores. {school.name} doesn&apos;t report both, so it isn&apos;t shown.
                  </p>
                )}
              </div>
              </ShowMore>
            </div>
          </Panel>

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
                  <Link
                    href={`/compare?ids=${school.unit_id},${s.unit_id}`}
                    className="relative z-20 mt-4 inline-flex items-center gap-1 self-start text-xs font-bold text-primary hover:underline"
                  >
                    Compare side-by-side <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
            <ShowMore label="Show all sources for this profile" hint="Every dataset and year behind the numbers above" className="mt-10 sm:mt-12">
              <SourceList school={school} fields={PROFILE_FIELDS} />
            </ShowMore>
          </Panel>
        </div>
      </div>
    </div>
  );
}
