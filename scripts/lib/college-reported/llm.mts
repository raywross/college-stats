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
import { EXTRACTION_SCHEMA, ROUND3_MODELS, type CallLog, type CallMode, type Extraction, type Recipe, type RecipeSource } from "../../../lib/reported.ts";
import type { ReportedSourceKind, School } from "../../../lib/types";
import { codeTableText, codesFor, maxTokensFor, schemaFor, type CallKey, type CdsCode, type DocumentType, type TemplateTable } from "../../../lib/cds-sections.ts";
import { quoteFromNumberedLines, type NumberedLine } from "../../../lib/cds-quotes.ts";
import { MIN_CACHE_PREFIX, addUsage, callLogRow, priceOf, type Job, type ModelClient, type UsageLog } from "./models.mts";

export interface LlmContext {
  client: ModelClient;
  usage: UsageLog;
  today: string;
  log: (msg: string) => void;
  /** Round 3: the run id for call-log rows, and a hook that receives one row per model call (models.mts callRecorder). */
  run?: string;
  onCall?: (row: CallLog) => void;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** Discovery's web-tool limits per college: a few searches and a few capped HTML pages, never whole documents. */
export const DISCOVERY_LIMITS = { searches: 3, fetches: 3, fetchTokens: 4000 } as const;
/**
 * One college's discovery may not run longer than this (the ten-college test spent 17 minutes on one college). The
 * stream is aborted and the college is queued; no retry.
 */
export const DISCOVERY_TIMEOUT_MS = 6 * 60 * 1000;

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
  // Uses are counted across continuation turns (a `pause_turn` resume is a new request, and the skill doesn't say
  // whether `max_uses` is per request): each turn gets only what is left of the college's limit, never the full limit
  // again (specs/college-reported-round-3.md, "Fixed in this round", llm.mts).
  const used = { searches: 0, fetches: 0 };
  for (let turn = 0; turn < 8; turn++) {
    const left = { searches: DISCOVERY_LIMITS.searches - used.searches, fetches: DISCOVERY_LIMITS.fetches - used.fetches };
    // Streamed, so a long web-tool loop can't hit the client's request timeout.
    const res = await ctx.client.messages
      .stream({
        model: opts.model,
        max_tokens: 8000,
        system: DISCOVERY_SYSTEM,
        output_config: { effort: opts.effort },
        tools: discoveryTools(left),
        messages: withCacheOnLast(messages),
      }, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
      .finalMessage();
    addUsage(ctx.usage, opts.job, opts.model, res.usage);
    used.searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
    used.fetches += res.usage?.server_tool_use?.web_fetch_requests ?? 0;
    ctx.onCall?.(callLogRow({ run: ctx.run ?? "", at: new Date().toISOString(), college: school.unit_id, job: "discovery", model: opts.model, mode: "interactive", document_type: null, call: null, estimated_input_tokens: null }, res.usage, res.stop_reason));
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === RECIPE_TOOL.name);
    if (call) return recipeFrom(school.unit_id, call.input as RecipeInput, opts.model, ctx.today);
    if (res.stop_reason === "refusal") throw new Error(`discovery refused (${res.stop_details?.category ?? "no category"})`);
    messages.push({ role: "assistant", content: res.content });
    const exhausted = used.searches >= DISCOVERY_LIMITS.searches && used.fetches >= DISCOVERY_LIMITS.fetches;
    if (res.stop_reason === "pause_turn" && !exhausted) continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Call save_recipe now with the links you found (none_found: true if nothing newer is published)." });
  }
  throw new Error("discovery ended without a recipe");
}

/**
 * Discovery's tools for one turn, given the uses left across the whole discovery. A tool whose uses are spent keeps
 * `max_uses: 1` rather than disappearing (the history holds its earlier results), and the loop nudges for the recipe
 * instead of resuming, so the overshoot is at most one use.
 */
