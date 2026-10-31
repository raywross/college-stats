import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";
import { createDataset, type Dataset, type DatasetFiles } from "./dataset";
import { createDatasetLoader } from "./dataset-loader";
import {
  createSnapshotHolder,
  installSnapshotHolder,
  readBundledShard,
  readShard,
  snapshotSource,
  type Served,
  type ShardKind,
  type SnapshotContent,
  type SnapshotHolder,
  type SnapshotSource,
} from "./data-platform/loader";
import { REFERENCE_OBJECTS } from "./data-platform/snapshot";
import type { AliasRow } from "./aliases";
import { fetchSchoolChanges, supabaseClient, type HistoryFiles } from "./supabase";
import type { SchoolHistory } from "./history";
import type { TrendFileName, TrendFiles } from "./trends";
import type { CommonAppTrendsFile } from "./common-app/trends";
import type { SchoolDetail } from "./detail";
import type { StoredChange } from "./changes";
import type { PlatformPromptsFile } from "./types";

export { paginate, toIndexEntry, type Dataset, type SchoolIndexEntry, type ScatterPointData } from "./dataset";

/**
 * Data access. The app holds the whole college dataset in memory and queries it there (lib/dataset.ts); this module
 * decides where the bytes come from (specs/data-platform/publish.md "The loader"; lib/data-platform/loader.ts):
 * - DATA_SNAPSHOT_URL set: the published snapshot in Storage. The bundled copy (`.data/snapshot/`, written by
 *   `npm run fetch-snapshot` at build time) serves the first request; the pointer is re-read at most once a minute
 *   and another snapshot replaces the dataset whole. Shards (history, detail, trends, reference files) are fetched
 *   for the snapshot the request's dataset came from.
 * - Unset, with a bundled copy: that copy, for the life of the deploy.
 * - Neither: the files under data/ (built by `npm run sync-data` and friends) that next.config.ts traces into every
 *   server function, read exactly as before the data platform (phase 1 keeps them; specs/data-platform/rollout.md).
 * Supabase is read only for the What changed panel (getSchoolChanges below) and for high schools, which have their
 * own switch (lib/high-schools.ts, HIGH_SCHOOLS_SOURCE).
 *
 *   const { getSchoolById, rankOf } = await getData();
 */

// Each read below spells out its path from process.cwd() with literal folder and file names (only a college's ID or a
// trend's name varies), never through a helper taking the segments as variables: the bundler's file tracer then adds
// just those files (a path it can't resolve pulls all of data/, working files included, into every function), and
// tests/tracing.test.mts can check them against next.config.ts's list. The bundled copy's reads follow the same rule
// in lib/data-platform/loader.ts.

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

let source: SnapshotSource | null = null;

/** Where this instance's dataset comes from, decided once (the environment and the deploy's files don't change). */
function dataSource(): SnapshotSource {
  source ??= snapshotSource();
  return source;
}

let holder: SnapshotHolder<Dataset> | null = null;

/**
 * The instance's one holder. It logs one line per load and per swap (specs/serving-architecture.md#6): `[data] loaded
 * N colleges from data/ in M ms` for data/, `[data] loaded N colleges (snapshot <id>) in M ms` for a snapshot.
 */
function snapshotHolder(): SnapshotHolder<Dataset> {
  if (holder) return holder;
  holder = createSnapshotHolder<Dataset>({
    source: dataSource(),
    readLegacy: (): SnapshotContent => ({ id: "legacy", files: readDatasetFiles(), history: null }),
    build: (content) => createDataset(content.files),
    // Loaded on the first swap only, so the data/ and bundled sources load nothing they didn't before.
    onSwap: ({ from, to, ms }) => void import("./analytics-server").then(({ trackServer }) => trackServer("data_snapshot_swap", { from, to, ms })).catch(() => {}),
  });
  installSnapshotHolder(holder as SnapshotHolder<unknown>);
  return holder;
}

/**
 * The snapshot this request serves, the same one for every reader in the request (React's per-request cache), so a
 * swap mid-render never mixes two snapshots. With DATA_SNAPSHOT_URL set, each call also starts the pointer check
 * (at most once a minute per instance; never awaited, never throws).
 */
const getServed = cache(async (): Promise<Served<Dataset>> => {
  warnAboutRetiredSettings();
  const h = snapshotHolder();
  const served = await h.load();
  void h.maybeRefresh();
  return served;
});

/**
 * The dataset: loaded on the first call in this server instance and held in memory. With DATA_SNAPSHOT_URL set it is
 * replaced whole when the pointer names another snapshot; otherwise it never changes while the instance runs. Throws
 * if the first load fails.
 */
export const getData = cache(async (): Promise<Dataset> => (await getServed()).value);

/**
 * The id of the snapshot this request serves (`legacy` for data/), for the `x-quad-snapshot` header and the layout's
 * meta tag. With no snapshot configured it answers without loading the dataset, so pages that don't read it still
 * don't.
 */
