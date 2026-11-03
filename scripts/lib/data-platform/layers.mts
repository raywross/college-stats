/**
 * The layers (specs/data-platform/storage.md "Collections"): every collection's name as a constant, typed read and
 * write helpers over a `DataStore` (./store.mts), and loaders that turn a store's layers back into the exact inputs
 * today's merge functions take from files (`loadIdentityInputs`, `loadCommonApp`, `readCoalition`, `readEssayRecords`,
 * `readRecords`, `readDirectoryFiles`, `readPagesFile`), so the publisher (./compose.mts) calls those functions
 * unchanged. The import (scripts/import-data-from-files.mts) writes what these read.
 *
 * Collections the storage table doesn't name, added for files it doesn't list (each marked "not in the table"):
 * `base.source_files`, `identity.wikidata_issues`, `directories.matches`, `campus.sources`, `common_app.name_map`,
 * `coalition.name_map`, `essays.confirmed`, `essays.runs`, `reference.files` (the table's `reference.*`), and
 * `import.headers` (each split file's top-level fields other than its entries, such as `updated`, by file path).
 */
import type { DatasetMeta, School } from "../../../lib/types";
import type { SchoolDetail } from "../../../lib/detail.ts";
import type { ReleaseCalendar } from "../../../lib/releases.ts";
import type { AliasRow, BrandColorEntry, BrandLogoEntry, BrandOverride, LinkIssue, SiteProbeEntry, WikidataEntry } from "../../../lib/identity-files";
import type { IdentityInputs } from "../../../lib/identity.ts";
import type { GridEdition, MembersFile } from "../../../lib/common-app/types";
import type { CoalitionFile } from "../../../lib/coalition.ts";
import type { ConfirmedRecord } from "../../../lib/essay-prompts/confirmed.ts";
import type { ReportedEntry, ReportedFile } from "../../../lib/reported.ts";
import type { CollegeRecord } from "../../../lib/cds-sections.ts";
import type { EssayRecord } from "../essay-prompts/store.mts";
import type { DirectoryFile } from "../directories/files.mts";
import type { PagesFile, PublishedCollege } from "../campus-pilot/files.mts";
import { compareKeys, type ChangeSetHandle, type DataStore } from "./store.mts";

