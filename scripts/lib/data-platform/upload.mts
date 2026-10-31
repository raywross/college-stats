/**
 * The publisher's upload (specs/data-platform/publish.md steps 5 and 7): a rendered snapshot (./render.mts) into the
 * `snapshots` bucket under `<id>/` (keys from `snapshotPath`, lib/data-platform/snapshot.ts), then its manifest, then
 * the pointer `current.json`, in that order, so a reader that sees the pointer always finds the whole snapshot.
 * Objects are immutable (`upsert: false`, cached a year): an object that is already there is accepted only when its
 * bytes are the ones being uploaded (a re-run after a crash), never overwritten. The pointer is the one object
 * rewritten (`upsert: true`, `no-cache`). Old snapshots' objects are pruned by their manifests (no listing).
 *
 * Two buckets with one shape: `supabaseBucket` (Storage through @supabase/supabase-js with the secret key) and
 * `fileBucket` (a folder, for `--store file:` runs and tests).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { POINTER_OBJECT, SNAPSHOT_BUCKET, SNAPSHOT_OBJECTS, snapshotPath, type SnapshotManifest, type SnapshotPointer } from "../../../lib/data-platform/snapshot.ts";
import { sha256, type RenderedSnapshot } from "./render.mts";

/** A Storage call's error, as supabase-js reports it. */
export interface BucketError {
  message: string;
  statusCode?: string | number;
  status?: number;
}

/** The part of `storage.from("snapshots")` the publisher uses (a fake in tests implements just this). */
export interface BucketClient {
  upload(path: string, body: Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: BucketError | null }>;
  download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: BucketError | null }>;
  remove(paths: string[]): Promise<{ error: BucketError | null }>;
}

/** Objects are immutable: a year in every cache. */
export const OBJECT_CACHE = "31536000";
/** The pointer is re-read at most once a minute per instance; never cached. */
export const POINTER_CACHE = "no-cache";
/** Uploads in flight at once. */
export const UPLOAD_CONCURRENCY = 8;
/** Waits before each retry of a failed call, in ms. */
export const UPLOAD_WAITS = [5_000, 20_000, 60_000] as const;
/** Snapshots whose objects are kept besides those ever pointed back to. */
export const KEEP_NEWEST = 30;

/** Whether a failed upload failed because the object exists (Storage answers 409 / "The resource already exists"). */
export function alreadyExists(error: BucketError): boolean {
  return String(error.statusCode ?? error.status ?? "") === "409" || /already exists|duplicate/i.test(error.message);
}

/** The bucket in the data project, with the secret key (DATA_SUPABASE_URL / DATA_SUPABASE_SECRET_KEY). */
export async function supabaseBucket(url: string, secretKey: string): Promise<BucketClient> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = client.storage.from(SNAPSHOT_BUCKET);
  return {
    upload: async (path, body, options) => ({ error: (await bucket.upload(path, body, options)).error as BucketError | null }),
    download: async (path) => {
      const { data, error } = await bucket.download(path);
      return { data, error: error as BucketError | null };
    },
    remove: async (paths) => ({ error: (await bucket.remove(paths)).error as BucketError | null }),
  };
}

/** A folder standing in for the bucket: `<dir>/<key>`, the same refusals (an existing object without upsert: 409). */
export function fileBucket(dir: string): BucketClient {
  const at = (path: string) => join(dir, path);
  return {
    async upload(path, body, options) {
      if (!options.upsert && existsSync(at(path))) return { error: { message: "The resource already exists", statusCode: "409" } };
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), body);
      return { error: null };
    },
    async download(path) {
      if (!existsSync(at(path))) return { data: null, error: { message: "Object not found", statusCode: "404" } };
      const bytes = readFileSync(at(path));
      return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }, error: null };
    },
    async remove(paths) {
      for (const p of paths) rmSync(at(p), { force: true });
      return { error: null };
    },
  };
}

export interface UploadOptions {
  concurrency?: number;
  waits?: readonly number[];
  log?: (line: string) => void;
}

async function withRetries<T extends { error: BucketError | null }>(what: string, call: () => Promise<T>, waits: readonly number[], log: (line: string) => void, done: (r: T) => boolean = (r) => !r.error): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let result: T;
    try {
      result = await call();
    } catch (err) {
      result = { error: { message: err instanceof Error ? err.message : String(err) } } as T;
    }
    if (done(result) || attempt >= waits.length) return result;
    log(`  ${what} failed (${result.error?.message}); retrying in ${Math.round(waits[attempt] / 1000)} s`);
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}

/**
 * Uploads one immutable object. Returns "uploaded", or "present" when the same bytes are already there; throws when
 * other bytes are (an object is never overwritten) or the upload keeps failing.
 */
