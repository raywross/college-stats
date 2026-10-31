/**
 * The import (specs/data-platform/pipelines.md "The import"): reads today's data/ files once and writes every layer
 * (specs/data-platform/storage.md "Collections"; names in scripts/lib/data-platform/layers.mts) in one change set of
 * kind `import`, source `git`, run_ref the HEAD commit.
 *
 *   npm run import-data-from-git -- --store file:/tmp/dp-import            # a folder (the file store)
 *   npm run import-data-from-git -- --store supabase                        # the data project (DATA_SUPABASE_*)
 *   npm run import-data-from-git -- --store file:/tmp/dp-import --dry-run   # counts per collection, writes nothing
 *   npm run import-data-from-git -- --store … --only base.colleges,base.meta
 *
 * The base layer: the IPEDS downloads aren't in git, so the committed data/schools.json is stripped of the later
 * layers with each layer's own strip, in reverse order of application (`stripLaterLayers`): the selectivity block
 * (`placeSelectivity(school, undefined)`), the directories' three steps (`stripLgbtqPolicies`, `stripCccuMembership`,
 * `stripDirectories`), the college-reported merge (`stripReported`), essays (`stripEssays`), Coalition
 * (`stripCoalition`), Common App (`stripCommonApp`). Identity and the legacy overrides stay in the base copy (their
 * appliers are idempotent, so the compose re-applying them changes nothing; tests/data-platform-import.test.mts proves
 * it) and identity is also written as its own layers; `trends` stays in the base copy (carried, not rebuilt). The proof
 * that the import is faithful: re-applying the layers in the compose order gives each committed college back byte for
 * byte (the same test, and on every college with `--check`).
 *
 * A collection the import writes is mirrored: a document in the store that git no longer has is removed in the same
 * change set. With `--only`, only the named collections are read, written and mirrored.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { DETAIL_TABLES, formatDetail, mergeDetails, type DetailTableKey, type SchoolDetail } from "../lib/detail.ts";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import { mergeReported, stripReported } from "../lib/reported-merge.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { financialAidDetails } from "../lib/cds/financial-aid.ts";
import { dedupeAliases } from "../lib/aliases.ts";
import type { AliasRow } from "../lib/identity-files";
import { applyEssays, stripEssays } from "./lib/essay-prompts/merge.mts";
import { applyCoalition, stripCoalition } from "./lib/coalition/merge.mts";
import { applyCommonApp, stripCommonApp } from "./lib/common-app/merge.mts";
import { applyCccuMembership, applyDirectories, chapterFiles, directoryDetails, stripCccuMembership, stripDirectories } from "./lib/directories/merge.mts";
import { applyLgbtqPolicies, campusPagesDetails, pilotDirectoryFiles, stripLgbtqPolicies } from "./lib/campus-pilot/merge.mts";
import { buildSelectivity, placeSelectivity } from "./lib/selectivity.mts";
import { commonAppAliasRows, formatAliasRows } from "./lib/aliases-sync.mts";
import { fileStore, flagValue, orderedJson, parseStoreFlag, storeFromFlag, type DataStore } from "./lib/data-platform/store.mts";
import {
  ALL_COLLECTIONS,
  COLLECTIONS,
  REFERENCE_FILES,
  SINGLE_KEYS,
  loadBase,
  loadCoalitionLayer,
  loadCommonAppLayer,
  loadDirectoriesLayer,
  loadEssaysLayer,
  loadReportedLayer,
  type CollectionName,
} from "./lib/data-platform/layers.mts";

/* ------------------------------------------------------------------ */
/* The base: strips                                                    */
/* ------------------------------------------------------------------ */

/**
 * One committed college without the later layers: what sync-data has before its Common App step (plus `trends`,
 * carried). The strips run in reverse order of application; each is its merge's own inverse (the merges' re-merge
 * tests hold them to it), so applying the layers again in the compose order restores the college byte for byte.
 */
export function stripLaterLayers(school: School): School {
  let s = placeSelectivity(school, undefined);
  s = stripLgbtqPolicies(s);
  s = stripCccuMembership(s);
  s = stripDirectories(s);
  s = stripReported(s);
  s = stripEssays(s);
  s = stripCoalition(s);
  s = stripCommonApp(s);
  return s;
}

