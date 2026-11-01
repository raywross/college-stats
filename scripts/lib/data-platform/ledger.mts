/**
 * What the publisher reads and records besides the layers (specs/data-platform/publish.md steps 1, 2 and 6): the
 * change sets since the last published snapshot, the snapshots themselves (`data_snapshots`, through
 * `data_begin_snapshot`/`data_finish_snapshot`), the live field edits (`data_field_edits`), and the console's
 * hand-read essay prompts (`essay_prompt_overrides`). Two implementations, like the store (./store.mts):
 * `supabaseLedger` over the data project, and `fileLedger` over a file store's folder, which keeps
 * `<root>/_snapshots.json` beside the store's `_change_sets.json` and reads `<root>/_field_edits.json` and
 * `<root>/_essay_prompt_overrides.json` when they exist (tests and fixtures).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotManifest } from "../../../lib/data-platform/snapshot.ts";
import type { FieldEdit } from "../../../lib/data-platform/edits.ts";
import type { OverrideRow } from "../essay-prompts/export-confirmed.mts";
import { fileStoreChangeSets } from "./store.mts";
import type { SnapshotRow } from "./upload.mts";
import type { RecordedManifest } from "./publish-tables.mts";

/** A closed change set the next snapshot would carry. */
export interface PendingChangeSet {
  id: number;
  source: string;
  status: "applied" | "held";
  held_reason: string | null;
  /** The collections the set wrote (its summary's `collections`), or null when the summary doesn't say. */
  collections?: string[] | null;
}

/**
 * Whether a set can change what a snapshot composes: not when every collection it wrote is the Data Steward's
 * (`steward.*`, never composed), or when it wrote nothing. A set whose summary doesn't list its collections counts.
 */
export function changesSnapshot(s: Pick<PendingChangeSet, "collections">): boolean {
  if (!Array.isArray(s.collections)) return true;
  return s.collections.some((c) => !c.startsWith("steward."));
}

export interface PublishLedger {
  /** Closed change sets (applied or held) that no published snapshot has carried yet, oldest first. */
  pendingChangeSets(): Promise<PendingChangeSet[]>;
  /** Every snapshot row, newest first, without manifests. */
  snapshots(): Promise<SnapshotRow[]>;
  /** One snapshot's manifest (from its row), or null. */
  manifest(id: number): Promise<Partial<SnapshotManifest> | null>;
  /** A `building` row; returns its id. */
  begin(changeSetIds: readonly number[], previous: number | null): Promise<number>;
  /** `published` (the pointer moved to it) or `failed`; a published row's manifest also carries the table step's log. */
  finish(id: number, status: "published" | "failed", manifest: SnapshotManifest | RecordedManifest | null, notes: string | null): Promise<void>;
  /** The unreleased field edits. */
  fieldEdits(): Promise<FieldEdit[]>;
  /** The console's hand-read prompts, or null when this ledger has no such table (the compose then keeps the layer's). */
  promptOverrides(): Promise<OverrideRow[] | null>;
}