async function putObject(bucket: BucketClient, path: string, bytes: Buffer, contentType: string, opts: Required<Pick<UploadOptions, "waits" | "log">>): Promise<"uploaded" | "present"> {
  const result = await withRetries(`uploading ${path}`, () => bucket.upload(path, bytes, { contentType, cacheControl: OBJECT_CACHE, upsert: false }), opts.waits, opts.log, (r) => !r.error || alreadyExists(r.error));
  if (!result.error) return "uploaded";
  if (!alreadyExists(result.error)) throw new Error(`upload: ${path} failed: ${result.error.message}`);
  const existing = await withRetries(`reading ${path}`, () => bucket.download(path), opts.waits, opts.log);
  if (existing.error || !existing.data) throw new Error(`upload: ${path} exists and could not be read back: ${existing.error?.message ?? "no body"}`);
  const have = Buffer.from(await existing.data.arrayBuffer());
  if (sha256(have) !== sha256(bytes)) throw new Error(`upload: ${path} already exists with other bytes; objects are never overwritten`);
  return "present";
}

/** Runs `work` over `items`, `concurrency` at a time; the first failure stops new work and is thrown. */
async function pool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const runner = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (err) {
        failed ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  if (failed !== null) throw failed;
}

/** Every object of the snapshot, then its manifest. The pointer is `movePointer`'s, after. */
export async function uploadSnapshot(bucket: BucketClient, rendered: RenderedSnapshot, opts: UploadOptions = {}): Promise<{ uploaded: number; present: number; bytes: number }> {
  const o = { waits: opts.waits ?? UPLOAD_WAITS, log: opts.log ?? (() => {}) };
  let uploaded = 0;
  let present = 0;
  let bytes = 0;
  let done = 0;
  const entries = [...rendered.objects];
  await pool(entries, opts.concurrency ?? UPLOAD_CONCURRENCY, async ([name, obj]) => {
    const r = await putObject(bucket, snapshotPath(rendered.id, name), obj.bytes, obj.contentType, o);
    if (r === "uploaded") {
      uploaded++;
      bytes += obj.bytes.length;
    } else present++;
    if (++done % 500 === 0) o.log(`  ${done} of ${entries.length} objects`);
  });
  const m = await putObject(bucket, snapshotPath(rendered.id, SNAPSHOT_OBJECTS.manifest), rendered.manifestBytes, "application/json", o);
  if (m === "uploaded") uploaded++;
  else present++;
  return { uploaded, present, bytes };
}

/** The pointer for a snapshot (its manifest's hash, so a reader can tell a stale CDN copy). */
export const pointerFor = (id: number, manifestSha256: string, at: string): SnapshotPointer => ({ id, at, manifest_sha256: manifestSha256 });

/** Rewrites `current.json`: the one object that is ever replaced. */
export async function movePointer(bucket: BucketClient, pointer: SnapshotPointer, opts: UploadOptions = {}): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(pointer)}\n`, "utf8");
  const r = await withRetries("moving the pointer", () => bucket.upload(POINTER_OBJECT, bytes, { contentType: "application/json", cacheControl: POINTER_CACHE, upsert: true }), opts.waits ?? UPLOAD_WAITS, opts.log ?? (() => {}));
  if (r.error) throw new Error(`moving the pointer to ${pointer.id} failed: ${r.error.message}`);
}

/** A row of `data_snapshots` as pruning reads it. */
export interface SnapshotRow {
  id: number;
  status: string;
  created_at: string;
  pointer_at: string | null;
  manifest: Partial<SnapshotManifest>;
}

/**
 * The snapshots whose objects stay: the newest `keep` published ones, and every one the pointer was pointed back to
 * (its `pointer_at` is later than a newer snapshot's creation). `current` is always kept.
 */
export function snapshotsToKeep(rows: readonly SnapshotRow[], current: number | null, keep = KEEP_NEWEST): Set<number> {
  const published = rows.filter((r) => r.status === "published").sort((a, b) => b.id - a.id);
  const out = new Set(published.slice(0, keep).map((r) => r.id));
  if (current !== null) out.add(current);
  for (const r of published) {
    if (!r.pointer_at) continue;
    if (published.some((n) => n.id > r.id && n.created_at < r.pointer_at!)) out.add(r.id);
  }
  return out;
}

/**
 * Deletes the objects (and manifest) of every snapshot not in `keep`, by its manifest. Rows stay. Only the newest
 * `window` rows are looked at (older ones were pruned by earlier publishes), so a publish's cost doesn't grow with the
 * history. Returns the objects removed.
 */
export async function prune(bucket: BucketClient, rows: readonly SnapshotRow[], keep: ReadonlySet<number>, opts: UploadOptions & { window?: number } = {}): Promise<number> {
  let removed = 0;
  const recent = [...rows].sort((a, b) => b.id - a.id).slice(0, opts.window ?? KEEP_NEWEST + 10);
  for (const r of recent) {
    if (keep.has(r.id) || r.status === "building") continue;
    const names = Object.keys(r.manifest?.objects ?? {});
    if (!names.length) continue;
    const paths = [...names, SNAPSHOT_OBJECTS.manifest].map((n) => snapshotPath(r.id, n));
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const res = await withRetries(`pruning snapshot ${r.id}`, () => bucket.remove(chunk), opts.waits ?? UPLOAD_WAITS, opts.log ?? (() => {}));
      if (res.error) throw new Error(`pruning snapshot ${r.id} failed: ${res.error.message}`);
      removed += chunk.length;
    }
    opts.log?.(`  pruned snapshot ${r.id} (${paths.length} objects)`);
  }
  return removed;
}
