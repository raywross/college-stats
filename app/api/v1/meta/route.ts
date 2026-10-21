import { getData } from "@/lib/data";
import { withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { datasetMeta } from "@/lib/api/serialize";

/**
 * GET /api/v1/meta (specs/product/data-api.md "Endpoints"): when the dataset was retrieved, its sources, each release's
 * year, the release calendar, and counts: what the Data page shows, from getData().
 */
export const GET = withApiKey("meta", async ({ request }) => {
  const { getMeta, getReleaseCalendar, getDatasetSummary } = await getData();
  const meta = getMeta();
  return apiJson(datasetMeta({ meta, calendar: getReleaseCalendar(), summary: getDatasetSummary() }), { retrieved: meta.retrieved, request });
});
