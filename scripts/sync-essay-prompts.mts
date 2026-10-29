/**
 * Essay prompts (specs/product/essays/prompts.md): finds each college's essay prompts page on its own site, reads it
 * once with the model, checks the record, and writes data/essay-prompts/records/ (passing) and held/ (for review).
 * `npm run merge-essay-prompts` then applies the records to data/schools.json.
 *
 *   npm run sync-essay-prompts -- --units 166027,190150     # these colleges
 *   npm run sync-essay-prompts -- --top 200                 # the 200 colleges with the most applicants
 *   npm run sync-essay-prompts -- --on-plans ids.json       # a file of unit ids (a JSON array, or one per line):
 *                                                           # the plans' colleges, exported from the database
 *   npm run sync-essay-prompts -- --top 200 --discover-only # find pages only (no reads; free without --picker)
 *   npm run sync-essay-prompts -- --report body             # print the last run's PR body
 *   npm run sync-essay-prompts -- --report note --pr 123 --date 2026-10-29 --out release-notes/x.md
 *
 * Flags: --budget <usd> (default 40: the first wave's estimate; a run stops before a call that could pass it),
 * --dry-run (writes nothing), --force (re-read pages whose bytes haven't changed), --limit <n>, --concurrency <n>
 * (default 4; requests to one host are paced anyway). Needs ANTHROPIC_API_KEY unless --discover-only. Every request
 * goes through the college-reported engine's PoliteHttp (robots.txt, pacing, the honest user agent); every page read
 * is kept in the archive by sha (COLLEGE_DOCS_REPO selects the GitHub-release archive, as for the CDS run).
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { School } from "../lib/types.ts";
import { createArchive } from "./lib/college-reported/archive.mts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { assertPriced, roundUsd, type ModelClient } from "./lib/college-reported/models.mts";
import { toWellFormedDeep } from "./lib/college-reported/well-formed.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SpendCap, SpendCapReached } from "./lib/high-schools/profiles/budget.mts";
import { openCycle } from "./lib/essay-prompts/cycle.mts";
import { PICKER_MODEL } from "./lib/essay-prompts/discover.mts";
import { READ_MODEL } from "./lib/essay-prompts/read.mts";
import { prBody, releaseNote, type RunSummary } from "./lib/essay-prompts/report.mts";
import { runCollege, type Outcome } from "./lib/essay-prompts/run.mts";
import { clearHeld, essayPaths, readEssayRecord, readPages, readPlatformPrompts, writeEssayRecord, writeHeld, writePages } from "./lib/essay-prompts/store.mts";

const ROOT = join(import.meta.dirname, "..");
const P = essayPaths(ROOT);
const SUMMARY = join(P.dir, "last-run.json");
const flags = parseFlags(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const DRY = flags["dry-run"] === true;
const num = (k: string, d: number) => (typeof flags[k] === "string" ? Number(flags[k]) : d);

function usage(msg: string): never {
  console.error(`sync-essay-prompts: ${msg}`);
  process.exit(1);
}

/* --report ----------------------------------------------------------- */
if (typeof flags.report === "string") {
  if (!existsSync(SUMMARY)) usage("no data/essay-prompts/last-run.json; run the sync first");
  const s = JSON.parse(readFileSync(SUMMARY, "utf8")) as RunSummary;
  if (flags.report === "body") process.stdout.write(prBody(s));
  else if (flags.report === "note") {
    if (typeof flags.pr !== "string" || typeof flags.date !== "string" || typeof flags.out !== "string") usage("--report note needs --pr, --date, and --out");
    writeFileSync(flags.out, releaseNote(s, Number(flags.pr), flags.date));
  } else usage(`--report ${flags.report}: expected body or note`);
  process.exit(0);
}

/* Which colleges ------------------------------------------------------ */
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const byId = new Map(schools.map((s) => [s.unit_id, s]));
let ids: string[];
if (typeof flags.units === "string") ids = flags.units.split(",").map((s) => s.trim()).filter(Boolean);
else if (typeof flags.top === "string") {
  const n = num("top", 200);
  ids = [...schools]
    .filter((s) => (s.admissions?.applicants ?? 0) > 0)
    .sort((a, b) => (b.admissions.applicants ?? 0) - (a.admissions.applicants ?? 0) || a.unit_id.localeCompare(b.unit_id))
    .slice(0, n)
    .map((s) => s.unit_id);
} else if (flags["on-plans"] !== undefined) {
  if (typeof flags["on-plans"] !== "string") usage("--on-plans needs a file of unit ids (the plans' colleges live in the database; export them first)");
  const raw = readFileSync(resolve(process.cwd(), flags["on-plans"]), "utf8").trim();
  ids = raw.startsWith("[") ? (JSON.parse(raw) as unknown[]).map(String) : raw.split(/[\s,]+/).filter(Boolean);
} else usage("pass --units <ids>, --top <n>, --on-plans <file>, or --report body|note");
ids = [...new Set(ids)];
for (const id of ids) if (!byId.has(id)) usage(`${id}: not in data/schools.json`);
if (flags.limit) ids = ids.slice(0, num("limit", ids.length));

