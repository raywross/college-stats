/**
 * Reads the newest figures colleges published themselves (Common Data Sets, class profiles), checks every item, and
 * publishes what passes: the round-3 pipeline (specs/college-reported-round-3.md; how to run it:
 * specs/college-reported-setup.md). Every document is fetched once, archived, and read once per schema version.
 *
 *   npm run sync-college-reported -- --pilot                       # the pilot set (reference.files college-reported-pilot)
 *   npm run sync-college-reported -- --college 166027 --college 190150
 *   npm run sync-college-reported -- --all                         # scheduled mode: every college
 *   npm run sync-college-reported -- --sample 60 --tiers less,open # a stratified random sample of those tiers
 *   npm run sync-college-reported -- --pilot --rediscover          # every college climbs the ladder from step 0
 *   npm run sync-college-reported -- --phase collect --run <id>    # collect a run's open batches (the collect job)
 *   npm run sync-college-reported -- --all --reextract --call C    # after a schema bump: archive only, no fetch
 *   npm run sync-college-reported -- --print-open-run              # the run of the oldest open batch, or nothing
 *
 *     --phase prepare|discover|submit|collect|all   default all (prepare → guard → discover → submit → collect)
 *     --tiers very,selective,less,open   only colleges in these admit-rate tiers (with --all or --sample: from all)
 *     --sample N            a stratified random sample of N colleges (seeded by the run id)
 *     --max-cost <usd>      the run's cap: the projection guard, batch reservations, the discovery budget. Default 25,
 *                           150 for --all
 *     --max-discoveries N   colleges sent to the paid discovery steps, default 100
 *     --archive-prior       also archive the older editions an index page links (off; nothing reads them yet)
 *     --open-admission-search  open-admission colleges get step 3 when money is left (off: steps 0–2 only)
 *     --poll-minutes N      wait this long for batches when COLLEGE_REPORTED_POLL_UNTIL isn't set (default 90 for
 *                           --phase all, 0 for collect: check each batch once)
 *     --store supabase|file:<dir>   where the state lives (default supabase when DATA_SUPABASE_URL is set)
 *     --rediscover --dry-run --run <id>
 *
 * Needs ANTHROPIC_API_KEY (from .env.local or the environment) unless the phase is prepare. The state is the
 * `reported.*` layers on the data store (scripts/lib/college-reported/state.mts; specs/data-platform/pipelines.md):
 * one change set per run (kind pipeline, source college-reported, run_ref the run id), written after every college
 * and every collected batch, so a cancelled run keeps what it finished. A later phase of the same run (the collect
 * job) writes into the set it finds open with that run_ref, or opens a new one with it. Before it closes, the run
 * derives `reported.failures` and `health.colleges` from its state into the same set. The set closes `held` when the
 * circuit breaker tripped (exit 2), the run stopped early (exit 3), or it failed (exit 1); `applied` when it finished
 * with no batch open; and stays open while batches are open (the collect job closes it). The summary (counts, cost,
 * the PR-body text of scripts/college-reported-pr-body.mts) is the change set's `summary`. The colleges are the served
 * dataset (`.data/snapshot/colleges.json`, else data/schools.json); nothing under data/ is written. With
 * GITHUB_OUTPUT set, writes `change_set`, `status` (open | applied | held) and `open_batches` to it.
 *
 * Exit codes: 0 = done (batches may still be open: the change set stays open for the collect job); 2 = the circuit
 * breaker tripped (state written; the set is held); 3 = stopped early (the projection exceeds the cap, the spend
 * limit, credit balance, or key refused; or cancelled), the state holds everything finished; 1 = error.
 */
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { CallKey } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { restoreFederal } from "../lib/newest.ts";
import { UnpricedModelError, assertPriced, summaryCost, type ModelClient } from "./lib/college-reported/models.mts";
import { readJsonFile } from "./lib/college-reported/pipeline.mts";
import { createRound3, PHASES, type Phase } from "./lib/college-reported/phases.mts";
import { createArchive } from "./lib/college-reported/archive.mts";
import { parseTiers, pickPilot, sampleByTier, tierOf, type PilotFile } from "./lib/college-reported/pilot.mts";
import { REFERENCE_KEYS, oldestOpenRun, openReportedRun, readColleges } from "./lib/college-reported/state.mts";
import { COLLECTIONS } from "./lib/data-platform/layers.mts";
import { flagValue, storeFromFlag, type DataStore } from "./lib/data-platform/store.mts";

const ROOT = join(import.meta.dirname, "..");
const PILOT = join(ROOT, "data", "reference", "college-reported-pilot.json");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