/** The newest published snapshot, or null before the first. */
export async function lastPublished(ledger: PublishLedger): Promise<SnapshotRow | null> {
  return (await ledger.snapshots()).find((r) => r.status === "published") ?? null;
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

const PAGE = 1000;

async function allRows<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`reading ${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The data project's tables, with the secret key (the `data_*` functions are granted to the service role only). */
export function supabaseLedger(client: Pick<SupabaseClient, "from" | "rpc">): PublishLedger {
  return {
    async pendingChangeSets() {
      const rows = await allRows<PendingChangeSet>("data_change_sets", (from, to) =>
        client.from("data_change_sets").select("id, source, status, held_reason, collections:summary->collections").is("snapshot_id", null).in("status", ["applied", "held"]).not("closed_at", "is", null).order("id", { ascending: true }).range(from, to)
      );
      return rows.map((r) => ({ ...r, id: Number(r.id) }));
    },
    async snapshots() {
      const rows = await allRows<SnapshotRow>("data_snapshots", (from, to) => client.from("data_snapshots").select("id, status, created_at, pointer_at").order("id", { ascending: false }).range(from, to));
      return rows.map((r) => ({ ...r, id: Number(r.id), manifest: {} }));
    },
    async manifest(id) {
      const { data, error } = await client.from("data_snapshots").select("manifest").eq("id", id).maybeSingle();
      if (error) throw new Error(`reading snapshot ${id}: ${error.message}`);
      return ((data as { manifest?: Partial<SnapshotManifest> } | null)?.manifest as Partial<SnapshotManifest>) ?? null;
    },
    async begin(changeSetIds, previous) {
      const { data, error } = await client.rpc("data_begin_snapshot", { p_change_set_ids: [...changeSetIds], p_previous: previous });
      if (error) throw new Error(`data_begin_snapshot: ${error.message}`);
      return Number(data);
    },
    async finish(id, status, manifest, notes) {
      const { error } = await client.rpc("data_finish_snapshot", { p_snapshot: id, p_status: status, p_manifest: manifest, p_notes: notes });
      if (error) throw new Error(`data_finish_snapshot: ${error.message}`);
    },
    async fieldEdits() {
      const rows = await allRows<FieldEdit>("data_field_edits", (from, to) =>
        client.from("data_field_edits").select("id, unit_id, path, value, note, created_at, released_at").is("released_at", null).order("id", { ascending: true }).range(from, to)
      );
      return rows.map((r) => ({ ...r, id: Number(r.id) }));
    },
    async promptOverrides() {
      const rows = await allRows<OverrideRow>("essay_prompt_overrides", (from, to) => client.from("essay_prompt_overrides").select("unit_id, cycle, record").order("unit_id").range(from, to));
      return rows;
    },
  };
}

/* ------------------------------------------------------------------ */
/* The file store's folder                                             */
/* ------------------------------------------------------------------ */

/** A row of `<root>/_snapshots.json`, shaped like `data_snapshots`. */
export interface FileSnapshotRow extends SnapshotRow {
  change_set_ids: number[];
  previous_id: number | null;
  notes: string | null;
}

export const SNAPSHOTS_FILE = "_snapshots.json";
export const FIELD_EDITS_FILE = "_field_edits.json";
export const PROMPT_OVERRIDES_FILE = "_essay_prompt_overrides.json";

/** The ledger of a file store at `root` (`now` for tests). */
export function fileLedger(root: string, opts: { now?: () => Date } = {}): PublishLedger {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const path = join(root, SNAPSHOTS_FILE);
  const read = (): FileSnapshotRow[] => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FileSnapshotRow[]) : []);
  const write = (rows: FileSnapshotRow[]) => {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
    renameSync(tmp, path);
  };
  const optional = <T,>(name: string): T | null => (existsSync(join(root, name)) ? (JSON.parse(readFileSync(join(root, name), "utf8")) as T) : null);
  return {
    async pendingChangeSets() {
      const carried = new Set(read().filter((r) => r.status === "published").flatMap((r) => r.change_set_ids));
      return fileStoreChangeSets(root)
        .filter((s) => (s.status === "applied" || s.status === "held") && s.closed_at && !carried.has(s.id))
        .map((s) => ({ id: s.id, source: s.source, status: s.status as "applied" | "held", held_reason: s.held_reason, collections: Array.isArray(s.summary.collections) ? (s.summary.collections as string[]) : null }));
    },
    async snapshots() {
      return read()
        .sort((a, b) => b.id - a.id)
        .map((r) => ({ id: r.id, status: r.status, created_at: r.created_at, pointer_at: r.pointer_at, manifest: {} }));
    },
    async manifest(id) {
      return read().find((r) => r.id === id)?.manifest ?? null;
    },
    async begin(changeSetIds, previous) {
      const rows = read();
      const id = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      rows.push({ id, status: "building", created_at: now(), pointer_at: null, manifest: {}, change_set_ids: [...changeSetIds], previous_id: previous, notes: null });
      write(rows);
      return id;
    },
    async finish(id, status, manifest, notes) {
      const rows = read();
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "building") throw new Error("snapshot is not building");
      row.status = status;
      if (manifest) row.manifest = manifest;
      row.notes = notes;
      row.pointer_at = status === "published" ? now() : null;
      write(rows);
    },
    async fieldEdits() {
      return (optional<FieldEdit[]>(FIELD_EDITS_FILE) ?? []).filter((e) => !e.released_at);
    },
    async promptOverrides() {
      return optional<OverrideRow[]>(PROMPT_OVERRIDES_FILE);
    },
  };
}
