import { getData } from "@/lib/data";
import { datasetStamp, exploreColleges, findColleges } from "@/lib/api/public";
import { json, limitFor, originOf, paramsOf, preflight, PUBLIC_CACHE, tooMany } from "@/lib/api/http";

/**
 * GET /api/v1/colleges?q=emory            the site's name search (specs/product/assistants.md)
 * GET /api/v1/colleges?states=GA&maxAR=40 Explore's filters and sorts, paged
 */
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  const limit = limitFor(request.headers);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const url = new URL(request.url);
  const data = await getData();
  const origin = originOf(request);
  const stamp = datasetStamp(data);
  const q = url.searchParams.get("q");
  if (q !== null && q.trim()) {
    const items = findColleges(data, origin, q, { state: url.searchParams.get("state"), limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined });
    return json({ total: items.length, page: 1, pages: 1, items }, { stamp, cache: PUBLIC_CACHE });
  }
  const params = paramsOf(url);
  const result = exploreColleges(data, origin, params, { limit: Number(params.limit) || undefined, page: Number(params.page) || undefined });
  return json(result, { stamp, cache: PUBLIC_CACHE });
}
