/**
 * Reads the newest figures colleges published themselves (Common Data Sets, class profiles), checks every item, and
 * publishes what passes: the round-3 pipeline (specs/college-reported-round-3.md; how to run it:
 * specs/college-reported-setup.md). Every document is fetched once, archived, and read once per schema version.
 *
 *   npm run sync-college-reported -- --pilot                       # the pilot set (data/reference/college-reported-pilot.json)
 *   npm run sync-college-reported -- --college 166027 --college 190150
 *   npm run sync-college-reported -- --all                         # scheduled mode: every college
 *   npm run sync-college-reported -- --sample 60 --tiers less,open # a stratified random sample of those tiers
 *   npm run sync-college-reported -- --pilot --rediscover          # every college climbs the ladder from step 0
 *   npm run sync-college-reported -- --phase collect --run <id>    # collect a run's open batches (the collect job)
 *   npm run sync-college-reported -- --all --reextract --call C    # after a schema bump: archive only, no fetch
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
 *     --rediscover --dry-run --run <id>
 *
 * Needs ANTHROPIC_API_KEY (from .env.local or the environment) unless the phase is prepare. Writes, after every college
 * and every collected batch: data/college-sources.json, data/college-reported.json (C1, round 2's path),
 * data/review-queue.json, data/college-docs.json, data/cds-records/<unit_id>.json, data/college-batches.json,
 * data/reference/blocked-hosts.json, data/reports/college-reported-run-<run>.json, and one line per model call in
 * data/reports/college-reported-calls-<run>.jsonl.
 *
 * Exit codes: 0 = done (batches still open in data/college-batches.json is the draft-PR signal, not an error);
 * 2 = the circuit breaker tripped (files written; the workflow must not auto-merge); 3 = stopped early (the projection
 * exceeds the cap, the spend limit, credit balance, or key refused; or cancelled), files hold everything finished;
 * 1 = error.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import type { BlockedHostsFile, CdsUrlsFile, RunSummaryV3 } from "../lib/reported.ts";
import type { CallKey } from "../lib/cds-sections.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { restoreFederal } from "../lib/newest.ts";
import { dataPaths, readQueue, readReported, readSources, writeQueue, writeReported, writeRunSummary, writeSources } from "./lib/college-reported/files.mts";
import { UnpricedModelError, assertPriced, emptySummaryV3, fileCallLogWriter, memoryCallLogWriter, summaryCost, type ModelClient } from "./lib/college-reported/models.mts";
import { readJsonFile } from "./lib/college-reported/pipeline.mts";
import { createRound3, PHASES, type Phase, type Round3State } from "./lib/college-reported/phases.mts";
import { readBatches, writeBatches } from "./lib/college-reported/batch.mts";
import { readManifest, readRecords, writeManifest, writeRecord } from "./lib/college-reported/records.mts";
import { createArchive } from "./lib/college-reported/archive.mts";
import { parseTiers, pickPilot, sampleByTier, tierOf, type PilotFile } from "./lib/college-reported/pilot.mts";

const ROOT = join(import.meta.dirname, "..");
const PILOT = join(ROOT, "data", "reference", "college-reported-pilot.json");
const FILES = {
  manifest: join(ROOT, "data", "college-docs.json"),
  records: join(ROOT, "data", "cds-records"),
  batches: join(ROOT, "data", "college-batches.json"),
  blocked: join(ROOT, "data", "reference", "blocked-hosts.json"),
  manual: join(ROOT, "data", "reference", "cds-urls.json"),
};
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
const MAX_DISCOVERIES = Number(values("max-discoveries")[0] ?? 100);
const RUN = values("run")[0] ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
const MAX_COST = Number(values("max-cost")[0] ?? (ALL ? 150 : 25));
const POLL_MINUTES = Number(values("poll-minutes")[0] ?? (PHASE === "all" ? 90 : 0));
/** Exit code for a run that ended early: files hold everything it finished. */
const STOPPED = 3;

function usage(msg: string): never {
  console.error(
    `${msg}\nUsage: npm run sync-college-reported -- (--pilot | --all | --college <unit_id> ... | --tiers <list> | --sample N [--tiers <list>]) ` +
      `[--phase prepare|discover|submit|collect|all] [--reextract --call C|rest] [--rediscover] [--dry-run] [--max-discoveries N] ` +
      `[--max-cost <usd>] [--archive-prior] [--open-admission-search] [--poll-minutes N] [--run <id>]`
  );
  process.exit(1);
}

