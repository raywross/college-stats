import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { exportFor } from "@/lib/admin/people";
import { exportFilename } from "@/lib/account-export";
import { isUuid } from "@/lib/household-hub";
import { SITE_NAME } from "@/lib/brand";

/**
 * Export their data (specs/product/admin.md "A person"): the same JSON file the person's own download builds, read
 * through the admin policies. admin_export() logs `account.export` and writes the access rows the student sees as
 * "Quad support viewed your information" before the file is built.
 *
 * A POST, not a GET: it writes log rows, and a cross-site POST never carries the session cookie (SameSite=Lax) the
 * way a cross-site link click would. The person page submits a plain form to it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ user: string }> }) {
  await requireAdmin();
  const { user } = await params;
  if (!isUuid(user)) notFound();
  try {
    const now = new Date();
    const doc = await exportFor(user, now);
    return new Response(JSON.stringify(doc, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(SITE_NAME, now)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error(`admin: export failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Response("We couldn't build that export. Try again in a moment.", { status: 500 });
  }
}