const PILOT_MODE = flag("pilot");
const ALL = flag("all");
const COLLEGES = values("college");
const TIERS = values("tiers")[0];
const SAMPLE = values("sample")[0];
const PHASE = (values("phase")[0] ?? "all") as Phase;
const REEXTRACT = flag("reextract");
const CALL = values("call")[0] as CallKey | undefined;
const DRY = flag("dry-run");
const REDISCOVER = flag("rediscover");
const PRINT_OPEN_RUN = flag("print-open-run");
const MAX_DISCOVERIES = Number(values("max-discoveries")[0] ?? 100);
const RUN = values("run")[0] ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
const MAX_COST = Number(values("max-cost")[0] ?? (ALL ? 150 : 25));
const POLL_MINUTES = Number(values("poll-minutes")[0] ?? (PHASE === "all" ? 90 : 0));
/** Exit code for a run that ended early: the state holds everything it finished. */
const STOPPED = 3;

function usage(msg: string): never {
  console.error(
    `${msg}\nUsage: npm run sync-college-reported -- (--pilot | --all | --college <unit_id> ... | --tiers <list> | --sample N [--tiers <list>]) ` +
      `[--phase prepare|discover|submit|collect|all] [--reextract --call C|rest] [--rediscover] [--dry-run] [--max-discoveries N] ` +
      `[--max-cost <usd>] [--archive-prior] [--open-admission-search] [--poll-minutes N] [--run <id>] [--store supabase|file:<dir>] [--print-open-run]`
  );
  process.exit(1);
}

/** One `key=value` line for the workflow's step outputs (only when GITHUB_OUTPUT names a file). */
function output(key: string, value: string | number) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

/** The pilot set: the store's reference document, else the committed file, else picked from the colleges. */
async function readPilot(store: DataStore, schools: School[]): Promise<PilotFile> {
  const fromStore = await store.readOne<PilotFile>(COLLECTIONS.reference.files, REFERENCE_KEYS.pilot);
  if (fromStore) return fromStore;
  if (existsSync(PILOT)) return readJsonFile<PilotFile>(PILOT);
  const pilot = pickPilot(schools);
  console.log(`No pilot list on the store or in ${PILOT}; picked ${pilot.colleges.length} colleges deterministically across admit-rate tiers and sectors.`);
  return pilot;
}