/** Lineage sources only a later layer writes (identity's `college-site` records stay: identity is in the base). */
const LATER_SOURCES = new Set(["common-app", "coalition", "directory", "policy-page"]);

/**
 * What a later layer left on a base college (empty for a true base). The re-apply check alone can't see a strip that
 * was skipped (most merges strip their own block before applying), so the import holds every base to this too.
 */
export function baseProblems(school: School): string[] {
  const out: string[] = [];
  const where = school.unit_id;
  for (const k of ["apply", "coalition", "essays", "reported", "directories", "selectivity"] as const) if (k in school) out.push(`${where}: has ${k}`);
  if (school.admissions?.federal) out.push(`${where}: has admissions.federal (the reported merge's)`);
  if (school.aid && "international_offered" in school.aid) out.push(`${where}: has aid.international_offered (Common App's)`);
  if (school.links?.transfer_guarantee || school.links?.daca_aid) out.push(`${where}: has Common App's links`);
  if (school.religion?.cccu_member) out.push(`${where}: has religion.cccu_member`);
  if (school.lgbtq?.policies) out.push(`${where}: has lgbtq.policies`);
  for (const [path, rec] of Object.entries(school.lineage ?? {})) {
    if (path.startsWith("reported.") || path === "essays" || path === "directories") out.push(`${where}: lineage ${path}`);
    else if (rec && LATER_SOURCES.has(rec.source)) out.push(`${where}: lineage ${path} cites ${rec.source}`);
    else if (rec?.source === "college-site" && !/^(links|social|brand)\./.test(path)) out.push(`${where}: lineage ${path} cites college-site (only identity's may)`);
  }
  return out;
}

/**
 * Detail tables the later layers build at compose (`financialAidDetails` from the CDS records, `directoryDetails`,
 * `campusPagesDetails`); the rest are the base's (residence, majors, field of study). Common App adds none.
 */
export const LATER_DETAIL_TABLES: readonly DetailTableKey[] = ["cds_aid", "directories", "campus_pages"];

/** A college's detail document without the later layers' tables, or null when none is left. */
export function baseDetail(d: SchoolDetail): SchoolDetail | null {
  const tables = Object.fromEntries(Object.entries(d.tables).filter(([k]) => !(LATER_DETAIL_TABLES as readonly string[]).includes(k)));
  return Object.keys(tables).length ? ({ unit_id: d.unit_id, tables } as SchoolDetail) : null;
}

/* ------------------------------------------------------------------ */
/* Files → layers                                                      */
/* ------------------------------------------------------------------ */

export type ImportedLayers = Map<CollectionName, Map<string, unknown>>;

/** A row of a per-college state file (its other fields are kept whole). */
type UnitRow = { unit_id: string };

export interface ImportOptions {
  /** Only these collections (default: all). */
  only?: ReadonlySet<string>;
  /** Only these colleges in the per-college collections (the mini fixture); whole-file documents are unaffected. */
  units?: ReadonlySet<string>;
}

/** Files under data/ the import deliberately leaves out, with why (printed by --dry-run). */
export const NOT_IMPORTED: Readonly<Record<string, string>> = {
  "selectivity-index.json": "the hidden index: every layer is public-read, and the index never ships (specs/chances); the publisher rebuilds tiers from the previous snapshot's",
  "history/trends/": "derived at publish (build-trends), storage.md",
  "common-app/grid/*.pdf": "the PDF stays in the archive, storage.md",
  "**/README.md": "documentation of the folder, not data",
};

/**
 * Every layer from the files under `root`/data. Pure apart from the reads; `units` limits the per-college collections.
 * Throws on a file the import can't place (an unregistered text file in data/reference/, a duplicate key).
 */
