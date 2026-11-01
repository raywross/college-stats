/**
 * The change log (specs/serving-architecture.md section 2; specs/product/follow-colleges.md#detecting-changes;
 * lib/changes.ts). The snapshot publisher records the change log through `computeChanges` and `recordPublish`
 * (scripts/lib/data-platform/changelog.mts), with two snapshots in place of two commits; the git-based CLI
 * (`npm run publish-changes`) and its workflow, and the backfill and rebuild scripts, are retired. `publishChanges` and
 * `gitAccess` stay for the tests and for reading the change log's history before phase 4.
 *
 * In `publishChanges`, both datasets come from git history, never from the network or the working tree: the colleges,
 * meta and release calendar as commits made before phase 4 held them (HISTORICAL_DATA_DIR) at the base commit (the last one recorded in dataset_publishes) and at the deployed
 * commit, read with `git show <sha>:<path>`. The changes between them are staged with stage_dataset_changes(), then
 * publish_changes() records the publish and moves them into dataset_changes in one transaction
 * (supabase/migrations/20261007120000_publish_changes.sql). Re-running for a commit already recorded writes nothing.
 *
 * Every git and database touch is injected, so tests run it with stubs (tests/publish-changes.test.mts).
 */
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DatasetMeta, School } from "../../lib/types";
import type { ReleaseCalendar } from "../../lib/releases";
import type { FieldPath } from "../../lib/fields.ts";
import { TIER_FIELDS, describeChange, diffSchools, type DatasetChange, type DatasetSnapshot } from "../../lib/changes.ts";

export const PUBLISH_CHANGES_MIGRATION = "supabase/migrations/20261007120000_publish_changes.sql";
/** Changes per staging call: rows are small (~300 bytes), so a big release (~20,000 rows) takes ten calls. */
export const CHANGE_BATCH = 2000;
/**
 * The folder the dataset's files sat in inside commits made before phase 4 (specs/data-platform/git-ci-tests.md: the
 * folder has left the repository). Only `git show <sha>:<path>` reads these paths, from history; nothing reads them
 * from the working tree.
 */
export const HISTORICAL_DATA_DIR = "data";
/** The files a dataset is diffed from, at a commit made before phase 4. */
export const DATASET_PATHS = {
  schools: `${HISTORICAL_DATA_DIR}/schools.json`,
  meta: `${HISTORICAL_DATA_DIR}/meta.json`,
  calendar: `${HISTORICAL_DATA_DIR}/release-calendar.json`,
} as const;
/** A commit's schools.json is ~17 MB; execFileSync's default buffer is 1 MB. */
const GIT_MAX_BUFFER = 512 * 1024 * 1024;
/** Publishes listed per request while looking for the newest one whose commit is in this repository. */
const PUBLISH_PAGE = 100;

/** A file's text at a commit (`git show <sha>:<path>`). Throws when the commit or file doesn't exist. */
export type ReadAt = (sha: string, path: string) => string;

/** The git operations publish-changes needs, so tests can stub them. */
export interface GitAccess {
  readAt: ReadAt;
  /** Whether a commit exists in this repository (`git cat-file -e`). */
  exists: (sha: string) => boolean;
  /** The full sha a ref names (`git rev-parse --verify`). Throws for an unknown ref. */
  resolve: (ref: string) => string;
}

