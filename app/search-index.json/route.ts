import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getData } from "@/lib/data";
import { buildSearchIndex } from "@/lib/search-index";
import type { AliasRow } from "@/lib/aliases";

/**
 * The search index (specs/serving-architecture.md#3-search-in-the-browser): one entry per college, matched in the
 * browser by lib/search-client.ts so typing never calls a function. Prerendered at `next build` (the deploy carries
 * the data, so the index is versioned by the deploy) and cached by the CDN. Public data only; reads no cookies or
 * session, so it stays static.
 *
 *   GET /search-index.json
 */
export const dynamic = "force-static";

/** data/aliases.json: the dataset keeps its alias rows private, so the route reads the file itself (absent = none). */
function readAliasRows(): AliasRow[] {
  const path = join(process.cwd(), "data", "aliases.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export async function GET() {
  const data = await getData();
  return Response.json(buildSearchIndex(data, readAliasRows()), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