export function importLayers(root: string, opts: ImportOptions = {}): ImportedLayers {
  const data = join(root, "data");
  const out: ImportedLayers = new Map();
  const want = (c: CollectionName) => !opts.only || opts.only.has(c);
  const unitOk = (id: string) => !opts.units || opts.units.has(id);
  const path = (rel: string) => join(data, rel);
  const has = (rel: string) => existsSync(path(rel));
  const json = <T,>(rel: string): T => JSON.parse(readFileSync(path(rel), "utf8")) as T;
  const files = (rel: string, ext = ".json"): string[] => (has(rel) ? readdirSync(path(rel)).filter((f) => f.endsWith(ext) && statSync(path(join(rel, f))).isFile()).sort() : []);
  const put = (c: CollectionName, key: string, body: unknown) => {
    if (!want(c)) return;
    const docs = out.get(c) ?? out.set(c, new Map()).get(c)!;
    if (docs.has(key)) throw new Error(`import: ${c} has two documents keyed ${key}`);
    docs.set(key, body);
  };
  const touch = (c: CollectionName) => {
    if (want(c) && !out.has(c)) out.set(c, new Map());
  };
  /** A file's top-level fields other than `entries` (its `updated`, `generated`, …), kept in import.headers. */
  const header = (rel: string, file: Record<string, unknown>, entries: string) => {
    const rest = Object.fromEntries(Object.entries(file).filter(([k]) => k !== entries));
    if (Object.keys(rest).length) put(COLLECTIONS.import.headers, rel, rest);
  };
  /** One document per entry of an array of `{unit_id}` rows (each kept whole). */
  const perUnit = <T extends { unit_id: string }>(c: CollectionName, rows: readonly T[]) => {
    touch(c);
    for (const r of rows) if (unitOk(r.unit_id)) put(c, r.unit_id, r);
  };
  /** One document per unit id holding that college's rows, in file order. */
  const groupedPerUnit = <T extends { unit_id: string }>(c: CollectionName, rows: readonly T[]) => {
    touch(c);
    const by = new Map<string, T[]>();
    for (const r of rows) if (unitOk(r.unit_id)) by.set(r.unit_id, [...(by.get(r.unit_id) ?? []), r]);
    for (const [id, list] of by) put(c, id, list);
  };
  /** One document per `<unit>.json` file in a folder. */
  const unitFolder = (c: CollectionName, rel: string) => {
    touch(c);
    for (const f of files(rel)) {
      const id = f.slice(0, -".json".length);
      if (unitOk(id)) put(c, id, json(join(rel, f)));
    }
  };

  // --- base ---
  if (want(COLLECTIONS.base.colleges)) {
    const bases = json<School[]>("schools.json").map(stripLaterLayers);
    const problems = bases.flatMap(baseProblems);
    if (problems.length) throw new Error(`import: ${problems.length} later-layer values survived the strips:\n  ${problems.slice(0, 20).join("\n  ")}`);
    perUnit(COLLECTIONS.base.colleges, bases);
  }
  if (want(COLLECTIONS.base.detail)) {
    touch(COLLECTIONS.base.detail);
    for (const f of files("detail/schools")) {
      const d = baseDetail(json<SchoolDetail>(join("detail/schools", f)));
      if (d && unitOk(d.unit_id)) put(COLLECTIONS.base.detail, d.unit_id, d);
    }
  }
  if (has("meta.json")) put(COLLECTIONS.base.meta, SINGLE_KEYS.meta, json<DatasetMeta>("meta.json"));
  if (has("release-calendar.json")) put(COLLECTIONS.base.releaseCalendar, SINGLE_KEYS.calendar, json("release-calendar.json"));
  // The base's alias rows; the compose adds Common App's (commonAppAliasRows) and dedupes, which gives the file back.
  if (has("aliases.json")) put(COLLECTIONS.base.aliases, SINGLE_KEYS.aliases, json<{ source: string }[]>("aliases.json").filter((r) => r.source !== "common-app"));
  if (has("source-files.json")) put(COLLECTIONS.base.sourceFiles, SINGLE_KEYS.sourceFiles, json("source-files.json"));

  // --- identity ---
  if (has("wikidata.json")) perUnit(COLLECTIONS.identity.wikidata, json<UnitRow[]>("wikidata.json"));
  if (has("site-probe.json")) perUnit(COLLECTIONS.identity.probe, json<UnitRow[]>("site-probe.json"));
  if (has("link-issues.json")) groupedPerUnit(COLLECTIONS.identity.linkIssues, json<UnitRow[]>("link-issues.json"));
  if (has("brand-colors.json")) perUnit(COLLECTIONS.identity.brandColors, json<UnitRow[]>("brand-colors.json"));
  if (has("brand-logos.json")) perUnit(COLLECTIONS.identity.brandLogos, json<UnitRow[]>("brand-logos.json"));
  if (has("brand-overrides.json")) {
    touch(COLLECTIONS.identity.brandOverrides);
    for (const [id, o] of Object.entries(json<Record<string, unknown>>("brand-overrides.json"))) if (unitOk(id)) put(COLLECTIONS.identity.brandOverrides, id, o);
  }
  if (has("wikidata-issues.json")) groupedPerUnit(COLLECTIONS.identity.wikidataIssues, json<UnitRow[]>("wikidata-issues.json"));

  // --- college-reported ---
  if (has("college-reported.json")) {
    const f = json<{ entries: { unit_id: string }[] } & Record<string, unknown>>("college-reported.json");
    header("college-reported.json", f, "entries");
    perUnit(COLLECTIONS.reported.entries, f.entries);
  }
  if (want(COLLECTIONS.reported.cdsRecords)) unitFolder(COLLECTIONS.reported.cdsRecords, "cds-records");
  if (has("college-sources.json")) {
    const f = json<{ recipes: { unit_id: string }[] } & Record<string, unknown>>("college-sources.json");
    header("college-sources.json", f, "recipes");
    perUnit(COLLECTIONS.reported.sources, f.recipes);
  }
  if (has("college-docs.json")) {
    const f = json<{ documents: { sha256: string; unit_id: string }[] } & Record<string, unknown>>("college-docs.json");
    header("college-docs.json", f, "documents");
    touch(COLLECTIONS.reported.docs);
    for (const d of f.documents) if (unitOk(d.unit_id)) put(COLLECTIONS.reported.docs, d.sha256, d);
  }
  if (has("college-batches.json")) {
    const f = json<{ batches: { id: string }[] } & Record<string, unknown>>("college-batches.json");
    header("college-batches.json", f, "batches");
    touch(COLLECTIONS.reported.batches);
    for (const b of f.batches) put(COLLECTIONS.reported.batches, b.id, b);
  }
  if (has("review-queue.json")) {
    const f = json<{ items: ReviewItem[] } & Record<string, unknown>>("review-queue.json");
    header("review-queue.json", f, "items");
    touch(COLLECTIONS.reported.reviewQueue);
    for (const i of f.items) if (unitOk(i.unit_id)) put(COLLECTIONS.reported.reviewQueue, reviewKey(i), i);
  }
  if (has("college-failures.json")) {
    const f = json<{ rows: { unit_id: string }[] } & Record<string, unknown>>("college-failures.json");
    header("college-failures.json", f, "rows");
    groupedPerUnit(COLLECTIONS.reported.failures, f.rows);
  }
  if (want(COLLECTIONS.reported.reports)) {
    touch(COLLECTIONS.reported.reports);
    for (const f of has("reports") ? readdirSync(path("reports")).sort() : []) {
      const text = readFileSync(path(join("reports", f)), "utf8");
      put(COLLECTIONS.reported.reports, f, f.endsWith(".json") ? JSON.parse(text) : { text });
    }
  }

  // --- directories and the campus pilot ---
  if (want(COLLECTIONS.directories.listings)) {
    touch(COLLECTIONS.directories.listings);
    for (const f of files("directories").filter((n) => !["blocked.json", "matches.json", "organizations.json"].includes(n))) {
      const d = json<{ org: string }>(join("directories", f));
      if (`${d.org}.json` !== f) throw new Error(`import: data/directories/${f} names org ${d.org}`);
      put(COLLECTIONS.directories.listings, d.org, d);
    }
  }
  if (want(COLLECTIONS.directories.unmatched)) {
    touch(COLLECTIONS.directories.unmatched);
    for (const f of files("directories/unmatched")) put(COLLECTIONS.directories.unmatched, f.slice(0, -".json".length), json(join("directories/unmatched", f)));
  }
  if (has("directories/blocked.json")) put(COLLECTIONS.directories.blocked, SINGLE_KEYS.blocked, json("directories/blocked.json"));
  if (has("directories/matches.json")) put(COLLECTIONS.directories.matches, SINGLE_KEYS.matches, json("directories/matches.json"));
  if (has("campus-pages.json")) {
    const f = json<{ colleges: { unit_id: string }[] } & Record<string, unknown>>("campus-pages.json");
    header("campus-pages.json", f, "colleges");
    perUnit(COLLECTIONS.campus.pages, f.colleges);
  }
  if (has("campus-sources.json")) {
    const f = json<{ recipes: { unit_id: string }[] } & Record<string, unknown>>("campus-sources.json");
    header("campus-sources.json", f, "recipes");
    perUnit(COLLECTIONS.campus.sources, f.recipes);
  }

  // --- Common App, Coalition ---
  if (want(COLLECTIONS.commonApp.grid)) {
    touch(COLLECTIONS.commonApp.grid);
    for (const f of files("common-app/grid")) put(COLLECTIONS.commonApp.grid, f.slice(0, -".json".length), json(join("common-app/grid", f)));
  }
  if (has("common-app/members.json")) put(COLLECTIONS.commonApp.members, SINGLE_KEYS.members, json("common-app/members.json"));
  if (has("common-app/name-map.json")) put(COLLECTIONS.commonApp.nameMap, SINGLE_KEYS.nameMap, json("common-app/name-map.json"));
  if (has("coalition/members.json")) put(COLLECTIONS.coalition.members, SINGLE_KEYS.members, json("coalition/members.json"));
  if (has("coalition/name-map.json")) put(COLLECTIONS.coalition.nameMap, SINGLE_KEYS.nameMap, json("coalition/name-map.json"));

  // --- essays ---
  if (want(COLLECTIONS.essays.records)) unitFolder(COLLECTIONS.essays.records, "essay-prompts/records");
  if (want(COLLECTIONS.essays.held)) unitFolder(COLLECTIONS.essays.held, "essay-prompts/held");
  if (want(COLLECTIONS.essays.confirmed)) unitFolder(COLLECTIONS.essays.confirmed, "essay-prompts/confirmed");
  if (has("essay-prompts/pages.json")) {
    const f = json<{ pages: Record<string, unknown> } & Record<string, unknown>>("essay-prompts/pages.json");
    header("essay-prompts/pages.json", f, "pages");
    touch(COLLECTIONS.essays.pages);
    for (const [id, p] of Object.entries(f.pages)) if (unitOk(id)) put(COLLECTIONS.essays.pages, id, p);
  }
  if (has("essay-prompts/last-run.json")) {
    const run = json<{ run: string }>("essay-prompts/last-run.json");
    put(COLLECTIONS.essays.runs, run.run, run);
  }

  // --- history ---
  if (want(COLLECTIONS.history.schools)) unitFolder(COLLECTIONS.history.schools, "history/schools");
  for (const name of ["meta", "national", "facts", "cpi"]) if (has(`history/${name}.json`)) put(COLLECTIONS.history.shared, name, json(`history/${name}.json`));

  // --- high schools: one document per state shard, per detail file, and per shared file ---
  const shards = (c: CollectionName, rel: string) => {
    touch(c);
    for (const f of files(rel)) put(c, f.slice(0, -".json".length), json(join(rel, f)));
  };
  if (want(COLLECTIONS.highSchools.schools)) shards(COLLECTIONS.highSchools.schools, "high-schools/schools");
  if (want(COLLECTIONS.highSchools.ledger)) shards(COLLECTIONS.highSchools.ledger, "high-schools/ledger");
  if (want(COLLECTIONS.highSchools.state)) shards(COLLECTIONS.highSchools.state, "high-schools/state");
  if (want(COLLECTIONS.highSchools.detail)) shards(COLLECTIONS.highSchools.detail, "high-schools/detail");
  if (want(COLLECTIONS.highSchools.shared)) shards(COLLECTIONS.highSchools.shared, "high-schools");

  // --- reference documents ---
  if (want(COLLECTIONS.reference.files)) {
    touch(COLLECTIONS.reference.files);
    const placed = new Set<string>();
    const add = (name: string, rel: string) => {
      const text = readFileSync(path(rel), "utf8");
      put(COLLECTIONS.reference.files, name, rel.endsWith(".json") ? JSON.parse(text) : { text });
      placed.add(rel);
    };
    for (const [name, rel] of Object.entries(REFERENCE_FILES)) if (has(rel)) add(name, rel);
    for (const rel of walk(path("reference")).map((p) => relative(data, p))) {
      if (placed.has(rel) || rel.endsWith("README.md")) continue;
      if (!rel.endsWith(".json")) throw new Error(`import: data/${rel} is a text reference file not in REFERENCE_FILES (scripts/lib/data-platform/layers.mts); register it first`);
      add(relative("reference", rel).slice(0, -".json".length), rel);
    }
  }

  // --- the legacy overrides, the health file ---
  if (has("overrides.json")) {
    const f = json<Record<string, unknown>>("overrides.json");
    const meta = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("_")));
    if (Object.keys(meta).length) put(COLLECTIONS.import.headers, "overrides.json", meta);
    touch(COLLECTIONS.overrides.legacy);
    for (const [id, patch] of Object.entries(f)) if (!id.startsWith("_") && unitOk(id)) put(COLLECTIONS.overrides.legacy, id, patch);
  }
  if (has("college-health.json")) put(COLLECTIONS.health.colleges, SINGLE_KEYS.health, json("college-health.json"));

  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** The DETAIL_TABLES keys (re-exported so a test can check LATER_DETAIL_TABLES names real tables). */
