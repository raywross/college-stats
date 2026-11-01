import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createDatasetLoader } from "../dataset-loader.ts";
import type { DatasetFiles } from "../dataset.ts";
import type { HistoryFiles } from "../supabase.ts";
import {
  POINTER_OBJECT,
  REFERENCE_OBJECTS,
  SNAPSHOT_OBJECTS,
  detailObject,
  historyObject,
  referenceObject,
  snapshotPath,
  trendObject,
  type SnapshotManifest,
  type SnapshotPointer,
} from "./snapshot.ts";

/**
 * The runtime side of the data platform (specs/data-platform/publish.md "The loader"): where the dataset's bytes come
 * from, the pointer check, the swap, and the per-request shards. lib/data.ts is the only caller; it keeps every
 * exported function and contract it had.
 *
 * Sources, in order:
 * - `storage`: DATA_SNAPSHOT_URL is set (the bucket's public base). The first load reads the bundled copy when one
 *   exists (else downloads the current snapshot), then `maybeRefresh()` re-reads the pointer at most once a minute
 *   and swaps when it moves. Shards are fetched for the snapshot the request's dataset came from.
 * - `bundled`: no URL, but `.data/snapshot/manifest.json` exists (what `npm run fetch-snapshot` wrote at build time,
 *   or `--ensure` at install: the current snapshot when configured, else the mini fixture, id 0).
 * - Neither: there is no dataset, and `snapshotSource()` throws NO_SNAPSHOT_MESSAGE.
 *
 * The big objects (pointer, manifest, colleges) are read with node:http(s), not `fetch`: Next.js patches `fetch`, and
 * an uncacheable fetch made while a static page renders would turn that page dynamic. Shards use `fetch` with
 * `cache: "force-cache"` on purpose: the snapshot id is in the URL, so each snapshot is its own cache key.
 */

export type SnapshotSource = { kind: "storage"; base: string } | { kind: "bundled" };

/** A published snapshot's id (0 for the mini fixture). */
export type SnapshotId = number;

/** What getData() throws when there is neither a bundled copy nor DATA_SNAPSHOT_URL. */
export const NO_SNAPSHOT_MESSAGE = "No data snapshot: run `npm run fetch-snapshot -- --ensure`";

/** What one load or swap produces, before lib/data.ts builds a Dataset from it. */
export interface SnapshotContent {
  id: SnapshotId;
  files: DatasetFiles;
  /** history/shared.json(.gz): null when the snapshot carries no history. */
  history: HistoryFiles | null;
}

/** A plain GET: status and body. Injected in tests; the default is node:http(s). */
export type HttpGet = (url: string) => Promise<{ status: number; body: Buffer }>;

/** How often a warm instance re-reads the pointer. */
export const REFRESH_INTERVAL_MS = 60_000;

const trimBase = (url: string) => url.trim().replace(/\/+$/, "");

/**
 * Where the dataset comes from, from the environment and whether a bundled copy exists under `root`. Throws
 * NO_SNAPSHOT_MESSAGE when there is neither.
 */
export function snapshotSource(env: Record<string, string | undefined> = process.env, root = process.cwd()): SnapshotSource {
  const base = env.DATA_SNAPSHOT_URL?.trim();
  if (base) return { kind: "storage", base: trimBase(base) };
  if (hasBundled(root)) return { kind: "bundled" };
  throw new Error(NO_SNAPSHOT_MESSAGE);
}

