import "server-only";
/**
 * The Data console's reads (specs/data-platform/change-sets.md "The console"; specs/data-platform/publish.md
 * "Environments"): which snapshot each environment serves, the last publish, the change sets since it, the held sets,
 * the full snapshot list, and the Change sets screens (the list, one set, the documents it touched, one document's
 * before and after). The held review items are read in lib/admin/review-queue.ts. Server only, like lib/admin/ops.ts.
 *
 * `data_documents`/`data_change_sets`/`data_snapshots` select for everyone (specs/data-platform/storage.md
 * "Row-level security"), so these reads work with the admin's own session (adminSupabase()); the console header is
 * sent anyway, as the rest of the console does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SNAPSHOT_OBJECTS, snapshotPath } from "@/lib/data-platform/snapshot";
import { githubRepo } from "@/lib/github-app";
import type { ChangeSetRow, TouchedVersion } from "@/lib/admin/change-set-view";

/* ------------------------------------------------------------------ */
/* Which snapshot each environment serves                              */
/* ------------------------------------------------------------------ */

export interface DataEnvironment {
  label: string;
  url: string;
}

export interface EnvironmentSnapshot extends DataEnvironment {
  /** The `x-quad-snapshot` meta tag's content, or "unknown" when the fetch failed or the tag wasn't found. */
  snapshot: string;
}

const DEFAULT_ENVIRONMENTS: readonly DataEnvironment[] = [{ label: "usequad.app", url: "https://usequad.app" }];

