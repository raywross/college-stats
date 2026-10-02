/**
 * Reads the newest admissions figures colleges published themselves (class profiles, Common Data Sets) and checks
 * them before they publish. See specs/college-reported-data.md.
 *
 *   npm run sync-college-reported -- --pilot                 # the pilot set (data/reference/college-reported-pilot.json)
 *   npm run sync-college-reported -- --college 166027 --college 190150
 *   npm run sync-college-reported -- --all                   # scheduled mode: every college
 *   npm run sync-college-reported -- --pilot --rediscover    # ignore stored recipes, learn them again
 *   npm run sync-college-reported -- --pilot --dry-run       # read and check, write nothing to data/
 *     --max-discoveries N   discovery (Sonnet + web search) budget per run, default 100
 *     --run <id>            run id, default the start time (ISO)
 *
 * Needs ANTHROPIC_API_KEY (from .env.local or the environment). Writes data/college-sources.json (recipes),
 * data/college-reported.json (values that passed every check), data/review-queue.json (values that failed), and
 * data/reports/college-reported-run-<run>.json. Exit code 2 = the circuit breaker tripped: the files are written so a
 * PR can show them, but the workflow must not auto-merge.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";
import { dataPaths, readQueue, readReported, readSources, writeQueue, writeReported, writeRunSummary, writeSources } from "./lib/college-reported/files.mts";
import { MODEL_PRICES, REPORTED_MODELS } from "./lib/college-reported/models.mts";
import { createPipeline, readJsonFile } from "./lib/college-reported/pipeline.mts";
import { pickPilot, type PilotFile } from "./lib/college-reported/pilot.mts";

const ROOT = join(import.meta.dirname, "..");
const PILOT = join(ROOT, "data", "reference", "college-reported-pilot.json");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

const PILOT_MODE = flag("pilot");
const ALL = flag("all");
const COLLEGES = values("college");
const DRY = flag("dry-run");
const REDISCOVER = flag("rediscover");
const MAX_DISCOVERIES = Number(values("max-discoveries")[0] ?? 100);
const RUN = values("run")[0] ?? new Date().toISOString();

function usage(msg: string): never {
  console.error(`${msg}\nUsage: npm run sync-college-reported -- (--pilot | --all | --college <unit_id> ...) [--rediscover] [--dry-run] [--max-discoveries N] [--run <id>]`);
  process.exit(1);
}

async function main() {
  if (!PILOT_MODE && !ALL && !COLLEGES.length) usage("Pick which colleges to process.");
  if (!Number.isInteger(MAX_DISCOVERIES) || MAX_DISCOVERIES < 0) usage("--max-discoveries needs a whole number.");
  if (!process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (add it to .env.local).");
  for (const m of Object.values(REPORTED_MODELS)) if (!MODEL_PRICES[m]) console.warn(`Warning: no price for ${m}; its cost is logged as $0.`);

  const schools = readJsonFile<School[]>(join(ROOT, "data", "schools.json"));
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  let targets: School[];
  if (ALL) targets = schools;
  else {
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

  const paths = dataPaths(ROOT);
  const pipeline = createPipeline({ client: new Anthropic(), fetch: globalThis.fetch, now: () => new Date() });
  console.log(`Run ${RUN}: ${targets.length} colleges${DRY ? " (dry run: nothing written to data/)" : ""}`);
  const out = await pipeline.run({
    schools: targets,
    sources: readSources(paths.sources),
    reported: readReported(paths.reported),
    queue: readQueue(paths.queue),
    run: RUN,
    rediscover: REDISCOVER,
    maxDiscoveries: MAX_DISCOVERIES,
  });

  const s = out.summary;
  const cost = Object.values(s.usage).reduce((n, u) => n + u.cost_usd, 0);
  console.log(`\nAttempted ${s.attempted}, documents read ${s.documents_read}, published ${s.published}, changed values ${s.changed}, failed ${s.failed}, discovered ${s.discovered}, escalated ${s.escalated}`);
  for (const [job, u] of Object.entries(s.usage)) console.log(`  ${job}: ${u.calls} calls, ${u.input_tokens} in / ${u.output_tokens} out, ~$${u.cost_usd.toFixed(4)}`);
  console.log(`  estimated total: ~$${cost.toFixed(2)}`);
  if (!DRY) {
    writeSources(paths.sources, out.sources);
    writeReported(paths.reported, out.reported);
    writeQueue(paths.queue, out.queue);
    console.log(`Wrote data/college-sources.json, data/college-reported.json, data/review-queue.json, ${writeRunSummary(paths.reports, s).slice(ROOT.length + 1)}`);
  }
  if (s.tripped) {
    console.error(`\nCircuit breaker tripped: ${s.tripped}. Do not auto-merge; look at the review queue.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
