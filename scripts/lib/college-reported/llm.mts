/**
 * The pipeline's two model calls:
 * - discover(): finds where a college publishes (Sonnet 5) with the server web search and web fetch tools, and returns
 *   a Recipe of LINKS through a strict `save_recipe` tool. It never reads the documents themselves: web fetch is capped
 *   per page and the prompt forbids opening PDF or Excel files (specs/college-reported-round-2.md, decision 2).
 * - extract(): reads one known document into the fixed EXTRACTION_SCHEMA (Haiku 4.5 by default; Sonnet 5 as the
 *   stronger extractor on escalation) with structured outputs, falling back to a strict forced tool if the model
 *   rejects structured outputs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_SCHEMA, type Extraction, type Recipe, type RecipeSource } from "../../../lib/reported.ts";
import type { ReportedSourceKind, School } from "../../../lib/types";
import { addUsage, type Job, type ModelClient, type UsageLog } from "./models.mts";

export interface LlmContext {
  client: ModelClient;
  usage: UsageLog;
  today: string;
  log: (msg: string) => void;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** Discovery's web-tool limits per college: a few searches and a few capped HTML pages, never whole documents. */
export const DISCOVERY_LIMITS = { searches: 4, fetches: 4, fetchTokens: 6000 } as const;

const RECIPE_TOOL: Anthropic.Tool = {
  name: "save_recipe",
  description:
    "Record where this college publishes its admissions figures, as links. Call it exactly once, when you are done searching. Use none_found=true with an empty sources list when the college publishes nothing newer than the federal year.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["sources", "index_urls", "none_found", "notes"],
    properties: {
      sources: {
        type: "array",
        description: "Direct links to the documents that state the figures, newest edition only (at most one Common Data Set and one class profile).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "url", "format"],
          properties: {
            kind: { type: "string", enum: ["cds", "class-profile"] },
            url: { type: "string", description: "The document itself (the PDF or XLSX file for a CDS, as linked from its index page), not a page linking to it" },
            format: { type: "string", enum: ["pdf", "html", "xlsx"], description: "From the link's file extension" },
          },
        },
      },
      index_urls: {
        type: "array",
        items: { type: "string" },
        description: "Pages that list each year's Common Data Set or class profile, re-checked later for next year's link",
      },
      none_found: { type: "boolean" },
      notes: { type: "string", description: "One or two sentences on what the college publishes and where" },
    },
  },
};

interface RecipeInput {
  sources: { kind: ReportedSourceKind; url: string; format: RecipeSource["format"] }[];
  index_urls: string[];
  none_found: boolean;
  notes: string;
}

const DISCOVERY_SYSTEM = `You find links to where a U.S. college publishes its own admissions figures, so a program can download and read them every year. You return URLs only; another step reads the documents.

Find, on the college's own website (or its institutional research office or file host):
1. Its Common Data Set (CDS): the index page that lists each year's edition, and the URL of the newest edition's file (PDF or Excel), as linked from that page. If both PDF and Excel are offered, give the Excel file.
2. Its newest class profile or admissions news release about the newest entering class (first-year applicants, admits, or admit rate), as a page URL.

How to work:
- Use web search to find candidate pages. Open only HTML pages that list or link documents (a CDS index page, an admissions facts or class profile page) to read their links.
- Never open a PDF or Excel file, and never fetch a document to check its contents: its link text and file name are enough. Take the format from the file extension.
- Only documents newer than the federal year matter. Never use third-party sites (rankings, news aggregators, test-prep sites).
- Stop as soon as you have the links. When finished, call save_recipe exactly once.`;

/** The request messages with a cache breakpoint on the last block, so a resumed turn reads the earlier ones from cache. */
function withCacheOnLast(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  const blocks = (typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : [...last.content]) as Anthropic.ContentBlockParam[];
  // Thinking blocks can't carry a breakpoint; put it on the last block that can.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "thinking" || b.type === "redacted_thinking") continue;
    blocks[i] = { ...b, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
    break;
  }
  last.content = blocks;
  return out;
}

export async function discover(ctx: LlmContext, school: School, opts: { model: string; job: Job; effort: "low" | "medium" }): Promise<Recipe> {
  const federal = school.admissions.year;
  const user = [
    `College: ${school.name} (${school.location.city}, ${school.location.state}), IPEDS unit ${school.unit_id}`,
    `Website: ${school.links?.website ?? "unknown"}`,
    `Federal admissions data covers the class entering fall ${federal ?? "unknown"}; we need fall ${federal !== null ? federal + 1 : "2025"} or newer.`,
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  let nudged = false;
  for (let turn = 0; turn < 8; turn++) {
    // Streamed, so a long web-tool loop can't hit the client's request timeout.
    const res = await ctx.client.messages
      .stream({
        model: opts.model,
        max_tokens: 16000,
        system: DISCOVERY_SYSTEM,
        output_config: { effort: opts.effort },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: DISCOVERY_LIMITS.searches },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: DISCOVERY_LIMITS.fetches, max_content_tokens: DISCOVERY_LIMITS.fetchTokens },
          RECIPE_TOOL,
        ],
        messages: withCacheOnLast(messages),
      })
      .finalMessage();
    addUsage(ctx.usage, opts.job, opts.model, res.usage);
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === RECIPE_TOOL.name);
    if (call) return recipeFrom(school.unit_id, call.input as RecipeInput, opts.model, ctx.today);
    if (res.stop_reason === "refusal") throw new Error(`discovery refused (${res.stop_details?.category ?? "no category"})`);
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Call save_recipe now with the links you found (none_found: true if nothing newer is published)." });
  }
  throw new Error("discovery ended without a recipe");
}

