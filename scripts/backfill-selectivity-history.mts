/**
 * The selectivity history's first fill (specs/chances/selectivity-history.md, Decision 5): walks every commit that
 * changed data/selectivity-index.json, oldest first, and records each as if it had been a publish, with
 * cause = 'backfill' and the commit's own date. Commits already recorded are skipped, so it is safe to re-run.
 *
 *   npm run backfill-selectivity-history              # against SUPABASE_URL (.env.local or the environment)
 *   npm run backfill-selectivity-history -- --dry-run # print what it would record
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { supabaseClient } from "../lib/supabase.ts";
import { gitAccess } from "./lib/publish-changes.mts";
import { advance, backfillMethodFor, describeRows, historyRows, historyRun, readRecorded, recordRun, selectivityAt, type CollegeState, type HistoryClient } from "./lib/selectivity-history.mts";

const ROOT = join(import.meta.dirname, "..");
const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const dryRun = values["dry-run"] || !configured;

const log = execFileSync("git", ["log", "--reverse", "--format=%H %cI", "--", "data/selectivity-index.json"], { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [sha, at] = l.split(" ");
    return { sha, at };
  });

try {
  const git = gitAccess(ROOT);
  const client = configured ? (supabaseClient("publish") as unknown as HistoryClient) : null;
  const recorded = client ? await readRecorded(client) : { prev: new Map<string, CollegeState>(), lastMethod: null as string | null, commits: new Set<string>() };
  let prev = recorded.prev;
  let lastMethod = recorded.lastMethod;
  console.log(`backfill: ${log.length} commits changed data/selectivity-index.json${dryRun ? " (dry run)" : ""}`);
  for (const { sha, at } of log) {
    if (recorded.commits.has(sha)) {
      console.log(`${sha.slice(0, 12)} already recorded; skipped`);
      continue;
    }
    const sel = selectivityAt(git.readAt, sha, backfillMethodFor);
    const rows = historyRows(prev, sel, { lastMethod, backfill: true });
    const run = historyRun(sel, { gitCommit: sha, publishedAt: at, lastMethod, backfill: true });
    console.log(`${sha.slice(0, 12)} ${at.slice(0, 10)} method ${sel.method}:`);
    for (const line of describeRows(rows, new Map(sel.schools.map((s) => [s.unit_id, s.name])), 3)) console.log(`  ${line}`);
    if (!dryRun) {
      const id = await recordRun(client!, run, rows);
      console.log(`  ${rows.length === 0 ? "nothing changed; not recorded" : id === null ? "already recorded" : `recorded run ${id}`}`);
    }
    prev = advance(prev, rows);
    lastMethod = sel.method;
  }
} catch (err) {
  console.error(`Backfill failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
