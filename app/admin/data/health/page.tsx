import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getData } from "@/lib/data";
import { familyListUnits } from "@/lib/admin/health";
import { loadHealthView, selectHealthRows } from "@/lib/admin/health-load";
import { inputsOverview, loadSourceFiles } from "@/lib/admin/estimate-inputs-load";
import { HEALTH_PAGE_SIZE, healthHref, healthQuery, isFiltered, pageOf, parseHealthFilters, reasonOptions, stateOptions, type HealthPage as Paged } from "@/lib/admin/health-view";
import { filterInputRows, inputsHref, inputsQuery, isFilesQuery, isInputFiltered, parseInputFilters, sortInputRows } from "@/lib/admin/inputs-view";
import { HEALTH_BASE, healthTab, healthTabHref, type HealthTab } from "@/lib/admin/health-tabs";
import { ESTIMATE_INPUT_RULES } from "@/lib/admin/health-rules";
import { dayLabel } from "@/lib/admin/ops-view";
import { lastRunSummary } from "@/lib/admin/selectivity-history";
import { loadVisitEventsHealth } from "@/lib/admin/visit-events";
import type { HelpKey } from "@/lib/admin/help";
import type { School } from "@/lib/types";
import { HealthTabs } from "@/components/admin/ops/HealthTabs";
import { EstimateInputsStats } from "@/components/admin/ops/EstimateInputsStats";
import { EstimateInputsFilterForm } from "@/components/admin/ops/EstimateInputsFilterForm";
import { EstimateInputsTable } from "@/components/admin/ops/EstimateInputsTable";
import { HealthStats } from "@/components/admin/ops/HealthStats";
import { HealthFilterForm } from "@/components/admin/ops/HealthFilterForm";
import { HealthTable } from "@/components/admin/ops/HealthTable";
import { SourceFilesTable } from "@/components/admin/ops/SourceFilesTable";
import { VisitEventsCard } from "@/components/admin/VisitEventsCard";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { PageHeader } from "@/components/admin/Panel";
import { HelpTip } from "@/components/admin/HelpTip";

export const metadata: Metadata = { title: "Data health", robots: { index: false, follow: false } };

type Params = Record<string, string | string[] | undefined>;

/** What a tab puts on the page: its help key and subtitle in the shared header, then its body. */
interface TabView {
  help: HelpKey;
  subtitle: ReactNode;
  body: ReactNode;
}

/**
 * `/admin/data/health` (specs/product/admin-health-views.md; specs/product/admin-redesign.md "Data"): one page, two
 * tabs, one code path. The page checks the admin, reads the tab (lib/admin/health-tabs.ts), and renders the one header
 * and tab bar, whose links carry the filters both tabs share; the tab's loader below fills the body.
 * - **Colleges** (the default): every college by the health of the facts the admission estimate reads: the stat row,
 *   the filters (in the URL), the table worst first; each college's page lists every input's source and dates.
 * - **Sources** (`?tab=sources`, once /admin/health/files): every published file the dataset is built from, then each
 *   college's own documents by group, worst first.
 * Old bookmarks that filtered the per-college groups (`?group=`, `?reason=`) without a tab go to the Sources tab, where
 * that table lives; /admin/health and /admin/health/files redirect here with their query strings.
 */
