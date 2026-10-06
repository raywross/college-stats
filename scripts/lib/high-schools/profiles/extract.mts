/**
 * The `hs-profile` extraction schema: one model call reads a school profile's numbered lines and answers a fixed JSON
 * schema (structured outputs) in which every value carries the ids of the lines it is printed on. Numbers come back as
 * printed strings; our code parses them, builds the quotes from the cited lines, and checks them (./checks.mts).
 * Haiku 4.5 by default (ROUND3_MODELS.extraction); the escalation re-read uses ROUND3_MODELS.escalation, as the
 * college-reported engine does.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ROUND3_MODELS } from "../../../../lib/reported.ts";
import type { NumberedLine } from "../../../../lib/cds-quotes.ts";
import { estimateTokens } from "../../college-reported/llm.mts";
import { priceOf, type ModelClient } from "../../college-reported/models.mts";
import { renderProfileLines } from "./document.mts";
import { worstCaseUsd, type SpendCap } from "./budget.mts";

export const PROFILE_MODELS = {
  extraction: ROUND3_MODELS.extraction,
  escalation: ROUND3_MODELS.escalation,
  search: ROUND3_MODELS.search,
  picker: ROUND3_MODELS.picker,
} as const;

export const EXTRACTION_MAX_TOKENS = 12_000;

/* ------------------------------------------------------------------ */
/* The model's answer                                                   */
/* ------------------------------------------------------------------ */

export interface CitedText {
  text: string;
  lines: number[];
}
export interface CitedString {
  v: string;
  lines: number[];
}

export type GpaKind = "unweighted-4" | "weighted-5" | "100-point" | "other";

/** What the model returns. Every key is optional: a key is left out when the profile doesn't print it. */
export interface ProfileAnswer {
  school_name?: CitedText;
  edition?: CitedText;
  class_size?: CitedString;
  gpa_scale?: { kind: GpaKind; max: string; weighted: boolean; lines: number[]; rule_lines: number[] };
  gpa_distribution?: { basis: "percent" | "count"; bands: { band: string; v: string; lines: number[] }[] };
  ap_courses?: { names: string[]; lines: number[] };
  ib_courses?: { names: string[]; lines: number[] };
  sat_mid50?: { low: string; high: string; lines: number[] };
  act_mid50?: { low: string; high: string; lines: number[] };
  matriculation?: { classes: string; lines: number[]; entries: { name: string; count: string; lines: number[] }[] };
}

export const PROFILE_FIELDS = [
  "class_size",
  "gpa_scale",
  "gpa_distribution",
  "ap_courses",
  "ib_courses",
  "sat_mid50",
  "act_mid50",
  "matriculation",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

const lines = { type: "array", items: { type: "integer" }, description: "Ids of the lines the value is printed on (one to three)" } as const;
const cited = (description: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["text", "lines"],
  properties: { text: { type: "string", description }, lines },
});

export const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    school_name: cited("The school's name as the profile prints it"),
    edition: cited('The school year or class the profile describes, as printed ("2025-2026", "Class of 2026")'),
    class_size: {
      type: "object",
      additionalProperties: false,
      required: ["v", "lines"],
      properties: { v: { type: "string", description: "Number of students in the senior (graduating) class, digits only" }, lines },
    },
    gpa_scale: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "max", "weighted", "lines", "rule_lines"],
      properties: {
        kind: { type: "string", enum: ["unweighted-4", "weighted-5", "100-point", "other"] },
        max: { type: "string", description: 'The top of the scale as printed ("4.0", "5.0", "100"); empty when not printed' },
        weighted: { type: "boolean", description: "True when the school's reported GPA adds weight for honors/AP/IB courses" },
        lines,
        rule_lines: { type: "array", items: { type: "integer" }, description: "Ids of the lines that state how grades convert to points or how weighting works (the school's own rule); empty when not stated" },
      },
    },
    gpa_distribution: {
      type: "object",
      additionalProperties: false,
      required: ["basis", "bands"],
      properties: {
        basis: { type: "string", enum: ["percent", "count"], description: "Whether the bands are printed as percentages or as numbers of students" },
        bands: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["band", "v", "lines"],
            properties: { band: { type: "string", description: 'The band label as printed ("3.50-3.99")' }, v: { type: "string", description: "The percentage or count printed for the band, digits only" }, lines },
          },
        },
      },
    },
    ap_courses: { type: "object", additionalProperties: false, required: ["names", "lines"], properties: { names: { type: "array", items: { type: "string" } }, lines } },
    ib_courses: { type: "object", additionalProperties: false, required: ["names", "lines"], properties: { names: { type: "array", items: { type: "string" } }, lines } },
    sat_mid50: { type: "object", additionalProperties: false, required: ["low", "high", "lines"], properties: { low: { type: "string" }, high: { type: "string" }, lines } },
    act_mid50: { type: "object", additionalProperties: false, required: ["low", "high", "lines"], properties: { low: { type: "string" }, high: { type: "string" }, lines } },
    matriculation: {
      type: "object",
      additionalProperties: false,
      required: ["classes", "lines", "entries"],
      properties: {
        classes: { type: "string", description: 'Which graduating classes the list covers, as printed ("Class of 2025", "2023-2025")' },
        lines,
        entries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "count", "lines"],
            properties: { name: { type: "string" }, count: { type: "string", description: "Students who ENROLLED, digits only; empty when the profile gives no count" }, lines },
          },
        },
      },
    },
  },
} as const;

