/**
 * The campus-life pilot's model calls, on the college-reported pipeline's pricing and call log (../college-reported/
 * models.mts): discovery (Sonnet 5 with web search only: links, never documents), extraction (Haiku 4.5 against a fixed
 * schema through a forced strict tool), escalation (Sonnet 5, same schema), and the second check (Sonnet 5). Every
 * response's usage is priced with `costOf` and charged to a shared run budget that refuses calls past the cap.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { REPORTED_MODELS } from "../../../lib/reported.ts";
import { costOf, roundUsd, type ModelClient } from "../college-reported/models.mts";
import { DISCOVERY_PROMPTS, DISCOVERY_SCHEMAS, EXTRACTION_PROMPTS, EXTRACTION_SCHEMAS, EXTRACTION_SYSTEM, VERIFY_SCHEMA, VERIFY_SYSTEM, type Domain } from "./schema.mts";

export const PILOT_MODELS = {
  discovery: REPORTED_MODELS.discovery,
  extraction: REPORTED_MODELS.extraction,
  escalation: REPORTED_MODELS.escalation,
  verify: "claude-sonnet-5",
} as const;
export type PilotJob = keyof typeof PILOT_MODELS;

export const SEARCHES_PER_DOMAIN = 4;

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
}

/** The run's money: every call adds what it cost; a call that would start past the cap is refused. */
export class Budget {
  spent = 0;
  readonly cap: number;
  rows: CallRow[] = [];
  constructor(cap: number) {
    this.cap = cap;
  }
  /** Throws BudgetSpent when less than `reserve` dollars are left. */
  check(reserve: number) {
    if (this.spent + reserve > this.cap) throw new BudgetSpent(this.spent, this.cap);
  }
  charge(row: Omit<CallRow, "cost_usd" | "input_tokens" | "cache_read_tokens" | "cache_write_tokens" | "output_tokens" | "searches" | "stop_reason">, res: Anthropic.Message) {
    const u = res.usage;
    const cost = costOf(row.model, u);
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
- Use web search. Prefer the college's own domain (and its subdomains). Never use rankings, news aggregators, Wikipedia, Reddit, or review sites. For faith-group estimates only, a campus group's own site is allowed.
- Give the most specific page (the office page itself, the report file or the page listing reports, the policy page itself).
- Leave a field null or empty when you didn't find it. Don't guess URLs you didn't see in results.
- Stop as soon as you have what you can find and call save_links exactly once.`;

export async function discoverDomain(ctx: Ctx, c: CollegeRef, domain: Domain): Promise<Record<string, unknown>> {
  ctx.budget.check(0.25);
  const tool: Anthropic.Tool = {
    name: "save_links",
    description: "Record the links you found. Call exactly once.",
    strict: true,
    input_schema: DISCOVERY_SCHEMAS[domain] as Anthropic.Tool.InputSchema,
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${header(c)}\n\n${DISCOVERY_PROMPTS[domain]}` }];
  let searches = 0;
  for (let turn = 0; turn < 5; turn++) {
    const left = Math.max(1, SEARCHES_PER_DOMAIN - searches);
    const res = await ctx.client.messages
      .stream(
        {
          model: PILOT_MODELS.discovery,
          max_tokens: 4000,
          system: DISCOVERY_SYSTEM,
          output_config: { effort: "low" },
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: left }, tool],
          messages,
        },
        { signal: AbortSignal.timeout(5 * 60 * 1000) }
      )
      .finalMessage();
    ctx.budget.charge({ at: now(), college: c.unit_id, domain, job: "discovery", model: PILOT_MODELS.discovery }, res);
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "save_links");
    if (call) return call.input as Record<string, unknown>;
    if (res.stop_reason === "refusal") throw new Error("discovery refused");
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn" && searches < SEARCHES_PER_DOMAIN) continue;
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
  ctx.budget.check(job === "escalation" ? 0.3 : 0.08);
  const tool: Anthropic.Tool = {
    name: "record_facts",
    description: "Record the facts the pages state.",
    strict: true,
    input_schema: EXTRACTION_SCHEMAS[domain] as Anthropic.Tool.InputSchema,
  };
  const res = await ctx.client.messages.create({
    model,
    max_tokens: 8000,
    // A forced tool call can't run with thinking on; Sonnet 5 thinks by default (Haiku 4.5 doesn't).
    ...(model === PILOT_MODELS.escalation ? { thinking: { type: "disabled" as const } } : {}),
    system: [{ type: "text", text: EXTRACTION_SYSTEM }],
    tools: [tool],
    tool_choice: { type: "tool", name: "record_facts" },
    messages: [{ role: "user", content: `${header(c)}\n\n${EXTRACTION_PROMPTS[domain]}\n\n${pagesBlock(pages)}` }],
  });
  ctx.budget.charge({ at: now(), college: c.unit_id, domain, job, model }, res);
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
  ctx.budget.check(0.1);
  const tool: Anthropic.Tool = { name: "record_check", description: "Record your check.", strict: true, input_schema: VERIFY_SCHEMA as Anthropic.Tool.InputSchema };
  const res = await ctx.client.messages.create({
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
  });
  ctx.budget.charge({ at: now(), college: c.unit_id, domain, job: "verify", model: PILOT_MODELS.verify }, res);
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!call) throw new Error(`verify returned nothing (${res.stop_reason})`);
  return call.input as VerifyResult;
}