export const COLLECTIONS = {
  base: {
    colleges: "base.colleges",
    detail: "base.detail",
    meta: "base.meta",
    releaseCalendar: "base.release_calendar",
    aliases: "base.aliases",
    /** data/source-files.json (not in the table). */
    sourceFiles: "base.source_files",
  },
  identity: {
    wikidata: "identity.wikidata",
    probe: "identity.probe",
    linkIssues: "identity.link_issues",
    brandColors: "identity.brand_colors",
    brandLogos: "identity.brand_logos",
    brandOverrides: "identity.brand_overrides",
    /** data/wikidata-issues.json, grouped by unit id (not in the table). */
    wikidataIssues: "identity.wikidata_issues",
  },
  reported: {
    entries: "reported.entries",
    cdsRecords: "reported.cds_records",
    sources: "reported.sources",
    docs: "reported.docs",
    batches: "reported.batches",
    reviewQueue: "reported.review_queue",
    failures: "reported.failures",
    reports: "reported.reports",
  },
  directories: {
    listings: "directories.listings",
    unmatched: "directories.unmatched",
    blocked: "directories.blocked",
    /** data/directories/matches.json, the hand-checked answers (not in the table). */
    matches: "directories.matches",
  },
  campus: {
    pages: "campus.pages",
    /** data/campus-sources.json recipes, by unit id (not in the table). */
    sources: "campus.sources",
  },
  commonApp: {
    grid: "common_app.grid",
    members: "common_app.members",
    /** data/common-app/name-map.json (not in the table). */
    nameMap: "common_app.name_map",
  },
  coalition: {
    members: "coalition.members",
    /** data/coalition/name-map.json (not in the table). */
    nameMap: "coalition.name_map",
  },
  essays: {
    records: "essays.records",
    held: "essays.held",
    pages: "essays.pages",
    /** data/essay-prompts/confirmed/ (empty today: the console's hand reads live in essay_prompt_overrides; not in the table). */
    confirmed: "essays.confirmed",
    /** data/essay-prompts/last-run.json, keyed by its run stamp (not in the table). */
    runs: "essays.runs",
  },
  history: {
    schools: "history.schools",
    shared: "history.shared",
  },
  highSchools: {
    /** data/high-schools/schools/<ST>.json, by state. */
    schools: "high_schools.schools",
    /** data/high-schools/ledger/<ST>.json, by state. */
    ledger: "high_schools.ledger",
    /** data/high-schools/state/<st>.json, by state. */
    state: "high_schools.state",
    /** data/high-schools/detail/<id>.json, by NCES id. */
    detail: "high_schools.detail",
    /** The shared files (meta, medians, pilots, recipes, review queue), by file name. */
    shared: "high_schools.shared",
  },
  /** The table's `reference.*`: one collection, keyed by the reference name (REFERENCE_FILES). */
  reference: { files: "reference.files" },
  overrides: { legacy: "overrides.legacy" },
  health: { colleges: "health.colleges" },
  /** Each split file's header (its top-level fields other than the entries), by the file's path under data/ (not in the table). */
  import: { headers: "import.headers" },
  /**
   * The Data Steward's own documents (specs/product/data-steward.md "What it writes"): issues by cause key, proposals,
   * acquisition To do rows, policy decisions, audits, and run summaries. Written by `scripts/steward.mts` (source
   * `steward`) and by the console (`admin_steward_write`); never composed into a college, never in a snapshot.
   */
  steward: {
    issues: "steward.issues",
    proposals: "steward.proposals",
    todo: "steward.todo",
    decisions: "steward.decisions",
    audits: "steward.audits",
    runs: "steward.runs",
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type CollectionName = Leaves<typeof COLLECTIONS>;

/** Every collection, in the order the import writes them. */
export const ALL_COLLECTIONS: readonly CollectionName[] = Object.values(COLLECTIONS).flatMap((group) => Object.values(group)) as CollectionName[];

/** The one key of a single-document collection. */
export const SINGLE_KEYS = {
  meta: "meta",
  calendar: "calendar",
  aliases: "aliases",
  sourceFiles: "source-files",
  members: "members",
  nameMap: "name-map",
  blocked: "blocked",
  matches: "matches",
  health: "health",
} as const;

/**
 * The reference documents: name → the file under data/ it came from (and goes back to, for a reader that still wants
 * the file). JSON files are stored parsed; a text file as `{text}` with the extension recorded here. data/reference/
 * files not listed are keyed by their path under data/reference/ without `.json` (the import refuses an unlisted text
 * file, so a new one is registered here first).
 */
export const REFERENCE_FILES: Readonly<Record<string, string>> = {
  "aid-policies": "aid-policies.json",
  "aliases-curated": "aliases-curated.json",
  "application-cycle": "application-cycle.json",
  "guaranteed-admission": "guaranteed-admission.json",
  "major-admission": "major-admission.json",
  "state-laws": "state-laws.json",
  organizations: "directories/organizations.json",
  "common-app-trends": "trends/common-app.json",
  "excluded-campuses": "trends/excluded-campuses.json",
  "essay-guidance/guidance": "reference/essay-guidance/guidance.md",
  "zcta-centroids": "reference/zcta-centroids.csv",
};

/** A text document (`reference.files`, `reported.reports`): the file's text, whole. */
export interface TextDocument {
  text: string;
}

/* ------------------------------------------------------------------ */
/* Read and write                                                      */
/* ------------------------------------------------------------------ */

/** A collection's current documents by key, in key order (the stores' own order differs by collation; this doesn't). */
export async function readLayer<T>(store: DataStore, collection: string): Promise<Map<string, T>> {
  const docs = await store.read<T>(collection);
  return new Map([...docs].sort((a, b) => compareKeys(a[0], b[0])));
}

/** Writes every document of `docs` into the change set (unchanged ones write nothing). */
export async function writeLayer(handle: ChangeSetHandle, collection: string, docs: ReadonlyMap<string, unknown>): Promise<void> {
  if (!docs.size) return;
  await handle.write(collection, [...docs].map(([key, body]) => ({ key, body })));
}

const values = <T,>(m: ReadonlyMap<string, T>) => [...m.values()];

/* ------------------------------------------------------------------ */
/* Loaders: layers → today's inputs                                    */
/* ------------------------------------------------------------------ */

/** The base layer: colleges in the dataset's order (by name, then unit id, as sync-data sorts), meta, calendar, aliases, detail. */
export async function loadBase(store: DataStore): Promise<{ schools: School[]; meta: DatasetMeta | null; calendar: ReleaseCalendar | null; aliases: AliasRow[]; details: SchoolDetail[] }> {
  const colleges = values(await readLayer<School>(store, COLLECTIONS.base.colleges));
  return {
    schools: datasetOrder(colleges),
    meta: await store.readOne<DatasetMeta>(COLLECTIONS.base.meta, SINGLE_KEYS.meta),
    calendar: await store.readOne<ReleaseCalendar>(COLLECTIONS.base.releaseCalendar, SINGLE_KEYS.calendar),
    aliases: (await store.readOne<AliasRow[]>(COLLECTIONS.base.aliases, SINGLE_KEYS.aliases)) ?? [],
    details: values(await readLayer<SchoolDetail>(store, COLLECTIONS.base.detail)),
  };
}

/**
 * data/schools.json's order: `sync-data` sorts by `name.localeCompare` (stable) over the Scorecard order, which is
 * ascending unit id; colleges that share a name stay in unit id order.
 */
export function datasetOrder(schools: readonly School[]): School[] {
  return [...schools].sort((a, b) => compareKeys(a.unit_id, b.unit_id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** What `loadIdentityInputs` (scripts/lib/identity-sync.mts) reads from files, from the identity layers and `overrides.legacy`. */
export async function loadIdentity(store: DataStore): Promise<IdentityInputs> {
  return {
    wikidata: await readLayer<WikidataEntry>(store, COLLECTIONS.identity.wikidata),
    probe: await readLayer<SiteProbeEntry>(store, COLLECTIONS.identity.probe),
    linkIssues: await readLayer<LinkIssue[]>(store, COLLECTIONS.identity.linkIssues),
    brandColors: await readLayer<BrandColorEntry>(store, COLLECTIONS.identity.brandColors),
    brandLogos: await readLayer<BrandLogoEntry>(store, COLLECTIONS.identity.brandLogos),
    brandOverrides: Object.fromEntries(await readLayer<BrandOverride>(store, COLLECTIONS.identity.brandOverrides)),
    overrides: await loadOverrides(store),
  };
}

/** data/overrides.json's patches, by unit id (without the file's `_readme`). */
export async function loadOverrides(store: DataStore): Promise<Record<string, Record<string, unknown>>> {
  return Object.fromEntries(await readLayer<Record<string, unknown>>(store, COLLECTIONS.overrides.legacy));
}

/** The newest grid edition (latest `updated`, then cycle, as `readNewestEdition`) and the members file, or null. */
export async function loadCommonAppLayer(store: DataStore): Promise<{ edition: GridEdition; members: MembersFile } | null> {
  const editions = values(await readLayer<GridEdition>(store, COLLECTIONS.commonApp.grid));
  editions.sort((a, b) => (a.updated === b.updated ? a.cycle.localeCompare(b.cycle) : a.updated.localeCompare(b.updated)));
  const members = await store.readOne<MembersFile>(COLLECTIONS.commonApp.members, SINGLE_KEYS.members);
  const edition = editions.at(-1);
  return edition && members ? { edition, members } : null;
}

export async function loadCoalitionLayer(store: DataStore): Promise<CoalitionFile | null> {
  return store.readOne<CoalitionFile>(COLLECTIONS.coalition.members, SINGLE_KEYS.members);
}

/** The reader's records and the hand-read ones, by unit id (as `readEssayRecords` lists the folder). Held records stay out. */
export async function loadEssaysLayer(store: DataStore): Promise<{ records: EssayRecord[]; confirmed: ConfirmedRecord[] }> {
  return {
    records: values(await readLayer<EssayRecord>(store, COLLECTIONS.essays.records)),
    confirmed: values(await readLayer<ConfirmedRecord>(store, COLLECTIONS.essays.confirmed)),
  };
}

/** data/college-reported.json (its `updated` from the import's header) and data/cds-records/, by unit id. */
export async function loadReportedLayer(store: DataStore): Promise<{ file: ReportedFile; records: CollegeRecord[] }> {
  const header = await store.readOne<{ updated?: string }>(COLLECTIONS.import.headers, "college-reported.json");
  return {
    file: { updated: header?.updated ?? "", entries: values(await readLayer<ReportedEntry>(store, COLLECTIONS.reported.entries)) },
    records: values(await readLayer<CollegeRecord>(store, COLLECTIONS.reported.cdsRecords)),
  };
}

/** The directory files (in `readDirectoryFiles`' order: by file name) and the campus pilot's pages file. */
export async function loadDirectoriesLayer(store: DataStore): Promise<{ files: DirectoryFile[]; pages: PagesFile }> {
  const files = values(await readLayer<DirectoryFile>(store, COLLECTIONS.directories.listings));
  files.sort((a, b) => compareKeys(`${a.org}.json`, `${b.org}.json`));
  const header = await store.readOne<{ updated?: string | null }>(COLLECTIONS.import.headers, "campus-pages.json");
  const colleges = values(await readLayer<PublishedCollege>(store, COLLECTIONS.campus.pages));
  return { files, pages: { updated: header?.updated ?? null, colleges } };
}
