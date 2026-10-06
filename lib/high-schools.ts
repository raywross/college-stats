import "server-only";
import { cache } from "react";
import { dataSource } from "@/lib/data";
import { supabaseClient } from "@/lib/supabase";
import type { HighSchool, HighSchoolHit, HighSchoolMeta, HighSchoolView, StateMedians } from "@/lib/high-school-types";
import { buildHighSchoolView, clampLimit, fromPublishedRow, isHighSchoolId } from "@/lib/high-school-core";
import { createJsonHighSchoolStore, highSchoolsDir, type HighSchoolStore } from "@/lib/high-school-store";
import { fetchHighSchool, fetchHighSchoolDetail, fetchHighSchoolFile, searchHighSchoolsRpc } from "@/lib/supabase-high-schools";

/**
 * High school data access (specs/product/high-school-data.md), server only. The same `DATA_SOURCE` switch as
 * lib/data.ts:
 *   - `json`: data/high-schools/ (or HIGH_SCHOOLS_DIR, e.g. tests/fixtures/high-schools for UI work and QA), read
 *     lazily a shard at a time and kept in memory per server instance (lib/high-school-store.ts);
 *   - `supabase`: one row per lookup and the search_high_schools function; never every row (~24K).
 * Fail-soft like getDetail(): a missing table, file, or error is logged and reads as null / [].
 *
 *   const view = await getHighSchool("060000000001");
 *   const hits = await searchHighSchools({ q: "lincoln", state: "CA" });
 */

let store: { dir: string; store: HighSchoolStore } | null = null;

function jsonStore(): HighSchoolStore {
  const dir = highSchoolsDir();
  if (!store || store.dir !== dir) store = { dir, store: createJsonHighSchoolStore(dir) };
  return store.store;
}

function warn(what: string, err: unknown) {
  console.error(`High schools: ${what} failed; rendering without it.`, err);
}

/** meta.json, or null when high school data hasn't been built or published. */
export const getHighSchoolMeta = cache(async (): Promise<HighSchoolMeta | null> => {
  try {
    if (dataSource() === "json") return jsonStore().getHighSchoolMeta();
    return await fetchHighSchoolFile(supabaseClient("read"), "meta");
  } catch (err) {
    warn("loading meta", err);
    return null;
  }
});

const getAllMedians = cache(async (): Promise<StateMedians | null> => {
  if (dataSource() === "json") return null;
  try {
    return await fetchHighSchoolFile(supabaseClient("read"), "medians");
  } catch (err) {
    warn("loading medians", err);
    return null;
  }
});

/** One state's medians over its public high schools (keys: HsFieldPaths incl. `state.*`), or null. */
export const getStateMedians = cache(async (state: string): Promise<StateMedians[string] | null> => {
  if (!/^[A-Za-z]{2}$/.test(state)) return null;
  try {
    if (dataSource() === "json") return jsonStore().getStateMedians(state);
    return (await getAllMedians())?.[state.toUpperCase()] ?? null;
  } catch (err) {
    warn(`loading medians for ${state}`, err);
    return null;
  }
});

/** Everything a high school page needs, or null for an unknown id. */
export const getHighSchool = cache(async (id: string): Promise<HighSchoolView | null> => {
  if (!isHighSchoolId(id)) return null;
  try {
    if (dataSource() === "json") return jsonStore().getHighSchool(id);
    const client = supabaseClient("read");
    const [published, detail, meta, medians] = await Promise.all([
      fetchHighSchool(client, id),
      fetchHighSchoolDetail(client, id).catch((err) => (warn(`loading the profile detail for ${id}`, err), null)),
      getHighSchoolMeta(),
      getAllMedians(),
    ]);
    if (!published || !meta) return null;
    const { school, state_report } = fromPublishedRow(published);
    return buildHighSchoolView(school, { stateReport: state_report, detail, medians, meta });
  } catch (err) {
    warn(`loading high school ${id}`, err);
    return null;
  }
});

/** Name/city search, optionally within a state or kind. Empty `q` lists a state's schools by name (needs `state`). */
export const searchHighSchools = cache(
  async ({ q, state, kind, limit }: { q: string; state?: string | null; kind?: HighSchool["kind"] | null; limit?: number }): Promise<HighSchoolHit[]> => {
    try {
      if (dataSource() === "json") return jsonStore().searchHighSchools({ q, state, kind, limit });
      const max = clampLimit(limit);
      // The SQL function has no kind filter; ask for more and filter here.
      const hits = await searchHighSchoolsRpc(supabaseClient("read"), { q, state, limit: kind ? 50 : max });
      return (kind ? hits.filter((h) => h.kind === kind) : hits).slice(0, max);
    } catch (err) {
      warn("searching", err);
      return [];
    }
  },
);
