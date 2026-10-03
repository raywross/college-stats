/**
 * Message Batches for round 3 (scripts/lib/college-reported/batch.mts; specs/college-reported-round-3.md Decision 5,
 * tests 10 and 11) against a fake batch API (tests/fixtures/fake-batch-api.mts): no network. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { SCHEMA_VERSIONS } from "../lib/cds-sections.ts";
import type { NumberedLine } from "../lib/cds-quotes.ts";
import { parseExtractResponse, type DocMeta } from "../scripts/lib/college-reported/llm.mts";
import { costOf } from "../scripts/lib/college-reported/models.mts";
import {
  CUSTOM_ID,
  EXIT_STOPPED,
  buildEscalationRequests,
  buildPickerRequests,
  buildRequests,
  collect,
  customId,
  emptyBatchesFile,
  hasOpenBatches,
  openReservations,
  parseCustomId,
  poll,
  projection,
  projectionGuard,
  requestBytes,
  reserve,
  resubmitOnce,
  splitBySize,
  submit,
  trimToCap,
  type BatchRequest,
  type PendingDocument,
} from "../scripts/lib/college-reported/batch.mts";
import { fakeBatchApi } from "./fixtures/fake-batch-api.mts";

const NOW = () => new Date("2026-10-03T12:00:00Z");
const LINES: NumberedLine[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, page: 10 + Math.floor(i / 10), text: `Line ${i + 1} | ${1000 + i}` }));

function doc(unit_id: string, priority: number, sha = `${unit_id.padStart(8, "a")}ffff`): PendingDocument {
  const meta: DocMeta = { unit_id, url: `https://c${unit_id}.edu/cds.pdf`, edition: "2025-26", document_type: "pdf-flat" };
  return {
    unit_id,
    sha256: sha,
    priority,
    calls: (["C", "rest"] as const).map((call) => ({ version: SCHEMA_VERSIONS[call], input: { call, lines: LINES, table: CDS_TEMPLATE, doc: meta } })),
  };
}

/* ------------------------------------------------------------------ */
/* custom_id and requests                                              */
/* ------------------------------------------------------------------ */

test("custom_id: u<unit_id>-<sha8>-<call>-v<version>, short and parseable", () => {
  const id = customId({ unit_id: "221999", sha256: "0123456789abcdef", call: "rest", version: 2 });
  assert.equal(id, "u221999-01234567-rest-v2");
  assert.ok(id.length <= 64 && CUSTOM_ID.test(id));
  assert.deepEqual(parseCustomId(id), { unit_id: "221999", sha256: "01234567", sha8: "01234567", call: "rest", version: 2, job: "extraction" });
  assert.equal(customId({ unit_id: "1", sha256: "abcdef01", call: "C", version: 1, job: "escalation" }), "u1-abcdef01-C-v1-x");
  assert.equal(parseCustomId("u1-abcdef01-C-v1-x")?.job, "escalation");
});

test("buildRequests: one batch request per call, at batch reservations", () => {
  const reqs = buildRequests([doc("221999", 0), doc("190415", 1)]);
  assert.deepEqual(reqs.map((r) => r.custom_id), ["u221999-aa221999-C-v1", "u221999-aa221999-rest-v1", "u190415-aa190415-C-v1", "u190415-aa190415-rest-v1"]);
  for (const r of reqs) {
    assert.equal(r.params.model, "claude-haiku-4-5");
    // Worst case: chars ÷ 3.5 × 1.2 at $0.50/M plus max_tokens at $2.50/M (Haiku batch prices).
    const expected = ((r.chars / 3.5) * 1.2 * 0.5 + r.params.max_tokens * 2.5) / 1e6;
    assert.ok(Math.abs(r.reserved_usd - expected) < 1e-6, `${r.custom_id}: ${r.reserved_usd} vs ${expected}`);
  }
  assert.throws(() => buildRequests([doc("221999", 0), doc("221999", 1)]), /duplicate custom_id/);
});

