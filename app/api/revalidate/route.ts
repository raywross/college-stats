import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/revalidate";

/**
 * Marks every page stale after a publish, so static pages (/, prerendered profiles, /data) regenerate from the new
 * data on their next visit without a redeploy. Called by `npm run publish-data` and the GitHub Action.
 *
 *   curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" https://<site>/api/revalidate
 *
 * Regeneration reads the dataset through getData(), which reloads first if its copy is older than the publish
 * (specs/supabase.md#revalidation).
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  revalidatePath("/", "layout");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
