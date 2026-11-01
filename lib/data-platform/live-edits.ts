import "server-only";
import { cache } from "react";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { School } from "../types.ts";
import { editProblem, withEdits, type FieldEdit } from "./edits.ts";

/**
 * The live overlay (specs/data-platform/change-sets.md "Admin edits"): an admin's edit shows on the college's pages and
 * in the Data API at once, before the next snapshot carries it. Every unreleased row of `data_field_edits` is read in
 * one request (PostgREST, the publishable key: the table's select is open to everyone), then applied with the same
 * `withEdits` the publisher runs as its last compose step, so a page and the next snapshot never disagree.
 *
 * - Over node:http(s), never `fetch`: Next.js patches `fetch`, and an uncacheable fetch during a static render (the
 *   prerendered profile) would turn that page dynamic. A 3 s timeout.
 * - One read per request (React `cache()`) and per instance at most every 30 s (a module-level memo), so a burst of
 *   API calls or a static regeneration costs one read.
 * - Fails open: any failure (an HTTP error, a timeout, a body that isn't rows) serves no edits, logged at most once a
 *   minute per kind. Without SUPABASE_URL or the publishable key, nothing is read and schools pass through unchanged.
 *
 * Applied where one college is read: lib/profile-data.ts (the profile and its topic pages), lib/compare-data.ts, the
 * Data API's /schools/{id} and /lineage, and the MCP one-college tools. Lists, search, trends and Explore wait for the
 * snapshot.
 */

/** A GET with headers and a timeout: status and body. Injected in tests; the default is node:http(s). */
export type LiveGet = (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<{ status: number; body: Buffer }>;

export const LIVE_EDITS_TIMEOUT_MS = 3_000;
/** How long one read serves an instance. */
export const LIVE_EDITS_TTL_MS = 30_000;
/** At most one log line per failure kind per this interval. */
export const LIVE_EDITS_LOG_INTERVAL_MS = 60_000;

/** The columns read: what `withEdits` needs, nothing about who made the edit. */
export const LIVE_EDIT_COLUMNS = "id,unit_id,path,value,note,created_at";

/** The PostgREST URL of every unreleased edit, oldest first, or null when Supabase isn't configured. */
export function liveEditsUrl(env: Record<string, string | undefined> = process.env): string | null {
  const base = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base || !env.SUPABASE_PUBLISHABLE_KEY?.trim()) return null;
  return `${base}/rest/v1/data_field_edits?select=${LIVE_EDIT_COLUMNS}&released_at=is.null&order=id`;
}

