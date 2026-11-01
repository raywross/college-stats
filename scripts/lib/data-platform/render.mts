/**
 * The publisher's render (specs/data-platform/publish.md "Objects in a snapshot", step 4): a composed snapshot
 * (./compose.mts) as the objects the bucket holds, each in today's file format (so `colleges.json` is
 * data/schools.json byte for byte, a history or detail shard its file), gzipped where the name ends in `.gz`, with a
 * sha256 per object in the manifest. Object names come from the shared contract (lib/data-platform/snapshot.ts).
 * Pure and deterministic: the same composed snapshot, id and options give the same bytes.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { HistoryFiles } from "../../../lib/supabase.ts";
import type { HighSchoolShard, HighSchoolStateFile } from "../../../lib/high-school-types.ts";
import { formatDetail } from "../../../lib/detail.ts";
import {
  REFERENCE_OBJECTS,
  SNAPSHOT_OBJECTS,
  detailObject,
  highSchoolObject,
  historyObject,
  referenceObject,
  trendObject,
  type HistorySharedObject,
  type SnapshotEditsObject,
  type SnapshotManifest,
} from "../../../lib/data-platform/snapshot.ts";
import { formatSchools } from "../identity-sync.mts";
import { formatAliasRows } from "../aliases-sync.mts";
import { formatHistoryShard } from "../../history/build.mts";
import { trendFileText } from "../../trends/build.mts";
import { formatShard as formatHighSchoolShard, formatStateFile } from "../high-schools/write.mts";
import type { ComposedSnapshot } from "./compose.mts";
import { COLLECTIONS } from "./layers.mts";

/** One object as uploaded. */
export interface RenderedObject {
  bytes: Buffer;
  contentType: string;
}

export interface RenderedSnapshot {
  id: number;
  /** Every object but the manifest, by name relative to the snapshot's folder, in name order. */
  objects: Map<string, RenderedObject>;
  manifest: SnapshotManifest;
  /** The manifest's bytes (uploaded after every object) and their sha256 (the pointer's `manifest_sha256`). */
  manifestBytes: Buffer;
  manifestSha256: string;
}

/** Two-space JSON and a closing newline: meta.json, the calendar, the reference files, the high schools' meta. */
export const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const CONTENT_TYPES: Record<string, string> = { ".json": "application/json", ".gz": "application/gzip", ".md": "text/markdown; charset=utf-8", ".csv": "text/csv; charset=utf-8" };
const contentType = (name: string) => CONTENT_TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";

/**
 * The reference objects the loader asks for (REFERENCE_OBJECTS), by the `reference.files` document each comes from.
 * JSON documents render as two-space JSON; text documents (`{text}`) as their text.
 */
export const REFERENCE_SOURCES: Readonly<Record<string, string>> = {
  [REFERENCE_OBJECTS.platformPrompts]: "platform-prompts",
  [REFERENCE_OBJECTS.organizations]: "organizations",
  [REFERENCE_OBJECTS.commonAppTrends]: "common-app-trends",
  [REFERENCE_OBJECTS.essayGuidance]: "essay-guidance/guidance",
  [REFERENCE_OBJECTS.zctaCentroids]: "zcta-centroids",
};

const isText = (doc: unknown): doc is { text: string } => !!doc && typeof doc === "object" && typeof (doc as { text?: unknown }).text === "string" && Object.keys(doc as object).length === 1;

/** The high-school fallback (lib/high-school-store.ts's layout under data/high-schools/), as `high-schools/<path>`. */
function highSchoolObjects(composed: Pick<ComposedSnapshot, "highSchools">): [string, string][] {
  const out: [string, string][] = [];
  const get = (c: string) => composed.highSchools.get(c) ?? new Map<string, unknown>();
  for (const [key, shard] of get(COLLECTIONS.highSchools.schools)) out.push([highSchoolObject(`schools/${key}.json`), formatHighSchoolShard(shard as HighSchoolShard)]);
  for (const [key, file] of get(COLLECTIONS.highSchools.state)) out.push([highSchoolObject(`state/${key}.json`), formatStateFile(file as HighSchoolStateFile)]);
  for (const [key, detail] of get(COLLECTIONS.highSchools.detail)) out.push([highSchoolObject(`detail/${key}.json`), prettyJson(detail)]);
  for (const name of ["meta", "medians"]) {
    const doc = get(COLLECTIONS.highSchools.shared).get(name);
    if (doc !== undefined) out.push([highSchoolObject(`${name}.json`), prettyJson(doc)]);
  }
  return out;
}

