/**
 * Extraction, escalation, and picker calls as Message Batches (specs/college-reported-round-3.md, Decision 5): request
 * building with stable custom_ids, size splitting, worst-case reservations against `--max-cost`, trimming by priority,
 * submit / poll / collect, one resubmission of errored and expired requests, and the open-batch state file
 * (data/college-batches.json). Also the run's cost projection and the "projection exceeds the cap" guard.
 *
 * Nothing here reads the archive or writes records: the pipeline builds `BatchRequest`s from archived text and turns
 * collected messages into records (llm.mts parseExtractResponse). Every API call goes through the `BatchApi` slice, so
 * tests pass a fake (tests/fixtures/fake-batch-api.mts) and a real `new Anthropic().messages.batches` fits it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { ROUND3_MODELS, type BatchEntry, type BatchSummaryRow, type BatchesFile, type CallLog, type CostProjection } from "../../../lib/reported.ts";
import { maxTokensFor, type CallKey, type DocumentType } from "../../../lib/cds-sections.ts";
import { buildExtractRequest, buildPickerRequest, escalationInput, type BuiltRequest, type EscalateInput, type ExtractCallInput, type PickerInput } from "./llm.mts";
import { callLogRow, priceOf, roundUsd } from "./models.mts";
import { toWellFormedDeep } from "./well-formed.mts";

/* ------------------------------------------------------------------ */
/* The API slice                                                       */
/* ------------------------------------------------------------------ */

/** The part of `client.messages.batches` this module uses. */
export interface BatchApi {
  create(body: { requests: Anthropic.Messages.BatchCreateParams.Request[] }): Promise<Anthropic.Messages.MessageBatch>;
  retrieve(id: string): Promise<Anthropic.Messages.MessageBatch>;
  results(id: string): Promise<AsyncIterable<Anthropic.Messages.MessageBatchIndividualResponse>>;
}

/* ------------------------------------------------------------------ */
/* custom_id                                                           */
/* ------------------------------------------------------------------ */

/** Assumed custom_id rule (the skill is silent on length): letters, digits, "_" and "-", 1–64 characters. */
export const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type BatchJob = "extraction" | "escalation" | "picker";

export interface CustomIdParts {
  unit_id: string;
  /** The document's sha256 (first 8 hex characters used); for a picker, any short tag of the page set. */
  sha256: string;
  call: CallKey | "pick";
  version: number;
  /** Escalation requests end in "-x" so they never collide with the extraction request of the same call. */
  job?: BatchJob;
}

/** `u<unit_id>-<sha8>-<call>-v<version>` (escalation: `…-x`), about 25 characters. */
export function customId(p: CustomIdParts): string {
  const id = `u${p.unit_id}-${p.sha256.slice(0, 8)}-${p.call}-v${p.version}${p.job === "escalation" ? "-x" : ""}`;
  if (!CUSTOM_ID.test(id)) throw new Error(`custom_id "${id}" breaks ${CUSTOM_ID}`);
  return id;
}

export function parseCustomId(id: string): (CustomIdParts & { sha8: string }) | null {
  const m = /^u(\d+)-([0-9a-f]{1,8})-(C|rest|pick)-v(\d+)(-x)?$/.exec(id);
  if (!m) return null;
  return { unit_id: m[1], sha256: m[2], sha8: m[2], call: m[3] as CustomIdParts["call"], version: Number(m[4]), job: m[5] ? "escalation" : m[3] === "pick" ? "picker" : "extraction" };
}

/* ------------------------------------------------------------------ */
/* Requests and reservations                                           */
/* ------------------------------------------------------------------ */

/** One request ready for a batch, with what the pipeline needs to key, price, trim, and log it. */
export interface BatchRequest {
  custom_id: string;
  params: Anthropic.MessageCreateParamsNonStreaming;
  job: BatchJob;
  unit_id: string;
  sha256: string;
  call: CallKey | null;
  document_type: DocumentType | null;
  /** Lower is more important (tier order, then enrollment; Decision 7). Trimming drops the highest numbers first. */
  priority: number;
  /** Prompt characters the reservation is estimated from (llm.mts BuiltRequest.chars). */
  chars: number;
  estimated_input_tokens: number;
  /** For a scanned PDF sent as a document block: its pages, reserved at SCANNED_PAGE_TOKENS each instead of by characters. */
  pdf_pages?: number;
  /** Worst-case cost (reserve()). */
  reserved_usd: number;
}

