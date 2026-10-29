/**
 * The reader's call and POST /api/essays/review's decision (lib/essays/review.ts; specs/product/essays/reviewer.md "How
 * it reads", "When it runs"), with a fake model client and fake I/O: the request's shape (Opus 5, adaptive thinking at
 * effort medium, the schema through output_config.format, the cached system block, 8,000 tokens, no prefill); the
 * stop reasons (a refusal is no notes; a cut answer is dropped with its reason); typed API errors (nothing recorded, no
 * cap spent); the session, the entitlement, the limiter, the student-only rule, the caps (five per draft per day, fifty
 * per student, sixty per cycle); the guard before storing; telemetry without text. The route file is read to check it
 * wires exactly this. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";

const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => { url: string; shortCircuit?: boolean }): { url: string; shortCircuit?: boolean } }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const review = await import("../lib/essays/review.ts");
const { parseGuidance } = await import("../lib/essays/guidance.ts");
const { reviewContext } = await import("../lib/essays/review-context.ts");
const { NOTE_CATEGORIES, REVIEW_METHOD } = await import("../lib/essays/rubric.ts");
const { MAIN_REF } = await import("../lib/essays/prompts.ts");
type ReviewDeps = import("../lib/essays/review.ts").ReviewDeps;
type RecordInput = import("../lib/essays/review.ts").RecordInput;
type ReviewEvent = import("../lib/essays/review.ts").ReviewEvent;
type Message = import("@anthropic-ai/sdk").default.Message;
type Params = import("@anthropic-ai/sdk").default.MessageCreateParamsNonStreaming;

const ROOT = join(import.meta.dirname, "..");
const GUIDANCE = parseGuidance(readFileSync(join(ROOT, "data/reference/essay-guidance/guidance.md"), "utf8"));

const ESSAY = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const BODY = "Their was a customer who came in every Saturday with a flat tire.\n\nI learned leadership and responsibility from him over two long summers at the shop.";

const NOTES = [
  { category: "mechanics", paragraph: 0, quote: "Their was", observation: "'Their' here should be 'There'.", why: "A wrong word that is still a word distracts a reader.", source: null, ask: "Did you mean 'There was'?", fix: "There was" },
  { category: "specific", paragraph: 1, quote: "I learned leadership and responsibility", observation: "This names two lessons with no moment behind them.", why: "Readers remember a scene more than a virtue.", source: null, ask: "What did he do on the day you learned one of them?", fix: null },
];

function message(over: Partial<Message> & { json?: unknown } = {}): Message {
  const { json, ...rest } = over;
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: JSON.stringify(json ?? { notes: NOTES }), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: { input_tokens: 1200, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 9800, cache_creation: null, inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: null },
    ...rest,
  } as unknown as Message;
}

interface World {
  deps: ReviewDeps;
  calls: Params[];
  recorded: RecordInput[];
  events: ReviewEvent[];
  reviewsToday: number;
}

function world(over: Partial<ReviewDeps> & { reply?: () => Message | Promise<Message>; caps?: boolean } = {}): World {
  const w: World = { deps: null as unknown as ReviewDeps, calls: [], recorded: [], events: [], reviewsToday: 0 };
  const reply = over.reply ?? (() => message());
  w.deps = {
    user: async () => ({ id: "user-1" }),
    allowed: async () => true,
    limit: () => ({ ok: true }),
    loadDraft: async () => ({ kind: "ready", essayId: ESSAY, versionId: VERSION, body: BODY, promptKind: "why_us", promptRef: "college:199847:2026-27:1", studentId: "s-1" }),
    // The migration's essay_review_allowance, as a counter: five per draft per day.
    allowance: async () => (over.caps === false || w.reviewsToday < 5 ? { ok: true } : { ok: false, reason: "draft_day" }),
    contextInput: async () => ({
      essayId: ESSAY,
      prompt: { title: "Why us", text: "Why Wake Forest? (150 words)", options: [], kind: "why_us", limit: { kind: "words", max: 150 }, required: true, college: { unit_id: "199847", name: "Wake Forest University" }, quote: null },
      school: null,
      profile: null,
      studentName: "Maya Ortiz",
      drafts: [],
      interest: null,
      priorNotes: [],
    }),
    guidance: () => GUIDANCE,
    client: () => ({
      messages: {
        create: async (p: Params) => {
          w.calls.push(p);
          return reply();
        },
      },
    }),
    record: async (r) => {
      w.recorded.push(r);
      w.reviewsToday++;
      return { ok: true, review: { id: "r-1", version_id: r.versionId, created: "2026-10-29T12:00:00Z", outcome: r.outcome, method: r.method, notes: r.notes.map((n, i) => ({ ...n, id: `n-${i}`, state: "open" as const })) } };
    },
    track: (e) => {
      w.events.push(e);
    },
    ...over,
  };
  return w;
}

const ask = (w: World, body: unknown = { essayId: ESSAY, versionId: VERSION }) => review.handleReview(w.deps, body);

/* ------------------------------------------------------------------ */
/* The request                                                         */
/* ------------------------------------------------------------------ */

