/**
 * The profile pipeline's files (all under the high-schools folder, a scratch copy of the layers, unless noted):
 *   profile-recipes.json   where each school's profile is and how it was found (RecipesFile)
 *   profile-pilot.json     the pilot's chosen schools, the rule, the latest run's results and measurements
 *   review-queue.json      failed checks and college names to resolve (HsReviewQueue)
 *   detail/{id}.json       one HighSchoolDetail per school whose extraction passed
 *   the reference document hs-profile-answer-key   the hand-read answer key
 * Writers keep a stable key order and end files with a newline so diffs stay small.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HighSchoolDetail } from "../../../../lib/high-school-types.ts";
import type { RecipesFile } from "./discover.mts";
import type { HsReviewItem, Measurements, SchoolResult } from "./run.mts";
import type { PilotSchool } from "./select.mts";
import type { AccuracyReport, AnswerKeyFile } from "./score.mts";
import type { DataStore } from "../../data-platform/store.mts";
import { readReferenceDocument } from "../../data-platform/bundled.mts";

export interface HsReviewQueue {
  updated: string;
  items: HsReviewItem[];
}

export interface PilotRun {
  run: string;
  started: string;
  finished: string;
  cap_usd: number;
  spent_usd: number;
  stopped: string | null;
  models: Record<string, string>;
  mode: string;
  measurements: Measurements;
  cost_by_job: Record<string, { calls: number; cost_usd: number }>;
  results: SchoolResult[];
}

export interface PilotFile {
  chosen: string;
  rule: string;
  seed: string;
  metros: { key: string; label: string; state: string; center: { lat: number; lng: number }; radius_km: number; take: number }[];
  schools: PilotSchool[];
  /** How the seeds (step 2 candidates) were found, when a run used them. */
  seeds_method?: string;
  latest?: PilotRun;
  /** The latest run over the answer key's schools (`--answer-key`), scored with the pilot's. */
  answer_key_run?: PilotRun;
  /** Every model dollar the pilot's runs have spent; the next run's cap is what is left of `--cap`. */
  spent_total_usd?: number;
  accuracy?: (AccuracyReport & { scored: string; basis: string }) | null;
  /** College-name match rate on the answer key's hand-read matriculation lists (`--match-key`). */
  key_match?: unknown;
}

export function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** The profile files of a high-school folder in the old layout (`dir`: a scratch copy of the layers, ../data-store.mts). */
export const profilePaths = (dir: string) => ({
  recipes: join(dir, "profile-recipes.json"),
  pilot: join(dir, "profile-pilot.json"),
  queue: join(dir, "review-queue.json"),
  detailDir: join(dir, "detail"),
});

/** Recipes sorted by id. */
export function writeRecipes(file: string, f: RecipesFile): void {
  const recipes = Object.fromEntries(Object.entries(f.recipes).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeJson(file, { updated: f.updated, recipes });
}

/** Replaces the queue's items for the schools just run (their old items are resolved or re-queued), sorted by id. */
export function mergeQueue(prev: HsReviewQueue | null, ran: ReadonlySet<string>, items: readonly HsReviewItem[], today: string): HsReviewQueue {
  const kept = (prev?.items ?? []).filter((i) => !ran.has(i.id));
  return { updated: today, items: [...kept, ...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

/** A detail file in the foundation's key order. */
export function writeDetail(dir: string, d: HighSchoolDetail): void {
  const ordered: HighSchoolDetail = {
    id: d.id,
    profile: d.profile,
    class_size: d.class_size,
    gpa_scale: d.gpa_scale,
    gpa_distribution: d.gpa_distribution,
    ap_courses: d.ap_courses,
    ib_courses: d.ib_courses,
    scores: d.scores,
    matriculation: d.matriculation,
    ...(d.admitted !== undefined ? { admitted: d.admitted } : {}),
    ...(d.school_outcomes !== undefined ? { school_outcomes: d.school_outcomes } : {}),
    ...(d.ap_stats !== undefined ? { ap_stats: d.ap_stats } : {}),
    ...(d.enrollment !== undefined ? { enrollment: d.enrollment } : {}),
  };
  writeJson(join(dir, `${d.id}.json`), ordered);
}

export function readAnswerKey(file: string): AnswerKeyFile | null {
  return readJson<AnswerKeyFile>(file);
}

/** The reference document `hs-profile-answer-key`: the store's `reference.files`, else the bundled copy's (null when neither has it). */
export async function readAnswerKeyDocument(store: Pick<DataStore, "readOne">): Promise<AnswerKeyFile | null> {
  try {
    return await readReferenceDocument<AnswerKeyFile>(store, "hs-profile-answer-key");
  } catch {
    return null;
  }
}
