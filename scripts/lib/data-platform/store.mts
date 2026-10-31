/**
 * The `DataStore` adapter (specs/data-platform/pipelines.md "The adapter"): how every producer, the import, and the
 * publisher read and write the layers (specs/data-platform/storage.md "Collections"). Two implementations with the
 * same semantics:
 *
 * - `supabaseStore(url, secretKey)`: the data project. Reads page through `data_documents` (select is open to every
 *   role, 1,000 rows a page; `body` is a `json` column, so a document comes back with its stored key order and
 *   nothing here re-sorts it); each document's body is sent as its text (`documentText`); writes go through the security-definer functions `data_open_change_set`,
 *   `data_write_documents` (200 documents a call) and `data_close_change_set`
 *   (supabase/migrations/20261031120000_data_platform.sql). A failed call that isn't the database refusing (a network
 *   error, a 5xx, a project still waking from a pause) is retried three times, after 5, 20, and 60 seconds.
 * - `fileStore(root)`: a folder, for tests, fixtures, and dry runs. `<root>/<collection>/<key>.json` holds a
 *   document's current version (`{version, change_set_id, body}`; the key through `encodeURIComponent`, so `/` and `|`
 *   are safe), and `<root>/_change_sets.json` the change sets, each with the versions it wrote.
 *
 * Both: a body equal to the current one writes nothing (compared with `orderedJson`, so key order alone isn't a
 * change, as jsonb equality in the database); `expectVersion` refuses with `StoreConflictError` when the document's
 * current version differs (0 means "must not exist"); a removed document's next write continues its version
 * numbers; writes go only into an open change set. No producer writes a composed college: only the publisher composes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChangeSetKind = "pipeline" | "import";
export type ChangeSetStatus = "open" | "applied" | "held" | "reverted";

export interface DataStore {
  /** The current documents of a collection, as a Map by key (keys in ascending order). */
  read<T>(collection: string, keyPrefix?: string): Promise<Map<string, T>>;
  readOne<T>(collection: string, key: string): Promise<T | null>;
  /** Opens a change set; `write` and `remove` go into it; `close` ends it. */
  open(kind: ChangeSetKind, source: string, runRef: string, summary?: object): Promise<ChangeSetHandle>;
  /**
   * Addition to the spec's interface: the current documents with their versions, for a producer that writes with
   * `expectVersion` (optimistic concurrency between two runs on one layer).
   */
  readVersioned<T>(collection: string, keyPrefix?: string): Promise<Map<string, { version: number; body: T }>>;
}

export interface ChangeSetHandle {
  /** The change set's id (`data_change_sets.id`; the file store's row id). */
  readonly id: number;
  write(collection: string, docs: { key: string; body: unknown; expectVersion?: number }[]): Promise<void>;
  remove(collection: string, keys: string[]): Promise<void>;
  close(status: "applied" | "held", heldReason?: string, summary?: object): Promise<void>;
}

/** A write whose `expectVersion` didn't match the document's current version (SQLSTATE 40001 in the database). */
export class StoreConflictError extends Error {
  readonly collection: string | null;
  readonly key: string | null;
  constructor(message: string, collection: string | null = null, key: string | null = null) {
    super(message);
    this.name = "StoreConflictError";
    this.collection = collection;
    this.key = key;
  }
}

/** The collection name rule `data_documents` checks. */
export const COLLECTION_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
/** Keys are 1 to 200 characters (`data_documents.key`). */
export const KEY_MAX = 200;

function checkDoc(collection: string, key: string): void {
  if (!COLLECTION_NAME.test(collection)) throw new Error(`data store: "${collection}" isn't a collection name (${COLLECTION_NAME})`);
  if (typeof key !== "string" || key.length < 1 || key.length > KEY_MAX) throw new Error(`data store: ${collection} key ${JSON.stringify(key)} must be 1 to ${KEY_MAX} characters`);
}

/**
 * Stable JSON for equality: every object's keys sorted, recursively, arrays kept in order (the approach of
 * lib/essay-prompts/confirmed.ts `recordJson`, generalized to any value). `undefined` members drop out, as
 * `JSON.stringify` drops them. Two bodies with the same orderedJson are the same document.
 */
export function orderedJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && (value as object).constructor === Object) {
    const rec = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(rec)
        .sort()
        .filter((k) => rec[k] !== undefined)
        .map((k) => [k, sortKeys(rec[k])])
    );
  }
  return value;
}