export const DETAIL_TABLE_KEYS = Object.keys(DETAIL_TABLES) as DetailTableKey[];

/* ------------------------------------------------------------------ */
/* Layers → a store                                                    */
/* ------------------------------------------------------------------ */

export interface CollectionCount {
  documents: number;
  bytes: number;
  /** Against the store's current documents (null when the store couldn't be read). */
  added: number | null;
  changed: number | null;
  unchanged: number | null;
  removed: number | null;
}

/** What writing `layers` would do to `store`, per collection (reads only). */
export async function countImport(layers: ImportedLayers, store: DataStore | null): Promise<Map<string, CollectionCount>> {
  const out = new Map<string, CollectionCount>();
  for (const [c, docs] of layers) {
    let current: Map<string, unknown> | null = null;
    if (store) current = await store.read(c).catch(() => null);
    let bytes = 0;
    let added = 0;
    let changed = 0;
    let unchanged = 0;
    for (const [key, body] of docs) {
      const text = orderedJson(body);
      bytes += Buffer.byteLength(text);
      if (!current) continue;
      if (!current.has(key)) added++;
      else if (orderedJson(current.get(key)) === text) unchanged++;
      else changed++;
    }
    const removed = current ? [...current.keys()].filter((k) => !docs.has(k)).length : null;
    out.set(c, { documents: docs.size, bytes, added: current ? added : null, changed: current ? changed : null, unchanged: current ? unchanged : null, removed });
  }
  return out;
}