/** Reservation safety margin on the character estimate (Decision 5). */
export const RESERVE_MARGIN = 1.2;
/** Assumed tokens per scanned PDF page sent as a document block (text plus page image; Decision 4, an assumption). */
export const SCANNED_PAGE_TOKENS = 3000;

/**
 * A request's worst case: estimated input (characters ÷ 3.5 × 1.2, or pages × 3,000 for a scanned PDF) at the batch
 * input price, plus its full `max_tokens` at the batch output price. Throws for an unpriced model.
 */
export function reserve(req: Pick<BatchRequest, "params" | "chars" | "pdf_pages">): number {
  const r = priceOf(req.params.model).batch;
  const textTokens = (req.chars / 3.5) * RESERVE_MARGIN;
  const pdfTokens = (req.pdf_pages ?? 0) * SCANNED_PAGE_TOKENS * RESERVE_MARGIN;
  return roundUsd(((textTokens + pdfTokens) * r.input + req.params.max_tokens * r.output) / 1e6);
}

function toRequest(built: BuiltRequest, meta: Omit<BatchRequest, "params" | "chars" | "estimated_input_tokens" | "reserved_usd">): BatchRequest {
  const req = { ...meta, params: built.params, chars: built.chars, estimated_input_tokens: built.estimated_input_tokens, reserved_usd: 0 };
  req.reserved_usd = reserve(req);
  return req;
}

/** One model-read document waiting for extraction: its calls' inputs (from the archive's numbered lines). */
export interface PendingDocument {
  unit_id: string;
  sha256: string;
  priority: number;
  /** Each call to read, at the schema version it is read at (SCHEMA_VERSIONS). `mode` is forced to "batch". */
  calls: Array<{ input: Omit<ExtractCallInput, "mode">; version: number }>;
  pdf_pages?: number;
}

/** Extraction requests for documents, one per call, `custom_id = u<unit_id>-<sha8>-<call>-v<version>`. */
export function buildRequests(docs: readonly PendingDocument[]): BatchRequest[] {
  const out: BatchRequest[] = [];
  for (const d of docs) {
    for (const { input, version } of d.calls) {
      const built = buildExtractRequest({ ...input, mode: "batch" });
      out.push(
        toRequest(built, {
          custom_id: customId({ unit_id: d.unit_id, sha256: d.sha256, call: input.call, version }),
          job: input.job === "escalation" ? "escalation" : "extraction",
          unit_id: d.unit_id,
          sha256: d.sha256,
          call: input.call,
          document_type: input.doc.document_type,
          priority: d.priority,
          ...(d.pdf_pages ? { pdf_pages: d.pdf_pages } : {}),
        }),
      );
    }
  }
  assertUniqueIds(out);
  return out;
}

/** Escalation requests (Sonnet 5, the call's pages, the failing codes), `custom_id` ending in "-x". */
export function buildEscalationRequests(items: ReadonlyArray<{ sha256: string; priority: number; version: number; input: Omit<EscalateInput, "mode"> }>): BatchRequest[] {
  const out = items.map(({ sha256, priority, version, input }) => {
    const built = buildExtractRequest(escalationInput({ ...input, mode: "batch" }));
    return toRequest(built, {
      custom_id: customId({ unit_id: input.doc.unit_id, sha256, call: input.call, version, job: "escalation" }),
      job: "escalation",
      unit_id: input.doc.unit_id,
      sha256,
      call: input.call,
      document_type: input.doc.document_type,
      priority,
    });
  });
  assertUniqueIds(out);
  return out;
}

/** Picker requests (Haiku), `custom_id = u<unit_id>-<tag8>-pick-v1`. */
export function buildPickerRequests(items: ReadonlyArray<{ tag: string; priority: number; input: Omit<PickerInput, "mode"> }>): BatchRequest[] {
  const out = items.map(({ tag, priority, input }) => {
    const built = buildPickerRequest({ ...input, mode: "batch" });
    return toRequest(built, {
      custom_id: customId({ unit_id: input.college.unit_id, sha256: tag, call: "pick", version: 1, job: "picker" }),
      job: "picker",
      unit_id: input.college.unit_id,
      sha256: tag,
      call: null,
      document_type: null,
      priority,
    });
  });
  assertUniqueIds(out);
  return out;
}

