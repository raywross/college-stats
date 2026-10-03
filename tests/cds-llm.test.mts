/**
 * Round-3 model calls (scripts/lib/college-reported/llm.mts, models.mts; specs/college-reported-round-3.md Decisions 4,
 * 6, 9, 11 and test 20) against a fake client: no network, no API key. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { codesFor, maxTokensFor } from "../lib/cds-sections.ts";
import { quoteFromLines, type NumberedLine } from "../lib/cds-quotes.ts";
import type { CallLog } from "../lib/reported.ts";
import type { School } from "../lib/types";
import {
  buildExtractRequest,
  discover,
  escalateCall,
  estimateTokens,
  extractCall,
  pickLinks,
  searchOnly,
  staticPrefix,
  type CallContext,
  type DocMeta,
} from "../scripts/lib/college-reported/llm.mts";
import {
  MIN_CACHE_PREFIX,
  UnpricedModelError,
  addCall,
  assertPriced,
  callRecorder,
  costOf,
  emptySummaryV3,
  emptyUsage,
  memoryCallLogWriter,
  summaryCost,
  type ModelClient,
} from "../scripts/lib/college-reported/models.mts";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

type Body = Anthropic.MessageCreateParamsNonStreaming;

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null, server_tool_use: null, service_tier: "standard", inference_geo: null, output_tokens_details: null };

function message(model: string, content: unknown[], stop_reason = "end_turn", usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  return { id: "msg", type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null, stop_details: null, usage: { ...USAGE, ...usage } } as unknown as Anthropic.Message;
}
const text = (model: string, t: string, stop = "end_turn") => message(model, [{ type: "text", text: t, citations: null }], stop);

/** A client whose every call (create or stream) is answered by `answer(body, n)`; `calls` records the bodies. */
function fakeClient(answer: (body: Body, n: number) => Anthropic.Message) {
  const calls: Body[] = [];
  const client: ModelClient = {
    messages: {
      async create(body) {
        calls.push(body);
        return answer(body, calls.length - 1);
      },
      stream(body) {
        calls.push(body as Body);
        const n = calls.length - 1;
        return { finalMessage: async () => answer(body as Body, n) };
      },
    },
  };
  return { client, calls };
}

function ctxWith(client: ModelClient, rows: CallLog[] = [], logs: string[] = []): CallContext {
  return { client, log: (m) => void logs.push(m), run: "r1", now: () => new Date("2026-10-03T12:00:00Z"), onCall: (r) => void rows.push(r) };
}

/** Numbered layout lines over pages 10–14 (section C on 10–12, D on 13–14). */
const LINES: NumberedLine[] = [
  { id: 1, page: 10, text: "C1. First-time, first-year students" },
  { id: 2, page: 10, text: "Total first-time, first-year males who applied | 24,410" },
  { id: 3, page: 10, text: "Total first-time, first-year females who applied | 27,005" },
  { id: 4, page: 11, text: "C2. Wait list | Yes" },
  { id: 5, page: 12, text: "C7 | Rigor of secondary school record @120 | X @410" },
  { id: 6, page: 13, text: "D1. Does your institution enroll transfer students? | Yes" },
  { id: 7, page: 14, text: "D2 | Total transfer applicants | 1,200" },
];
const DOC: DocMeta = { unit_id: "221999", name: "Vanderbilt University", url: "https://example.edu/cds.pdf", edition: "2025-26", document_type: "pdf-flat" };
const SCHOOL = { unit_id: "221999", name: "Vanderbilt University", location: { city: "Nashville", state: "TN" }, links: { website: "https://vanderbilt.edu" } } as unknown as School;

/* ------------------------------------------------------------------ */
/* extractCall (Decision 4)                                            */
/* ------------------------------------------------------------------ */

test("extractCall: the call's code-keyed schema, max_tokens, no thinking or effort on Haiku", async () => {
  const { client, calls } = fakeClient((b) => text(b.model, "{}"));
  for (const call of ["C", "rest"] as const) {
    await extractCall(ctxWith(client), { call, lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
    const body = calls.at(-1)!;
    assert.equal(body.model, "claude-haiku-4-5");
    assert.equal(body.max_tokens, maxTokensFor(call));
    assert.equal(body.thinking, undefined, "no thinking on Haiku");
    assert.equal(body.output_config?.effort, undefined, "no effort on Haiku");
    const schema = body.output_config?.format?.schema as { properties: Record<string, unknown>; additionalProperties: boolean };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.properties), codesFor(CDS_TEMPLATE, call));
  }
  assert.equal(Object.keys((calls[0].output_config!.format!.schema as { properties: object }).properties).length, 263);
});

