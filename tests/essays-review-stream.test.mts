/**
 * The reader's notes stream in (specs/product/essays/reviewer.md "Changed (owner, 2026-10-31): the notes stream in"):
 * the incremental parser (lib/essays/review-stream.ts) across every split of the answer, with a quote and a brace
 * inside strings and a trailing partial object; `readDraft` with a fake streaming client calling `onNote` in order and
 * only for notes that pass the guard; a cut answer keeps the whole notes; a refusal keeps none; the route's events for
 * a good read, an error mid-stream, and a cap reached at record time; the NDJSON response and its headers
 * (lib/essays/review-response.ts) and the panel's line splitter. A fake client throughout; never a model call.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import { miniReference } from "./helpers/snapshot.mts";

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
const { noteStream } = await import("../lib/essays/review-stream.ts");
const { lineSplitter, reviewResponse, STREAM_HEADERS } = await import("../lib/essays/review-response.ts");
const { parseGuidance } = await import("../lib/essays/guidance.ts");
const { reviewContext } = await import("../lib/essays/review-context.ts");
const { fakeStream } = await import("./helpers/fake-review-stream.mts");
type Message = import("@anthropic-ai/sdk").default.Message;
type ReviewDeps = import("../lib/essays/review.ts").ReviewDeps;
type RecordInput = import("../lib/essays/review.ts").RecordInput;
type StreamEvent = import("../lib/essays/review.ts").ReviewStreamEvent;
type GuardedNote = import("../lib/essays/review-guard.ts").GuardedNote;

const ROOT = join(import.meta.dirname, "..");
const GUIDANCE = parseGuidance(miniReference<string>("essay-guidance"));

const ESSAY = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const BODY = "Their was a customer who came in every Saturday with a flat tire.\n\nI learned leadership and responsibility from him over two long summers at the shop.";

const GOOD = [
  { category: "specific", paragraph: 1, quote: "I learned leadership and responsibility", observation: "This names two lessons with no moment behind them.", why: "Readers remember a scene more than a virtue.", source: null, ask: "What did he do on the day you learned one of them?", fix: null },
  { category: "mechanics", paragraph: 0, quote: "Their was", observation: "'Their' here should be 'There'.", why: "A wrong word that is still a word distracts a reader.", source: null, ask: "Did you mean 'There was'?", fix: "There was" },
];
/** A note the guard drops (a grade word). */
const GRADED = { category: "voice", paragraph: 1, quote: null, observation: "This is a strong paragraph.", why: "Readers like it.", source: null, ask: "Keep it?", fix: null };

function message(over: Partial<Message> & { text?: string; json?: unknown } = {}): Message {
  const { text, json, ...rest } = over;
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: text ?? JSON.stringify(json ?? { notes: GOOD }), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: { input_tokens: 1200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 9800 },
    ...rest,
  } as unknown as Message;
}

/* ------------------------------------------------------------------ */
/* The incremental parser                                              */
/* ------------------------------------------------------------------ */

/** Feeds `text` split at the given boundaries; returns every note yielded, in order. */
function feed(text: string, cuts: number[]): unknown[] {
  const s = noteStream();
  const out: unknown[] = [];
  let at = 0;
  for (const cut of [...cuts, text.length]) {
    out.push(...s.push(text.slice(at, cut)));
    at = cut;
  }
  return out;
}

const TRICKY = {
  notes: [
    { category: "voice", observation: 'He wrote "the {best} day" and a \\ backslash.', why: "A } inside a string and an escaped \" quote.", ask: "What [did] you mean?", fix: null, paragraph: 0, quote: "x" },
    { category: "care", observation: "Unicode: café, 🚲,   and a tab\t.", why: "ok", ask: "ok?", fix: null, paragraph: null, quote: null },
    { category: "prompt", observation: "{}[]\"\\", why: "nested {\"notes\":[{}]} text", ask: "?", fix: null, paragraph: 1, quote: null },
  ],
};

test("the parser: every split point of the whole answer yields exactly the notes, in order (a brace, a bracket, and an escaped quote inside strings never count)", () => {
  for (const answer of [{ notes: GOOD }, TRICKY]) {
    const text = JSON.stringify(answer);
    assert.deepEqual(feed(text, []), answer.notes, "one delta");
    for (let i = 0; i <= text.length; i++) assert.deepEqual(feed(text, [i]), answer.notes, `split at ${i}`);
    assert.deepEqual(feed(text, Array.from({ length: text.length }, (_, i) => i)), answer.notes, "a character at a time");
  }
});

