/**
 * Model config for the college-reported pipeline: which model does which job (REPORTED_MODELS and ROUND3_MODELS,
 * lib/reported.ts), what each costs interactively and in a batch, the per-call log, and the round-3 run summary's
 * accumulators (specs/college-reported-round-3.md, Decisions 4, 5, 11).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CALL_JOBS,
  DISCOVERY_PATHS,
  REPORTED_MODELS,
  REPORTED_TIERS,
  ROUND3_MODELS,
  type CallJob,
  type CallLog,
  type CallMode,
  type RunSummary,
  type RunSummaryV3,
  type UsageRow,
} from "../../../lib/reported.ts";
import { DOCUMENT_TYPES } from "../../../lib/cds-sections.ts";

export { REPORTED_MODELS, ROUND3_MODELS };
export type Job = keyof typeof REPORTED_MODELS;

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/** US dollars per million tokens for one mode. */
export interface Rates {
  input: number;
  output: number;
  /** Prompt-cache writes: 1.25× input for the 5-minute TTL, 2× for the 1-hour TTL. */
  cache_write_5m: number;
  cache_write_1h: number;
  /** Prompt-cache reads: 0.1× input (0.05× on Opus 5.5). */
  cache_read: number;
}

export interface ModelPrice {
  interactive: Rates;
  /** Message Batches: 50% off every token, cache reads and writes included. */
  batch: Rates;
}

function rates(input: number, output: number, cacheRead: number): ModelPrice {
  const r = (f: number): Rates => ({ input: input * f, output: output * f, cache_write_5m: input * 1.25 * f, cache_write_1h: input * 2 * f, cache_read: cacheRead * f });
  return { interactive: r(1), batch: r(0.5) };
}

/**
 * List prices from the claude-api skill (model table cached 2026-06-24; checked 2026-10-03): Haiku 4.5 $1/$5, Sonnet 5
 * $2/$10, Opus 5.5 $4/$20 with cache reads at $0.20 (0.05×). Batches are 50% off every token including cache reads and
 * writes. ESTIMATES: a run's logged cost is only as current as this table; check https://claude.com/pricing when a model
 * changes. A model missing here is refused, never logged at $0 (Decision 5's cap would go blind).
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": rates(1, 5, 0.1),
  "claude-sonnet-5": rates(2, 10, 0.2),
  "claude-opus-5-5": rates(4, 20, 0.2),
};

/** Web search is billed per search on top of tokens ($10 per 1,000); assumed not discounted in batches. Fetch is free. */
export const WEB_SEARCH_PRICE_USD = 10 / 1000;

/**
 * The minimum prefix each model caches, in tokens (claude-api skill, prompt caching): shorter prefixes silently don't
 * cache, so the marker only goes on a prefix at or above this.
 */
export const MIN_CACHE_PREFIX: Record<string, number> = {
  "claude-haiku-4-5": 4096,
  "claude-sonnet-5": 1024,
  "claude-opus-5-5": 1024,
};

export class UnpricedModelError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`no price for model "${model}" in MODEL_PRICES (scripts/lib/college-reported/models.mts); refusing to run with a blind cost cap`);
    this.name = "UnpricedModelError";
    this.model = model;
  }
}

/**
 * The table's key for a model id. Requests name the alias ("claude-haiku-4-5"), but responses, including Message
 * Batches results, name the dated snapshot it resolved to ("claude-haiku-4-5-20251001"), so a trailing -YYYYMMDD is
 * dropped. Any other unknown id stays unknown, so the cost cap is never blind.
 */
export function priceKey(model: string): string {
  if (MODEL_PRICES[model]) return model;
  const alias = model.replace(/-\d{8}$/, "");
  return MODEL_PRICES[alias] ? alias : model;
}

/** The model's price; throws for a model the table doesn't list (a dated snapshot of a listed alias is listed). */
export function priceOf(model: string): ModelPrice {
  const p = MODEL_PRICES[priceKey(model)];
  if (!p) throw new UnpricedModelError(model);
  return p;
}

/** Throws unless every model the pipeline is configured to call has a price. The CLI calls this before anything else. */
export function assertPriced(models: Iterable<string> = [...Object.values(REPORTED_MODELS), ...Object.values(ROUND3_MODELS)]): void {
  for (const m of models) priceOf(m);
}

/** The usage fields costOf reads (an `Anthropic.Usage` fits; tests pass plain objects). */
export type UsageLike = Pick<Anthropic.Usage, "input_tokens" | "output_tokens"> &
  Partial<Pick<Anthropic.Usage, "cache_creation_input_tokens" | "cache_read_input_tokens" | "cache_creation" | "server_tool_use">>;

