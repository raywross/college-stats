import type { NextRequest } from "next/server";
import { searchHighSchools } from "@/lib/high-schools";

/**
 * High school search for client components (the `/high-schools` search page's progressive form and the `/me`
 * picker; specs/product/high-school-data.md "Search").
 *
 *   GET /api/high-schools?q=lincoln&state=CA&limit=8
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").slice(0, 80);
  const state = params.get("state")?.slice(0, 2) || undefined;
  const kindParam = params.get("kind");
  const kind = kindParam === "public" || kindParam === "private" ? kindParam : undefined;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 50);
  const hits = await searchHighSchools({ q, state, kind, limit });
  return Response.json(hits, { headers: { "Cache-Control": "public, max-age=300" } });
}
