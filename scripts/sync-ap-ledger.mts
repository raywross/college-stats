/**
 * Fetch College Board's AP Course Ledger into the high-school layers' `ledger/{XX}.json` (`high_schools.ledger`), then
 * (with --merge) match it to the high school shards (`ap_ledger` on each row). specs/product/high-school-data.md "AP Course Ledger";
 * scripts/lib/high-schools/ledger-fetch.mts (the client) and ledger.mts (the adapter).
 *
 *   npm run sync-ap-ledger -- --state TX                 # one state (about 2,500 schools; 20 minutes)
 *   npm run sync-ap-ledger -- --state TX,CA --limit 50   # a trial: 50 new schools per state
 *   npm run sync-ap-ledger -- --all --merge              # every state, then the shards (several hours; resumable)
 *   npm run sync-ap-ledger -- --merge                    # only the merge, from the files already fetched
 *
 * Flags: --concurrency 2, --delay 800 (ms per worker between requests; the site allows 124 requests a minute and
 * the client waits out a 429), --refresh (refetch schools already in a
 * file), --store supabase|file:<dir> (default supabase when DATA_SUPABASE_URL is set), --change-set <id>, or --dir
 * <folder> (a high-schools folder on disk instead of the store). With the store, the run works on a scratch copy of
 * the layers (scripts/lib/high-schools/data-store.mts) and writes back only what changed, in one change set (source
 * high-schools); the publisher loads the tables when the layer changed. A rerun fetches only schools not yet in the
 * file for the Ledger's current year, so an interrupted run picks up where it stopped.
 */
import { join, resolve } from "node:path";
import { HS_STATES } from "../lib/high-school-core.ts";
import { onHighSchoolFolder, writeHighSchoolChanges } from "./lib/high-schools/data-store.mts";
import { changeSetFromArgv, openProducerRun, storeFromArgv } from "./lib/data-platform/producer.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { ADAPTERS } from "./lib/high-schools/index.mts";
import { currentLedgerYear, fetchLedgerState, ledgerYearLabel, openLedgerSession } from "./lib/high-schools/ledger-fetch.mts";
import { SyncError, runHighSchoolSync } from "./lib/high-schools/sync.mts";

const ROOT = join(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flags = parseFlags(argv);
const num = (k: string, d: number) => (typeof flags[k] === "string" && Number.isFinite(Number(flags[k])) ? Number(flags[k]) : d);

const states = flags.all === true ? [...HS_STATES] : typeof flags.state === "string" ? flags.state.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
if (!states.length && flags.merge !== true) {
  console.error("Usage: npm run sync-ap-ledger -- --state <XX>[,<XX>] | --all [--limit N] [--merge]   |   --merge");
  process.exit(1);
}
const bad = states.filter((s) => !HS_STATES.includes(s));
if (bad.length) {
  console.error(`Unknown state(s): ${bad.join(", ")}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
let failed = false;

async function run(outDir: string): Promise<void> {
  if (states.length) {
    const session = await openLedgerSession();
    const year = currentLedgerYear(session.years);
    console.log(`AP Course Ledger: current year ${ledgerYearLabel(year)}; ${states.length} state(s) → ${outDir}/ledger/`);
    for (const state of states) {
      try {
        const r = await fetchLedgerState({
          state,
          outDir,
          session,
          today,
          log: (m) => console.log(m),
          limit: typeof flags.limit === "string" ? Number(flags.limit) : undefined,
          concurrency: num("concurrency", 2),
          delayMs: num("delay", 800),
          refresh: flags.refresh === true,
        });
        const withCourses = r.file.schools.filter((s) => s.courses.length + s.other.length > 0).length;
        console.log(`${state}: ${r.file.schools.length} schools (${withCourses} with an AP course); fetched ${r.fetched}, kept ${r.kept}, failed ${r.failed}${r.file.complete ? "" : "; incomplete"}`);
        if (r.failed) failed = true;
      } catch (err) {
        failed = true;
        console.error(`${state}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (flags.merge === true) {
    try {
      const res = await runHighSchoolSync({ root: ROOT, outDir, adapters: ADAPTERS, only: ["ap-ledger"], offline: true, flags, dryRun: flags["dry-run"] === true });
      for (const n of res.notes) console.log(n);
      for (const r of res.report) if (!r.skipped) console.log(`${r.key}: ${r.updated} rows updated, ${r.unmatched} unmatched patches`);
      console.log(res.written ? `Shards, meta.json, and medians.json written to ${outDir}.` : "Dry run; nothing written.");
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : String(err));
      if (err instanceof SyncError) for (const p of err.problems.slice(0, 30)) console.error(`  ${p}`);
    }
  }

}

if (typeof flags.dir === "string") await run(resolve(process.cwd(), flags.dir));
else {
  const store = storeFromArgv(argv);
  const ran = await onHighSchoolFolder(store, run);
  if (flags["dry-run"] !== true) {
    const producer = await openProducerRun(store, "high-schools", { changeSet: changeSetFromArgv(argv) });
    const changed = await writeHighSchoolChanges(producer.handle, ran.before, ran.after);
    await producer.finish(failed ? "held" : "applied", failed ? "sync-ap-ledger: a state failed; the results so far wait for a look" : undefined, { documents_sent: changed.sent, documents_removed: changed.removed });
    console.log(`high_schools layers: change set ${producer.handle.id}, ${changed.sent} documents sent, ${changed.removed} removed`);
  }
}

process.exit(failed ? 1 : 0);
