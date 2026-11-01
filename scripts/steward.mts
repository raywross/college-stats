/**
 * The Data Steward (specs/product/data-steward.md "The Steward"): a scripted agent on the Anthropic SDK's tool runner
 * with a fixed set of tools (./lib/steward/tools.mts) that reads the review queue, checks causes against the colleges'
 * documents, and writes its findings as documents the admin console reviews. It writes the `steward.*` collections
 * only, in one change set per run (kind pipeline, source `steward`), and never asks the publisher for a snapshot.
 *
 *   npm run steward -- --store supabase --mode run --budget 5 [--cause <cluster key>] [--unit <id>]
 *   npm run steward -- --store supabase --mode audit --budget 10
 *   npm run steward -- --store supabase --mode answer --proposal <key> --budget 5
 *   npm run steward -- --store supabase --mode apply --proposal <key>
 *   npm run steward -- --store file:/tmp/layers --mode run --budget 5 --dry-run tests/fixtures/steward/answers
 *
 * Modes:
 * - run: cluster the open queue, triage the largest clusters within the budget, verify with sub-reads, write issues,
 *   proposals, To do rows and decisions, then the run record (`steward.runs`).
 * - audit: one check family in rotation by week number (C7/C8 grids, C9 bands, B4–B11 grids, H2): a sample of up to
 *   25 passed values compared with their documents, written as an audit; above 5% wrong, an issue (`audit|<family>`).
 * - answer: the owner's question on a proposal (`--proposal`), answered on the proposal with any rows added.
 * - apply: no model. An approved proposal's hold, refile, recipe or reject rows applied in one change set (source
 *   `steward-apply`), the proposal marked applied (./lib/steward/apply.mts). The one mode that changes `reported.*`.
 *
 * The budget (./lib/steward/budget.mts) is the smaller of `--budget` and what the week's $40 has left (summed from
 * `steward.runs`), checked before every model call. `--dry-run <dir>` answers every model call from recorded answers
 * (./lib/steward/dry-run.mts) and needs no key. `--run-ref` names the run (default the Actions run id, or a local
 * stamp); `--request-id` is the console's, kept on the run record.
 *
 * Exit codes: 0 done; 2 the budget stopped it (what it wrote stays, the run record says where); 1 a failure. In
 * Actions the script writes `publish` (true when an apply changed a record), `change_set` and `exit_code` to
 * $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import type { AuditDoc, ProposalDoc, RunDoc } from "../lib/steward/types.ts";
import { createArchive, type Archive } from "./lib/college-reported/archive.mts";
import { PoliteHttp } from "./lib/college-reported/http.mts";
import { COLLECTIONS, readLayer } from "./lib/data-platform/layers.mts";
import { runRef as defaultRunRef } from "./lib/data-platform/producer.mts";
import { storeFromFlag, type ChangeSetHandle, type DataStore, type Env } from "./lib/data-platform/store.mts";
import { applyProposal, APPLY_SOURCE } from "./lib/steward/apply.mts";
import { Budget, BudgetStop, DEFAULT_BUDGETS, runBudget, tokensOf, weeklySpent, WEEKLY_CAP_USD } from "./lib/steward/budget.mts";
import { MissingAnswer, recordedFetch, mayRecord } from "./lib/steward/dry-run.mts";
import type { DocumentDeps } from "./lib/steward/documents.mts";
import { MAIN_EFFORT, MAIN_MAX_ITERATIONS, MAIN_MAX_TOKENS, STEWARD_MODELS } from "./lib/steward/models.mts";
import { answerTask, AUDIT_FAMILIES, AUDIT_ISSUE_RATE, AUDIT_SAMPLE, auditTask, inFamily, runTask, SYSTEM_PROMPT, type AuditFamily, type AuditSampleRow } from "./lib/steward/prompts.mts";
import { bundledSite, clusters, documentDeps, openQueue, stewardTools, type SiteReader, type StewardContext } from "./lib/steward/tools.mts";
import { StewardWriter } from "./lib/steward/writer.mts";

export const STEWARD_SOURCE = "steward";
export const EXIT = { done: 0, failed: 1, budget: 2 } as const;
export type StewardMode = RunDoc["mode"];
export const MODES: readonly StewardMode[] = ["run", "audit", "apply", "answer"];

export interface StewardOptions {
  mode: StewardMode;
  store: DataStore;
  /** US dollars; default by mode (run 20, audit 10, answer 5). */
  budget?: number;
  cause?: string | null;
  unit?: string | null;
  proposal?: string | null;
  runRef?: string;
  requestId?: string | null;
  /** A folder of recorded answers: no request reaches the API. */
  dryRun?: string | null;
  /** Injected for tests: the client (else the real one, or the dry run's). */
  client?: Anthropic;
  archive?: DocumentDeps["archive"];
  fetchBytes?: DocumentDeps["fetchBytes"];
  site?: SiteReader;
  now?: () => Date;
  env?: Env;
  log?: (line: string) => void;
}