/** The real thing, in the repository at `root`. */
export function gitAccess(root: string): GitAccess {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] });
  return {
    readAt: (sha, path) => git(["show", `${sha}:${path}`]),
    exists: (sha) => {
      try {
        git(["cat-file", "-e", `${sha}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    },
    resolve: (ref) => {
      try {
        return git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
      } catch {
        throw new Error(`${ref} is not a commit in this repository (with a shallow clone, fetch more history: fetch-depth: 0)`);
      }
    },
  };
}

/** The dataset at a commit: the colleges and meta to diff, and the release calendar that names a change's release. */
export interface DatasetAt extends DatasetSnapshot {
  calendar: ReleaseCalendar;
}

export function readDatasetAt(readAt: ReadAt, sha: string): DatasetAt {
  const read = <T,>(path: string): T => {
    let text: string;
    try {
      text = readAt(sha, path);
    } catch (err) {
      throw new Error(`reading ${path} at ${sha.slice(0, 12)}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
    return JSON.parse(text) as T;
  };
  return { schools: read<School[]>(DATASET_PATHS.schools), meta: read<DatasetMeta>(DATASET_PATHS.meta), calendar: read<ReleaseCalendar>(DATASET_PATHS.calendar) };
}

/**
 * The selectivity method a commit was built with: its `method`, null for an index from before the field, or
 * "missing" when the commit has no index at all.
 */
export function selectivityMethodAt(readAt: ReadAt, sha: string): string | null | "missing" {
  let text: string;
  try {
    text = readAt(sha, `${HISTORICAL_DATA_DIR}/selectivity-index.json`);
  } catch {
    return "missing";
  }
  return (JSON.parse(text) as { method?: string }).method ?? null;
}

/**
 * Why the tier fields are left out of a publish's changes, or null when they're announced: the method changed between
 * the two commits (a method change is ours, not the college's), or the earlier commit had no tiers at all (every tier
 * would read as new). A method unknown on one side (an index from before the field) counts as unchanged.
 */
export function suppressTiers(base: string | null | "missing", head: string | null | "missing"): string | null {
  if (head === "missing") return null;
  if (base === "missing") return "the earlier commit had no selectivity tiers";
  if (base && head && base !== head) return `the selectivity method changed (${base} → ${head})`;
  return null;
}

/** Every change between the previous dataset and the new one; none on a project's first publish. */
export function computeChanges(prev: DatasetSnapshot | null, next: DatasetSnapshot, calendar: Pick<ReleaseCalendar, "releases">, suppress: readonly FieldPath[] = []): DatasetChange[] {
  return prev ? diffSchools(prev, next, undefined, { calendar, suppress }) : [];
}

/**
 * The commit of the newest recorded publish that exists in this repository, or null when none does (the first
 * publish). Older rows may carry a commit from a branch that was never merged, or `<sha>+uncommitted` from a local
 * publish-data run; those are skipped, since the data they describe isn't in git.
 */
export async function newestPublishedCommit(client: Pick<SupabaseClient, "from">, exists: (sha: string) => boolean): Promise<string | null> {
  for (let from = 0; ; from += PUBLISH_PAGE) {
    const { data, error } = await client
      .from("dataset_publishes")
      .select("id, git_commit")
      .not("git_commit", "is", null)
      .order("id", { ascending: false })
      .range(from, from + PUBLISH_PAGE - 1);
    if (error) throw new Error(`reading dataset_publishes: ${error.message || error.code || "no error message"}`);
    const rows = (data ?? []) as { id: number; git_commit: string | null }[];
    for (const row of rows) {
      if (row.git_commit && /^[0-9a-f]{7,64}$/.test(row.git_commit) && exists(row.git_commit)) return row.git_commit;
    }
    if (rows.length < PUBLISH_PAGE) return null;
  }
}

/**
 * Whether the change tables exist: "ready", "missing" (the follows migrations aren't applied), or throws for anything
 * else (a dropped connection). A one-row select, never `head: true` (PostgREST answers HEAD on a missing table with a
 * bare 204).
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

/** Counts by kind: "1,204 changes (new_year 1,204 · revised 3 · appeared 12)". */
export function changeSummary(changes: readonly DatasetChange[]): string {
  if (!changes.length) return "no changes";
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return `${changes.length.toLocaleString("en-US")} changes (${[...counts].map(([k, n]) => `${k} ${n.toLocaleString("en-US")}`).join(" · ")})`;
}

/**
 * The change list, college by college, each line the sentence the panel and digest will show:
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

/** What publish_changes() returns. */
export interface PublishResult {
  publish_id: number;
  changes: number;
  reused: boolean;
}

export interface PublishChangesOptions {
  git: GitAccess;
  /** The deployed commit (a ref or sha). */
  head: string;
  /** The commit to diff from; omitted: the newest recorded publish that exists in the repository. */
  base?: string | null;
  dryRun: boolean;
  /** The secret-key client; null when Supabase isn't configured (only a dry run gets this far without one). */
  client: Pick<SupabaseClient, "from" | "rpc"> | null;
  publishedBy: string;
  log?: (line: string) => void;
  /** Colleges listed in a dry run's change list. */
  listLimit?: number;
}

export interface PublishChangesOutcome {
  head: string;
  base: string | null;
  changes: DatasetChange[];
  /** Null in a dry run. */
  result: PublishResult | null;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 12) : "none");

/**
 * Diff the dataset at `base` against `head`, print the summary, and (unless a dry run) stage the changes and record
 * the publish. Throws on any failure, naming the step.
 */
export async function publishChanges(opts: PublishChangesOptions): Promise<PublishChangesOutcome> {
  const { git, client, dryRun } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  if (!dryRun && !client) throw new Error("publishing needs SUPABASE_URL and SUPABASE_SECRET_KEY");

  const head = git.resolve(opts.head);
  let base: string | null;
  if (opts.base) {
    base = git.resolve(opts.base);
  } else if (client) {
    base = await newestPublishedCommit(client, git.exists);
  } else {
    base = null;
    log("No --base and no Supabase project to read the last publish from: diffing as a first publish.");
  }

  const next = readDatasetAt(git.readAt, head);
  const prev = base ? readDatasetAt(git.readAt, base) : null;
  const tiersSuppressed = base ? suppressTiers(selectivityMethodAt(git.readAt, base), selectivityMethodAt(git.readAt, head)) : null;
  if (tiersSuppressed) log(`Quad's selectivity tier changes aren't announced this time: ${tiersSuppressed}.`);
  const changes = computeChanges(prev, next, next.calendar, tiersSuppressed ? TIER_FIELDS : []);
  log(`${next.schools.length.toLocaleString("en-US")} colleges at ${short(head)} (retrieved ${next.meta.retrieved}).`);
  log(base ? `Changes since ${short(base)}: ${changeSummary(changes)}.` : `First publish (no earlier commit recorded): ${changeSummary(changes)}.`);

  if (dryRun) {
    for (const line of formatChangeList(changes, next.schools, { limit: opts.listLimit ?? 20 })) log(line);
    log("Nothing written (--dry-run).");
    return { head, base, changes, result: null };
  }

  const result = await recordPublish(client!, { changes, schoolCount: next.schools.length, retrieved: next.meta.retrieved, gitCommit: head, publishedBy: opts.publishedBy, log, label: short(head) });
  return { head, base, changes, result };
}

/**
 * Stages `changes` and records them as one publish with publish_changes() (one transaction), then reads the count back.
 * `gitCommit` names the publish (a commit sha, or the publisher's `snapshot:<id>`); a re-run with the same name is
 * "reused" and writes nothing. Shared by `publishChanges` and the snapshot publisher
 * (scripts/lib/data-platform/changelog.mts). Throws on any failure, naming the step.
 */
export async function recordPublish(
  db: Pick<SupabaseClient, "from" | "rpc">,
  opts: { changes: readonly DatasetChange[]; schoolCount: number; retrieved: string; gitCommit: string; publishedBy: string; log?: (line: string) => void; label?: string }
): Promise<PublishResult> {
  const { changes } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const label = opts.label ?? opts.gitCommit;
  if ((await changeTablesState(db)) === "missing") {
    throw new Error(`dataset_change_staging isn't on this project. Apply supabase/migrations/20261005140000_follows.sql, 20261005145000_change_old_source.sql and ${PUBLISH_CHANGES_MIGRATION}.`);
  }
  await stageChanges(db, changes);
  const { data, error } = await db.rpc("publish_changes", {
    p_school_count: opts.schoolCount,
    p_retrieved: opts.retrieved,
    p_git_commit: opts.gitCommit,
    p_published_by: opts.publishedBy,
    p_expected_changes: changes.length,
  });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    throw new Error(`publish_changes: ${error.message}${missing ? `. Apply ${PUBLISH_CHANGES_MIGRATION} first.` : ""}`);
  }
  const result = data as PublishResult;
  if (result.reused) {
    log(`reused: ${label} was already recorded as publish ${result.publish_id} (${result.changes} changes); nothing written.`);
    return result;
  }

  // Read the count back: what the panel and digest will see.
  const { count, error: cError } = await db.from("dataset_changes").select("id", { count: "exact" }).eq("publish_id", result.publish_id).limit(1);
  if (cError || count !== changes.length) {
    throw new Error(`dataset_changes for publish ${result.publish_id}: read back ${count ?? "?"} rows, expected ${changes.length}${cError ? ` (${cError.message})` : ""}.`);
  }
  log(`Recorded ${changeSummary(changes)} as publish ${result.publish_id} for ${label}; read back and verified.`);
  return result;
}