export function discoveryTools(left: { searches: number; fetches: number }): Anthropic.ToolUnion[] {
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: Math.max(1, left.searches) },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.max(1, left.fetches), max_content_tokens: DISCOVERY_LIMITS.fetchTokens },
    RECIPE_TOOL,
  ];
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
    max_tokens: 8192,
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

/* ------------------------------------------------------------------ */
/* Round 3: code-keyed, line-cited extraction (Decision 4)             */
/* ------------------------------------------------------------------ */

/**
 * Estimated tokens for a piece of prompt text: characters ÷ 3.5 (Decision 5's estimate, without the reservation's 1.2
 * safety margin). The calls file logs it beside the actual count so the pilot can check it.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.5);
}

/** The document a call reads, for the prompt's header and the call log. */
export interface DocMeta {
  unit_id: string;
  /** The college's name, for the prompt header. */
  name?: string;
  url: string;
  edition?: string | null;
  document_type: DocumentType;
}

/** What one round-3 call needs besides its input: the client, the run id, and a hook for call-log rows. */
export interface CallContext {
  client: ModelClient;
  log: (msg: string) => void;
  run: string;
  now?: () => Date;
  /** Receives one row per model call (models.mts callRecorder writes it to the calls file and the summary). */
  onCall?: (row: CallLog) => void;
}

/** Prompt-cache marker on the static prefix: 5-minute TTL (default), 1-hour, or off (if the pilot's hit rate is < 25%). */
export type CacheSetting = "5m" | "1h" | "off";

export interface ExtractCallInput {
  call: CallKey;
  /** The numbered layout lines of the call's pages (section C, or everything else in scope). */
  lines: readonly NumberedLine[];
  /** The codes to ask for; default every code of the call (codesFor). Escalation passes the failing codes only. */
  codes?: readonly CdsCode[];
  table: TemplateTable;
  /** Default ROUND3_MODELS.extraction (Haiku 4.5). */
  model?: string;
  mode: CallMode;
  doc: DocMeta;
  /** Default "extraction". */
  job?: "extraction" | "escalation";
  cache?: CacheSetting;
  /** Sent only to models that take it (not Haiku 4.5, where `effort` is an error). */
  effort?: "low" | "medium" | "high";
}

/** One code's answer: the value as printed (normalized later by lib/cds-sections normalizeValue), its line ids, and the quote built from them. */
export interface CitedValue {
  v: number | string | boolean;
  lines: number[];
  /** The cited lines' text (lib/cds-quotes quoteFromLines); null when no cited id is a line of the document. */
  quote: string | null;
}

export interface ExtractCallResult {
  call: CallKey;
  model: string;
  values: Record<CdsCode, CitedValue>;
  /** Codes the model returned that the request didn't ask for (dropped and logged). */
  dropped: string[];
  /** Asked-for codes with no value: not found, or cut off by a `max_tokens` stop (`truncated`). */
  missing: CdsCode[];
  /** The response stopped at `max_tokens`: values parsed before the cut are kept; only the missing codes fail. */
  truncated: boolean;
  stop_reason: string | null;
  usage: Anthropic.Usage;
}

/** What a call sends, built once and shared by the interactive call and the batch request. */
export interface BuiltRequest {
  params: Anthropic.MessageCreateParamsNonStreaming;
  /** Characters of prompt text (static prefix plus the user turn; the schema is not counted, an open question). */
  chars: number;
  estimated_input_tokens: number;
  /** Estimated tokens of the static prefix, and whether it carries the cache marker. */
  prefix_tokens: number;
  cached: boolean;
  codes: CdsCode[];
}

const CALL_SCOPE: Record<CallKey, string> = {
  C: "section C (First-Time, First-Year Admission) only",
  rest: "every section except C: B (enrollment and persistence), D (transfer admission), E (academic offerings), F (student life), G (annual expenses), H (financial aid), I (instructional faculty and class size), and J (degrees conferred), as far as the code table below lists them",
};

/**
 * The static instructions of one call. Identical for every document, so with the code table they form the cached
 * prefix (Decision 4: above Haiku 4.5's 4,096-token minimum for both calls). Per-document facts go in the user turn.
 */