/** Whether `.data/snapshot/manifest.json` exists: fetch-snapshot writes it last, so its presence means a whole copy. */
export function hasBundled(root = process.cwd()): boolean {
  return existsSync(join(root, ".data", "snapshot", "manifest.json"));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptionalJsonFile<T>(path: string): T | null {
  return existsSync(path) ? readJsonFile<T>(path) : null;
}

/** The bundled copy (`.data/snapshot/`, ungzipped on disk): its id, the dataset files, and history's shared object. */
export function readBundled(root = process.cwd()): SnapshotContent {
  const manifest = readJsonFile<SnapshotManifest>(join(root, ".data", "snapshot", "manifest.json"));
  return {
    id: manifest.id,
    files: {
      schools: readJsonFile(join(root, ".data", "snapshot", "colleges.json")),
      meta: readJsonFile(join(root, ".data", "snapshot", "meta.json")),
      releaseCalendar: readJsonFile(join(root, ".data", "snapshot", "release-calendar.json")),
      aliases: readOptionalJsonFile<DatasetFiles["aliases"]>(join(root, ".data", "snapshot", "aliases.json")) ?? [],
    },
    history: readOptionalJsonFile<HistoryFiles>(join(root, ".data", "snapshot", "history", "shared.json")),
  };
}

/** The default HttpGet: one request, redirects not followed (Storage's public URLs don't redirect). */
export const httpGet: HttpGet = (url) =>
  new Promise((resolve, reject) => {
    const request = url.startsWith("https:") ? httpsRequest : httpRequest;
    const req = request(url, { method: "GET", headers: { "cache-control": "no-cache" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(30_000, () => req.destroy(new Error(`timed out: ${url}`)));
    req.on("error", reject);
    req.end();
  });

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function getOk(get: HttpGet, url: string): Promise<Buffer> {
  const { status, body } = await get(url);
  if (status < 200 || status >= 300) throw new Error(`GET ${url}: ${status}`);
  return body;
}

/** `current.json` in the bucket, with a query string so a CDN copy of the pointer is never served. */
export async function fetchPointer(base: string, get: HttpGet = httpGet, now = Date.now()): Promise<SnapshotPointer> {
  const body = await getOk(get, `${trimBase(base)}/${POINTER_OBJECT}?t=${now}`);
  const pointer = JSON.parse(body.toString("utf8")) as SnapshotPointer;
  if (!Number.isInteger(pointer?.id) || pointer.id < 0) throw new Error(`the pointer has no snapshot id: ${body.toString("utf8").slice(0, 200)}`);
  return pointer;
}

/**
 * The objects a dataset load needs from snapshot `id`: the manifest (checked against the pointer's hash when given),
 * then colleges, meta, release calendar, aliases and history's shared object, each checked against the manifest's
 * sha256 and gunzipped where the name ends in `.gz`. Aliases and history may be absent from a snapshot (none and
 * null, as today when their files are missing); anything else missing or mismatched throws, so a swap never starts
 * from a partial or stale copy.
 */
export async function fetchSnapshotFiles(base: string, id: number, get: HttpGet = httpGet, manifestSha256?: string): Promise<SnapshotContent> {
  const url = (object: string) => `${trimBase(base)}/${snapshotPath(id, object)}`;
  const manifestBytes = await getOk(get, url(SNAPSHOT_OBJECTS.manifest));
  if (manifestSha256 && sha256(manifestBytes) !== manifestSha256) throw new Error(`snapshot ${id}: the manifest doesn't match the pointer's hash`);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as SnapshotManifest;
  if (manifest.id !== id) throw new Error(`snapshot ${id}: the manifest says id ${manifest.id}`);

  const object = async (name: string, optional: boolean): Promise<unknown> => {
    const listed = manifest.objects?.[name];
    if (!listed) {
      if (optional) return null;
      throw new Error(`snapshot ${id}: ${name} is not in the manifest`);
    }
    const bytes = await getOk(get, url(name));
    if (sha256(bytes) !== listed.sha256) throw new Error(`snapshot ${id}: ${name} doesn't match its hash`);
    const plain = name.endsWith(".gz") ? gunzipSync(bytes) : bytes;
    return JSON.parse(plain.toString("utf8"));
  };

  const [schools, meta, releaseCalendar, aliases, history] = await Promise.all([
    object(SNAPSHOT_OBJECTS.colleges, false),
    object(SNAPSHOT_OBJECTS.meta, false),
    object(SNAPSHOT_OBJECTS.releaseCalendar, false),
    object(SNAPSHOT_OBJECTS.aliases, true),
    object(SNAPSHOT_OBJECTS.historyShared, true),
  ]);
  return {
    id,
    files: {
      schools: schools as DatasetFiles["schools"],
      meta: meta as DatasetFiles["meta"],
      releaseCalendar: releaseCalendar as DatasetFiles["releaseCalendar"],
      aliases: (aliases as DatasetFiles["aliases"]) ?? [],
    },
    history: history as HistoryFiles | null,
  };
}

/* ------------------------------------------------------------------ */
/* Load, refresh, swap                                                  */
/* ------------------------------------------------------------------ */

/** A loaded snapshot and what was built from it. Replaced whole on a swap; never mutated. */
export interface Served<T> {
  id: SnapshotId;
  value: T;
  content: SnapshotContent;
}

export interface SnapshotHolder<T> {
  /** The served snapshot: the first call loads (concurrent callers share it); later calls return the newest one. */
  load(): Promise<Served<T>>;
  /** Re-reads the pointer at most once per interval and swaps when it names another snapshot. Never throws. */
  maybeRefresh(): Promise<void>;
  /** The served snapshot, or null before the first load. */
  current(): Served<T> | null;
}

export interface HolderOptions<T> {
  source: SnapshotSource;
  build: (content: SnapshotContent) => T;
  root?: string;
  get?: HttpGet;
  now?: () => number;
  intervalMs?: number;
  /** Called on every swap (lib/data.ts sends `data_snapshot_swap`). */
  onSwap?: (swap: { from: SnapshotId; to: number; ms: number }) => void;
}

const loadedLine = (colleges: number, id: SnapshotId, ms: number) => `[data] loaded ${colleges} colleges (snapshot ${id}) in ${Math.round(ms)} ms`;

/**
 * The once-per-instance holder. The served snapshot lives in one variable that a swap replaces in a single assignment
 * after the new dataset is fully built, so a reader always gets a whole dataset; a render that already holds the old
 * one keeps it (lib/data.ts caches it per request).
 */
export function createSnapshotHolder<T>(options: HolderOptions<T>): SnapshotHolder<T> {
  const { source, build, root = process.cwd(), get = httpGet, intervalMs = REFRESH_INTERVAL_MS } = options;
  const now = options.now ?? (() => performance.now());
  let current: Served<T> | null = null;
  let lastCheck = Number.NEGATIVE_INFINITY;
  let lastFailureLog = Number.NEGATIVE_INFINITY;
  let refreshing: Promise<void> | null = null;

  const serve = (content: SnapshotContent): Served<T> => ({ id: content.id, value: build(content), content });

  async function readFirst(): Promise<SnapshotContent> {
    if (source.kind === "bundled" || hasBundled(root)) return readBundled(root);
    // Storage with no bundled copy (local work, a build that skipped fetch-snapshot): download the current snapshot.
    // A failure has nothing to fall back on, so it throws; the next call tries again (createDatasetLoader).
    const pointer = await fetchPointer(source.base, get);
    lastCheck = now();
    return await fetchSnapshotFiles(source.base, pointer.id, get, pointer.manifest_sha256);
  }

  const first = createDatasetLoader(async () => {
    const start = now();
    const content = await readFirst();
    current = serve(content);
    console.info(loadedLine(content.files.schools.length, content.id, now() - start));
    return current;
  });

  async function refresh(base: string): Promise<void> {
    try {
      const pointer = await fetchPointer(base, get);
      const from = current!.id;
      if (pointer.id === from) return;
      const start = now();
      const content = await fetchSnapshotFiles(base, pointer.id, get, pointer.manifest_sha256);
      const next = serve(content);
      current = next;
      const ms = Math.round(now() - start);
      console.info(loadedLine(content.files.schools.length, content.id, ms));
      options.onSwap?.({ from, to: pointer.id, ms });
    } catch (err) {
      // Fail soft: the served snapshot stays; one line per interval at most.
      if (now() - lastFailureLog >= intervalMs) {
        lastFailureLog = now();
        console.error("[data] checking for a newer snapshot failed; still serving the current one.", err);
      }
    }
  }

  function maybeRefresh(): Promise<void> {
    if (source.kind !== "storage" || !current) return Promise.resolve();
    // `next build` serves the copy fetch-snapshot just wrote, so every prerendered page comes from one snapshot.
    if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
    if (refreshing) return refreshing;
    if (now() - lastCheck < intervalMs) return Promise.resolve();
    lastCheck = now();
    refreshing = refresh(source.base).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    async load() {
      if (current) return current;
      return first();
    },
    maybeRefresh,
    current: () => current,
  };
}

/* ------------------------------------------------------------------ */
/* The instance's holder, for currentSnapshotId() and maybeRefresh()    */
/* ------------------------------------------------------------------ */

let installed: SnapshotHolder<unknown> | null = null;

/** lib/data.ts installs its holder so the helpers below speak for the instance. */
export function installSnapshotHolder(holder: SnapshotHolder<unknown>): void {
  installed = holder;
}

/** The id this instance serves now, or null before its first load. */
export function currentSnapshotId(): SnapshotId | null {
  return installed?.current()?.id ?? null;
}

/** The instance's pointer check (see SnapshotHolder.maybeRefresh). Never throws. */
export function maybeRefresh(): Promise<void> {
  return installed?.maybeRefresh() ?? Promise.resolve();
}

/* ------------------------------------------------------------------ */
/* Shards                                                              */
/* ------------------------------------------------------------------ */

export type ShardKind = "history" | "detail" | "trend" | "reference";

const OBJECT_FOR: Record<ShardKind, (key: string) => string> = {
  history: historyObject,
  detail: detailObject,
  trend: trendObject,
  reference: referenceObject,
};

/** A shard's public URL in snapshot `id` (default: the one this instance serves) under `base` (default: DATA_SNAPSHOT_URL). */
export function shardUrl(kind: ShardKind, key: string, id: number | null = currentSnapshotId(), base = process.env.DATA_SNAPSHOT_URL ?? ""): string | null {
  if (id === null || !base.trim()) return null;
  return `${trimBase(base)}/${snapshotPath(id, OBJECT_FOR[kind](key))}`;
}

const isText = (kind: ShardKind, key: string) => kind === "reference" && !key.endsWith(".json");

/**
 * A shard from the bundled copy, or null when it isn't there. JSON is parsed; a text reference (`.md`, `.csv`) comes
 * back as its string. Each kind spells its folder literally so Next's file tracer and tests/tracing.test.mts see it.
 */
export function readBundledShard<T>(kind: ShardKind, key: string, root = process.cwd()): T | null {
  let path: string | null = null;
  if (kind === "history") path = join(root, ".data", "snapshot", "history", `${key}.json`);
  else if (kind === "detail") path = join(root, ".data", "snapshot", "detail", `${key}.json`);
  else if (kind === "trend") path = join(root, ".data", "snapshot", "trends", `${key}.json`);
  // Each reference by its literal name: a path ending in a variable name would make the tracer ship the whole project.
  else if (key === REFERENCE_OBJECTS.platformPrompts) path = join(root, ".data", "snapshot", "reference", "platform-prompts.json");
  else if (key === REFERENCE_OBJECTS.organizations) path = join(root, ".data", "snapshot", "reference", "organizations.json");
  else if (key === REFERENCE_OBJECTS.commonAppTrends) path = join(root, ".data", "snapshot", "reference", "common-app-trends.json");
  else if (key === REFERENCE_OBJECTS.essayGuidance) path = join(root, ".data", "snapshot", "reference", "essay-guidance.md");
  else if (key === REFERENCE_OBJECTS.zctaCentroids) path = join(root, ".data", "snapshot", "reference", "zcta-centroids.csv");
  if (path === null || !existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return (isText(kind, key) ? text : JSON.parse(text)) as T;
}

let shardFailureLogged = Number.NEGATIVE_INFINITY;

/**
 * One shard of snapshot `id` from Storage through Next's fetch cache (`force-cache`: the id is in the URL, so a new
 * snapshot is a new key). A 404 is an answer (the snapshot has no such shard: null); any other failure falls back to
 * the bundled copy's file, logged at most once a minute.
 */
export async function readShard<T>(kind: ShardKind, key: string, options: { id?: number | null; base?: string; root?: string } = {}): Promise<T | null> {
  const url = shardUrl(kind, key, options.id === undefined ? currentSnapshotId() : options.id, options.base);
  if (url) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
      return (isText(kind, key) ? await res.text() : await res.json()) as T;
    } catch (err) {
      const at = Date.now();
      if (at - shardFailureLogged >= REFRESH_INTERVAL_MS) {
        shardFailureLogged = at;
        console.error(`[data] fetching ${kind} ${key} failed; using the bundled copy.`, err);
      }
    }
  }
  return readBundledShard<T>(kind, key, options.root);
}
