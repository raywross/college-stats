/**
 * The Data Steward's run (specs/product/data-steward.md "The Steward"; scripts/steward.mts and scripts/lib/steward/):
 * the tools over a file store seeded from tests/fixtures/steward/ and the mini fixture's records; the writer's
 * refusals; a dry run over recorded answers (tests/fixtures/steward/answers/) that writes an issue, a proposal with
 * evidence, a To do row and the run record; the budget stopping a run; apply on approved proposals; answer mode; the
 * CLI. No network, no database, no model: every model call is answered from a file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import type { ReviewItem } from "../lib/reported.ts";
import type { IssueDoc, ProposalDoc, ProposalRow, RunDoc, TodoDoc } from "../lib/steward/types.ts";
import { COLLECTIONS } from "../scripts/lib/data-platform/layers.mts";
import { fileStoreChangeSets } from "../scripts/lib/data-platform/store.mts";
import { auditFamily, auditSample, main, runSteward, weekOf } from "../scripts/steward.mts";
import { Budget, BudgetStop, costOf, runBudget, weeklySpent } from "../scripts/lib/steward/budget.mts";
import { clusterKey, clusterQueue, maskDetail } from "../scripts/lib/steward/cluster.mts";
import { MissingAnswer, recordedFetch, requestKey } from "../scripts/lib/steward/dry-run.mts";
import { inFamily } from "../scripts/lib/steward/prompts.mts";
import { recipeAfter } from "../scripts/lib/steward/apply.mts";
import { bundledSite, callTool, documentDeps, readSiteValue, toolNames, type StewardContext } from "../scripts/lib/steward/tools.mts";
import { StewardWriter, WriteRefused } from "../scripts/lib/steward/writer.mts";
import { ANSWERS, NOW, STEWARD_FIXTURES, UA_UNIT, noFetch, seededStore, uaSha } from "./helpers/steward-store.mts";

const ROOT = join(import.meta.dirname, "..");
const queueFixture = JSON.parse(readFileSync(join(STEWARD_FIXTURES, "review-queue-sample.json"), "utf8")) as Record<string, ReviewItem>;

/** A context over a seeded store with a writer on an open set (no model client). */
async function context(opts: { fetchBytes?: StewardContext["docs"]["fetchBytes"]; withLines?: boolean } = {}) {
  const s = await seededStore({ withLines: opts.withLines });
  const handle = await s.store.open("pipeline", "steward", "t-1");
  const cache: StewardContext["cache"] = { records: new Map() };
  const docs = documentDeps({ store: s.store, cache }, s.archive, opts.fetchBytes ?? noFetch);
  const writer = new StewardWriter(s.store, handle, { run: "t-1", now: NOW, manifest: docs.manifest });
  const ctx: StewardContext = { store: s.store, writer, docs, site: bundledSite(), client: null, budget: new Budget(1), now: NOW, run: "t-1", log: () => {}, progress: { cluster: null, tool: null, calls: 0 }, cache };
  return { ...s, ctx, handle, writer };
}

const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  unit_id: "166027",
  field: "admissions.acceptance_rate",
  code: null,
  edition: "2025-26",
  sha256: null,
  now: "4.2% · IPEDS Admissions, Fall 2024",
  proposed: "3.6%",
  value: 0.036,
  source: { page: 4, line: 120, quote: "Total first-year admitted | 1,970", url: null },
  recommends: "approve",
  item: null,
  ...over,
});
const finding = { unit_id: "166027", edition: "2025-26", sha256: null, url: null, page: 4, line: 120, shows: "1,970 admitted" };

/* ------------------------------------------------------------------ */
/* The cluster stand-in and the tools                                  */
/* ------------------------------------------------------------------ */

test("clusters: the key masks numbers, years and codes; free details cluster by check; two checks never share a key", () => {
  assert.equal(maskDetail("C.116 is 1,234 vs 2025-26  in Fall 2024"), "CODE is #,# vs Y in Fall Y");
  const clusters = clusterQueue(Object.values(queueFixture));
  assert.equal(new Set(clusters.map((c) => c.key)).size, clusters.length);
  for (const c of clusters) assert.ok(c.key.startsWith(`${c.check}|`));
  assert.ok(clusters.some((c) => c.key === clusterKey("number-on-line", "")), "number-on-line's details vary freely");
  for (let i = 1; i < clusters.length; i++) assert.ok(clusters[i - 1].items >= clusters[i].items);
  const shuffled = clusterQueue(Object.values(queueFixture).reverse());
  assert.deepEqual(shuffled.map((c) => [c.key, c.items, c.examples]), clusters.map((c) => [c.key, c.items, c.examples]));
});

