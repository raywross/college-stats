/**
 * Message Batches for the pilot's extraction, escalation, and second-check calls (round 2; half the price of the same
 * call made directly). Each college's flow still awaits its own call; the `BatchCaller` collects the calls every flow
 * makes, and when no new call has arrived for a quiet spell (or enough have queued) it sends them as one batch, polls
 * until the batch ends, and hands each flow its message by custom_id. A batch that hasn't ended by the deadline is
 * cancelled, and its calls (and any that errored or expired) are made directly instead, so a slow batch can't stall the
 * workflow past its time limit. Discovery stays direct: it streams web searches over several turns.
 */
import type Anthropic from "@anthropic-ai/sdk";

/** The slice of `client.messages.batches` used here (tests pass a fake). */
export interface PilotBatchApi {
  create(body: { requests: Anthropic.Messages.BatchCreateParams.Request[] }): Promise<Anthropic.Messages.MessageBatch>;
  retrieve(id: string): Promise<Anthropic.Messages.MessageBatch>;
  results(id: string): Promise<AsyncIterable<Anthropic.Messages.MessageBatchIndividualResponse>>;
  cancel(id: string): Promise<Anthropic.Messages.MessageBatch>;
}

export type CallMode = "interactive" | "batch";

/** How the pipeline makes a non-streaming call: directly, or through a batch. */
export interface Caller {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ message: Anthropic.Message; mode: CallMode }>;
}

export function directCaller(client: { messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } }): Caller {
  return { create: async (params) => ({ message: await client.messages.create(params), mode: "interactive" }) };
}

export interface BatchCallerOptions {
  /** Send the queued calls after this long with no new call (default 20 s). */
  quietMs?: number;
  /** Send as soon as this many are queued (default 500). */
  maxQueued?: number;
  /** Poll interval (default 15 s). */
  pollMs?: number;
  /** Cancel a batch not ended this long after it was sent, and make its calls directly (default 30 min). */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (m: string) => void;
}

interface Pending {
  params: Anthropic.MessageCreateParamsNonStreaming;
  resolve: (r: { message: Anthropic.Message; mode: CallMode }) => void;
  reject: (e: unknown) => void;
}

export class BatchCaller implements Caller {
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** Batches sent, for the run report. */
  sent: { id: string; requests: number; status: string; fallback: number }[] = [];
  private o: Required<Omit<BatchCallerOptions, "log">> & { log: (m: string) => void };

  private api: PilotBatchApi;
  private direct: Caller;

  constructor(api: PilotBatchApi, direct: Caller, o: BatchCallerOptions = {}) {
    this.api = api;
    this.direct = direct;
    this.o = {
      quietMs: o.quietMs ?? 20_000,
      maxQueued: o.maxQueued ?? 500,
      pollMs: o.pollMs ?? 15_000,
      deadlineMs: o.deadlineMs ?? 30 * 60_000,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: o.now ?? Date.now,
      log: o.log ?? (() => {}),
    };
  }

  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ message: Anthropic.Message; mode: CallMode }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
      if (this.timer) clearTimeout(this.timer);
      if (this.queue.length >= this.o.maxQueued) void this.flush();
      else this.timer = setTimeout(() => void this.flush(), this.o.quietMs);
    });
  }

  private async fallback(items: Pending[]) {
    await Promise.all(
      items.map(async (p) => {
        try {
          p.resolve(await this.direct.create(p.params));
        } catch (err) {
          p.reject(err);
        }
      })
    );
  }

  /** Sends what's queued as one batch and settles every call in it. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const items = this.queue.splice(0);
    if (!items.length) return;
    const byId = new Map(items.map((p) => [`c${++this.seq}`, p]));
    let batch: Anthropic.Messages.MessageBatch;
    try {
      batch = await this.api.create({ requests: [...byId].map(([custom_id, p]) => ({ custom_id, params: p.params })) });
    } catch (err) {
      this.o.log(`  batch not accepted (${(err as Error).message}); ${items.length} call(s) made directly`);
      await this.fallback(items);
      return;
    }
    const row = { id: batch.id, requests: items.length, status: "sent", fallback: 0 };
    this.sent.push(row);
    this.o.log(`  batch ${batch.id}: ${items.length} call(s)`);
    const deadline = this.o.now() + this.o.deadlineMs;
    const done = new Set<string>();
    try {
      while (batch.processing_status !== "ended") {
        if (this.o.now() + this.o.pollMs > deadline) {
          row.status = "cancelled at the deadline";
          await this.api.cancel(batch.id).catch(() => undefined);
          break;
        }
        await this.o.sleep(this.o.pollMs);
        batch = await this.api.retrieve(batch.id);
      }
      if (batch.processing_status === "ended") {
        row.status = "ended";
        for await (const r of await this.api.results(batch.id)) {
          const p = byId.get(r.custom_id);
          if (!p || done.has(r.custom_id) || r.result.type !== "succeeded") continue;
          done.add(r.custom_id);
          p.resolve({ message: r.result.message, mode: "batch" });
        }
      }
      const rest = [...byId].filter(([id]) => !done.has(id)).map(([, p]) => p);
      row.fallback = rest.length;
      if (rest.length) this.o.log(`  batch ${batch.id}: ${rest.length} call(s) errored, expired, or ran past the deadline; made directly`);
      await this.fallback(rest);
    } catch (err) {
      this.o.log(`  batch ${batch.id} failed (${(err as Error).message}); its calls made directly`);
      row.status = "failed";
      await this.fallback([...byId].filter(([id]) => !done.has(id)).map(([, p]) => p));
    }
  }
}