export const getSnapshotId = cache(async (): Promise<string> => {
  if (dataSource().kind === "legacy") return "legacy";
  return String((await getServed()).id);
});

/** The search index's inputs from the served snapshot: the dataset, its alias rows, and its id (app/search-index.json). */
export const getSearchIndexInputs = cache(async (): Promise<{ data: Dataset; aliases: AliasRow[]; snapshot: string }> => {
  const served = await getServed();
  return { data: served.value, aliases: served.content.files.aliases ?? [], snapshot: String(served.id) };
});

/**
 * A shard of the served snapshot, or undefined when the dataset comes from data/ (the caller then reads its file as
 * before). Storage: fetched for the request's snapshot, the bundled file as the fallback; bundled: the bundled file.
 */
async function snapshotShard<T>(kind: ShardKind, key: string): Promise<T | null | undefined> {
  const from = dataSource().kind;
  if (from === "legacy") return undefined;
  const served = await getServed();
  if (served.id === "legacy") return undefined;
  if (from === "bundled") return readBundledShard<T>(kind, key);
  return readShard<T>(kind, key, { id: served.id });
}

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
 * built. Read once per server instance, like getData(); from a snapshot, they come with it (history/shared.json) and
 * swap with it.
 */
export const getHistoryFiles = cache(async (): Promise<HistoryFiles | null> => {
  if (dataSource().kind !== "legacy") {
    try {
      const served = await getServed();
      if (served.id !== "legacy") return served.content.history;
    } catch (err) {
      console.error("Loading history failed; pages render without it.", err);
      return null;
    }
  }
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

/** One college's year-by-year history (data/history/schools/{id}.json, or the snapshot's history/{id}.json), or null. */
export const getHistory = cache(async (unitId: string): Promise<SchoolHistory | null> => {
  if (!/^\d+$/.test(unitId)) return null;
  try {
    const shard = await snapshotShard<SchoolHistory>("history", unitId);
    if (shard !== undefined) return shard;
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
 * One national trend file: data/history/trends/{name}.json (`npm run build-trends`; a snapshot's trends/{name}.json).
 * Null when it hasn't been built: pages render a quiet "not available yet" state, like history. Typed by name through
 * `TrendFiles` (lib/trends.ts).
 */
export const getTrendFile = cache(async <N extends TrendFileName>(name: N): Promise<TrendFiles[N] | null> => {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  try {
    const shard = await snapshotShard<TrendFiles[N]>("trend", name);
    if (shard !== undefined) return shard;
    return readOptionalJson<TrendFiles[N]>(join(process.cwd(), "data", "history", "trends", `${name}.json`));
  } catch (err) {
    console.error(`Loading trend file ${name} failed; the page renders without it.`, err);
    return null;
  }
});

/**
 * The application platforms' own essay prompts (data/reference/platform-prompts.json, written by
 * scripts/sync-essay-prompts.mts's reference step; a snapshot's reference/platform-prompts.json). Null when the file
 * is missing; the essays workspace then offers the main essay without the platform's prompt list.
 */
export const getPlatformPrompts = cache(async (): Promise<PlatformPromptsFile | null> => {
  try {
    const shard = await snapshotShard<PlatformPromptsFile>("reference", REFERENCE_OBJECTS.platformPrompts);
    if (shard !== undefined) return shard;
    return readOptionalJson<PlatformPromptsFile>(join(process.cwd(), "data", "reference", "platform-prompts.json"));
  } catch (err) {
    console.error("Loading data/reference/platform-prompts.json failed; the essays workspace renders without it.", err);
    return null;
  }
});

/**
 * "This season on the Common App" (specs/data-expansion/common-app.md "National and state figures"): the hand-
 * reviewed national figures, data/trends/common-app.json (a snapshot's reference/common-app-trends.json). Null when
 * the file hasn't been added yet, like getTrendFile; the component renders nothing without it.
 */
export const getCommonAppTrends = cache(async (): Promise<CommonAppTrendsFile | null> => {
  try {
    const shard = await snapshotShard<CommonAppTrendsFile>("reference", REFERENCE_OBJECTS.commonAppTrends);
    if (shard !== undefined) return shard;
    return readOptionalJson<CommonAppTrendsFile>(join(process.cwd(), "data", "trends", "common-app.json"));
  } catch (err) {
    console.error("Loading data/trends/common-app.json failed; the Common App season block renders without it.", err);
    return null;
  }
});

/* ------------------------------------------------------------------ */
/* Per-college detail tables (lib/detail.ts)                           */
/* ------------------------------------------------------------------ */

/**
 * One college's detail file (data/detail/schools/{id}.json, or the snapshot's detail/{id}.json: home states, later
 * majors), or null when it has none. Fail-soft like getHistory(): a missing or unreadable file renders the profile
 * without it.
 */
export const getDetail = cache(async (unitId: string): Promise<SchoolDetail | null> => {
  if (!/^\d+$/.test(unitId)) return null;
  try {
    const shard = await snapshotShard<SchoolDetail>("detail", unitId);
    if (shard !== undefined) return shard;
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
