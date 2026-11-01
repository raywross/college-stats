import { getData, getHistory, getHistoryFiles } from "@/lib/data";
import { historySources } from "@/lib/history";
import { notFound, withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { publicSeriesKeys, seriesDefinitions } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools/{id}/history (specs/product/data-api.md "Endpoints"): the college's history shard
 * (the snapshot's history/{id}.json, `getHistory()`), and for each public series in it the definition the site charts it
 * with (lib/api/serialize.ts seriesDefinitions: label, the field it extends, unit, what a year means, breaks in
 * comparability, sources) and the files behind them (lib/history.ts historySources), the same shape the MCP tool
 * `get_history` answers with. 404 when the college has no shard.
 */
export const GET = withApiKey<{ id: string }>("schools.history", async ({ request, params }) => {
  const { getSchoolById, getMeta } = await getData();
  if (!getSchoolById(params.id)) return notFound(`No college with unit id ${params.id}.`);
  const history = await getHistory(params.id);
  if (!history) return notFound(`No history for unit id ${params.id}.`);
  const keys = publicSeriesKeys(history);
  const hmeta = (await getHistoryFiles())?.meta ?? null;
  const sources = hmeta ? historySources(keys, hmeta, getMeta()) : [];
  return apiJson({ unit_id: params.id, history, definitions: seriesDefinitions(keys), sources }, { retrieved: getMeta().retrieved, request });
});