/**
 * Writes `layers` into one change set (kind import, source git) and closes it applied; documents the store has in an
 * imported collection that `layers` lacks are removed. Returns the change set's id.
 */
export async function writeImport(store: DataStore, layers: ImportedLayers, runRef: string, log: (line: string) => void = () => {}): Promise<number> {
  const handle = await store.open("import", "git", runRef, { note: `imported from git at ${runRef}` });
  for (const [c, docs] of layers) {
    await handle.write(c, [...docs].map(([key, body]) => ({ key, body })));
    const stale = [...(await store.read(c)).keys()].filter((k) => !docs.has(k));
    if (stale.length) await handle.remove(c, stale);
    log(`  ${c}: ${docs.size} documents${stale.length ? `, ${stale.length} removed` : ""}`);
  }
  await handle.close("applied");
  return handle.id;
}

/* ------------------------------------------------------------------ */
/* The proof: re-applying the layers                                   */
/* ------------------------------------------------------------------ */

export interface Reapplied {
  schools: School[];
  details: SchoolDetail[];
  aliases: AliasRow[];
}

/**
 * The later layers re-applied to the stored base in sync-data's order (identity and the legacy overrides are already
 * in the base; trends carried): Common App, Coalition, essays, the college-reported merge, the directories' three
 * steps, then selectivity. Selectivity is taken from `previous` (the committed tiers, placed with `placeSelectivity`)
 * unless `rebuildSelectivity` is set, which runs `buildSelectivity` with hysteresis against them (only meaningful over
 * the whole dataset: its scales are computed over the colleges given). This is the import's check, not the publisher:
 * scripts/lib/data-platform/compose.mts composes for real and must give the same bytes.
 */