test("tools: list_clusters, read_cluster and read_record read the store; read_failures the failures and recipe", async () => {
  const { ctx } = await context();
  const list = (await callTool(ctx, "list_clusters", { limit: 3 })) as { open_items: number; clusters: number; shown: { key: string; items: number }[] };
  assert.equal(list.open_items, Object.keys(queueFixture).length);
  assert.equal(list.shown.length, 3);
  const cluster = (await callTool(ctx, "read_cluster", { key: "number-on-line|", limit: 4 })) as { items: { unit_id: string; failures: { check: string }[] }[]; documents: { sha256: string }[] };
  assert.equal(cluster.items.length, 4);
  assert.ok(cluster.items.every((i) => i.failures.every((f) => f.check === "number-on-line")));
  assert.equal(new Set(cluster.items.map((i) => i.unit_id)).size, 4, "one item per college first");
  assert.equal(ctx.progress.cluster, "number-on-line|");
  await assert.rejects(callTool(ctx, "read_cluster", { key: "nope|" }), /no cluster/);
  const rec = (await callTool(ctx, "read_record", { unit_id: "145637", edition: "2025-26" })) as { items: { status: string }[]; counts: Record<string, number> };
  assert.ok(rec.items.length > 0 && rec.items.every((i) => i.status === "failed"));
  assert.ok(rec.counts.passed > 0);
  const some = (await callTool(ctx, "read_record", { unit_id: "145637", edition: "2025-26", codes: ["C.116"] })) as { items: { code: string }[] };
  assert.deepEqual(some.items.map((i) => i.code), ["C.116"]);
  const fail = (await callTool(ctx, "read_failures", { unit_id: "100830" })) as { failures: { stage: string }[] };
  assert.ok(fail.failures.some((f) => f.stage === "fetch"));
});

test("read_document_lines: the archive's lines by sha256, pages and a line window; unavailable when it can't be had", async () => {
  const { ctx } = await context();
  const sha = uaSha();
  const all = (await callTool(ctx, "read_document_lines", { sha256: sha, pages: [4] })) as { text: string; from: string; lines: number };
  assert.equal(all.from, "archive-lines");
  assert.equal(all.lines, 120);
  assert.match(all.text, /^--- Page 4 ---\n61: /);
  assert.ok(!/\n1: /.test(all.text), "page 3 is left out");
  const win = (await callTool(ctx, "read_document_lines", { sha256: sha, line: 99 })) as { text: string };
  assert.match(win.text, /\n99: @94 Total all undergraduates \| @261 35,621\n100: /);
  // Without the archive copy the document is fetched again; a failed fetch or a changed file is unavailable.
  const bare = await context({ withLines: false });
  const gone = (await callTool(bare.ctx, "read_document_lines", { sha256: sha })) as { unavailable: boolean; reason: string };
  assert.equal(gone.unavailable, true);
  assert.match(gone.reason, /fetch failed: no network/);
  const changed = await context({ withLines: false, fetchBytes: async () => new TextEncoder().encode("%PDF-1.4 something else") });
  const differs = (await callTool(changed.ctx, "read_document_lines", { sha256: sha })) as { unavailable: boolean; reason: string };
  assert.match(differs.reason, /changed since it was read/);
  const unknown = (await callTool(ctx, "read_document_lines", { sha256: "f".repeat(64) })) as { reason: string };
  assert.match(unknown.reason, /no manifest entry/);
});