/** `DATA_ENVIRONMENTS`: a comma-separated `label=url` list; the default is production alone. Malformed entries are dropped. */
export function parseDataEnvironments(raw: string | undefined | null): DataEnvironment[] {
  const value = (raw ?? "").trim();
  if (!value) return [...DEFAULT_ENVIRONMENTS];
  const out: DataEnvironment[] = [];
  for (const part of value.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const label = part.slice(0, i).trim();
    const url = part.slice(i + 1).trim();
    if (label && /^https?:\/\//.test(url)) out.push({ label, url });
  }
  return out.length ? out : [...DEFAULT_ENVIRONMENTS];
}

/** The `<meta name="x-quad-snapshot" content="…">` tag's content (app/layout.tsx), attributes in either order. */
export function parseSnapshotMeta(html: string): string | null {
  const re = /<meta\s+[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/name=["']x-quad-snapshot["']/i.test(tag)) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag);
    return content ? content[1].trim() || null : null;
  }
  return null;
}

const ENVIRONMENT_FETCH_TIMEOUT_MS = 2_000;
/** An older deploy has no /api/snapshot; its home page's meta tag is read instead, with the old, longer timeout. */
const ENVIRONMENT_PAGE_TIMEOUT_MS = 4_000;

/** The id in `/api/snapshot`'s answer (null when it says null), or undefined when the answer isn't that JSON. */
function snapshotFromJson(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object" || !("snapshot" in body)) return undefined;
  const v = (body as { snapshot: unknown }).snapshot;
  if (v === null) return null;
  return typeof v === "string" || typeof v === "number" ? String(v).trim() || null : undefined;
}

/**
 * One environment's live snapshot (publish.md "The loader"; admin-speed.md wave 1, fix 8): `GET <url>/api/snapshot`,
 * a few bytes of JSON with a 2 s timeout. When the deploy has no such endpoint (older than it: a non-200, or not the
 * JSON it should be), once more the old way: the home page's `<meta name="x-quad-snapshot">` tag. Fails soft to
 * "unknown"; a timeout or network error on the endpoint is "unknown" at once (the home page wouldn't answer faster).
 */
export async function fetchEnvironmentSnapshot(env: DataEnvironment, fetchImpl: typeof fetch = fetch): Promise<EnvironmentSnapshot> {
  let res: Response;
  try {
    res = await fetchImpl(`${env.url.replace(/\/+$/, "")}/api/snapshot`, { signal: AbortSignal.timeout(ENVIRONMENT_FETCH_TIMEOUT_MS), redirect: "follow", cache: "no-store" });
  } catch {
    return { ...env, snapshot: "unknown" };
  }
  if (res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined; // not JSON: a deploy whose catch-all page answered the path
    }
    const found = snapshotFromJson(body);
    if (found !== undefined) return { ...env, snapshot: found ?? "unknown" };
  }
  try {
    const res = await fetchImpl(env.url, { signal: AbortSignal.timeout(ENVIRONMENT_PAGE_TIMEOUT_MS), redirect: "follow" });
    if (!res.ok) return { ...env, snapshot: "unknown" };
    const html = await res.text();
    return { ...env, snapshot: parseSnapshotMeta(html) ?? "unknown" };
  } catch {
    return { ...env, snapshot: "unknown" };
  }
}

/** Every configured environment's live snapshot, read in parallel. Never throws. */
export async function loadEnvironmentSnapshots(fetchImpl: typeof fetch = fetch): Promise<EnvironmentSnapshot[]> {
  const envs = parseDataEnvironments(process.env.DATA_ENVIRONMENTS);
  return Promise.all(envs.map((e) => fetchEnvironmentSnapshot(e, fetchImpl)));
}

/* ------------------------------------------------------------------ */
/* data_snapshots and data_change_sets                                 */
/* ------------------------------------------------------------------ */

/**
 * The parts of a snapshot's manifest the console reads. The reads select `colleges` and `layers` by JSON path
 * (SNAPSHOT_COLUMNS), never `objects`; `objects` is here only when the size fallback read it (snapshotQuery).
 */
export interface SnapshotManifestLike {
  colleges?: number;
  objects?: Record<string, { bytes: number; sha256: string }>;
  layers?: Record<string, number>;
}

export interface SnapshotRow {
  id: number;
  created_at: string;
  created_by: string | null;
  status: "building" | "published" | "failed" | "withdrawn";
  manifest: SnapshotManifestLike;
  change_set_ids: number[];
  previous_id: number | null;
  pointer_at: string | null;
  notes: string | null;
  /** The snapshot's total object size (`snapshot_bytes`), when the read asked for it; see snapshotBytes. */
  bytes?: number | null;
}

export interface ChangeSetCount {
  source: string;
  status: string;
  count: number;
}

export interface HeldChangeSet {
  id: number;
  kind: string;
  source: string;
  held_reason: string | null;
  created_at: string;
  /** What the run wrote about itself (an apply's `proposal` and `refused`); the Inbox reads it for a collision's link. */
  summary?: Record<string, unknown> | null;
}

async function rows<T>(what: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return data ?? [];
}

/* The snapshot row, read small (specs/product/admin-speed.md wave 1, fix 2) */

/**
 * The columns every snapshot read selects: the row's own, and the manifest's `colleges` and `layers` by PostgREST's
 * JSON path (aliased, so they come back as top-level keys; snapshotRow() puts them back under `manifest`). Never
 * `objects`: one entry per object in the snapshot, 446 KB a row since the lineage shards (2026-11-08), which every
 * console page used to read for the badge. tests/admin-data.test.mts checks this list.
 */
export const SNAPSHOT_COLUMNS = "id, created_at, created_by, status, change_set_ids, previous_id, pointer_at, notes, colleges:manifest->colleges, layers:manifest->layers";
/** The size, computed in Postgres (supabase/migrations/20261110130000_snapshot_bytes.sql) as a PostgREST computed field. */
export const SNAPSHOT_BYTES_COLUMN = "bytes:snapshot_bytes";
/** The size fallback before that migration is applied: the objects map itself, for the rows that show a size. */
export const SNAPSHOT_OBJECTS_COLUMN = "objects:manifest->objects";

interface SnapshotDbRow extends Omit<SnapshotRow, "manifest" | "bytes"> {
  colleges?: number | null;
  layers?: Record<string, number> | null;
  objects?: Record<string, { bytes: number; sha256: string }> | null;
  bytes?: number | string | null;
  /** Only from a `select *` (a test's fake client); the console's reads never select it. */
  manifest?: SnapshotManifestLike | null;
}

/** A row as selected (aliased JSON paths) back in the SnapshotRow shape callers use. */
export function snapshotRow(r: SnapshotDbRow): SnapshotRow {
  const { colleges, layers, objects, bytes, manifest, ...rest } = r;
  const m: SnapshotManifestLike = { ...(manifest ?? {}) };
  if (colleges != null) m.colleges = colleges;
  if (layers != null) m.layers = layers;
  if (objects != null) m.objects = objects;
  const out: SnapshotRow = { ...rest, manifest: m };
  if (bytes != null && Number.isFinite(Number(bytes))) out.bytes = Number(bytes);
  return out;
}

/** A snapshot's total size: `snapshot_bytes` when read, else summed from the manifest's objects (the fallback). */
export function snapshotBytes(row: Pick<SnapshotRow, "manifest" | "bytes">): number {
  return row.bytes ?? manifestBytes(row.manifest);
}

/** Set once a read finds snapshot_bytes missing (its migration not applied): later reads go straight to the fallback. */
let bytesMissing = false;

/** Whether an error says the computed field is missing (PostgREST doesn't know the function or the column). */
function isMissingBytes(error: { message: string; code?: string }): boolean {
  return ["42703", "42883", "PGRST100", "PGRST200", "PGRST202"].includes(error.code ?? "") || /snapshot_bytes/.test(error.message);
}

type SnapshotQuery = (columns: string) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * A snapshot query with the small columns, plus the size when `withBytes`: through `snapshot_bytes`, or, when
 * that function is missing, by reading the `objects` maps (the old cost, on the two screens that show a size, until
 * the migration is applied). One `console.warn` per instance names the fallback.
 */
async function snapshotQuery(what: string, query: SnapshotQuery, withBytes: boolean): Promise<SnapshotDbRow[]> {
  const asRows = (data: unknown): SnapshotDbRow[] => (Array.isArray(data) ? data : data ? [data] : []) as SnapshotDbRow[];
  if (withBytes && !bytesMissing) {
    const { data, error } = await query(`${SNAPSHOT_COLUMNS}, ${SNAPSHOT_BYTES_COLUMN}`);
    if (!error) return asRows(data);
    if (!isMissingBytes(error)) throw new Error(`admin: reading ${what} failed: ${error.message}`);
    bytesMissing = true;
    console.warn(`admin: snapshot_bytes is missing (${error.message}); reading the manifests' objects for the size until supabase/migrations/20261110130000_snapshot_bytes.sql is applied`);
  }
  const { data, error } = await query(withBytes ? `${SNAPSHOT_COLUMNS}, ${SNAPSHOT_OBJECTS_COLUMN}` : SNAPSHOT_COLUMNS);
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return asRows(data);
}

/** For tests: forget that snapshot_bytes was found missing. */
export function resetSnapshotBytesProbe(): void {
  bytesMissing = false;
}

/**
 * The newest published snapshot, or null before the first publish. Small columns only (the badge and the Inbox read
 * it on every console page); `{ bytes: true }` adds the size, for the Data overview.
 */
export async function lastPublishedSnapshot(supabase: SupabaseClient, opts: { bytes?: boolean } = {}): Promise<SnapshotRow | null> {
  const found = await snapshotQuery(
    "data_snapshots",
    (columns) => supabase.from("data_snapshots").select(columns).eq("status", "published").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    opts.bytes === true,
  );
  return found[0] ? snapshotRow(found[0]) : null;
}

/** Applied change sets no publish has carried yet: how many, and when the oldest was written (null when none). */
export interface PublishWaiting {
  count: number;
  oldestAt: string | null;
}

export interface ChangeSetsSince {
  counts: ChangeSetCount[];
  waiting: PublishWaiting;
}

/** By source and status, most first; and the applied ones waiting for a publish (pure, over the rows read). */
export function summarizeChangeSets(found: readonly { source: string; status: string; created_at?: string | null }[]): ChangeSetsSince {
  const counts = new Map<string, number>();
  let waiting = 0;
  let oldestAt: string | null = null;
  for (const r of found) {
    const key = `${r.source}\u0000${r.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (r.status !== "applied") continue;
    waiting += 1;
    if (r.created_at && (oldestAt === null || Date.parse(r.created_at) < Date.parse(oldestAt))) oldestAt = r.created_at;
  }
  return {
    counts: [...counts.entries()]
      .map(([key, count]) => {
        const [source, status] = key.split("\u0000");
        return { source, status, count };
      })
      .sort((a, b) => b.count - a.count),
    waiting: { count: waiting, oldestAt },
  };
}

/**
 * Change sets created after `after` (the last publish's time): by source and status, and the applied ones a publish
 * would carry (the Inbox's "waiting for a publish" row). All of them when `after` is null. One read for both.
 */
export async function changeSetsSince(supabase: SupabaseClient, after: string | null): Promise<ChangeSetsSince> {
  let query = supabase.from("data_change_sets").select("source, status, created_at");
  if (after) query = query.gt("created_at", after);
  return summarizeChangeSets(await rows<{ source: string; status: string; created_at: string }>("data_change_sets", query));
}

/** Change sets created after `after` (the last publish's time), by source and status, most first. All of them when `after` is null. */
export async function changeSetCounts(supabase: SupabaseClient, after: string | null): Promise<ChangeSetCount[]> {
  return (await changeSetsSince(supabase, after)).counts;
}

/** The last publish and the applied changes waiting since it (the Inbox's publish row and its Live version tile). */
export async function lastPublishAndWaiting(supabase: SupabaseClient): Promise<{ lastPublished: SnapshotRow | null; waiting: PublishWaiting }> {
  const lastPublished = await lastPublishedSnapshot(supabase);
  const { waiting } = await changeSetsSince(supabase, lastPublished?.created_at ?? null);
  return { lastPublished, waiting };
}

/** Held change sets, newest first: the run as a whole looked wrong and nothing from it publishes until an admin acts. */
export async function heldChangeSets(supabase: SupabaseClient): Promise<HeldChangeSet[]> {
  return rows<HeldChangeSet>("data_change_sets", supabase.from("data_change_sets").select("id, kind, source, held_reason, created_at, summary").eq("status", "held").order("created_at", { ascending: false }));
}

export interface DataOverview {
  environments: EnvironmentSnapshot[];
  lastPublished: SnapshotRow | null;
  changeSets: ChangeSetCount[];
  /** The applied change sets since the last publish, which Publish now would carry. */
  waiting: PublishWaiting;
  holds: HeldChangeSet[];
}

/** Everything the Overview screen shows, read in parallel. */
export async function loadDataOverview(supabase: SupabaseClient, fetchImpl?: typeof fetch): Promise<DataOverview> {
  const [environments, lastPublished] = await Promise.all([loadEnvironmentSnapshots(fetchImpl), lastPublishedSnapshot(supabase, { bytes: true })]);
  const [since, holds] = await Promise.all([changeSetsSince(supabase, lastPublished?.created_at ?? null), heldChangeSets(supabase)]);
  return { environments, lastPublished, changeSets: since.counts, waiting: since.waiting, holds };
}

/** The newest 50 snapshots, newest first: the small columns and each one's size. */
export async function loadSnapshots(supabase: SupabaseClient): Promise<SnapshotRow[]> {
  const found = await snapshotQuery("data_snapshots", (columns) => supabase.from("data_snapshots").select(columns).order("created_at", { ascending: false }).limit(50), true);
  return found.map(snapshotRow);
}

/**
 * The snapshot the pointer currently names: the row with the newest `pointer_at` (set on the original publish and
 * moved by a point-back), so a point-back is reflected without rebuilding. Null when nothing has published yet.
 */
export function currentSnapshotId(snapshots: readonly SnapshotRow[]): number | null {
  const pointed = snapshots.filter((s) => s.pointer_at);
  if (!pointed.length) return null;
  return pointed.reduce((latest, row) => (new Date(row.pointer_at!).getTime() > new Date(latest.pointer_at!).getTime() ? row : latest)).id;
}

/** A manifest's total object size, summed from its per-object entry (snapshotBytes' fallback). */
export function manifestBytes(manifest: SnapshotManifestLike | null | undefined): number {
  return Object.values(manifest?.objects ?? {}).reduce((sum, o) => sum + (o?.bytes ?? 0), 0);
}

/** "6.1 MB", "412 KB", "890 B" — whole numbers past the first significant digit. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1_000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 100) / 10} KB`;
  if (n < 1_000_000_000) return `${Math.round(n / 100_000) / 10} MB`;
  return `${Math.round(n / 100_000_000) / 10} GB`;
}

/** The manifest's public URL for a snapshot, or null when `DATA_SNAPSHOT_URL` isn't set. */
export function manifestDownloadUrl(id: number): string | null {
  const base = process.env.DATA_SNAPSHOT_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${snapshotPath(id, SNAPSHOT_OBJECTS.manifest)}`;
}

/* ------------------------------------------------------------------ */
/* Change sets: the list, one set, the documents it touched, one diff  */
/* ------------------------------------------------------------------ */

const CHANGE_SET_COLUMNS = "id, kind, source, run_ref, status, held_reason, summary, created_by, created_at, closed_at, snapshot_id, reverted_by";

/** How many change sets the list shows (newest first). */
export const CHANGE_SET_PAGE = 50;
export const CHANGE_SET_STATUSES = ["open", "applied", "held", "reverted"] as const;

/** `?status=` on the list, validated: one of the four statuses, or null for all of them. */
export function parseStatusFilter(raw: string | string[] | undefined): (typeof CHANGE_SET_STATUSES)[number] | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (CHANGE_SET_STATUSES as readonly string[]).includes(v ?? "") ? (v as (typeof CHANGE_SET_STATUSES)[number]) : null;
}

/** The newest change sets, newest first, optionally of one status. */
export async function loadChangeSets(supabase: SupabaseClient, opts: { status?: string | null } = {}): Promise<ChangeSetRow[]> {
  let query = supabase.from("data_change_sets").select(CHANGE_SET_COLUMNS);
  if (opts.status) query = query.eq("status", opts.status);
  return rows<ChangeSetRow>("data_change_sets", query.order("id", { ascending: false }).limit(CHANGE_SET_PAGE));
}

/** One change set, or null when the id names none. */
export async function loadChangeSet(supabase: SupabaseClient, id: number): Promise<ChangeSetRow | null> {
  const { data, error } = await supabase.from("data_change_sets").select(CHANGE_SET_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`admin: reading data_change_sets failed: ${error.message}`);
  return (data as ChangeSetRow | null) ?? null;
}

/** How many version rows the detail page lists (an import touches every document; its summary has the totals). */
export const TOUCHED_LIMIT = 1000;

/** The versions a change set wrote (collection, key, version, deleted), at most `TOUCHED_LIMIT`, and whether there were more. */
export async function touchedDocuments(supabase: SupabaseClient, id: number): Promise<{ rows: TouchedVersion[]; truncated: boolean }> {
  const found = await rows<TouchedVersion>(
    "data_document_versions",
    supabase.from("data_document_versions").select("collection, key, version, deleted").eq("change_set_id", id).order("id", { ascending: true }).limit(TOUCHED_LIMIT + 1),
  );
  return { rows: found.slice(0, TOUCHED_LIMIT), truncated: found.length > TOUCHED_LIMIT };
}

/** A document's chosen version on the detail page: `?c=<collection>&k=<key>`, validated as the tables check them. */
export function parseDocumentParam(c: string | string[] | undefined, k: string | string[] | undefined): { collection: string; key: string } | null {
  const collection = Array.isArray(c) ? c[0] : c;
  const key = Array.isArray(k) ? k[0] : k;
  if (!collection || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(collection) || collection.length > 80) return null;
  if (!key || key.length > 200) return null;
  return { collection, key };
}

export interface DocumentVersion {
  version: number;
  body: unknown;
  deleted: boolean;
  change_set_id: number;
  created_at: string;
}

/**
 * One document as a change set left it and as it was just before: `after` is the set's last version of it, `before`
 * the version just before the set's first (versions count up by one per write, so that is `first − 1`), null when the
 * set created it. Null when the set didn't touch the document.
 */
export async function documentBeforeAfter(supabase: SupabaseClient, id: number, collection: string, key: string): Promise<{ before: DocumentVersion | null; after: DocumentVersion } | null> {
  const COLUMNS = "version, body, deleted, change_set_id, created_at";
  const mine = await rows<DocumentVersion>(
    "data_document_versions",
    supabase.from("data_document_versions").select(COLUMNS).eq("collection", collection).eq("key", key).eq("change_set_id", id),
  );
  if (!mine.length) return null;
  const sorted = [...mine].sort((a, b) => a.version - b.version);
  const first = sorted[0].version;
  const after = sorted[sorted.length - 1];
  if (first <= 1) return { before: null, after };
  const { data, error } = await supabase.from("data_document_versions").select(COLUMNS).eq("collection", collection).eq("key", key).eq("version", first - 1).maybeSingle();
  if (error) throw new Error(`admin: reading data_document_versions failed: ${error.message}`);
  return { before: (data as DocumentVersion | null) ?? null, after };
}

/** The GitHub repository a pipeline run links to (`GITHUB_REPO`, else the default). */
export function runRepo(): string {
  return githubRepo();
}
