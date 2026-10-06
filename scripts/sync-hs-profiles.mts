/**
 * High school profile PDFs (phase 3; specs/product/high-school-data.md "Profile PDFs" and "Pilot results").
 *
 *   npm run sync-hs-profiles -- --select                  # choose the pilot's 100 schools → profile-pilot.json
 *   npm run sync-hs-profiles -- --pilot --cap 30          # discover, extract, check, write details (needs ANTHROPIC_API_KEY)
 *   npm run sync-hs-profiles -- --pilot --discover-only   # free discovery only (recipes + findability; no model calls)
 *   npm run sync-hs-profiles -- --pilot --seeds f.json    # also try candidate URLs {id: [url, ...]} (discovery step 2)
 *   npm run sync-hs-profiles -- --only 060297000223,A1500310 --cap 2
 *   npm run sync-hs-profiles -- --dump 060297000223       # print a cached profile's numbered lines (for the answer key)
 *   npm run sync-hs-profiles -- --score                   # score the latest run against the answer key
 *
 * Flags: --cap <usd> (default 30; the run stops before a model call that could pass it), --concurrency <n> (default 4),
 * --free (no paid discovery steps), --force (re-extract unchanged profiles), --dry-run (write nothing), --limit <n>.
 * Writes data/high-schools/{profile-recipes,profile-pilot,review-queue}.json and detail/{id}.json (passing schools
 * only); downloads are cached in .cache/hs-profiles/ (git-ignored). Every request goes through the college-reported
 * engine's PoliteHttp: robots.txt, per-host crawl delays, conditional GETs, an honest user agent.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HighSchool } from "../lib/high-school-types.ts";
import type { School } from "../lib/types.ts";
import type { AliasRow } from "../lib/identity-files.ts";
import { readAllShards } from "../lib/high-school-store.ts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { assertPriced, type ModelClient } from "./lib/college-reported/models.mts";
import { parseFlags } from "./lib/high-schools/context.mts";
import { SpendCap } from "./lib/high-schools/profiles/budget.mts";
import type { RecipesFile } from "./lib/high-schools/profiles/discover.mts";
import { readProfileDocument, renderProfileLines } from "./lib/high-schools/profiles/document.mts";
import { PROFILE_MODELS } from "./lib/high-schools/profiles/extract.mts";
import { buildCollegeIndex } from "./lib/high-schools/profiles/match.mts";
import { measure, runProfiles, type RunSchool } from "./lib/high-schools/profiles/run.mts";
import { scoreAgainstKey, type KeyValues } from "./lib/high-schools/profiles/score.mts";
import { PILOT_METROS, PILOT_SEED, selectPilot, selectionRule } from "./lib/high-schools/profiles/select.mts";
import { mergeQueue, profilePaths, readAnswerKey, readJson, writeDetail, writeJson, writeRecipes, type HsReviewQueue, type PilotFile } from "./lib/high-schools/profiles/store.mts";

const ROOT = join(import.meta.dirname, "..");
const P = profilePaths(ROOT);
const flags = parseFlags(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const DRY = flags["dry-run"] === true;
const num = (k: string, d: number) => (typeof flags[k] === "string" ? Number(flags[k]) : d);

function usage(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const shardRows = (): HighSchool[] => readAllShards(join(ROOT, "data", "high-schools")).flatMap((s) => s.shard.schools);

/* --select ----------------------------------------------------------- */
if (flags.select === true) {
  const schools = selectPilot(shardRows());
  const prev = readJson<PilotFile>(P.pilot);
  const file: PilotFile = {
    chosen: today,
    rule: selectionRule(),
    seed: PILOT_SEED,
    metros: PILOT_METROS.map((m) => ({ ...m })),
    schools,
    ...(prev?.seeds_method ? { seeds_method: prev.seeds_method } : {}),
    ...(prev?.latest ? { latest: prev.latest } : {}),
    ...(prev?.accuracy ? { accuracy: prev.accuracy } : {}),
  };
  if (!DRY) writeJson(P.pilot, file);
  const by = (k: string) => schools.filter((s) => `${s.metro}/${s.kind}` === k).length;
  console.log(`Chose ${schools.length} schools: ${PILOT_METROS.map((m) => `${m.label} ${by(`${m.key}/public`)} public + ${by(`${m.key}/private`)} private`).join("; ")}`);
  process.exit(0);
}

/* --dump <id> -------------------------------------------------------- */
if (typeof flags.dump === "string") {
  const recipes = readJson<RecipesFile>(P.recipes);
  const r = recipes?.recipes[flags.dump];
  if (!r?.profile) usage(`${flags.dump}: no profile in the recipes`);
  const file = join(P.cache, r.profile.hash);
  if (!existsSync(file)) usage(`${flags.dump}: ${r.profile.url} isn't cached in .cache/hs-profiles/ (run discovery first)`);
  const doc = await readProfileDocument(new Uint8Array(readFileSync(file)), r.profile.format === "html" ? "text/html" : "application/pdf");
  console.log(`${r.name} — ${r.profile.url} (${doc.pageCount} page(s))\n`);
  console.log(renderProfileLines(doc.lines));
  process.exit(0);
}

/* --score ------------------------------------------------------------ */
function score(pilot: PilotFile): PilotFile["accuracy"] {
  const key = readAnswerKey(P.answerKey);
  if (!key || !pilot.latest) return null;
  const extracted = new Map<string, KeyValues>();
  for (const r of pilot.latest.results) if (r.extracted) extracted.set(r.id, r.extracted);
  const rep = scoreAgainstKey(key.schools, extracted);
  return { ...rep, scored: today, basis: "the model's extraction before checks (after escalation), against data/reference/hs-profile-answer-key.json" };
}