test("the request: Opus 5, adaptive thinking at medium effort, the schema through output_config, a cached system block, 8,000 tokens, no prefill", async () => {
  const w = world();
  await ask(w);
  assert.equal(w.calls.length, 1);
  const p = w.calls[0] as Params & { output_config: { effort: string; format: { type: string; schema: unknown } } };
  assert.equal(p.model, "claude-opus-5");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.equal(p.output_config.effort, "medium");
  assert.equal(p.output_config.format.type, "json_schema");
  assert.deepEqual(p.output_config.format.schema, review.REVIEW_SCHEMA);
  assert.equal(p.max_tokens, 8000);
  const system = p.system as { type: string; text: string; cache_control?: { type: string } }[];
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(p.messages.map((m) => m.role), ["user"], "one user turn: no assistant prefill");
  const user = p.messages[0].content as string;
  assert.ok(user.includes("[¶0] Their was a customer"), "the draft, paragraphs numbered");
  assert.ok(!system[0].text.includes("Their was a customer"), "the draft is never in the cached prefix");
  assert.ok(!user.includes("Maya"), "the student's name is not sent");
});

test("the system block is the same bytes for every review of a kind (it caches) and differs by kind group", () => {
  const ctxA = reviewContext({ essayId: "a", prompt: { title: "Why us", text: "Why A?", options: [], kind: "why_us", limit: null, required: true, college: null, quote: null }, school: null, profile: null, studentName: null, drafts: [], interest: null, priorNotes: [] });
  const ctxB = reviewContext({ essayId: "b", prompt: { title: "Why us", text: "Why B?", options: [], kind: "why_us", limit: null, required: true, college: null, quote: null }, school: null, profile: null, studentName: null, drafts: [], interest: null, priorNotes: [] });
  const a = review.buildReviewRequest({ kind: "why_us", guidance: GUIDANCE, context: ctxA, body: "One draft." });
  const b = review.buildReviewRequest({ kind: "why_us", guidance: GUIDANCE, context: ctxB, body: "Another draft entirely." });
  assert.equal(a.system, b.system);
  assert.notEqual(a.user, b.user);
  const c = review.buildReviewRequest({ kind: "personal", guidance: GUIDANCE, context: ctxA, body: "One draft." });
  assert.notEqual(a.system, c.system);
});

test("the schema: every note field required, the eight categories, nothing extra", () => {
  const item = review.REVIEW_SCHEMA.properties.notes.items;
  assert.deepEqual([...item.required].sort(), ["ask", "category", "fix", "observation", "paragraph", "quote", "source", "why"]);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.properties.category.enum, [...NOTE_CATEGORIES]);
});

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

test("a good answer: the notes pass the guard, are stored with the method and usage, and come back; telemetry has no text", async () => {
  const w = world();
  const r = await ask(w);
  assert.equal(r.status, 200);
  assert.equal(w.recorded.length, 1);
  const rec = w.recorded[0];
  assert.equal(rec.method, REVIEW_METHOD);
  assert.equal(rec.outcome, "notes");
  assert.deepEqual(rec.usage, { input_tokens: 1200, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 9800 });
  assert.deepEqual(rec.notes.map((n) => [n.category, n.span, n.fix]), [["mechanics", { paragraph: 0, start: 0, end: 9 }, "There was"], ["specific", { paragraph: 1, start: 0, end: 39 }, null]]);
  assert.ok("review" in r.body && r.body.review.notes.length === 2 && r.body.message === null);
  assert.deepEqual(w.events, [
    { event: "essay_review_requested", properties: { prompt_kind: "why_us" } },
    { event: "essay_review_notes", properties: { count: 2, categories: "mechanics,specific" } },
  ]);
});

