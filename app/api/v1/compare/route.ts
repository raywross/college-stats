import { getData } from "@/lib/data";
import { compareColleges, datasetStamp } from "@/lib/api/public";
import { json, limitFor, originOf, preflight, PUBLIC_CACHE, tooMany } from "@/lib/api/http";

/** GET /api/v1/compare?ids=139658,199120 (two to four unit ids; specs/product/assistants.md). */
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  const limit = limitFor(request.headers);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",");
  const data = await getData();
  const result = compareColleges(data, originOf(request), ids);
  if ("error" in result) return json(result, { status: 400 });
  return json(result, { stamp: datasetStamp(data), cache: PUBLIC_CACHE });
}