export default async function HealthPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const params = await searchParams;
  const tab = healthTab(params);
  if (tab === "colleges" && isFilesQuery(params)) {
    const q = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
    q.delete("tab");
    redirect(`${HEALTH_BASE}?tab=sources&${q.toString()}`);
  }
  const view = tab === "sources" ? await sourcesTab(params) : await collegesTab(params);
  const hrefs: Record<HealthTab, string> = { colleges: healthTabHref("colleges", params), sources: healthTabHref("sources", params) };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <PageHeader title="Data health" help={view.help} subtitle={view.subtitle} />
        <HealthTabs current={tab} hrefs={hrefs} />
      </header>
      {view.body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Colleges                                                            */
/* ------------------------------------------------------------------ */

async function collegesTab(params: Params): Promise<TabView> {
  const filters = parseInputFilters(params);
  const [overview, family] = await Promise.all([inputsOverview(), familyListUnits()]);
  const selected = sortInputRows(filterInputRows(overview.all, filters, family), filters.sort);
  const page = pageOf(selected, filters.page);
  const query = inputsQuery({ ...filters, page: 1 });
  const states = [...new Set(overview.all.map((r) => r.state).filter(Boolean))].sort();
  return {
    help: "data-health",
    subtitle: (
      <>
        How current the facts the admission estimate reads are, college by college. A core input is Fresh when it describes the current cycle (fall{" "}
        {ESTIMATE_INPUT_RULES.currentFall}), Watch when it is a cycle behind or missing, and Stale when it is {ESTIMATE_INPUT_RULES.staleCyclesBehind} or more behind. A college
        with no admit rate that says it isn&apos;t open admission is Failing. Measured {dayLabel(overview.today)}.
      </>
    ),
    body: (
      <>
        <EstimateInputsStats counts={overview.counts} filters={filters} />
        <EstimateInputsFilterForm filters={filters} states={states} familyAvailable={family !== null} csvHref={`${HEALTH_BASE}/inputs-csv${query ? `?${query}` : ""}`} />
        <Showing page={page} total={overview.counts.total} filtered={isInputFiltered(filters)} />
        <EstimateInputsTable rows={page.rows} />
        <Pager page={page} href={(n) => inputsHref(HEALTH_BASE, filters, { page: n })} />
      </>
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

const SOURCES_BASE = `${HEALTH_BASE}?tab=sources`;

async function sourcesTab(params: Params): Promise<TabView> {
  const filters = parseHealthFilters(params);
  const view = await loadHealthView();
  const selected = selectHealthRows(view, filters);
  const page = pageOf(selected, filters.page);
  const data = await getData();
  const schools = page.rows.map((r) => data.getSchoolById(r.health.unitId)).filter((s): s is School => s !== null);
  const query = healthQuery({ ...filters, page: 1 });
  const { overview } = view;
  // One line from the selectivity history (specs/chances/selectivity-history.md): tier changes in the last publish.
  const [selectivity, visitEvents, files, inputs] = await Promise.all([lastRunSummary(), loadVisitEventsHealth(), loadSourceFiles(), inputsOverview()]);
  const now = new Date();
  return {
    help: "sources",
    subtitle: <>Every file we read: the published files the dataset is built from, then each college&apos;s own documents. Publish dates checked {dayLabel(files.checked)}.</>,
    body: (
      <>
        <section aria-labelledby="published-files" className="space-y-3">
          <h2 id="published-files" className="inline-flex items-center gap-1.5 text-lg font-bold">
            Published files <HelpTip help="health-sources" />
          </h2>
          <SourceFilesTable rows={files.rows} feeds={inputs.feeds} />
        </section>

        <section aria-labelledby="college-documents" className="space-y-1 border-t border-border pt-6">
          <h2 id="college-documents" className="inline-flex items-center gap-1.5 text-lg font-bold">
            Each college&apos;s documents <HelpTip help="college-documents" />
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            When we received data for each college, group by group, and what decided each status. Health inputs are from {dayLabel(overview.generated)}; measured {dayLabel(overview.today)}.
            {!overview.changesAvailable && " What changed isn't shown here: it comes from the production database."}
          </p>
        </section>

        <HealthStats counts={overview.counts} filters={filters} />
        {selectivity && (
          <p className="text-sm text-muted-foreground">
            Selectivity:{" "}
            <Link href="/admin/data/selectivity" className="font-semibold text-primary underline-offset-4 hover:underline">
              {selectivity.tierChanges} tier {selectivity.tierChanges === 1 ? "change" : "changes"} in the last publish
            </Link>{" "}
            ({selectivity.run.cause === "method" ? "a method change" : selectivity.run.cause === "backfill" ? "backfilled" : "new figures"}).
          </p>
        )}

        <HealthFilterForm
          filters={filters}
          reasons={reasonOptions(view.all)}
          states={stateOptions(view.all)}
          familyAvailable={view.family !== null}
          csvHref={`${HEALTH_BASE}/csv${query ? `?${query}` : ""}`}
        />
        <Showing page={page} total={overview.counts.total} filtered={isFiltered(filters)} />
        <VisitEventsCard health={visitEvents} now={now} />
        <HealthTable rows={page.rows} />
        <Pager page={page} href={(n) => healthHref(SOURCES_BASE, filters, { page: n })} />
        <MultiSourceNote schools={schools} fields={["admissions.acceptance_rate"]} className="pt-2" />
      </>
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

const fmtCount = (n: number) => n.toLocaleString("en-US");

/** "12 of 1,900 colleges · showing 1 to 12", announced when the filters change. */
function Showing({ page, total, filtered }: { page: Paged<unknown>; total: number; filtered: boolean }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {filtered ? `${fmtCount(page.total)} of ${fmtCount(total)} colleges` : `${fmtCount(page.total)} colleges`}
      {page.total > 0 && ` · showing ${fmtCount(page.from)} to ${fmtCount(page.to)}`}
    </p>
  );
}

/** Previous and Next by HEALTH_PAGE_SIZE, each 44 px tall, when there is more than one page. */
function Pager({ page, href }: { page: Paged<unknown>; href: (n: number) => string }) {
  if (page.pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
      {page.page > 1 ? (
        <Link href={href(page.page - 1)} rel="prev" className="inline-flex min-h-11 items-center underline decoration-dotted underline-offset-2">
          Previous {HEALTH_PAGE_SIZE}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page.page} of {page.pages}
      </span>
      {page.page < page.pages ? (
        <Link href={href(page.page + 1)} rel="next" className="inline-flex min-h-11 items-center underline decoration-dotted underline-offset-2">
          Next {HEALTH_PAGE_SIZE}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
