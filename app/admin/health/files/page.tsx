import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { getData } from "@/lib/data";
import { loadHealthView, selectHealthRows } from "@/lib/admin/health-load";
import { HEALTH_PAGE_SIZE, healthHref, healthQuery, isFiltered, pageOf, parseHealthFilters, reasonOptions, stateOptions } from "@/lib/admin/health-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { HealthStats } from "@/components/admin/ops/HealthStats";
import { lastRunSummary } from "@/lib/admin/selectivity-history";
import { HealthFilterForm } from "@/components/admin/ops/HealthFilterForm";
import { HealthTable } from "@/components/admin/ops/HealthTable";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { VisitEventsCard } from "@/components/admin/VisitEventsCard";
import { loadVisitEventsHealth } from "@/lib/admin/visit-events";
import type { School } from "@/lib/types";
import { HealthTabs } from "@/components/admin/ops/HealthTabs";
import { SourceFilesTable } from "@/components/admin/ops/SourceFilesTable";
import { inputsOverview, loadSourceFiles } from "@/lib/admin/estimate-inputs-load";

export const metadata: Metadata = { title: "Data health: files", robots: { index: false } };

const BASE = "/admin/health/files";

/**
 * The Health page's Files view (specs/product/admin-health-views.md "View 2"): first every published file the dataset
 * is built from, with the year it describes, its publish date, and its health; then each college's own documents and
 * collection dates (specs/product/admin.md "The overview"): the stat row of counts by overall and group status, then
 * the table, worst first, filtered by the URL. The health model is computed once per server instance from
 * the deployed file (lib/admin/health.ts); the family-list filter reads the database through the admin's session.
 */
export default async function HealthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const filters = parseHealthFilters(await searchParams);
  const view = await loadHealthView();
  const selected = selectHealthRows(view, filters);
  const page = pageOf(selected, filters.page);
  const data = await getData();
  const schools = page.rows.map((r) => data.getSchoolById(r.health.unitId)).filter((s): s is School => s !== null);
  const query = healthQuery({ ...filters, page: 1 });
  const { overview } = view;
  // One line from the selectivity history (specs/chances/selectivity-history.md): tier changes in the last publish.
  const selectivity = await lastRunSummary();
  const visitEvents = await loadVisitEventsHealth();
  const now = new Date();
  const [files, inputs] = await Promise.all([loadSourceFiles(), inputsOverview()]);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Data health</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every file we read: the published files the dataset is built from, then each college&apos;s own documents. Publish dates checked {dayLabel(files.checked)}.
          </p>
        </div>
        <HealthTabs current="files" />
      </header>

      <section aria-labelledby="published-files" className="space-y-3">
        <h2 id="published-files" className="text-lg font-bold">
          Published files
        </h2>
        <SourceFilesTable rows={files.rows} feeds={inputs.feeds} />
      </section>

      <section aria-labelledby="college-documents" className="space-y-1 border-t border-border pt-6">
        <h2 id="college-documents" className="text-lg font-bold">
          Each college&apos;s documents
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
          <Link href="/admin/selectivity" className="font-semibold text-primary underline-offset-4 hover:underline">
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
        csvHref={`/admin/health/csv${query ? `?${query}` : ""}`}
      />

      <p className="text-sm text-muted-foreground" role="status">
        {isFiltered(filters) ? `${page.total.toLocaleString("en-US")} of ${overview.counts.total.toLocaleString("en-US")} colleges` : `${page.total.toLocaleString("en-US")} colleges`}
        {page.total > 0 && ` · showing ${page.from.toLocaleString("en-US")} to ${page.to.toLocaleString("en-US")}`}
      </p>

      <VisitEventsCard health={visitEvents} now={now} />

      <HealthTable rows={page.rows} />

      {page.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {page.page > 1 ? (
            <Link href={healthHref(BASE, filters, { page: page.page - 1 })} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
              Previous {HEALTH_PAGE_SIZE}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page.page} of {page.pages}
          </span>
          {page.page < page.pages ? (
            <Link href={healthHref(BASE, filters, { page: page.page + 1 })} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
              Next {HEALTH_PAGE_SIZE}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <MultiSourceNote schools={schools} fields={["admissions.acceptance_rate"]} className="pt-2" />
    </div>
  );
}
