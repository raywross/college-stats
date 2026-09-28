import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { dataSource, reloadData } from "@/lib/data";
import { checkRevalidateAuth } from "@/lib/revalidate-auth";

/**
 * Called after `npm run publish-data` (the publish-data GitHub Action) so pages built from the previous publish
 * pick up the new one without a redeploy (specs/deployment.md).
 *
 *   curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" https://<site>/api/revalidate
 *
 * Reloads this instance's in-memory copy, then marks every page stale; each re-renders on its next visit.
 * Other warm instances pick up the publish within DATA_TTL_SECONDS, and pages also regenerate hourly.
 */
export async function POST(request: NextRequest) {
  const auth = checkRevalidateAuth(request.headers.get("authorization"), process.env.REVALIDATE_SECRET);
  if (auth === "unconfigured") return Response.json({ error: "REVALIDATE_SECRET is not set" }, { status: 503 });
  if (auth === "denied") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { getAllSchools, getMeta } = await reloadData();
  revalidatePath("/", "layout");
  return Response.json({
    revalidated: true,
    source: dataSource(),
    colleges: getAllSchools().length,
    retrieved: getMeta().retrieved,
  });
}