test("extractCall: the cache marker sits on a static prefix of at least 4,096 estimated tokens (both calls)", () => {
  for (const call of ["C", "rest"] as const) {
    const built = buildExtractRequest({ call, lines: LINES, table: CDS_TEMPLATE, mode: "batch", doc: DOC });
    const system = built.params.system as Anthropic.TextBlockParam[];
    assert.equal(system.length, 1);
    assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
    assert.equal(system[0].text, staticPrefix(CDS_TEMPLATE, call));
    assert.ok(estimateTokens(system[0].text.length) >= MIN_CACHE_PREFIX["claude-haiku-4-5"], `${call} prefix is ${estimateTokens(system[0].text.length)} estimated tokens`);
    assert.ok(!system[0].text.includes("Vanderbilt"), "the prefix holds nothing per-document");
    // The document goes after the marker.
    assert.match(built.params.messages[0].content as string, /^College: Vanderbilt University/);
    assert.match(built.params.messages[0].content as string, /--- Page 10 ---\n1\| C1\./);
  }
  // Below the model's minimum the marker is left off (it would silently not cache), and "off" removes it.
  const small = buildExtractRequest({ call: "C", lines: LINES, codes: ["C.101", "C.102"], table: CDS_TEMPLATE, mode: "batch", doc: DOC });
  assert.equal((small.params.system as Anthropic.TextBlockParam[])[0].cache_control, undefined);
  const off = buildExtractRequest({ call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "batch", doc: DOC, cache: "off" });
  assert.equal((off.params.system as Anthropic.TextBlockParam[])[0].cache_control, undefined);
  const hour = buildExtractRequest({ call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "batch", doc: DOC, cache: "1h" });
  assert.deepEqual((hour.params.system as Anthropic.TextBlockParam[])[0].cache_control, { type: "ephemeral", ttl: "1h" });
});

