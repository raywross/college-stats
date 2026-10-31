import "server-only";
/**
 * The Data console's reads (specs/data-platform/change-sets.md "The console", Overview and Snapshots rows;
 * specs/data-platform/publish.md "Environments"): which snapshot each environment serves, the last publish, the
 * change sets since it, the held sets, and the full snapshot list. Server only, like lib/admin/ops.ts.
 *
 * `data_documents`/`data_change_sets`/`data_snapshots` select for everyone (specs/data-platform/storage.md
 * "Row-level security"), so these reads work with the admin's own session (adminSupabase()); the console header is
 * sent anyway, as the rest of the console does.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SNAPSHOT_OBJECTS, snapshotPath } from "@/lib/data-platform/snapshot";

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