export function extractionInstructions(call: CallKey): string {
  return `You read one U.S. college's Common Data Set (CDS) and report the values it prints, keyed by the CDS template's own item codes. This request covers ${CALL_SCOPE[call]}.

The document comes as numbered lines of layout text. Each line starts with its id and a bar ("412| ..."); pages are marked "--- Page N ---". Cells on one line are separated by " | ", and "@x" tags give a cell's horizontal position on the page so you can tell which column of a table a value sits in. Values that sit under a table's column headings belong to the heading at the closest horizontal position.

Answer with one JSON object. Each key is a code from the code table at the end of these instructions. Each value is {"v": <value>, "lines": [<line ids>]}:
- "v" is the value exactly as the document prints it, as a number where the item is numeric (4614, not "4,614"; 52.3 for "52.3%"; 0 only where the document prints 0), as true for a checked box or an "X" mark, as "Yes" or "No" for a yes/no item, as the printed words for a choice item ("Very Important", "Required of All"), and as the printed text for text, date, and URL items ("11/1", "January 15").
- "lines" lists the id of the line the value is printed on, and also the id of the line holding its label when the label is on a different line. One or two ids; never more than three.
- Leave a code out entirely when the document doesn't print a value for it, when the cell is blank, or when the document says the item doesn't apply. Never write null, an empty string, or a guess, and never compute a value the document doesn't print (no sums, differences, or percentages of your own).
- Report a value only under the code whose row and column it belongs to. The code table gives, for each code, the template's question for that cell (row and column descriptors such as residency, gender, and cohort) and the kind of value it holds. Many items are grids: match the row label and the column heading both.
- If the college printed the same item twice (a corrected table, a footnote restating a figure), report the value in the item's own table.
- Percentages: report the number printed, without the percent sign. Currency: whole dollars without "$" or commas. Test scores: the printed score. Months and days split into two codes take the month number and the day number.
- Text the college typed where a number belongs ("varies", "N/A", "see note") is reported as that text; a placeholder dash or "--" is blank, so leave the code out.
- Ignore the definitions and instructions the template itself prints; read only the college's answers.
- Do not report codes that are not in the code table, and do not add keys of your own.

Each line of the code table is "code | question | value type". Value types: count (a whole number of students, sections, or applications), percent, currency, decimal, gpa, sat-section, sat-composite, act, act-writing, month, day, date, yes-no, check (a checkbox or X mark), choice, text, url.

<code_table>
`;
}

/** The code table lines for the given codes (the whole call's table when all of them, via codeTableText). */
function codeTableFor(table: TemplateTable, call: CallKey, codes: readonly CdsCode[]): string {
  const all = codesFor(table, call);
  if (codes.length === all.length && codes.every((c, i) => c === all[i])) return codeTableText(table, call);
  const want = new Set(codes);
  return codeTableText({ ...table, items: table.items.filter((it) => want.has(it.code)) }, call);
}

/** The static prefix of a call: instructions plus the code table (cached when it reaches the model's minimum). */
export function staticPrefix(table: TemplateTable, call: CallKey, codes: readonly CdsCode[] = codesFor(table, call)): string {
  return `${extractionInstructions(call)}${codeTableFor(table, call, codes)}\n</code_table>`;
}

/** schemaFor(table, call) narrowed to `codes` (all of them by default). */
export function schemaForCodes(table: TemplateTable, call: CallKey, codes: readonly CdsCode[] = codesFor(table, call)) {
  const full = schemaFor(table, call);
  const properties: Record<string, (typeof full.properties)[string]> = {};
  for (const c of codes) if (full.properties[c]) properties[c] = full.properties[c];
  return { type: "object", additionalProperties: false, properties } as const;
}

/** The numbered lines as the model reads them, with a page marker wherever the page changes. */
export function renderLines(lines: readonly NumberedLine[]): string {
  const out: string[] = [];
  let page: number | null = null;
  for (const l of lines) {
    if (l.page !== page) {
      out.push(`--- Page ${l.page} ---`);
      page = l.page;
    }
    out.push(`${l.id}| ${l.text}`);
  }
  return out.join("\n");
}

