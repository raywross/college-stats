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
import type { School } from "@/lib/types";

export const metadata: Metadata = { title: "Data health", robots: { index: false } };

const BASE = "/admin/health";

/**
 * Every college by data health (specs/product/admin.md "The overview"): the stat row of counts by overall and group
 * status, then the table, worst first, filtered by the URL. The health model is computed once per server instance from
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Data health</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          When we received data for each college, group by group, and what decided each status. Health inputs are from {dayLabel(overview.generated)}; measured {dayLabel(overview.today)}.
          {!overview.changesAvailable && " What changed isn't shown here: it comes from the production database."}
        </p>
      </header>

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
        csvHref={`${BASE}/csv${query ? `?${query}` : ""}`}
      />

      <p className="text-sm text-muted-foreground" role="status">
        {isFiltered(filters) ? `${page.total.toLocaleString("en-US")} of ${overview.counts.total.toLocaleString("en-US")} colleges` : `${page.total.toLocaleString("en-US")} colleges`}
        {page.total > 0 && ` · showing ${page.from.toLocaleString("en-US")} to ${page.to.toLocaleString("en-US")}`}
      </p>

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