export interface StewardResult {
  exit: 0 | 1 | 2;
  run: RunDoc;
  changeSet: number | null;
  /** apply: a hold or refile changed a record. */
  publish: boolean;
  message?: string;
}

/** Week of the year (UTC, from January 1), for the audit rotation. */
export function weekOf(d: Date): number {
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 24 * 3600 * 1000));
}

export function auditFamily(d: Date): AuditFamily {
  return AUDIT_FAMILIES[weekOf(d) % AUDIT_FAMILIES.length];
}

/**
 * Up to `n` passed values of a family, one per college before a second from any, in an order fixed by the week (the
 * same week samples the same values; the next week others).
 */
export function auditSample(records: Iterable<CollegeRecord>, family: AuditFamily, seed: string, n = AUDIT_SAMPLE): AuditSampleRow[] {
  const rows: (AuditSampleRow & { rank: string })[] = [];
  for (const rec of records) {
    for (const doc of rec.documents) {
      for (const [code, it] of Object.entries(doc.items)) {
        if (it.status !== "passed" || it.v === undefined || !inFamily(family, code)) continue;
        rows.push({
          unit_id: rec.unit_id,
          edition: doc.edition,
          code,
          value: it.v,
          sha256: doc.sha256,
          page: it.page ?? null,
          line: it.line ?? null,
          cell: it.cell ?? null,
          quote: it.quote ?? null,
          rank: createHash("sha256").update(`${seed}|${rec.unit_id}|${doc.edition}|${code}`).digest("hex"),
        });
      }
    }
  }
  rows.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const seen = new Set<string>();
  const first = rows.filter((r) => !seen.has(r.unit_id) && seen.add(r.unit_id));
  const rest = rows.filter((r) => !first.includes(r));
  return [...first, ...rest].slice(0, n).map((r) => {
    const row: Partial<typeof r> = { ...r };
    delete row.rank;
    return row as AuditSampleRow;
  });
}