test("escalation and picker requests: Sonnet 5 with -x ids; Haiku pickers", () => {
  const esc = buildEscalationRequests([{ sha256: "abcdef0123", priority: 0, version: 1, input: { call: "C", lines: LINES, failingCodes: ["C.101"], pageRange: [10, 10], table: CDS_TEMPLATE, doc: { unit_id: "7", url: "u", document_type: "pdf-flat" } } }]);
  assert.equal(esc[0].custom_id, "u7-abcdef01-C-v1-x");
  assert.equal(esc[0].params.model, "claude-sonnet-5");
  assert.doesNotMatch(esc[0].params.messages[0].content as string, /Page 11/);
  const pick = buildPickerRequests([{ tag: "deadbeef", priority: 3, input: { college: { unit_id: "7", name: "Seven" }, links: [{ text: "CDS", url: "https://x.edu/cds" }] } }]);
  assert.equal(pick[0].custom_id, "u7-deadbeef-pick-v1");
  assert.equal(pick[0].params.model, "claude-haiku-4-5");
});

/* ------------------------------------------------------------------ */
/* Test 10: batch collect                                              */
/* ------------------------------------------------------------------ */

test("test 10: size split under the byte limit, keeping order", () => {
  const reqs = buildRequests([doc("1", 0), doc("2", 1), doc("3", 2)]);
  const one = requestBytes(reqs[1]) + 1;
  const chunks = splitBySize(reqs, one * 2 + 10);
  assert.ok(chunks.length >= 3);
  assert.deepEqual(chunks.flat().map((r) => r.custom_id), reqs.map((r) => r.custom_id));
  for (const c of chunks) assert.ok(c.reduce((n, r) => n + requestBytes(r) + 1, 0) <= one * 2 + 10);
  assert.equal(splitBySize(reqs, 1e9, 4).length, 2, "and under the request-count limit");
  assert.throws(() => splitBySize(reqs, 100), /over the 100-byte batch limit/);
});

test("test 10: results out of order are keyed by custom_id and priced at batch prices", async () => {
  const reqs = buildRequests([doc("1", 0), doc("2", 1), doc("3", 2)]);
  const api = fakeBatchApi({
    seed: 3,
    pollsUntilEnded: 2,
    answer: (params, id) => ({ text: JSON.stringify({ [params.max_tokens === 8192 ? "C.101" : "B.101"]: { v: Number(parseCustomId(id)!.unit_id), lines: [1] } }), usage: { input_tokens: 20_000, output_tokens: 3000 } }),
  });
  const state = emptyBatchesFile();
  const [entry] = await submit(api, reqs, state, { run: "r1", phase: "extract", now: NOW });
  assert.equal(state.batches.length, 1);
  assert.equal(entry.model, "claude-haiku-4-5");
  assert.ok(hasOpenBatches(state));
  assert.equal(openReservations(state), entry.reserved_usd);

  let slept = 0;
  const ended = await poll(api, entry.id, { now: NOW, sleep: async () => void slept++, intervalMs: 1000, deadline: new Date("2026-10-03T13:00:00Z") });
  assert.equal(ended?.processing_status, "ended");
  assert.equal(slept, 2);

  const order: string[] = [];
  const got = await collect({ ...api, results: async (id) => {
    const it = await api.results(id);
    return (async function* () {
      for await (const r of it) {
        order.push(r.custom_id);
        yield r;
      }
    })();
  } }, entry, state, { now: NOW, ended: ended!.ended_at });
  assert.notDeepEqual(order, reqs.map((r) => r.custom_id), "the fake returns results out of order");
  for (const r of reqs) {
    const msg = got.succeeded.get(r.custom_id)!;
    const parsed = parseExtractResponse(msg, { call: r.call!, codes: r.call === "C" ? ["C.101"] : ["B.101"], lines: LINES });
    assert.equal(Object.values(parsed.values)[0].v, Number(r.unit_id), `${r.custom_id} keyed to its own result`);
  }
  // Batch prices: 20K in at $0.50/M + 3K out at $2.50/M per request.
  assert.ok(Math.abs(got.cost_usd - 6 * (0.01 + 0.0075)) < 1e-9);
  assert.equal(got.calls.length, 6);
  assert.ok(got.calls.every((c) => c.mode === "batch" && c.batch === entry.id && Math.abs(c.cost_usd - costOf("claude-haiku-4-5", { input_tokens: 20_000, output_tokens: 3000 }, { mode: "batch" })) < 1e-9));
  assert.equal(got.summary.succeeded, 6);
  assert.equal(state.batches.length, 0, "collected batches leave the state file (reservation settled)");
  assert.ok(!hasOpenBatches(state));
});

