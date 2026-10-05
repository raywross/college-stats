/**
 * publish-data's change step (specs/product/follow-colleges.md#detecting-changes; lib/changes.ts): diff the previously
 * published colleges against the files about to be published, stage the changes, and let
 * publish_schools_staged_with_changes() swap them in with the colleges in one transaction
 * (supabase/migrations/20261005140000_follows.sql).
 *
 * The change tables are optional: on a project where that migration isn't applied yet, the publish goes ahead without
 * them (with a warning), so data merges never wait on the owner applying a migration.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DatasetMeta, School } from "../../lib/types";
import type { ReleaseCalendar } from "../../lib/releases";
import { describeChange, diffSchools, type DatasetChange, type DatasetSnapshot } from "../../lib/changes.ts";

export const FOLLOWS_MIGRATION = "supabase/migrations/20261005140000_follows.sql and 20261005145000_change_old_source.sql";
/** Changes per staging call: rows are small (~300 bytes), so a big release (~20,000 rows) takes ten calls. */
export const CHANGE_BATCH = 2000;

/** Every change between the published dataset and the new files; none on a project's first publish. */
export function computeChanges(prev: DatasetSnapshot | null, next: DatasetSnapshot, calendar: Pick<ReleaseCalendar, "releases">): DatasetChange[] {
  return prev ? diffSchools(prev, next, undefined, { calendar }) : [];
}

/** A dataset directory's schools.json and meta.json (`--prev <dir>`, e.g. from `git show <ref>:data/schools.json`). */
export function readSnapshotDir(dir: string): DatasetSnapshot {
  const read = <T,>(name: string): T => {
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`${path} not found: --prev needs a directory with schools.json and meta.json`);
    return JSON.parse(readFileSync(path, "utf8")) as T;
  };
  return { schools: read<School[]>("schools.json"), meta: read<DatasetMeta>("meta.json") };
}

/**
 * Whether the change tables exist: "ready", "missing" (the migration isn't applied: publish without changes), or
 * throws for anything else (a dropped connection), like publish-data's other table checks. A one-row select, never
 * `head: true` (PostgREST answers HEAD on a missing table with a bare 204).
 */
export async function changeTablesState(client: Pick<SupabaseClient, "from">): Promise<"ready" | "missing"> {
  // old_source comes from the second migration; a project with only the first counts as missing.
  const { error } = await client.from("dataset_change_staging").select("unit_id, old_source").limit(1);
  if (!error) return "ready";
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") return "missing";
  const what = [error.message, error.code].filter(Boolean).join(" · ") || "no error message";
  throw new Error(`checking dataset_change_staging failed: ${what}. Retry; if it keeps failing, check the project.`);
}

/** Stages every change (the first call resets the table, even with none). Throws on any failure. */
export async function stageChanges(client: Pick<SupabaseClient, "rpc">, changes: readonly DatasetChange[], batch = CHANGE_BATCH): Promise<void> {
  for (let i = 0; i === 0 || i < changes.length; i += batch) {
    const { error } = await client.rpc("stage_dataset_changes", { p_changes: changes.slice(i, i + batch), p_reset: i === 0 });
    if (error) throw new Error(`staging changes ${i}–${Math.min(i + batch, changes.length)}: ${error.message}`);
  }
}

/** Counts by kind: "new_year 1,204 · revised 3 · appeared 12". */
export function changeSummary(changes: readonly DatasetChange[]): string {
  if (!changes.length) return "no changes";
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return `${changes.length.toLocaleString("en-US")} changes (${[...counts].map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(" · ")})`;
}

/**
 * The change list for `--changes-only`, college by college, each line the sentence the panel and digest will show:
 *   Stanford University (243744)
 *     · Fall 2025: 3.9% admitted (fall 2024: 4.1%)   [new_year · IPEDS Admissions · IPEDS winter release]
 */
export function formatChangeList(changes: readonly DatasetChange[], schools: readonly Pick<School, "unit_id" | "name">[], { limit = Infinity } = {}): string[] {
  const names = new Map(schools.map((s) => [s.unit_id, s.name]));
  const lines: string[] = [];
  let shown = 0;
  let last: string | null = null;
  for (const c of changes) {
    if (c.unit_id !== last) {
      if (shown >= limit) break;
      shown++;
      last = c.unit_id;
      lines.push(`${names.get(c.unit_id) ?? "Unknown college"} (${c.unit_id})`);
    }
    const tags = [c.kind, c.source, c.release].filter(Boolean).join(" · ");
    lines.push(`  · ${describeChange(c)}   [${tags}]`);
  }
  const colleges = new Set(changes.map((c) => c.unit_id)).size;
  if (colleges > shown) lines.push(`… and ${colleges - shown} more colleges`);
  return lines;
}