/** A polite GET of a document (a CDS file is fetched even where robots.txt disallows crawlers; owner decision 2026-10-10). */
export function politeFetchBytes(log: (line: string) => void): DocumentDeps["fetchBytes"] {
  const http = new PoliteHttp({ fetch: globalThis.fetch, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), minDelayMs: 1000, log });
  return async (url) => {
    try {
      const res = await http.get(url, {}, {}, { cdsDocument: true });
      if (!res) return { error: "robots.txt disallows it, or the host didn't answer" };
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

const emptyRun = (o: { key: string; mode: StewardMode; started: string; budget: number; requestId: string | null }): RunDoc => ({
  key: o.key,
  mode: o.mode,
  started: o.started,
  finished: null,
  budget_usd: o.budget,
  spent_usd: 0,
  clusters: 0,
  issues: 0,
  proposals: 0,
  todo: 0,
  decisions: 0,
  audits: 0,
  stopped: null,
  request_id: o.requestId,
});

/** The main loop: the tool runner over the mode's tools, the budget checked before every call. */
async function mainLoop(ctx: StewardContext, client: Anthropic, task: string, mode: "run" | "audit" | "answer", extra: { answerFor?: string } = {}): Promise<{ stopped: string | null; budgetStopped: boolean }> {
  const tools = stewardTools(ctx, mode, extra);
  const model = STEWARD_MODELS.main;
  // A turn's output, thinking included, is usually far under max_tokens; this is what each call is expected to cost.
  const expectedOutput = 4_000;
  let expectedInput = tokensOf(SYSTEM_PROMPT + task) + 3_000;
  try {
    ctx.budget.ensure(model, expectedInput, expectedOutput, "before the first call", { reserved: false });
  } catch (err) {
    if (err instanceof BudgetStop) return { stopped: `${err.where}: ${err.message}`, budgetStopped: true };
    throw err;
  }
  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: MAIN_MAX_TOKENS,
    max_iterations: MAIN_MAX_ITERATIONS,
    thinking: { type: "adaptive" },
    output_config: { effort: MAIN_EFFORT },
    // The system block and the growing conversation are cached: each turn reads the history at a tenth of the price.
    cache_control: { type: "ephemeral" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools,
    messages: [{ role: "user", content: task }],
  });
  for await (const message of runner) {
    ctx.budget.charge(message.usage, model, "main");
    ctx.progress.calls++;
    if (message.stop_reason === "refusal") return { stopped: `the model declined at call ${ctx.progress.calls}`, budgetStopped: false };
    if (message.stop_reason !== "tool_use") continue;
    // The next call carries this history plus the tool results; check it before the runner makes it.
    const u = message.usage;
    expectedInput = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens + 3_000;
    const where = `after ${ctx.progress.calls} model call(s)${ctx.progress.cluster ? `, working cluster "${ctx.progress.cluster}"` : ""}`;
    // Cached history is read at a tenth: estimate the next call as mostly a cache read, plus the new turn.
    const nextInput = Math.round(expectedInput * 0.2);
    try {
      ctx.budget.ensure(model, nextInput, expectedOutput, where, { reserved: false });
    } catch (err) {
      if (err instanceof BudgetStop) return { stopped: `${err.where}: ${err.message}`, budgetStopped: true };
      throw err;
    }
    // What the next main call is expected to cost is held back from the sub-reads its tools make.
    ctx.budget.reserve(costEstimate(nextInput, expectedOutput));
  }
  return { stopped: null, budgetStopped: false };
}

const costEstimate = (input: number, output: number) => (input * 5 + output * 25) / 1_000_000;

/** Runs one mode end to end. Never throws for a run that started: the result's `exit` and run record say what happened. */
export async function runSteward(o: StewardOptions): Promise<StewardResult> {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  const log = o.log ?? ((l: string) => console.log(l));
  const started = now();
  const key = o.runRef ?? defaultRunRef(env, started);
  const requestId = o.requestId || null;

  if (o.mode === "apply") return runApply(o, key, started, requestId, now, log);

  const asked = o.budget ?? (o.mode === "audit" ? DEFAULT_BUDGETS.audit : o.mode === "answer" ? DEFAULT_BUDGETS.answer : DEFAULT_BUDGETS.dispatch);
  const spentWeek = await weeklySpent(o.store, started);
  const budgetUsd = runBudget(asked, spentWeek);
  const run = emptyRun({ key, mode: o.mode, started: started.toISOString(), budget: budgetUsd, requestId });
  const handle = await o.store.open("pipeline", STEWARD_SOURCE, key, { mode: o.mode, budget_usd: budgetUsd, ...(requestId ? { request_id: requestId } : {}) });
  const cache: StewardContext["cache"] = { records: new Map() };
  const docs = documentDeps({ store: o.store, cache }, o.archive ?? createArchive({ env: env as Record<string, string | undefined>, log }), o.fetchBytes ?? politeFetchBytes(log));
  const writer = new StewardWriter(o.store, handle, { run: key, now, manifest: docs.manifest });
  const ctx: StewardContext = {
    store: o.store,
    writer,
    docs,
    site: o.site ?? bundledSite(),
    client: null,
    budget: new Budget(budgetUsd),
    now,
    run: key,
    log,
    progress: { cluster: null, tool: null, calls: 0 },
    cache,
  };

  let exit: StewardResult["exit"] = EXIT.done;
  let message: string | undefined;
  try {
    if (budgetUsd <= 0) {
      run.stopped = `the week's $${WEEKLY_CAP_USD} cap is spent ($${spentWeek.toFixed(2)} in the last seven days)`;
      exit = EXIT.budget;
    } else {
      const client = o.client ?? makeClient(o.dryRun ?? null, env);
      ctx.client = client;
      const all = await clusters(ctx);
      run.clusters = all.length;
      let result: { stopped: string | null; budgetStopped: boolean };
      if (o.mode === "run") {
        if (o.cause && !all.some((c) => c.key === o.cause)) throw new Error(`no open cluster "${o.cause}"`);
        result = await mainLoop(ctx, client, runTask({ budgetUsd, cause: o.cause, unit: o.unit, clusters: all.length, openItems: (await openQueue(ctx)).size }), "run");
      } else if (o.mode === "audit") {
        const family = auditFamily(started);
        const records = (await readLayer<CollegeRecord>(o.store, COLLECTIONS.reported.cdsRecords)).values();
        const sample = auditSample(records, family, `${started.getUTCFullYear()}-w${weekOf(started)}`);
        if (!sample.length) {
          result = { stopped: null, budgetStopped: false };
          log(`audit: no passed ${family} values to sample`);
        } else {
          result = await mainLoop(ctx, client, auditTask(family, sample, budgetUsd), "audit");
          await issueForAudit(o.store, writer, family);
        }
      } else {
        if (!o.proposal) throw new Error("--mode answer needs --proposal <key>");
        const p = await o.store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, o.proposal);
        if (!p) throw new Error(`no proposal ${o.proposal}`);
        if (!p.question) throw new Error(`proposal ${o.proposal} has no question to answer`);
        result = await mainLoop(ctx, client, answerTask(p, budgetUsd), "answer", { answerFor: p.key });
      }
      run.stopped = result.stopped;
      if (result.budgetStopped) exit = EXIT.budget;
    }
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof MissingAnswer ? err.cause : err;
    message = cause instanceof Error ? cause.message : String(cause);
    run.stopped = `failed after ${ctx.progress.calls} model call(s): ${message}`.slice(0, 500);
    exit = EXIT.failed;
  }

  Object.assign(run, writer.counts, { spent_usd: ctx.budget.spent(), finished: now().toISOString() });
  try {
    await writer.put(COLLECTIONS.steward.runs, key, run);
    // A Steward set holds only steward.* documents, never composed, so it closes applied even after a failure: a held
    // set would stop the publisher's automatic runs.
    await handle.close("applied", undefined, { mode: o.mode, spent_usd: run.spent_usd, stopped: run.stopped });
  } catch (err) {
    message = `${message ? `${message}; ` : ""}writing the run record failed: ${err instanceof Error ? err.message : String(err)}`;
    exit = EXIT.failed;
  }
  log(`steward ${o.mode} ${key}: $${run.spent_usd.toFixed(2)} of $${budgetUsd.toFixed(2)}; ${run.issues} issue(s), ${run.proposals} proposal(s), ${run.todo} To do, ${run.decisions} decision(s), ${run.audits} audit(s)${run.stopped ? `; stopped: ${run.stopped}` : ""}`);
  return { exit, run, changeSet: handle.id, publish: false, ...(message ? { message } : {}) };
}

