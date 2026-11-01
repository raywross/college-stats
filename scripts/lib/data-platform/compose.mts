/**
 * The publisher's compose (specs/data-platform/publish.md "The publisher", step 3): the layers in the store
 * (storage.md "Collections") become the documents the app reads, by calling the functions `npm run sync-data` calls,
 * in its order, so the two can't disagree. Nothing here re-implements a merge; where sync-data did something inline,
 * the step was lifted into its module and both call it (`applyOverride`, `deriveTrends`, `applyDirectoryLayers`,
 * `aliasRowsFrom`, `trendContextFrom`, `confirmedFromRows`).
 *
 * The order, with each call's module:
 *   1. base colleges, in the dataset's order                    layers.mts loadBase / datasetOrder (the import's base)
 *   2. applyIdentity (no fresh HD row: the HD links stay)       lib/identity.ts
 *   3. the legacy overrides                                     scripts/lib/overrides.mts applyOverride (lineageForPatch)
 *      then the name sort                                       layers.mts datasetOrder
 *   4. (applyOpenAdmission: its input is IPEDS's IC rows, which no layer holds; the base copy carries its result)
 *   5. trends from the history layer (deriveTrends); a college    scripts/lib/overrides.mts deriveTrends, carryTrends
 *      without a history document keeps the previous snapshot's
 *   6. meta: base.meta + addIdentityMeta                         lib/identity.ts (the IPEDS stages' add*Meta are in base.meta)
 *   7. Common App: applyCommonApp, addCommonAppMeta              scripts/lib/common-app/merge.mts
 *   8. Coalition: applyCoalition, addCoalitionMeta               scripts/lib/coalition/merge.mts
 *   9. essays: confirmedProblems (a warning), applyEssays        scripts/lib/essay-prompts/merge.mts; the console's
 *      rows (essay_prompt_overrides) as hand-read records      scripts/lib/essay-prompts/export-confirmed.mts confirmedFromRows
 *  10. mergeReported (entries and CDS records)                   lib/reported-merge.ts
 *  11. the cross-checks sync-data can run without IPEDS files, as warnings in phase 1 (detailProblems after step 13,
 *      selectivityProblems after step 15); the IPEDS cross-checks (checkTransfers, checkOnlineShare,
 *      crossCheckDerived, checkTotals) read IPEDS tables and stay in sync-data, which writes the base
 *  12. directories: applyDirectoryLayers (applyDirectories, applyCccuMembership, applyLgbtqPolicies, addDirectoryMeta)
 *                                                                scripts/lib/campus-pilot/merge.mts
 *  13. mergeDetails (base tables + financialAidDetails + directories + campus pages)
 *                                                                lib/detail.ts, lib/cds/financial-aid.ts
 *  14. field edits: withEdits, quadEditSource in meta            lib/data-platform/edits.ts
 *  15. buildSelectivity with the previous snapshot's tiers       scripts/lib/selectivity.mts
 *  16. validateLineage → problems                                lib/lineage.ts
 * Then the derived documents: the alias table (aliasRowsFrom, scripts/lib/aliases-sync.mts), the national trend files
 * (computeTrends over trendContextFrom, scripts/trends/), the search index (buildSearchIndex, lib/search-index.ts).
 *
 * Pure apart from reading the store (`loadPublishLayers`); `composeSnapshot` never mutates its input, so composing the
 * same layers twice gives the same bytes (tests/data-platform-publish.test.mts).
 */