const discoverOnly = flags["discover-only"] === true;
if (!discoverOnly && !process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (it lives in GitHub Actions), or pass --discover-only for a free discovery run.");
assertPriced([READ_MODEL, PICKER_MODEL]);

const http = new PoliteHttp({
  fetch: globalThis.fetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minDelayMs: 1000,
  log: (m) => console.log(m),
  userAgent: "QuadCollegeData/1.0 (essay prompts; +https://college-stats-nine.vercel.app/data)",
  uaToken: "quadcollegedata",
});
let client: ModelClient | undefined;
if (!discoverOnly) {
  const anthropic = new Anthropic();
  client = {
    messages: {
      create: async (b) => {
        try {
          return await anthropic.messages.create(toWellFormedDeep(b));
        } catch (err) {
          // Typed errors: a rate limit or an overloaded API is worth one more try later; anything else ends the read.
          if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
            await new Promise((r) => setTimeout(r, 30_000));
            return anthropic.messages.create(toWellFormedDeep(b));
          }
          throw err;
        }
      },
      stream: (b, o) => anthropic.messages.stream(toWellFormedDeep(b), o),
    },
  };
}
const cap = new SpendCap(num("budget", 40));
/** The platforms' own prompt texts: a college prompt equal to one of them is the platform's, not the college's. */
const platformFile = readPlatformPrompts(P.platform);
const platformTexts = platformFile ? [...(platformFile.common_app?.prompts ?? []), ...(platformFile.coalition?.prompts ?? [])].map((p) => p.text) : [];
/** One read per page per run (the UC campuses share one page). */
const readCache = new Map<string, { answer: import("./lib/essay-prompts/read.mts").ReadAnswer; model: string }>();
const archive = DRY ? undefined : createArchive({ log: (m) => console.log(m) });
const pages = readPages(P.pages);
const RUN = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const summary: RunSummary = {
  run: RUN,
  started: new Date().toISOString(),
  finished: null,
  cycle: openCycle(today),
  budget_usd: cap.cap,
  spent_usd: 0,
  stopped: null,
  dry_run: DRY,
  colleges: ids.length,
  counts: { passed: 0, held: 0, unchanged: 0, not_found: 0, failed: 0, found: 0 },
  passed: [],
  held: [],
  not_found: [],
  failed: [],
};
console.log(`Run ${RUN}: ${ids.length} colleges for the ${summary.cycle} cycle, ${discoverOnly ? "discovery only" : `budget $${cap.cap}`}${DRY ? " (dry run)" : ""}`);

function record(id: string, o: Outcome) {
  const s = byId.get(id)!;
  pages.pages[id] = o.recipe;
  switch (o.kind) {
    case "passed":
      summary.counts.passed++;
      summary.passed.push({ unit_id: id, name: s.name, status: o.record.status, prompts: o.record.prompts.length });
      if (o.record.cycle_assumed) (summary.assumed ??= []).push({ unit_id: id, name: s.name });
      if (!DRY) {
        writeEssayRecord(P.records, o.record);
        clearHeld(P.held, id);
      }
      console.log(`  ${s.name}: ${o.record.status}, ${o.record.prompts.length} prompt(s), $${o.cost.toFixed(4)}`);
      break;
    case "held":
      summary.counts.held++;
      summary.held.push({ unit_id: id, name: s.name, problems: o.problems });
      if (!DRY) writeHeld(P.held, { unit_id: id, name: s.name, held: today, problems: o.problems, record: o.record });
      console.log(`  ${s.name}: HELD (${o.problems.length}): ${o.problems.slice(0, 2).join("; ")}`);
      break;
    case "not-found":
      summary.counts.not_found++;
      summary.not_found.push({ unit_id: id, name: s.name, ...(o.recipe.blocked ? { blocked: o.recipe.blocked } : {}) });
      console.log(`  ${s.name}: no essay page found${o.recipe.blocked ? ` (${o.recipe.blocked} refused us)` : ""}`);
      break;
    case "failed":
      summary.counts.failed++;
      summary.failed.push({ unit_id: id, name: s.name, reason: o.reason });
      break;
    case "unchanged":
      summary.counts.unchanged++;
      break;
    case "found":
      summary.counts.found++;
      console.log(`  ${s.name}: found ${o.recipe.url} (${o.recipe.via})`);
      break;
  }
}

const queue = [...ids];
const workers = Array.from({ length: Math.max(1, num("concurrency", 4)) }, async () => {
  while (queue.length && !summary.stopped) {
    const id = queue.shift()!;
    const s = byId.get(id)!;
    try {
      record(id, await runCollege(s, pages.pages[id], readEssayRecord(P.records, id), { http, client, cap, archive, today, force: flags.force === true, discoverOnly, platformTexts, readCache, log: (m) => console.log(m) }));
    } catch (err) {
      if (err instanceof SpendCapReached) summary.stopped = err.message;
      else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) summary.stopped = `the API key was refused (${err.status})`;
      else {
        summary.counts.failed++;
        summary.failed.push({ unit_id: id, name: s.name, reason: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      }
    }
  }
});
await Promise.all(workers);

summary.finished = new Date().toISOString();
summary.spent_usd = roundUsd(cap.spent);
const c = summary.counts;
console.log(`\nPassed ${c.passed}, held ${c.held}, unchanged ${c.unchanged}, found ${c.found}, not found ${c.not_found}, failed ${c.failed}; spent $${cap.spent.toFixed(4)}${summary.stopped ? `; STOPPED: ${summary.stopped}` : ""}`);
if (!DRY) {
  pages.updated = today;
  writePages(P.pages, pages);
  writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
}
// Exit 3 when the run stopped early (budget or key), like the college-reported run, so the workflow can say why.
process.exit(summary.stopped ? 3 : 0);
