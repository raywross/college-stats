import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { createDataset, type Dataset, type DatasetFiles } from "./dataset";
import { createDatasetLoader } from "./dataset-loader";
import {
  fetchDatasetFiles,
  fetchHistoryFiles,
  fetchHistoryVersion,
  fetchPublishedVersion,
  fetchSchoolHistory,
  supabaseClient,
  type HistoryFiles,
} from "./supabase";
import type { SchoolHistory } from "./history";

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

/* ------------------------------------------------------------------ */
/* History (specs/trends-data.md)                                      */
/* ------------------------------------------------------------------ */

function readHistoryJson<T>(name: string): T | null {
  const path = join(process.cwd(), "data", "history", name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

function jsonHistoryFiles(): HistoryFiles | null {
  const meta = readHistoryJson<HistoryFiles["meta"]>("meta.json");
  if (!meta) return null;
  return {
    meta,
    national: readHistoryJson("national.json")!,
    facts: readHistoryJson("facts.json")!,
    cpi: readHistoryJson("cpi.json")!,
  };
}

let historyLoader: (() => Promise<HistoryFiles | null>) | null = null;

function createHistoryLoader(): () => Promise<HistoryFiles | null> {
  if (dataSource() === "json") return createDatasetLoader({ load: async () => ({ value: jsonHistoryFiles(), version: null }) });
  const client = supabaseClient("read");
  return createDatasetLoader({
    load: async () => {
      const files = await fetchHistoryFiles(client);
      if (!files) return { value: null, version: null };
      const { version, ...value } = files;
      return { value, version };
    },
    currentVersion: () => fetchHistoryVersion(client),
  });
}

/**
 * History's shared files (build metadata, national distributions, Home facts, CPI), or null when no history has
 * been built or published. Reloads after a new publish, like getData().
 */
export const getHistoryFiles = cache(async (): Promise<HistoryFiles | null> => {
  historyLoader ??= createHistoryLoader();
  try {
    return await historyLoader();
  } catch (err) {
    // History is an extra layer: if it can't load (e.g. its migration isn't applied yet), pages render without it.
    console.error("Loading history failed; pages render without it.", err);
    historyLoader = null;
    return null;
  }
});

/** One college's year-by-year history (data/history/schools/{id}.json), or null when it has none. */
export const getHistory = cache(async (unitId: string): Promise<SchoolHistory | null> => {
  if (!/^\d+$/.test(unitId)) return null;
  if (dataSource() === "json") return readHistoryJson<SchoolHistory>(join("schools", `${unitId}.json`));
  try {
    return await fetchSchoolHistory(supabaseClient("read"), unitId);
  } catch (err) {
    console.error(`Loading history for ${unitId} failed; the profile renders without it.`, err);
    return null;
  }
});
