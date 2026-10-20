/**
 * Rebuilds Quad's selectivity history from git (specs/chances/selectivity-history.md, "As changed 2026-10-20"): for
 * every recorded publish, oldest first, reads that commit's index and colleges and records only the colleges whose
 * selectivity changed since the previous publish, one row each with all three pools. Each publish keeps its date,
 * method, and cause; a publish that changed no college is removed. Run once after
 * 20261020120000_selectivity_history_one_row.sql, which replaced the table. Safe to re-run: it clears the rows and
 * replays them.
 *
 *   npm run rebuild-selectivity-history              # against SUPABASE_URL (.env.local or the environment)
 *   npm run rebuild-selectivity-history -- --dry-run # print what it would record
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { supabaseClient } from "../lib/supabase.ts";
import { gitAccess } from "./lib/publish-changes.mts";
import { advance, backfillMethodFor, describeRows, historyRows, selectivityAt, type CollegeState, type HistoryRow } from "./lib/selectivity-history.mts";

const ROOT = join(import.meta.dirname, "..");
const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are needed (the rebuild reads the recorded publishes).");
  process.exit(1);
}
const dryRun = values["dry-run"];

type Run = { id: number; git_commit: string; published_at: string; method: string; cause: "data" | "method" | "backfill" };
type Writes = PromiseLike<{ error: { message: string } | null }>;
interface Client {
  from(table: string): {
    select(cols: string): { order(col: string, o: { ascending: boolean }): { order(col: string, o: { ascending: boolean }): PromiseLike<{ data: Run[] | null; error: { message: string } | null }> } };
    delete(): { gte(col: string, v: number): Writes; eq(col: string, v: number): Writes };
    insert(rows: unknown[]): Writes;
    update(v: Record<string, unknown>): { eq(col: string, v: number): Writes };
  };
}
const must = async (what: string, p: Writes) => {
  const { error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
};

try {
  const client = supabaseClient("publish") as unknown as Client;
  const git = gitAccess(ROOT);
  const { data, error } = await client.from("selectivity_publishes").select("id, git_commit, published_at, method, cause").order("published_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`reading selectivity_publishes: ${error.message}`);
  const runs = data ?? [];
  console.log(`rebuild: ${runs.length} recorded publishes${dryRun ? " (dry run)" : ""}`);

  // Compute every run first, so a commit git can't read stops the rebuild before anything is cleared.
  let prev = new Map<string, CollegeState>();
  let lastMethod: string | null = null;
  const plan: { run: Run; rows: HistoryRow[] }[] = [];
  for (const run of runs) {
    const sel = { ...selectivityAt(git.readAt, run.git_commit, backfillMethodFor), method: run.method };
    const rows = historyRows(prev, sel, { lastMethod, backfill: run.cause === "backfill" });
    // A method run is a method run whatever the replay says: its rows read as the method, not the college.
    if (run.cause === "method") for (const r of rows) r.cause = "method";
    plan.push({ run, rows });
    console.log(`${run.published_at.slice(0, 16)} ${run.git_commit.slice(0, 10)} ${run.cause}: ${describeRows(rows, new Map(sel.schools.map((s) => [s.unit_id, s.name])), 0)[0]}`);
    prev = advance(prev, rows);
    lastMethod = run.method;
  }
  if (dryRun) {
    console.log(`(dry run) would keep ${plan.filter((p) => p.rows.length).length} publishes, ${plan.reduce((n, p) => n + p.rows.length, 0)} rows`);
    process.exit(0);
  }

  await must("clearing selectivity_history", client.from("selectivity_history").delete().gte("id", 0));
  for (const { run, rows } of plan) {
    if (!rows.length) {
      await must(`removing publish ${run.id}`, client.from("selectivity_publishes").delete().eq("id", run.id));
      continue;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({ ...r, run_id: run.id, published_at: run.published_at }));
      await must(`writing publish ${run.id}'s rows`, client.from("selectivity_history").insert(batch));
    }
    await must(`counting publish ${run.id}'s rows`, client.from("selectivity_publishes").update({ rows_recorded: rows.length }).eq("id", run.id));
  }
  console.log(`rebuilt: ${plan.filter((p) => p.rows.length).length} publishes, ${plan.reduce((n, p) => n + p.rows.length, 0)} rows; ${plan.filter((p) => !p.rows.length).length} publishes that changed nothing removed`);
} catch (err) {
  console.error(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
