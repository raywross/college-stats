import { getData } from "@/lib/data";
import { collegeFacts, datasetStamp } from "@/lib/api/public";
import { json, limitFor, originOf, preflight, PUBLIC_CACHE, tooMany } from "@/lib/api/http";
import { isUnitId } from "@/lib/follow-state";

/** GET /api/v1/colleges/{unit_id}?sections=Admissions,Cost (specs/product/assistants.md). */
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: Request, { params }: { params: Promise<{ unit_id: string }> }) {
  const limit = limitFor(request.headers);
  if (!limit.ok) return tooMany(limit.retryAfter);
  const { unit_id } = await params;
  if (!isUnitId(unit_id)) return json({ error: "unit_id is the college's IPEDS id, digits only." }, { status: 400 });
  const data = await getData();
  const school = data.getSchoolById(unit_id);
  if (!school) return json({ error: `No college with id ${unit_id}.` }, { status: 404 });
  const sectionsParam = new URL(request.url).searchParams.get("sections");
  const sections = sectionsParam ? sectionsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return json(collegeFacts(data, school, originOf(request), sections), { stamp: datasetStamp(data), cache: PUBLIC_CACHE });
}