function documentHeader(doc: DocMeta): string {
  return [
    `College: ${doc.name ?? "unknown"} (IPEDS unit ${doc.unit_id})`,
    `Document: Common Data Set${doc.edition ? ` ${doc.edition}` : ""} (${doc.document_type})`,
    `URL: ${doc.url}`,
  ].join("\n");
}

const isHaiku = (model: string) => model.startsWith("claude-haiku");

/**
 * Builds one extraction (or escalation) request. Throws for an unpriced model, so nothing is sent or reserved at $0.
 * Codes outside the call are refused: a request never asks for a code its schema version doesn't cover.
 */
export function buildExtractRequest(input: ExtractCallInput): BuiltRequest {
  const model = input.model ?? ROUND3_MODELS.extraction;
  priceOf(model);
  const all = codesFor(input.table, input.call);
  const callCodes = new Set(all);
  const codes = input.codes ? [...input.codes] : all;
  const outside = codes.filter((c) => !callCodes.has(c));
  if (outside.length) throw new Error(`extractCall(${input.call}): codes not in this call: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? "…" : ""}`);
  if (!codes.length) throw new Error(`extractCall(${input.call}): no codes to ask for`);

  const prefix = staticPrefix(input.table, input.call, codes);
  const prefixTokens = estimateTokens(prefix.length);
  const cache = input.cache ?? "5m";
  const cached = cache !== "off" && prefixTokens >= (MIN_CACHE_PREFIX[model] ?? Infinity);
  const user = `${documentHeader(input.doc)}\n\n<document>\n${renderLines(input.lines)}\n</document>`;
  const marker: Anthropic.CacheControlEphemeral = cache === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: prefix, ...(cached ? { cache_control: marker } : {}) }];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokensFor(input.call),
    system,
    messages: [{ role: "user", content: user }],
    output_config: {
      format: { type: "json_schema", schema: schemaForCodes(input.table, input.call, codes) as unknown as Record<string, unknown> },
      // No thinking on Haiku (the parameter is simply omitted); effort only where the model takes it.
      ...(input.effort && !isHaiku(model) ? { effort: input.effort } : {}),
    },
  };
  const chars = prefix.length + user.length;
  return { params, chars, estimated_input_tokens: estimateTokens(chars), prefix_tokens: prefixTokens, cached, codes };
}

/** A whole `"X.123": { ... }` entry of the response JSON (values hold no nested objects), for salvaging a cut response. */
const ENTRY = /"([A-J]\.[0-9A-Z]{2,4})"\s*:\s*(\{[^{}]*\})/g;

/** Parses the response text: JSON when complete, else every whole entry before the cut (a `max_tokens` stop). */
function parseAnswer(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through to salvage
  }
  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(ENTRY)) {
    try {
      out[m[1]] = JSON.parse(m[2]);
    } catch {
      // a malformed entry is skipped
    }
  }
  return out;
}

/**
 * Reads a response (interactive or a batch result) into code-keyed, line-cited values. Codes not asked for are dropped
 * (and listed); a value without a usable line id is kept with empty `lines` and a null quote, for the checks to fail.
 */