/**
 * A document's stored text: `JSON.stringify` with the producer's key order. Both stores store exactly this (the file
 * store as the `body` of its file, the Supabase store as the string it sends for the `json` column), so a body read back
 * from either serializes to the same bytes; equality for idempotence is `orderedJson` (here) or a jsonb cast (there).
 */
/**
 * A document's text: `JSON.stringify` with the producer's key order, minus any NUL character. Postgres `json` and
 * `jsonb` refuse the `\u0000` escape, and a NUL in a document is never meaning, only a PDF reader's artifact (one CDS
 * record's quote carried one in the first import), so both stores drop it and their texts stay equal.
 */
export const documentText = (body: unknown): string => JSON.stringify(body).replace(/\\u0000/g, "");

/** A write call carries at most this many documents and about this many bytes of text: a 16 MB call of CDS records timed out on a Nano instance. */
export const WRITE_CHUNK_BYTES = 1_500_000;

/** Key-to-file-name encoding of the file store: `encodeURIComponent`, so `essay-guidance/guidance` and `1|2|C1` are one file each. */
export const encodeKey = (key: string) => encodeURIComponent(key);
export const decodeKey = (file: string) => decodeURIComponent(file);

/* ------------------------------------------------------------------ */
/* The file store                                                      */
/* ------------------------------------------------------------------ */

/** One version a change set wrote (the file store's stand-in for `data_document_versions`, without the body). */
export interface FileVersionRow {
  collection: string;
  key: string;
  version: number;
  deleted: boolean;
}

/** A row of `<root>/_change_sets.json`, shaped like `data_change_sets`, plus the versions it wrote. */
export interface FileChangeSetRow {
  id: number;
  kind: ChangeSetKind;
  source: string;
  run_ref: string | null;
  status: ChangeSetStatus;
  held_reason: string | null;
  summary: Record<string, unknown>;
  created_at: string;
  closed_at: string | null;
  versions: FileVersionRow[];
}

/** The file holding one document's current version. */
interface FileDocument {
  version: number;
  change_set_id: number;
  body: unknown;
}

const CHANGE_SETS_FILE = "_change_sets.json";

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** The counts `data_close_change_set` fills from a set's versions. */
export function summaryFromVersions(versions: readonly FileVersionRow[]): { documents: number; added: number; changed: number; removed: number; collections: string[] } {
  const added = versions.filter((v) => !v.deleted && v.version === 1).length;
  const removed = versions.filter((v) => v.deleted).length;
  return {
    documents: versions.length,
    added,
    changed: versions.length - added - removed,
    removed,
    collections: [...new Set(versions.map((v) => v.collection))].sort(),
  };
}

/**
 * Documents as files under `root` (created on the first write). Reads go to disk every time, so two stores over one
 * folder see each other's writes; writes inside one call either all land or (on a conflict) none do.
 */
