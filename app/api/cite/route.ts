import { NextResponse } from "next/server";
import { getData, getSnapshotId } from "@/lib/data";
import { HIDDEN_FIELDS, isFieldPath } from "@/lib/fields";
import { isUnitId } from "@/lib/follow-state";
import { planCiteFor } from "@/lib/planner/plan-cites";
import { gpaCurve, gpaModel } from "@/lib/planner/gpa-model-server";

/** A field path's shape: dot-separated lower-case words (the lib/fields.ts registry's keys). */
const PATH_SHAPE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const MAX_PATH = 160;

/** A day in the browser and the CDN, served stale a week while it refreshes: a citation changes only with a publish. */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const HIDDEN: ReadonlySet<string> = new Set(HIDDEN_FIELDS);

const gpaModels = async () => {
  const [model, curve] = await Promise.all([gpaModel(), gpaCurve()]);
  return { gpaModel: model, gpaCurve: curve };
};

/**
 * GET /api/cite?unit=<unit_id>&path=<field path> (specs/data-lineage.md "Citations on the plan"): one college's full
 * citation for one field (with `unit=` empty, the field's default citation, `citeField(path)`), what `citeField` gives (the GPA fields with the fitted model's formula, as the plan builds
 * them; lib/planner/plan-cites.ts). The plan ships references (lib/lineage.ts `CiteRef`) and its ⓘ fetches this when
 * it opens (components/ui/info-tip.tsx `useCite`). Reads the dataset only: no session, nothing personal, so it is
 * cacheable everywhere, with the snapshot id as its ETag. 400 for a malformed unit or path; 404 for a college the
 * dataset lacks or a path the registry doesn't list (or hides). With `go=1`, a redirect to the source's own page
 * instead, for a link that is always on screen (a calendar row's "Source").
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unitParam = searchParams.get("unit");
  const unit = unitParam ?? "";
  const path = searchParams.get("path") ?? "";
  // An empty unit is a field's default citation (no college: the compare cards' dataset-wide labels; round 5).
  if (unitParam === null || (unit !== "" && !isUnitId(unit)) || path.length > MAX_PATH || !PATH_SHAPE.test(path)) {
    return NextResponse.json({ error: "Pass unit (a college's id) and path (a field path)." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const [data, snapshot] = await Promise.all([getData(), getSnapshotId()]);
  const school = unit === "" ? undefined : data.getSchoolById(unit);
  if (school === null || !isFieldPath(path) || HIDDEN.has(path)) {
    return NextResponse.json({ error: "No such citation." }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  }
  const etag = `"cite-${snapshot}"`;
  const headers = { "Cache-Control": CACHE_CONTROL, ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const cited = school ? planCiteFor(school, path, data.citeField, await gpaModels()) : data.citeField(path);
  if (searchParams.get("go") === "1") {
    const res = NextResponse.redirect(new URL(cited.url, request.url), 302);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  }
  return NextResponse.json(cited, { headers });
}
