import { getSnapshotId } from "@/lib/data";

/**
 * GET /api/snapshot (specs/data-platform/publish.md "Environments"; specs/product/admin-speed.md wave 1, fix 8): the id
 * of the data snapshot this deployment serves, as JSON, `{ "snapshot": "<id>" }`, or `{ "snapshot": null }` when it
 * can't tell. The Data overview (lib/admin/data-reads.ts fetchEnvironmentSnapshot) asks each environment here instead
 * of downloading its home page to read the `<meta name="x-quad-snapshot">` tag. Same source as that tag
 * (app/layout.tsx, `getSnapshotId`), so the two always agree. No auth: the id is already in every page's HTML. Never
 * cached: a publish moves it without a redeploy.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getSnapshotId().catch(() => null);
  return Response.json({ snapshot }, { headers: { "Cache-Control": "no-store" } });
}
