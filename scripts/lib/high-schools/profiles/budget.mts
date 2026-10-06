/**
 * The profile run's spend cap (owner: $30 for the pilot). Every model call reserves its worst-case cost first; a call
 * whose reservation would take the run past the cap is never started, and the run stops there (`SpendCapReached`).
 * After the call, the reservation is replaced by what the response actually cost (models.mts costOf), so the cap is
 * held against real spending plus the one call in flight, never against estimates alone.
 */
import { costOf, priceOf, roundUsd, type UsageLike } from "../../college-reported/models.mts";

export class SpendCapReached extends Error {
  readonly spent: number;
  readonly cap: number;
  constructor(spent: number, need: number, cap: number) {
    super(`spend cap: $${spent.toFixed(4)} spent + $${need.toFixed(4)} for the next call would pass the $${cap.toFixed(2)} cap; stopping`);
    this.name = "SpendCapReached";
    this.spent = spent;
    this.cap = cap;
  }
}

/** Worst-case dollars for a call: every input token at the uncached rate, the whole output budget, and its searches. */
export function worstCaseUsd(model: string, inputTokens: number, maxOutputTokens: number, searches = 0): number {
  const r = priceOf(model).interactive;
  return (inputTokens * r.input + maxOutputTokens * r.output) / 1e6 + searches * 0.01;
}

export class SpendCap {
  readonly cap: number;
  private spentUsd = 0;
  private held = 0;
  /** Per school: what its calls cost. */
  readonly bySchool = new Map<string, number>();
  readonly byJob = new Map<string, { calls: number; cost_usd: number }>();

  constructor(cap: number) {
    if (!(cap >= 0)) throw new Error(`spend cap must be ≥ 0, got ${cap}`);
    this.cap = cap;
  }

  get spent(): number {
    return roundUsd(this.spentUsd);
  }

  get remaining(): number {
    return Math.max(0, this.cap - this.spentUsd - this.held);
  }

  /** Whether a call of this worst case may start now. */
  canSpend(worst: number): boolean {
    return this.spentUsd + this.held + worst <= this.cap;
  }

  /**
   * Runs one model call under the cap: reserves `worst`, runs `call`, then records the response's real cost. Throws
   * `SpendCapReached` without calling when the reservation doesn't fit. A call that throws releases its reservation
   * (an errored request is not billed for output; its input, if any, is unknown and not counted).
   */
  async run<T extends { usage?: UsageLike; model?: string }>(
    o: { school: string; job: string; model: string; worst: number },
    call: () => Promise<T>,
  ): Promise<{ result: T; cost: number }> {
    if (!this.canSpend(o.worst)) throw new SpendCapReached(this.spentUsd, o.worst, this.cap);
    this.held += o.worst;
    let result: T;
    try {
      result = await call();
    } finally {
      this.held -= o.worst;
    }
    const cost = result.usage ? costOf(o.model, result.usage) : 0;
    this.record(o.school, o.job, cost);
    return { result, cost };
  }

  /** Adds a cost already incurred (a multi-turn search loop records each turn). */
  record(school: string, job: string, cost: number): void {
    this.spentUsd += cost;
    this.bySchool.set(school, roundUsd((this.bySchool.get(school) ?? 0) + cost));
    const j = this.byJob.get(job) ?? { calls: 0, cost_usd: 0 };
    j.calls++;
    j.cost_usd = roundUsd(j.cost_usd + cost);
    this.byJob.set(job, j);
  }
}