function assertUniqueIds(reqs: readonly BatchRequest[]): void {
  const seen = new Set<string>();
  for (const r of reqs) {
    if (seen.has(r.custom_id)) throw new Error(`duplicate custom_id ${r.custom_id}`);
    seen.add(r.custom_id);
  }
}

/** The API's limits are 256 MB and 100,000 requests per batch; we split at 200 MB (Decision 5). */
export const BATCH_MAX_BYTES = 200 * 1024 * 1024;
export const BATCH_MAX_REQUESTS = 100_000;

/** Bytes a request adds to the batch body. */
export function requestBytes(req: Pick<BatchRequest, "custom_id" | "params">): number {
  return Buffer.byteLength(JSON.stringify({ custom_id: req.custom_id, params: req.params }), "utf8");
}

/**
 * Splits requests into batches under `maxBytes` and `maxRequests`, keeping order. One request bigger than the limit
 * alone is an error (it can never be sent).
 */
export function splitBySize<T extends Pick<BatchRequest, "custom_id" | "params">>(requests: readonly T[], maxBytes = BATCH_MAX_BYTES, maxRequests = BATCH_MAX_REQUESTS): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of requests) {
    const b = requestBytes(r) + 1;
    if (b > maxBytes) throw new Error(`request ${r.custom_id} is ${b} bytes, over the ${maxBytes}-byte batch limit`);
    if (cur.length && (bytes + b > maxBytes || cur.length >= maxRequests)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Keeps requests, most important first, while `spent` plus everything reserved (open batches' reservations included in
 * `spent`) stays within `cap`. Whole documents are kept or trimmed together (both calls of one sha256), lowest priority
 * trimmed first. Trimmed documents are only returned: they stay archived and the next run submits them, no refetch.
 */
export function trimToCap<T extends Pick<BatchRequest, "unit_id" | "sha256" | "priority" | "reserved_usd">>(
  requests: readonly T[],
  spent: number,
  cap: number,
  priority: (r: T) => number = (r) => r.priority,
): { kept: T[]; trimmed: T[]; reserved_usd: number } {
  const groups = new Map<string, T[]>();
  for (const r of requests) {
    const k = `${r.unit_id}:${r.sha256}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const ordered = [...groups.values()].sort((a, b) => Math.min(...a.map(priority)) - Math.min(...b.map(priority)));
  const kept: T[] = [];
  const trimmed: T[] = [];
  let reserved = 0;
  let full = false;
  for (const g of ordered) {
    const cost = g.reduce((n, r) => n + r.reserved_usd, 0);
    // Once one document doesn't fit, everything after it is trimmed too, so priority order is never skipped over.
    if (!full && spent + reserved + cost <= cap) {
      kept.push(...g);
      reserved += cost;
    } else {
      full = true;
      trimmed.push(...g);
    }
  }
  return { kept, trimmed, reserved_usd: roundUsd(reserved) };
}

/* ------------------------------------------------------------------ */
/* State: data/college-batches.json                                    */
/* ------------------------------------------------------------------ */

export function emptyBatchesFile(): BatchesFile {
  return { updated: null, batches: [] };
}

export function readBatches(file: string): BatchesFile {
  if (!existsSync(file)) return emptyBatchesFile();
  return JSON.parse(readFileSync(file, "utf8")) as BatchesFile;
}

export function writeBatches(file: string, state: BatchesFile): void {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Money held by open batches: counts against the cap until collected. */
export function openReservations(state: BatchesFile): number {
  return roundUsd(state.batches.reduce((n, b) => n + b.reserved_usd, 0));
}

/** The workflow's signal (specs/college-reported-setup.md): batches are still open, so the PR stays a draft. */
export function hasOpenBatches(state: BatchesFile): boolean {
  return state.batches.length > 0;
}

/* ------------------------------------------------------------------ */
/* Submit, poll, collect, resubmit                                     */
/* ------------------------------------------------------------------ */

export interface SubmitOptions {
  run: string;
  phase: BatchEntry["phase"];
  now: () => Date;
  maxBytes?: number;
  /** custom_ids in `requests` that are resubmissions (recorded so a second failure is queued, not resubmitted). */
  resubmits?: ReadonlySet<string>;
}

/**
 * Submits requests as one or more batches (split by size, and by model so each batch is priced by one model), adds an
 * entry per batch to `state`, and returns the entries. The caller writes the state file after each submit.
 */
export async function submit(api: BatchApi, requests: readonly BatchRequest[], state: BatchesFile, opts: SubmitOptions): Promise<BatchEntry[]> {
  const byModel = new Map<string, BatchRequest[]>();
  for (const r of requests) byModel.set(r.params.model, [...(byModel.get(r.params.model) ?? []), r]);
  const entries: BatchEntry[] = [];
  for (const [model, reqs] of byModel) {
    for (const chunk of splitBySize(reqs, opts.maxBytes)) {
      // A lone surrogate anywhere in params (page text, link text) makes JSON.stringify emit invalid JSON the API
      // rejects outright, failing the whole batch; well-form every string so that can't happen.
      const batch = await api.create({ requests: chunk.map((r) => ({ custom_id: r.custom_id, params: toWellFormedDeep(r.params) })) });
      const resubmits = chunk.filter((r) => opts.resubmits?.has(r.custom_id)).map((r) => r.custom_id);
      const entry: BatchEntry = {
        id: batch.id,
        phase: opts.phase,
        submitted: opts.now().toISOString(),
        requests: chunk.length,
        reserved_usd: roundUsd(chunk.reduce((n, r) => n + r.reserved_usd, 0)),
        custom_ids: chunk.map((r) => r.custom_id),
        run: opts.run,
        model,
        ...(resubmits.length ? { resubmits } : {}),
      };
      state.batches.push(entry);
      state.updated = opts.now().toISOString();
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Polls a batch until it has `ended` or `deadline` passes. Returns the ended batch, or null when the deadline came first
 * (the batch stays in the state file for the collect job).
 */
export async function poll(
  api: BatchApi,
  id: string,
  opts: { now: () => Date; sleep: (ms: number) => Promise<void>; intervalMs?: number; deadline: Date },
): Promise<Anthropic.Messages.MessageBatch | null> {
  const interval = opts.intervalMs ?? 60_000;
  for (;;) {
    const b = await api.retrieve(id);
    if (b.processing_status === "ended") return b;
    if (opts.now().getTime() + interval > opts.deadline.getTime()) return null;
    await opts.sleep(interval);
  }
}

/** How one request came back. `invalid_request` is an errored result whose error is the request's own fault. */
export type ResultClass = "succeeded" | "errored" | "expired" | "invalid_request" | "canceled";

export interface Collected {
  batch: BatchEntry;
  /** Succeeded messages by custom_id (results arrive in any order). */
  succeeded: Map<string, Anthropic.Message>;
  /** custom_ids by outcome. */
  errored: string[];
  expired: string[];
  invalid_request: string[];
  canceled: string[];
  /** custom_ids the batch listed that never came back in the results (treated like expired). */
  absent: string[];
  /**
   * The API's own message for each errored or invalid result, by custom_id ("output_config.format.schema: ..."),
   * so a review item says why. The first live run kept only the type, and its cause had to be inferred.
   */
  error_messages: Map<string, string>;
  /** Actual cost of the succeeded results at batch prices; replaces `batch.reserved_usd`. */
  cost_usd: number;
  /** One call-log row per succeeded result. */
  calls: CallLog[];
  summary: BatchSummaryRow;
}

export function classify(r: Anthropic.Messages.MessageBatchResult): ResultClass {
  if (r.type === "errored") return r.error?.error?.type === "invalid_request_error" ? "invalid_request" : "errored";
  return r.type;
}

/**
 * Streams an ended batch's results, keys them by custom_id, prices each succeeded message at batch rates, and removes
 * the batch from `state` (settling its reservation into actual cost). `estimates` gives each request's estimated input
 * tokens for the calls file when the caller still has them.
 */
export async function collect(
  api: BatchApi,
  entry: BatchEntry,
  state: BatchesFile,
  opts: { now: () => Date; ended?: string | null; meta?: (custom_id: string) => Partial<Pick<CallLog, "document_type" | "estimated_input_tokens">> | undefined },
): Promise<Collected> {
  const out: Collected = {
    batch: entry,
    succeeded: new Map(),
    errored: [],
    expired: [],
    invalid_request: [],
    canceled: [],
    absent: [],
    error_messages: new Map(),
    cost_usd: 0,
    calls: [],
    summary: { id: entry.id, requests: entry.requests, submitted: entry.submitted, ended: opts.ended ?? null, succeeded: 0, errored: 0, expired: 0, reserved_usd: entry.reserved_usd, cost_usd: 0 },
  };
  const wanted = new Set(entry.custom_ids);
  const seen = new Set<string>();
  for await (const r of await api.results(entry.id)) {
    if (!wanted.has(r.custom_id) || seen.has(r.custom_id)) continue;
    seen.add(r.custom_id);
    const kind = classify(r.result);
    if (kind === "succeeded" && r.result.type === "succeeded") {
      const msg = r.result.message;
      out.succeeded.set(r.custom_id, msg);
      const parts = parseCustomId(r.custom_id);
      const meta = opts.meta?.(r.custom_id);
      const row = callLogRow(
        {
          run: entry.run,
          at: opts.now().toISOString(),
          college: parts?.unit_id ?? "",
          job: parts?.job === "picker" ? "picker" : parts?.job === "escalation" ? "escalation" : "extraction",
          model: msg.model,
          mode: "batch",
          document_type: meta?.document_type ?? null,
          call: parts && parts.call !== "pick" ? parts.call : null,
          custom_id: r.custom_id,
          batch: entry.id,
          estimated_input_tokens: meta?.estimated_input_tokens ?? null,
        },
        msg.usage,
        msg.stop_reason,
      );
      out.calls.push(row);
      out.cost_usd += row.cost_usd;
    } else if (kind === "errored") out.errored.push(r.custom_id);
    else if (kind === "expired") out.expired.push(r.custom_id);
    else if (kind === "invalid_request") out.invalid_request.push(r.custom_id);
    else out.canceled.push(r.custom_id);
    if (r.result.type === "errored") {
      const message = (r.result.error as { error?: { message?: string } } | undefined)?.error?.message;
      if (message) out.error_messages.set(r.custom_id, message);
    }
  }
  out.absent = entry.custom_ids.filter((id) => !seen.has(id));
  out.cost_usd = roundUsd(out.cost_usd);
  out.summary = { ...out.summary, succeeded: out.succeeded.size, errored: out.errored.length + out.invalid_request.length, expired: out.expired.length + out.absent.length, cost_usd: out.cost_usd };
  state.batches = state.batches.filter((b) => b.id !== entry.id);
  state.updated = opts.now().toISOString();
  return out;
}

/**
 * Decision 5's retry rule: `errored` (server side), `expired`, canceled, and absent requests are resubmitted once in the
 * next batch; a request that already was a resubmission, an `invalid_request`, or one `rebuild` can't recreate is queued.
 * `rebuild` recreates a request from the archive by custom_id (the state file keeps ids, not bodies).
 */
export function resubmitOnce(collected: Collected, rebuild: (custom_id: string) => BatchRequest | null): { retry: BatchRequest[]; queue: Array<{ custom_id: string; reason: string }> } {
  const already = new Set(collected.batch.resubmits ?? []);
  const retry: BatchRequest[] = [];
  const queue: Array<{ custom_id: string; reason: string }> = [];
  const why = (id: string, kind: string) => {
    const m = collected.error_messages?.get(id);
    return m ? `${kind}: ${m.slice(0, 300)}` : kind;
  };
  for (const id of collected.invalid_request) queue.push({ custom_id: id, reason: why(id, "invalid_request") });
  const retryable: Array<[string, string]> = [
    ...collected.errored.map((id): [string, string] => [id, why(id, "errored")]),
    ...collected.expired.map((id): [string, string] => [id, "expired"]),
    ...collected.canceled.map((id): [string, string] => [id, "canceled"]),
    ...collected.absent.map((id): [string, string] => [id, "absent"]),
  ];
  for (const [id, reason] of retryable) {
    if (already.has(id)) {
      queue.push({ custom_id: id, reason: `${reason} twice` });
      continue;
    }
    const req = rebuild(id);
    if (req) retry.push(req);
    else queue.push({ custom_id: id, reason: `${reason}; not rebuildable` });
  }
  return { retry, queue };
}

/* ------------------------------------------------------------------ */
/* Projection and the cap guard                                        */
/* ------------------------------------------------------------------ */

/**
 * Per-unit estimates (US dollars, the high end of each range in specs/college-reported-round-3.md "Expected cost", so a
 * projection errs high). Batch prices for documents and pickers; search and full discovery are interactive.
 */
export const UNIT_ESTIMATES = {
  document: {
    "xlsx-template": 0,
    "pdf-form": 0,
    "pdf-flat": 0.05,
    "xlsx-classic": 0.045,
    html: 0.045,
    "pdf-scanned": 0.12,
    "class-profile": 0.005,
  } satisfies Record<DocumentType, number>,
  discovery: { picker: 0.005, search: 0.08, full: 0.15 },
  escalation: 0.04,
} as const;

/** What prepare found: documents waiting for a model by type, colleges headed to each paid discovery step, escalations. */
export interface PreparedCounts {
  documents: Partial<Record<DocumentType, number>>;
  discovery: Partial<Record<keyof typeof UNIT_ESTIMATES.discovery, number>>;
  escalations?: number;
  /** Full-run colleges ÷ this run's colleges, for a sample or pilot projected to the full run (default 1). */
  scale?: number;
}

/** The run's projection: counts × per-unit estimates, scaled to the full run, with its basis in words. */
export function projection(prepared: PreparedCounts): CostProjection {
  const scale = prepared.scale ?? 1;
  const parts: string[] = [];
  let total = 0;
  for (const [type, n] of Object.entries(prepared.documents) as [DocumentType, number][]) {
    if (!n) continue;
    const rate = UNIT_ESTIMATES.document[type];
    total += n * rate;
    parts.push(`${n} ${type} × $${rate}`);
  }
  for (const [step, n] of Object.entries(prepared.discovery) as [keyof typeof UNIT_ESTIMATES.discovery, number][]) {
    if (!n) continue;
    const rate = UNIT_ESTIMATES.discovery[step];
    total += n * rate;
    parts.push(`${n} ${step} × $${rate}`);
  }
  if (prepared.escalations) {
    total += prepared.escalations * UNIT_ESTIMATES.escalation;
    parts.push(`${prepared.escalations} escalations × $${UNIT_ESTIMATES.escalation}`);
  }
  const full = roundUsd(total * scale);
  const basis = `${parts.length ? parts.join(" + ") : "nothing to read"}${scale !== 1 ? `, × ${Math.round(scale * 100) / 100} to the full run` : ""} (high end of each estimate)`;
  return { full_run_usd: Math.round(full * 100) / 100, run_usd: Math.round(total * 100) / 100, basis };
}

/** Exit code for a run that stops on its cost cap (unchanged from round 2). */
export const EXIT_STOPPED = 3;

/**
 * The guard Decision 5 puts before any model call: this run's projection (`run_usd`, unscaled) over the cap stops the
 * run (exit 3) with "projection $X exceeds the cap $Y". Pure, so the CLI calls it after prepare and before discover or
 * submit. `full_run_usd` is the figure for the go/no-go table, not the guard.
 */
export function projectionGuard(p: CostProjection, cap: number): { stop: false } | { stop: true; exit: typeof EXIT_STOPPED; message: string } {
  const run = p.run_usd ?? p.full_run_usd;
  if (run <= cap) return { stop: false };
  return { stop: true, exit: EXIT_STOPPED, message: `projection $${run.toFixed(2)} exceeds the cap $${cap.toFixed(2)} (${p.basis})` };
}

/** max_tokens reserved per call, for a quick worst-case figure without building requests. */
export function worstCaseOutputUsd(call: CallKey, model: string = ROUND3_MODELS.extraction): number {
  return roundUsd((maxTokensFor(call) * priceOf(model).batch.output) / 1e6);
}
