import Link from "next/link";
import { ArrowRight, BookOpen, Building2, Crown, FlaskConical, HeartHandshake, Landmark, PiggyBank, Sprout, Target, Swords, TrendingUp } from "lucide-react";
import { getData } from "@/lib/data";
import { parseFilters } from "@/lib/params";
import { DOMAINS, METRICS, admitRatio, median, oneIn, satMid, type Domain } from "@/lib/metrics";
import { GLOSSARY, type TermKey } from "@/lib/glossary";
import { compact, moneyCompact, num, pct, pctSmart } from "@/lib/format";
import { Ring } from "@/components/charts/Ring";
import { shortName } from "@/lib/brand";
import { SchoolSearch } from "@/components/search/SchoolSearch";
import { Crest } from "@/components/school/Crest";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { LANDSCAPE_X, LANDSCAPE_Y, LANDSCAPE_ZONE, VALUE_X, VALUE_Y, valueZone } from "@/lib/chart-configs";
import { StateTileMap } from "@/components/charts/StateTileMap";
import { Leaderboard } from "@/components/charts/Leaderboard";
import { InfoTip, Term } from "@/components/ui/info-tip";
import { SourceNote } from "@/components/sources/SourceNote";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { WhatsChanged } from "@/components/history/WhatsChanged";

const LENSES: { title: string; blurb: string; query: string; domain: Domain; icon: typeof Crown; ranked?: boolean }[] = [
  { title: "The most selective", blurb: "Admit rates of 10% or less", query: "maxAR=10&sortBy=acceptance_rate", domain: "admissions", icon: Crown },
  { title: "Within reach", blurb: "Strong schools admitting 25%+", query: "minAR=25&sortBy=sat&sortDir=desc", domain: "admissions", icon: Target },
  { title: "Big public universities", blurb: "Large campuses, big energy", query: "types=public&sizes=large,xl&sortBy=enrollment&sortDir=desc", domain: "size", icon: Building2 },
  { title: "Small & close-knit", blurb: "Under 15K undergrads", query: "sizes=small,medium&sortBy=enrollment", domain: "size", icon: Sprout },
  { title: "Economic diversity", blurb: "Highest share of Pell Grant students", query: "sortBy=pell&sortDir=desc&view=table&minEnroll=1000", domain: "access", icon: HeartHandshake, ranked: true },
  { title: "Low cost, high earnings", blurb: "Average cost under $25K, ranked by earnings", query: "maxCost=25000&sortBy=earnings&sortDir=desc&minEnroll=1000", domain: "value", icon: PiggyBank },
  { title: "Opportunity colleges", blurb: "Carnegie's higher access, higher earnings class", query: "opportunity=1&sortBy=earnings&sortDir=desc", domain: "access", icon: TrendingUp },
  { title: "HBCUs", blurb: "Historically Black colleges and universities", query: "designation=hbcu&sortBy=enrollment&sortDir=desc", domain: "diversity", icon: Landmark },
  { title: "Research universities", blurb: "R1: very high research activity", query: "research=R1&sortBy=enrollment&sortDir=desc", domain: "scores", icon: FlaskConical },
];

const MATCHUPS = [
  ["166027", "243744"],
  ["110635", "110662"],
  ["170976", "234076", "199120"],
  ["168342", "121345"],
];

const LINGO: TermKey[] = ["middle-50", "yield", "pell-grant", "test-optional"];

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

