import { getData } from "@/lib/data";
import { badRequest, notFound, withApiKey } from "@/lib/api/handler";
import { parseFieldList, recordKeys } from "@/lib/api/query";
import { apiJson } from "@/lib/api/respond";
import { publicSchool } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools/{id} (specs/product/data-api.md "Endpoints"): one college as `publicSchool()` serves it, the
 * record the site renders less hidden fields; `fields=` keeps the named top-level keys (and unit_id and name).
 */
export const GET = withApiKey<{ id: string }>("schools.get", async ({ request, params }) => {
  const { getSchoolById, getAllSchools, getMeta } = await getData();
  const fields = parseFieldList(new URL(request.url).searchParams.get("fields"), "fields", (name) => recordKeys(getAllSchools()).has(name));
  if (!fields.ok) return badRequest(fields.param, fields.message);
  const school = getSchoolById(params.id);
  if (!school) return notFound(`No college with unit id ${params.id}.`);
  return apiJson(publicSchool(school, fields.fields), { retrieved: getMeta().retrieved, request });
});
