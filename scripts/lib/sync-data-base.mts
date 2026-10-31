/**
 * What `npm run sync-data` writes since the data platform's phase 2 (specs/data-platform/pipelines.md "sync-data";
 * storage.md "Collections"): the base layer only, the state after its IPEDS and Scorecard stages and before any later
 * layer (Common App, Coalition, essays, college-reported, directories, selectivity), which the publisher composes.
 *
 * The base is defined twice, and the two must agree: sync-data builds it forward from the federal files, and the import
 * (scripts/import-data-from-git.mts) recovers it backward by stripping the committed dataset. Both go through
 * `baseDocuments`, which holds every college to the import's `baseProblems` and every detail document to its
 * `baseDetail`, so a later layer can't leak into the base from either side (tests/data-platform-sources.test.mts).
 */
import type { DatasetMeta, School } from "../../lib/types";
import type { SchoolDetail } from "../../lib/detail.ts";
import type { ReleaseCalendar } from "../../lib/releases.ts";
import type { AliasRow } from "../../lib/identity-files";
import type { SourceFilesRecord } from "../../lib/admin/source-files.ts";
import { baseDetail, baseProblems } from "../import-data-from-git.mts";
import { COLLECTIONS, SINGLE_KEYS } from "./data-platform/layers.mts";
import type { DataStore } from "./data-platform/store.mts";

export interface BaseInputs {
  schools: readonly School[];
  details: readonly SchoolDetail[];
  meta: DatasetMeta;
  /** The alias rows sync-data builds without Common App's (those are added at compose). */
  aliases: readonly AliasRow[];
  calendar: ReleaseCalendar;
  sourceFiles?: SourceFilesRecord | null;
}

export type BaseDocuments = Map<string, Map<string, unknown>>;

/** The base collections' documents, keyed as the import keys them. Throws when a later layer's value is present. */
export function baseDocuments(input: BaseInputs): BaseDocuments {
  const problems = input.schools.flatMap(baseProblems);
  if (problems.length) throw new Error(`sync-data: ${problems.length} later-layer values in the base (only the publisher composes):\n  ${problems.slice(0, 20).join("\n  ")}`);
  const out: BaseDocuments = new Map();
  out.set(COLLECTIONS.base.colleges, new Map(input.schools.map((s) => [s.unit_id, s])));
  const details = new Map<string, unknown>();
  for (const d of input.details) {
    const b = baseDetail(d);
    if (b) details.set(b.unit_id, b);
  }
  out.set(COLLECTIONS.base.detail, details);
  out.set(COLLECTIONS.base.meta, new Map([[SINGLE_KEYS.meta, input.meta]]));
  out.set(COLLECTIONS.base.aliases, new Map([[SINGLE_KEYS.aliases, input.aliases.filter((r) => r.source !== "common-app")]]));
  out.set(COLLECTIONS.base.releaseCalendar, new Map([[SINGLE_KEYS.calendar, input.calendar]]));
  if (input.sourceFiles) out.set(COLLECTIONS.base.sourceFiles, new Map([[SINGLE_KEYS.sourceFiles, input.sourceFiles]]));
  return out;
}

/** The per-college base collections: a college no longer in the dataset is removed from them. */
export const MIRRORED_BASE: ReadonlySet<string> = new Set([COLLECTIONS.base.colleges, COLLECTIONS.base.detail]);

/**
 * A store that reads `overlay`'s collections from it (version 0) and the rest from `store`: the publisher's compose
 * over the new base before it is written (sync-data `--out`). Writes go to `store` (never used here).
 */
export function overlayStore(store: DataStore, overlay: BaseDocuments): DataStore {
  const versioned = <T,>(c: string, prefix?: string): Map<string, { version: number; body: T }> =>
    new Map([...(overlay.get(c) ?? new Map())].filter(([k]) => prefix === undefined || k.startsWith(prefix)).map(([k, v]) => [k, { version: 0, body: v as T }]));
  return {
    ...store,
    async readVersioned<T>(c: string, prefix?: string) {
      return overlay.has(c) ? versioned<T>(c, prefix) : store.readVersioned<T>(c, prefix);
    },
    async read<T>(c: string, prefix?: string) {
      return overlay.has(c) ? new Map([...versioned<T>(c, prefix)].map(([k, v]) => [k, v.body])) : store.read<T>(c, prefix);
    },
    async readOne<T>(c: string, key: string) {
      return overlay.has(c) ? ((overlay.get(c)!.get(key) as T | undefined) ?? null) : store.readOne<T>(c, key);
    },
  };
}