async function main() {
  if (!PHASES.includes(PHASE)) usage(`--phase must be one of ${PHASES.join(", ")}.`);
  const selecting = PILOT_MODE || ALL || COLLEGES.length || TIERS || SAMPLE;
  if (!PRINT_OPEN_RUN && !selecting && PHASE !== "collect") usage("Pick which colleges to process.");
  if (REEXTRACT && CALL !== "C" && CALL !== "rest") usage("--reextract needs --call C or --call rest.");
  if (!REEXTRACT && CALL) usage("--call goes with --reextract.");
  if (!Number.isInteger(MAX_DISCOVERIES) || MAX_DISCOVERIES < 0) usage("--max-discoveries needs a whole number.");
  if (!Number.isFinite(MAX_COST) || MAX_COST <= 0) usage("--max-cost needs a dollar amount above 0.");
  if (!Number.isFinite(POLL_MINUTES) || POLL_MINUTES < 0) usage("--poll-minutes needs a number of minutes.");
  if (SAMPLE && !(Number.isInteger(Number(SAMPLE)) && Number(SAMPLE) > 0)) usage("--sample needs a whole number above 0.");
  let store: DataStore;
  try {
    store = storeFromFlag(flagValue(argv, "--store"));
  } catch (err) {
    usage((err as Error).message);
  }
  if (PRINT_OPEN_RUN) {
    console.log((await oldestOpenRun(store)) ?? "");
    return;
  }
  // Every configured model must have a price, or the cost cap goes blind (specs/college-reported-round-3.md, test 20).
  try {
    assertPriced();
  } catch (err) {
    if (err instanceof UnpricedModelError) usage(err.message);
    throw err;
  }
  if (PHASE !== "prepare" && !process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (add it to .env.local).");

  // The checks compare against the federal (or hand-imported CDS) baseline, not the newer college-reported values a
  // previous run already put into admissions.* (lib/newest.ts), so undo those first.
  const served = readColleges(ROOT);
  const schools = served.map(restoreFederal);
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  let tiers: ReturnType<typeof parseTiers> | null = null;
  try {
    tiers = TIERS ? parseTiers(TIERS) : null;
  } catch (err) {
    usage((err as Error).message);
  }
  let targets: School[] = [];
  if (ALL || ((TIERS || SAMPLE) && !PILOT_MODE && !COLLEGES.length)) targets = schools;
  else if (selecting) {
    let ids = COLLEGES;
    if (PILOT_MODE) ids = [...new Set([...(await readPilot(store, schools)).colleges.map((c) => c.unit_id), ...ids])];
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) usage(`Not in the dataset: ${unknown.join(", ")}`);
    targets = ids.map((id) => byId.get(id)!);
  }
  if (tiers) targets = targets.filter((s) => tiers!.includes(tierOf(s)));
  if (SAMPLE) targets = sampleByTier(targets, Number(SAMPLE), RUN);

  // The state from the store and the run's change set (nothing is opened or written on a dry run).
  const run = await openReportedRun(store, { run: RUN, root: ROOT, served, dry: DRY, log: console.log });
  const state = run.state;
  /** The last save, then the change set closes (or stays open for the collect job); the workflow reads the outputs. */
  async function finish(exit: 0 | 1 | 2 | 3, reason: string | null): Promise<void> {
    const status = await run.finish(exit, reason);
    if (!status || !run.handle) return;
    output("change_set", run.handle.id);
    output("open_batches", state.batches.batches.length);
    output("status", status);
  }

  // Cancelling the workflow sends SIGINT then SIGTERM: mark the summary stopped, write what is finished, hold the set.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      state.summary = { ...state.summary, status: "stopped", stopped_reason: `cancelled (${signal})`, finished: new Date().toISOString() };
      console.error(`\nCancelled (${signal}): keeping everything finished so far.`);
      finish(STOPPED, `Cancelled (${signal}) after ${state.summary.attempted} colleges.`)
        .catch((err) => console.error(`Writing the state after the cancel failed: ${err instanceof Error ? err.message : err}`))
        .finally(() => process.exit(STOPPED));
    });
  }

  // Discovery streams (a long web-tool loop) and is tried at most twice; extraction keeps the SDK's default retries.
  const discoveryClient = new Anthropic({ maxRetries: 1, timeout: 30 * 60 * 1000 });
  const extractionClient = new Anthropic();
  const client: ModelClient = {
    messages: {
      create: (body) => extractionClient.messages.create(body),
      stream: (body, o) => discoveryClient.messages.stream(body, o),
    },
  };
  const pollEnv = process.env.COLLEGE_REPORTED_POLL_UNTIL;
  const pollUntil = pollEnv ? new Date(pollEnv) : POLL_MINUTES > 0 ? new Date(Date.now() + POLL_MINUTES * 60_000) : null;
  if (pollUntil && Number.isNaN(pollUntil.getTime())) usage(`COLLEGE_REPORTED_POLL_UNTIL "${pollEnv}" isn't a time.`);

  const pipeline = createRound3({
    client,
    batches: extractionClient.messages.batches,
    fetch: globalThis.fetch,
    now: () => new Date(),
    archive: createArchive(),
    table: CDS_TEMPLATE,
    callLog: run.callLog,
    onProgress: (s) => run.save(s),
  });
  const what = PHASE === "collect" && !targets.length ? "open batches" : `${targets.length} colleges`;
  console.log(`Run ${RUN}, phase ${PHASE}${REEXTRACT ? ` (re-extract ${CALL} from the archive)` : ""}: ${what}, cost cap $${MAX_COST}${DRY ? " (dry run: nothing written to the store)" : ""}`);
  let result: Awaited<ReturnType<typeof pipeline.run>>;
  try {
    result = await pipeline.run(state, {
      run: RUN,
      phase: PHASE,
      schools: targets,
      allSchools: schools,
      gradYear: run.gradYear,
      rediscover: REDISCOVER,
      ...(REEXTRACT ? { reextract: CALL } : {}),
      maxCost: MAX_COST,
      maxDiscoveries: MAX_DISCOVERIES,
      archivePrior: flag("archive-prior"),
      openAdmissionLeftover: flag("open-admission-search"),
      pollUntil,
      scale: targets.length ? schools.length / targets.length : 1,
    });
  } catch (err) {
    // Keep what finished and hold the set, so the publisher waits for a person.
    const why = err instanceof Error ? err.message : String(err);
    state.summary = { ...state.summary, status: "stopped", stopped_reason: `error: ${why}`, finished: new Date().toISOString() };
    await finish(1, `The run failed: ${why}`).catch((e) => console.error(`Writing the state after the failure failed too: ${e instanceof Error ? e.message : e}`));
    throw err;
  }

  const s = state.summary;
  console.log(`\nAttempted ${s.attempted}, documents read ${s.documents_read}, published C1 ${s.published}, changed values ${s.changed}, C1 failed ${s.failed}, unreachable ${s.unreachable ?? 0}, discovered ${s.discovered}, escalated ${s.escalated}`);
  for (const u of s.usage_rows) console.log(`  ${u.job} ${u.model} ${u.mode}${u.call ? ` ${u.call}` : ""}: ${u.calls} calls, ${u.input_tokens} in / ${u.output_tokens} out, ~$${u.cost_usd.toFixed(4)}`);
  console.log(`  estimated total: ~$${summaryCost(s).toFixed(2)}`);
  if (s.projection) console.log(`  projection: $${(s.projection.run_usd ?? s.projection.full_run_usd).toFixed(2)} this run, $${s.projection.full_run_usd.toFixed(2)} for the full run`);
  if (result.exit === 3) {
    await finish(3, `Stopped early: ${result.message}`);
    console.error(`\nStopped early: ${result.message}. Everything finished is kept; the rest is picked up by the next run.`);
    process.exit(STOPPED);
  }
  if (result.exit === 2) {
    await finish(2, `Circuit breaker tripped: ${result.message}`);
    console.error(`\nCircuit breaker tripped: ${result.message}. The change set is held; look at Holds in the console.`);
    process.exit(2);
  }
  await finish(0, null);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
