/**
 * The campus-life pilot's model calls, on the college-reported pipeline's pricing and call log (../college-reported/
 * models.mts): discovery (Sonnet 5 with web search only: links, never documents; round 2: one call per college, only
 * for what the free probes (./probe.mts) didn't find, searches capped and limited to the college's own domain),
 * extraction (Haiku 4.5 against a fixed schema through a forced strict tool), escalation (Sonnet 5, same schema), and
 * the second check (Sonnet 5). Extraction, escalation, and second checks go through a `Caller` (./batch.mts: direct,
 * or Message Batches at half price). Every response's usage is priced with `costOf` (batch rates for batch results)
 * and charged to a shared run budget that refuses calls past the cap, counting calls still waiting in a batch.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { REPORTED_MODELS } from "../../../lib/reported.ts";
import { collegeDomain } from "../college-reported/probe.mts";
import { costOf, roundUsd, type ModelClient } from "../college-reported/models.mts";
import { directCaller, type Caller, type CallMode } from "./batch.mts";
import { combinedDiscovery, FIELD_DOMAIN, EXTRACTION_PROMPTS, EXTRACTION_SCHEMAS, EXTRACTION_SYSTEM, VERIFY_SCHEMA, VERIFY_SYSTEM, type Domain } from "./schema.mts";

export const PILOT_MODELS = {
  discovery: REPORTED_MODELS.discovery,
  extraction: REPORTED_MODELS.extraction,
  escalation: REPORTED_MODELS.escalation,
  verify: "claude-sonnet-5",
} as const;
export type PilotJob = keyof typeof PILOT_MODELS;

/**
 * Web searches per college, all three domains together (round 1: up to 4 per domain, 12 per college; round 2: 2–4).
 * Round 3: at most 2. Round 2's calls read about 47,000 input tokens per search (search results, re-read on each
 * server-side step), so a call's cost grows with every search; the $0.01 search fee is the small part.
 */
export const SEARCHES_PER_COLLEGE = 2;

/** Searches for one college: one for up to two missing types (one search often finds several), two for more. */
export function searchCap(missing: readonly string[]): number {
  return Math.min(SEARCHES_PER_COLLEGE, Math.max(1, Math.ceil(missing.length / 2)));
}

/**
 * Output cap for a discovery call (round 2: 4,000). Round 2's calls with 2 searches wrote 1,873 output tokens on
 * average and 2,686 at most (3,429 with 3–4 searches, which round 3 no longer allows). A cap below what a call needs
 * costs more than it saves: a call cut short is asked once more for save_links, re-reading every search result.
 */
export const DISCOVERY_MAX_TOKENS = 3000;

export interface CallRow {
  at: string;
  college: string;
  domain: Domain | null;
  job: PilotJob;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  searches: number;
  cost_usd: number;
  stop_reason: string | null;
  /** Direct or Message Batches (priced at batch rates). */
  mode: CallMode;
}

/** The run's money: every call adds what it cost; a call that would start past the cap is refused. */
export class Budget {
  spent = 0;
  readonly cap: number;
  rows: CallRow[] = [];
  /** Reserved for calls sent but not yet answered (a batch's calls wait together). */
  held = 0;
  constructor(cap: number) {
    this.cap = cap;
  }
  /** Throws BudgetSpent when less than `reserve` dollars are left, counting what's held for calls in flight. */
  check(reserve: number) {
    if (this.spent + this.held + reserve > this.cap) throw new BudgetSpent(this.spent, this.cap);
  }
  /** Checks, then holds `reserve` until the returned release is called. */
  hold(reserve: number): () => void {
    this.check(reserve);
    this.held += reserve;
    let done = false;
    return () => {
      if (!done) this.held = Math.max(0, roundUsd(this.held - reserve));
      done = true;
    };
  }
  charge(row: Omit<CallRow, "cost_usd" | "input_tokens" | "cache_read_tokens" | "cache_write_tokens" | "output_tokens" | "searches" | "stop_reason" | "mode">, res: Anthropic.Message, mode: CallMode = "interactive") {
    const u = res.usage;
    const cost = costOf(row.model, u, { mode });
    this.spent = roundUsd(this.spent + cost);
    this.rows.push({
      ...row,
      input_tokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      cache_read_tokens: u.cache_read_input_tokens ?? 0,
      cache_write_tokens: u.cache_creation_input_tokens ?? 0,
      output_tokens: u.output_tokens,
      searches: u.server_tool_use?.web_search_requests ?? 0,
      cost_usd: roundUsd(cost),
      stop_reason: res.stop_reason,
      mode,
    });
  }
}

