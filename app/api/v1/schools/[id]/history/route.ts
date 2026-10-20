import { getData, getHistory } from "@/lib/data";
import { SERIES, isSeriesKey, type SeriesDef } from "@/lib/history";
import { notFound, withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { isHiddenPath } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools/{id}/history (specs/product/data-api.md "Endpoints"): the college's history shard
 * (data/history/schools/{id}.json, `getHistory()`) and, for each series in it, the definition the site charts it
 * with (lib/history.ts SERIES: label, the field it extends, unit, what a year means, breaks in comparability).
 * 404 when the college has no shard.
 */
export const GET = withApiKey<{ id: string }>("schools.history", async ({ request, params }) => {
  const { getSchoolById, getMeta } = await getData();
  if (!getSchoolById(params.id)) return notFound(`No college with unit id ${params.id}.`);
  const history = await getHistory(params.id);
  if (!history) return notFound(`No history for unit id ${params.id}.`);
  const series = Object.fromEntries(
    Object.keys(history.series)
      .filter((k) => isSeriesKey(k) && !isHiddenPath(SERIES[k].field))
      .map((k) => {
        const def: SeriesDef = SERIES[k as keyof typeof SERIES];
        return [k, { label: def.label, short: def.short, field: def.field, unit: def.unit, kind: def.kind, ...("signed" in def ? { signed: true } : {}), breaks: def.breaks ?? [] }];
      }),
  );
  return apiJson({ unit_id: params.id, history, series }, { retrieved: getMeta().retrieved, request });
});