export async function reapplyLaterLayers(
  store: DataStore,
  opts: { previous: ReadonlyMap<string, School["selectivity"]>; today: string; rebuildSelectivity?: { meta: DatasetMeta } }
): Promise<Reapplied> {
  const base = await loadBase(store);
  if (!base.meta) throw new Error("reapply: no base.meta");
  let schools = base.schools;
  const commonApp = await loadCommonAppLayer(store);
  if (commonApp) schools = applyCommonApp(schools, commonApp.edition, commonApp.members, opts.today).schools;
  const coalition = await loadCoalitionLayer(store);
  if (coalition) schools = applyCoalition(schools, coalition).schools;
  const essays = await loadEssaysLayer(store);
  if (essays.records.length || essays.confirmed.length) schools = applyEssays(schools, essays.records, opts.today, essays.confirmed).schools;
  const reported = await loadReportedLayer(store);
  schools = mergeReported(schools, reported.file, { records: reported.records, meta: base.meta, table: CDS_TEMPLATE }).schools;
  const { files, pages } = await loadDirectoriesLayer(store);
  const ids = new Set(schools.map((s) => s.unit_id));
  const tables = directoryDetails([...chapterFiles(files), ...pilotDirectoryFiles(pages)], ids);
  schools = applyLgbtqPolicies(applyCccuMembership(applyDirectories(schools, tables), files), pages);
  schools = opts.rebuildSelectivity
    ? buildSelectivity(schools, opts.rebuildSelectivity.meta, { previous: opts.previous }).schools
    : schools.map((s) => placeSelectivity(s, opts.previous.get(s.unit_id)));
  const details = mergeDetails(base.details, financialAidDetails(schools, reported.records), tables, campusPagesDetails(pages, ids));
  const aliases = dedupeAliases([...base.aliases, ...commonAppAliasRows(schools, commonApp?.members ?? null)]);
  return { schools, details, aliases };
}