export function fileStore(root: string, opts: { now?: () => Date } = {}): DataStore {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const docPath = (collection: string, key: string) => join(root, collection, `${encodeKey(key)}.json`);
  const setsPath = join(root, CHANGE_SETS_FILE);

  const readSets = (): FileChangeSetRow[] => (existsSync(setsPath) ? (JSON.parse(readFileSync(setsPath, "utf8")) as FileChangeSetRow[]) : []);
  const writeSets = (rows: FileChangeSetRow[]) => writeAtomic(setsPath, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
  const readDoc = (collection: string, key: string): FileDocument | null => {
    const p = docPath(collection, key);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as FileDocument) : null;
  };

  async function readVersioned<T>(collection: string, keyPrefix?: string): Promise<Map<string, { version: number; body: T }>> {
    if (!COLLECTION_NAME.test(collection)) throw new Error(`data store: "${collection}" isn't a collection name`);
    const dir = join(root, collection);
    const out = new Map<string, { version: number; body: T }>();
    if (!existsSync(dir)) return out;
    const keys = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => decodeKey(f.slice(0, -".json".length)))
      .filter((k) => keyPrefix === undefined || k.startsWith(keyPrefix))
      .sort(compareKeys);
    for (const key of keys) {
      const d = readDoc(collection, key)!;
      out.set(key, { version: d.version, body: d.body as T });
    }
    return out;
  }

  /** The newest version each document ever had, deleted ones included (so a re-created document continues). */
  function lastVersions(sets: readonly FileChangeSetRow[]): Map<string, number> {
    const last = new Map<string, number>();
    for (const s of sets) for (const v of s.versions) last.set(`${v.collection}\u0000${v.key}`, Math.max(v.version, last.get(`${v.collection}\u0000${v.key}`) ?? 0));
    return last;
  }

  function apply(setId: number, collection: string, docs: readonly { key: string; body: unknown; expectVersion?: number }[]): void {
    const sets = readSets();
    const set = sets.find((s) => s.id === setId);
    if (!set || set.status !== "open") throw new Error("change set is not open");
    for (const d of docs) checkDoc(collection, d.key);
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.key)) throw new Error(`data store: ${collection} key ${d.key} written twice in one call`);
      seen.add(d.key);
    }
    // Check every document first: a conflict writes nothing (the database's call is one transaction).
    const current = new Map(docs.map((d) => [d.key, readDoc(collection, d.key)]));
    for (const d of docs) {
      if (d.expectVersion === undefined) continue;
      const have = current.get(d.key)?.version ?? 0;
      if (have !== d.expectVersion) throw new StoreConflictError(`version conflict: ${collection}/${d.key} is at version ${have}, expected ${d.expectVersion}`, collection, d.key);
    }
    const last = lastVersions(sets);
    for (const d of docs) {
      const cur = current.get(d.key) ?? null;
      if (d.body === null || d.body === undefined) {
        if (!cur) continue;
        const version = Math.max(cur.version, last.get(`${collection}\u0000${d.key}`) ?? 0) + 1;
        rmSync(docPath(collection, d.key));
        set.versions.push({ collection, key: d.key, version, deleted: true });
        continue;
      }
      if (cur && orderedJson(cur.body) === orderedJson(d.body)) continue;
      const version = Math.max(cur?.version ?? 0, last.get(`${collection}\u0000${d.key}`) ?? 0) + 1;
      // `{version, change_set_id, body}` with the body's text from documentText (the bytes the Supabase store sends).
      writeAtomic(docPath(collection, d.key), `{"version":${version},"change_set_id":${setId},"body":${documentText(d.body)}}\n`);
      set.versions.push({ collection, key: d.key, version, deleted: false });
    }
    writeSets(sets);
  }

  return {
    readVersioned,
    async read<T>(collection: string, keyPrefix?: string) {
      const all = await readVersioned<T>(collection, keyPrefix);
      return new Map([...all].map(([k, v]) => [k, v.body]));
    },
    async readOne<T>(collection: string, key: string) {
      checkDoc(collection, key);
      return (readDoc(collection, key)?.body as T | undefined) ?? null;
    },
    async open(kind, source, runRef, summary) {
      const sets = readSets();
      const id = sets.reduce((m, s) => Math.max(m, s.id), 0) + 1;
      sets.push({ id, kind, source, run_ref: runRef || null, status: "open", held_reason: null, summary: { ...(summary ?? {}) }, created_at: now(), closed_at: null, versions: [] });
      writeSets(sets);
      return {
        id,
        async write(collection, docs) {
          apply(id, collection, docs);
        },
        async remove(collection, keys) {
          apply(id, collection, keys.map((key) => ({ key, body: null })));
        },
        async close(status, heldReason, closeSummary) {
          if (status !== "applied" && status !== "held") throw new Error(`data store: a change set closes "applied" or "held", not "${status}"`);
          const rows = readSets();
          const set = rows.find((s) => s.id === id);
          if (!set || set.status !== "open") throw new Error("change set is not open");
          set.status = status;
          set.held_reason = status === "held" ? (heldReason ?? null) : null;
          set.summary = { ...set.summary, ...summaryFromVersions(set.versions), ...(closeSummary ?? {}) };
          set.closed_at = now();
          writeSets(rows);
        },
      };
    },
  };
}

/** The file store's change sets (tests, the import's report). */
export function fileStoreChangeSets(root: string): FileChangeSetRow[] {
  const p = join(root, CHANGE_SETS_FILE);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as FileChangeSetRow[]) : [];
}

/**
 * Code-unit order: the file store lists keys in it. The database orders by its collation, which may differ, so a
 * reader that needs an order sorts with this (layers.mts `readLayer` does).
 */
export const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ */
/* The Supabase store                                                  */
/* ------------------------------------------------------------------ */

/** Rows per read page (PostgREST's default cap is 1,000). */
export const READ_PAGE = 1000;
/** Documents per `data_write_documents` call. */
export const WRITE_CHUNK = 200;

/**
 * Splits write rows into calls of at most WRITE_CHUNK documents and about WRITE_CHUNK_BYTES of body text (a single
 * document larger than that goes alone). Yields [start index, rows].
 */