export class BudgetSpent extends Error {
  constructor(spent: number, cap: number) {
    super(`spend cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)}`);
    this.name = "BudgetSpent";
  }
}

export interface CollegeRef {
  unit_id: string;
  name: string;
  city: string;
  state: string;
  website: string | null;
  /** IPEDS religious affiliation label, or null (a lead for where to look, never evidence). */
  affiliation: string | null;
  /** Historically women's or men's college (from the name or IPEDS), for the trans-admission item. */
  single_sex: boolean;
}

export interface Ctx {
  client: ModelClient;
  budget: Budget;
  /** How extraction, escalation, and second checks are sent (default: directly through `client`). */
  caller?: Caller;
}

/** One non-streaming call through the context's caller, held against the budget until it's answered and charged. */
async function send(ctx: Ctx, params: Anthropic.MessageCreateParamsNonStreaming, reserve: number, row: { college: string; domain: Domain | null; job: PilotJob }): Promise<Anthropic.Message> {
  const release = ctx.budget.hold(reserve);
  try {
    const { message, mode } = await (ctx.caller ?? directCaller(ctx.client)).create(params);
    release();
    ctx.budget.charge({ at: now(), ...row, model: params.model }, message, mode);
    return message;
  } finally {
    release();
  }
}

const now = () => new Date().toISOString();