/** An audit over the rate opens (or updates) the family's issue. */
async function issueForAudit(store: DataStore, writer: StewardWriter, family: string): Promise<void> {
  for (const k of writer.written.get(COLLECTIONS.steward.audits) ?? []) {
    const a = await store.readOne<AuditDoc>(COLLECTIONS.steward.audits, k);
    if (!a || a.rate <= AUDIT_ISSUE_RATE) continue;
    await writer.writeIssue({
      key: `audit|${family}`,
      kind: "systemic",
      hypothesis: `${Math.round(a.rate * 100)}% of a sample of ${a.checked} published ${family} values disagree with their documents (audit ${a.key}); passed values in this family are not reliable.`,
      findings: a.wrong.map((r) => ({ unit_id: r.unit_id, edition: r.edition, sha256: r.sha256, url: r.source?.url ?? null, page: r.source?.page ?? null, line: r.source?.line ?? null, shows: r.proposed })),
      status: "new",
    });
  }
}

function makeClient(dryRun: string | null, env: Env): Anthropic {
  if (dryRun) {
    const record = mayRecord(env);
    return new Anthropic({ apiKey: record ? env.ANTHROPIC_API_KEY! : "dry-run", fetch: recordedFetch(dryRun, { env }), maxRetries: 0 });
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (or pass --dry-run <answers dir>)");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

async function runApply(o: StewardOptions, key: string, started: Date, requestId: string | null, now: () => Date, log: (l: string) => void): Promise<StewardResult> {
  const run = emptyRun({ key, mode: "apply", started: started.toISOString(), budget: 0, requestId });
  if (!o.proposal) return { exit: EXIT.failed, run: { ...run, stopped: "--mode apply needs --proposal <key>" }, changeSet: null, publish: false, message: "--mode apply needs --proposal <key>" };
  const handle: ChangeSetHandle = await o.store.open("pipeline", APPLY_SOURCE, key, { proposal: o.proposal, ...(requestId ? { request_id: requestId } : {}) });
  let publish = false;
  let exit: StewardResult["exit"] = EXIT.done;
  let message: string | undefined;
  try {
    const res = await applyProposal(o.store, handle, o.proposal, { today: started.toISOString().slice(0, 10), log });
    publish = res.publish;
    run.proposals = 1;
    await handle.write(COLLECTIONS.steward.runs, [{ key, body: { ...run, finished: now().toISOString() } }]);
    await handle.close("applied", undefined, { proposal: o.proposal, kind: res.kind, rows: res.applied, publish });
    log(`apply ${o.proposal}: ${res.applied} row(s) applied${res.skipped ? `, ${res.skipped} not approved` : ""}; ${publish ? "a record changed: ask the publisher" : "no record changed"}`);
    return { exit, run: { ...run, finished: now().toISOString() }, changeSet: handle.id, publish };
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    exit = EXIT.failed;
    // Nothing of a refused or failed apply may publish: the set closes held with the reason.
    await handle.close("held", `steward apply ${o.proposal} failed: ${message}`.slice(0, 500)).catch(() => {});
    log(`apply ${o.proposal} failed: ${message}`);
    return { exit, run: { ...run, stopped: message }, changeSet: handle.id, publish: false, message };
  }
}

function writeOutputs(env: Env, out: Record<string, string>): void {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(""));
}

/** The CLI: flags → `runSteward`, the exit code, and the step outputs. */
export async function main(argv: string[] = process.argv.slice(2), env: Env = process.env): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      store: { type: "string" },
      mode: { type: "string", default: "run" },
      budget: { type: "string" },
      cause: { type: "string" },
      unit: { type: "string" },
      proposal: { type: "string" },
      "run-ref": { type: "string" },
      "request-id": { type: "string" },
      "dry-run": { type: "string" },
    },
  });
  const mode = values.mode as StewardMode;
  if (!MODES.includes(mode)) throw new Error(`--mode ${values.mode}: expected ${MODES.join(", ")}`);
  const budget = values.budget === undefined || values.budget === "" ? undefined : Number(values.budget);
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new Error(`--budget ${values.budget}: a dollar amount`);
  if (values.unit && !/^\d{6}$/.test(values.unit)) throw new Error(`--unit ${values.unit}: a six-digit unit id`);
  const store = storeFromFlag(values.store, env, { log: (l) => console.log(l) });
  const res = await runSteward({
    mode,
    store,
    budget,
    cause: values.cause || null,
    unit: values.unit || null,
    proposal: values.proposal || null,
    runRef: values["run-ref"] || undefined,
    requestId: values["request-id"] || null,
    dryRun: values["dry-run"] || null,
    env,
  });
  if (res.message) console.error(res.message);
  writeOutputs(env, { exit_code: String(res.exit), change_set: String(res.changeSet ?? ""), publish: String(res.publish) });
  return res.exit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}

export type { Archive };
