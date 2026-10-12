import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { healthCsv } from "@/lib/admin/health";
import { loadHealthView, selectHealthRows } from "@/lib/admin/health-load";
import { parseHealthFilters } from "@/lib/admin/health-view";

/**
 * The Health overview as a CSV (specs/product/admin.md "The overview"): the colleges the page's filters keep, in its
 * sort order, one line each. Admin only: `requireAdmin()` is the first thing that runs, and a signed-out visitor or a
 * non-admin gets the same 404 as any /admin page. The query string is the page's (`?status=stale&group=reported`).
 */
export async function GET(request: NextRequest) {
  await requireAdmin();
  const view = await loadHealthView();
  const rows = selectHealthRows(view, parseHealthFilters(request.nextUrl.searchParams));
  const names = Object.fromEntries(view.all.map((r) => [r.health.unitId, r.name]));
  return new Response(healthCsv(rows.map((r) => r.health), names), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="college-health-${view.overview.today}.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