/** Colleges, detail files and the alias table that don't come back byte for byte (empty when the import is faithful). */
export function reapplyProblems(got: Reapplied, root: string, units?: ReadonlySet<string>): string[] {
  const data = join(root, "data");
  const problems: string[] = [];
  const committed = (JSON.parse(readFileSync(join(data, "schools.json"), "utf8")) as School[]).filter((s) => !units || units.has(s.unit_id));
  const byId = new Map(got.schools.map((s) => [s.unit_id, s]));
  if (got.schools.length !== committed.length) problems.push(`${got.schools.length} colleges re-applied, ${committed.length} committed`);
  committed.forEach((s, i) => {
    const want = JSON.stringify(s);
    const have = byId.get(s.unit_id);
    if (!have) problems.push(`${s.unit_id}: missing`);
    else if (JSON.stringify(have) !== want) problems.push(`${s.unit_id} (${s.name}): differs at character ${firstDiff(want, JSON.stringify(have))}`);
    else if (got.schools[i]?.unit_id !== s.unit_id) problems.push(`${s.unit_id}: out of order`);
  });
  const dir = join(data, "detail", "schools");
  const wantDetails = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && (!units || units.has(f.slice(0, -5)))) : [];
  const gotDetails = new Map(got.details.map((d) => [d.unit_id, formatDetail(d)]));
  if (gotDetails.size !== wantDetails.length) problems.push(`${gotDetails.size} detail files re-applied, ${wantDetails.length} committed`);
  for (const f of wantDetails) if (gotDetails.get(f.slice(0, -5)) !== readFileSync(join(dir, f), "utf8")) problems.push(`detail ${f}: differs`);
  if (!units && formatAliasRows(got.aliases) !== readFileSync(join(data, "aliases.json"), "utf8")) problems.push("aliases.json: differs");
  return problems;
}

