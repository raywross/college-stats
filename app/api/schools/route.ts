import type { NextRequest } from "next/server";
import { getData, toIndexEntry } from "@/lib/data";

/**
 * Lightweight school lookup for client components (typeahead, compare tray,
 * compare picker), so the full dataset never ships to the browser.
 *
 *   GET /api/schools?q=vand&limit=8&exclude=166027,243744
 *   GET /api/schools?ids=166027,221999
 */
export async function GET(request: NextRequest) {
  const { getSchoolsByIds, searchSchools } = await getData();
  const params = request.nextUrl.searchParams;
  const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean).slice(0, 20);

  const ids = list("ids");
  if (ids.length) {
    return Response.json(getSchoolsByIds(ids).map(toIndexEntry), {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  const q = (params.get("q") ?? "").slice(0, 80);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 20);
  return Response.json(searchSchools(q, limit, list("exclude")), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