export const PROFILE_SYSTEM = `You read one U.S. high school's "school profile" (the document a school sends colleges with every application) and report what it prints, as JSON.

The document comes as numbered lines of layout text. Each line starts with its id and a bar ("41| ..."); pages are marked "--- Page N ---". Cells on one line are separated by " | ", and "@x" tags give a cell's horizontal position, so you can tell which column a value sits in.

Rules:
- Report only what the document prints. Leave a key out entirely when the profile doesn't print it. Never compute, convert, estimate, or fill in from general knowledge.
- Every value carries "lines": the ids of the lines it is printed on (and its label's line when that is different). One to three ids.
- Numbers are strings of digits as printed, without commas, "%", or "~" ("515", "21.5").
- class_size: the number of seniors (the graduating class this profile describes). Not total enrollment.
- gpa_scale: kind is the base scale the school states: "unweighted-4" for a 4.0 scale (A = 4.0), "weighted-5" when the school states a 5.0 scale, "100-point" for a numeric 0-100 scale, otherwise "other". max is the top of that base scale as printed. weighted is true when the school reports a GPA with extra points for Honors/AP/IB courses (even if it also reports an unweighted one). rule_lines are the lines where the school states its grade-to-point conversion or weighting rule (e.g. "A = 4.0, B = 3.0 ... Honors and AP courses receive one additional point").
- gpa_distribution: only a distribution of the class across GPA bands (a table or chart of bands with a percentage or number of students in each). A list of percentile cut-offs (top 10% = 4.3) or deciles is NOT a distribution: leave it out. Copy each band label as printed.
- ap_courses / ib_courses: the Advanced Placement / International Baccalaureate courses the school offers, each name as printed. Leave ib_courses out unless the school offers IB.
- sat_mid50 / act_mid50: only a middle 50% (25th-75th percentile) range. A mean or median score is NOT a middle 50% range: leave it out.
- matriculation: where graduates ENROLLED (attended/matriculated), with counts where printed. If the profile lists only acceptances/admissions (colleges that admitted students), leave matriculation out. Copy each college name as printed; one entry per college. When the profile says how to read unnumbered entries (e.g. "numbers in parentheses indicate more than one student"), give an unnumbered entry the count that rule implies (1). When a table gives counts for more than one span (one class and a multi-year total), report the multi-year total and name that span in classes.
- Ignore everything else (course descriptions, staff, mission statements).`;

/* ------------------------------------------------------------------ */
/* The call                                                             */
/* ------------------------------------------------------------------ */

export interface ExtractInput {
  school: { id: string; name: string; city: string | null; state: string };
  lines: readonly NumberedLine[];
  url: string;
  model?: string;
}

export function buildProfileRequest(input: ExtractInput): { params: Anthropic.MessageCreateParamsNonStreaming; estimated_input_tokens: number } {
  const model = input.model ?? PROFILE_MODELS.extraction;
  priceOf(model);
  const user = `School: ${input.school.name} (${input.school.city ?? "?"}, ${input.school.state}), NCES id ${input.school.id}\nDocument: ${input.url}\n\n<document>\n${renderProfileLines(input.lines)}\n</document>`;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: EXTRACTION_MAX_TOKENS,
    system: PROFILE_SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: PROFILE_SCHEMA as unknown as Record<string, unknown> } },
  };
  // The schema is sent too; ~1.5 K tokens of it is a fair allowance.
  return { params, estimated_input_tokens: estimateTokens(PROFILE_SYSTEM.length + user.length) + 1500 };
}

/** Reads the response text into a ProfileAnswer; a cut (max_tokens) or malformed answer is an empty one plus a flag. */
export function parseProfileResponse(message: Pick<Anthropic.Message, "content" | "stop_reason">): { answer: ProfileAnswer; truncated: boolean } {
  if (message.stop_reason === "refusal") throw new Error("extraction refused");
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    const parsed = JSON.parse(text) as ProfileAnswer;
    return { answer: parsed && typeof parsed === "object" ? parsed : {}, truncated: message.stop_reason === "max_tokens" };
  } catch {
    return { answer: {}, truncated: message.stop_reason === "max_tokens" };
  }
}

export interface ExtractResult {
  answer: ProfileAnswer;
  truncated: boolean;
  model: string;
  cost: number;
  usage: Anthropic.Usage;
}

/** One extraction call under the spend cap (throws SpendCapReached before calling when the worst case doesn't fit). */
export async function extractProfile(client: ModelClient, cap: SpendCap, input: ExtractInput, job: "extraction" | "escalation" = "extraction"): Promise<ExtractResult> {
  const built = buildProfileRequest(input);
  const model = built.params.model;
  const worst = worstCaseUsd(model, built.estimated_input_tokens * 1.3, EXTRACTION_MAX_TOKENS);
  const { result, cost } = await cap.run({ school: input.school.id, job, model, worst }, () => client.messages.create(built.params));
  const { answer, truncated } = parseProfileResponse(result);
  return { answer, truncated, model, cost, usage: result.usage };
}