test("extractCall: values keyed by code with quotes built from the cited lines; unknown codes dropped and logged", async () => {
  const answer = JSON.stringify({
    "C.101": { v: 24410, lines: [2] },
    "C.102": { v: 27005, lines: [3, 99] }, // 99 is not a line: only line 3 quotes
    "C.201": { v: "Yes", lines: [4] },
    "B.101": { v: 5, lines: [6] }, // a rest code in a C call
    "Z.999": { v: 1, lines: [1] }, // not a code at all
    "C.103": { v: null, lines: [] }, // null is "not found"
  });
  const { client } = fakeClient((b) => text(b.model, answer));
  const rows: CallLog[] = [];
  const logs: string[] = [];
  const out = await extractCall(ctxWith(client, rows, logs), { call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
  assert.deepEqual(Object.keys(out.values).sort(), ["C.101", "C.102", "C.201"]);
  assert.deepEqual(out.values["C.101"], { v: 24410, lines: [2], quote: "Total first-time, first-year males who applied | 24,410" });
  assert.equal(out.values["C.102"].quote, quoteFromLines(LINES, [3]));
  assert.deepEqual(out.dropped.sort(), ["B.101", "Z.999"]);
  assert.ok(out.missing.includes("C.103"));
  assert.ok(logs.some((l) => /dropped 2 code/.test(l)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job, "extraction");
  assert.equal(rows[0].call, "C");
  assert.equal(rows[0].mode, "interactive");
  assert.ok(rows[0].estimated_input_tokens! > 4096);
});

test("extractCall: a max_tokens stop keeps the whole entries before the cut; only the rest are missing", async () => {
  const cut = '{"C.101": {"v": 24410, "lines": [2]}, "C.102": {"v": 27005, "lines": [3]}, "C.201": {"v": "Ye';
  const { client } = fakeClient((b) => text(b.model, cut, "max_tokens"));
  const out = await extractCall(ctxWith(client), { call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
  assert.equal(out.truncated, true);
  assert.deepEqual(Object.keys(out.values), ["C.101", "C.102"]);
  assert.ok(out.missing.includes("C.201"));
});

test("extractCall: a code outside the call is refused before any request", async () => {
  const { client, calls } = fakeClient((b) => text(b.model, "{}"));
  await assert.rejects(() => extractCall(ctxWith(client), { call: "C", codes: ["B.101"], lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC }), /not in this call/);
  assert.equal(calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* Escalation (Decision 9)                                             */
/* ------------------------------------------------------------------ */

test("escalateCall: Sonnet 5 gets only the failing codes and only the call's pages", async () => {
  const { client, calls } = fakeClient((b) => text(b.model, JSON.stringify({ "C.101": { v: 24410, lines: [2] } })));
  const rows: CallLog[] = [];
  const out = await escalateCall(ctxWith(client, rows), {
    call: "C",
    lines: LINES,
    failingCodes: ["C.101", "C.201", "B.101"], // B.101 belongs to rest: never asked in a C escalation
    pageRange: [10, 11],
    table: CDS_TEMPLATE,
    doc: DOC,
    mode: "interactive",
  });
  const body = calls[0];
  assert.equal(body.model, "claude-sonnet-5");
  assert.equal(body.output_config?.effort, "low");
  assert.equal(body.thinking, undefined, "thinking left adaptive (default)");
  assert.deepEqual(Object.keys((body.output_config!.format!.schema as { properties: object }).properties), ["C.101", "C.201"]);
  const user = body.messages[0].content as string;
  assert.match(user, /--- Page 10 ---/);
  assert.match(user, /--- Page 11 ---/);
  assert.doesNotMatch(user, /Page 12|Page 13|Page 14|transfer/);
  const prefix = (body.system as Anthropic.TextBlockParam[])[0].text;
  assert.match(prefix, /^C\.101 \|/m);
  assert.doesNotMatch(prefix, /^C\.102 \|/m, "the code table holds only the failing codes");
  assert.deepEqual(out.values["C.101"].lines, [2]);
  assert.equal(rows[0].job, "escalation");
  assert.equal(rows[0].model, "claude-sonnet-5");
});

/* ------------------------------------------------------------------ */
/* Picker and search only (Decision 6)                                 */
/* ------------------------------------------------------------------ */

test("pickLinks: Haiku picks by link number; numbers outside the list are ignored", async () => {
  const links = [
    { text: "Common Data Set", url: "https://ir.example.edu/cds" },
    { text: "CDS 2025-26 (Excel)", url: "https://ir.example.edu/cds-2025-26.xlsx" },
    { text: "Common Data Set", url: "https://ir.example.edu/cds" }, // duplicate, dropped
    { text: "Class of 2029 profile", url: "https://admissions.example.edu/profile" },
  ];
  const { client, calls } = fakeClient((b) => text(b.model, JSON.stringify({ cds_index: 1, cds_file: 2, class_profile: 9 })));
  const out = await pickLinks(ctxWith(client), { college: { unit_id: "1", name: "Example" }, links, mode: "interactive" });
  assert.deepEqual(out, { cds_index: "https://ir.example.edu/cds", cds_file: "https://ir.example.edu/cds-2025-26.xlsx" });
  assert.equal(calls[0].model, "claude-haiku-4-5");
  assert.equal(calls[0].max_tokens, 256);
  assert.match(calls[0].messages[0].content as string, /^3 \| Class of 2029 profile/m);
});

test("searchOnly: web_search only (no web_fetch), at most two searches counted across turns, effort low", async () => {
  const { client, calls } = fakeClient((b, n) => {
    if (n === 0) return message(b.model, [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "cds" } }], "pause_turn", { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } });
    return message(b.model, [{ type: "tool_use", id: "t", name: "save_candidates", input: { candidates: [{ kind: "cds-index", url: "https://ir.example.edu/cds" }, { kind: "cds", url: "ftp://bad" }], none_found: false } }], "tool_use", { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } });
  });
  const rows: CallLog[] = [];
  const out = await searchOnly(ctxWith(client, rows), SCHOOL);
  assert.deepEqual(out.candidates, [{ kind: "cds-index", url: "https://ir.example.edu/cds" }]);
  assert.equal(out.searches, 2);
  for (const body of calls) {
    assert.equal(body.model, "claude-sonnet-5");
    assert.equal(body.output_config?.effort, "low");
    const types = body.tools!.map((t) => ("type" in t ? t.type : "custom"));
    assert.ok(!types.some((t) => String(t).startsWith("web_fetch")), "no web_fetch tool");
  }
  const searchTool = (n: number) => calls[n].tools!.find((t) => "type" in t && t.type === "web_search_20260209") as { max_uses: number };
  assert.equal(searchTool(0).max_uses, 2);
  assert.equal(searchTool(1).max_uses, 1, "the continuation gets only what is left");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].job, "search");
  assert.equal(rows[0].searches + rows[1].searches, 2);
});

test("discover: web-tool uses are counted across continuation turns", async () => {
  const { client, calls } = fakeClient((b, n) => {
    if (n === 0) return message(b.model, [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }], "pause_turn", { server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } });
    return message(b.model, [{ type: "tool_use", id: "t", name: "save_recipe", input: { sources: [], index_urls: [], none_found: true, notes: "" } }], "tool_use");
  });
  await discover({ client, usage: emptyUsage(), today: "2026-10-03", log: () => {} }, { ...SCHOOL, admissions: { year: 2024 } } as unknown as School, { model: "claude-sonnet-5", job: "discovery", effort: "low" });
  const uses = (n: number, type: string) => (calls[n].tools!.find((t) => "type" in t && t.type === type) as { max_uses: number }).max_uses;
  assert.equal(uses(0, "web_search_20260209"), 3);
  assert.equal(uses(1, "web_search_20260209"), 1, "3 − 2 used");
  assert.equal(uses(1, "web_fetch_20260209"), 2, "3 − 1 used");
});