/** The default LiveGet: one request, redirects not followed. */
export const liveGet: LiveGet = (url, headers, timeoutMs) =>
  new Promise((resolve, reject) => {
    const request = url.startsWith("https:") ? httpsRequest : httpRequest;
    const req = request(url, { method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new LiveEditsTimeout(`timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });

class LiveEditsTimeout extends Error {}

/** Why a read failed, for the once-a-minute log. */
export type LiveEditsFailure = "http" | "timeout" | "network" | "malformed";

class LiveEditsError extends Error {
  readonly kind: LiveEditsFailure;
  constructor(kind: LiveEditsFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * PostgREST's rows as FieldEdits. Throws on a body that isn't an array of rows with the columns asked for; a row whose
 * path `editProblem` refuses (unregistered, computed, hidden) is skipped, as the publisher skips and reports it.
 */
export function parseLiveEdits(body: Buffer | string): FieldEdit[] {
  let rows: unknown;
  try {
    rows = JSON.parse(typeof body === "string" ? body : body.toString("utf8"));
  } catch {
    throw new LiveEditsError("malformed", "the body is not JSON");
  }
  if (!Array.isArray(rows)) throw new LiveEditsError("malformed", "the body is not a list of rows");
  const out: FieldEdit[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.unit_id !== "string" || typeof row.path !== "string" || typeof row.created_at !== "string" || !("value" in row)) {
      throw new LiveEditsError("malformed", "a row lacks unit_id, path, value or created_at");
    }
    const id = typeof row.id === "number" ? row.id : Number(row.id);
    if (!Number.isFinite(id)) throw new LiveEditsError("malformed", "a row has no numeric id");
    const edit: FieldEdit = { id, unit_id: row.unit_id, path: row.path, value: row.value, note: typeof row.note === "string" ? row.note : null, created_at: row.created_at, released_at: null };
    if (editProblem(edit)) continue;
    out.push(edit);
  }
  return out;
}

export interface LiveEditsReaderOptions {
  env?: Record<string, string | undefined>;
  get?: LiveGet;
  now?: () => number;
  log?: (line: string, err?: unknown) => void;
  ttlMs?: number;
  timeoutMs?: number;
}

export interface LiveEditsReader {
  /** Every live edit, from the memo when it is fresh. Never throws; [] on any failure or without configuration. */
  read(): Promise<FieldEdit[]>;
  /** Drops the memo, so the next read goes to the database (after a save on this instance). */
  forget(): void;
}

/** A reader with its own memo and log clock (the module's default one below; tests build their own). */
export function createLiveEditsReader(options: LiveEditsReaderOptions = {}): LiveEditsReader {
  const { get = liveGet, ttlMs = LIVE_EDITS_TTL_MS, timeoutMs = LIVE_EDITS_TIMEOUT_MS } = options;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((line: string, err?: unknown) => console.error(line, err ?? ""));
  let memo: { at: number; edits: Promise<FieldEdit[]> } | null = null;
  const lastLog = new Map<LiveEditsFailure, number>();

  function failed(kind: LiveEditsFailure, err: unknown): FieldEdit[] {
    const at = now();
    if (at - (lastLog.get(kind) ?? Number.NEGATIVE_INFINITY) >= LIVE_EDITS_LOG_INTERVAL_MS) {
      lastLog.set(kind, at);
      log(`[data] reading live edits failed (${kind}); serving the snapshot's values.`, err);
    }
    return [];
  }

  async function fetchEdits(): Promise<FieldEdit[]> {
    const env = options.env ?? process.env;
    const url = liveEditsUrl(env);
    if (!url) return [];
    const key = env.SUPABASE_PUBLISHABLE_KEY!.trim();
    let res: { status: number; body: Buffer };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The timeout is enforced here as well as in liveGet, so an injected get that hangs times out the same way.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LiveEditsTimeout(`timed out after ${timeoutMs} ms`)), timeoutMs);
      });
      res = await Promise.race([get(url, { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, timeoutMs), timeout]);
    } catch (err) {
      return failed(err instanceof LiveEditsTimeout ? "timeout" : "network", err);
    } finally {
      clearTimeout(timer);
    }
    if (res.status < 200 || res.status >= 300) return failed("http", new Error(`GET data_field_edits: ${res.status}`));
    try {
      return parseLiveEdits(res.body);
    } catch (err) {
      return failed("malformed", err);
    }
  }

  return {
    read() {
      const at = now();
      if (memo && at - memo.at < ttlMs) return memo.edits;
      const edits = fetchEdits().catch((err: unknown) => failed("network", err));
      memo = { at, edits };
      return edits;
    },
    forget() {
      memo = null;
    },
  };
}

const reader = createLiveEditsReader();

/** Every live edit, read once per request (and at most every 30 s per instance). Never throws. */
export const liveFieldEdits: () => Promise<FieldEdit[]> = cache(() => reader.read());

/** Drops this instance's memo: the next request reads the table again. */
export function forgetLiveEdits(): void {
  reader.forget();
}

/** The college with its live edits applied (the same school back when it has none). Never throws. */
export async function withLiveEdits<T extends School>(school: T): Promise<T> {
  const edits = await liveFieldEdits();
  return edits.length ? (withEdits(school, edits) as T) : school;
}

/** Each college with its live edits applied, in order. Never throws. */
export async function withLiveEditsAll(schools: School[]): Promise<School[]> {
  const edits = await liveFieldEdits();
  if (!edits.length) return schools;
  const units = new Set(edits.map((e) => e.unit_id));
  return schools.map((s) => (units.has(s.unit_id) ? withEdits(s, edits) : s));
}
