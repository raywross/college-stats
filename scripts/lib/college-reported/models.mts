/**
 * Model config for the college-reported pipeline: which model does which job (REPORTED_MODELS, lib/reported.ts) and
 * what each costs, so every run can log its spend from the responses' `usage`.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { REPORTED_MODELS, type RunSummary } from "../../../lib/reported.ts";

export { REPORTED_MODELS };
export type Job = keyof typeof REPORTED_MODELS;

/**
 * List prices in US dollars per million tokens, from the claude-api skill's model table (2026-06). ESTIMATES: the
 * run's logged cost is only as current as this table; check https://claude.com/pricing when the models change.
 * Cache writes (5-minute TTL) cost 1.25× input and cache reads 0.1× input.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};
/** Web search is billed per search on top of tokens (estimate: $10 per 1,000); web fetch has no per-call charge. */
export const WEB_SEARCH_PRICE_USD = 10 / 1000;

/** Estimated cost of one response. Unknown models count as zero (and the run prints a warning). */
export function costOf(model: string, usage: Anthropic.Usage): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  const input =
    usage.input_tokens * p.input + (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 + (usage.cache_read_input_tokens ?? 0) * p.input * 0.1;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (input + usage.output_tokens * p.output) / 1e6 + searches * WEB_SEARCH_PRICE_USD;
}

export type UsageLog = RunSummary["usage"];

export function emptyUsage(): UsageLog {
  const one = () => ({ calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
  return { discovery: one(), extraction: one(), escalation: one() };
}

/** Adds one response's usage to the run's log under `job`. */
export function addUsage(log: UsageLog, job: Job, model: string, usage: Anthropic.Usage | undefined): void {
  if (!usage) return;
  const u = log[job];
  u.calls++;
  u.input_tokens += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  u.output_tokens += usage.output_tokens;
  u.cost_usd = Math.round((u.cost_usd + costOf(model, usage)) * 1e6) / 1e6;
}

/**
 * The slice of the Anthropic client the pipeline uses, so tests can pass a fake. A real `new Anthropic()` fits it.
 */
export interface ModelClient {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}