test("read_site_value: what the profile shows, with the same lineage the profile cites", () => {
  const site = bundledSite();
  const harvard = readSiteValue({ site }, { unit_id: "166027", field: "admissions.acceptance_rate" });
  assert.equal(harvard.name, "Harvard University");
  assert.equal(typeof harvard.value, "number");
  assert.match(harvard.shows, /^0\.04\d* · /);
  assert.equal(readSiteValue({ site }, { unit_id: "166027", field: "C.701" }).shows, "Not shown");
  assert.match(readSiteValue({ site }, { unit_id: UA_UNIT, field: "admissions.acceptance_rate" }).note ?? "", /isn't in the published dataset/);
});

/* ------------------------------------------------------------------ */
/* The writer                                                          */
/* ------------------------------------------------------------------ */

test("the writer refuses a proposal without evidence, a correction without page or value, an empty 'now', an unregistered field", async () => {
  const { writer } = await context();
  const base = { kind: "correct" as const, cause: null, summary: "Harvard's admits", evidence: [finding], rows: [row()] };
  await assert.rejects(writer.writeProposal({ ...base, evidence: [] }), (e: unknown) => e instanceof WriteRefused && /needs evidence/.test(e.message));
  await assert.rejects(writer.writeProposal({ ...base, rows: [row({ source: { page: null, line: null, quote: null, url: null } })] }), /source\.page/);
  await assert.rejects(writer.writeProposal({ ...base, rows: [row({ value: null })] }), /needs the value/);
  await assert.rejects(writer.writeProposal({ ...base, rows: [row({ now: " " })] }), /"now" is empty/);
  await assert.rejects(writer.writeProposal({ ...base, rows: [row({ field: "admissions.nonsense" })] }), /not a registered field/);
  await assert.rejects(writer.writeProposal({ ...base, kind: "hold", rows: [row({ field: null, code: "C.701", edition: null })] }), /names the code and the edition/);
  await assert.rejects(writer.writeProposal({ ...base, kind: "systemic", rows: [] }), /change: what, how/);
  await assert.rejects(writer.put(COLLECTIONS.reported.docs, "x", {}), /only steward\.\* collections/);
  const { doc } = await writer.writeProposal(base);
  assert.equal(doc.key, "correct-166027-t-1");
  assert.equal(doc.status, "open");
});

test("the writer keeps the owner's decisions: a declined row isn't proposed again, a left issue stays left, a settled To do stays settled", async () => {
  const { store, writer } = await context();
  const seed = await store.open("pipeline", "console", "t-0");
  const declined: ProposalDoc = { key: "correct-old", kind: "correct", cause: null, status: "declined", summary: "s", evidence: [finding], rows: [{ ...row(), decision: "declined" }], run: "t-0", created: "2026-10-30T00:00:00Z" };
  const left: IssueDoc = { key: "aid-year|CODE is blank, which names no aid year", kind: "policy", status: "left", hypothesis: "h", findings: [], proposals: [], reason: "owner: leave it", run: "t-0", updated: "2026-10-30T00:00:00Z" };
  const done: TodoDoc = { key: "cds:100830:2024-25", kind: "cds", unit_id: "100830", subject: "AUM", edition: "2024-25", landing: null, document_url: null, host: null, why: "bot-check", reach: 1, demand: 0, status: "no-document", route: null, attempts: [], note: null, updated: "2026-10-30T00:00:00Z" };
  await seed.write(COLLECTIONS.steward.proposals, [{ key: declined.key, body: declined }]);
  await seed.write(COLLECTIONS.steward.issues, [{ key: left.key, body: left }]);
  await seed.write(COLLECTIONS.steward.todo, [{ key: done.key, body: done }]);
  await seed.close("applied");
  await assert.rejects(writer.writeProposal({ kind: "correct", cause: null, summary: "again", evidence: [finding], rows: [row()] }), /declined by the owner before/);
  const both = await writer.writeProposal({ kind: "correct", cause: null, summary: "again", evidence: [finding], rows: [row(), row({ field: "admissions.applicants", value: 54000 })] });
  assert.equal(both.dropped, 1);
  assert.deepEqual(both.doc.rows.map((r) => r.field), ["admissions.applicants"]);
  const issue = await writer.writeIssue({ key: left.key, kind: "policy", hypothesis: "new reading", findings: [] });
  assert.equal(issue.status, "left");
  assert.equal(issue.reason, "owner: leave it");
  const todo = await writer.writeTodo({ kind: "cds", unit_id: "100830", subject: "AUM", edition: "2024-25", landing: "https://www.aum.edu/x.pdf", document_url: null, why: "bot-check", reach: 1, note: null });
  assert.equal(todo.status, "no-document");
  assert.equal(todo.host, "www.aum.edu");
});

/* ------------------------------------------------------------------ */
/* The budget                                                          */
/* ------------------------------------------------------------------ */

test("budget: list prices with cache reads at a tenth, a refused call names where, the week's cap from steward.runs", async () => {
  assert.equal(costOf({ input_tokens: 1_000_000, output_tokens: 0 }, "claude-opus-5-5"), 5);
  assert.equal(costOf({ input_tokens: 0, output_tokens: 1_000_000 }, "claude-opus-5-5"), 25);
  assert.equal(Math.round(costOf({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }, "claude-opus-5-5") * 100) / 100, 0.5);
  assert.equal(costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-sonnet-5"), 18);
  assert.equal(costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-haiku-4-5-20251001"), 6);
  const b = new Budget(0.1);
  b.charge({ input_tokens: 10_000, output_tokens: 1_000 }, "claude-opus-5-5");
  assert.equal(b.spent(), 0.075);
  assert.throws(() => b.ensure("claude-opus-5-5", 10_000, 1_000, "at cluster x"), (e: unknown) => e instanceof BudgetStop && e.where === "at cluster x");
  assert.equal(runBudget(20, 35), 5);
  assert.equal(runBudget(5, 41), 0);
  const { store } = await context();
  const set = await store.open("pipeline", "steward", "old");
  const r = (key: string, started: string, spent: number): RunDoc => ({ key, mode: "run", started, finished: started, budget_usd: 20, spent_usd: spent, clusters: 0, issues: 0, proposals: 0, todo: 0, decisions: 0, audits: 0, stopped: null, request_id: null });
  await set.write(COLLECTIONS.steward.runs, [
    { key: "a", body: r("a", "2026-10-30T00:00:00Z", 12.5) },
    { key: "b", body: r("b", "2026-10-20T00:00:00Z", 30) },
  ]);
  await set.close("applied");
  assert.equal(await weeklySpent(store, NOW()), 12.5);
});

/* ------------------------------------------------------------------ */
/* The dry run                                                         */
/* ------------------------------------------------------------------ */

test("a dry run over recorded answers writes an issue, a proposal with evidence, a To do row and the run record, in one steward change set", async () => {
  const s = await seededStore();
  const res = await runSteward({ mode: "run", store: s.store, budget: 5, runRef: "dry-run", dryRun: ANSWERS, archive: s.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  assert.equal(res.run.stopped, null);
  assert.deepEqual([res.run.issues, res.run.proposals, res.run.todo], [1, 1, 1]);
  assert.ok(res.run.spent_usd > 0 && res.run.spent_usd < 5);
  const issue = (await s.store.readOne<IssueDoc>(COLLECTIONS.steward.issues, "number-on-line|"))!;
  assert.equal(issue.kind, "value");
  assert.equal(issue.status, "proposed");
  const proposal = (await s.store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, "hold-number-on-line-dry-run"))!;
  assert.equal(proposal.kind, "hold");
  assert.equal(proposal.evidence[0].line, 99);
  assert.deepEqual(issue.proposals, [proposal.key]);
  assert.equal(proposal.rows[0].item, "100751|2025-26|B.138");
  const todo = (await s.store.readOne<TodoDoc>(COLLECTIONS.steward.todo, "cds:100830:2024-25"))!;
  assert.equal(todo.why, "bot-check");
  const run = (await s.store.readOne<RunDoc>(COLLECTIONS.steward.runs, "dry-run"))!;
  assert.equal(run.spent_usd, res.run.spent_usd);
  const set = fileStoreChangeSets(join(s.dir, "layers")).find((c) => c.id === res.changeSet)!;
  assert.equal(set.kind, "pipeline");
  assert.equal(set.source, "steward");
  assert.equal(set.status, "applied");
  assert.ok(set.versions.every((v) => v.collection.startsWith("steward.")), "a run writes steward.* only");
});

test("the budget stops a run before a call it can't afford: exit 2, and the run record says where", async () => {
  const s = await seededStore();
  const res = await runSteward({ mode: "run", store: s.store, budget: 0.15, runRef: "dry-run", dryRun: ANSWERS, archive: s.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 2);
  assert.match(res.run.stopped ?? "", /^after 1 model call\(s\): the budget is spent/);
  const run = (await s.store.readOne<RunDoc>(COLLECTIONS.steward.runs, "dry-run"))!;
  assert.equal(run.stopped, res.run.stopped);
  assert.ok(run.spent_usd > 0 && run.spent_usd <= 0.15);
  // The week's cap: $40 already spent this week leaves nothing, and no call is made.
  const w = await seededStore();
  const set = await w.store.open("pipeline", "steward", "earlier");
  await set.write(COLLECTIONS.steward.runs, [{ key: "earlier", body: { ...run, key: "earlier", started: "2026-10-31T00:00:00Z", spent_usd: 40 } }]);
  await set.close("applied");
  const capped = await runSteward({ mode: "run", store: w.store, budget: 5, runRef: "dry-capped", dryRun: ANSWERS, archive: w.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(capped.exit, 2);
  assert.match(capped.run.stopped ?? "", /week's \$40 cap is spent/);
  assert.equal(capped.run.spent_usd, 0);
});

test("a dry run with no recorded answer fails (exit 1) naming the request's key; the dry run's fetch reaches nothing else", async () => {
  const s = await seededStore();
  const empty = mkdtempSync(join(tmpdir(), "steward-answers-"));
  const res = await runSteward({ mode: "run", store: s.store, budget: 5, runRef: "dry-none", dryRun: empty, archive: s.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 1);
  assert.match(res.message ?? "", /no recorded answer [0-9a-f]{16}/);
  assert.ok(await s.store.readOne(COLLECTIONS.steward.runs, "dry-none"), "the run record is written even so");
  const f = recordedFetch(empty, { env: {} });
  await assert.rejects(f("https://example.com/", {}), /no request may leave the process/);
  await assert.rejects(f("https://api.anthropic.com/v1/messages", { body: "{}" }), (e: unknown) => e instanceof MissingAnswer);
  assert.equal(requestKey({ model: "m", max_tokens: 1, messages: [] }), requestKey({ messages: [], model: "m", max_tokens: 9, stream: false }));
  // Every recorded answer is used by a test scenario (no stale files).
  assert.ok(readdirSync(ANSWERS).length >= 9);
});

test("answer mode: the owner's question answered on the proposal, rows added, the proposal open again", async () => {
  const s = await seededStore();
  const sha = uaSha();
  const asked: ProposalDoc = {
    key: "hold-number-on-line-dry-asked",
    kind: "hold",
    cause: "number-on-line|",
    status: "asked",
    summary: "Hold the University of Alabama's B.138 as misread.",
    evidence: [{ unit_id: UA_UNIT, edition: "2025-26", sha256: sha, url: null, page: 4, line: 99, shows: "Total all undergraduates | 35,621" }],
    rows: [{ unit_id: UA_UNIT, field: null, code: "B.138", edition: "2025-26", sha256: sha, now: "Not shown", proposed: "Held as misread: line 99 shows 35,621", source: { page: 4, line: 99, quote: "Total all undergraduates | 35,621", url: null }, recommends: "approve", item: "100751|2025-26|B.138" }],
    question: "Is B.125 on line 98 misread the same way?",
    answer: null,
    run: "dry-earlier",
    created: "2026-10-31T12:00:00.000Z",
  };
  const set = await s.store.open("import", "seed", "seed2");
  await set.write(COLLECTIONS.steward.proposals, [{ key: asked.key, body: asked }]);
  await set.close("applied");
  const res = await runSteward({ mode: "answer", store: s.store, budget: 5, proposal: asked.key, runRef: "dry-answer", dryRun: ANSWERS, archive: s.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  const p = (await s.store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, asked.key))!;
  assert.match(p.answer ?? "", /^Yes\. Line 98/);
  assert.deepEqual(p.rows.map((r) => r.code), ["B.138", "B.125"]);
  assert.equal(p.status, "open");
  const noQuestion = await runSteward({ mode: "answer", store: s.store, budget: 5, proposal: "nope", runRef: "dry-answer-2", dryRun: ANSWERS, archive: s.archive, fetchBytes: noFetch, now: NOW, env: {}, log: () => {} });
  assert.equal(noQuestion.exit, 1);
  assert.match(noQuestion.message ?? "", /no proposal nope/);
});

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

async function seedProposal(s: Awaited<ReturnType<typeof seededStore>>, p: ProposalDoc) {
  const set = await s.store.open("pipeline", "console", "approve");
  await set.write(COLLECTIONS.steward.proposals, [{ key: p.key, body: p }]);
  await set.close("applied");
}

test("apply: an approved hold proposal holds the approved rows only, in a steward-apply set, marks it applied, and asks for a publish", async () => {
  const s = await seededStore();
  const rec = (await s.store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, "145637"))!;
  const doc = rec.documents[0];
  const [held, untouched] = Object.keys(doc.items).filter((c) => doc.items[c].status === "passed" && doc.items[c].v !== undefined && /^C\.7/.test(c));
  const hold = (code: string, decision: "approved" | "declined"): ProposalRow => ({ unit_id: "145637", field: null, code, edition: doc.edition, sha256: doc.sha256, now: "Considered · CDS 2025-26", proposed: `the workbook shows ${code} as Not considered`, source: { page: null, line: null, quote: "CDS-C!F10", url: null }, recommends: "approve", item: null, decision });
  await seedProposal(s, { key: "hold-grids-1", kind: "hold", cause: null, status: "approved", summary: "s", evidence: [finding], rows: [hold(held, "approved"), hold(untouched, "declined")], run: "r", created: "2026-11-01T00:00:00Z" });
  const res = await runSteward({ mode: "apply", store: s.store, proposal: "hold-grids-1", runRef: "apply-1", now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  assert.equal(res.publish, true);
  const after = (await s.store.readOne<CollegeRecord>(COLLECTIONS.reported.cdsRecords, "145637"))!.documents[0];
  assert.equal(after.items[held].status, "failed");
  assert.deepEqual(after.items[held].failures?.map((f) => f.check), ["misread"]);
  assert.equal(after.items[untouched].status, "passed", "a declined row is not applied");
  const queued = await s.store.readOne<ReviewItem>(COLLECTIONS.reported.reviewQueue, `145637|${doc.edition}|${held}`);
  assert.equal(queued?.failures[0].check, "misread");
  assert.equal((await s.store.readOne<ProposalDoc>(COLLECTIONS.steward.proposals, "hold-grids-1"))!.status, "applied");
  const set = fileStoreChangeSets(join(s.dir, "layers")).find((c) => c.id === res.changeSet)!;
  assert.deepEqual([set.kind, set.source, set.status], ["pipeline", "steward-apply", "applied"]);
  assert.deepEqual(set.summary.collections, ["reported.cds_records", "reported.review_queue", "steward.proposals", "steward.runs"]);
  // Applied once: a second apply is refused and its set closes held.
  const again = await runSteward({ mode: "apply", store: s.store, proposal: "hold-grids-1", runRef: "apply-2", now: NOW, env: {}, log: () => {} });
  assert.equal(again.exit, 1);
  assert.match(again.message ?? "", /is applied; only an approved proposal/);
  assert.equal(fileStoreChangeSets(join(s.dir, "layers")).find((c) => c.id === again.changeSet)!.status, "held");
});

test("apply: a reject proposal resolves its items rejected and asks for no publish; correct rows are the console's", async () => {
  const s = await seededStore();
  const itemKey = "100751|2025-26|B.138";
  await seedProposal(s, { key: "reject-1", kind: "reject", cause: null, status: "approved", summary: "s", evidence: [finding], rows: [{ ...row({ unit_id: UA_UNIT, field: null, code: "B.138", value: undefined, proposed: "the checks were right" }), item: itemKey, decision: "approved" }], run: "r", created: "2026-11-01T00:00:00Z" });
  const res = await runSteward({ mode: "apply", store: s.store, proposal: "reject-1", runRef: "apply-r", now: NOW, env: {}, log: () => {} });
  assert.equal(res.exit, 0, res.message);
  assert.equal(res.publish, false);
  const item = (await s.store.readOne<ReviewItem>(COLLECTIONS.reported.reviewQueue, itemKey))!;
  assert.equal(item.resolved, "rejected");
  assert.equal(item.resolved_on, "2026-11-01");
  assert.match(item.resolved_note ?? "", /proposal reject-1/);
  await seedProposal(s, { key: "correct-1", kind: "correct", cause: null, status: "approved", summary: "s", evidence: [finding], rows: [{ ...row(), decision: "approved" }], run: "r", created: "2026-11-01T00:00:00Z" });
  const refused = await runSteward({ mode: "apply", store: s.store, proposal: "correct-1", runRef: "apply-c", now: NOW, env: {}, log: () => {} });
  assert.equal(refused.exit, 1);
  assert.match(refused.message ?? "", /applied by the console/);
});

test("apply: a recipe row adds or drops a link, or clears the not-found mark for rediscovery", () => {
  const before = { unit_id: "100751", sources: [{ kind: "cds" as const, url: "https://a.edu/old.pdf", format: "pdf" as const }], index_urls: [], learned: "2026-10-01", model: "m", none_found: true as const, discovery: { path: "none" as const, tried: [], next_attempt: "2026-12-01" } };
  const added = recipeAfter(before, "100751", { field: "sources.add", value: "https://a.edu/cds-2025-26.xlsx" }, "2026-11-01")!;
  assert.deepEqual(added.sources.map((s) => [s.url, s.format]), [["https://a.edu/cds-2025-26.xlsx", "xlsx"], ["https://a.edu/old.pdf", "pdf"]]);
  assert.equal(added.none_found, undefined);
  assert.deepEqual(recipeAfter(before, "100751", { field: "sources.drop", value: "https://a.edu/old.pdf" }, "2026-11-01")!.sources, []);
  const again = recipeAfter(before, "100751", { field: "rediscover", value: null }, "2026-11-01")!;
  assert.equal(again.discovery?.next_attempt, undefined);
  assert.equal(recipeAfter(again, "100751", { field: "rediscover", value: null }, "2026-11-01"), null);
});

/* ------------------------------------------------------------------ */
/* Audit pieces, the tool list, the CLI                                */
/* ------------------------------------------------------------------ */

test("audit: one family a week in rotation; the sample is passed values of the family, one per college first, fixed by the week", async () => {
  const fams = new Set([0, 7, 14, 21].map((d) => auditFamily(new Date(Date.UTC(2026, 10, 1 + d)))));
  assert.equal(fams.size, 4);
  assert.equal(weekOf(new Date("2026-01-08T00:00:00Z")), 1);
  const s = await seededStore();
  const records = [...(await s.store.read<CollegeRecord>(COLLECTIONS.reported.cdsRecords)).values()];
  const sample = auditSample(records, "grids", "2026-w43");
  assert.ok(sample.length > 0 && sample.length <= 25);
  assert.ok(sample.every((r) => inFamily("grids", r.code)));
  assert.equal(new Set(sample.slice(0, 4).map((r) => r.unit_id)).size, Math.min(4, new Set(records.map((r) => r.unit_id)).size));
  assert.deepEqual(auditSample(records, "grids", "2026-w43"), sample);
  assert.notDeepEqual(auditSample(records, "grids", "2026-w44"), sample);
  assert.ok(inFamily("aid-grids", "B.1101") && inFamily("h2", "H.210") && !inFamily("h2", "H.2202") && inFamily("bands", "C.905"));
});

test("the tools a mode gets are the contract's names; answer and audit add their own writer", () => {
  assert.deepEqual(toolNames("run"), ["list_clusters", "read_cluster", "read_record", "read_document_lines", "read_site_value", "read_failures", "write_issue", "write_proposal", "write_todo", "write_decision"]);
  assert.ok(toolNames("audit").includes("write_audit") && !toolNames("run").includes("write_audit"));
  assert.ok(toolNames("answer").includes("write_answer"));
});

test("the CLI: flags, exit 2 when the budget stops it, the step outputs, and refusals for bad flags", async () => {
  const s = await seededStore();
  const out = join(s.dir, "github-output");
  const env = { ...process.env, GITHUB_OUTPUT: out, DATA_SUPABASE_URL: "", ANTHROPIC_API_KEY: "", STEWARD_RECORD: "" };
  const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts/steward.mts"), "--store", `file:${join(s.dir, "layers")}`, "--mode", "run", "--budget", "0.15", "--run-ref", "dry-run", "--dry-run", ANSWERS], { env, encoding: "utf8", cwd: ROOT });
  assert.equal(run.status, 2, run.stderr + run.stdout);
  assert.match(readFileSync(out, "utf8"), /exit_code=2\nchange_set=\d+\npublish=false\n/);
  assert.equal(await main(["--store", `file:${join(s.dir, "layers")}`, "--mode", "nonsense"]).catch((e: Error) => e.message), "--mode nonsense: expected run, audit, apply, answer");
  assert.equal(await main(["--store", `file:${join(s.dir, "layers")}`, "--unit", "12"]).catch((e: Error) => e.message), "--unit 12: a six-digit unit id");
  const noKey = await runSteward({ mode: "run", store: s.store, budget: 5, runRef: "live", now: NOW, env: {}, log: () => {} });
  assert.equal(noKey.exit, 1);
  assert.match(noKey.message ?? "", /ANTHROPIC_API_KEY is not set/);
});
