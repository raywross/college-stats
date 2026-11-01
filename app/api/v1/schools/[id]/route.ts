import { getData } from "@/lib/data";
import { badRequest, notFound, withApiKey } from "@/lib/api/handler";
import { parseFieldList, recordKeys } from "@/lib/api/query";
import { apiJson } from "@/lib/api/respond";
import { publicSchool } from "@/lib/api/serialize";
import { withLiveEdits } from "@/lib/data-platform/live-edits";

/**
 * GET /api/v1/schools/{id} (specs/product/data-api.md "Endpoints"): one college as `publicSchool()` serves it, the
 * record the site renders less hidden fields; `fields=` keeps the named top-level keys (and unit_id and name).
 */
export const GET = withApiKey<{ id: string }>("schools.get", async ({ request, params }) => {
  const { getSchoolById, getAllSchools, getMeta } = await getData();
  const fields = parseFieldList(new URL(request.url).searchParams.get("fields"), "fields", (name) => recordKeys(getAllSchools()).has(name));
  if (!fields.ok) return badRequest(fields.param, fields.message);
  const stored = getSchoolById(params.id);
  if (!stored) return notFound(`No college with unit id ${params.id}.`);
  // An admin's live edits show here at once, as on the profile (lib/data-platform/live-edits.ts).
  const school = await withLiveEdits(stored);
  return apiJson(publicSchool(school, fields.fields), { retrieved: getMeta().retrieved, request });
});