/**
 * Cost of one response in US dollars. `input_tokens` in the API's usage is the uncached part; cache writes are split
 * into the 5-minute and 1-hour TTLs when the response says so (else all at the 5-minute rate). Throws for an unpriced
 * model.
 */
export function costOf(model: string, usage: UsageLike, opts: { mode?: CallMode } = {}): number {
  const r = priceOf(model)[opts.mode ?? "interactive"];
  const written = usage.cache_creation_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const fiveMin = usage.cache_creation ? usage.cache_creation.ephemeral_5m_input_tokens : written;
  const tokens =
    usage.input_tokens * r.input +
    fiveMin * r.cache_write_5m +
    oneHour * r.cache_write_1h +
    (usage.cache_read_input_tokens ?? 0) * r.cache_read +
    usage.output_tokens * r.output;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return tokens / 1e6 + searches * WEB_SEARCH_PRICE_USD;
}

/** Rounds dollars to a millionth (the summary files' precision). */
export const roundUsd = (n: number) => Math.round(n * 1e6) / 1e6;

/* ------------------------------------------------------------------ */
/* Round 2 usage log (kept: the PR body reads summary.usage)           */
/* ------------------------------------------------------------------ */

export type UsageLog = RunSummary["usage"];

export function emptyUsage(): UsageLog {
  const one = () => ({ calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
  return { discovery: one(), extraction: one(), escalation: one() };
}

/** Adds one response's usage to the run's log under `job`. */
export function addUsage(log: UsageLog, job: Job, model: string, usage: UsageLike | undefined, opts: { mode?: CallMode } = {}): void {
  if (!usage) return;
  const u = log[job];
  u.calls++;
  u.input_tokens += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  u.output_tokens += usage.output_tokens;
  // Detail for reading a run's cost: how much of the input was cache reads, and how many searches were billed.
  u.cache_read_input_tokens = (u.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  u.cache_creation_input_tokens = (u.cache_creation_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  u.web_searches = (u.web_searches ?? 0) + (usage.server_tool_use?.web_search_requests ?? 0);
  u.cost_usd = roundUsd(u.cost_usd + costOf(model, usage, opts));
}

/* ------------------------------------------------------------------ */
/* Per-call log: data/reports/college-reported-calls-<run>.jsonl       */
/* ------------------------------------------------------------------ */

/** Where call rows go. Injectable so tests collect rows in memory. */
export interface CallLogWriter {
  append(row: CallLog): void;
}

/** The calls file for a run (colons in an ISO run id become dashes, as in the run summary's name). */
export function callsFile(reportsDir: string, run: string): string {
  return join(reportsDir, `college-reported-calls-${run.replace(/[:]/g, "-")}.jsonl`);
}

/** Appends one JSON line per call to the run's calls file. */
export function fileCallLogWriter(reportsDir: string, run: string): CallLogWriter {
  const file = callsFile(reportsDir, run);
  return {
    append(row) {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(row)}\n`);
    },
  };
}

/** An in-memory writer (tests, dry runs). */
export function memoryCallLogWriter(): CallLogWriter & { rows: CallLog[] } {
  const rows: CallLog[] = [];
  return { rows, append: (row) => void rows.push(row) };
}

/** Builds a CallLog row from a response's usage, pricing it at the call's mode. */
export function callLogRow(
  base: Omit<CallLog, "input_tokens" | "cache_write_tokens" | "cache_read_tokens" | "output_tokens" | "searches" | "cost_usd" | "stop_reason">,
  usage: UsageLike,
  stop_reason: string | null,
): CallLog {
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  return {
    ...base,
    input_tokens: usage.input_tokens + write + read,
    cache_write_tokens: write,
    cache_read_tokens: read,
    output_tokens: usage.output_tokens,
    searches: usage.server_tool_use?.web_search_requests ?? 0,
    stop_reason,
    cost_usd: roundUsd(costOf(base.model, usage, { mode: base.mode })),
  };
}

/* ------------------------------------------------------------------ */
/* Round 3 run summary                                                 */
/* ------------------------------------------------------------------ */

/** Round 2's job a round-3 job's cost is also counted under, so `summary.usage` (and the PR body's total) stay whole. */
const LEGACY_JOB: Record<CallJob, Job> = {
  picker: "discovery",
  search: "discovery",
  discovery: "discovery",
  extraction: "extraction",
  vision: "extraction",
  escalation: "escalation",
};

export function emptySummaryV3(run: string, started: string): RunSummaryV3 {
  const zeroDoc = () => ({ fetched: 0, unchanged: 0, archived: 0, model_calls: 0, split_fallback: 0, grid_rows_undecided: 0, vision: 0, cost_usd: 0 });
  return {
    run,
    started,
    finished: null,
    status: "running",
    attempted: 0,
    documents_read: 0,
    published: 0,
    changed: 0,
    failed: 0,
    discovered: 0,
    escalated: 0,
    tripped: null,
    usage: emptyUsage(),
    round: 3,
    usage_rows: [],
    discovery: Object.fromEntries(DISCOVERY_PATHS.map((p) => [p, { colleges: 0, cost_usd: 0 }])) as RunSummaryV3["discovery"],
    documents: Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, zeroDoc()])) as RunSummaryV3["documents"],
    items: {},
    tiers: Object.fromEntries(REPORTED_TIERS.map((t) => [t, { colleges: 0, located: 0, cds_found: 0, published_c1: 0, cost_usd: 0 }])) as RunSummaryV3["tiers"],
    batches: [],
    projection: null,
  };
}

/**
 * Adds one call to the summary: its `usage_rows` row (job × model × mode × call), round 2's `usage` record, and, for a
 * document call, the document type's model calls and cost.
 */
export function addCall(summary: RunSummaryV3, row: CallLog): void {
  const call = row.call ?? undefined;
  let u = summary.usage_rows.find((r) => r.job === row.job && r.model === row.model && r.mode === row.mode && r.call === call);
  if (!u) {
    u = { job: row.job, model: row.model, mode: row.mode, ...(call ? { call } : {}), calls: 0, input_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, output_tokens: 0, searches: 0, cost_usd: 0 };
    summary.usage_rows.push(u);
    summary.usage_rows.sort(compareRows);
  }
  u.calls++;
  u.input_tokens += row.input_tokens;
  u.cache_write_tokens += row.cache_write_tokens;
  u.cache_read_tokens += row.cache_read_tokens;
  u.output_tokens += row.output_tokens;
  u.searches += row.searches;
  u.cost_usd = roundUsd(u.cost_usd + row.cost_usd);

  const legacy = summary.usage[LEGACY_JOB[row.job]];
  legacy.calls++;
  legacy.input_tokens += row.input_tokens;
  legacy.output_tokens += row.output_tokens;
  legacy.cache_read_input_tokens = (legacy.cache_read_input_tokens ?? 0) + row.cache_read_tokens;
  legacy.cache_creation_input_tokens = (legacy.cache_creation_input_tokens ?? 0) + row.cache_write_tokens;
  legacy.web_searches = (legacy.web_searches ?? 0) + row.searches;
  legacy.cost_usd = roundUsd(legacy.cost_usd + row.cost_usd);

  if (row.document_type) {
    const d = summary.documents[row.document_type];
    d.model_calls++;
    if (row.job === "vision") d.vision++;
    d.cost_usd = roundUsd(d.cost_usd + row.cost_usd);
  }
}

function compareRows(a: UsageRow, b: UsageRow): number {
  return (
    CALL_JOBS.indexOf(a.job) - CALL_JOBS.indexOf(b.job) ||
    a.model.localeCompare(b.model) ||
    a.mode.localeCompare(b.mode) ||
    (a.call ?? "").localeCompare(b.call ?? "")
  );
}

/** Total cost of a summary: the sum of its usage rows (equal to the sum of round 2's `usage` record). */
export function summaryCost(summary: RunSummaryV3): number {
  return roundUsd(summary.usage_rows.reduce((n, r) => n + r.cost_usd, 0));
}

/** An `onCall` hook that writes a row to the calls file and adds it to the summary. */
export function callRecorder(summary: RunSummaryV3, writer: CallLogWriter): (row: CallLog) => void {
  return (row) => {
    writer.append(row);
    addCall(summary, row);
  };
}

/* ------------------------------------------------------------------ */
/* The client slice                                                    */
/* ------------------------------------------------------------------ */

/**
 * The slice of the Anthropic client the pipeline uses, so tests can pass a fake. A real `new Anthropic()` fits it:
 * `create` for extraction, `stream` (→ `finalMessage()`) for discovery, whose web-tool loop can run long.
 */
export interface ModelClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
    stream(body: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): { finalMessage(): Promise<Anthropic.Message> };
  };
}
