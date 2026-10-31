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

const ENVIRONMENT_FETCH_TIMEOUT_MS = 4_000;

/** One environment's live snapshot, fetched with a short timeout; failing soft to "unknown" (publish.md "The loader"). */
export async function fetchEnvironmentSnapshot(env: DataEnvironment, fetchImpl: typeof fetch = fetch): Promise<EnvironmentSnapshot> {
  try {
    const res = await fetchImpl(env.url, { signal: AbortSignal.timeout(ENVIRONMENT_FETCH_TIMEOUT_MS), redirect: "follow" });
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
}

async function rows<T>(what: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`admin: reading ${what} failed: ${error.message}`);
  return data ?? [];
}

/** The newest published snapshot, or null before the first publish. */
export async function lastPublishedSnapshot(supabase: SupabaseClient): Promise<SnapshotRow | null> {
  const { data, error } = await supabase.from("data_snapshots").select("*").eq("status", "published").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`admin: reading data_snapshots failed: ${error.message}`);
  return (data as SnapshotRow | null) ?? null;
}

/** Change sets created after `after` (the last publish's time), by source and status, most first. All of them when `after` is null. */
export async function changeSetCounts(supabase: SupabaseClient, after: string | null): Promise<ChangeSetCount[]> {
  let query = supabase.from("data_change_sets").select("source, status");
  if (after) query = query.gt("created_at", after);
  const found = await rows<{ source: string; status: string }>("data_change_sets", query);
  const counts = new Map<string, number>();
  for (const r of found) {
    const key = `${r.source}\u0000${r.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [source, status] = key.split("\u0000");
      return { source, status, count };
    })
    .sort((a, b) => b.count - a.count);
}

/** Held change sets, newest first: the run as a whole looked wrong and nothing from it publishes until an admin acts. */
export async function heldChangeSets(supabase: SupabaseClient): Promise<HeldChangeSet[]> {
  return rows<HeldChangeSet>("data_change_sets", supabase.from("data_change_sets").select("id, kind, source, held_reason, created_at").eq("status", "held").order("created_at", { ascending: false }));
}

export interface DataOverview {
  environments: EnvironmentSnapshot[];
  lastPublished: SnapshotRow | null;
  changeSets: ChangeSetCount[];
  holds: HeldChangeSet[];
}

/** Everything the Overview screen shows, read in parallel. */
export async function loadDataOverview(supabase: SupabaseClient, fetchImpl?: typeof fetch): Promise<DataOverview> {
  const [environments, lastPublished] = await Promise.all([loadEnvironmentSnapshots(fetchImpl), lastPublishedSnapshot(supabase)]);
  const [changeSets, holds] = await Promise.all([changeSetCounts(supabase, lastPublished?.created_at ?? null), heldChangeSets(supabase)]);
  return { environments, lastPublished, changeSets, holds };
}

/** The newest 50 snapshots, newest first. */
export async function loadSnapshots(supabase: SupabaseClient): Promise<SnapshotRow[]> {
  return rows<SnapshotRow>("data_snapshots", supabase.from("data_snapshots").select("*").order("created_at", { ascending: false }).limit(50));
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

/** A manifest's total object size, summed from its per-object entry. */
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
