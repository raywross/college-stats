import { getSearchIndexInputs } from "@/lib/data";
import { SNAPSHOT_HEADER } from "@/lib/data-platform/snapshot";
import { buildSearchIndex } from "@/lib/search-index";

/**
 * The search index (specs/serving-architecture.md#3-search-in-the-browser): one entry per college, matched in the
 * browser by lib/search-client.ts so typing never calls a function. Prerendered at `next build` and cached by the
 * CDN; with a published snapshot it is rebuilt when the publisher revalidates. Built from the served dataset and its
 * alias rows (the snapshot's aliases.json), so the index and the pages always agree. Public data
 * only; reads no cookies or session, so it stays static.
 *
 * It carries `x-quad-snapshot` (specs/data-platform/publish.md "Timing and telemetry"): the snapshot this very body
 * was built from, which is what the console reads to tell which snapshot an environment serves.
 *
 *   GET /search-index.json
 */
export const dynamic = "force-static";

export async function GET() {
  const { data, aliases, snapshot } = await getSearchIndexInputs();
  return Response.json(buildSearchIndex(data, aliases), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400", [SNAPSHOT_HEADER]: snapshot },
  });
}
