/**
 * The shared shapes of a published snapshot (specs/data-platform/publish.md): object names under a snapshot's folder
 * in Storage, the manifest, the pointer. Pure, no Node or Next imports, so the publisher (a script), the loader
 * (lib/data.ts), the console, and the tests all agree on names from one place.
 */

/** The bucket's name in the data project; its objects are public-read. */
export const SNAPSHOT_BUCKET = "snapshots";

/** The pointer object: which snapshot is live. Served with no caching. */
export const POINTER_OBJECT = "snapshots/current.json";

export interface SnapshotPointer {
  id: number;
  /** ISO timestamp of the publish (or of the point-back that made this snapshot current again). */
  at: string;
  /** The manifest's sha256, so a reader can tell a stale CDN copy from the real one. */
  manifest_sha256: string;
}

/** Objects every snapshot carries, relative to `snapshots/<id>/`. Per-college and per-name objects use the helpers. */
export const SNAPSHOT_OBJECTS = {
  colleges: "colleges.json.gz",
  meta: "meta.json",
  releaseCalendar: "release-calendar.json",
  aliases: "aliases.json",
  historyShared: "history/shared.json.gz",
  searchIndex: "search-index.json",
  manifest: "manifest.json",
} as const;

export const historyObject = (unitId: string) => `history/${unitId}.json`;
export const detailObject = (unitId: string) => `detail/${unitId}.json`;
export const trendObject = (name: string) => `trends/${name}.json`;
export const referenceObject = (name: string) => `reference/${name}`;
export const highSchoolObject = (file: string) => `high-schools/${file}`;

/** `snapshots/<id>/<object>`: the full path in the bucket. */
export const snapshotPath = (id: number, object: string) => `snapshots/${id}/${object}`;

export interface SnapshotManifest {
  id: number;
  created_at: string;
  previous_id: number | null;
  colleges: number;
  /** Every object in the snapshot with its size and hash, keyed by its name relative to the snapshot's folder. */
  objects: Record<string, { bytes: number; sha256: string }>;
  /** Each layer's newest document version at compose time (collection → version), for "what went in". */
  layers: Record<string, number>;
  /** The change sets this snapshot carried. */
  change_set_ids: number[];
}

/** The reference documents a snapshot renders, by the name the loader asks for. */
export const REFERENCE_OBJECTS = {
  platformPrompts: "platform-prompts.json",
  organizations: "organizations.json",
  commonAppTrends: "common-app-trends.json",
  essayGuidance: "essay-guidance.md",
  zctaCentroids: "zcta-centroids.csv",
} as const;

/** The shared history files, bundled into one object. */
export interface HistorySharedObject {
  meta: unknown;
  national: unknown;
  facts: unknown;
  cpi: unknown;
}

/** The header every HTML response carries so the console can see which snapshot an environment serves. */
export const SNAPSHOT_HEADER = "x-quad-snapshot";

/** Where `fetch-snapshot` writes the bundled copy; traced into every function in place of data/. */
export const BUNDLED_SNAPSHOT_DIR = ".data/snapshot";

/** A local id for the bundled copy when it came from the mini fixture rather than a published snapshot. */
export const FIXTURE_SNAPSHOT_ID = 0;