function header(c: CollegeRef): string {
  return [
    `College: ${c.name} (${c.city}, ${c.state}), IPEDS unit ${c.unit_id}`,
    `Website: ${c.website ?? "unknown"}`,
    `Religious affiliation (IPEDS): ${c.affiliation ?? "none"}`,
    ...(c.single_sex ? ["Historically single-sex college: yes"] : []),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

const DISCOVERY_SYSTEM = `You find links to a U.S. college's own web pages so a program can read them later. You return URLs only, through the save_links tool; another step reads the pages.
- Use web search, which is limited to the college's own domain and its subdomains. One search can find several pages; search for the ones you're asked for, not the others.
- Give the most specific page (the office page itself, the report file or the page listing reports, the policy page itself).
- Leave a field null or empty when you didn't find it. Don't guess URLs you didn't see in results.
- Stop as soon as you have what you can find and call save_links exactly once.`;

/** The registrable domain of the college's website ("www.cmu.edu" → "cmu.edu"), or null. */
export function siteDomain(c: CollegeRef): string | null {
  if (!c.website) return null;
  try {
    return collegeDomain(new URL(/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`).host);
  } catch {
    return null;
  }
}

/**
 * Round 2's paid discovery: one call for the whole college, asking only for `missing` source types (what the free
 * probes didn't find), web search limited to the college's own domain and to `searchCap(missing)` searches in all.
 * Returns the links per domain (fields the call wasn't asked for are absent).
 */
export async function discoverCollege(ctx: Ctx, c: CollegeRef, missing: readonly string[]): Promise<{ links: Partial<Record<Domain, Record<string, unknown>>>; searches: number }> {
  if (!missing.length) return { links: {}, searches: 0 };
  ctx.budget.check(0.35);
  const { schema, prompt } = combinedDiscovery(missing);
  const tool: Anthropic.Tool = { name: "save_links", description: "Record the links you found. Call exactly once.", strict: true, input_schema: schema as Anthropic.Tool.InputSchema };
  const domain = siteDomain(c);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${header(c)}\n\n${prompt}` }];
  let searches = 0;
  const cap = searchCap(missing);
  for (let turn = 0; turn < 3; turn++) {
    const left = Math.max(1, cap - searches);
    const res = await ctx.client.messages
      .stream(
        {
          model: PILOT_MODELS.discovery,
          max_tokens: DISCOVERY_MAX_TOKENS,
          system: DISCOVERY_SYSTEM,
          output_config: { effort: "low" },
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: left, ...(domain ? { allowed_domains: [domain] } : {}) }, tool],
          messages,
        },
        { signal: AbortSignal.timeout(5 * 60 * 1000) }
      )
      .finalMessage();
    ctx.budget.charge({ at: now(), college: c.unit_id, domain: null, job: "discovery", model: PILOT_MODELS.discovery }, res);
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    const found = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_links");
    if (found) {
      const links: Partial<Record<Domain, Record<string, unknown>>> = {};
      for (const [k, v] of Object.entries(found.input as Record<string, unknown>)) {
        const d = FIELD_DOMAIN[k];
        if (d) (links[d] ??= {})[k] = v;
      }
      return { links, searches };
    }
    if (res.stop_reason === "refusal") throw new Error("discovery refused");
    // A turn cut short by max_tokens may end in a half-written save_links call, which can't be sent back unanswered.
    const kept = res.content.filter((b) => b.type !== "tool_use");
    if (kept.length) messages.push({ role: "assistant", content: kept });
    if (res.stop_reason === "pause_turn" && searches < cap) continue;
    messages.push({ role: "user", content: "Call save_links now with what you found." });
  }
  throw new Error("discovery ended without links");
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

export interface PromptPage {
  /** 1-based P number. */
  n: number;
  url: string;
  /** What discovery said the page is. */
  role: string;
  text: string;
}

export function pagesBlock(pages: readonly PromptPage[]): string {
  return pages.map((p) => `### P${p.n} — ${p.url} (${p.role})\n${p.text}`).join("\n\n");
}

export async function extractDomain(ctx: Ctx, c: CollegeRef, domain: Domain, pages: readonly PromptPage[], job: "extraction" | "escalation"): Promise<Record<string, unknown>> {
  const model = PILOT_MODELS[job];
  const tool: Anthropic.Tool = {
    name: "record_facts",
    description: "Record the facts the pages state.",
    strict: true,
    input_schema: EXTRACTION_SCHEMAS[domain] as Anthropic.Tool.InputSchema,
  };
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 8000,
    // A forced tool call can't run with thinking on; Sonnet 5 thinks by default (Haiku 4.5 doesn't).
    ...(model === PILOT_MODELS.escalation ? { thinking: { type: "disabled" as const } } : {}),
    system: [{ type: "text", text: EXTRACTION_SYSTEM }],
    tools: [tool],
    tool_choice: { type: "tool", name: "record_facts" },
    messages: [{ role: "user", content: `${header(c)}\n\n${EXTRACTION_PROMPTS[domain]}\n\n${pagesBlock(pages)}` }],
  };
  const res = await send(ctx, params, job === "escalation" ? 0.3 : 0.08, { college: c.unit_id, domain, job });
  if (res.stop_reason === "refusal") throw new Error(`${job} refused`);
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!call) throw new Error(`${job} returned no facts (${res.stop_reason})`);
  return call.input as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* The second check                                                    */
/* ------------------------------------------------------------------ */

export interface VerifyInput {
  finding: string;
  quote: string;
  url: string;
  pageText: string;
}

export interface VerifyResult {
  quote_on_page: boolean;
  confirmed: boolean;
  reason: string;
}

export async function verifyFinding(ctx: Ctx, c: CollegeRef, domain: Domain, v: VerifyInput): Promise<VerifyResult> {
  const tool: Anthropic.Tool = { name: "record_check", description: "Record your check.", strict: true, input_schema: VERIFY_SCHEMA as Anthropic.Tool.InputSchema };
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: PILOT_MODELS.verify,
    max_tokens: 1000,
    thinking: { type: "disabled" },
    system: VERIFY_SYSTEM,
    tools: [tool],
    tool_choice: { type: "tool", name: "record_check" },
    messages: [
      {
        role: "user",
        content: `${header(c)}\n\nFinding: ${v.finding}\nQuote: "${v.quote}"\nPage: ${v.url}\n\n<page>\n${v.pageText}\n</page>`,
      },
    ],
  };
  const res = await send(ctx, params, 0.1, { college: c.unit_id, domain, job: "verify" });
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!call) throw new Error(`verify returned nothing (${res.stop_reason})`);
  return call.input as VerifyResult;
}
