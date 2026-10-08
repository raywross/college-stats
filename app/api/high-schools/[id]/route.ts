import { toHit } from "@/lib/high-school-core";
import { getHighSchool } from "@/lib/high-schools";

/**
 * One high school's summary, for the `/me` picker to resolve a previously saved id back to a display row
 * (specs/product/high-school-data.md "Shared contracts"). 404 for an unknown or invalid id.
 *
 *   GET /api/high-schools/060000100001
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getHighSchool(id);
  if (!view) return new Response("Not found", { status: 404 });
  return Response.json(toHit(view.school), { headers: { "Cache-Control": "public, max-age=300" } });
}
