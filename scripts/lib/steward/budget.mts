/**
 * The Steward's budget (specs/product/data-steward.md "Models and cost"; owner assumption 2: $5 after a pipeline run,
 * $20 on dispatch, $10 for the weekly audit, $40 a week in all). Enforced here, from the SDK's `usage` on every
 * response at the prices in ./models.mts, and checked before every call: a call whose expected cost doesn't fit what
 * is left is never made (`BudgetStop`). The weekly cap is the sum of `spent_usd` over `steward.runs` started in the
 * last seven days.
 */
import type { RunDoc } from "../../../lib/steward/types.ts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { DataStore } from "../data-platform/store.mts";
import { CACHE_READ_SHARE, CACHE_WRITE_SHARE, PRICES, type StewardModel } from "./models.mts";

/** The week's cap across every run, in US dollars. */
export const WEEKLY_CAP_USD = 40;
/** Budgets by trigger (the workflow passes them; the CLI's default is the dispatch one). */
export const DEFAULT_BUDGETS = { afterPipeline: 5, dispatch: 20, audit: 10, answer: 5 } as const;

/** The token counts a response reports (`BetaUsage` and `Usage` both have these). */
export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** What one response cost, in US dollars. */
export function costOf(usage: UsageLike, model: StewardModel): number {
  const p = PRICES[model];
  if (!p) throw new Error(`budget: no price for ${model}`);
  const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;
  return (
    usage.input_tokens * perToken(p.input) +
    (usage.cache_read_input_tokens ?? 0) * perToken(p.input * CACHE_READ_SHARE) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(p.input * CACHE_WRITE_SHARE) +
    usage.output_tokens * perToken(p.output)
  );
}

/** Thrown before a call the budget can't cover; `where` is what the run was doing. */
export class BudgetStop extends Error {
  readonly where: string;
  constructor(where: string, message: string) {
    super(message);
    this.name = "BudgetStop";
    this.where = where;
  }
}

export interface CallRecord {
  model: StewardModel;
  purpose: string;
  usd: number;
  input_tokens: number;
  output_tokens: number;
}

const round = (usd: number) => Math.round(usd * 10_000) / 10_000;

export class Budget {
  readonly limitUsd: number;
  private spentUsd = 0;
  private reservedUsd = 0;
  readonly calls: CallRecord[] = [];

  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error(`budget: ${limitUsd} isn't a dollar amount`);
    this.limitUsd = limitUsd;
  }

  /** Records a response's cost; returns it. */
  charge(usage: UsageLike, model: StewardModel, purpose = "call"): number {
    const usd = costOf(usage, model);
    this.spentUsd += usd;
    this.calls.push({ model, purpose, usd: round(usd), input_tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output_tokens: usage.output_tokens });
    return usd;
  }

  spent(): number {
    return round(this.spentUsd);
  }

  remaining(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  /**
   * Holds back `usd` for the main loop's next call: sub-reads made by the tools between two main calls may spend only
   * what is left above it, so the next main call (already checked) stays affordable.
   */
  reserve(usd: number): void {
    this.reservedUsd = Math.max(0, usd);
  }

  /**
   * Refuses a call whose expected cost (`inputTokens` uncached and `outputTokens`, at the model's prices) is more than
   * what is left: throws a `BudgetStop` naming `where`.
   */
  ensure(model: StewardModel, inputTokens: number, outputTokens: number, where: string, opts: { reserved?: boolean } = {}): void {
    const expected = costOf({ input_tokens: inputTokens, output_tokens: outputTokens }, model);
    const left = this.remaining() - (opts.reserved === false ? 0 : this.reservedUsd);
    if (expected > left) {
      throw new BudgetStop(where, `the budget is spent: $${this.spent().toFixed(2)} of $${this.limitUsd.toFixed(2)}, and the next call would cost about $${expected.toFixed(2)}`);
    }
  }
}

/** Dollars the Steward spent in the seven days before `now` (every run started in the window). */
export async function weeklySpent(store: Pick<DataStore, "read">, now: Date): Promise<number> {
  const runs = await store.read<RunDoc>(COLLECTIONS.steward.runs);
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let usd = 0;
  for (const r of runs.values()) {
    const t = Date.parse(r.started);
    if (Number.isFinite(t) && t >= since && t <= now.getTime()) usd += Number(r.spent_usd) || 0;
  }
  return round(usd);
}

/** The budget a run gets: what it asked for, cut to what the week has left. */
export function runBudget(asked: number, spentThisWeek: number, cap = WEEKLY_CAP_USD): number {
  return round(Math.max(0, Math.min(asked, cap - spentThisWeek)));
}

/** A rough token count for text (about 3.5 characters a token), for a call's expected cost. */
export const tokensOf = (text: string) => Math.ceil(text.length / 3.5);