export function* chunkRows<T extends { body: string | null }>(rows: readonly T[], maxDocs = WRITE_CHUNK, maxBytes = WRITE_CHUNK_BYTES): Generator<[number, T[]]> {
  let start = 0;
  while (start < rows.length) {
    let end = start;
    let bytes = 0;
    while (end < rows.length && end - start < maxDocs) {
      const size = rows[end].body?.length ?? 0;
      if (end > start && bytes + size > maxBytes) break;
      bytes += size;
      end++;
    }
    yield [start, rows.slice(start, end)];
    start = end;
  }
}
/** Waits before each retry of a failed call, in ms: a paused free project takes a minute or so to wake. */
export const RETRY_WAITS = [5_000, 20_000, 60_000] as const;

/** The part of the client the store uses (a fake in tests implements just this). */
export type StoreClient = Pick<SupabaseClient, "from" | "rpc">;

interface CallResult<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
  status?: number;
}

/**
 * Whether a failed call is worth retrying: the database answering with a refusal (an SQLSTATE such as 40001, P0001,
 * 22023, or PostgREST's PGRST codes for a missing function) never is; a network error, a 5xx without a code, or a
 * connection or resource class code (08, 53, 57) is.
 */
export function retryable(result: Pick<CallResult<unknown>, "error" | "status">): boolean {
  const code = result.error?.code ?? "";
  if (code.startsWith("PGRST")) return (result.status ?? 0) >= 500 && code !== "PGRST202";
  if (/^[0-9A-Z]{5}$/.test(code)) return /^(08|53|57)/.test(code);
  return true;
}

export interface SupabaseStoreOptions {
  /** A client to use instead of creating one (tests pass a fake). */
  client?: StoreClient;
  /** Waits between retries, in ms (tests pass zeros). */
  waits?: readonly number[];
  /** Progress lines (one per chunk); silent by default. */
  log?: (line: string) => void;
}

/**
 * The data project through `@supabase/supabase-js` with the secret key. The client is created on the first call, so
 * building the store costs nothing and a test with a fake client never loads the real one.
 */