import type { DatasetMeta, LineageRecord, School, SchoolSelectivity } from "../../../lib/types";
import type { SchoolDetail } from "../../../lib/detail.ts";
import { mergeDetails } from "../../../lib/detail.ts";
import type { ReleaseCalendar } from "../../../lib/releases.ts";
import type { AliasRow, CuratedAliasEntry } from "../../../lib/aliases.ts";
import type { IdentityInputs } from "../../../lib/identity.ts";
import { addIdentityMeta, applyIdentity } from "../../../lib/identity.ts";
import { validateLineage } from "../../../lib/lineage.ts";
import { mergeReported } from "../../../lib/reported-merge.ts";
import type { ReportedFile } from "../../../lib/reported.ts";
import type { CollegeRecord } from "../../../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../../../lib/cds-template.ts";
import { financialAidDetails } from "../../../lib/cds/financial-aid.ts";
import type { ConfirmedRecord } from "../../../lib/essay-prompts/confirmed.ts";
import type { GridEdition, MembersFile } from "../../../lib/common-app/types";
import type { CoalitionFile } from "../../../lib/coalition.ts";
import type { HistoryFiles } from "../../../lib/supabase.ts";
import type { SchoolHistory } from "../../../lib/history.ts";
import type { CampusExclusionEntry } from "../../../lib/movers.ts";
import type { SearchIndex } from "../../../lib/search-index.ts";
import { buildSearchIndex } from "../../../lib/search-index.ts";
import { editProblem, liveEdits, quadEditSource, withEdits, type FieldEdit } from "../../../lib/data-platform/edits.ts";
import type { SnapshotEditsObject } from "../../../lib/data-platform/snapshot.ts";
import { applyOverride, carryTrends, deriveTrends } from "../overrides.mts";
import { addCommonAppMeta, applyCommonApp } from "../common-app/merge.mts";
import { addCoalitionMeta, applyCoalition } from "../coalition/merge.mts";
import { applyEssays, confirmedProblems } from "../essay-prompts/merge.mts";
import type { EssayRecord } from "../essay-prompts/store.mts";
import { confirmedFromRows, type OverrideRow } from "../essay-prompts/export-confirmed.mts";
import { applyDirectoryLayers } from "../campus-pilot/merge.mts";
import type { DirectoryFile } from "../directories/files.mts";
import type { PagesFile } from "../campus-pilot/files.mts";
import { buildSelectivity, selectivityProblems, type SelectivityIndexFile } from "../selectivity.mts";
import { detailProblems } from "../residence-sync.mts";
import { aliasRowsFrom } from "../aliases-sync.mts";
import { computeTrends } from "../../trends/build.mts";
import { trendContextFrom } from "../../trends/context.mts";
import type { DataStore } from "./store.mts";
import {
  COLLECTIONS,
  datasetOrder,
  loadBase,
  loadCoalitionLayer,
  loadCommonAppLayer,
  loadDirectoriesLayer,
  loadEssaysLayer,
  loadIdentity,
  loadReportedLayer,
  readLayer,
  SINGLE_KEYS,
} from "./layers.mts";

/* ------------------------------------------------------------------ */
/* The layers the compose reads                                        */
/* ------------------------------------------------------------------ */

/** Everything the compose reads, as the loaders in ./layers.mts give it (plus the two tables that aren't layers). */
export interface PublishLayers {
  base: { schools: School[]; meta: DatasetMeta | null; calendar: ReleaseCalendar | null; aliases: AliasRow[]; details: SchoolDetail[] };
  identity: IdentityInputs;
  commonApp: { edition: GridEdition; members: MembersFile } | null;
  coalition: CoalitionFile | null;
  essays: { records: EssayRecord[]; confirmed: ConfirmedRecord[] };
  reported: { file: ReportedFile; records: CollegeRecord[] };
  directories: { files: DirectoryFile[]; pages: PagesFile };
  history: { schools: Map<string, SchoolHistory>; shared: Partial<HistoryFiles> };
  /** `high_schools.*`, by collection then key (rendered as the JSON fallback). */
  highSchools: Map<string, Map<string, unknown>>;
  /** `reference.files`, by name (text files as `{text}`). */
  reference: Map<string, unknown>;
  /** `base.source_files` (the source files' health, read by the admin console): rendered as `source-files.json`. */
  sourceFiles?: unknown | null;
  /** The live rows of `data_field_edits` (unreleased; the compose takes the newest per path). */
  edits: FieldEdit[];
  /**
   * The rows of `essay_prompt_overrides`, or null when they weren't read (the file store): with rows, the open
   * cycle's valid rows replace the `essays.confirmed` layer, as the nightly export mirrors the table into it.
   */
  promptOverrides: OverrideRow[] | null;
  /** Each collection's newest document version at load (collection → version), for the manifest. */
  versions: Record<string, number>;
}

/** The high-school collections the fallback renders, in object order. Pipeline state (ledger, recipes) stays out. */
export const HIGH_SCHOOL_COLLECTIONS = [COLLECTIONS.highSchools.schools, COLLECTIONS.highSchools.state, COLLECTIONS.highSchools.detail, COLLECTIONS.highSchools.shared] as const;
/** The shared high-school files `lib/high-school-store.ts` reads (the others are pipeline state). */
export const HIGH_SCHOOL_SHARED = ["meta", "medians"] as const;

/**
 * A store that remembers each collection's newest version as the loaders read it (the manifest's `layers`), so the
 * versions cost no second read. Reads go through `readVersioned`.
 */