export function parseExtractResponse(
  message: Anthropic.Message,
  req: { call: CallKey; codes: readonly CdsCode[]; lines: readonly NumberedLine[] },
): ExtractCallResult {
  if (message.stop_reason === "refusal") throw new Error(`extraction refused (${message.stop_details?.category ?? "no category"})`);
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const raw = text.trim() ? parseAnswer(text) : {};
  const asked = new Set(req.codes);
  const byId = new Map(req.lines.map((l) => [l.id, l]));
  const values: Record<CdsCode, CitedValue> = {};
  const dropped: string[] = [];
  for (const [code, entry] of Object.entries(raw)) {
    if (!asked.has(code)) {
      dropped.push(code);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const { v, lines } = entry as { v?: unknown; lines?: unknown };
    if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") continue;
    if (v === "" || (typeof v === "number" && !Number.isFinite(v))) continue;
    const ids = Array.isArray(lines) ? lines.filter((n): n is number => Number.isInteger(n)) : [];
    values[code] = { v, lines: ids, quote: ids.length ? quoteFromNumberedLines(byId, ids) : null };
  }
  return {
    call: req.call,
    model: message.model,
    values,
    dropped,
    missing: req.codes.filter((c) => !(c in values)),
    truncated: message.stop_reason === "max_tokens",
    stop_reason: message.stop_reason,
    usage: message.usage,
  };
}

/**
 * One interactive extraction call (Decision 4). Batched calls build the same request with buildExtractRequest through
 * batch.mts and read results with parseExtractResponse.
 */
export async function extractCall(ctx: CallContext, input: ExtractCallInput): Promise<ExtractCallResult> {
  if (input.mode !== "interactive") throw new Error("extractCall runs interactive calls; batch calls go through batch.mts buildRequests");
  const built = buildExtractRequest(input);
  const res = await ctx.client.messages.create(built.params);
  const job = input.job ?? "extraction";
  ctx.onCall?.(
    callLogRow(
      { run: ctx.run, at: (ctx.now?.() ?? new Date()).toISOString(), college: input.doc.unit_id, job, model: built.params.model, mode: "interactive", document_type: input.doc.document_type, call: input.call, estimated_input_tokens: built.estimated_input_tokens },
      res.usage,
      res.stop_reason,
    ),
  );
  const out = parseExtractResponse(res, { call: input.call, codes: built.codes, lines: input.lines });
  if (out.dropped.length) ctx.log(`  ${input.doc.unit_id} ${input.call}: dropped ${out.dropped.length} code(s) not asked for (${out.dropped.slice(0, 5).join(", ")})`);
  if (out.truncated) ctx.log(`  ${input.doc.unit_id} ${input.call}: hit max_tokens (${built.params.max_tokens}); ${out.missing.length} code(s) unreturned`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Round 3: escalation (Decision 9)                                    */
/* ------------------------------------------------------------------ */

export interface EscalateInput {
  call: CallKey;
  /** The document's numbered lines (all of them; only the call's pages are sent). */
  lines: readonly NumberedLine[];
  failingCodes: readonly CdsCode[];
  /** First and last page of the call (CallRead.pages). */
  pageRange: [number, number];
  table: TemplateTable;
  doc: DocMeta;
  mode: CallMode;
}

/**
 * The escalation request's input: Sonnet 5, effort low (thinking left adaptive and counted in max_tokens), only the
 * call's pages, only the failing codes that belong to the call.
 */
export function escalationInput(input: EscalateInput): ExtractCallInput {
  const [first, last] = input.pageRange;
  const callCodes = new Set(codesFor(input.table, input.call));
  return {
    call: input.call,
    lines: input.lines.filter((l) => l.page >= first && l.page <= last),
    codes: [...new Set(input.failingCodes)].filter((c) => callCodes.has(c)),
    table: input.table,
    model: ROUND3_MODELS.escalation,
    mode: input.mode,
    doc: input.doc,
    job: "escalation",
    effort: "low",
  };
}

/** One interactive escalation: Sonnet 5 re-reads only the call's pages for only the failing codes. */
export async function escalateCall(ctx: CallContext, input: EscalateInput): Promise<ExtractCallResult> {
  return extractCall(ctx, { ...escalationInput(input), mode: "interactive" });
}

/* ------------------------------------------------------------------ */
/* Round 3: the Haiku link picker (Decision 6, step 2)                 */
/* ------------------------------------------------------------------ */

/** A link on one of our fetched pages. */
export interface PageLink {
  text: string;
  url: string;
}

export interface PickerInput {
  college: { unit_id: string; name: string };
  links: readonly PageLink[];
  mode: CallMode;
  model?: string;
}

export interface PickResult {
  cds_index?: string;
  cds_file?: string;
  class_profile?: string;
}

/** About 4 K tokens of links (characters ÷ 3.5). */
export const PICKER_MAX_CHARS = 14_000;
export const PICKER_MAX_TOKENS = 256;

const PICKER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cds_index: { type: "integer", description: "Number of the link to the page listing each year's Common Data Set" },
    cds_file: { type: "integer", description: "Number of the link to the newest Common Data Set file itself (PDF, Excel, or HTML)" },
    class_profile: { type: "integer", description: "Number of the link to the newest first-year class profile or admissions facts page" },
  },
} as const;

const PICKER_SYSTEM = `You pick links for a program that downloads U.S. colleges' Common Data Sets (CDS). You get a numbered list of links found on one college's own web pages (link text and URL). Answer with the numbers of: the page that lists each year's CDS (cds_index), the newest CDS file itself (cds_file; prefer Excel over PDF when both are linked for the same year), and the newest first-year class profile or admissions facts page (class_profile). Leave a key out when no link fits. Choose only from the list.`;

/** Builds a picker request: the links, deduplicated, capped at ~4 K tokens. */
export function buildPickerRequest(input: PickerInput): BuiltRequest & { links: PageLink[] } {
  const model = input.model ?? ROUND3_MODELS.picker;
  priceOf(model);
  const links: PageLink[] = [];
  const rows: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const l of input.links) {
    if (!/^https?:\/\//.test(l.url) || seen.has(l.url)) continue;
    const row = `${links.length + 1} | ${l.text.replace(/\s+/g, " ").trim().slice(0, 120)} | ${l.url}`;
    if (chars + row.length > PICKER_MAX_CHARS) break;
    seen.add(l.url);
    links.push(l);
    rows.push(row);
    chars += row.length + 1;
  }
  const user = `College: ${input.college.name} (IPEDS unit ${input.college.unit_id})\n\nLinks:\n${rows.join("\n")}`;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: PICKER_MAX_TOKENS,
    system: PICKER_SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: PICKER_SCHEMA as unknown as Record<string, unknown> } },
  };
  const total = PICKER_SYSTEM.length + user.length;
  return { params, chars: total, estimated_input_tokens: estimateTokens(total), prefix_tokens: estimateTokens(PICKER_SYSTEM.length), cached: false, codes: [], links };
}

