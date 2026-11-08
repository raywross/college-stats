import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, getAccount } from "@/lib/auth";
import { loginHref } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";
import { getData } from "@/lib/data";
import { caseloadCsv, caseloadCsvFilename } from "@/lib/org-caseload";
import { caseloadData } from "@/lib/orgs";
import { withTiming } from "@/lib/timing-server";

/**
 * /org/export (specs/product/counselor-portal.md "Export"): the caseload as a CSV for Naviance, Scoir, or a
 * spreadsheet, one row per college per student (a student with an empty list is one row). Read with the counselor's
 * own session, like the caseload page, from the same data (lib/orgs.ts caseloadData: one bundle beside the account
 * check, two database waves). Never a GPA or a score. A GET so a plain `download` link works; it only reads.
 */
export async function GET(request: NextRequest) {
  if (!authConfigured()) return new Response("Sign-in isn't available here.", { status: 404 });
  return withTiming("/org/export", () => exportCsv(request));
}

async function exportCsv(request: NextRequest): Promise<Response> {
  // Started beside the account check; nothing is answered before it passes, and the bundle asks nothing signed out.
  const dataP = caseloadData();
  const datasetP = getData();
  dataP.catch(() => {});
  datasetP.catch(() => {});
  const account = await getAccount();
  if (!account) return NextResponse.redirect(new URL(loginHref("/org"), request.nextUrl.origin));
  try {
    const data = await dataP;
    if (!data) return NextResponse.redirect(new URL("/org", request.nextUrl.origin));
    const { students, today } = data;
    const { getSchoolById } = await datasetP;
    const schools: Record<string, { name: string }> = {};
    for (const s of students) for (const i of s.items) schools[i.unit_id] ??= { name: getSchoolById(i.unit_id)?.name ?? i.unit_id };
    return new Response(caseloadCsv(students, schools, today), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${caseloadCsvFilename(SITE_NAME, today)}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error(`org export failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Response("We couldn't build the export. Try again in a moment.", { status: 500 });
  }
}
