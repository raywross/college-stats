import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, getAccount } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { buildAccountExport, exportFilename } from "@/lib/account-export";
import { loginHref } from "@/lib/accounts";
import { SITE_NAME } from "@/lib/brand";

/**
 * "Download my data": one JSON file built by the exporters in lib/account-export.ts, all reading with the user's own
 * session (row-level security applies). A GET so a plain link with `download` works; it only reads, and another site
 * can trigger it but never read the response.
 */
export async function GET(request: NextRequest) {
  if (!authConfigured()) return new Response("Sign-in isn't available here.", { status: 404 });
  const account = await getAccount();
  if (!account) return NextResponse.redirect(new URL(loginHref("/account#data"), request.nextUrl.origin));

  const supabase = await createServerSupabase();
  const { data: students, error } = await supabase
    .from("students")
    .select("id, user_id, managed_by")
    .is("deleted_at", null)
    .or(`user_id.eq.${account.user.id},managed_by.eq.${account.user.id}`);
  if (error) {
    console.error(`export: reading students failed: ${error.message}`);
    return new Response("We couldn't build your export. Try again in a moment.", { status: 500 });
  }
  const own = (students as { id: string; user_id: string | null }[]).find((s) => s.user_id === account.user.id) ?? null;

  try {
    const now = new Date();
    const doc = await buildAccountExport(
      {
        supabase,
        userId: account.user.id,
        email: account.user.email,
        ownStudentId: own?.id ?? null,
        studentIds: (students as { id: string }[]).map((s) => s.id),
      },
      { site: SITE_NAME, now },
    );
    return new Response(JSON.stringify(doc, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(SITE_NAME, now)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return new Response("We couldn't build your export. Try again in a moment.", { status: 500 });
  }
}
