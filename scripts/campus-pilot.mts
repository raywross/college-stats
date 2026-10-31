/**
 * The campus-life pilot (specs/religious-life.md phase 2, greek-life.md phase 2, lgbtq-life.md phase 4): per-college
 * discovery (free probes, then one paid call), extraction, quote and support checks, and the second-model check, then
 * the facts to publish. Round 2 (specs/college-reported-data.md "Round 2 plan").
 *
 *   npm run campus-pilot                       # the colleges in data/reference/campus-pilot-3-colleges.json
 *   npm run campus-pilot -- --colleges-file data/reference/x.json   # another list ({ colleges: [{ unit_id }] })
 *   npm run campus-pilot -- --college 228778   # one college (repeatable; overrides the list)
 *   npm run campus-pilot -- --rediscover       # ignore saved links and run discovery again
 *   npm run campus-pilot -- --cap 15           # spend cap in dollars across every pilot run (default 15)
 *   npm run campus-pilot -- --no-batch         # make extraction and second-check calls directly (default: Message Batches)
 *   npm run campus-pilot -- --store file:<dir> # the store (default: supabase when DATA_SUPABASE_URL is set)
 *   npm run campus-pilot -- --change-set 42    # write into the workflow's open change set (it closes the set)
 *   npm run campus-pilot -- --apply            # close its own change set applied (default: held for review)
 *
 * A run only changes the colleges it reads: every other college's published facts and recipe are kept as they were
 * (files.mts mergeRun).
 *
 * Needs ANTHROPIC_API_KEY (.env.local). Reads the colleges and its own prior state from the data store and writes, in
 * one change set (source `campus-pilot`): `campus.sources` (links and page hashes per college), `campus.pages`
 * (published facts), the report `campus-pilot-<run>.json` in `reported.reports` (everything: raw extractions, dropped
 * facts with reasons, second checks, per-call usage), and refusals to `directories.blocked`. A pilot's results are
 * reviewed before they go live, so its own change set closes `held` ("Publish anyway" in the console puts it live)
 * unless `--apply`; the publisher composes the facts into the dataset.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { directoryHttp } from "./lib/directories/context.mts";
import { Budget, PILOT_MODELS, type CollegeRef, type Ctx } from "./lib/campus-pilot/llm.mts";
import { PageFetcher, httpLogHook } from "./lib/campus-pilot/pages.mts";
import { runCollege, type CampusRecipe, type CollegeResult } from "./lib/campus-pilot/run.mts";
import { DEFAULT_COLLEGES_FILE } from "./lib/campus-pilot/files.mts";
import { readCollegeListFrom, readSourcesDoc, reportKey, saveCampusRun } from "./lib/campus-pilot/store.mts";
import { BatchCaller, directCaller, type PilotBatchApi } from "./lib/campus-pilot/batch.mts";
import { storeFromFlag } from "./lib/data-platform/store.mts";
import { changeSetFlag, withRunSet } from "./lib/data-platform/change-set.mts";
import { storeColleges } from "./lib/identity-store.mts";

const ROOT = join(import.meta.dirname, "..");
const CACHE = join(ROOT, ".cache", "campus-pages");
const LEDGER = join(CACHE, "spent.json");
const batch = !process.argv.includes("--no-batch");
// Batched calls wait for each other, so every college runs at once (requests to one host are still paced by robots).
const CONCURRENCY = batch ? 25 : 4;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const cap = Number(values("cap")[0] ?? 15);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env.local)");
  const today = new Date().toISOString().slice(0, 10);
  const run = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const store = storeFromFlag(values("store")[0]);
  const schools = await storeColleges(store);
  const listFile = values("colleges-file")[0] ?? DEFAULT_COLLEGES_FILE;
  const ids = values("college").length ? values("college") : await readCollegeListFrom(store, listFile, ROOT);
  const colleges = ids.map((id) => {
    const s = schools.find((x) => x.unit_id === id);
    if (!s) throw new Error(`no college ${id} in the store (base.colleges)`);
    return s;
  });

  const sourcesFile = await readSourcesDoc(store, today);
  const recipes = new Map(sourcesFile.recipes.map((r) => [r.unit_id, r]));
  const runRecipes: CampusRecipe[] = [];
  const ledger: { spent: number } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { spent: 0 };
  const budget = new Budget(cap);
  budget.spent = ledger.spent;
  console.log(`campus-pilot ${run}: ${colleges.length} colleges${values("college").length ? "" : ` from ${listFile}`}; spent so far $${ledger.spent.toFixed(2)} of $${cap}; ${batch ? "Message Batches" : "direct calls"}`);

  const client = new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 });
  const batcher = batch ? new BatchCaller(client.messages.batches as unknown as PilotBatchApi, directCaller(client), { deadlineMs: 20 * 60_000, log: (m) => console.log(m) }) : null;
  const ctx: Ctx = { client, budget, ...(batcher ? { caller: batcher } : {}) };
  const deadHosts = new Set<string>();
  const http = directoryHttp({ log: httpLogHook(deadHosts, (m) => console.log(m)) });
  const fetcher = new PageFetcher(http, CACHE, today, deadHosts);
  const results: CollegeResult[] = [];

  const queue = [...colleges];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (budget.spent >= budget.cap) break;
      const ref: CollegeRef = {
        unit_id: s.unit_id,
        name: s.name,
        city: s.location.city,
        state: s.location.state,
        website: s.links?.website ?? null,
        affiliation: s.religion?.affiliation?.label ?? null,
        single_sex: !!s.campus?.msi?.some((m) => m === "women" || m === "men"),
      };
      const before = budget.spent;
      const { result, recipe } = await runCollege(ctx, fetcher, ref, { today, recipe: flag("rediscover") ? undefined : recipes.get(s.unit_id), log: (m) => console.log(m) });
      runRecipes.push(recipe);
      results.push(result);
      const n = (x: unknown) => (x ? 1 : 0);
      console.log(
        `  ${s.name}: $${(budget.spent - before).toFixed(3)}; greek ${n(result.greek)} faith ${n(result.faith)} lgbtq ${result.lgbtq?.policies?.length ?? 0} policies, ${result.listings.length} listings; ${result.dropped.length} dropped, ${result.checks.length} checks${result.stopped ? `; STOPPED: ${result.stopped}` : ""}`
      );
      writeFileSync(LEDGER, JSON.stringify({ spent: budget.spent }));
    }
  };
  mkdirSync(CACHE, { recursive: true });
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Recipes and published facts: only this run's colleges change; every other college's entries are kept as they were.
  const spentRun = Math.round((budget.spent - ledger.spent) * 1e6) / 1e6;
  const report = { run, today, models: PILOT_MODELS, cap, spent_total: budget.spent, spent_run: spentRun, requests: fetcher.requests, blocked: fetcher.blocked, batches: batcher?.sent ?? [], discovery: Object.fromEntries(runRecipes.map((r) => [r.unit_id, r.discovery ?? null])), calls: budget.rows, results };
  const apply = flag("apply");
  await withRunSet(
    store,
    {
      source: "campus-pilot",
      changeSet: changeSetFlag(args),
      close: () =>
        apply
          ? { status: "applied", summary: { cost_usd: spentRun } }
          : { status: "held", reason: `Campus-life pilot run ${run}: review the facts before they go live`, summary: { cost_usd: spentRun } },
    },
    (handle) => saveCampusRun(store, handle, { results, recipes: runRecipes, blocked: fetcher.blocked, report: { run, body: report }, today })
  );
  console.log(`done: $${budget.spent.toFixed(2)} spent in all; report ${reportKey(run)} in reported.reports`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
