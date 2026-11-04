import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, getAccount } from "@/lib/auth";
import { loginHref } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";
import { getData } from "@/lib/data";
import { caseloadCsv, caseloadCsvFilename } from "@/lib/org-caseload";
import { caseloadStudents, myOrganization, orgRoster } from "@/lib/orgs";
import { todayIso } from "@/lib/planner/context";

/**
 * /org/export (specs/product/counselor-portal.md "Export"): the caseload as a CSV for Naviance, Scoir, or a
 * spreadsheet, one row per college per student (a student with an empty list is one row). Read with the counselor's
 * own session, like the caseload page. Never a GPA or a score. A GET so a plain `download` link works; it only reads.
 */
export async function GET(request: NextRequest) {
  if (!authConfigured()) return new Response("Sign-in isn't available here.", { status: 404 });
  const account = await getAccount();
  if (!account) return NextResponse.redirect(new URL(loginHref("/org"), request.nextUrl.origin));
  try {
    const org = await myOrganization();
    if (!org) return NextResponse.redirect(new URL("/org", request.nextUrl.origin));
    const [students, { getSchoolById }] = await Promise.all([orgRoster(org.id).then(caseloadStudents), getData()]);
    const schools: Record<string, { name: string }> = {};
    for (const s of students) for (const i of s.items) schools[i.unit_id] ??= { name: getSchoolById(i.unit_id)?.name ?? i.unit_id };
    const today = todayIso();
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