export default async function HomePage() {
  const {
    countByState,
    getAllSchools,
    getDatasetSummary,
    getSchools,
    getSchoolsByIds,
    topBy,
    landscapePoints,
    landscapeEligibleCount,
    metricMedian,
    valueEligibleCount,
    valuePoints,
  } = await getData();
  const all = getAllSchools();
  const summary = getDatasetSummary();
  const spotlight = getSchoolsByIds(["166027", "110662", "131520"]);
  const ultra = all.filter(
    (s) => s.admissions.acceptance_rate !== null && s.admissions.acceptance_rate < 0.05 && (s.admissions.applicants ?? 0) >= 1000
  );
  const ultraSat = median(ultra.map(satMid));
  const LANDSCAPE_LIMIT = 400;
  const medNP = metricMedian("avgCost");
  const medEarn = metricMedian("earnings");

  const lenses = LENSES.map((l) => {
    const params = Object.fromEntries(new URLSearchParams(l.query));
    const matches = getSchools(parseFilters(params));
    return { ...l, matches };
  });

  const stats = [
    { value: num(summary.count), label: "4-year colleges", sub: `across ${summary.states} states & territories` },
    { value: compact(summary.totalApplicants), label: "Applications", sub: `fall ${summary.year} admissions` },
    { value: pct(summary.overallAdmitRate), label: "Were admitted", sub: "pooled across all schools", term: "acceptance-rate" as const },
    { value: compact(summary.totalUndergrads), label: "Undergrads", sub: "currently enrolled", term: "undergrad-enrollment" as const },
  ];

  return (
    <div>
      {/* ============================== HERO ============================== */}
      {/* `z-10` so the search results (absolute, inside the hero's stacking context) paint over the stats tiles below;
          the glow blobs are clipped by their own wrapper, because `overflow-hidden` on the section clipped the results. */}
      <section className="relative isolate z-10 border-b">
        <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
          <div className="absolute inset-0 bg-dots opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
          <div className="absolute -top-40 -left-32 size-[36rem] animate-[drift_18s_ease-in-out_infinite] rounded-full blur-3xl" style={{ background: "var(--hero-glow-1)" }} />
          <div className="absolute top-10 right-[-10rem] size-[30rem] animate-[drift_22s_ease-in-out_infinite_reverse] rounded-full blur-3xl" style={{ background: "var(--hero-glow-2)" }} />
          <div className="absolute bottom-[-12rem] left-1/3 size-[26rem] animate-[drift_26s_ease-in-out_infinite] rounded-full blur-3xl" style={{ background: "var(--hero-glow-3)" }} />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pt-8 pb-10 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <span className="inline-flex animate-rise items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold backdrop-blur">
              <span className="size-2 rounded-full bg-good" />
              {num(summary.count)} colleges · IPEDS & College Scorecard data
            </span>
            <h1 className="mt-4 animate-rise font-display text-[2.75rem] leading-[0.95] font-extrabold tracking-tight [animation-delay:60ms] sm:mt-5 sm:text-7xl">
              College data,
              <br />
              <span className="highlight">decoded.</span>
            </h1>
            <p className="mt-4 max-w-xl animate-rise text-base text-muted-foreground [animation-delay:120ms] sm:mt-5 sm:text-lg">
              See how hard it is to get in, what scores admitted students have, and who&apos;s on campus, in charts instead
              of spreadsheets.<span className="hidden sm:inline"> Every term is explained in plain English.</span>
            </p>
            <div className="mt-6 max-w-xl animate-rise [animation-delay:180ms] sm:mt-8">
              <SchoolSearch />
              <div className="no-scrollbar mt-3 flex items-center gap-1.5 text-xs max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap">
                <span className="text-muted-foreground">Try:</span>
                {getSchoolsByIds(["166027", "110662", "170976", "131520", "221999"]).map((s) => (
                  <Link key={s.unit_id} href={`/schools/${s.unit_id}`} className="shrink-0 rounded-full border bg-card/70 px-2.5 py-1 font-medium backdrop-blur hover:border-primary/40 hover:text-primary">
                    {shortName(s)}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Floating spotlight cards */}
          <div className="relative hidden h-[420px] lg:block" aria-hidden>
            {spotlight.map((s, i) => {
              const pos = [
                "top-0 left-6 -rotate-6",
                "top-28 right-0 rotate-3",
                "bottom-0 left-16 -rotate-2",
              ][i];
              return (
                <div
                  key={s.unit_id}
                  className={`absolute w-72 animate-rise rounded-3xl border bg-card/90 p-5 shadow-2xl shadow-primary/10 backdrop-blur ${pos}`}
                  style={{ animationDelay: `${200 + i * 120}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <Crest id={s.unit_id} name={s.name} size="md" />
                    <div className="min-w-0">
                      <p className="truncate font-display font-bold">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.location.city}, {s.location.state}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className="font-display text-3xl font-extrabold">{admitRatio(s) ?? "–"}</p>
                      <p className="text-xs text-muted-foreground">applicants admitted</p>
                    </div>
                    <Ring value={s.admissions.acceptance_rate ?? 0} color={DOMAINS.admissions.color} size={56} stroke={7} label="Acceptance rate">
                      <span className="text-[11px] font-bold">{s.admissions.acceptance_rate === null ? "–" : pctSmart(s.admissions.acceptance_rate)}</span>
                    </Ring>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-14 px-4 pt-8 sm:space-y-28 sm:px-6 sm:pt-12">
        {/* ============================== STATS ============================== */}
        <section aria-label="Dataset at a glance" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="animate-rise rounded-3xl border bg-card p-4 sm:p-6" style={{ animationDelay: `${i * 70}ms` }}>
              <p className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{s.value}</p>
              <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                {s.label}
                {s.term && <InfoTip term={s.term} />}
              </p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </div>
          ))}
        </section>

        {/* ============================== LENSES ============================== */}
        <section>
          <SectionHeading eyebrow="Start with a question" title="What kind of school are you after?" />
          <div className="grid gap-3 max-sm:rail sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {lenses.map((l) => {
              const color = DOMAINS[l.domain].color;
              const Icon = l.icon;
              return (
                <Link
                  key={l.title}
                  href={`/explore?${l.query}`}
                  className="group relative overflow-hidden rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10"
                >
                  <div
                    className="absolute -right-10 -bottom-10 size-36 rounded-full opacity-50 blur-2xl transition-opacity group-hover:opacity-90"
                    style={{ backgroundColor: `color-mix(in oklch, ${color} 40%, transparent)` }}
                  />
                  <div className="relative flex items-start justify-between">
                    <span
                      className="inline-flex size-11 items-center justify-center rounded-2xl text-white shadow-sm"
                      style={{ backgroundColor: color }}
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                      {l.ranked ? "Ranked list" : `${num(l.matches.length)} schools`}
                    </span>
                  </div>
                  <h3 className="relative mt-4 font-display text-xl font-bold">{l.title}</h3>
                  <p className="relative text-sm text-muted-foreground">{l.blurb}</p>
                  <div className="relative mt-4 flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {l.matches.slice(0, 4).map((s) => (
                        <Crest key={s.unit_id} id={s.unit_id} name={s.name} size="sm" className="ring-2 ring-card" />
                      ))}
                    </div>
                    <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ============================== LANDSCAPE ============================== */}
        <section className="grid gap-6 lg:grid-cols-[1fr_2fr] lg:gap-10">
          <div className="lg:pt-6">
            <SectionHeading eyebrow="The big picture" title="The admissions landscape" className="mb-4" />
            <p className="text-muted-foreground">
              The {LANDSCAPE_LIMIT} most-applied-to colleges (of {num(landscapeEligibleCount())} that report both an admit
              rate and SAT scores) on one chart. Further <b className="text-foreground">left</b> means harder to get in; higher
              up means admitted students have higher <Term term="sat">SAT scores</Term>. Bigger dots are bigger campuses.
            </p>
            <ul className="mt-5 space-y-3 text-sm sm:mt-6">
              <li className="flex gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: DOMAINS.admissions.color }} />
                <span>
                  The top-left corner is exclusive: only {ultra.length} colleges admit under 5% of applicants
                  {ultraSat !== null && <>, with a median SAT midpoint of {Math.round(ultraSat)}</>}.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--s1)" }} />
                <span>Big public universities spread across the right, admitting more students at every score level.</span>
              </li>
              <li className="hidden gap-3 sm:flex">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-pop" />
                <span>Hover or tap any dot to meet the school. Click through to its full profile.</span>
              </li>
            </ul>
            <Link href="/explore?view=chart" className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
              Filter this chart in Explore <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="rounded-3xl border bg-card p-3 sm:p-6">
            <ScatterPlot points={landscapePoints(all, LANDSCAPE_LIMIT)} x={LANDSCAPE_X} y={LANDSCAPE_Y} zone={LANDSCAPE_ZONE} />
            <MultiSourceNote schools={all} fields={["admissions.acceptance_rate", "derived.sat_mid", "demographics.undergrad_enrollment"]} className="mt-3" />
          </div>
        </section>

        {/* ============================== VALUE ============================== */}
        <section>
          <SectionHeading eyebrow="Is it worth it?" title="Cost vs. earnings" className="mb-3" />
          <p className="mb-5 max-w-3xl text-sm text-muted-foreground sm:mb-6 sm:text-base">
            What the average student pays each year (counting those who get no grants), against what former students earn ten
            years after enrolling. The shaded corner is below the national median for{" "}
            <Term term="average-cost">average cost</Term> ({moneyCompact(medNP ?? 0)}) and above it for{" "}
            <Term term="median-earnings">earnings</Term> ({moneyCompact(medEarn ?? 0)}). {LANDSCAPE_LIMIT} most-applied-to of{" "}
            {num(valueEligibleCount())} colleges shown.
          </p>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start">
            <div className="min-w-0 rounded-3xl border bg-card p-3 sm:p-6">
              <ScatterPlot points={valuePoints(all, LANDSCAPE_LIMIT)} x={VALUE_X} y={VALUE_Y} zone={valueZone(medNP, medEarn)} />
              <MultiSourceNote schools={all} fields={["cost.avg_paid_all", "outcomes.median_earnings_10yr", "derived.aid_generosity"]} className="mt-3" />
            </div>
            <div className="flex min-w-0 flex-col gap-4 max-sm:flex-row max-sm:gap-3 max-sm:rail">
              <BoardCard title="Highest earnings" term="median-earnings" domain="value" caption="Median, 10 yrs after entry · 1,000+ undergrads">
                <Leaderboard schools={topBy("earnings", "desc", 5, { minUndergrads: 1000 })} get={METRICS.earnings.get} format={moneyCompact} color={DOMAINS.value.color} />
              </BoardCard>
              <BoardCard title="Most generous aid" term="aid-generosity" domain="value" caption="Share of full price covered by grants · 1,000+ undergrads">
                <Leaderboard schools={topBy("aidGenerosity", "desc", 5, { minUndergrads: 1000 })} get={METRICS.aidGenerosity.get} format={(v) => pct(v)} max={1} color={DOMAINS.value.color} />
              </BoardCard>
              <BoardCard title="Lowest average cost" term="average-cost" domain="value" caption="All students, per year · 5,000+ undergrads">
                <Leaderboard schools={topBy("avgCost", "asc", 5, { minUndergrads: 5000 })} get={METRICS.avgCost.get} format={moneyCompact} color={DOMAINS.value.color} />
              </BoardCard>
            </div>
          </div>
        </section>

        {/* ============================== WHAT'S CHANGED ============================== */}
        <WhatsChanged valueColor={DOMAINS.value.color} admissionsColor={DOMAINS.admissions.color} scoresColor={DOMAINS.scores.color} academicsColor={DOMAINS.size.color} />

        {/* ============================== MAP + LEADERBOARDS ============================== */}
        <section>
          <SectionHeading eyebrow="Leaderboards" title="Who stands out" />
          <div className="grid gap-4 max-sm:gap-3 max-sm:rail lg:grid-cols-3">
            <BoardCard title="Hardest to get into" term="acceptance-rate" domain="admissions" caption="Applicants per admit, 1,000+ applicants">
              <Leaderboard schools={topBy("acceptance", "asc", 5, { minApplicants: 1000 })} get={oneIn} format={(v) => `1 in ${v}`} color={DOMAINS.admissions.color} />
            </BoardCard>
            <BoardCard title="Largest enrollment" term="undergrad-enrollment" domain="size" caption="Undergrads, including online students">
              <Leaderboard schools={topBy("enrollment", "desc", 5)} get={METRICS.enrollment.get} format={compact} color={DOMAINS.size.color} />
            </BoardCard>
            <BoardCard title="Most economically diverse" term="pell-grant" domain="access" caption="Pell Grant share, campuses of 5K+ undergrads">
              <Leaderboard schools={topBy("pell", "desc", 5, { minUndergrads: 5000 })} get={METRICS.pell.get} format={(v) => pct(v)} color={DOMAINS.access.color} />
            </BoardCard>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div className="rounded-3xl border bg-card p-4 sm:p-8">
            <SectionHeading eyebrow="Where they are" title="Schools by state" className="mb-5" />
            <StateTileMap counts={countByState()} />
            <SourceNote fields={["location.state"]} className="mt-3" />
            <p className="mt-4 text-xs text-muted-foreground">Tap a highlighted state to see its schools.</p>
          </div>

          {/* Compare CTA */}
          <div className="relative overflow-hidden rounded-3xl bg-foreground p-5 text-background sm:p-8">
            <div className="absolute -top-20 -right-20 size-64 rounded-full blur-3xl" style={{ background: "var(--hero-glow-1)" }} />
            <div className="relative">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
                <Swords className="size-5" />
              </span>
              <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight">Put them head-to-head</h2>
              <p className="mt-2 text-background/70">
                Compare up to four schools with overlaid charts and automatic “key differences.” Start with a classic matchup:
              </p>
              <div className="mt-6 space-y-2">
                {MATCHUPS.map((ids) => {
                  const schools = getSchoolsByIds(ids);
                  return (
                    <Link
                      key={ids.join()}
                      href={`/compare?ids=${ids.join(",")}`}
                      className="group flex items-center gap-3 rounded-2xl bg-background/10 px-3 py-2.5 transition-colors hover:bg-background/20"
                    >
                      <div className="flex -space-x-2">
                        {schools.map((s) => (
                          <Crest key={s.unit_id} id={s.unit_id} name={s.name} size="sm" className="ring-2 ring-foreground" />
                        ))}
                      </div>
                      <span className="flex-1 truncate text-sm font-semibold">
                        {schools.map((s) => shortName(s)).join(" vs. ")}
                      </span>
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ============================== LINGO ============================== */}
        <section>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <SectionHeading eyebrow="Learn the lingo" title="Admissions-speak, translated" className="mb-0" />
            <Link href="/glossary" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
              <BookOpen className="size-4" /> Full glossary
            </Link>
          </div>
          <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:70%] sm:grid-cols-2 lg:grid-cols-4">
            {LINGO.map((key, i) => (
              <Link
                key={key}
                href={`/glossary#${key}`}
                className="group rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30"
              >
                <span className="font-display text-4xl font-extrabold text-muted-foreground/25 sm:text-5xl transition-colors group-hover:text-primary/40">
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-display text-lg font-bold">{GLOSSARY[key].term}</h3>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{GLOSSARY[key].short}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, className = "mb-6" }: { eyebrow: string; title: string; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-bold tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

function BoardCard({
  title,
  term,
  domain,
  caption,
  children,
}: {
  title: string;
  term: TermKey;
  domain: Domain;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3 px-2">
        <span className="mt-1.5 h-6 w-1.5 rounded-full" style={{ backgroundColor: DOMAINS[domain].color }} />
        <div>
          <h3 className="flex items-center gap-1 font-display text-lg font-bold">
            {title} <InfoTip term={term} />
          </h3>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

