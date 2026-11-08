import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { familyListUnits } from "@/lib/admin/health";
import { inputsCsv, inputsOverview } from "@/lib/admin/estimate-inputs-load";
import { filterInputRows, parseInputFilters, sortInputRows } from "@/lib/admin/inputs-view";

/**
 * The Estimate inputs view as a CSV (specs/product/admin-health-views.md "The page"): the colleges the page's filters
 * keep, in its order, one line each with every core input's status, year, and reason. Admin only: `requireAdmin()`
 * runs first, and anyone else gets the same 404 as any /admin page.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const filters = parseInputFilters(request.nextUrl.searchParams);
  const [overview, family] = await Promise.all([inputsOverview(), familyListUnits()]);
  const rows = sortInputRows(filterInputRows(overview.all, filters, family), filters.sort);
  return new Response(inputsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="estimate-inputs-${overview.today}.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
