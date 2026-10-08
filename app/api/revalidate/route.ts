import { SeverityNumber } from "@opentelemetry/api-logs";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { posthogLogger, posthogLoggerProvider } from "@/instrumentation";
import { isAuthorized } from "@/lib/revalidate";

/**
 * Marks every page stale after a publish, so static pages (/, prerendered profiles, /data) regenerate from the new
 * data on their next visit without a redeploy. Kept for use by hand (specs/serving-architecture.md); nothing calls it automatically.
 *
 *   curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" https://<site>/api/revalidate
 *
 * Regeneration reads the dataset through getData(), which reloads first if its copy is older than the publish
 * (specs/supabase.md#revalidation).
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET)) {
    posthogLogger?.emit({
      body: "revalidation request rejected",
      severityNumber: SeverityNumber.WARN,
      attributes: { route: "/api/revalidate", outcome: "unauthorized" },
    });
    after(async () => {
      await posthogLoggerProvider?.forceFlush();
    });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  revalidatePath("/", "layout");
  posthogLogger?.emit({
    body: "site revalidation completed",
    severityNumber: SeverityNumber.INFO,
    attributes: { route: "/api/revalidate", scope: "layout" },
  });
  after(async () => {
    await posthogLoggerProvider?.forceFlush();
  });
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