test("the parser: whitespace and pretty-printing don't matter; a note is yielded the moment its closing brace arrives", () => {
  const text = JSON.stringify({ notes: GOOD }, null, 2);
  assert.deepEqual(feed(text, [17, 18, 300]), GOOD);
  const s = noteStream();
  const firstEnd = text.indexOf("\n    }") + "\n    }".length;
  assert.deepEqual(s.push(text.slice(0, firstEnd - 1)), [], "not before the brace");
  assert.deepEqual(s.push(text.slice(firstEnd - 1, firstEnd)), [GOOD[0]], "the brace completes it");
  assert.deepEqual(s.push(text.slice(firstEnd)), [GOOD[1]]);
  assert.equal(s.count, 2);
});

test("the parser: a trailing partial object (an answer cut short) is never yielded, wherever the cut falls", () => {
  const text = JSON.stringify({ notes: GOOD });
  const firstEnd = JSON.stringify({ notes: [GOOD[0]] }).length - 2; // just past the first object's brace
  for (let cut = firstEnd; cut < text.length - 3; cut++) {
    const got = feed(text.slice(0, cut), []);
    assert.deepEqual(got, [GOOD[0]], `cut at ${cut}`);
  }
  for (let cut = 0; cut < firstEnd; cut++) assert.deepEqual(feed(text.slice(0, cut), []), [], `cut at ${cut}`);
});

test("the parser: only the top-level notes array's objects; nothing outside it, never a throw on junk", () => {
  assert.deepEqual(feed('{"other":[{"a":1}],"notes":[{"b":2}]}', [5, 13]), [{ b: 2 }]);
  assert.deepEqual(feed('{"notes":[{"b":{"c":[{"d":1}]}}]}', []), [{ b: { c: [{ d: 1 }] } }], "nested objects are part of the note");
  assert.deepEqual(feed("Here are my notes: …", []), []);
  assert.deepEqual(feed('{"notes":[]}', [3]), []);
  const s = noteStream();
  assert.deepEqual(s.push('{"notes":[{"a":1,}]}'), [], "an invalid object is skipped");
  assert.equal(s.skipped, 1);
});

test("guard: a parser that ignored strings would split on the brace inside the observation", () => {
  // The same text, scanned naively (no string awareness), closes the first object early: the assertion above holds
  // only because the parser tracks strings and escapes.
  const text = JSON.stringify(TRICKY);
  let depth = 0;
  let naiveCloses = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    if (ch === "}") {
      if (depth === 3) naiveCloses++;
      depth--;
    }
  }
  assert.notEqual(naiveCloses, TRICKY.notes.length, "naive counting gets the wrong number of notes");
  assert.equal(feed(text, []).length, TRICKY.notes.length);
});

/* ------------------------------------------------------------------ */
/* readDraft                                                           */
/* ------------------------------------------------------------------ */

const CONTEXT = reviewContext({
  essayId: ESSAY,
  prompt: { title: "Why us", text: "Why Wake Forest?", options: [], kind: "why_us", limit: null, required: true, college: null, quote: null },
  school: null,
  profile: null,
  studentName: null,
  drafts: [],
  interest: null,
  priorNotes: [],
});

function client(reply: Message | (() => Promise<Message>), opts: Parameters<typeof fakeStream>[1] = {}) {
  return {
    messages: {
      stream: () => {
        const pending = Promise.resolve().then(() => (typeof reply === "function" ? reply() : reply));
        return {
          async *[Symbol.asyncIterator]() {
            yield* fakeStream(await pending, opts);
          },
          finalMessage: () => pending,
        };
      },
    },
  };
}

async function read(reply: Message | (() => Promise<Message>), opts: Parameters<typeof fakeStream>[1] = {}) {
  const seen: GuardedNote[] = [];
  const result = await review.readDraft(client(reply, opts), { kind: "why_us", guidance: GUIDANCE, context: CONTEXT, body: BODY, onNote: (n) => seen.push(n) });
  return { result, seen };
}

