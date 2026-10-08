import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { createDataset, type Dataset, type DatasetFiles } from "./dataset";
import { createDatasetLoader } from "./dataset-loader";
import { fetchSchoolChanges, supabaseClient, type HistoryFiles } from "./supabase";
import type { SchoolHistory } from "./history";
import type { TrendFileName, TrendFiles } from "./trends";
import type { SchoolDetail } from "./detail";
import type { StoredChange } from "./changes";

export { paginate, toIndexEntry, type Dataset, type SchoolIndexEntry, type ScatterPointData } from "./dataset";

/**
 * Data access. The deploy carries the dataset (specs/serving-architecture.md#1-the-deploy-carries-the-dataset):
 * colleges, aliases, history, trend files, and detail tables are always read from the files under data/ (built by
 * `npm run sync-data` and friends, reviewed in pull requests) that next.config.ts traces into every server function.
 * The college dataset (~1,900 colleges) is loaded into memory once per server instance and queried there
 * (lib/dataset.ts). Supabase is read only for the What changed panel (getSchoolChanges below) and for high schools,
 * which have their own switch (lib/high-schools.ts, HIGH_SCHOOLS_SOURCE).
 *
 *   const { getSchoolById, rankOf } = await getData();
 */

// Each read below spells out its path from process.cwd() with literal folder and file names (only a college's ID or a
// trend's name varies), never through a helper taking the segments as variables: the bundler's file tracer then adds
// just those files (a path it can't resolve pulls all of data/, working files included, into every function), and
// tests/tracing.test.mts can check them against next.config.ts's list.

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** A file that may not exist yet (history, trends, details, aliases): absent reads as null, not an error. */
function readOptionalJson<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

function readDatasetFiles(): DatasetFiles {
  return {
    schools: readJson(join(process.cwd(), "data", "schools.json")),
    meta: readJson(join(process.cwd(), "data", "meta.json")),
    releaseCalendar: readJson(join(process.cwd(), "data", "release-calendar.json")),
    // Short names and nicknames (specs/school-identity/aliases.md).
    aliases: readOptionalJson<DatasetFiles["aliases"]>(join(process.cwd(), "data", "aliases.json")) ?? [],
  };
}

let checkedSettings = false;

/** The old files-or-Supabase switch is gone; one still set in an environment gets a single warning per instance. */
function warnAboutRetiredSettings() {
  if (checkedSettings) return;
  checkedSettings = true;
  if (process.env.DATA_SOURCE) console.warn("[data] DATA_SOURCE is ignored: the deploy carries the dataset (specs/serving-architecture.md)");
}

const loadDataset = createDatasetLoader(async () => {
  warnAboutRetiredSettings();
  const start = performance.now();
  const files = readDatasetFiles();
  const dataset = createDataset(files);
  // One line per server instance: what a cold start spends on the dataset (specs/serving-architecture.md#6).
  console.info(`[data] loaded ${files.schools.length} colleges from data/ in ${Math.round(performance.now() - start)} ms`);
  return dataset;
});

/**
 * The dataset, read from data/ on the first call in this server instance and held in memory from then on. It never
 * changes while the instance runs: new data ships as a new deploy. Throws if the first load fails.
 */
export const getData = cache(async (): Promise<Dataset> => loadDataset());

/* ------------------------------------------------------------------ */
/* History (specs/trends-data.md)                                      */
/* ------------------------------------------------------------------ */

function readHistoryFiles(): HistoryFiles | null {
  const meta = readOptionalJson<HistoryFiles["meta"]>(join(process.cwd(), "data", "history", "meta.json"));
  if (!meta) return null;
  return {
    meta,
    national: readJson(join(process.cwd(), "data", "history", "national.json")),
    facts: readJson(join(process.cwd(), "data", "history", "facts.json")),
    cpi: readJson(join(process.cwd(), "data", "history", "cpi.json")),
  };
}

let historyLoader: (() => Promise<HistoryFiles | null>) | null = null;

