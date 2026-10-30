/**
 * Reading one essay prompts page (specs/product/essays/prompts.md "Sources"): our code turns the page into text (the
 * engine's documents.mts), and one model call returns every prompt verbatim with its limit, whether it is required,
 * who it applies to, and the sentence each was read from, through structured output. The record our code builds from
 * the answer (`toRecord`) is then checked (./checks.mts) before anything is written as passing.
 *
 * The call (the Claude API rules for new code): `claude-opus-5`, adaptive thinking at effort medium, the stable system
 * block cached (`cache_control`), the JSON schema through `output_config.format` (never a prefill), `max_tokens` 8000,
 * and `stop_reason` checked: a refusal or a cut answer is no record. The client is injected, so tests pass a fake.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { EssayPrompt, School } from "../../../lib/types.ts";
import { htmlToText, pdfPages, windowAround } from "../college-reported/documents.mts";
import { estimateTokens } from "../college-reported/llm.mts";
import type { ModelClient } from "../college-reported/models.mts";
import { toWellFormedDeep } from "../college-reported/well-formed.mts";
import { worstCaseUsd, type SpendCap } from "../high-schools/profiles/budget.mts";
import { normalizeCycle, openCycle } from "./cycle.mts";
import { READER_VERSION, type EssayRecord, type FoundVia } from "./store.mts";

export const READ_MODEL = "claude-opus-5";
export const READ_MAX_TOKENS = 8000;
/** The page text sent: about 15 K tokens, centered on the first mention of essays. */
export const READ_MAX_CHARS = 50_000;

export const PROMPT_KINDS = ["essay", "short_answer", "why_us", "program", "activity", "optional", "other"] as const;

/* ------------------------------------------------------------------ */
/* The model's answer                                                  */
/* ------------------------------------------------------------------ */

export interface ReadPrompt {
  text: string;
  kind: EssayPrompt["kind"];
  limit: { kind: "words" | "characters"; max: number; min: number | null } | null;
  required: boolean;
  applies_to: { kind: "all" | "transfer" | "international" | "program"; program: string | null };
  quote: string;
}

export interface ReadAnswer {
  /** The page's own words naming the cycle ("2026–2027 Supplemental Essay Prompts"), or null when it names none. */
  cycle_quote: string | null;
  status: "published" | "none" | "refers_to_form";
  /** For none / refers_to_form: the sentence that says so. */
  status_quote: string | null;
  /** When the page says to answer some of the listed prompts: how many of how many, and the sentence. */
  choose: { n: number; of: number; quote: string } | null;
  prompts: ReadPrompt[];
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cycle_quote", "status", "status_quote", "choose", "prompts"],
  properties: {
    cycle_quote: nullable({ type: "string", description: "The page's own words that name the application cycle or entry term, copied exactly" }),
    status: { type: "string", enum: ["published", "none", "refers_to_form"] },
    status_quote: nullable({ type: "string", description: "For none or refers_to_form: the page's sentence that says so, copied exactly" }),
    choose: nullable({
      type: "object",
      additionalProperties: false,
      required: ["n", "of", "quote"],
      properties: {
        n: { type: "integer", description: "How many of the listed prompts an applicant answers" },
        of: { type: "integer", description: "How many prompts the page lists to choose from" },
        quote: { type: "string", description: "The page's sentence that says to choose, copied exactly" },
      },
    }),
    prompts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "kind", "limit", "required", "applies_to", "quote"],
        properties: {
          text: { type: "string", description: "The prompt exactly as the page prints it" },
          kind: { type: "string", enum: [...PROMPT_KINDS] },
          limit: nullable({
            type: "object",
            additionalProperties: false,
            required: ["kind", "max", "min"],
            properties: {
              kind: { type: "string", enum: ["words", "characters"] },
              max: { type: "integer" },
              min: nullable({ type: "integer" }),
            },
          }),
          required: { type: "boolean" },
          applies_to: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "program"],
            properties: {
              kind: { type: "string", enum: ["all", "transfer", "international", "program"] },
              program: nullable({ type: "string", description: "The school or program within the university, as the page names it" }),
            },
          },
          quote: { type: "string", description: "The page's sentence the limit and the requirement were read from, copied exactly" },
        },
      },
    },
  },
} as const;