test("the guard runs before storing: a rewrite and a grade are dropped, counted by reason, never stored", async () => {
  const bad = [
    ...NOTES,
    { category: "voice", paragraph: 1, quote: null, observation: "This is a strong paragraph.", why: "Readers like it.", source: null, ask: "Keep it?", fix: null },
    { category: "structure", paragraph: null, quote: null, observation: "The opening is slow.", why: "Readers decide early.", source: null, ask: "Try writing 'The shop smelled of rubber' as your first line?", fix: null },
  ];
  const w = world({ reply: () => message({ json: { notes: bad } }) });
  await ask(w);
  assert.equal(w.recorded[0].notes.length, 2);
  assert.deepEqual(w.recorded[0].dropped, [{ category: "voice", reason: "grade_word" }, { category: "structure", reason: "prose" }]);
  assert.deepEqual(w.events.filter((e) => e.event === "essay_review_dropped").map((e) => e.properties), [{ reason: "grade_word" }, { reason: "prose" }]);
  for (const e of w.events) for (const v of Object.values(e.properties)) assert.ok(!String(v).includes("strong") && !String(v).includes("shop"), "no text in telemetry");
});

test("every note dropped: stored as nothing to note, and the student sees 'Nothing to note this time.'", async () => {
  const w = world({ reply: () => message({ json: { notes: [{ ...NOTES[1], fix: "a whole new sentence here" }] } }) });
  const r = await ask(w);
  assert.equal(r.status, 200);
  assert.equal(w.recorded[0].outcome, "none");
  assert.ok("review" in r.body && r.body.message === review.NOTHING_TO_NOTE);
});

test("stop reasons: a refusal is no notes; a cut answer and malformed JSON are dropped with their reason; each still counts", async () => {
  for (const [reply, outcome] of [
    [() => message({ stop_reason: "refusal" }), "refusal"],
    [() => message({ stop_reason: "max_tokens" }), "max_tokens"],
    [() => message({ content: [{ type: "text", text: "Here are my notes: …", citations: null }] as Message["content"] }), "malformed"],
    [() => message({ json: { comments: [] } }), "malformed"],
  ] as const) {
    const w = world({ reply });
    const r = await ask(w);
    assert.equal(r.status, 200, outcome);
    assert.equal(w.recorded[0].outcome, outcome);
    assert.equal(w.recorded[0].notes.length, 0);
    assert.ok("review" in r.body && r.body.message === review.NOTHING_TO_NOTE);
    assert.deepEqual(w.events.find((e) => e.event === "essay_review_dropped")?.properties, { reason: outcome });
  }
});

test("typed API errors: rate limited is 'busy' (503), any other API error 502; nothing recorded, no cap spent", async () => {
  const limited = world({ reply: () => Promise.reject(new Anthropic.RateLimitError(429, {}, "rate limited", new Headers())) });
  const r1 = await ask(limited);
  assert.equal(r1.status, 503);
  assert.equal(r1.headers?.["Retry-After"], "60");
  assert.equal(limited.recorded.length, 0);
  const failed = world({ reply: () => Promise.reject(new Anthropic.InternalServerError(500, {}, "boom", new Headers())) });
  const r2 = await ask(failed);
  assert.equal(r2.status, 502);
  assert.equal(failed.recorded.length, 0);
  const thrown = world({ reply: () => Promise.reject(new Error("socket hang up")) });
  assert.equal((await ask(thrown)).status, 502);
  assert.ok(review.readDraft.length > 0);
});

/* ------------------------------------------------------------------ */
/* Who may ask, and how often                                          */
/* ------------------------------------------------------------------ */