test("readDraft: onNote fires for each note as it completes, in the model's order, only for notes that pass the guard", async () => {
  for (const chunk of [1, 3, 11, 10_000]) {
    const { result, seen } = await read(message({ json: { notes: [GOOD[0], GRADED, GOOD[1]] } }), { chunk });
    assert.deepEqual(seen.map((n) => n.category), ["specific", "mechanics"], `chunk ${chunk}: model order, the graded note never shown`);
    assert.equal(result.outcome, "notes");
    assert.deepEqual(result.notes.map((n) => n.category), ["mechanics", "specific"], "stored in the list's order (mechanics first)");
    assert.deepEqual(result.dropped, [{ category: "voice", reason: "grade_word" }]);
  }
});

test("readDraft: notes are reported before the stream ends (streaming, not a whole answer at the end)", async () => {
  const order: string[] = [];
  const msg = message();
  const c = {
    messages: {
      stream: () => {
        const inner = fakeStream(msg, { chunk: 5 });
        return {
          async *[Symbol.asyncIterator]() {
            for await (const e of inner) {
              if (e.type === "message_stop") order.push("stop");
              yield e;
            }
          },
          finalMessage: async () => {
            order.push("final");
            return msg;
          },
        };
      },
    },
  };
  await review.readDraft(c, { kind: "why_us", guidance: GUIDANCE, context: CONTEXT, body: BODY, onNote: (n) => order.push(n.category) });
  assert.deepEqual(order, ["specific", "mechanics", "stop", "final"]);
});

test("readDraft: over MAX_NOTES, the first eight that pass are shown and kept; the rest dropped as over the limit", async () => {
  const many = Array.from({ length: 10 }, () => GOOD[0]);
  const { result, seen } = await read(message({ json: { notes: many } }));
  assert.equal(seen.length, 8);
  assert.equal(result.notes.length, 8);
  assert.deepEqual(result.dropped.map((d) => d.reason), ["over_limit", "over_limit"]);
});

test("readDraft: max_tokens keeps the notes that arrived whole and records the outcome as max_tokens", async () => {
  const whole = JSON.stringify({ notes: [GOOD[0], GOOD[1]] });
  const cut = whole.slice(0, whole.length - 40); // inside the second note
  const { result, seen } = await read(message({ stop_reason: "max_tokens", text: cut }));
  assert.equal(result.outcome, "max_tokens");
  assert.deepEqual(result.notes.map((n) => n.category), ["specific"], "the whole first note is kept; the cut second is not");
  assert.deepEqual(seen.map((n) => n.category), ["specific"]);
  const none = await read(message({ stop_reason: "max_tokens", text: whole.slice(0, 30) }));
  assert.equal(none.result.outcome, "max_tokens");
  assert.equal(none.result.notes.length, 0);
});

test("readDraft: a refusal yields nothing, even when notes arrived before it", async () => {
  const { result } = await read(message({ stop_reason: "refusal" }));
  assert.equal(result.outcome, "refusal");
  assert.equal(result.notes.length, 0);
  assert.equal(result.dropped.length, 0);
});

test("readDraft: malformed only when nothing parsed; an empty list is nothing to note; a whole answer the stream missed is still read", async () => {
  assert.equal((await read(message({ text: "Here are my notes: …" }))).result.outcome, "malformed");
  assert.equal((await read(message({ json: { comments: [] } }))).result.outcome, "malformed");
  assert.equal((await read(message({ json: { notes: [] } }))).result.outcome, "none");
  // Notes parsed, then junk after: what parsed stands.
  const text = `${JSON.stringify({ notes: GOOD }).slice(0, -1)}, trailing junk`;
  assert.equal((await read(message({ text }))).result.outcome, "notes");
});

test("readDraft: an error mid-stream is ReviewUnavailable (busy for a rate limit), after the notes that already arrived", async () => {
  const seen: string[] = [];
  const busy = new Anthropic.RateLimitError(429, {}, "rate limited", new Headers());
  await assert.rejects(
    review.readDraft(client(message(), { chunk: 4, error: busy, failAfter: 85 }), { kind: "why_us", guidance: GUIDANCE, context: CONTEXT, body: BODY, onNote: (n) => seen.push(n.category) }),
    (e: unknown) => e instanceof review.ReviewUnavailable && e.reason === "busy",
  );
  assert.ok(seen.length >= 1, "a note sent before the break");
  await assert.rejects(review.readDraft(client(message(), { error: new Anthropic.APIError(undefined, undefined, "overloaded", undefined) }), { kind: "why_us", guidance: GUIDANCE, context: CONTEXT, body: BODY }), (e: unknown) => e instanceof review.ReviewUnavailable && e.reason === "failed");
});

