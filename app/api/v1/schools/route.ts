import { getData } from "@/lib/data";
import { estimatesShown } from "@/lib/cost-curve";
import { resolveNear } from "@/lib/zip-centroids";
import { badRequest, withApiKey } from "@/lib/api/handler";
import { pageOf, parseListQuery, recordKeys } from "@/lib/api/query";
import { apiJson } from "@/lib/api/respond";
import { publicSchool } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools (specs/product/data-api.md "Endpoints"): colleges matching Explore's filters, in Explore's
 * order (`getSchools()` over `parseFilters()`, with the ZIP's center and the estimates gate set the way the Explore
 * page sets them), one page at a time: `{ items, total, next_cursor }`. Items are `publicSchool()` records; `fields=`
 * trims them. lib/api/query.ts parses and validates the query string.
 */
export const GET = withApiKey("schools.list", async ({ request }) => {
  const data = await getData();
  const all = data.getAllSchools();
  const search = new URL(request.url).searchParams;
  const parsed = parseListQuery(search, (name) => recordKeys(all).has(name));
  if (!parsed.ok) return badRequest(parsed.param, parsed.message);
  const { query } = parsed;

  const resolved = resolveNear(query.filters);
  // A ZIP that isn't five digits or isn't in the table would filter nothing: say so rather than return every college.
  if (search.get("near") && !resolved.near) return badRequest("near", "use a five-digit ZIP code the site knows");
  const filters = { ...resolved, showEstimates: estimatesShown() };

  const { items, total, next_cursor } = pageOf(data.getSchools(filters), query);
  return apiJson({ items: items.map((s) => publicSchool(s, query.fields)), total, next_cursor }, { retrieved: data.getMeta().retrieved, request });
});