/**
 * History's shared files (build metadata, national distributions, Home facts, CPI), or null when no history has been
 * built. Read once per server instance, like getData().
 */
export const getHistoryFiles = cache(async (): Promise<HistoryFiles | null> => {
  historyLoader ??= createDatasetLoader(async () => readHistoryFiles());
  try {
    return await historyLoader();
  } catch (err) {
    // History is an extra layer: if it can't load, pages render without it (and a later request tries again).
    console.error("Loading history failed; pages render without it.", err);
    historyLoader = null;
    return null;
  }
});

/** One college's year-by-year history (data/history/schools/{id}.json), or null when it has none. */
export const getHistory = cache(async (unitId: string): Promise<SchoolHistory | null> => {
  if (!/^\d+$/.test(unitId)) return null;
  try {
    return readOptionalJson<SchoolHistory>(join(process.cwd(), "data", "history", "schools", `${unitId}.json`));
  } catch (err) {
    console.error(`Loading history for ${unitId} failed; the profile renders without it.`, err);
    return null;
  }
});

/* ------------------------------------------------------------------ */
/* National trends (specs/national-trends.md)                          */
/* ------------------------------------------------------------------ */

/**
 * One national trend file: data/history/trends/{name}.json (`npm run build-trends`). Null when it hasn't been built:
 * pages render a quiet "not available yet" state, like history. Typed by name through `TrendFiles` (lib/trends.ts).
 */
export const getTrendFile = cache(async <N extends TrendFileName>(name: N): Promise<TrendFiles[N] | null> => {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  try {
    return readOptionalJson<TrendFiles[N]>(join(process.cwd(), "data", "history", "trends", `${name}.json`));
  } catch (err) {
    console.error(`Loading trend file ${name} failed; the page renders without it.`, err);
    return null;
  }
});

/* ------------------------------------------------------------------ */
/* Per-college detail tables (lib/detail.ts)                           */
/* ------------------------------------------------------------------ */

/**
 * One college's detail file (data/detail/schools/{id}.json: home states, later majors), or null when it has none.
 * Fail-soft like getHistory(): a missing or unreadable file renders the profile without it.
 */
export const getDetail = cache(async (unitId: string): Promise<SchoolDetail | null> => {
  if (!/^\d+$/.test(unitId)) return null;
  try {
    return readOptionalJson<SchoolDetail>(join(process.cwd(), "data", "detail", "schools", `${unitId}.json`));
  } catch (err) {
    console.error(`Loading details for ${unitId} failed; the profile renders without them.`, err);
    return null;
  }
});

/* ------------------------------------------------------------------ */
/* What changed (specs/product/follow-colleges.md; lib/changes.ts)     */
/* ------------------------------------------------------------------ */

let changesWarned = false;

/**
 * One college's recorded changes (`dataset_changes`, written by `npm run publish-changes` after each production
 * deploy), newest first. Changes describe publishes, so they live only in Supabase: without SUPABASE_URL there are
 * none and the profile shows no panel. Fail-soft like getHistory(): a missing table, a paused project, or any other
 * error is logged once and the profile renders without the panel. Read with the publishable key, so it's fine in
 * static pages.
 *
 * For local QA of the panel without Supabase, CHANGES_FIXTURE may name a JSON file of StoredChange rows; when it is
 * set and the file exists, it is read instead of Supabase.
 */
export const getSchoolChanges = cache(async (unitId: string): Promise<StoredChange[]> => {
  if (!/^\d+$/.test(unitId)) return [];
  const fixture = process.env.CHANGES_FIXTURE;
  if (fixture && existsSync(fixture)) return readJson<StoredChange[]>(fixture).filter((c) => c.unit_id === unitId);
  if (!process.env.SUPABASE_URL) return [];
  try {
    return await fetchSchoolChanges(supabaseClient("read"), unitId);
  } catch (err) {
    if (!changesWarned) {
      changesWarned = true;
      console.error("Loading what changed failed; profiles render without it.", err);
    }
    return [];
  }
});