/* ------------------------------------------------------------------ */
/* Prices and the call log (Decision 11, test 20)                      */
/* ------------------------------------------------------------------ */

test("test 20: an unpriced model throws, and no request is sent", async () => {
  assert.throws(() => costOf("claude-unknown-9", { input_tokens: 1, output_tokens: 1 }), UnpricedModelError);
  assert.throws(() => assertPriced(["claude-haiku-4-5", "claude-unknown-9"]), /no price for model "claude-unknown-9"/);
  assert.doesNotThrow(() => assertPriced(), "every configured model is priced");
  const { client, calls } = fakeClient((b) => text(b.model, "{}"));
  await assert.rejects(() => extractCall(ctxWith(client), { call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC, model: "claude-unknown-9" }), UnpricedModelError);
  await assert.rejects(() => searchOnly(ctxWith(client), SCHOOL, { model: "claude-unknown-9" }), UnpricedModelError);
  assert.equal(calls.length, 0);
});

test("costOf: interactive vs batch, 5-minute vs 1-hour cache writes, cache reads, searches", () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.equal(costOf("claude-haiku-4-5", u), 6);
  assert.equal(costOf("claude-haiku-4-5", u, { mode: "batch" }), 3);
  assert.equal(costOf("claude-sonnet-5", u, { mode: "batch" }), 6);
  const cached = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2_000_000, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } };
  assert.equal(costOf("claude-haiku-4-5", cached), 1.25 + 2 + 0.1);
  assert.equal(costOf("claude-haiku-4-5", cached, { mode: "batch" }), (1.25 + 2 + 0.1) / 2);
  assert.equal(costOf("claude-sonnet-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }), 0.02);
});

test("addCall: usage rows by job × model × mode × call, round 2's usage kept whole, calls file rows", async () => {
  const summary = emptySummaryV3("r1", "2026-10-03T12:00:00Z");
  const writer = memoryCallLogWriter();
  const { client } = fakeClient((b) => text(b.model, "{}"));
  const ctx = { ...ctxWith(client), onCall: callRecorder(summary, writer) };
  await extractCall(ctx, { call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
  await extractCall(ctx, { call: "C", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
  await extractCall(ctx, { call: "rest", lines: LINES, table: CDS_TEMPLATE, mode: "interactive", doc: DOC });
  addCall(summary, { ...writer.rows[0], mode: "batch", cost_usd: 0.001 });
  assert.equal(writer.rows.length, 3);
  assert.deepEqual(
    summary.usage_rows.map((r) => [r.job, r.model, r.mode, r.call, r.calls]),
    [
      ["extraction", "claude-haiku-4-5", "batch", "C", 1],
      ["extraction", "claude-haiku-4-5", "interactive", "C", 2],
      ["extraction", "claude-haiku-4-5", "interactive", "rest", 1],
    ],
  );
  assert.equal(summary.usage.extraction.calls, 4);
  assert.equal(summary.usage.extraction.cost_usd, summaryCost(summary));
  assert.equal(summary.documents["pdf-flat"].model_calls, 4);
  assert.equal(summary.round, 3);
});