export const READ_SYSTEM = `You read one page of a U.S. college's admissions website and report the essay and short-answer prompts it publishes for first-year applicants, as JSON. Your answer becomes data on a site that cites the page, so copy, never paraphrase.

Rules:
- text: each prompt exactly as printed, in page order, including every sentence of a multi-sentence prompt. Do not fix spelling or punctuation. Do not merge two prompts or split one. A list of options the applicant chooses one from is one prompt per option, each with the same quote.
- quote: the page's own sentence that states the prompt's length limit and whether it is required (often the line just before a list, or a table row). Copy it exactly. When the page states neither for a prompt, quote the prompt's first sentence.
- limit: only a limit the page prints ("250 words", "up to 100 characters", "150-300 words": min 150, max 300). null when the page prints none. Never guess one.
- required: true only when the page says required, must, or presents the prompt as part of the application with no optional word; false when the page says optional, "if you wish", "you may", or "encouraged", and false for every prompt in a list the applicant chooses some of (see choose).
- choose: when the page says applicants answer a set number of some listed prompts ("choose four of the eight", "respond to two of the following"), {n: how many to answer, of: how many prompts are in that set, quote: the sentence that says so, copied exactly}. Every prompt in the set has required: false; a prompt the page requires of everyone on its own (a "why us" essay beside the pick-some list) keeps required: true and is not counted in of. null when every listed prompt stands on its own.
- The application platforms' own prompts (the Common App's seven personal essay prompts, the Coalition's), reproduced on the college's page, are not the college's prompts: leave them out. If the page lists nothing else, status is refers_to_form with the sentence that points to the application.
- A page about something else that happens to say "supplemental" (tutoring, financial aid, pay) or "essay" (a contest, a course) is not an essay page: status none is only for a sentence that says the college asks for no essays beyond the application's own.
- kind: read from the prompt's own words. why_us only when the prompt asks why this college or this program; program when the prompt is for applicants to a named school, college, or program within the university; short_answer when the page calls it a short answer or its limit is under 150 words or 1,000 characters; activity when it asks about an activity or work; optional when the page labels the whole prompt optional and none of the above fits; essay for other essays; other for anything else (a list of books, a fill-in).
- applies_to: all, unless the page says the prompt is only for transfer applicants, international applicants, or applicants to a named program (then program, with its name as printed).
- cycle_quote: the page's own words naming the application year or entry term ("2026–2027 Essay Prompts", "for students applying for fall 2027"). null when the page names none; do not take a year from a copyright line, a news date, or a URL.
- status: published when the page lists prompts; none when it says the college requires no essays beyond the application's own; refers_to_form when it says the prompts are only inside the application (Common App, Coalition, the college's own form) and lists none. For none or refers_to_form, prompts is empty and status_quote is the sentence that says so.
- Published vs refers_to_form: if the page prints the text of any of the college's own prompts, status is published, even when the page also says the answers are submitted in the application ("Complete the Harvard Questions with the Common Application. This includes the following five required short-answer questions" followed by the five questions is published, with all five). A sentence that counts the questions ("There are five required short-answer questions") or names the supplement is never refers_to_form when the questions are printed anywhere on the page; read on and list them. refers_to_form is only for a page that prints none of the college's own prompt text.
- Leave out prompts for graduate, transfer-credit, scholarship, or honors-program applications unless the page presents them as part of the first-year application.`;

export interface ReadInput {
  school: Pick<School, "unit_id" | "name">;
  url: string;
  /** The page's text (`pageText`). */
  text: string;
  model?: string;
}

/** The page as the model reads it: an HTML page's readable text, or a PDF's pages, around the first mention of essays. */
export async function pageText(bytes: Uint8Array, format: "html" | "pdf"): Promise<string> {
  const text = format === "pdf" ? (await pdfPages(bytes)).map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n") : htmlToText(new TextDecoder().decode(bytes));
  return windowAround(text, "essay", READ_MAX_CHARS);
}

export function buildReadRequest(input: ReadInput): { params: Anthropic.MessageCreateParamsNonStreaming; estimated_input_tokens: number } {
  const model = input.model ?? READ_MODEL;
  const user = `College: ${input.school.name} (IPEDS unit ${input.school.unit_id})\nPage: ${input.url}\n\n<page>\n${input.text}\n</page>`;
  const params = toWellFormedDeep({
    model,
    max_tokens: READ_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: READ_SCHEMA as unknown as Record<string, unknown> } },
    system: [{ type: "text", text: READ_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  }) as Anthropic.MessageCreateParamsNonStreaming;
  // The schema is sent too (~1 K tokens).
  return { params, estimated_input_tokens: estimateTokens(READ_SYSTEM.length + user.length) + 1000 };
}