export function supabaseStore(url: string, secretKey: string, opts: SupabaseStoreOptions = {}): DataStore {
  const waits = opts.waits ?? RETRY_WAITS;
  let client: StoreClient | null = opts.client ?? null;
  const getClient = async (): Promise<StoreClient> => {
    if (client) return client;
    if (!url || !secretKey) throw new Error("data store: supabase needs a URL and a secret key (DATA_SUPABASE_URL, DATA_SUPABASE_SECRET_KEY)");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  };

  /** Runs one call, retrying per `retryable`; throws a StoreConflictError for 40001 and an Error for the rest. */
  async function call<T>(what: string, run: (c: StoreClient) => PromiseLike<CallResult<T>>): Promise<T | null> {
    const c = await getClient();
    for (let attempt = 0; ; attempt++) {
      let result: CallResult<T>;
      try {
        result = await run(c);
      } catch (err) {
        result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
      }
      if (!result.error) return result.data;
      if (result.error.code === "40001") throw new StoreConflictError(`${what}: ${result.error.message}`);
      if (attempt >= waits.length || !retryable(result)) throw new Error(`data store: ${what} failed: ${result.error.message}${result.error.code ? ` (${result.error.code})` : ""}`);
      opts.log?.(`  ${what} failed (${result.error.message}); retrying in ${Math.round(waits[attempt] / 1000)} s`);
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }

  async function readVersioned<T>(collection: string, keyPrefix?: string): Promise<Map<string, { version: number; body: T }>> {
    if (!COLLECTION_NAME.test(collection)) throw new Error(`data store: "${collection}" isn't a collection name`);
    const out = new Map<string, { version: number; body: T }>();
    for (let from = 0; ; from += READ_PAGE) {
      const rows = await call<{ key: string; version: number; body: T }[]>(`reading ${collection}`, (c) => {
        let q = c.from("data_documents").select("key, version, body").eq("collection", collection);
        if (keyPrefix) q = q.like("key", `${escapeLike(keyPrefix)}%`);
        return q.order("key", { ascending: true }).range(from, from + READ_PAGE - 1) as unknown as PromiseLike<CallResult<{ key: string; version: number; body: T }[]>>;
      });
      for (const r of rows ?? []) out.set(r.key, { version: r.version, body: r.body });
      if ((rows ?? []).length < READ_PAGE) break;
    }
    return out;
  }

  return {
    readVersioned,
    async read<T>(collection: string, keyPrefix?: string) {
      const all = await readVersioned<T>(collection, keyPrefix);
      return new Map([...all].map(([k, v]) => [k, v.body]));
    },
    async readOne<T>(collection: string, key: string) {
      checkDoc(collection, key);
      const row = await call<{ body: T }>(`reading ${collection}/${key}`, (c) =>
        c.from("data_documents").select("body").eq("collection", collection).eq("key", key).maybeSingle() as unknown as PromiseLike<CallResult<{ body: T }>>
      );
      return row ? row.body : null;
    },
    async open(kind, source, runRef, summary) {
      const id = await call<number>("opening a change set", (c) =>
        c.rpc("data_open_change_set", { p_kind: kind, p_source: source, p_run_ref: runRef || null, p_summary: summary ?? {} }) as unknown as PromiseLike<CallResult<number>>
      );
      if (typeof id !== "number" && typeof id !== "string") throw new Error("data store: data_open_change_set returned no id");
      const setId = Number(id);
      const send = async (collection: string, docs: { key: string; body: unknown; expectVersion?: number }[]) => {
        for (const d of docs) checkDoc(collection, d.key);
        // The document's text, key order as the producer built it (the column is `json`, which keeps it); null deletes.
        const rows = docs.map((d) => ({
          collection,
          key: d.key,
          body: d.body === undefined || d.body === null ? null : documentText(d.body),
          ...(d.expectVersion !== undefined ? { expect_version: d.expectVersion } : {}),
        }));
        for (const [start, chunk] of chunkRows(rows)) {
          const written = await call<number>(`writing ${collection} (${start + 1}–${start + chunk.length} of ${docs.length})`, (c) =>
            c.rpc("data_write_documents", { p_change_set: setId, p_documents: chunk }) as unknown as PromiseLike<CallResult<number>>
          );
          opts.log?.(`  ${collection}: ${start + chunk.length} of ${docs.length} sent, ${written ?? 0} written`);
        }
      };
      return {
        id: setId,
        write: send,
        remove: (collection, keys) => send(collection, keys.map((key) => ({ key, body: null }))),
        async close(status, heldReason, closeSummary) {
          await call<null>("closing the change set", (c) =>
            c.rpc("data_close_change_set", { p_change_set: setId, p_status: status, p_held_reason: heldReason ?? null, p_summary: closeSummary ?? null }) as unknown as PromiseLike<CallResult<null>>
          );
        },
      };
    },
  };
}

/** `%`, `_` and `\` taken literally in a `like` pattern. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/* ------------------------------------------------------------------ */
/* --store                                                             */
/* ------------------------------------------------------------------ */

/** The environment variables the store reads (process.env, or a plain object in tests). */
export type Env = Readonly<Record<string, string | undefined>>;

/** The data project's URL and secret key: DATA_SUPABASE_* first, then the app's SUPABASE_* (the dev project, phase 1). */
export function dataProjectEnv(env: Env = process.env): { url: string | null; key: string | null } {
  return { url: env.DATA_SUPABASE_URL || env.SUPABASE_URL || null, key: env.DATA_SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY || null };
}

/** What a `--store` value names: `supabase`, or `file:<dir>` (relative to the working directory). */
export type StoreSpec = { kind: "supabase"; url: string; key: string } | { kind: "file"; root: string };

/**
 * Parses `--store`. Without one, `supabase` when DATA_SUPABASE_URL is set (pipelines.md "Local runs"), else an error:
 * a script never writes to the app's own project just because SUPABASE_URL is in `.env.local`.
 */
export function parseStoreFlag(value: string | undefined, env: Env = process.env): StoreSpec {
  const v = value ?? (env.DATA_SUPABASE_URL ? "supabase" : undefined);
  if (!v) throw new Error("--store is required: --store supabase (the data project) or --store file:<dir> (a folder)");
  if (v.startsWith("file:")) {
    const dir = v.slice("file:".length);
    if (!dir) throw new Error("--store file:<dir> needs a folder");
    return { kind: "file", root: resolve(dir) };
  }
  if (v !== "supabase") throw new Error(`--store ${v}: expected supabase or file:<dir>`);
  const { url, key } = dataProjectEnv(env);
  if (!url || !key) throw new Error("--store supabase needs DATA_SUPABASE_URL and DATA_SUPABASE_SECRET_KEY (or SUPABASE_URL and SUPABASE_SECRET_KEY)");
  return { kind: "supabase", url, key };
}

/** The store a `--store` value names (see `parseStoreFlag`). */
export function storeFromFlag(value: string | undefined, env: Env = process.env, opts: SupabaseStoreOptions = {}): DataStore {
  const spec = parseStoreFlag(value, env);
  return spec.kind === "file" ? fileStore(spec.root) : supabaseStore(spec.url, spec.key, opts);
}

/** `--name value` or `--name=value` from argv, or undefined. */
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}
