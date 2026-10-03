/**
 * A fake Message Batches API (scripts/lib/college-reported/batch.mts BatchApi) for tests: `create` records the
 * requests, `retrieve` reports `in_progress` for `pollsUntilEnded` calls then `ended`, and `results` yields one result
 * per request in a shuffled order. `outcome(custom_id, attempt)` decides each request's result type; succeeded results
 * carry a message built by `answer(params)`.
 */
import type Anthropic from "@anthropic-ai/sdk";

type Outcome = "succeeded" | "errored" | "expired" | "invalid_request" | "canceled";

export interface FakeBatchOptions {
  answer?: (params: Anthropic.MessageCreateParamsNonStreaming, custom_id: string) => { text: string; usage?: Partial<Anthropic.Usage>; stop_reason?: Anthropic.Message["stop_reason"] };
  /** attempt = how many earlier batches carried this custom_id (0 the first time). Default "succeeded". */
  outcome?: (custom_id: string, attempt: number) => Outcome;
  pollsUntilEnded?: number;
  /** Seed for the deterministic shuffle of result order. */
  seed?: number;
  /** custom_ids the results stream leaves out entirely. */
  omit?: ReadonlySet<string>;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function fakeBatchApi(opts: FakeBatchOptions = {}) {
  const batches = new Map<string, { requests: Anthropic.Messages.BatchCreateParams.Request[]; polls: number; attempts: Map<string, number> }>();
  const seenIds = new Map<string, number>();
  const created: Anthropic.Messages.BatchCreateParams.Request[][] = [];
  const meta = (id: string, ended: boolean, n: number): Anthropic.Messages.MessageBatch => ({
    id,
    type: "message_batch",
    processing_status: ended ? "ended" : "in_progress",
    request_counts: { processing: ended ? 0 : n, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    created_at: "2026-10-03T00:00:00Z",
    ended_at: ended ? "2026-10-03T00:30:00Z" : null,
    expires_at: "2026-10-04T00:00:00Z",
    archived_at: null,
    cancel_initiated_at: null,
    results_url: ended ? `https://example.invalid/${id}/results` : null,
  });
  const api = {
    created,
    async create(body: { requests: Anthropic.Messages.BatchCreateParams.Request[] }) {
      const id = `msgbatch_${String(batches.size + 1).padStart(3, "0")}`;
      const attempts = new Map<string, number>();
      for (const r of body.requests) {
        attempts.set(r.custom_id, seenIds.get(r.custom_id) ?? 0);
        seenIds.set(r.custom_id, (seenIds.get(r.custom_id) ?? 0) + 1);
      }
      batches.set(id, { requests: body.requests, polls: 0, attempts });
      created.push(body.requests);
      return meta(id, false, body.requests.length);
    },
    async retrieve(id: string) {
      const b = batches.get(id);
      if (!b) throw new Error(`no batch ${id}`);
      b.polls++;
      return meta(id, b.polls > (opts.pollsUntilEnded ?? 0), b.requests.length);
    },
    async results(id: string): Promise<AsyncIterable<Anthropic.Messages.MessageBatchIndividualResponse>> {
      const b = batches.get(id);
      if (!b) throw new Error(`no batch ${id}`);
      const rows = shuffled(b.requests, opts.seed ?? 7)
        .filter((r) => !opts.omit?.has(r.custom_id))
        .map((r): Anthropic.Messages.MessageBatchIndividualResponse => {
          const kind = opts.outcome?.(r.custom_id, b.attempts.get(r.custom_id) ?? 0) ?? "succeeded";
          if (kind === "succeeded") {
            const a = opts.answer?.(r.params, r.custom_id) ?? { text: "{}" };
            const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null, server_tool_use: null, service_tier: "batch", inference_geo: null, output_tokens_details: null, ...a.usage } as Anthropic.Usage;
            const message = { id: `msg_${r.custom_id}`, type: "message", role: "assistant", model: r.params.model, content: [{ type: "text", text: a.text, citations: null }], stop_reason: a.stop_reason ?? "end_turn", stop_sequence: null, usage } as unknown as Anthropic.Message;
            return { custom_id: r.custom_id, result: { type: "succeeded", message } };
          }
          if (kind === "errored" || kind === "invalid_request") {
            const type = kind === "errored" ? "api_error" : "invalid_request_error";
            return { custom_id: r.custom_id, result: { type: "errored", error: { type: "error", request_id: null, error: { type, message: kind } } } } as unknown as Anthropic.Messages.MessageBatchIndividualResponse;
          }
          return { custom_id: r.custom_id, result: { type: kind } };
        });
      return (async function* () {
        yield* rows;
      })();
    },
  };
  return api;
}