test("an Anthropic client satisfies ReviewClient as it is (messages.stream), and readDraft no longer calls create", () => {
  const src = readFileSync(join(ROOT, "lib/essays/review.ts"), "utf8");
  assert.match(src, /client\.messages\.stream\(built\.params\)/);
  assert.doesNotMatch(src, /messages\.create\(/);
  const a = new Anthropic({ apiKey: "test-not-used" });
  const asClient: import("../lib/essays/review.ts").ReviewClient = a; // compile-time check
  assert.equal(typeof asClient.messages.stream, "function");
});

/* ------------------------------------------------------------------ */
/* The route's events                                                  */
/* ------------------------------------------------------------------ */

function deps(over: Partial<ReviewDeps> & { reply?: Message | (() => Promise<Message>); opts?: Parameters<typeof fakeStream>[1] } = {}) {
  const recorded: RecordInput[] = [];
  const d: ReviewDeps = {
    user: async () => ({ id: "user-1" }),
    allowed: async () => true,
    limit: () => ({ ok: true }),
    loadDraft: async () => ({ kind: "ready", essayId: ESSAY, versionId: VERSION, body: BODY, promptKind: "why_us", promptRef: "college:199847:2026-27:1", studentId: "s-1" }),
    allowance: async () => ({ ok: true }),
    contextInput: async () => ({
      essayId: ESSAY,
      prompt: { title: "Why us", text: "Why Wake Forest?", options: [], kind: "why_us", limit: null, required: true, college: null, quote: null },
      school: null,
      profile: null,
      studentName: null,
      drafts: [],
      interest: null,
      priorNotes: [],
    }),
    guidance: () => GUIDANCE,
    client: () => client(over.reply ?? message(), over.opts),
    record: async (r) => {
      recorded.push(r);
      return { ok: true, review: { id: "r-1", version_id: r.versionId, created: "2026-10-31T12:00:00Z", outcome: r.outcome, method: r.method, notes: r.notes.map((n, i) => ({ ...n, id: `n-${i}`, state: "open" as const })) } };
    },
    track: () => {},
    ...over,
  };
  return { d, recorded };
}

async function run(d: ReviewDeps) {
  const sent: StreamEvent[] = [];
  const reply = await review.handleReview(d, { essayId: ESSAY, versionId: VERSION }, (e) => sent.push(e));
  return { reply, sent };
}

test("a good read: reading, each note as it passes, then done with the stored review (ids) and the message", async () => {
  const { d, recorded } = deps({ reply: message({ json: { notes: [GOOD[0], GRADED, GOOD[1]] } }) });
  const { reply, sent } = await run(d);
  assert.deepEqual(reply, { status: 200, streamed: true });
  assert.deepEqual(sent.map((e) => e.kind), ["reading", "note", "note", "done"]);
  const notes = sent.filter((e): e is Extract<StreamEvent, { kind: "note" }> => e.kind === "note").map((e) => e.note);
  assert.deepEqual(notes.map((n) => n.category), ["specific", "mechanics"]);
  for (const n of notes) assert.deepEqual(Object.keys(n).sort(), ["ask", "category", "fix", "observation", "source", "span", "why"], "a stored note's fields without id and state");
  const done = sent.at(-1) as Extract<StreamEvent, { kind: "done" }>;
  assert.deepEqual(done.review.notes.map((n) => n.id), ["n-0", "n-1"]);
  assert.equal(done.message, null);
  assert.equal(recorded.length, 1);
});

test("a cut answer: the whole notes are sent, stored with outcome max_tokens, and done carries them", async () => {
  const whole = JSON.stringify({ notes: GOOD });
  const { d, recorded } = deps({ reply: message({ stop_reason: "max_tokens", text: whole.slice(0, whole.length - 30) }) });
  const { sent } = await run(d);
  assert.deepEqual(sent.map((e) => e.kind), ["reading", "note", "done"]);
  assert.equal(recorded[0].outcome, "max_tokens");
  assert.equal(recorded[0].notes.length, 1);
  const done = sent.at(-1) as Extract<StreamEvent, { kind: "done" }>;
  assert.equal(done.review.outcome, "max_tokens");
  assert.equal(done.message, null);
});

test("an error mid-stream: reading, the notes that arrived, then an error with the JSON error's words; nothing recorded", async () => {
  const { d, recorded } = deps({ opts: { chunk: 4, error: new Anthropic.InternalServerError(500, {}, "boom", new Headers()), failAfter: 85 } });
  const { reply, sent } = await run(d);
  assert.deepEqual(reply, { status: 200, streamed: true });
  assert.equal(sent[0].kind, "reading");
  assert.ok(sent.some((e) => e.kind === "note"));
  assert.deepEqual(sent.at(-1), { kind: "error", error: "The reader couldn't read this draft just now. Try again in a moment." });
  assert.ok(!sent.some((e) => e.kind === "done"));
  assert.equal(recorded.length, 0, "an API failure is never recorded and spends no cap");
});

test("the cap reached at record time: the notes were sent, then an error with the cap's words, no done", async () => {
  const { d } = deps({ record: async () => ({ ok: false, reason: "cap" }) });
  const { sent } = await run(d);
  assert.deepEqual(sent.map((e) => e.kind), ["reading", "note", "note", "error"]);
  assert.deepEqual(sent.at(-1), { kind: "error", error: review.CAP_REACHED });
});

test("before the read nothing is sent: a refusal is a JSON reply with its status", async () => {
  const { d } = deps({ allowance: async () => ({ ok: false, reason: "draft_day" }) });
  const { reply, sent } = await run(d);
  assert.equal(reply.status, 429);
  assert.deepEqual(sent, []);
});

/* ------------------------------------------------------------------ */
/* The NDJSON response and the panel's line splitter                    */
/* ------------------------------------------------------------------ */

async function bodyLines(res: Response): Promise<unknown[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test("the response: NDJSON with no-cache, no-transform, and no proxy buffering; one event per line, in order", async () => {
  const { d } = deps();
  const res = await reviewResponse(
    (send) => review.handleReview(d, { essayId: ESSAY, versionId: VERSION }, send),
    (r) => Response.json(r.body, { status: r.status }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-store, no-transform");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
  assert.deepEqual(STREAM_HEADERS["Content-Type"], "application/x-ndjson; charset=utf-8");
  const lines = (await bodyLines(res)) as StreamEvent[];
  assert.deepEqual(lines.map((e) => e.kind), ["reading", "note", "note", "done"]);
});

test("the response: a refusal before the read is the JSON reply, unchanged", async () => {
  const { d } = deps({ user: async () => null });
  const res = await reviewResponse(
    (send) => review.handleReview(d, { essayId: ESSAY, versionId: VERSION }, send),
    (r) => Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } }),
  );
  assert.equal(res.status, 401);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { error: "Sign in first." });
});

