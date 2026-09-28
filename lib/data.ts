import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { createDataset, type Dataset, type DatasetFiles } from "./dataset";
import { createDatasetLoader } from "./dataset-loader";
import { fetchDatasetFiles, fetchPublishedVersion, supabaseClient } from "./supabase";

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
  // Empty counts as unset, like a variable created in a dashboard without a value.
  const v = (process.env.DATA_SOURCE || "json").trim().toLowerCase();
  if (v !== "json" && v !== "supabase") throw new Error(`DATA_SOURCE must be "json" or "supabase", got "${v}".`);
  return v;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "data", name), "utf8"));
}

function jsonFiles(): DatasetFiles {
  return {
    schools: readJson("schools.json"),
    meta: readJson("meta.json"),
    releaseCalendar: readJson("release-calendar.json"),
  };
}

function createLoader(): () => Promise<Dataset> {
  if (dataSource() === "json") {
    return createDatasetLoader({ load: async () => ({ value: createDataset(jsonFiles()), version: null }) });
  }
  const client = supabaseClient("read");
  return createDatasetLoader({
    load: async () => {
      const { version, ...files } = await fetchDatasetFiles(client);
      return { value: createDataset(files), version };
    },
    currentVersion: () => fetchPublishedVersion(client),
  });
}

let loader: (() => Promise<Dataset>) | null = null;

/**
 * The current dataset, held in memory per server instance. From Supabase, every call first checks which publish
 * the project serves (one small query) and reloads if it's newer, so a page regenerated after a publish
 * (`/api/revalidate`) never bakes in an older copy this instance still holds (specs/supabase.md#revalidation).
 * `cache` makes that one check and one copy per request, so a page never mixes two publishes.
 */
export const getData = cache(async (): Promise<Dataset> => {
  loader ??= createLoader();
  return loader();
});