async function main() {
  if (!PHASES.includes(PHASE)) usage(`--phase must be one of ${PHASES.join(", ")}.`);
  const selecting = PILOT_MODE || ALL || COLLEGES.length || TIERS || SAMPLE;
  if (!selecting && PHASE !== "collect") usage("Pick which colleges to process.");
  if (REEXTRACT && CALL !== "C" && CALL !== "rest") usage("--reextract needs --call C or --call rest.");
  if (!REEXTRACT && CALL) usage("--call goes with --reextract.");
  if (!Number.isInteger(MAX_DISCOVERIES) || MAX_DISCOVERIES < 0) usage("--max-discoveries needs a whole number.");
  if (!Number.isFinite(MAX_COST) || MAX_COST <= 0) usage("--max-cost needs a dollar amount above 0.");
  if (!Number.isFinite(POLL_MINUTES) || POLL_MINUTES < 0) usage("--poll-minutes needs a number of minutes.");
  if (SAMPLE && !(Number.isInteger(Number(SAMPLE)) && Number(SAMPLE) > 0)) usage("--sample needs a whole number above 0.");
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
  const schools = readJsonFile<School[]>(join(ROOT, "data", "schools.json")).map(restoreFederal);
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
    if (PILOT_MODE) {
      let pilot: PilotFile;
      if (existsSync(PILOT)) pilot = readJsonFile<PilotFile>(PILOT);
      else {
        pilot = pickPilot(schools);
        console.log(`No ${PILOT}; picked ${pilot.colleges.length} colleges deterministically across admit-rate tiers and sectors.`);
      }
      ids = [...new Set([...pilot.colleges.map((c) => c.unit_id), ...ids])];
    }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) usage(`Not in data/schools.json: ${unknown.join(", ")}`);
    targets = ids.map((id) => byId.get(id)!);
  }
  if (tiers) targets = targets.filter((s) => tiers!.includes(tierOf(s)));
  if (SAMPLE) targets = sampleByTier(targets, Number(SAMPLE), RUN);

  const paths = dataPaths(ROOT);
  const summaryFile = join(paths.reports, `college-reported-run-${RUN.replace(/[:]/g, "-")}.json`);
  // A later phase of the same run (the collect job) continues its summary.
  const prior = existsSync(summaryFile) ? (JSON.parse(readFileSync(summaryFile, "utf8")) as RunSummaryV3) : null;
  const summary: RunSummaryV3 = prior?.round === 3 ? { ...prior, status: "running", finished: null } : emptySummaryV3(RUN, new Date().toISOString());
  delete summary.stopped_reason;
  const state: Round3State = {
    sources: readSources(paths.sources),
    reported: readReported(paths.reported),
    queue: readQueue(paths.queue),
    manifest: readManifest(FILES.manifest),
    records: new Map(readRecords(FILES.records).map((r) => [r.unit_id, r])),
    batches: readBatches(FILES.batches),
    blocked: existsSync(FILES.blocked) ? readJsonFile<BlockedHostsFile>(FILES.blocked) : { hosts: [] },
    manual: existsSync(FILES.manual) ? readJsonFile<CdsUrlsFile>(FILES.manual).entries : [],
    summary,
    dirty: new Set(),
  };

  // Written after every college and every collected batch, so a run that stops, fails, or is cancelled keeps its work.
  const save = (s: Round3State) => {
    if (DRY) return;
    writeSources(paths.sources, s.sources);
    writeReported(paths.reported, s.reported);
    writeQueue(paths.queue, s.queue);
    writeManifest(FILES.manifest, s.manifest);
    for (const id of s.dirty) {
      const rec = s.records.get(id);
      if (rec) writeRecord(FILES.records, rec);
    }
    s.dirty.clear();
    writeBatches(FILES.batches, s.batches);
    writeFileSync(FILES.blocked, `${JSON.stringify(s.blocked, null, 2)}\n`);
    return writeRunSummary(paths.reports, s.summary);
  };
  // Cancelling the workflow sends SIGINT then SIGTERM: mark the summary stopped and exit with the stop code.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      state.summary = { ...state.summary, status: "stopped", stopped_reason: `cancelled (${signal})`, finished: new Date().toISOString() };
      save(state);
      console.error(`\nCancelled (${signal}): kept everything finished so far.`);
      process.exit(STOPPED);
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
    callLog: DRY ? memoryCallLogWriter() : fileCallLogWriter(paths.reports, RUN),
    onProgress: (s) => void save(s),
  });
  const what = PHASE === "collect" && !targets.length ? "open batches" : `${targets.length} colleges`;
  console.log(`Run ${RUN}, phase ${PHASE}${REEXTRACT ? ` (re-extract ${CALL} from the archive)` : ""}: ${what}, cost cap $${MAX_COST}${DRY ? " (dry run: nothing written to data/)" : ""}`);
  const result = await pipeline.run(state, {
    run: RUN,
    phase: PHASE,
    schools: targets,
    allSchools: schools,
    rediscover: REDISCOVER,
    ...(REEXTRACT ? { reextract: CALL } : {}),
    maxCost: MAX_COST,
    maxDiscoveries: MAX_DISCOVERIES,
    archivePrior: flag("archive-prior"),
    openAdmissionLeftover: flag("open-admission-search"),
    pollUntil,
    scale: targets.length ? schools.length / targets.length : 1,
  });

  const s = state.summary;
  console.log(`\nAttempted ${s.attempted}, documents read ${s.documents_read}, published C1 ${s.published}, changed values ${s.changed}, C1 failed ${s.failed}, unreachable ${s.unreachable ?? 0}, discovered ${s.discovered}, escalated ${s.escalated}`);
  for (const u of s.usage_rows) console.log(`  ${u.job} ${u.model} ${u.mode}${u.call ? ` ${u.call}` : ""}: ${u.calls} calls, ${u.input_tokens} in / ${u.output_tokens} out, ~$${u.cost_usd.toFixed(4)}`);
  console.log(`  estimated total: ~$${summaryCost(s).toFixed(2)}`);
  if (s.projection) console.log(`  projection: $${(s.projection.run_usd ?? s.projection.full_run_usd).toFixed(2)} this run, $${s.projection.full_run_usd.toFixed(2)} for the full run`);
  const file = save(state);
  if (file) console.log(`Wrote the data files and ${file.slice(ROOT.length + 1)}`);
  if (state.batches.batches.length) console.log(`${state.batches.batches.length} batch(es) still open in data/college-batches.json: the collect job (or --phase collect --run ${RUN}) finishes them.`);
  if (result.exit === 3) {
    console.error(`\nStopped early: ${result.message}. Everything finished is kept; the rest is picked up by the next run.`);
    process.exit(STOPPED);
  }
  if (result.exit === 2) {
    console.error(`\nCircuit breaker tripped: ${result.message}. Do not auto-merge; look at the review queue.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