test("test 10: errored and expired requests are resubmitted once, then queued; invalid requests are queued at once", async () => {
  const reqs = buildRequests([doc("1", 0), doc("2", 1), doc("3", 2)]);
  const byId = new Map(reqs.map((r) => [r.custom_id, r]));
  const bad: Record<string, "errored" | "expired" | "invalid_request"> = { "u1-aaaaaaa1-C-v1": "errored", "u2-aaaaaaa2-rest-v1": "expired", "u3-aaaaaaa3-C-v1": "invalid_request" };
  // The errored one fails again on its retry; the expired one succeeds on its retry.
  const api = fakeBatchApi({
    outcome: (id, attempt) => (id === "u1-aaaaaaa1-C-v1" ? "errored" : attempt === 0 ? (bad[id] ?? "succeeded") : "succeeded"),
    omit: new Set(["u3-aaaaaaa3-rest-v1"]),
  });
  const state = emptyBatchesFile();
  const [first] = await submit(api, reqs, state, { run: "r1", phase: "extract", now: NOW });
  const got = await collect(api, first, state, { now: NOW });
  assert.deepEqual(got.errored, ["u1-aaaaaaa1-C-v1"]);
  assert.deepEqual(got.expired, ["u2-aaaaaaa2-rest-v1"]);
  assert.deepEqual(got.invalid_request, ["u3-aaaaaaa3-C-v1"]);
  assert.deepEqual(got.absent, ["u3-aaaaaaa3-rest-v1"]);
  const r1 = resubmitOnce(got, (id) => byId.get(id) ?? null);
  assert.deepEqual(r1.retry.map((r) => r.custom_id).sort(), ["u1-aaaaaaa1-C-v1", "u2-aaaaaaa2-rest-v1", "u3-aaaaaaa3-rest-v1"]);
  assert.deepEqual(r1.queue, [{ custom_id: "u3-aaaaaaa3-C-v1", reason: "invalid_request" }]);

  const [second] = await submit(api, r1.retry, state, { run: "r1", phase: "extract", now: NOW, resubmits: new Set(r1.retry.map((r) => r.custom_id)) });
  assert.deepEqual(second.resubmits?.sort(), r1.retry.map((r) => r.custom_id).sort());
  const got2 = await collect(api, second, state, { now: NOW });
  assert.ok(got2.succeeded.has("u2-aaaaaaa2-rest-v1"));
  const r2 = resubmitOnce(got2, (id) => byId.get(id) ?? null);
  assert.deepEqual(r2.retry, [], "never resubmitted twice");
  assert.deepEqual(r2.queue, [
    { custom_id: "u1-aaaaaaa1-C-v1", reason: "errored twice" },
    { custom_id: "u3-aaaaaaa3-rest-v1", reason: "absent twice" }, // the fake never returns it
  ]);
});

test("test 10: poll gives up at the deadline and leaves the batch open for the collect job", async () => {
  const api = fakeBatchApi({ pollsUntilEnded: 100 });
  const state = emptyBatchesFile();
  const [entry] = await submit(api, buildRequests([doc("1", 0)]), state, { run: "r1", phase: "extract", now: NOW });
  let t = NOW().getTime();
  const out = await poll(api, entry.id, { now: () => new Date(t), sleep: async (ms) => void (t += ms), intervalMs: 60_000, deadline: new Date(NOW().getTime() + 5 * 60_000) });
  assert.equal(out, null);
  assert.ok(hasOpenBatches(state));
});

/* ------------------------------------------------------------------ */
/* Test 11: reservations and the projection guard                      */
/* ------------------------------------------------------------------ */

