import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { createDataset, type Dataset, type DatasetFiles } from "./dataset";
import { fetchDatasetFiles, supabaseClient } from "./supabase";

export { paginate, toIndexEntry, type Dataset, type SchoolIndexEntry, type ScatterPointData } from "./dataset";

/**
 * Data access. `DATA_SOURCE` picks where the dataset is read from (specs/supabase.md):
 *   - `json` (default): data/*.json, built by `npm run sync-data` and committed to git.
 *   - `supabase`: the copy `npm run publish-data` uploaded to the Supabase project in SUPABASE_URL.
 * Either way the whole dataset (~1,900 colleges) is loaded into memory and queried there (lib/dataset.ts).
 *
 *   const { getSchoolById, rankOf } = await getData();
 */

export type DataSource = "json" | "supabase";

export function dataSource(): DataSource {
  const v = (process.env.DATA_SOURCE ?? "json").trim().toLowerCase();
  if (v !== "json" && v !== "supabase") throw new Error(`DATA_SOURCE must be "json" or "supabase", got "${v}".`);
  return v;
}

/** How long a Supabase copy is served before it's re-read in the background (seconds). */
const TTL_MS = Number(process.env.DATA_TTL_SECONDS ?? 600) * 1000;

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "data", name), "utf8"));
}

async function loadFiles(): Promise<DatasetFiles> {
  if (dataSource() === "supabase") return fetchDatasetFiles(supabaseClient("read"));
  return {
    schools: readJson("schools.json"),
    meta: readJson("meta.json"),
    releaseCalendar: readJson("release-calendar.json"),
  };
}

let loaded: Dataset | null = null;
let loadedAt = 0;
let inflight: Promise<Dataset> | null = null;

function reload(): Promise<Dataset> {
  inflight ??= loadFiles()
    .then((files) => {
      loaded = createDataset(files);
      loadedAt = Date.now();
      return loaded;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The current dataset, loaded once per server process. From Supabase, a copy older than DATA_TTL_SECONDS
 * is refreshed in the background while the old one keeps serving (and keeps serving if the refresh fails).
 * `cache` pins one copy per request, so a page never mixes two publishes.
 */
export const getData = cache(async (): Promise<Dataset> => {
  if (!loaded) return reload();
  if (dataSource() === "supabase" && Date.now() - loadedAt > TTL_MS) {
    reload().catch((err) => console.error("Dataset refresh from Supabase failed; serving the previous copy.", err));
  }
  return loaded;
});
