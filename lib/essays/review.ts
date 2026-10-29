import "server-only";
/**
 * The reader (specs/product/essays/reviewer.md "How it reads"): one model call per review, on the server only, never
 * shipped to a browser. The stable system block (the rubric, ./rubric.ts, and the guidance corpus's sections for the
 * prompt's kind, ./guidance.ts) is the cached prefix; the context (./review-context.ts) and the draft are the user turn;
 * the notes come back through structured output (`output_config.format`, never a prefill) and pass the guard
 * (./review-guard.ts) before anything is stored.
 *
 * The call (the Claude API rules for new code): `claude-opus-5`, adaptive thinking at effort `medium`, `cache_control`
 * on the system block, `max_tokens` 8000, `stop_reason` checked (`refusal` means no notes this time; `max_tokens` drops
 * the answer with its reason), typed errors (`Anthropic.RateLimitError` before `Anthropic.APIError`). The client is a
 * dependency, so tests pass a fake and nothing here calls the API without `ANTHROPIC_API_KEY`.
 *
 * `handleReview` is POST /api/essays/review's whole decision, with its I/O passed in (app/api/essays/review/route.ts
 * wires the real session, database, and client): session, `allowed(user, "advisor.reviews")`, the request limiter, the
 * student-only rule, the caps (the migration's essay_review_allowance), the call, the guard, the record, telemetry.
 *
 * Relative imports with extensions, so `npm run eval:reviewer` runs this under node (with the react-server condition).
 */
import Anthropic from "@anthropic-ai/sdk";
import { countText } from "./count.ts";
import { citedUrls, guidanceText, type GuidanceSections } from "./guidance.ts";
import type { EssayKind } from "./prompts.ts";
import { guardNotes, orderNotes, type Dropped, type GuardedNote } from "./review-guard.ts";
import { userTurn, type ContextInput, type ReviewContext, reviewContext } from "./review-context.ts";
import { NOTE_CATEGORIES, REVIEW_METHOD, REVIEW_MODEL, rubricText, type NoteCategory } from "./rubric.ts";

export const REVIEW_MAX_TOKENS = 8000;
/** A draft shorter than this many words isn't read (there is nothing to note yet). */
export const REVIEW_MIN_WORDS = 10;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** The notes' shape (reviewer.md "What a note is"), as the structured output's JSON schema. */
export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: {
    notes: {
      type: "array",
      description: "At most twelve notes, the ones that matter most; empty when nothing is worth noting.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "paragraph", "quote", "observation", "why", "source", "ask", "fix"],
        properties: {
          category: { type: "string", enum: [...NOTE_CATEGORIES] },
          paragraph: nullable({ type: "integer", description: "The paragraph's number as the draft gives it ([¶0] is 0); null for the whole draft" }),
          quote: nullable({ type: "string", description: "The exact words the note is about, copied from that paragraph; null for the whole draft or paragraph" }),
          observation: { type: "string", description: "What you noticed, one sentence (two at most)" },
          why: { type: "string", description: "Why a reader of applications cares, one sentence (two at most), from the guidance" },
          source: nullable({ type: "string", description: "The url of the guidance source the why draws on, exactly as cited" }),
          ask: { type: "string", description: "A question to the student or a pointer to the spot; never words for the essay" },
          fix: nullable({ type: "string", description: "Mechanics only: the corrected word or punctuation, at most eight words; null otherwise" }),
        },
      },
    },
  },
} as const;

/** The stable prefix for a prompt kind: the rubric, then the guidance's sections for the kind. Same bytes per kind. */
export function systemBlock(kind: EssayKind, sections: GuidanceSections): { text: string; sources: Set<string> } {
  const guidance = guidanceText(sections, kind);
  return { text: `${rubricText()}\n\n${guidance}`, sources: citedUrls(guidance) };
}

export interface ReviewRequestInput {
  kind: EssayKind;
  guidance: GuidanceSections;
  context: ReviewContext;
  body: string;
  model?: string;
}

