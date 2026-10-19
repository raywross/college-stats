import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { familyListUnits } from "@/lib/admin/health";
import { inputsOverview } from "@/lib/admin/estimate-inputs-load";
import { HEALTH_PAGE_SIZE, pageOf } from "@/lib/admin/health-view";
import { filterInputRows, inputsHref, inputsQuery, isFilesQuery, isInputFiltered, parseInputFilters, sortInputRows } from "@/lib/admin/inputs-view";
import { ESTIMATE_INPUT_RULES } from "@/lib/admin/health-rules";
import { dayLabel } from "@/lib/admin/ops-view";
import { HealthTabs } from "@/components/admin/ops/HealthTabs";
import { EstimateInputsStats } from "@/components/admin/ops/EstimateInputsStats";
import { EstimateInputsFilterForm } from "@/components/admin/ops/EstimateInputsFilterForm";
import { EstimateInputsTable } from "@/components/admin/ops/EstimateInputsTable";

export const metadata: Metadata = { title: "Data health", robots: { index: false } };

const BASE = "/admin/health";

/**
 * The Health page's first view (specs/product/admin-health-views.md "View 1"): every college by the health of the
 * facts the admission estimate reads. The stat row, the filters (in the URL), the table worst first; each college's
 * page lists every input's source and dates. Old bookmarks that filtered the per-college groups (`?group=`,
 * `?reason=`) go to the Files view, where that table now lives.
 */
export default async function HealthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  if (isFilesQuery(params)) {
    const q = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
    redirect(`${BASE}/files?${q.toString()}`);
  }
  const filters = parseInputFilters(params);
  const [overview, family] = await Promise.all([inputsOverview(), familyListUnits()]);
  const selected = sortInputRows(filterInputRows(overview.all, filters, family), filters.sort);
  const page = pageOf(selected, filters.page);
  const query = inputsQuery({ ...filters, page: 1 });
  const states = [...new Set(overview.all.map((r) => r.state).filter(Boolean))].sort();
  const total = overview.counts.total;

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Data health</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            How current the facts the admission estimate reads are, college by college. A core input is Fresh when it describes the current cycle (fall{" "}
            {ESTIMATE_INPUT_RULES.currentFall}), Watch when it is a cycle behind or missing, and Stale when it is {ESTIMATE_INPUT_RULES.staleCyclesBehind} or more behind. A
            college with no admit rate that says it isn&apos;t open admission is Failing.
            Measured {dayLabel(overview.today)}.
          </p>
        </div>
        <HealthTabs current="inputs" />
      </header>

      <EstimateInputsStats counts={overview.counts} filters={filters} />

      <EstimateInputsFilterForm filters={filters} states={states} familyAvailable={family !== null} csvHref={`${BASE}/inputs-csv${query ? `?${query}` : ""}`} />

      <p className="text-sm text-muted-foreground" role="status">
        {isInputFiltered(filters) ? `${page.total.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} colleges` : `${page.total.toLocaleString("en-US")} colleges`}
        {page.total > 0 && ` · showing ${page.from.toLocaleString("en-US")} to ${page.to.toLocaleString("en-US")}`}
      </p>

      <EstimateInputsTable rows={page.rows} />

      {page.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {page.page > 1 ? (
            <Link href={inputsHref(BASE, filters, { page: page.page - 1 })} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
              Previous {HEALTH_PAGE_SIZE}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page.page} of {page.pages}
          </span>
          {page.page < page.pages ? (
            <Link href={inputsHref(BASE, filters, { page: page.page + 1 })} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
              Next {HEALTH_PAGE_SIZE}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