export function recordingStore(store: DataStore): { store: DataStore; versions: Record<string, number> } {
  const versions: Record<string, number> = {};
  const note = (collection: string, docs: Map<string, { version: number }>) => {
    for (const d of docs.values()) versions[collection] = Math.max(versions[collection] ?? 0, d.version);
  };
  const wrapped: DataStore = {
    ...store,
    async readVersioned<T>(collection: string, keyPrefix?: string) {
      const docs = await store.readVersioned<T>(collection, keyPrefix);
      note(collection, docs);
      return docs;
    },
    async read<T>(collection: string, keyPrefix?: string) {
      const docs = await wrapped.readVersioned<T>(collection, keyPrefix);
      return new Map([...docs].map(([k, v]) => [k, v.body]));
    },
    async readOne<T>(collection: string, key: string) {
      const docs = await wrapped.readVersioned<T>(collection, key);
      return docs.get(key)?.body ?? null;
    },
  };
  return { store: wrapped, versions };
}

/** Reads every layer the compose needs. `edits` and `promptOverrides` come from their tables (the caller reads them). */
export async function loadPublishLayers(source: DataStore, extra: { edits?: FieldEdit[]; promptOverrides?: OverrideRow[] | null } = {}): Promise<PublishLayers> {
  const { store, versions } = recordingStore(source);
  const base = await loadBase(store);
  const identity = await loadIdentity(store);
  const commonApp = await loadCommonAppLayer(store);
  const coalition = await loadCoalitionLayer(store);
  const essays = await loadEssaysLayer(store);
  const reported = await loadReportedLayer(store);
  const directories = await loadDirectoriesLayer(store);
  const historySchools = await readLayer<SchoolHistory>(store, COLLECTIONS.history.schools);
  const shared = Object.fromEntries(await readLayer<unknown>(store, COLLECTIONS.history.shared)) as Partial<HistoryFiles>;
  const highSchools = new Map<string, Map<string, unknown>>();
  for (const c of HIGH_SCHOOL_COLLECTIONS) highSchools.set(c, await readLayer<unknown>(store, c));
  const reference = await readLayer<unknown>(store, COLLECTIONS.reference.files);
  const sourceFiles = await store.readOne<unknown>(COLLECTIONS.base.sourceFiles, SINGLE_KEYS.sourceFiles);
  return {
    base,
    sourceFiles,
    identity,
    commonApp,
    coalition,
    essays,
    reported,
    directories,
    history: { schools: historySchools, shared },
    highSchools,
    reference,
    edits: extra.edits ?? [],
    promptOverrides: extra.promptOverrides ?? null,
    versions: Object.fromEntries(Object.entries(versions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

/* ------------------------------------------------------------------ */
/* The compose                                                         */
/* ------------------------------------------------------------------ */

/** One national trend file (data/history/trends/<name>.json; `index` is the cards file). */
export interface TrendDocument {
  name: string;
  file: unknown;
}

export interface ComposedSnapshot {
  schools: School[];
  meta: DatasetMeta;
  releaseCalendar: ReleaseCalendar;
  aliases: AliasRow[];
  history: { schools: Map<string, SchoolHistory>; shared: Partial<HistoryFiles> };
  detail: SchoolDetail[];
  trends: TrendDocument[];
  searchIndex: SearchIndex;
  highSchools: Map<string, Map<string, unknown>>;
  reference: Map<string, unknown>;
  /** `base.source_files`, passed through for `source-files.json` (null when the layer has none). */
  sourceFiles: unknown | null;
  /** The hidden selectivity index (never published; the tier history reads it). */
  selectivity: SelectivityIndexFile;
  /** Lineage failures (and refused edits): any one fails the publish. */
  problems: string[];
  /** Cross-checks that fail sync-data but only warn here in phase 1. */
  warnings: string[];
  /** Live edits applied, and colleges they touched. */
  edits: { applied: number; colleges: number };
  /** `edits.json`'s body (specs/data-platform/change-sets.md "Admin edits", precedence): every applied edit with the
   * pipelines' value and lineage at that path before step 14. Empty when no edit applied. */
  editsObject: SnapshotEditsObject["edits"];
  versions: Record<string, number>;
}

export interface ComposeOptions {
  /** The previous snapshot's colleges (hysteresis for the tiers, the carried trends); null for a first snapshot. */
  previous: readonly School[] | null;
  /** ISO day: the open essay cycle, the Common App merge's day, the index's `generated`. */
  today: string;
  /**
   * Whether to build the national trend files (default true). The builders rank and compare every college, so a
   * fixture of a few colleges (tests, the mini fixture) skips them; a builder that throws on the real data is a problem.
   */
  trends?: boolean;
}

/** The hand-read records the essays step applies: the layer's, or with the console's rows read, the open cycle's rows. */
export function confirmedRecords(layers: Pick<PublishLayers, "essays" | "promptOverrides">, today: string): { records: ConfirmedRecord[]; skipped: string[] } {
  if (!layers.promptOverrides) return { records: layers.essays.confirmed, skipped: [] };
  const picked = confirmedFromRows(layers.promptOverrides, today);
  // A row that fails its checks leaves the college as the layer had it (the export leaves its file).
  const kept = layers.essays.confirmed.filter((r) => picked.held.has(r.unit_id));
  const records = [...picked.records, ...kept].sort((a, b) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0));
  return { records, skipped: picked.skipped };
}

/** The value at a school's dotted path, or undefined when nothing is there (edits.json's pre-edit capture). */
function valueAt(school: School, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), school as unknown);
}

/** The layers composed into a snapshot's documents. Never mutates `layers`. */
export function composeSnapshot(input: PublishLayers, opts: ComposeOptions): ComposedSnapshot {
  const layers = structuredClone(input);
  const { base, identity } = layers;
  if (!base.meta) throw new Error("compose: the base layer has no meta (base.meta)");
  if (!base.calendar) throw new Error("compose: the base layer has no release calendar (base.release_calendar)");
  const problems: string[] = [];
  const warnings: string[] = [];

  // 1–3. The base, identity, the legacy overrides, the name sort.
  let schools = base.schools.map((s) => {
    const withIdentity = applyIdentity(s, identity);
    const patch = identity.overrides[s.unit_id];
    return patch ? applyOverride(withIdentity, patch) : withIdentity;
  });
  schools = datasetOrder(schools);

  // 5. Trends, derived from the history layer as sync-history writes them, so a history run reaches the site. A
  // college with no history document keeps the previous snapshot's trends (or the base copy's).
  const carried = new Map(opts.previous?.map((s) => [s.unit_id, s.trends]) ?? []);
  const { schools: histories, shared: historyShared } = layers.history;
  if (historyShared.cpi && historyShared.meta) {
    deriveTrends(schools.filter((s) => histories.has(s.unit_id)), histories, historyShared.cpi, historyShared.meta);
    carryTrends(schools.filter((s) => !histories.has(s.unit_id)), carried);
  } else carryTrends(schools, carried);

  // 6. Meta: the base's (the IPEDS stages' add*Meta already ran in sync-data), then each later layer's.
  const meta = base.meta;
  addIdentityMeta(meta, identity);

  // 7. Common App.
  if (layers.commonApp) {
    schools = applyCommonApp(schools, layers.commonApp.edition, layers.commonApp.members, opts.today).schools;
    addCommonAppMeta(meta, layers.commonApp.edition, layers.commonApp.members);
  }
  // 8. Coalition.
  if (layers.coalition) {
    schools = applyCoalition(schools, layers.coalition).schools;
    addCoalitionMeta(meta, layers.coalition);
  }
  // 9. Essays: the reader's records (held ones are another collection) and the hand-read ones.
  const confirmed = confirmedRecords(layers, opts.today);
  for (const s of confirmed.skipped) warnings.push(`essay_prompt_overrides row skipped: ${s}`);
  if (layers.essays.records.length || confirmed.records.length) {
    warnings.push(...confirmedProblems(confirmed.records, opts.today));
    schools = applyEssays(schools, layers.essays.records, opts.today, confirmed.records).schools;
  }
  // 10. College-reported values and the CDS records (after meta: the newest groups need its federal years).
  const { file: reportedFile, records: cdsRecords } = layers.reported;
  if (reportedFile.updated || reportedFile.entries.length || cdsRecords.length) {
    schools = mergeReported(schools, reportedFile, { records: cdsRecords, meta, table: CDS_TEMPLATE }).schools;
  }
  // 12. Directories, CCCU membership, the pilot's policy facts.
  const directories = applyDirectoryLayers(schools, layers.directories.files, layers.directories.pages, meta);
  schools = directories.schools;
  // 13. Detail tables: the base's (residence, majors, field of study) and the later layers'.
  const detail = mergeDetails(base.details, financialAidDetails(schools, cdsRecords), directories.tables, directories.pagesTables);
  warnings.push(...detailProblems(schools, detail, meta));

  // 14. Field edits, the last layer.
  const editsByUnit = new Map<string, FieldEdit[]>();
  const known = new Set(schools.map((s) => s.unit_id));
  for (const e of layers.edits) {
    if (e.released_at) continue;
    const refused = editProblem(e) ?? (e.path.startsWith("detail.") ? `edit ${e.unit_id} ${e.path}: detail tables can't be edited` : null) ?? (known.has(e.unit_id) ? null : `edit ${e.unit_id} ${e.path}: no such college`);
    if (refused) {
      problems.push(refused);
      continue;
    }
    editsByUnit.set(e.unit_id, [...(editsByUnit.get(e.unit_id) ?? []), e]);
  }
  let applied = 0;
  const editsObject: SnapshotEditsObject["edits"] = [];
  if (editsByUnit.size) {
    schools = schools.map((s) => {
      const mine = editsByUnit.get(s.unit_id);
      if (!mine) return s;
      const live = liveEdits(mine);
      applied += live.length;
      for (const e of live) {
        const pre = valueAt(s, e.path);
        const preLineage = ((s.lineage as Record<string, LineageRecord> | undefined) ?? {})[e.path] ?? null;
        editsObject.push({
          id: e.id,
          unit_id: e.unit_id,
          path: e.path,
          value: e.value,
          note: e.note ?? null,
          created_at: e.created_at,
          pipeline: pre === undefined ? null : { value: pre, lineage: preLineage },
        });
      }
      return withEdits(s, mine);
    });
    editsObject.sort((a, b) => (a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    meta.sources["quad-edit"] = quadEditSource();
  }

  // 15. Quad's selectivity, with hysteresis against the previous snapshot's tiers.
  const previousTiers = opts.previous ? new Map<string, SchoolSelectivity | undefined>(opts.previous.map((s) => [s.unit_id, s.selectivity])) : undefined;
  const selectivity = buildSelectivity(schools, meta, { previous: previousTiers, prior: null, today: opts.today });
  schools = selectivity.schools;
  warnings.push(...selectivityProblems(schools, selectivity.file, meta));

  // 16. Nothing is published unless every value's lineage checks out.
  problems.push(...validateLineage(schools, meta));

  // Derived: the alias table (IPEDS rows as the base has them; Wikidata, domains, curated, Common App rebuilt).
  const aliases = aliasRowsFrom({
    schools,
    hdRows: null,
    existing: base.aliases,
    wikidata: identity.wikidata,
    // Entries for colleges not in the dataset are skipped either way; leaving them out here spares the warning.
    curated: ((layers.reference.get("aliases-curated") as CuratedAliasEntry[] | undefined) ?? []).filter((c) => known.has(c.unit_id)),
    commonApp: layers.commonApp?.members ?? null,
  });

  // The national trend files, from the composed colleges and the history layer (as build-trends reads the files).
  const trends: TrendDocument[] = [];
  const { shared } = layers.history;
  if (opts.trends !== false && shared.meta && shared.cpi && shared.national && shared.facts) {
    const detailById = new Map(detail.map((d) => [d.unit_id, d]));
    const excluded = layers.reference.get("excluded-campuses") as CampusExclusionEntry[] | undefined;
    const ctx = trendContextFrom({
      root: "",
      schools,
      histories: layers.history.schools,
      hmeta: shared.meta,
      cpi: shared.cpi,
      national: shared.national,
      facts: shared.facts,
      detail: (id) => detailById.get(id) ?? null,
      excludedCampuses: excluded ?? [],
    });
    try {
      const { outputs, index } = computeTrends(ctx);
      trends.push(...outputs.map((o) => ({ name: o.name, file: o.file })), { name: "index", file: index });
    } catch (err) {
      problems.push(`trends: a builder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const searchIndex = buildSearchIndex({ getAllSchools: () => schools, getMeta: () => meta }, aliases);

  return {
    schools,
    meta,
    releaseCalendar: base.calendar,
    aliases,
    history: layers.history,
    sourceFiles: layers.sourceFiles ?? null,
    detail,
    trends,
    searchIndex,
    highSchools: layers.highSchools,
    reference: layers.reference,
    selectivity: selectivity.file,
    problems,
    warnings,
    edits: { applied, colleges: editsByUnit.size },
    editsObject,
    versions: layers.versions,
  };
}