export function buildReviewRequest(input: ReviewRequestInput): { params: Anthropic.MessageCreateParamsNonStreaming; sources: Set<string>; system: string; user: string } {
  const { text, sources } = systemBlock(input.kind, input.guidance);
  const user = userTurn(input.context, input.body);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: input.model ?? REVIEW_MODEL,
    max_tokens: REVIEW_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA as unknown as Record<string, unknown> } },
    system: [{ type: "text", text, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  };
  return { params, sources, system: text, user };
}

export type ParsedReview = { kind: "ok"; notes: unknown[] } | { kind: "refusal" | "max_tokens" | "malformed" };

/** The answer's notes, or why there are none: the model declined, its answer was cut, or it wasn't the schema's JSON. */
export function parseReviewResponse(message: Pick<Anthropic.Message, "content" | "stop_reason">): ParsedReview {
  if (message.stop_reason === "refusal") return { kind: "refusal" };
  if (message.stop_reason === "max_tokens") return { kind: "max_tokens" };
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    const raw = JSON.parse(text) as { notes?: unknown };
    return raw && typeof raw === "object" && Array.isArray(raw.notes) ? { kind: "ok", notes: raw.notes } : { kind: "malformed" };
  } catch {
    return { kind: "malformed" };
  }
}

/** What a review stores as `usage`: the token counts, never text. */
export interface ReviewUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
const usageOf = (u: Partial<Anthropic.Usage> | null | undefined): ReviewUsage => ({
  input_tokens: u?.input_tokens ?? 0,
  output_tokens: u?.output_tokens ?? 0,
  cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
  cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
});