/** Why a read produced no answer: the model declined, its answer was cut, or it wasn't the schema's JSON. */
export class ReadFailed extends Error {
  readonly reason: "refusal" | "max_tokens" | "malformed";
  constructor(reason: "refusal" | "max_tokens" | "malformed", detail = "") {
    super(`essay page read failed: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ReadFailed";
    this.reason = reason;
  }
}

export function parseReadResponse(message: Pick<Anthropic.Message, "content" | "stop_reason"> & { stop_details?: { category?: string | null } | null }): ReadAnswer {
  if (message.stop_reason === "refusal") throw new ReadFailed("refusal", message.stop_details?.category ?? "");
  if (message.stop_reason === "max_tokens") throw new ReadFailed("max_tokens");
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ReadFailed("malformed", "not JSON");
  }
  const a = raw as Partial<ReadAnswer>;
  if (!a || typeof a !== "object" || !Array.isArray(a.prompts) || !["published", "none", "refers_to_form"].includes(a.status as string)) throw new ReadFailed("malformed", "not the schema's shape");
  return { cycle_quote: a.cycle_quote ?? null, status: a.status as ReadAnswer["status"], status_quote: a.status_quote ?? null, choose: (a.choose as ReadAnswer["choose"]) ?? null, prompts: a.prompts };
}

export interface ReadResult {
  answer: ReadAnswer;
  model: string;
  cost: number;
  usage: Anthropic.Usage;
}

/** One read under the spend cap (throws SpendCapReached before calling when the worst case doesn't fit). */
export async function readEssayPage(client: ModelClient, cap: SpendCap, input: ReadInput): Promise<ReadResult> {
  const built = buildReadRequest(input);
  const model = built.params.model;
  const worst = worstCaseUsd(model, built.estimated_input_tokens * 1.3, READ_MAX_TOKENS);
  const { result, cost } = await cap.run({ school: input.school.unit_id, job: "read", model, worst }, () => client.messages.create(built.params));
  return { answer: parseReadResponse(result), model, cost, usage: result.usage };
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface RecordContext {
  school: Pick<School, "unit_id" | "name">;
  url: string;
  final_url?: string;
  retrieved: string;
  sha256: string;
  archive?: string;
  via: FoundVia;
  model: string;
}

/**
 * The record our code builds from an answer: the cycle normalized from the page's own words (the cycle open on the day
 * read when the page names none, marked `cycle_assumed` for the PR's list), ids "{unit_id}:{cycle}:{n}" in page
 * order, applies_to in the contract's shape. The values themselves are the model's, unchanged, for the checks to judge.
 */
export function toRecord(answer: ReadAnswer, ctx: RecordContext): EssayRecord {
  const named = normalizeCycle(answer.cycle_quote);
  const cycle = named ?? openCycle(ctx.retrieved);
  const prompts: EssayPrompt[] = answer.status === "published"
    ? answer.prompts.map((p, i) => ({
        id: `${ctx.school.unit_id}:${cycle}:${i + 1}`,
        text: p.text,
        kind: p.kind,
        limit: p.limit ? { kind: p.limit.kind, max: p.limit.max, ...(p.limit.min != null ? { min: p.limit.min } : {}) } : null,
        required: p.required,
        applies_to: p.applies_to.kind === "program" ? { program: p.applies_to.program ?? "" } : p.applies_to.kind,
        quote: p.quote,
      }))
    : [];
  return {
    unit_id: ctx.school.unit_id,
    name: ctx.school.name,
    cycle,
    status: answer.status,
    source_url: ctx.url,
    ...(ctx.final_url && ctx.final_url !== ctx.url ? { final_url: ctx.final_url } : {}),
    retrieved: ctx.retrieved,
    sha256: ctx.sha256,
    ...(ctx.archive ? { archive: ctx.archive } : {}),
    cycle_quote: named ? (answer.cycle_quote ?? "") : "",
    ...(named ? {} : { cycle_assumed: true }),
    ...(answer.status !== "published" && answer.status_quote ? { status_quote: answer.status_quote } : {}),
    ...(answer.status === "published" && answer.choose ? { choose: { n: answer.choose.n, of: answer.choose.of, quote: answer.choose.quote } } : {}),
    via: ctx.via,
    model: ctx.model,
    reader: READER_VERSION,
    prompts,
  };
}
