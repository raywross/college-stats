/**
 * Adapter contracts for `npm run sync-high-schools` (federal + private directories) and `npm run sync-hs-states`
 * (state report cards). specs/product/high-school-data.md.
 *
 * Federal / private adapter (scripts/lib/high-schools/{ccd,edfacts,crdc,pss}.mts), registered in ./index.mts:
 *
 *   export const info: AdapterInfo = { key: "crdc", role: "enrichment", rowKind: "public", owns: ["rigor"], … };
 *   export async function load(ctx: AdapterContext): Promise<AdapterResult> { … }
 *
 * State adapter (scripts/lib/high-schools/states/{xx}.mts), registered in ./states/index.mts:
 *
 *   export const adapter: StateAdapter = { state: "CA", source: "state-ca", name: "…", publisher: "…", url: "…", load };
 *
 * Units replace their own stub file only; the registries already list every adapter.
 */
import type { HighSchool, HighSchoolStateFile, HsLineage, HsSourceInfo, HsSourceKey, HsVintageKey } from "../../../lib/high-school-types.ts";

/** Top-level row fields an adapter can own. `id` and `kind` come from the id; `suppressed`/`lineage` follow the fields. */
export type HsOwnedKey = Exclude<keyof HighSchool, "id" | "kind" | "suppressed" | "lineage">;

export type AdapterKey = "ccd" | "edfacts" | "crdc" | "pss";

export interface AdapterInfo {
  key: AdapterKey;
  /**
   * "directory": creates the rows of `rowKind` (CCD public, PSS private). A run's rows replace that kind's rows:
   *   a school missing from the result is removed (closed, or no longer offers grade 12).
   * "enrichment": fills its `owns` fields on existing rows of `rowKind` (EDFacts, CRDC); it never creates rows. Rows
   *   it doesn't patch get those fields reset to null (the source didn't report them this time).
   */
  role: "directory" | "enrichment";
  rowKind: HighSchool["kind"];
  /** The top-level fields this adapter writes. A run changes only these; every other field keeps its current value. */
  owns: readonly HsOwnedKey[];
  /** meta.json sources and vintages this adapter supplies. */
  sources: readonly HsSourceKey[];
  vintages: readonly HsVintageKey[];
}

/** Enrichment output for one school: values for (some of) the adapter's `owns` fields; missing owned keys become null. */
export interface HighSchoolPatch {
  id: string;
  values: Partial<Pick<HighSchool, HsOwnedKey>>;
  /** Suppressed paths under the adapter's owned fields ("rigor.ap_enrolled", "grad_rate"). */
  suppressed?: string[];
  /** Lineage records for paths under the adapter's owned fields, only where they differ from HS_FIELDS defaults. */
  lineage?: Record<string, HsLineage>;
}

export interface AdapterResult {
  /**
   * Directory adapters: every row of `rowKind` they found, complete (build them with blankHighSchool and fill them;
   * suppressed/lineage entries under owned fields). Undefined means "nothing loaded": the run leaves rows alone.
   */
  rows?: HighSchool[];
  /** Enrichment adapters: one patch per school reported. Undefined means "nothing loaded": the run leaves rows alone. */
  patches?: HighSchoolPatch[];
  /** meta.json entries for the files read (name, publisher, URL, retrieved date). */
  sources: Partial<Record<HsSourceKey, HsSourceInfo>>;
  /** The period each file describes: "2023–24", "Class of 2022" (cohort entering fall 2018). */
  vintages: Partial<Record<HsVintageKey, string | null>>;
  /** Lines for the run's report (coverage, codes seen, skipped rows). */
  notes?: string[];
}

export interface FetchCachedOptions {
  /** File name in the cache directory; default: the URL's last path segment. */
  file?: string;
  /** Re-download when the cached copy is older than this. Default: never (download once). */
  maxAgeDays?: number;
  headers?: Record<string, string>;
}

export interface AdapterContext {
  /** Repository root. */
  root: string;
  /** Download cache, `.cache/high-schools/` (git-ignored). */
  cacheDir: string;
  /** Output directory (data/high-schools, or HIGH_SCHOOLS_DIR). */
  outDir: string;
  now: Date;
  /** `now` as YYYY-MM-DD, for `retrieved` dates. */
  today: string;
  /** Rows in the current shards, by id (empty on a first run). */
  existing: ReadonlyMap<string, HighSchool>;
  /** Extra command-line flags (`--year 2023` → { year: "2023" }; `--offline` → { offline: true }). */
  flags: Readonly<Record<string, string | true>>;
  /** Never touch the network: fetchCached returns cached files only and throws for anything not cached. */
  offline: boolean;
  log(message: string): void;
  warn(message: string): void;
  /** Download `url` into the cache once (or when older than maxAgeDays); returns the local path. */
  fetchCached(url: string, opts?: FetchCachedOptions): Promise<string>;
  /** Names of the files inside a cached zip. */
  listZip(zipPath: string): string[];
  /** One file from a cached zip as text (latin1 by default, as NCES files are). */
  readZipEntry(zipPath: string, entry: string | RegExp, encoding?: BufferEncoding): string;
}

/** A federal / private adapter module, as registered in ./index.mts. */
export interface HighSchoolAdapter {
  info: AdapterInfo;
  load(ctx: AdapterContext): Promise<AdapterResult>;
}

/* ------------------------------------------------------------------ */
/* State report cards                                                  */
/* ------------------------------------------------------------------ */

export interface StateContext extends Omit<AdapterContext, "existing"> {
  /** USPS, uppercase. */
  state: string;
  /** This state's public rows from the current shards; empty until the federal sync has written them. */
  rows: readonly HighSchool[];
  /**
   * State school id (CCD ST_SCHID, as stored in `state_school_id`) → ncessch, from `rows`. Empty when the shards don't
   * have the state yet: read the crosswalk from the CCD directory file in `cacheDir` instead.
   */
  crosswalk: ReadonlyMap<string, string>;
}

/** What a state adapter returns: the state file minus its `state`, which the sync adds. */
export type StateAdapterResult = Pick<HighSchoolStateFile, "sections" | "schools" | "unmatched">;

export interface StateAdapter {
  /** USPS, uppercase. */
  state: string;
  /** `state-{xx}`. */
  source: HsSourceKey;
  /** For meta.json `sources[source]`: "California School Dashboard and DataQuest downloads". */
  name: string;
  /** "California Department of Education". */
  publisher: string;
  /** The landing page for the state's downloads. */
  url: string;
  /** False for a stub: the sync says the adapter isn't built yet instead of running it. */
  built: boolean;
  load(ctx: StateContext): Promise<StateAdapterResult>;
}