function recipeFrom(unit_id: string, input: RecipeInput, model: string, today: string): Recipe {
  const okUrl = (u: string) => /^https?:\/\//.test(u);
  const sources: RecipeSource[] = (input.sources ?? []).filter((s) => okUrl(s.url)).map((s) => ({ kind: s.kind, url: s.url, format: s.format }));
  return {
    unit_id,
    sources,
    index_urls: (input.index_urls ?? []).filter(okUrl),
    learned: today,
    model,
    ...(input.none_found || !sources.length ? { none_found: true as const } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/** Stable across every call (so it can be cached); the per-document facts go in the user turn. */
export const EXTRACTION_SYSTEM = `You read one document a U.S. college published (a Common Data Set or a class profile / admissions news page) and report its first-year admissions figures as JSON.

Report the NEWEST entering class the document describes:
- cohort: "first-year" for first-time, first-year (freshman) applicants; "transfer" if the figures are for transfer students; "unknown" if you can't tell.
- scope: "all-rounds" when the figures cover every application round (the whole year's applicant pool); "early-only" for early decision/early action figures alone; "regular-only" for regular decision alone; "unknown" if you can't tell.
- entering_term: the fall the class entered, as "Fall YYYY". A Common Data Set 2025-2026 describes the class entering Fall 2025. A "Class of 2030" profile describes Fall 2026.
- applicants, admitted, enrolled: whole numbers exactly as printed (total first-years, all residency and gender groups combined). null when the document doesn't state one.
- acceptance_rate: only if the document states an admit rate, as a fraction (4.0% → 0.04). null otherwise; never compute it yourself.
- quotes: for every number you report, the exact text from the document it came from, copied verbatim and containing that number as printed (e.g. "Total first-time, first-year who applied 45,409"). Omit the quote key for numbers you report as null.
- page: the 1-based PDF page the figures are on ("--- Page N ---" markers), or null.

Never guess or fill in a number that isn't printed in the document. If the document has no first-year admissions figures, return nulls with cohort and scope "unknown".`;

export interface DocumentInput {
  kind: ReportedSourceKind;
  url: string;
  /** Text to read (HTML text, selected PDF pages, or a sheet dump). */
  text?: string;
  /** A scanned PDF with no text layer, sent as a document block. */
  pdfBase64?: string;
}

/** Remembers, per model, that structured outputs were rejected so later calls go straight to the strict tool. */
const toolFallback = new Set<string>();

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_admissions",
  description: "Record the document's first-year admissions figures.",
  strict: true,
  input_schema: EXTRACTION_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

export async function extract(ctx: LlmContext, school: School, doc: DocumentInput, opts: { model: string; job: Job }): Promise<Extraction> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (doc.pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.pdfBase64 } });
  content.push({
    type: "text",
    text: [
      `College: ${school.name} (${school.location.city}, ${school.location.state})`,
      `Document kind: ${doc.kind === "cds" ? "Common Data Set" : "class profile or admissions news"}`,
      `URL: ${doc.url}`,
      ...(doc.text !== undefined ? ["", "<document>", doc.text, "</document>"] : []),
    ].join("\n"),
  });
  const base = {
    model: opts.model,
    max_tokens: 4096,
    system: [{ type: "text" as const, text: EXTRACTION_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content }],
  };

  let res: Anthropic.Message;
  let viaTool = toolFallback.has(opts.model);
  if (!viaTool) {
    try {
      res = await ctx.client.messages.create({
        ...base,
        output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
      });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      ctx.log(`  ${opts.model} rejected structured outputs (${err.message}); using a strict tool instead`);
      toolFallback.add(opts.model);
      viaTool = true;
    }
  }
  if (viaTool) {
    res = await ctx.client.messages.create({ ...base, tools: [EXTRACTION_TOOL], tool_choice: { type: "tool", name: EXTRACTION_TOOL.name } });
  }
  addUsage(ctx.usage, opts.job, opts.model, res!.usage);
  if (res!.stop_reason === "refusal") throw new Error(`extraction refused (${res!.stop_details?.category ?? "no category"})`);
  if (res!.stop_reason === "max_tokens") throw new Error("extraction hit max_tokens");
  let raw: unknown;
  if (viaTool) raw = res!.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")?.input;
  else {
    const text = res!.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    raw = text ? JSON.parse(text) : undefined;
  }
  if (!raw || typeof raw !== "object") throw new Error("extraction returned no JSON");
  return normalizeExtraction(raw as Partial<Extraction>);
}

/** Fills missing keys with nulls and turns a stated percent (4.0) into a fraction (0.04). */
export function normalizeExtraction(e: Partial<Extraction>): Extraction {
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  let rate = typeof e.acceptance_rate === "number" && Number.isFinite(e.acceptance_rate) ? e.acceptance_rate : null;
  if (rate !== null && rate > 1) rate = rate / 100;
  const quotes: Extraction["quotes"] = {};
  for (const k of ["applicants", "admitted", "enrolled", "acceptance_rate"] as const) {
    const q = e.quotes?.[k];
    if (typeof q === "string" && q.trim()) quotes[k] = q.trim();
  }
  return {
    cohort: e.cohort ?? "unknown",
    scope: e.scope ?? "unknown",
    entering_term: typeof e.entering_term === "string" ? e.entering_term.trim() : null,
    applicants: int(e.applicants),
    admitted: int(e.admitted),
    enrolled: int(e.enrolled),
    acceptance_rate: rate,
    quotes,
    page: int(e.page),
  };
}