/** Maps the picker's link numbers back to URLs; a number outside the list is ignored (no invented links). */
export function parsePickerResponse(message: Anthropic.Message, links: readonly PageLink[]): PickResult {
  if (message.stop_reason === "refusal") throw new Error(`link picker refused (${message.stop_details?.category ?? "no category"})`);
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: PickResult = {};
  for (const key of ["cds_index", "cds_file", "class_profile"] as const) {
    const n = raw?.[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= links.length) out[key] = links[n - 1].url;
  }
  return out;
}

/** One interactive picker call (the pipeline batches pickers through batch.mts; this serves a single college or a test). */
export async function pickLinks(ctx: CallContext, input: PickerInput): Promise<PickResult> {
  if (input.mode !== "interactive") throw new Error("pickLinks runs interactive calls; batch them through batch.mts");
  const built = buildPickerRequest(input);
  if (!built.links.length) return {};
  const res = await ctx.client.messages.create(built.params);
  ctx.onCall?.(
    callLogRow(
      { run: ctx.run, at: (ctx.now?.() ?? new Date()).toISOString(), college: input.college.unit_id, job: "picker", model: built.params.model, mode: "interactive", document_type: null, call: null, estimated_input_tokens: built.estimated_input_tokens },
      res.usage,
      res.stop_reason,
    ),
  );
  return parsePickerResponse(res, built.links);
}

/* ------------------------------------------------------------------ */
/* Round 3: search only (Decision 6, step 3)                           */
/* ------------------------------------------------------------------ */

