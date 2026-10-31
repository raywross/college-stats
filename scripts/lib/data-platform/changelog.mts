/**
 * The change log and tier history from snapshots (specs/data-platform/publish.md "The change log and tier history"):
 * what `npm run publish-changes` and `npm run publish-selectivity-history` did with two git commits, done with the
 * previous snapshot and the new one. Both call those scripts' library code (scripts/lib/publish-changes.mts
 * `computeChanges`/`recordPublish`, scripts/lib/selectivity-history.mts `historyRows`/`historyRun`/`recordRun`), and
 * each names the publish `snapshot:<id>` in place of a commit, so a re-run for a recorded snapshot writes nothing
 * (publish_changes reuses a recorded `git_commit`; record_selectivity_run skips one). A point-back never calls these.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReleaseCalendar } from "../../../lib/releases.ts";
import { TIER_FIELDS, type DatasetChange, type DatasetSnapshot } from "../../../lib/changes.ts";
import { SELECTIVITY_METHOD } from "../../../lib/selectivity.ts";
import { changeSummary, computeChanges, recordPublish, type PublishResult } from "../publish-changes.mts";
import { historyRows, historyRun, readRecorded, recordRun, type CollegeState, type HistoryClient, type SelectivityAt } from "../selectivity-history.mts";
import type { SelectivityIndexFile } from "../selectivity.mts";

/** The name a snapshot's publish is recorded under (`dataset_publishes.git_commit`, `selectivity_publishes.git_commit`). */
export const snapshotCommit = (snapshotId: number) => `snapshot:${snapshotId}`;

/** The last recorded tier history (readRecorded's answer), read once per publish for both steps. */
export interface RecordedTiers {
  prev: Map<string, CollegeState>;
  lastMethod: string | null;
  commits: Set<string>;
}

/**
 * Why the tier fields are left out of this publish's changes, or null: the selectivity method changed since the last
 * recorded run (a method change is ours, not the college's). The git version compared two commits' index files; a
 * snapshot doesn't publish its index, so the recorded history stands in for the earlier one.
 */
export function tierSuppression(lastMethod: string | null, method: string = SELECTIVITY_METHOD): string | null {
  return lastMethod && lastMethod !== method ? `the selectivity method changed (${lastMethod} → ${method})` : null;
}

export interface RecordChangesOptions {
  publishedBy: string;
  /** From `tierSuppression`. */
  suppressTiers?: string | null;
  log?: (line: string) => void;
}

/**
 * Diffs the previous snapshot's colleges against the new ones (with the new release calendar naming each change's
 * release) and records them as one publish named `snapshot:<id>`. No previous snapshot: a first publish, no changes.
 */
export async function recordChanges(
  client: Pick<SupabaseClient, "from" | "rpc">,
  previous: DatasetSnapshot | null,
  next: DatasetSnapshot,
  calendar: Pick<ReleaseCalendar, "releases">,
  snapshotId: number,
  opts: RecordChangesOptions
): Promise<{ changes: DatasetChange[]; result: PublishResult }> {
  const log = opts.log ?? ((line: string) => console.log(line));
  if (opts.suppressTiers) log(`Quad's selectivity tier changes aren't announced this time: ${opts.suppressTiers}.`);
  const changes = computeChanges(previous, next, calendar, opts.suppressTiers ? TIER_FIELDS : []);
  log(previous ? `Changes since the previous snapshot: ${changeSummary(changes)}.` : `First snapshot: ${changeSummary(changes)}.`);
  const result = await recordPublish(client, {
    changes,
    schoolCount: next.schools.length,
    retrieved: next.meta.retrieved,
    gitCommit: snapshotCommit(snapshotId),
    publishedBy: opts.publishedBy,
    log,
  });
  return { changes, result };
}

/**
 * Records the tiers of the new snapshot against the last recorded rows (record_selectivity_run), linked to the
 * change-log publish. Null when the snapshot was already recorded or no college's selectivity changed.
 */
export async function recordTiers(
  client: HistoryClient,
  next: { schools: SelectivityAt["schools"]; meta: SelectivityAt["meta"]; index: SelectivityIndexFile },
  snapshotId: number,
  opts: { publishId: number | null; recorded?: RecordedTiers; publishedAt?: string; log?: (line: string) => void }
): Promise<{ id: number | null; rows: number }> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const recorded = opts.recorded ?? (await readRecorded(client));
  const commit = snapshotCommit(snapshotId);
  if (recorded.commits.has(commit)) {
    log(`selectivity history: ${commit} is already recorded; nothing written.`);
    return { id: null, rows: 0 };
  }
  const at: SelectivityAt = { index: next.index, schools: next.schools, meta: next.meta, method: next.index.method ?? SELECTIVITY_METHOD };
  const rows = historyRows(recorded.prev, at, { lastMethod: recorded.lastMethod });
  const run = historyRun(at, { gitCommit: commit, publishedAt: opts.publishedAt ?? new Date().toISOString(), lastMethod: recorded.lastMethod, publishId: opts.publishId });
  if (!rows.length) {
    log("selectivity history: no college's selectivity changed; nothing recorded");
    return { id: null, rows: 0 };
  }
  const id = await recordRun(client, run, rows);
  log(id === null ? "selectivity history: already recorded; nothing written" : `selectivity history: recorded run ${id} (${rows.length} rows)`);
  return { id, rows: rows.length };
}
