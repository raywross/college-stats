import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { getData, paginate, type Dataset } from "@/lib/data";
import { parseFilters, parseView, countActiveFilters } from "@/lib/params";
import { METRICS, SIZE_BUCKETS, median, satMid, sizeBucket } from "@/lib/metrics";
import { pctSmart, compact, num, typeLabel } from "@/lib/format";
import { Pagination } from "@/components/explore/Pagination";
import { SchoolCard } from "@/components/school/SchoolCard";
import { SchoolRow } from "@/components/school/SchoolRow";
import { SchoolTable } from "@/components/explore/SchoolTable";
import { FilterPanel, type FilterFacets } from "@/components/explore/FilterPanel";
import { MobileFilterSheet } from "@/components/explore/MobileFilterSheet";
import { ActiveFilters, ExploreSearchInput, SortControl, ViewToggle } from "@/components/explore/Toolbar";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { DotMap } from "@/components/charts/DotMap";
import { MAP_HEIGHT, MAP_WIDTH, mapPoints, usOutline } from "@/lib/us-map";
import { LANDSCAPE_X, LANDSCAPE_Y, LANDSCAPE_ZONE, STICKER_X, STICKER_Y, VALUE_X, VALUE_Y, valueZone } from "@/lib/chart-configs";
import { cn } from "@/lib/utils";
import { INDICATOR_KEYS, indicatorOf, type Direction } from "@/lib/indicators";
import { genderBalanceOf, isMostlyFullTime } from "@/lib/student-body";
import { hasFewLoans } from "@/lib/repayment";
import { hasSmallPellGap } from "@/lib/graduation-groups";
import { HOUSING_FILTERS } from "@/lib/housing";
import { FACTOR_FILTERS } from "@/lib/factors";
import { RESIDENCY_FILTERS } from "@/lib/cds/residency-display";
import { DESIGNATION_KEYS, RESEARCH_TIERS, SETTING_GROUPS, designationsOf, isOpportunityCollege } from "@/lib/campus-profile";
import { DIVISION_FILTERS, ROTC_BRANCHES, divisionFilterOf } from "@/lib/campus-services";
import { MAX_RATIO_OPTIONS, MIN_FULL_TIME_FACULTY_OPTIONS } from "@/lib/academics";
import { drawsNationally } from "@/lib/residence";
import { noCssProfile, offersInternationalAid } from "@/lib/cds/financial-aid";
import { fieldFacets } from "@/lib/majors";
import { policyBucket } from "@/lib/test-policy";
import { InfoTip } from "@/components/ui/info-tip";
import { BaselineNote } from "@/components/ui/BaselineNote";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";

export const metadata: Metadata = { title: "Explore colleges" };

