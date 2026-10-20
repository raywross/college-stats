import { getData } from "@/lib/data";
import { badRequest, notFound, withApiKey } from "@/lib/api/handler";
import { isLineageField, parseFieldList } from "@/lib/api/query";
import { apiJson } from "@/lib/api/respond";
import { schoolLineage } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools/{id}/lineage (specs/product/data-api.md "Endpoints"): `{ unit_id, fields }`, the resolved
 * lineage (`lineageFor()`: source, year, method, formula, quote) of every public field the college has a value for.
 * `fields=` narrows to field paths or prefixes.
 */
export const GET = withApiKey<{ id: string }>("schools.lineage", async ({ request, params }) => {
  const { getSchoolById, getMeta } = await getData();
  const fields = parseFieldList(new URL(request.url).searchParams.get("fields"), "fields", isLineageField);
  if (!fields.ok) return badRequest(fields.param, fields.message);
  const school = getSchoolById(params.id);
  if (!school) return notFound(`No college with unit id ${params.id}.`);
  const meta = getMeta();
  return apiJson({ unit_id: school.unit_id, fields: schoolLineage(school, meta, fields.fields) }, { retrieved: meta.retrieved, request });
});