if (flags.score === true) {
  const pilot = readJson<PilotFile>(P.pilot);
  if (!pilot) usage("no profile-pilot.json; run --select first");
  const acc = score(pilot);
  if (!acc) usage("nothing to score: needs an answer key and a run with extractions");
  console.log(JSON.stringify({ schools: acc.schools, overall: acc.overall, fields: Object.fromEntries(Object.entries(acc.fields).map(([k, v]) => [k, v.accuracy])), mean_f1: acc.mean_f1 }, null, 2));
  if (!DRY) writeJson(P.pilot, { ...pilot, accuracy: acc });
  process.exit(0);
}

/* A run --------------------------------------------------------------- */
const discoverOnly = flags["discover-only"] === true;
if (!discoverOnly && !process.env.ANTHROPIC_API_KEY) usage("ANTHROPIC_API_KEY is not set (add it to .env.local), or pass --discover-only for a free discovery run.");
assertPriced(Object.values(PROFILE_MODELS));

const pilot = readJson<PilotFile>(P.pilot);
const rows = shardRows();
const byId = new Map(rows.map((r) => [r.id, r]));
let ids: string[];
if (typeof flags.only === "string") ids = flags.only.split(",").map((s) => s.trim()).filter(Boolean);
else if (flags.pilot === true) {
  if (!pilot) usage("no profile-pilot.json; run --select first");
  ids = pilot.schools.map((s) => s.id);
} else usage("pass --pilot, --only <ids>, --select, --dump <id>, or --score");
if (flags.limit) ids = ids.slice(0, num("limit", ids.length));
const schools: RunSchool[] = ids.map((id) => {
  const r = byId.get(id);
  if (!r) usage(`${id}: not in the high school shards`);
  return { id, name: r.name, city: r.city, state: r.state, district: r.district?.name ?? null, kind: r.kind, grade12: r.enrollment?.by_grade?.["12"] ?? null };
});

const colleges = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const aliases = JSON.parse(readFileSync(join(ROOT, "data", "aliases.json"), "utf8")) as AliasRow[];
const index = buildCollegeIndex(colleges.map((c) => ({ unit_id: c.unit_id, name: c.name, state: c.location.state })), aliases);

const seeds = typeof flags.seeds === "string" ? (JSON.parse(readFileSync(resolve(process.cwd(), flags.seeds), "utf8")) as Record<string, string[]>) : undefined;
const recipes = readJson<RecipesFile>(P.recipes) ?? { updated: today, recipes: {} };
const cap = new SpendCap(num("cap", 30));
const http = new PoliteHttp({
  fetch: globalThis.fetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  minDelayMs: 1000,
  log: (m) => console.log(m),
  userAgent: "QuadCollegeData/1.0 (high school profiles; +https://college-stats-nine.vercel.app/data)",
  uaToken: "quadcollegedata",
});
let client: ModelClient | undefined;
if (!discoverOnly) {
  const extractionClient = new Anthropic();
  const searchClient = new Anthropic({ maxRetries: 1, timeout: 10 * 60 * 1000 });
  client = { messages: { create: (b) => extractionClient.messages.create(b), stream: (b, o) => searchClient.messages.stream(b, o) } };
}

const RUN = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const started = new Date().toISOString();
console.log(`Run ${RUN}: ${schools.length} schools, ${discoverOnly ? "discovery only (free)" : `spend cap $${cap.cap}`}${DRY ? " (dry run)" : ""}`);
mkdirSync(P.cache, { recursive: true });
const out = await runProfiles(schools, recipes.recipes, {
  http,
  client,
  cap,
  index,
  schoolIds: new Set(byId.keys()),
  collegeIds: index.ids,
  today,
  run: RUN,
  log: (m) => console.log(m),
  seeds,
  discoverOnly,
  free: flags.free === true,
  force: flags.force === true,
  concurrency: num("concurrency", 4),
  onFound: (_s, f) => {
    const file = join(P.cache, f.hash);
    if (!existsSync(file)) writeFileSync(file, f.bytes);
  },
});

const m = measure(schools, out.results);
console.log(`\nFound ${m.found}/${m.schools}; published ${m.published}; failed checks ${m.failed_checks}; spent $${cap.spent.toFixed(4)}${out.stopped ? `; STOPPED: ${out.stopped}` : ""}`);
if (DRY) process.exit(0);

writeRecipes(P.recipes, { updated: today, recipes: out.recipes });
for (const d of out.details) writeDetail(P.detailDir, d);
writeJson(P.queue, mergeQueue(readJson<HsReviewQueue>(P.queue), new Set(ids), out.review, today));
if (pilot && flags.pilot === true) {
  const next: PilotFile = {
    ...pilot,
    ...(seeds ? { seeds_method: typeof flags["seeds-method"] === "string" ? flags["seeds-method"] : pilot.seeds_method ?? "candidate URLs passed with --seeds" } : {}),
    latest: {
      run: RUN,
      started,
      finished: new Date().toISOString(),
      cap_usd: cap.cap,
      spent_usd: cap.spent,
      stopped: out.stopped,
      models: { ...PROFILE_MODELS },
      mode: discoverOnly ? "discover-only" : flags.free ? "free discovery + extraction" : "full",
      measurements: m,
      cost_by_job: Object.fromEntries(cap.byJob),
      results: out.results,
    },
  };
  next.accuracy = score(next) ?? pilot.accuracy ?? null;
  writeJson(P.pilot, next);
}
console.log(`Wrote ${out.details.length} detail file(s), ${out.review.length} review item(s).`);