test("the response streams: the first line is readable before the read finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const res = await reviewResponse(
    async (send) => {
      send({ kind: "reading" });
      await gate;
      send({ kind: "error", error: "x" });
      return { status: 200, streamed: true };
    },
    () => new Response("unused"),
  );
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), '{"kind":"reading"}\n', "sent before the read finished");
  release();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.equal(rest, '{"kind":"error","error":"x"}\n');
});

test("the line splitter: whole lines however the chunks fall; a partial line waits; the end flushes", () => {
  const text = '{"kind":"reading"}\n{"kind":"note","note":{"a":"x\\ny"}}\n{"kind":"done"}';
  for (let i = 0; i <= text.length; i++) {
    for (const j of [i, Math.min(text.length, i + 5)]) {
      const s = lineSplitter();
      const lines = [...s.push(text.slice(0, i)), ...s.push(text.slice(i, j)), ...s.push(text.slice(j)), ...s.end()];
      assert.deepEqual(lines.map((l) => JSON.parse(l).kind), ["reading", "note", "done"], `split at ${i}, ${j}`);
    }
  }
  const s = lineSplitter();
  assert.deepEqual(s.push('{"kind":"rea'), []);
  assert.deepEqual(s.push('ding"}\n\n'), ['{"kind":"reading"}']);
  assert.deepEqual(s.end(), []);
});
