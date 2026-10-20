/**
 * Records Quad's selectivity for a deployed commit (specs/chances/selectivity-history.md): compares the commit's
 * data/selectivity-index.json and data/schools.json with the last recorded rows and writes the rows that changed
 * (scripts/lib/selectivity-history.mts) with record_selectivity_run(), one transaction. A publish that changes no
 * college records nothing, not even its run; re-running for a recorded commit writes nothing. The "Publish changes" workflow runs it after publish-changes.
 *
 *   npm run publish-selectivity-history                       # HEAD
 *   npm run publish-selectivity-history -- --head <sha>       # the deployed commit
 *   npm run publish-selectivity-history -- --dry-run          # print what it would write
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (environment variables win over .env.local). Without them it prints
 * what it would write against an empty history and exits 0.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { supabaseClient } from "../lib/supabase.ts";
import { gitAccess } from "./lib/publish-changes.mts";
import { describeRows, historyRows, historyRun, readRecorded, recordRun, selectivityAt, type HistoryClient } from "./lib/selectivity-history.mts";

const ROOT = join(import.meta.dirname, "..");
const { values } = parseArgs({ options: { head: { type: "string", default: "HEAD" }, "dry-run": { type: "boolean", default: false } } });
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const dryRun = values["dry-run"] || !configured;
if (!configured) console.log("SUPABASE_URL or SUPABASE_SECRET_KEY is not set; printing what would be recorded against an empty history.");

try {
  const git = gitAccess(ROOT);
  const sha = git.resolve(values.head);
  let at;
  try {
    at = selectivityAt(git.readAt, sha);
  } catch (err) {
    // A commit from before the index carried its method (or without the index) has nothing this can compare honestly.
    console.log(`::notice::Selectivity history skipped for ${sha.slice(0, 12)}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(0);
  }
  const client = configured ? (supabaseClient("publish") as unknown as HistoryClient) : null;
  const recorded = client ? await readRecorded(client) : { prev: new Map(), lastMethod: null, commits: new Set<string>() };
  if (recorded.commits.has(sha)) {
    console.log(`selectivity history: ${sha.slice(0, 12)} is already recorded; nothing written.`);
    process.exit(0);
  }
  // The dataset publish this deploy recorded, if publish-changes ran first.
  let publishId: number | null = null;
  if (client) {
    const { data } = await client.from("dataset_publishes").select("id").eq("git_commit", sha).limit(1);
    publishId = ((data ?? []) as { id: number }[])[0]?.id ?? null;
  }
  const rows = historyRows(recorded.prev, at, { lastMethod: recorded.lastMethod });
  const run = historyRun(at, { gitCommit: sha, publishedAt: new Date().toISOString(), lastMethod: recorded.lastMethod, publishId });
  const names = new Map(at.schools.map((s) => [s.unit_id, s.name]));
  console.log(`selectivity history for ${sha.slice(0, 12)} (method ${run.method}, ${run.cause}):`);
  for (const line of describeRows(rows, names)) console.log(line);
  if (dryRun) {
    console.log("(dry run, nothing written)");
  } else if (!rows.length) {
    console.log("no college's selectivity changed; nothing recorded");
  } else {
    const id = await recordRun(client!, run, rows);
    console.log(id === null ? "already recorded; nothing written" : `recorded run ${id}`);
  }
} catch (err) {
  console.error(`Selectivity history failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