test("test 11: a batch over the cap is trimmed in tier order, whole documents at a time, and trimmed documents stay archived", async () => {
  // Priorities: 0 very selective … 3 open admission. Listed out of order on purpose.
  const docs = [doc("4", 3), doc("1", 0), doc("3", 2), doc("2", 1)];
  const archive = new Map(docs.map((d) => [d.sha256, `archived text of ${d.unit_id}`]));
  const before = new Map(archive);
  const reqs = buildRequests(docs);
  const perDoc = reqs.filter((r) => r.unit_id === "1").reduce((n, r) => n + r.reserved_usd, 0);
  const spent = 0.5;
  const cap = spent + perDoc * 2.5; // room for two documents and a half
  const { kept, trimmed, reserved_usd } = trimToCap(reqs, spent, cap);
  assert.deepEqual([...new Set(kept.map((r) => r.unit_id))], ["1", "2"]);
  assert.deepEqual([...new Set(trimmed.map((r) => r.unit_id))].sort(), ["3", "4"]);
  assert.ok(spent + reserved_usd <= cap);
  assert.ok(kept.every((r) => trimmed.every((t) => t.sha256 !== r.sha256)), "both calls of a document stay together");
  assert.deepEqual(archive, before, "trimming never touches the archive: trimmed documents are submitted next run with no refetch");
  // Only kept requests are sent.
  const api = fakeBatchApi();
  await submit(api, kept, emptyBatchesFile(), { run: "r1", phase: "extract", now: NOW });
  assert.equal(api.created.flat().length, 4);
  // Break the order: a custom priority that reverses tiers keeps the open-admission college instead.
  const reversed = trimToCap(reqs, spent, cap, (r: BatchRequest) => -r.priority);
  assert.deepEqual([...new Set(reversed.kept.map((r) => r.unit_id))], ["4", "3"]);
});

test("test 11: open reservations count against the cap", () => {
  const reqs = buildRequests([doc("1", 0)]);
  const total = reqs.reduce((n, r) => n + r.reserved_usd, 0);
  assert.equal(trimToCap(reqs, 0, total).kept.length, 2);
  assert.equal(trimToCap(reqs, 0.01, total).kept.length, 0);
});

test("test 11: the projection guard stops the run (exit 3) before any model call", async () => {
  const p = projection({ documents: { "pdf-flat": 1000, "xlsx-template": 300, html: 100 }, discovery: { picker: 500, search: 400, full: 50 }, escalations: 90 });
  assert.equal(p.run_usd, p.full_run_usd);
  assert.match(p.basis, /1000 pdf-flat × \$0\.05/);
  assert.match(p.basis, /300 xlsx-template × \$0/);
  const guard = projectionGuard(p, 50);
  assert.ok(guard.stop);
  assert.equal(guard.stop && guard.exit, EXIT_STOPPED);
  assert.match(guard.stop ? guard.message : "", /^projection \$\d+\.\d\d exceeds the cap \$50\.00/);
  assert.deepEqual(projectionGuard(p, 1000), { stop: false });

  // As the CLI uses it: prepare → guard → (only if it passes) submit. A stopped guard means zero API calls.
  const api = fakeBatchApi();
  const run = async (cap: number) => {
    const g = projectionGuard(p, cap);
    if (g.stop) return g.exit;
    await submit(api, buildRequests([doc("1", 0)]), emptyBatchesFile(), { run: "r", phase: "extract", now: NOW });
    return 0;
  };
  assert.equal(await run(50), 3);
  assert.equal(api.created.length, 0);
  assert.equal(await run(1000), 0);
  assert.equal(api.created.length, 1);

  // A sample's projection scales to the full run, but the guard compares this run's own figure.
  const sample = projection({ documents: { "pdf-flat": 40 }, discovery: {}, scale: 1893 / 60 });
  assert.equal(sample.run_usd, 2);
  assert.ok(sample.full_run_usd > 60);
  assert.deepEqual(projectionGuard(sample, 5), { stop: false });
});

test("reserve: scanned PDFs reserve by page; an unpriced model throws", () => {
  const [r] = buildRequests([doc("1", 0)]);
  assert.ok(reserve({ ...r, pdf_pages: 50 }) > r.reserved_usd + (50 * 3000 * 1.2 * 0.5) / 1e6 - 1e-6);
  assert.throws(() => reserve({ ...r, params: { ...r.params, model: "claude-unknown-9" } }), /no price/);
});