function buildFacets({ getAllSchools, histogram }: Dataset): FilterFacets {
  const all = getAllSchools();
  const tally = (get: (s: (typeof all)[number]) => string) =>
    all.reduce<Record<string, number>>((acc, s) => ((acc[get(s)] = (acc[get(s)] ?? 0) + 1), acc), {});

  const states = tally((s) => s.location.state);
  const regions = tally((s) => s.location.region);
  const types = tally((s) => s.type);
  const sizes = tally((s) => sizeBucket(s.demographics.undergrad_enrollment).key);

  const trends = Object.fromEntries(
    INDICATOR_KEYS.map((k) => {
      const counts: Record<Direction, number> = { up: 0, steady: 0, down: 0 };
      for (const s of all) {
        const i = indicatorOf(s, k);
        if (i) counts[i.direction]++;
      }
      return [k, counts];
    })
  ) as FilterFacets["trends"];

  const balance: FilterFacets["balance"] = { women: 0, balanced: 0, men: 0 };
  for (const s of all) {
    const b = genderBalanceOf(s);
    if (b) balance[b]++;
  }

  // Test policy (lib/test-policy.ts): each college's newest policy.
  const policy: FilterFacets["policy"] = { required: 0, optional: 0, blind: 0 };
  for (const s of all) {
    const b = policyBucket(s.admissions.test_policy);
    if (b) policy[b]++;
  }

  const campus: FilterFacets["campus"] = {
    setting: Object.fromEntries(SETTING_GROUPS.map((g) => [g.key, 0])) as FilterFacets["campus"]["setting"],
    research: Object.fromEntries(RESEARCH_TIERS.map((r) => [r, 0])) as FilterFacets["campus"]["research"],
    designation: Object.fromEntries(DESIGNATION_KEYS.map((d) => [d, 0])) as FilterFacets["campus"]["designation"],
    opportunity: all.filter(isOpportunityCollege).length,
  };
  for (const s of all) {
    if (s.campus?.setting) campus.setting[s.campus.setting.group]++;
    if (s.campus?.carnegie?.research) campus.research[s.campus.carnegie.research]++;
    for (const d of designationsOf(s)) campus.designation[d]++;
  }

  const ratios = all.map((s) => s.academics?.student_faculty_ratio).filter((v): v is number => v != null);
  const maxRatio = Object.fromEntries(MAX_RATIO_OPTIONS.map((n) => [n, ratios.filter((v) => v <= n).length]));

  const ftShares = all.map((s) => s.academics?.faculty?.full_time_share).filter((v): v is number => v != null);
  const minFullTimeFaculty = Object.fromEntries(MIN_FULL_TIME_FACULTY_OPTIONS.map((n) => [n, ftShares.filter((v) => v >= n).length]));

  const services: FilterFacets["services"] = {
    division: Object.fromEntries(DIVISION_FILTERS.map((d) => [d, 0])) as FilterFacets["services"]["division"],
    football: all.filter((s) => s.campus?.athletics?.sports.includes("football")).length,
    rotc: Object.fromEntries(ROTC_BRANCHES.map((b) => [b, all.filter((s) => s.campus?.programs?.rotc.includes(b)).length])) as FilterFacets["services"]["rotc"],
    ugResearch: all.filter((s) => s.campus?.programs?.undergrad_research).length,
    studyAbroad: all.filter((s) => s.campus?.programs?.study_abroad).length,
  };
  for (const s of all) {
    const d = divisionFilterOf(s);
    if (d) services.division[d]++;
  }

  const satRange: [number, number] = [800, 1600];
  return {
    maxRatio,
    medianRatio: median(ratios),
    minFullTimeFaculty,
    medianFullTimeFaculty: median(ftShares),
    services,
    balance,
    policy,
    fullTime: all.filter(isMostlyFullTime).length,
    fewLoans: all.filter(hasFewLoans).length,
    pellGap: all.filter(hasSmallPellGap).length,
    national: all.filter(drawsNationally).length,
    aidNoCss: all.filter(noCssProfile).length,
    intlAid: all.filter(offersInternationalAid).length,
    fields: fieldFacets(all),
    housing: Object.fromEntries(HOUSING_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["housing"],
    factors: Object.fromEntries(FACTOR_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["factors"],
    residency: Object.fromEntries(RESIDENCY_FILTERS.map((f) => [f.param, all.filter(f.test).length])) as FilterFacets["residency"],
    campus,
    states: Object.keys(states).sort().map((value) => ({ value, count: states[value] })),
    regions: Object.keys(regions).sort().map((value) => ({ value, count: regions[value] })),
    types: Object.keys(types).map((value) => ({ value, label: typeLabel(value), count: types[value] })),
    sizes,
    arBins: histogram("acceptance", 20, [0, 1]),
    satBins: histogram("sat", 32, satRange),
    costBins: histogram("avgCost", 32, [0, 80000]),
    satRange,
    trends,
  };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const data = await getData();
  const { getAllSchools, getSchools, landscapeEligibleCount, landscapePoints, metricMedian, stickerEligibleCount, stickerPoints, valueEligibleCount, valuePoints } = data;
  const filters = parseFilters(params);
  const view = parseView(params);
  const schools = getSchools(filters);
  const perPage = view === "table" ? 50 : 24;
  const pageNum = Number(typeof params.page === "string" ? params.page : 1) || 1;
  const paged = paginate(schools, pageNum, perPage);
  const CHART_LIMIT = 600;
  const chart = typeof params.chart === "string" ? params.chart : "admissions";
  const all = getAllSchools();
  const facets = buildFacets(data);
  const activeCount = countActiveFilters(params);

  const medAR = median(schools.map((s) => s.admissions.acceptance_rate));
  const medSat = median(schools.map(satMid));
  const summary =
    schools.length > 0
      ? [
          { label: "Admit rate", value: medAR === null ? "–" : pctSmart(medAR), term: "acceptance-rate" as const, color: "var(--d-admissions)" },
          { label: "SAT midpoint", value: medSat === null ? "–" : String(Math.round(medSat)), term: "sat" as const, color: "var(--d-scores)" },
          { label: "Undergrads", value: compact(schools.reduce((a, s) => a + s.demographics.undergrad_enrollment, 0)), term: "undergrad-enrollment" as const, color: "var(--d-size)" },
        ]
      : [];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      {/* Page header */}
      <header className="mb-4 flex flex-col gap-3 sm:mb-8 sm:gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Explore</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Find your <span className="highlight">fit</span>
          </h1>
          <p className="mt-2 hidden max-w-xl text-muted-foreground sm:block">
            Filter by selectivity, scores, and size, then switch between cards, a sortable table, charts, or a map.
          </p>
        </div>
        {summary.length > 0 && (
          <dl className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Median admit rate and SAT midpoint, and total undergrads, for matching schools">
            {summary.map((s) => (
              <div key={s.label} className="rounded-2xl border bg-card px-3 py-2 sm:px-4 sm:py-2.5">
                <dt className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground sm:text-[11px]">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate">{s.label}</span>
                  <InfoTip term={s.term} className="hidden sm:inline-flex" />
                </dt>
                <dd className="font-display text-lg font-extrabold sm:text-2xl">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <div className="flex gap-8">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-3xl border bg-card p-5 no-scrollbar">
            <Suspense>
              <FilterPanel facets={facets} />
            </Suspense>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
          <Suspense>
            {/* Phones: two rows that always fit: Search · Filters, then Sort · View. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
              <ExploreSearchInput />
              <MobileFilterSheet facets={facets} activeCount={activeCount} resultCount={schools.length} />
              <SortControl />
              <ViewToggle />
            </div>
            <ActiveFilters />
          </Suspense>

          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-bold text-foreground">{num(schools.length)}</span> of {num(all.length)} colleges match
            {paged.pages > 1 && view !== "chart" && view !== "map" && <> · page {paged.page} of {paged.pages}</>}
          </p>

          {schools.length === 0 ? (
            <div className="flex flex-col items-center rounded-3xl border border-dashed px-6 py-16 text-center">
              <span className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
                <SearchX className="size-7" />
              </span>
              <p className="font-display text-xl font-bold">No schools match all of that</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Try widening the acceptance-rate or SAT range, or remove a filter chip above.
              </p>
              <Link href="/explore" className="mt-5 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background">
                Reset all filters
              </Link>
            </div>
          ) : view === "table" ? (
            <SchoolTable schools={paged.items} params={params} />
          ) : view === "map" ? (
            (() => {
              const map = mapPoints(schools);
              return (
                <div className="rounded-3xl border bg-card p-3 sm:p-6">
                  <h2 className="mb-2 font-display text-lg font-bold sm:text-xl">Where they are</h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {num(map.points.length)} matching colleges.{" "}
                    {map.outside > 0 && <>{num(map.outside)} in U.S. territories {map.outside === 1 ? "isn't" : "aren't"} drawn. </>}
                    {map.missing > 0 && <>{num(map.missing)} without a reported location {map.missing === 1 ? "isn't" : "aren't"} either. </>}
                    Hover or tap a dot for details; click to open the profile. Filter by setting{" "}
                    <InfoTip term="locale" /> under Campus.
                  </p>
                  <DotMap points={map.points} outline={usOutline()} box={{ width: MAP_WIDTH, height: MAP_HEIGHT }} />
                </div>
              );
            })()
          ) : view === "chart" ? (
            <div className="rounded-3xl border bg-card p-3 sm:p-6">
              <div className="mb-2 flex
 flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold sm:text-xl">
                  {chart === "value" ? "Cost vs. earnings" : chart === "sticker" ? "Sticker price vs. what students pay" : "The admissions landscape"}
                </h2>
                <div role="tablist" aria-label="Chart" className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-full border bg-muted/60 p-1">
                  {[
                    { key: "admissions", label: "Admissions" },
                    { key: "value", label: "Cost vs. earnings" },
                    { key: "sticker", label: "Sticker vs. actual" },
                  ].map((t) => {
                    const next = new URLSearchParams();
                    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v && k !== "chart") next.set(k, v);
                    if (t.key !== "admissions") next.set("chart", t.key);
                    const activeTab = (["value", "sticker"].includes(chart) ? chart : "admissions") === t.key;
                    return (
                      <Link
                        key={t.key}
                        role="tab"
                        aria-selected={activeTab}
                        scroll={false}
                        href={`/explore?${next}`}
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors",
                          activeTab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {t.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
              {chart === "sticker" ? (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Each college&apos;s full sticker price against what the average first-year actually paid after grants. The
                    line is &ldquo;no aid&rdquo;: the further a dot sits below it, the more generous the college&apos;s grants{" "}
                    <InfoTip term="aid-generosity" />.{" "}
                    {stickerEligibleCount(schools) > CHART_LIMIT
                      ? `Showing the ${CHART_LIMIT} most-applied-to of ${num(stickerEligibleCount(schools))} matching colleges.`
                      : `${num(stickerEligibleCount(schools))} matching colleges.`}
                  </p>
                  <ScatterPlot points={stickerPoints(schools, CHART_LIMIT)} x={STICKER_X} y={STICKER_Y} diagonal="No aid: pays full price" />
                </>
              ) : chart === "value" ? (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {valueEligibleCount(schools) > CHART_LIMIT
                      ? `Showing the ${CHART_LIMIT} most-applied-to of ${num(valueEligibleCount(schools))} matching colleges with enough data for average cost and earnings.`
                      : `${num(valueEligibleCount(schools))} matching colleges report both net price and earnings.`}{" "}
                    Top-left means lower cost and higher earnings.
                  </p>
                  <ScatterPlot
                    points={valuePoints(schools, CHART_LIMIT)}
                    x={VALUE_X}
                    y={VALUE_Y}
                    zone={valueZone(metricMedian("avgCost"), metricMedian("earnings"))}
                  />
                </>
              ) : (
                <>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {landscapeEligibleCount(schools) > CHART_LIMIT
                      ? `Showing the ${CHART_LIMIT} most-applied-to of ${num(landscapeEligibleCount(schools))} matching colleges that report both an admit rate and SAT scores.`
                      : `${num(landscapeEligibleCount(schools))} matching colleges report both an admit rate and SAT scores.`}{" "}
                    Tap or hover a dot for details; click to open the profile.
                  </p>
                  <ScatterPlot points={landscapePoints(schools, CHART_LIMIT)} x={LANDSCAPE_X} y={LANDSCAPE_Y} zone={LANDSCAPE_ZONE} />
                </>
              )}
            </div>
          ) : (
            <>
              <ul className="space-y-2 sm:hidden">
                {paged.items.map((s) => (
                  <li key={s.unit_id}>
                    <SchoolRow school={s} />
                  </li>
                ))}
              </ul>
              <div className="hidden gap-4 sm:grid sm:grid-cols-2 2xl:grid-cols-3">
                {paged.items.map((s, i) => (
                  <SchoolCard key={s.unit_id} school={s} index={i} />
                ))}
              </div>
            </>
          )}

          {view !== "chart" && view !== "map" && (
            <Pagination params={params} page={paged.page} pages={paged.pages} total={paged.total} perPage={perPage} />
          )}

          <MultiSourceNote schools={schools} fields={[...Object.values(METRICS).map((m) => m.field), "academics.majors_top", ...(view === "map" ? (["location.lat", "campus.setting"] as const) : [])]} className="pt-2" />
          <BaselineNote className="pt-1" />

          {schools.length > 0 && (
            <p className={cn("pt-2 text-xs text-muted-foreground", view === "grid" && "hidden sm:block")}>
              Card meters show where each college ranks among all {num(all.length)} that report that measure. A dash means not reported.{" "}
              <InfoTip term="percentile-rank" />
              {" "}Size buckets: {SIZE_BUCKETS.map((b) => `${b.label} ${b.hint}`).join(", ")}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