/** The one method the reader needs of a client (an `Anthropic` instance, or a fake in tests). */
export interface ReviewClient {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

/** The call didn't happen: the API was busy (rate limited) or failed. Nothing is recorded; the caps aren't spent. */
export class ReviewUnavailable extends Error {
  readonly reason: "busy" | "failed";
  constructor(reason: "busy" | "failed", detail = "") {
    super(`essay review unavailable: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ReviewUnavailable";
    this.reason = reason;
  }
}

/** `notes`: at least one note passed. `none`: the reader found nothing, or the guard dropped every note. */
export type ReviewOutcome = "notes" | "none" | "refusal" | "max_tokens" | "malformed";
export const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ["notes", "none", "refusal", "max_tokens", "malformed"];

export interface ReviewResult {
  outcome: ReviewOutcome;
  notes: GuardedNote[];
  dropped: Dropped[];
  usage: ReviewUsage;
  model: string;
}

/** One read: the call, the parse, the guard. Throws ReviewUnavailable when the API is busy or fails. */
export async function readDraft(client: ReviewClient, input: ReviewRequestInput & { promptText?: string | null }): Promise<ReviewResult> {
  const built = buildReviewRequest(input);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(built.params);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new ReviewUnavailable("busy");
    if (err instanceof Anthropic.APIError) throw new ReviewUnavailable("failed", String(err.status ?? ""));
    throw new ReviewUnavailable("failed", err instanceof Error ? err.message : String(err));
  }
  const usage = usageOf(message.usage);
  const model = message.model || built.params.model;
  const parsed = parseReviewResponse(message);
  if (parsed.kind !== "ok") return { outcome: parsed.kind, notes: [], dropped: [], usage, model };
  const guarded = guardNotes(parsed.notes, input.body, { promptText: input.promptText ?? [input.context.prompt.text, ...input.context.prompt.choices].filter(Boolean).join(" "), allowedSources: built.sources });
  const notes = orderNotes(guarded.kept);
  return { outcome: notes.length ? "notes" : "none", notes, dropped: guarded.dropped, usage, model };
}

/* ------------------------------------------------------------------ */
/* The route's decision                                                */
/* ------------------------------------------------------------------ */

export type CapReason = "draft_day" | "student_day" | "draft_cycle";
export type Allowance = { ok: true } | { ok: false; reason: CapReason | "not_yours" };

/** The words a refused request gets (no grade words, no "AI"). */
export const CAP_MESSAGE: Record<CapReason, string> = {
  draft_day: "That's five reads of this draft today, the most one draft gets in a day. Try again tomorrow.",
  student_day: "That's fifty reads today across your drafts. Try again tomorrow.",
  draft_cycle: "This draft has had sixty reads this application year, the most one draft gets.",
};
export const CAP_REACHED = "That's the most reads this draft gets for now. Try again tomorrow.";
export const NOTHING_TO_NOTE = "Nothing to note this time.";

export type LoadedDraft =
  | { kind: "ready"; essayId: string; versionId: string; body: string; promptKind: EssayKind; promptRef: string; studentId: string }
  | { kind: "not-found" }
  | { kind: "not-student" }
  | { kind: "setup-missing" };

export interface StoredNote extends GuardedNote {
  id: string;
  state: "open" | "done" | "ignored";
}
export interface StoredReview {
  id: string;
  version_id: string;
  created: string;
  outcome: ReviewOutcome;
  method: string;
  notes: StoredNote[];
}

export interface RecordInput {
  essayId: string;
  versionId: string;
  method: string;
  model: string;
  outcome: ReviewOutcome;
  usage: ReviewUsage;
  dropped: Dropped[];
  notes: GuardedNote[];
}

/** Telemetry the route sends (lib/analytics.ts; counts and kinds only, never text). */
export type ReviewEvent =
  | { event: "essay_review_requested"; properties: { prompt_kind: string } }
  | { event: "essay_review_notes"; properties: { count: number; categories: string } }
  | { event: "essay_review_dropped"; properties: { reason: string } };

export interface ReviewDeps {
  user(): Promise<{ id: string } | null>;
  allowed(user: { id: string }): Promise<boolean>;
  /** The request limiter (TokenBuckets, as /api/estimate): one token per request. */
  limit(userId: string): { ok: true } | { ok: false; retryAfter: number };
  /** The draft and the version to read, with the viewer's session: a version named, else the draft as saved now. */
  loadDraft(essayId: string, versionId: string | null): Promise<LoadedDraft>;
  allowance(essayId: string): Promise<Allowance>;
  /** What the reader knows (review-context.ts's inputs), read for the draft. */
  contextInput(draft: Extract<LoadedDraft, { kind: "ready" }>): Promise<ContextInput>;
  guidance(): GuidanceSections;
  /** Null without ANTHROPIC_API_KEY. */
  client(): ReviewClient | null;
  record(r: RecordInput): Promise<{ ok: true; review: StoredReview } | { ok: false; reason: "cap" | "failed" }>;
  track(e: ReviewEvent, userId: string): void;
}

export interface Reply {
  status: number;
  body: { error: string; retryAfter?: number } | { review: StoredReview; message: string | null };
  headers?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status: number, error: string, headers?: Record<string, string>): Reply => ({ status, body: { error }, ...(headers ? { headers } : {}) });

/** POST /api/essays/review's whole decision. Never throws. */
export async function handleReview(deps: ReviewDeps, body: unknown): Promise<Reply> {
  const b = (typeof body === "object" && body !== null ? body : {}) as { essayId?: unknown; versionId?: unknown };
  const essayId = typeof b.essayId === "string" && UUID.test(b.essayId) ? b.essayId : null;
  const versionId = b.versionId == null ? null : typeof b.versionId === "string" && UUID.test(b.versionId) ? b.versionId : undefined;
  if (!essayId || versionId === undefined) return err(400, "Send the draft to read.");

  const user = await deps.user().catch(() => null);
  if (!user) return err(401, "Sign in first.");
  if (!(await deps.allowed(user))) return err(403, "A reader's notes aren't available on your account.");
  const limited = deps.limit(user.id);
  if (!limited.ok) return err(429, "Too many requests. Try again in a moment.", { "Retry-After": String(limited.retryAfter) });

  let draft: LoadedDraft;
  try {
    draft = await deps.loadDraft(essayId, versionId);
  } catch (e) {
    console.error(`essays: review load failed: ${e instanceof Error ? e.message : String(e)}`);
    return err(500, "That didn't work. Try again in a moment.");
  }
  if (draft.kind === "setup-missing") return err(503, "A reader's notes aren't set up yet.");
  if (draft.kind === "not-found") return err(404, "That draft isn't here.");
  if (draft.kind === "not-student") return err(403, "Only the student asks for a reader's notes on their draft.");
  if (countText(draft.body, "words") < REVIEW_MIN_WORDS) return err(400, "There isn't enough here to read yet.");

  let allowance: Allowance;
  try {
    allowance = await deps.allowance(essayId);
  } catch (e) {
    console.error(`essays: review allowance failed: ${e instanceof Error ? e.message : String(e)}`);
    return err(503, "A reader's notes aren't set up yet.");
  }
  if (!allowance.ok) return allowance.reason === "not_yours" ? err(403, "Only the student asks for a reader's notes on their draft.") : err(429, CAP_MESSAGE[allowance.reason]);

  const client = deps.client();
  if (!client) return err(503, "The reader isn't switched on here yet.");

  let context: ReviewContext;
  let guidance: GuidanceSections;
  let promptText: string | null;
  try {
    const input = await deps.contextInput(draft);
    context = reviewContext(input);
    promptText = [input.prompt.text, ...input.prompt.options].filter(Boolean).join(" ");
    guidance = deps.guidance();
  } catch (e) {
    console.error(`essays: review context failed: ${e instanceof Error ? e.message : String(e)}`);
    return err(500, "That didn't work. Try again in a moment.");
  }

  deps.track({ event: "essay_review_requested", properties: { prompt_kind: draft.promptKind } }, user.id);
  let result: ReviewResult;
  try {
    result = await readDraft(client, { kind: draft.promptKind, guidance, context, body: draft.body, promptText });
  } catch (e) {
    const reason = e instanceof ReviewUnavailable ? e.reason : "failed";
    console.error(`essays: review call failed: ${e instanceof Error ? e.message : String(e)}`);
    return reason === "busy" ? err(503, "The reader is busy. Try again in a minute.", { "Retry-After": "60" }) : err(502, "The reader couldn't read this draft just now. Try again in a moment.");
  }

  const reasons: string[] = result.outcome === "notes" || result.outcome === "none" ? result.dropped.map((d) => d.reason) : [result.outcome];
  for (const reason of reasons) deps.track({ event: "essay_review_dropped", properties: { reason } }, user.id);
  if (result.dropped.length) console.warn(`essays: review dropped ${result.dropped.length} note(s): ${result.dropped.map((d) => `${d.category}/${d.reason}`).join(", ")}`);

  const stored = await deps.record({ essayId, versionId: draft.versionId, method: REVIEW_METHOD, model: result.model, outcome: result.outcome, usage: result.usage, dropped: result.dropped, notes: result.notes });
  // A cap reached while this read ran (another request finished first): the notes aren't kept.
  if (!stored.ok) return stored.reason === "cap" ? err(429, CAP_REACHED) : err(500, "That didn't work. Try again in a moment.");

  const categories = [...new Set(result.notes.map((n) => n.category))].sort((a, b) => NOTE_CATEGORIES.indexOf(a as NoteCategory) - NOTE_CATEGORIES.indexOf(b as NoteCategory));
  deps.track({ event: "essay_review_notes", properties: { count: result.notes.length, categories: categories.join(",") } }, user.id);
  return { status: 200, body: { review: stored.review, message: result.notes.length ? null : NOTHING_TO_NOTE } };
}