const firstDiff = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
};

/* ------------------------------------------------------------------ */
/* The CLI                                                             */
/* ------------------------------------------------------------------ */

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const onlyFlag = flagValue(argv, "--only");
  const only = onlyFlag ? new Set(onlyFlag.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;
  for (const c of only ?? []) if (!(ALL_COLLECTIONS as readonly string[]).includes(c)) throw new Error(`--only: ${c} isn't a collection (scripts/lib/data-platform/layers.mts)`);
  const storeFlag = flagValue(argv, "--store");
  const spec = parseStoreFlag(storeFlag);
  const root = join(import.meta.dirname, "..");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const started = Date.now();
  const layers = importLayers(root, { only });
  // A dry run reads the store (to say what would change) only when it is a folder that exists; it never opens a set.
  const store = storeFromFlag(storeFlag, process.env, { log: (l) => console.log(l) });
  const readable = spec.kind === "supabase" || existsSync(spec.root) ? store : null;
  const counts = await countImport(layers, readable);
  const where = spec.kind === "file" ? `file:${spec.root}` : "supabase (the data project)";
  console.log(`import-data-from-git: ${layers.size} collections from git at ${head.slice(0, 12)} → ${where}${dryRun ? " (--dry-run, nothing written)" : ""}`);
  let docs = 0;
  let bytes = 0;
  for (const [c, n] of counts) {
    docs += n.documents;
    bytes += n.bytes;
    const vs = n.added === null ? "" : `  (+${n.added} ~${n.changed} =${n.unchanged} -${n.removed})`;
    console.log(`  ${c.padEnd(28)} ${String(n.documents).padStart(6)} documents ${kb(n.bytes).padStart(9)}${vs}`);
  }
  console.log(`  ${"total".padEnd(28)} ${String(docs).padStart(6)} documents ${kb(bytes).padStart(9)}`);
  console.log(`  left out: ${Object.entries(NOT_IMPORTED).map(([f, why]) => `${f} (${why})`).join("; ")}`);
  if (!dryRun) {
    const id = await writeImport(store, layers, head, (l) => console.log(l));
    console.log(`import-data-from-git: change set ${id} applied in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  if (argv.includes("--check")) await check(root, layers, dryRun ? null : store, Boolean(only));
}

/**
 * `--check`: re-applies the later layers to the stored base (a scratch folder on a dry run) and compares every
 * college, detail file and the alias table with the committed files, rebuilding selectivity with hysteresis against
 * the committed tiers. Exits 1 on any difference.
 */
async function check(root: string, layers: ImportedLayers, store: DataStore | null, partial: boolean): Promise<void> {
  if (partial) throw new Error("--check needs every collection (drop --only)");
  let target = store;
  let scratch: string | null = null;
  if (!target) {
    scratch = mkdtempSync(join(tmpdir(), "dp-import-check-"));
    target = fileStore(scratch);
    await writeImport(target, layers, "check");
  }
  try {
    const committed = JSON.parse(readFileSync(join(root, "data", "schools.json"), "utf8")) as School[];
    const meta = JSON.parse(readFileSync(join(root, "data", "meta.json"), "utf8")) as DatasetMeta;
    const got = await reapplyLaterLayers(target, { previous: new Map(committed.map((s) => [s.unit_id, s.selectivity])), today: new Date().toISOString().slice(0, 10), rebuildSelectivity: { meta } });
    const problems = reapplyProblems(got, root);
    if (problems.length) {
      console.error(`--check: ${problems.length} differences:\n  ${problems.slice(0, 20).join("\n  ")}`);
      process.exitCode = 1;
    } else console.log(`--check: all ${committed.length} colleges, ${got.details.length} detail files and the alias table come back byte for byte`);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
