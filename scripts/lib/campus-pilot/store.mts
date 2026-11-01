/**
 * The campus-life pilot's state in the data store (specs/data-platform/pipelines.md, "campus-pilot"), keyed as
 * scripts/import-data-from-files.mts keys the files: `campus.pages` and `campus.sources` one document per college (the
 * files' `updated` in `import.headers` under "campus-pages.json" / "campus-sources.json"), refusals in
 * `directories.blocked`, run reports in `reported.reports` by file name ("campus-pilot-<run>.json"), college lists in
 * `reference.files` (data/reference/<name>.json → `<name>`). The publisher composes the pages into the dataset.
 */
import { existsSync } from "node:fs";
import type { ChangeSetHandle, DataStore } from "../data-platform/store.mts";
import { COLLECTIONS, readLayer } from "../data-platform/layers.mts";
import { replaceCollection } from "../data-platform/change-set.mts";
import { recordBlock } from "../directories/files.mts";
import { readBlockedDoc, writeBlockedDoc } from "../directories/store.mts";
import { collegeListIds, mergeRun, readCollegeList, type CollegeListFile, type PagesFile, type PublishedCollege, type SourcesFile } from "./files.mts";
import type { CampusRecipe, CollegeResult } from "./run.mts";

export const PAGES_HEADER = "campus-pages.json";
export const SOURCES_HEADER = "campus-sources.json";
export const reportKey = (run: string) => `campus-pilot-${run}.json`;

const byUnit = <T extends { unit_id: string }>(rows: readonly T[]) => new Map(rows.map((r) => [r.unit_id, r]));

export async function readPagesDoc(store: DataStore): Promise<PagesFile> {
  const header = await store.readOne<{ updated?: string | null }>(COLLECTIONS.import.headers, PAGES_HEADER);
  return { updated: header?.updated ?? null, colleges: [...(await readLayer<PublishedCollege>(store, COLLECTIONS.campus.pages)).values()] };
}

export async function readSourcesDoc(store: DataStore, today: string): Promise<SourcesFile> {
  const header = await store.readOne<{ updated?: string }>(COLLECTIONS.import.headers, SOURCES_HEADER);
  const recipes = [...(await readLayer<CampusRecipe>(store, COLLECTIONS.campus.sources)).values()];
  return { updated: header?.updated ?? today, recipes };
}

/**
 * A college list: data/reference/<name>.json is read from `reference.files` (the hand-kept reference layer), falling
 * back to the file; any other path is read from disk.
 */
export async function readCollegeListFrom(store: DataStore, path: string, root: string): Promise<string[]> {
  const m = /^(?:\.\/)?data\/reference\/(.+)\.json$/.exec(path);
  if (m) {
    const doc = await store.readOne<CollegeListFile>(COLLECTIONS.reference.files, m[1]);
    if (doc) return collegeListIds(doc, `reference.files/${m[1]}`);
  }
  const file = path.startsWith("/") ? path : `${root}/${path}`;
  if (!existsSync(file)) throw new Error(`${path}: no such college list (neither in reference.files nor on disk)`);
  return readCollegeList(file);
}

export interface CampusRunInput {
  results: readonly CollegeResult[];
  recipes: readonly CampusRecipe[];
  /** Pages that refused us this run. */
  blocked: readonly { url: string; reason: string }[];
  /** The run's report (written to reported.reports), or null for none. */
  report: { run: string; body: unknown } | null;
  today: string;
}

/**
 * Saves a run into `handle`: the run's colleges merged over the stored pages and recipes (`mergeRun`: every other
 * college's entries are kept as they were), the files' `updated` headers, the refusals, and the report.
 */
export async function saveCampusRun(store: DataStore, handle: ChangeSetHandle, run: CampusRunInput): Promise<{ pages: PagesFile; sources: SourcesFile }> {
  const merged = mergeRun(await readPagesDoc(store), await readSourcesDoc(store, run.today), { results: run.results, recipes: run.recipes }, run.today);
  await replaceCollection(store, handle, COLLECTIONS.campus.pages, byUnit(merged.pages.colleges));
  await replaceCollection(store, handle, COLLECTIONS.campus.sources, byUnit(merged.sources.recipes));
  await handle.write(COLLECTIONS.import.headers, [
    { key: PAGES_HEADER, body: { updated: merged.pages.updated } },
    { key: SOURCES_HEADER, body: { updated: merged.sources.updated } },
  ]);
  if (run.blocked.length) {
    let blocked = await readBlockedDoc(store);
    for (const b of run.blocked) blocked = recordBlock(blocked, { org: "campus-pilot", url: b.url, reason: b.reason as never, detail: "college page (campus-life pilot); hand reading per owner decision 1" }, run.today);
    await writeBlockedDoc(handle, blocked);
  }
  if (run.report) await handle.write(COLLECTIONS.reported.reports, [{ key: reportKey(run.report.run), body: run.report.body }]);
  return merged;
}

/** The newest campus-pilot run report in `reported.reports` (by key: the run stamp sorts by time), or null. */
export async function latestCampusReport(store: DataStore): Promise<{ key: string; body: unknown } | null> {
  const reports = await store.read<unknown>(COLLECTIONS.reported.reports, "campus-pilot-");
  const key = [...reports.keys()].filter((k) => /^campus-pilot-\d.*\.json$/.test(k)).sort().at(-1);
  return key ? { key, body: reports.get(key) } : null;
}