export interface RenderOptions {
  /** The manifest's `created_at` (ISO). The CLI passes the publish time; the default keeps a test's render pure. */
  createdAt?: string;
}

/** Every object of the snapshot, its manifest, and the manifest's hash. */
export function renderSnapshot(composed: ComposedSnapshot, id: number, previousId: number | null, changeSetIds: readonly number[], opts: RenderOptions = {}): RenderedSnapshot {
  const texts: [string, string | Buffer][] = [];
  texts.push([SNAPSHOT_OBJECTS.colleges, formatSchools(composed.schools)]);
  texts.push([SNAPSHOT_OBJECTS.meta, prettyJson(composed.meta)]);
  texts.push([SNAPSHOT_OBJECTS.releaseCalendar, prettyJson(composed.releaseCalendar)]);
  texts.push([SNAPSHOT_OBJECTS.aliases, formatAliasRows(composed.aliases)]);
  const { shared } = composed.history;
  if (shared.meta && shared.national && shared.facts && shared.cpi) {
    const object: HistorySharedObject & HistoryFiles = { meta: shared.meta, national: shared.national, facts: shared.facts, cpi: shared.cpi };
    texts.push([SNAPSHOT_OBJECTS.historyShared, JSON.stringify(object)]);
  }
  for (const [unit, h] of composed.history.schools) texts.push([historyObject(unit), formatHistoryShard(h)]);
  for (const d of composed.detail) texts.push([detailObject(d.unit_id), formatDetail(d)]);
  for (const t of composed.trends) texts.push([trendObject(t.name), trendFileText(t.file)]);
  for (const [object, source] of Object.entries(REFERENCE_SOURCES)) {
    const doc = composed.reference.get(source);
    if (doc === undefined) continue;
    texts.push([referenceObject(object), isText(doc) ? doc.text : prettyJson(doc)]);
  }
  // Every other `reference.files` document, so the app's reference tables come from the snapshot and not from git
  // (specs/data-platform/git-ci-tests.md, phase 4): `reference/<name>.json`, or `reference/<name>.txt` for a text
  // document that has no named object above. Sorted by name for deterministic bytes.
  const named = new Set(Object.values(REFERENCE_SOURCES));
  for (const [name, doc] of [...composed.reference].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (named.has(name)) continue;
    texts.push([referenceObject(isText(doc) ? `${name}.txt` : `${name}.json`), isText(doc) ? doc.text : prettyJson(doc)]);
  }
  if (composed.sourceFiles != null) texts.push([SNAPSHOT_OBJECTS.sourceFiles, prettyJson(composed.sourceFiles)]);
  texts.push([SNAPSHOT_OBJECTS.searchIndex, JSON.stringify(composed.searchIndex)]);
  const editsObject: SnapshotEditsObject = { snapshot: id, edits: composed.editsObject };
  texts.push([SNAPSHOT_OBJECTS.edits, prettyJson(editsObject)]);
  texts.push(...highSchoolObjects(composed));

  const objects = new Map<string, RenderedObject>();
  for (const [name, text] of texts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (objects.has(name)) throw new Error(`render: two objects named ${name}`);
    const plain = typeof text === "string" ? Buffer.from(text, "utf8") : text;
    objects.set(name, { bytes: name.endsWith(".gz") ? gzipSync(plain) : plain, contentType: contentType(name) });
  }
  const manifest: SnapshotManifest = {
    id,
    created_at: opts.createdAt ?? new Date(0).toISOString(),
    previous_id: previousId,
    colleges: composed.schools.length,
    objects: Object.fromEntries([...objects].map(([name, o]) => [name, { bytes: o.bytes.length, sha256: sha256(o.bytes) }])),
    layers: composed.versions,
    change_set_ids: [...changeSetIds],
  };
  const manifestBytes = Buffer.from(prettyJson(manifest), "utf8");
  return { id, objects, manifest, manifestBytes, manifestSha256: sha256(manifestBytes) };
}

/** Total bytes of a rendered snapshot (objects and manifest). */
export const renderedBytes = (r: RenderedSnapshot): number => [...r.objects.values()].reduce((n, o) => n + o.bytes.length, r.manifestBytes.length);