test("signed out 401; not entitled 403; over the limiter 429 with Retry-After; a bad body 400; no key 503; never a call", async () => {
  const cases: [Partial<ReviewDeps>, number, unknown?][] = [
    [{ user: async () => null }, 401],
    [{ allowed: async () => false }, 403],
    [{ limit: () => ({ ok: false, retryAfter: 7 }) }, 429],
    [{}, 400, { essayId: "not-a-uuid" }],
    [{}, 400, { essayId: ESSAY, versionId: 5 }],
    [{ client: () => null }, 503],
    [{ loadDraft: async () => ({ kind: "not-found" }) }, 404],
    [{ loadDraft: async () => ({ kind: "setup-missing" }) }, 503],
    [{ loadDraft: async () => ({ kind: "ready", essayId: ESSAY, versionId: VERSION, body: "Too short.", promptKind: "why_us", promptRef: "free", studentId: "s-1" }) }, 400],
    [{ allowance: async () => Promise.reject(new Error("function missing")) }, 503],
  ];
  for (const [over, status, body] of cases) {
    const w = world(over);
    const r = await ask(w, body ?? { essayId: ESSAY, versionId: VERSION });
    assert.equal(r.status, status, JSON.stringify(Object.keys(over)) + JSON.stringify(body ?? ""));
    assert.equal(w.calls.length, 0, "no model call");
    assert.equal(w.recorded.length, 0);
    if (status === 429) assert.equal(r.headers?.["Retry-After"], "7");
  }
});

test("a guardian (not the student) is refused before any call: the reader runs only when the student asks", async () => {
  const w = world({ loadDraft: async () => ({ kind: "not-student" }) });
  const r = await ask(w);
  assert.equal(r.status, 403);
  assert.match((r.body as { error: string }).error, /Only the student/);
  assert.equal(w.calls.length, 0);
  const w2 = world({ allowance: async () => ({ ok: false, reason: "not_yours" }) });
  assert.equal((await ask(w2)).status, 403);
  assert.equal(w2.calls.length, 0);
});

test("the caps: five reads of a draft go through, the sixth is refused before the call with the cap's words", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) assert.equal((await ask(w)).status, 200, `read ${i + 1}`);
  const sixth = await ask(w);
  assert.equal(sixth.status, 429);
  assert.equal((sixth.body as { error: string }).error, review.CAP_MESSAGE.draft_day);
  assert.equal(w.calls.length, 5, "no sixth model call");
  for (const reason of ["student_day", "draft_cycle"] as const) {
    const capped = world({ allowance: async () => ({ ok: false, reason }) });
    const r = await ask(capped);
    assert.equal(r.status, 429);
    assert.equal((r.body as { error: string }).error, review.CAP_MESSAGE[reason]);
    assert.equal(capped.calls.length, 0);
  }
});

test("a cap reached while the read ran (the record function refuses): 429, nothing shown", async () => {
  const w = world({ record: async () => ({ ok: false, reason: "cap" }) });
  const r = await ask(w);
  assert.equal(r.status, 429);
  assert.equal((r.body as { error: string }).error, review.CAP_REACHED);
});

test("guard: without the allowance check, a sixth read is a sixth model call", async () => {
  const w = world({ caps: false });
  for (let i = 0; i < 6; i++) await ask(w);
  assert.equal(w.calls.length, 6, "the five-a-day assertion above would fail");
});

test("no versionId: the draft as saved now is what loadDraft reads (the route keeps it as a version first)", async () => {
  let asked: [string, string | null] | null = null;
  const w = world({
    loadDraft: async (id, v) => {
      asked = [id, v];
      return { kind: "ready", essayId: id, versionId: VERSION, body: BODY, promptKind: "personal", promptRef: MAIN_REF, studentId: "s-1" };
    },
  });
  assert.equal((await ask(w, { essayId: ESSAY })).status, 200);
  assert.deepEqual(asked, [ESSAY, null]);
});

/* ------------------------------------------------------------------ */
/* The route wires exactly this                                        */
/* ------------------------------------------------------------------ */

test("the route: POST is handleReview with the real I/O; the advisor.reviews capability; its own limiter; the record function; no key, no client", () => {
  const src = readFileSync(join(ROOT, "app/api/essays/review/route.ts"), "utf8");
  const exported = [...src.matchAll(/^export (?:async function|const) (\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "PATCH", "POST", "maxDuration"]);
  assert.match(src, /handleReview\(deps\(request, createServerSupabase\(\)\), body\)/);
  assert.match(src, /allowed\(user, "advisor\.reviews"\)/);
  assert.match(src, /createLimiter\(/);
  assert.match(src, /rpc\("essay_review_allowance"/);
  assert.match(src, /rpc\("record_essay_review"/);
  assert.match(src, /process\.env\.ANTHROPIC_API_KEY \? new Anthropic\(/);
  assert.doesNotMatch(src, /from\("essay_reviews"\)\.insert|from\("essay_notes"\)\.insert/, "reviews are written by the function only");
});
