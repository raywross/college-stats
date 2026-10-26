import { getData, getSchoolChanges } from "@/lib/data";
import { describeChange } from "@/lib/changes";
import { notFound, withApiKey } from "@/lib/api/handler";
import { apiJson } from "@/lib/api/respond";
import { isHiddenPath } from "@/lib/api/serialize";

/**
 * GET /api/v1/schools/{id}/changes (specs/product/data-api.md "Endpoints"): the college's recorded changes
 * (`dataset_changes`, newest first) each with `describeChange()`'s sentence in `text`. `getSchoolChanges()` answers
 * [] when Supabase isn't configured or can't be read (it logs that once), so this does too. Changes to hidden fields
 * are left out.
 */
export const GET = withApiKey<{ id: string }>("schools.changes", async ({ request, params }) => {
  const { getSchoolById, getMeta } = await getData();
  const school = getSchoolById(params.id);
  if (!school) return notFound(`No college with unit id ${params.id}.`);
  const changes = await getSchoolChanges(school.unit_id);
  const items = changes.filter((c) => !isHiddenPath(c.field)).map((c) => ({ ...c, text: describeChange(c) }));
  return apiJson({ unit_id: school.unit_id, items }, { retrieved: getMeta().retrieved, request });
});
