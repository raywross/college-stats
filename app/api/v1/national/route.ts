import { getData, getHistoryFiles } from "@/lib/data";
import { withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { nationalSummary } from "@/lib/api/serialize";

/**
 * GET /api/v1/national (specs/product/data-api.md "Endpoints"): per metric (lib/metrics.ts METRICS) the national
 * median, how many colleges report it, and its distribution, plus data/history/national.json (null when no history
 * has been built). What the site's percentiles and "typical" lines use.
 */
export const GET = withApiKey("national", async ({ request }) => {
  const [data, files] = await Promise.all([getData(), getHistoryFiles()]);
  return apiJson(nationalSummary(data, files?.national ?? null), { retrieved: data.getMeta().retrieved, request });
});