/** Step 3's limits: two searches in all (counted across continuation turns), no fetch, a few turns. */
export const SEARCH_ONLY_LIMITS = { searches: 2, turns: 4 } as const;

export interface SearchCandidate {
  kind: "cds" | "cds-index" | "class-profile";
  url: string;
}

export interface SearchOnlyResult {
  candidates: SearchCandidate[];
  none_found: boolean;
  /** Searches billed across every turn. */
  searches: number;
}

const CANDIDATES_TOOL: Anthropic.Tool = {
  name: "save_candidates",
  description: "Record candidate links for this college's Common Data Set and class profile. Call it exactly once, when done searching.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "none_found"],
    properties: {
      candidates: {
        type: "array",
        description: "At most five links from the search results, on the college's own site, best first",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "url"],
          properties: {
            kind: { type: "string", enum: ["cds", "cds-index", "class-profile"] },
            url: { type: "string" },
          },
        },
      },
      none_found: { type: "boolean" },
    },
  },
};

const SEARCH_ONLY_SYSTEM = `You find candidate links for a U.S. college's Common Data Set (CDS) and its newest first-year class profile, so a program can fetch them. Search the web at most twice. Do not open pages: the search results' URLs and titles are enough. Use only the college's own website or its institutional research office, never third-party sites. When done, call save_candidates exactly once with up to five links, best first: a CDS index page (kind "cds-index"), a CDS file (kind "cds"), or a class profile or admissions facts page (kind "class-profile"). If nothing fits, call it with none_found true.`;

type SearchSchool = Pick<School, "unit_id" | "name" | "location" | "links">;

/** One turn's search-only request: `web_search` only (no `web_fetch`), the uses left of the college's two, effort low. */
export function searchOnlyParams(messages: Anthropic.MessageParam[], searchesLeft: number, model: string = ROUND3_MODELS.search): Anthropic.MessageStreamParams {
  return {
    model,
    max_tokens: 4000,
    system: SEARCH_ONLY_SYSTEM,
    output_config: { effort: "low" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: Math.max(1, Math.min(SEARCH_ONLY_LIMITS.searches, searchesLeft)) }, CANDIDATES_TOOL],
    messages,
  };
}

/** Step 3: Sonnet 5 with at most two web searches and no fetch, returning candidate URLs for our code to fetch and scan. */
export async function searchOnly(ctx: CallContext, school: SearchSchool, opts: { model?: string } = {}): Promise<SearchOnlyResult> {
  const model = opts.model ?? ROUND3_MODELS.search;
  priceOf(model);
  const user = [
    `College: ${school.name} (${school.location.city}, ${school.location.state}), IPEDS unit ${school.unit_id}`,
    `Website: ${school.links?.website ?? "unknown"}`,
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  let searches = 0;
  let nudged = false;
  for (let turn = 0; turn < SEARCH_ONLY_LIMITS.turns; turn++) {
    const res = await ctx.client.messages
      .stream(searchOnlyParams([...messages], SEARCH_ONLY_LIMITS.searches - searches, model), { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) })
      .finalMessage();
    searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
    ctx.onCall?.(callLogRow({ run: ctx.run, at: (ctx.now?.() ?? new Date()).toISOString(), college: school.unit_id, job: "search", model, mode: "interactive", document_type: null, call: null, estimated_input_tokens: null }, res.usage, res.stop_reason));
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === CANDIDATES_TOOL.name);
    if (call) {
      const input = call.input as { candidates?: SearchCandidate[]; none_found?: boolean };
      const candidates = (input.candidates ?? []).filter((c) => /^https?:\/\//.test(c.url)).slice(0, 5);
      return { candidates, none_found: Boolean(input.none_found) || !candidates.length, searches };
    }
    if (res.stop_reason === "refusal") throw new Error(`search refused (${res.stop_details?.category ?? "no category"})`);
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn" && searches < SEARCH_ONLY_LIMITS.searches) continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Call save_candidates now with the links you found (none_found: true if none fit)." });
  }
  return { candidates: [], none_found: true, searches };
}
