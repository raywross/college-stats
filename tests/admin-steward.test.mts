/**
 * The Data Steward's console screens and actions (specs/product/data-steward.md "The console: where it all shows",
 * "Proposals", "The college's Review page"): lib/admin/steward-actions.ts over fake dependencies (Approve applies
 * exactly the ticked rows and records the rest declined, refuses a decided proposal and an uncited row, writes before
 * it dispatches and logs before it sends; Decline, Ask, Leave, To do, Decide), the Server Actions' requireAdmin()
 * guard, and the pages rendered with Next stubbed (404 signed out; for an admin, from fixture documents over a fake
 * Supabase client and the mini dataset). No network, no database, no model. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "admin-steward-"));

/* ------------------------------------------------------------------ */
/* Next.js stand-ins for the pages                                     */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const NOT_FOUND = "const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e";
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "next/navigation": `export function notFound(){${NOT_FOUND}} export function redirect(u){throw new Error('redirect '+u)}`,
  "next/cache": "export function refresh(){}",
  "next/server": "export async function connection(){}",
  "@/lib/admin/auth": `export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){${NOT_FOUND}} return {userId:'admin-1'}}`,
  "@/lib/admin/people": "export async function adminSupabase(){globalThis.__world.calls.push('adminSupabase'); return globalThis.__world.supabase()}",
  "@/lib/admin/essays": "export async function listsByUnit(){globalThis.__world.calls.push('listsByUnit'); return null}",
  "@/lib/data": "export async function getData(){globalThis.__world.calls.push('getData'); return globalThis.__world.data}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

let networkCalls = 0;
globalThis.fetch = (() => {
  networkCalls++;
  throw new Error("network call in a test");
}) as typeof fetch;

const { miniDataset, miniLayers } = await import("./helpers/snapshot.mts");
const { fakeSupabase } = await import("./helpers/fake-supabase.mts");
const data = await miniDataset();

interface World {
  admin: boolean;
  calls: string[];
  supabase: () => unknown;
  data: unknown;
}
const world: World = { admin: true, calls: [], supabase: () => fakeSupabase(), data };
(globalThis as unknown as { __world: World }).__world = world;
function reset(over: Partial<World> = {}) {
  Object.assign(world, { admin: true, calls: [], supabase: () => fakeSupabase(), data }, over);
}

const actions = await import("../lib/admin/steward-actions.ts");
const view = await import("../lib/admin/steward-view.ts");
const reads = await import("../lib/admin/steward-reads.ts");
const reviewQueue = await import("../lib/admin/review-queue.ts");
const { nowAtField } = await import("../lib/steward/review-rows.ts");
const { reviewKey } = await import("../lib/reported.ts");
type OpsDeps = import("../lib/admin/ops-actions.ts").OpsDeps;
type StewardDeps = import("../lib/admin/steward-actions.ts").StewardDeps;
type ReviewItem = import("../lib/reported.ts").ReviewItem;
type CollegeRecord = import("../lib/cds-sections.ts").CollegeRecord;
type T = typeof import("../lib/steward/types.ts");
type ProposalDoc = import("../lib/steward/types.ts").ProposalDoc;
type ProposalRow = import("../lib/steward/types.ts").ProposalRow;
type IssueDoc = import("../lib/steward/types.ts").IssueDoc;
type TodoDoc = import("../lib/steward/types.ts").TodoDoc;
type DecisionDoc = import("../lib/steward/types.ts").DecisionDoc;
const is404 = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
void (null as unknown as T);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  unit_id: "231624",
  field: "admissions.applicants",
  code: "C.116",
  edition: "2025-26",
  sha256: "a".repeat(64),
  now: "17,798 · IPEDS, Fall 2024",
  proposed: "17,440",
  value: 17440,
  source: { page: 4, line: 12, quote: "Total first-time, first-year men who applied 17,440", url: "https://www.wm.edu/cds-2025-26.pdf" },
  recommends: "approve",
  item: null,
  ...over,
});

const proposal = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({
  key: "correct-c1-r1",
  kind: "correct",
  cause: "plausible-change|applicants # vs federal #",
  status: "open",
  summary: "William & Mary's C1 totals read right; the federal count is a different cohort.",
  evidence: [{ unit_id: "231624", edition: "2025-26", sha256: "a".repeat(64), url: "https://www.wm.edu/cds-2025-26.pdf", page: 4, line: 12, shows: "C1 applicants 17,440" }],
  rows: [row(), row({ field: "admissions.admitted", code: "C.117", value: 5600, proposed: "5,600", item: "231624|2025-26|C.117" }), row({ field: "admissions.enrolled", code: "C.118", value: 1600, proposed: "1,600", recommends: "your-call", why: "two lines disagree" })],
  run: "r1",
  created: "2026-11-01T10:00:00Z",
  ...over,
});

const item = (code: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
  unit_id: "231624",
  name: "William & Mary",
  urls: ["https://www.wm.edu/cds-2025-26.pdf"],
  entering_term: "Fall 2025",
  failures: [{ check: "plausible-change", detail: "applicants 17440 vs federal 17798" }],
  queued: "2026-10-26",
  run: "r1",
  code,
  edition: "2025-26",
  sha256: "a".repeat(64),
  value: 1,
  ...over,
});

const form = (fields: Record<string, string>): { get(name: string): unknown } => ({ get: (name) => (name in fields ? fields[name] : null) });

interface FakeOver {
  docs?: [string, unknown][];
  items?: ReviewItem[];
  noteOk?: boolean;
  dispatch?: { ok: true } | { ok: false; reason: string };
  writeError?: string;
  refuse?: { fn: string; error: string };
  todo?: TodoDoc[];
  kinds?: Map<string, import("../lib/steward/types.ts").IssueKind>;
  running?: boolean;
}

/** Fake StewardDeps recording every call in order: notes, dispatches, `admin_data_*` calls, store reads, `admin_steward_write`s. */
function fakeDeps(over: FakeOver = {}) {
  const log: string[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const dispatches: { file: string; inputs: Record<string, string>; requestId: string }[] = [];
  const writes: { collection: string; key: string; body: unknown; note: string | null }[] = [];
  const store = new Map<string, unknown>((over.docs ?? []).map(([k, v]) => [k, structuredClone(v)]));
  const items = new Map((over.items ?? []).map((i) => [reviewKey(i), i] as const));
  const ops: OpsDeps = {
    gh: {
      configured: () => true,
      dispatchWorkflow: async (file, inputs, requestId) => {
        log.push(`dispatch ${file}`);
        dispatches.push({ file, inputs, requestId });
        return over.dispatch ?? { ok: true };
      },
      listRuns: async (workflows) => (over.running ? [{ workflow: workflows[0], status: "in_progress", title: "Data Steward", name: "Data Steward" }] as never : []),
      findRunByRequestId: async () => null,
      mergePull: async () => ({ ok: true }),
      holdPull: async () => ({ ok: true }),
      closePull: async () => ({ ok: true }),
    },
    note: async (action) => {
      log.push(`note ${action}`);
      return over.noteOk === false ? { ok: false, message: "the log is down" } : { ok: true };
    },
    adminName: async () => "Ray",
    now: () => new Date("2026-11-01T15:00:00Z"),
    requestId: () => "0f8c2d1e-4b5a-4c3d-9e8f-123456789abc",
    sleep: async () => undefined,
  };
  const deps: StewardDeps = {
    data: {
      ops,
      pointSnapshot: async () => ({ ok: true }),
      rpc: async (fn, args) => {
        log.push(`rpc ${fn}`);
        calls.push({ fn, args });
        if (over.refuse?.fn === fn) return { ok: false, error: over.refuse.error };
        return { ok: true, data: 1 };
      },
      readItems: async (keys) => {
        log.push(`read items`);
        return new Map(keys.filter((k) => items.has(k)).map((k) => [k, items.get(k)!] as const));
      },
    },
    write: async (collection, key, body, note) => {
      log.push(`write ${collection}/${key}`);
      writes.push({ collection, key, body: structuredClone(body), note });
      if (over.writeError) return { ok: false, error: over.writeError };
      store.set(`${collection}/${key}`, structuredClone(body));
      return { ok: true, changeSet: 42 };
    },
    read: async <D,>(collection: string, key: string) => (store.has(`${collection}/${key}`) ? (structuredClone(store.get(`${collection}/${key}`)) as D) : null),
    todoRow: async (key) => (over.todo ?? []).find((t) => t.key === key) ?? null,
    clusterKind: async (key) => over.kinds?.get(key) ?? null,
  };
  return { deps, log, calls, dispatches, writes, store };
}

const P = "steward.proposals";
const at = (p: ProposalDoc): [string, unknown] => [`${P}/${p.key}`, p];
const lastWrite = (w: { body: unknown }[]) => w.at(-1)!.body as ProposalDoc;

/* ------------------------------------------------------------------ */
/* Approve                                                             */
/* ------------------------------------------------------------------ */

test("Approve a value proposal: an edit per ticked row with the cited note, the item resolved accepted, the rest declined, then one write; no dispatch", async () => {
  const p = proposal();
  const f = fakeDeps({ docs: [at(p)], items: [item("C.117")] });
  const r = await actions.approveProposal(f.deps, form({ proposal: p.key, rows: "3", "row-0": "on", "row-1": "on", confirm: "Approve ", note: "C.118 needs the PDF read again" }));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(
    f.calls.map((c) => [c.fn, c.args.p_path ?? c.args.p_key, c.args.p_value ?? c.args.p_resolution]),
    [
      ["admin_data_edit", "admissions.applicants", 17440],
      ["admin_data_edit", "admissions.admitted", 5600],
      ["admin_data_resolve_review", "231624|2025-26|C.117", "accepted"],
    ],
    "exactly the two ticked rows; only the row with an item resolves one",
  );
  assert.equal(f.calls[0].args.p_note, "Correct a value from https://www.wm.edu/cds-2025-26.pdf, page 4, line 12: Total first-time, first-year men who applied 17,440");
  assert.equal(f.dispatches.length, 0, "edits need no job");
  assert.equal(f.writes.length, 1);
  const after = lastWrite(f.writes);
  assert.deepEqual(after.rows.map((x) => x.decision), ["approved", "approved", "declined"]);
  assert.equal(after.rows[2].decisionNote, "C.118 needs the PDF read again");
  assert.deepEqual([after.status, after.decided_by, after.decided_at], ["applied", "Ray", "2026-11-01T15:00:00.000Z"]);
  assert.match(f.writes[0].note!, /^steward\.approve: 2 approved, 1 declined/);
  assert.ok(f.log.indexOf("write steward.proposals/correct-c1-r1") > f.log.lastIndexOf("rpc admin_data_edit"), "the decision is written after the edits");
});

test("Approve refuses a decided proposal, a changed one, nothing ticked, a missing typed word, and an uncited row, before anything is written", async () => {
  for (const status of ["approved", "declined", "applied"] as const) {
    const f = fakeDeps({ docs: [at(proposal({ status }))] });
    const r = await actions.approveProposal(f.deps, form({ proposal: "correct-c1-r1", rows: "3", "row-0": "on", confirm: "approve" }));
    assert.deepEqual(r, { status: "error", message: `This proposal was already ${status}.` });
    assert.equal(f.calls.length + f.writes.length + f.dispatches.length, 0, status);
  }
  const cases: [Record<string, string>, RegExp, ProposalDoc?][] = [
    [{ rows: "4", "row-0": "on", confirm: "approve" }, /changed since the page loaded/],
    [{ rows: "3", confirm: "approve" }, /Tick at least one row/],
    [{ rows: "3", "row-0": "on" }, /Type "approve" to confirm/],
    [{ rows: "1", "row-0": "on", confirm: "approve" }, /row 1 cites no page or quote/, proposal({ rows: [row({ source: { page: null, line: null, quote: null, url: "https://x.edu/a.pdf" } })] })],
    [{ rows: "1", "row-0": "on", confirm: "approve" }, /row 1 has no value/, proposal({ rows: [row({ value: null })] })],
    [{ rows: "1", "row-0": "on", confirm: "approve" }, /row 1 names no field/, proposal({ rows: [row({ field: "admissions.not_a_field" })] })],
  ];
  for (const [fields, message, p] of cases) {
    const doc = p ?? proposal();
    const f = fakeDeps({ docs: [at(doc)] });
    const r = await actions.approveProposal(f.deps, form({ proposal: doc.key, ...fields }));
    assert.equal(r.status, "error");
    assert.match((r as { message: string }).message, message);
    assert.equal(f.calls.length + f.writes.length + f.dispatches.length, 0, String(message));
  }
  const f = fakeDeps();
  assert.match((await actions.approveProposal(f.deps, form({ proposal: "gone", rows: "1" })) as { message: string }).message, /doesn't exist/);
});

test("Approve skips a row whose item an earlier press accepted, refuses one whose item was rejected, and stops at a failed edit with the proposal still open", async () => {
  const p = proposal({ rows: [row({ item: "231624|2025-26|C.116" }), row({ field: "admissions.admitted", code: "C.117", value: 5600, item: "231624|2025-26|C.117" })] });
  const again = fakeDeps({ docs: [at(p)], items: [item("C.116", { resolved: "accepted" }), item("C.117")] });
  assert.equal((await actions.approveProposal(again.deps, form({ proposal: p.key, rows: "2", "row-0": "on", "row-1": "on", confirm: "approve" }))).status, "done");
  assert.deepEqual(again.calls.map((c) => c.args.p_path ?? c.args.p_key), ["admissions.admitted", "231624|2025-26|C.117"], "the accepted row is not written again");

  const rejected = fakeDeps({ docs: [at(p)], items: [item("C.116", { resolved: "rejected" }), item("C.117")] });
  const r = await actions.approveProposal(rejected.deps, form({ proposal: p.key, rows: "2", "row-0": "on", confirm: "approve" }));
  assert.match((r as { message: string }).message, /row 1 settles an item already rejected/);
  assert.equal(rejected.calls.length + rejected.writes.length, 0);

  const failing = fakeDeps({ docs: [at(p)], items: [item("C.116"), item("C.117")], refuse: { fn: "admin_data_edit", error: "invalid_path" } });
  const stopped = await actions.approveProposal(failing.deps, form({ proposal: p.key, rows: "2", "row-0": "on", confirm: "approve" }));
  assert.match((stopped as { message: string }).message, /^Nothing was applied: That isn't a field the console can edit\./);
  assert.equal(failing.writes.length, 0, "the proposal stays open");
});

test("Approve a hold proposal: the decisions written (logged), then one dispatch of steward.yml mode apply, logged ops.dispatch before it is sent", async () => {
  const p = proposal({ key: "hold-grid-r1", kind: "hold", rows: [row({ field: null, code: "C.701", value: undefined, proposed: "Not considered" }), row({ field: null, code: "C.702", value: undefined, proposed: "Considered" })] });
  const f = fakeDeps({ docs: [at(p)] });
  const r = await actions.approveProposal(f.deps, form({ proposal: p.key, rows: "2", "row-1": "on", confirm: "approve" }));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(f.log, ["write steward.proposals/hold-grid-r1", "note ops.dispatch", "dispatch steward.yml"]);
  assert.deepEqual(f.dispatches, [{ file: "steward.yml", inputs: { proposal: "hold-grid-r1", mode: "apply" }, requestId: "0f8c2d1e-4b5a-4c3d-9e8f-123456789abc" }]);
  const after = lastWrite(f.writes);
  assert.deepEqual([after.status, after.rows.map((x) => x.decision)], ["approved", ["declined", "approved"]]);
  assert.equal(f.calls.length, 0, "the job applies holds, not the console");

  const unlogged = fakeDeps({ docs: [at(p)], noteOk: false });
  const refused = await actions.approveProposal(unlogged.deps, form({ proposal: p.key, rows: "2", "row-1": "on", confirm: "approve" }));
  assert.match((refused as { message: string }).message, /apply job didn't start: The action was not sent because it could not be logged/);
  assert.equal(unlogged.dispatches.length, 0, "nothing is sent that the log doesn't show");

  const busy = fakeDeps({ docs: [at(p)], running: true });
  const blocked = await actions.approveProposal(busy.deps, form({ proposal: p.key, rows: "2", "row-1": "on", confirm: "approve" }));
  assert.match((blocked as { message: string }).message, /already in progress.*Start it from this proposal/);
  const retry = fakeDeps({ docs: [at(lastWrite(busy.writes))] });
  assert.equal((await actions.startProposalJob(retry.deps, form({ proposal: p.key }))).status, "done");
  assert.deepEqual(retry.dispatches.map((d) => d.inputs), [{ proposal: "hold-grid-r1", mode: "apply" }]);
});

test("a reject proposal needs no typed word; a systemic one records the analysis without ticks or a dispatch", async () => {
  const reject = proposal({ key: "reject-x-r1", kind: "reject", rows: [row({ field: null, value: undefined, item: "231624|2025-26|C.116" })] });
  const f = fakeDeps({ docs: [at(reject)] });
  assert.equal((await actions.approveProposal(f.deps, form({ proposal: reject.key, rows: "1", "row-0": "on" }))).status, "done");
  assert.equal(f.dispatches[0].inputs.mode, "apply");

  const systemic = proposal({ key: "systemic-header-r1", kind: "systemic", rows: [], change: { what: "w", how: "h", revert: "r" } });
  const s = fakeDeps({ docs: [at(systemic)] });
  const r = await actions.approveProposal(s.deps, form({ proposal: systemic.key, rows: "0", note: "do it in the check" }));
  assert.equal(r.status, "done");
  assert.deepEqual([lastWrite(s.writes).status, lastWrite(s.writes).decision_note], ["approved", "do it in the check"]);
  assert.equal(s.dispatches.length + s.calls.length, 0);
});

test("Approve a re-read: the first ticked college's run is dispatched (one at a time), its rows say so, and the next starts from the proposal", async () => {
  const p = proposal({ key: "reread-x-r1", kind: "reread", cost: 3, rows: [row({ unit_id: "145637", field: null }), row({ unit_id: "190415", field: null }), row({ unit_id: "221999", field: null })] });
  assert.equal(actions.rereadCostEach(p), 1);
  const f = fakeDeps({ docs: [at(p)] });
  const r = await actions.approveProposal(f.deps, form({ proposal: p.key, rows: "3", "row-0": "on", "row-2": "on" }));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.match((r as { message: string }).message, /1 more college waits/);
  assert.deepEqual(f.dispatches.map((d) => [d.file, d.inputs]), [["college-reported.yml", { college: "145637", rediscover: "false", mode: "college" }]]);
  assert.deepEqual(f.log, ["write steward.proposals/reread-x-r1", "note ops.dispatch", "dispatch college-reported.yml", "write steward.proposals/reread-x-r1"]);
  const after = f.store.get(`${P}/${p.key}`) as ProposalDoc;
  assert.equal(after.status, "approved");
  assert.deepEqual(actions.rereadsWaiting(after), ["221999"]);
  const next = await actions.startProposalJob(f.deps, form({ proposal: p.key }));
  assert.match((next as { message: string }).message, /Every re-read has started/);
  assert.equal((f.store.get(`${P}/${p.key}`) as ProposalDoc).status, "applied");
  assert.deepEqual(f.dispatches.map((d) => d.inputs.college), ["145637", "221999"]);
});

/* ------------------------------------------------------------------ */
/* Decline, Ask, a row's decision                                       */
/* ------------------------------------------------------------------ */

test("Decline needs a reason, closes the proposal and declines its undecided rows with it", async () => {
  const p = proposal({ rows: [row({ decision: "approved" }), row()] });
  const f = fakeDeps({ docs: [at(p)] });
  assert.deepEqual(await actions.declineProposal(f.deps, form({ proposal: p.key })), { status: "error", message: "Say why (up to 500 characters)." });
  const r = await actions.declineProposal(f.deps, form({ proposal: p.key, reason: "the federal figure is right" }));
  assert.equal(r.status, "done");
  const after = lastWrite(f.writes);
  assert.deepEqual([after.status, after.decision_note, after.rows.map((x) => x.decision), after.rows[1].decisionNote], ["declined", "the federal figure is right", ["approved", "declined"], "the federal figure is right"]);
  assert.match(f.writes[0].note!, /^steward\.decline: /);
  assert.equal(f.dispatches.length, 0);
});

test("Ask saves the question (asked), then dispatches steward.yml mode answer with budget 5, logged first; a failed dispatch keeps the question", async () => {
  const p = proposal();
  const f = fakeDeps({ docs: [at(p)] });
  assert.equal((await actions.askProposal(f.deps, form({ proposal: p.key }))).status, "error");
  const r = await actions.askProposal(f.deps, form({ proposal: p.key, question: "Does B22 quote the cohort fall?" }));
  assert.equal(r.status, "done", JSON.stringify(r));
  assert.deepEqual(f.log, ["write steward.proposals/correct-c1-r1", "note ops.dispatch", "dispatch steward.yml"]);
  assert.deepEqual(f.dispatches[0].inputs, { proposal: "correct-c1-r1", mode: "answer", budget: "5" });
  assert.deepEqual([lastWrite(f.writes).status, lastWrite(f.writes).question], ["asked", "Does B22 quote the cohort fall?"]);
  // Asking again on an asked proposal is allowed (the retry); a refused dispatch says the question is saved.
  const g = fakeDeps({ docs: [at(lastWrite(f.writes))], dispatch: { ok: false, reason: "workflow not found" } });
  const again = await actions.askProposal(g.deps, form({ proposal: p.key, question: "Does B22 quote the cohort fall?" }));
  assert.match((again as { message: string }).message, /The question is saved, but the Steward didn't start/);
});

test("a row decided on the Review page writes the proposal's row only, while it is undecided", async () => {
  const p = proposal();
  const f = fakeDeps({ docs: [at(p)] });
  const r = await actions.decideProposalRow(f.deps, form({ proposal: p.key, row: "2", unit: "231624", decision: "declined", note: "wrong line" }));
  assert.equal(r.status, "done");
  assert.deepEqual(lastWrite(f.writes).rows.map((x) => x.decision ?? null), [null, null, "declined"]);
  assert.equal(lastWrite(f.writes).status, "open");
  assert.equal((await actions.decideProposalRow(f.deps, form({ proposal: p.key, row: "9", unit: "231624", decision: "approved" }))).status, "error");
  assert.match((await actions.decideProposalRow(f.deps, form({ proposal: p.key, row: "0", unit: "145637", decision: "approved" })) as { message: string }).message, /changed/);
  const decided = fakeDeps({ docs: [at(proposal({ status: "applied" }))] });
  assert.equal((await actions.decideProposalRow(decided.deps, form({ proposal: p.key, row: "0", unit: "231624", decision: "approved" }))).status, "error");
  assert.equal(decided.writes.length, 0);
});

/* ------------------------------------------------------------------ */
/* Leave, To do, Decide                                                */
/* ------------------------------------------------------------------ */

test("Leave a cause: the issue document left with the reason, created with the cluster's kind when the Steward hasn't written one", async () => {
  const key = "previous-cohort-disagrees|";
  const f = fakeDeps({ kinds: new Map([[key, "policy"]]) });
  assert.equal((await actions.leaveIssue(f.deps, form({ issue: key }))).status, "error", "a reason is required");
  const r = await actions.leaveIssue(f.deps, form({ issue: key, reason: "waiting on the policy decision" }));
  assert.equal(r.status, "done");
  const doc = f.writes[0].body as IssueDoc;
  assert.deepEqual([f.writes[0].collection, doc.key, doc.kind, doc.status, doc.reason], ["steward.issues", key, "policy", "left", "waiting on the policy decision"]);
  assert.equal((await actions.leaveIssue(f.deps, form({ issue: key, reason: "again" })) as { message: string }).message, "This cause is left already.");
  const gone = fakeDeps();
  assert.match((await actions.leaveIssue(gone.deps, form({ issue: "nope|", reason: "x" })) as { message: string }).message, /isn't in the queue/);
});

test("Leave one item from the Review page: a finding on its own cause's issue; another check's cause is refused", async () => {
  const it = item("C.116");
  const key = "plausible-change|applicants # vs federal #";
  const f = fakeDeps({ items: [it], kinds: new Map([[key, "policy"]]) });
  assert.equal((await actions.leaveReviewItem(f.deps, form({ item: reviewKey(it), issue: "order|x", reason: "r" }))).status, "error");
  const r = await actions.leaveReviewItem(f.deps, form({ item: reviewKey(it), issue: key, reason: "the college restated it" }));
  assert.equal(r.status, "done");
  const doc = f.writes.at(-1)!.body as IssueDoc;
  assert.equal(doc.status, "new", "the cause itself isn't left");
  assert.deepEqual(doc.findings.map((x) => [x.unit_id, x.shows]), [["231624", "Left by the owner (C.116): the college restated it"]]);
});

test("To do: Found needs an https address and records the attempt; No document published and Done close the row", async () => {
  const todo: TodoDoc = { key: "cds:190415:2025-26", kind: "cds", unit_id: "190415", subject: "Cornell University", edition: "2025-26", landing: "https://irp.cornell.edu/cds", document_url: null, host: "irp.cornell.edu", why: "challenge", reach: 1, demand: 0, status: "open", route: null, attempts: [], note: null, updated: "2026-10-30" };
  const f = fakeDeps({ todo: [todo] });
  assert.match((await actions.todoFound(f.deps, form({ todo: todo.key, url: "javascript:alert(1)" })) as { message: string }).message, /https/);
  assert.equal((await actions.todoFound(f.deps, form({ todo: todo.key, url: "https://irp.cornell.edu/cds-2025-26.pdf" }))).status, "done");
  const found = f.writes[0].body as TodoDoc;
  assert.deepEqual([found.status, found.document_url, found.attempts.length, found.attempts[0].route], ["found", "https://irp.cornell.edu/cds-2025-26.pdf", 1, "person"]);
  assert.equal((await actions.todoNoDocument(f.deps, form({ todo: todo.key }))).status, "done");
  assert.equal((f.writes[1].body as TodoDoc).status, "no-document");
  assert.equal((await actions.todoDone(f.deps, form({ todo: todo.key, note: "uploaded" }))).status, "done");
  assert.equal((f.writes[2].body as TodoDoc).status, "done");
  assert.ok(f.writes.every((w) => w.collection === "steward.todo" && /^steward\.todo: /.test(w.note!)));
  const done = fakeDeps({ todo: [{ ...todo, status: "done" }] });
  assert.equal((await actions.todoDone(done.deps, form({ todo: todo.key })) as { message: string }).message, "This row is done already.");
  assert.equal(done.writes.length, 0);
});

test("Decide: one of the question's answers with a note; anything else is refused", async () => {
  const d: DecisionDoc = { key: "hold-model-grids", question: "Hold every model-read grid?", recommends: "Hold them", options: [{ answer: "Hold them", effect: "3,550 values leave the site" }, { answer: "Keep them", effect: "nothing changes" }], answer: null, note: null, decided_by: null, decided_at: null, run: "r1", created: "2026-11-01" };
  const f = fakeDeps({ docs: [["steward.decisions/hold-model-grids", d]] });
  assert.equal((await actions.decidePolicy(f.deps, form({ decision: d.key, answer: "Maybe" }))).status, "error");
  assert.equal((await actions.decidePolicy(f.deps, form({ decision: d.key, answer: "Keep them", note: "until the check ships" }))).status, "done");
  const after = f.writes[0].body as DecisionDoc;
  assert.deepEqual([after.answer, after.note, after.decided_by], ["Keep them", "until the check ships", "Ray"]);
  assert.match(f.writes[0].note!, /^steward\.decide: Keep them/);
});

test("a refused admin_steward_write comes back in words, and nothing is dispatched after it", async () => {
  const f = fakeDeps({ docs: [at(proposal())], writeError: "not_steward_collection" });
  const r = await actions.askProposal(f.deps, form({ proposal: "correct-c1-r1", question: "why?" }));
  assert.deepEqual(r, { status: "error", message: "The console writes only the Steward's own documents." });
  assert.equal(f.dispatches.length, 0);
  assert.equal(actions.stewardErrorMessage("admin only"), "Only an admin signed in with their second factor can do that.");
  assert.match(actions.stewardErrorMessage("version conflict on steward.todo"), /changed that a moment ago/);
});

test("editNote: the parts the row has, the publish reason, at most 500 characters; the apply job's kinds are the console's", async () => {
  assert.equal(actions.editNote("publish", row({ source: { page: 3, line: null, quote: "69.63%", url: "https://x.edu/c.pdf" }, why: "differs from federal: a different cohort" })), "Publish as read from https://x.edu/c.pdf, page 3: 69.63% (differs from federal: a different cohort)");
  assert.equal(actions.editNote("correct", row({ source: { page: null, line: null, quote: "CDS-C!D5 17440", url: null } })), `Correct a value from document ${"a".repeat(12)}: CDS-C!D5 17440`);
  assert.ok(actions.editNote("correct", row({ source: { page: 1, line: 2, quote: "x".repeat(900), url: "https://x.edu/c.pdf" } })).length <= 500);
  const { APPLIED_KINDS } = await import("../scripts/lib/steward/apply.mts");
  assert.deepEqual([...actions.JOB_KINDS].sort(), [...APPLIED_KINDS].sort());
  assert.equal(networkCalls, 0);
});

/* ------------------------------------------------------------------ */
/* The run table, the Server Actions, the pages' guards                 */
/* ------------------------------------------------------------------ */

test("the three Steward runs dispatch steward.yml; apply and answer are hidden from Start a run, like Point back here", async () => {
  const { buildDispatch, DISPATCHABLE_RUNS } = await import("../lib/admin/workflows.ts");
  assert.deepEqual(DISPATCHABLE_RUNS.filter((r) => r.hidden).map((r) => r.id).sort(), ["point-snapshot", "steward-answer", "steward-apply"]);
  const run = buildDispatch("steward", { budget: "", cause: "edition-mismatch|item year Y is not edition Y", unit: "", mode: "audit" });
  assert.ok(run.ok && run.file === "steward.yml");
  assert.deepEqual(run.ok && run.inputs, { budget: "20", cause: "edition-mismatch|item year Y is not edition Y", unit: "", mode: "audit" });
  assert.equal(buildDispatch("steward", { unit: "12" }).ok, false, "a unit, when given, is six digits");
  assert.equal(buildDispatch("college", { college: "" }).ok, false, "the college run still needs one");
  const steward = read(".github/workflows/steward.yml");
  for (const input of ["mode", "budget", "cause", "unit", "proposal", "request_id"]) assert.match(steward, new RegExp(`\\n      ${input}:\\n`), input);
  assert.match(steward, /group: steward\b/, "one Steward run at a time, as the table's guard says");
});

test("static: every exported Server Action in app/admin/data/steward-actions.ts starts with requireAdmin()", () => {
  const src = read("app/admin/data/steward-actions.ts");
  assert.ok(src.startsWith('"use server";'));
  const bodies = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)];
  assert.equal(bodies.length, 11);
  for (const [, name, firstLine] of bodies) assert.match(firstLine, /await requireAdmin\(\)/, `${name} starts with requireAdmin()`);
  assert.equal([...src.matchAll(/^export /gm)].length, bodies.length, "nothing else is exported from the actions file");
  const broken = src.replace("const admin = await requireAdmin();", "const admin = { userId: 'x' };");
  assert.ok([...broken.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n(.*)\n/g)].some(([, , l]) => !/await requireAdmin\(\)/.test(l)), "the check catches an action that skips it");
});

const PAGES = [
  "app/admin/data/issues/page.tsx",
  "app/admin/data/proposals/page.tsx",
  "app/admin/data/proposals/[key]/page.tsx",
  "app/admin/data/todo/page.tsx",
  "app/admin/data/decisions/page.tsx",
  "app/admin/data/audits/page.tsx",
  "app/admin/colleges/[unit]/review/page.tsx",
];

test("static: the six screens call requireAdmin() before reading anything, are noindex, and never say AI or agent", () => {
  for (const file of PAGES) {
    const src = read(file);
    const body = src.slice(src.indexOf("export default async function"));
    assert.match(body, /\{\n\s+await connection\(\);\n\s+await requireAdmin\(\);/, `${file} calls requireAdmin() first`);
    assert.match(src, /robots: \{ index: false, follow: false \}/, `${file} is noindex`);
  }
  for (const file of [...PAGES, ...["Bits", "ClustersTable", "ProposalApprove", "ProposalParts", "ReviewTable", "TodoTable"].map((n) => `components/admin/steward/${n}.tsx`)]) {
    const text = read(file).replace(/\/\*\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, /\bAI\b|\bagent\b/i, file);
  }
});

test("the Data nav, Operations, Holds and the college page link the new screens", () => {
  const nav = read("app/admin/data/page.tsx");
  for (const [href, label] of [["issues", "Issues"], ["proposals", "Proposals"], ["todo", "To do"], ["decisions", "Decisions"], ["audits", "Audits"]]) assert.match(nav, new RegExp(`href: "/admin/data/${href}", label: "${label}"`));
  const ops = read("app/admin/operations/page.tsx");
  assert.match(ops, /"\/admin\/data\/issues"/);
  assert.match(ops, /Code changes only/);
  assert.match(ops, /filter\(\(run\) => !run\.hidden\)/);
  assert.match(read("app/admin/data/holds/page.tsx"), /<IssuesPointer open=/);
  const college = read("app/admin/colleges/[unit]/page.tsx");
  assert.match(college, /href=\{`\/admin\/colleges\/\$\{unit\}\/review`\}/);
  assert.match(college, /reviewHref=\{`\/admin\/colleges\/\$\{unit\}\/review`\}/, "and the Health card");
});

/* ------------------------------------------------------------------ */
/* The pages, rendered                                                  */
/* ------------------------------------------------------------------ */

const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

function stubModule(name: string, names: string[]): string {
  const file = join(tmp, `stub-${name}.mjs`);
  writeFileSync(
    file,
    `import React from ${JSON.stringify(reactUrl)};
const make = (n) => ({ children, ...props }) => {
  const plain = Object.fromEntries(Object.entries(props).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) || v === null));
  return React.createElement("div", { "data-stub": n, "data-props": JSON.stringify(plain) }, children);
};
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}\n`,
  );
  return pathToFileURL(file).href;
}

/** Transpiles a page or component, replaces its component and action imports with stand-ins, and loads it with the real lib modules. */
async function loadTsx(rel: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  let n = 0;
  const code = outputText
    .replace(/from "next\/link"/g, `from ${JSON.stringify(pathToFileURL(join(tmp, "link.mjs")).href)}`)
    .replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`)
    .replace(/import \{([^}]*)\} from "(@\/(?:components|app)\/[^"]+)";/g, (_m, names: string, spec: string) => {
      const list = names.split(",").map((s) => s.trim().replace(/^type /, "").split(" as ").pop()!.trim()).filter(Boolean);
      return `import {${names.replace(/\btype \w+,?/g, "")}} from ${JSON.stringify(stubModule(`${rel.replace(/[^a-z]/gi, "_")}${n++}-${spec.split("/").pop()}`, list))};`;
    });
  const file = join(tmp, `${rel.replace(/[^a-z]/gi, "_")}.mjs`);
  writeFileSync(file, `import React from ${JSON.stringify(reactUrl)};\n${code}`);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}
type Page = (props: { params?: Promise<Record<string, string>>; searchParams?: Promise<Record<string, string | undefined>> }) => Promise<import("react").ReactElement>;
const html = (element: import("react").ReactElement) => renderToStaticMarkup(element);
const stubsIn = (markup: string) => [...markup.matchAll(/data-stub="(\w+)" data-props="([^"]*)"/g)].map((m) => ({ name: m[1], props: JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'")) as Record<string, unknown> }));
const doc = (collection: string, key: string, body: unknown) => ({ collection, key, version: 1, body, change_set_id: 1, updated_at: "2026-11-01T00:00:00Z" });

const QUEUE = JSON.parse(read("tests/fixtures/steward/review-queue-sample.json")) as Record<string, ReviewItem>;
const RECORD = (await miniLayers().readOne<CollegeRecord>("reported.cds_records", "231624"))!;
const WM = RECORD.documents[0];
const WM_ITEMS: ReviewItem[] = ["C.116", "C.117", "C.118"].map((code) => item(code, { urls: [WM.url], edition: WM.edition, sha256: WM.sha256, value: WM.items[code].v ?? null }));

/** The store as the pages read it: the queue sample, William & Mary's record and items, and the Steward's documents. */
function store(extra: Record<string, unknown>[] = []) {
  return () =>
    fakeSupabase({
      data_documents: [
        ...Object.entries(QUEUE).map(([k, v]) => doc("reported.review_queue", k, v)),
        ...WM_ITEMS.map((i) => doc("reported.review_queue", reviewKey(i), i)),
        doc("reported.cds_records", "231624", RECORD),
        ...extra,
      ],
    });
}
const fresh = () => {
  reviewQueue.resetQueueCache();
  reads.resetClusterCache();
};

test("every screen is a 404 for anyone but an admin, before anything is read", async () => {
  for (const file of PAGES) {
    fresh();
    const page = (await loadTsx(file)).default as Page;
    reset({ admin: false });
    await assert.rejects(page({ params: Promise.resolve({ key: "k", unit: "231624" }), searchParams: Promise.resolve({}) }), is404, file);
    assert.deepEqual(world.calls, ["requireAdmin"], file);
  }
});

test("Issues: the causes from the live queue joined with the issue documents, the last run, Run the Data Steward, and Colleges to review", async () => {
  fresh();
  const page = (await loadTsx("app/admin/data/issues/page.tsx")).default as Page;
  const run = { key: "r9", mode: "run", started: "2026-11-01T09:00:00Z", finished: "2026-11-01T09:20:00Z", budget_usd: 5, spent_usd: 1.25, clusters: 14, issues: 3, proposals: 2, todo: 1, decisions: 1, audits: 0, stopped: null, request_id: null };
  reset({ supabase: store([doc("steward.runs", "r9", run)]) });
  const markup = html(await page({ searchParams: Promise.resolve({}) }));
  assert.equal(world.calls[0], "requireAdmin");
  const stubs = stubsIn(markup);
  assert.ok(stubs.some((s) => s.name === "ClustersTable"));
  assert.ok(stubs.some((s) => s.name === "RunForm" && s.props.prefillUnit === null), "Run the Data Steward");
  assert.match(markup, /data-stub="Panel" data-props="\{&quot;title&quot;:&quot;The last run&quot;\}"><div data-stub="Fields"/, "the last run's summary (its fields are the Fields stand-in's props)");
  assert.doesNotMatch(markup, /hasn&#x27;t run yet/);
  assert.match(markup, /href="\/admin\/colleges\/100751\/review"[^>]*>The University of Alabama<\/a><span[^>]*>49 open items</, "Colleges to review: most items first, each linking its Review page");
  const kinds = html(await page({ searchParams: Promise.resolve({ kind: "policy" }) }));
  assert.match(kinds, /aria-current="page"[^>]*>Policy</);
});

test("ClustersTable: kind, counts and status per cause; Leave unless left; the examples link each college's Review page", async () => {
  const mod = (await loadTsx("components/admin/steward/ClustersTable.tsx")) as { ClustersTable: (p: unknown) => import("react").ReactElement };
  const cluster = { key: "order|", check: "order", detail: "", items: 12, colleges: 3, published: 2, examples: ["231624|2025-26|C.116"], documents: [] };
  const left: IssueDoc = { key: "parts-sum|x", kind: "value", status: "left", hypothesis: "a check bug", findings: [], proposals: ["correct-x-r1"], reason: "waiting on the check fix", run: "r1", updated: "2026-11-01" };
  const markup = html(mod.ClustersTable({ rows: [{ cluster, kind: "value", issue: null }, { cluster: { ...cluster, key: "parts-sum|x", check: "parts-sum", detail: "x" }, kind: "value", issue: left }] }));
  const forms = stubsIn(markup).filter((s) => s.name === "AdminForm");
  assert.deepEqual(forms.map((s) => s.props.trigger), ["Leave"], "Leave on the cause that isn't left");
  assert.match(markup, /href="\/admin\/colleges\/231624\/review"/);
  assert.match(markup, /waiting on the check fix/);
  assert.match(markup, /href="\/admin\/data\/proposals\/correct-x-r1"/);
  assert.match(markup, /Key for one cause: <code[^>]*>order\|<\/code>/);
});

test("Proposals and a proposal's page: the list by status, Approve with the typed word for a correction, Decline and Ask; a decided one shows its decisions", async () => {
  fresh();
  const open = proposal();
  const declined = proposal({ key: "hold-y-r1", kind: "hold", status: "declined", rows: [row({ decision: "declined", decisionNote: "no" })] });
  reset({ supabase: store([doc(P, open.key, open), doc(P, declined.key, declined)]) });
  const list = html(await ((await loadTsx("app/admin/data/proposals/page.tsx")).default as Page)({ searchParams: Promise.resolve({}) }));
  assert.ok(stubsIn(list).some((s) => s.name === "ProposalsList"));
  assert.match(list, /href="\/admin\/data\/proposals\?status=asked"/);

  const page = (await loadTsx("app/admin/data/proposals/[key]/page.tsx")).default as Page;
  const markup = html(await page({ params: Promise.resolve({ key: encodeURIComponent(open.key) }) }));
  const approve = stubsIn(markup).find((s) => s.name === "ProposalApprove");
  assert.deepEqual([approve?.props.proposal, approve?.props.confirmWord, approve?.props.costEach], ["correct-c1-r1", "approve", null]);
  assert.deepEqual(stubsIn(markup).filter((s) => s.name === "AdminForm").map((s) => s.props.trigger), ["Decline", "Ask"]);
  assert.ok(stubsIn(markup).some((s) => s.name === "EvidenceTable"));

  const closed = html(await page({ params: Promise.resolve({ key: declined.key }) }));
  assert.ok(!stubsIn(closed).some((s) => s.name === "ProposalApprove" || s.props.trigger === "Decline"));
  assert.ok(stubsIn(closed).some((s) => s.name === "ProposalRowsTable"));
  await assert.rejects(page({ params: Promise.resolve({ key: "no-such-proposal" }) }), is404);
});

test("ProposalApprove: ticks pre-set from the decision or the recommendation, the running re-read cost, and the typed word", async () => {
  const mod = (await loadTsx("components/admin/steward/ProposalApprove.tsx")) as { ProposalApprove: (p: unknown) => import("react").ReactElement };
  const base = { index: 0, unit: "231624", college: "William & Mary", reviewHref: "/admin/colleges/231624/review", label: "admissions.applicants", now: "17,798 · IPEDS", proposed: "17,440", fromHref: "https://x.edu/c.pdf#page=4", fromLabel: "p. 4, line 12", quote: "17,440", why: null };
  const rows = [{ ...base, recommends: "approve", ticked: true }, { ...base, index: 1, unit: "190415", recommends: "your-call", why: "two readings", ticked: false }];
  // Rendered on the server, a client component shows its first state: hooks run with their initial values.
  const { createElement } = await import("react");
  const markup = html(createElement(mod.ProposalApprove as never, { action: async () => ({ status: "idle" }), proposal: "reread-x-r1", rows, confirmWord: "approve", costEach: 1.5 }));
  assert.match(markup, /name="row-0"[^>]*checked=""/);
  assert.doesNotMatch(markup, /name="row-1"[^>]*checked=""/);
  assert.match(markup, /1 of 2 ticked · projected cost of the ticked re-reads: \$1\.50 for 1 college/);
  assert.match(markup, /Approve \(the Steward checked the document\)/);
  assert.match(markup, /Your call/);
  assert.match(markup, /Type <span class="font-mono">approve<\/span> to confirm/);
  assert.match(markup, /name="rows" value="2"/);
});

test("To do, Decisions and Audits render their documents for an admin", async () => {
  fresh();
  const todo: TodoDoc = { key: "cds:190415:2025-26", kind: "cds", unit_id: "190415", subject: "Cornell University", edition: "2025-26", landing: "https://irp.cornell.edu/cds", document_url: null, host: "irp.cornell.edu", why: "challenge", reach: 1, demand: 0, status: "open", route: null, attempts: [], note: null, updated: "2026-10-30" };
  const decision: DecisionDoc = { key: "hold-model-grids", question: "Hold every model-read grid?", recommends: "Hold them", options: [{ answer: "Hold them", effect: "values leave the site" }, { answer: "Keep them", effect: "nothing changes" }], answer: null, note: null, decided_by: null, decided_at: null, run: "r1", created: "2026-11-01" };
  const audit = { key: "grids-r1", family: "grids", checked: 24, wrong: [row()], rate: 0.125, run: "r1", created: "2026-11-01" };
  reset({ supabase: store([doc("steward.todo", todo.key, todo), doc("steward.decisions", decision.key, decision), doc("steward.audits", audit.key, audit)]) });
  const t = html(await ((await loadTsx("app/admin/data/todo/page.tsx")).default as Page)({ searchParams: Promise.resolve({ kind: "cds" }) }));
  assert.ok(stubsIn(t).some((s) => s.name === "TodoTable"));
  assert.match(t, /aria-current="page"[^>]*>Common Data Set</);
  const d = html(await ((await loadTsx("app/admin/data/decisions/page.tsx")).default as Page)({}));
  assert.ok(stubsIn(d).some((s) => s.name === "AdminForm" && s.props.trigger === "Decide"));
  assert.match(d, /1 waiting for an answer/);
  const a = html(await ((await loadTsx("app/admin/data/audits/page.tsx")).default as Page)({}));
  assert.match(a, /1 wrong of 24 checked/);

  const tt = (await loadTsx("components/admin/steward/TodoTable.tsx")) as { TodoTable: (p: unknown) => import("react").ReactElement };
  const rowsHtml = html(tt.TodoTable({ rows: [todo, { ...todo, key: "k2", status: "no-document" }] }));
  assert.deepEqual(stubsIn(rowsHtml).filter((s) => s.name === "AdminForm").map((s) => s.props.trigger), ["Found", "No document published", "Done", "Found", "Done"]);
  assert.match(rowsHtml, /href="\/admin\/colleges\/190415\/review"/);
  assert.match(rowsHtml, /a bot challenge/);
});

test("the Review page: the college's rows from readReviewRows, and 'On the site now' from the profile's own citeField", async () => {
  fresh();
  const page = (await loadTsx("app/admin/colleges/[unit]/review/page.tsx")).default as Page;
  const p = proposal({ rows: [row({ item: reviewKey(WM_ITEMS[0]), proposed: "17,440 (corrected)" })] });
  reset({ supabase: store([doc(P, p.key, p)]) });
  const markup = html(await page({ params: Promise.resolve({ unit: "231624" }) }));
  assert.ok(stubsIn(markup).some((s) => s.name === "ReviewTable"));
  assert.match(markup, /Review William &amp; Mary/);
  await assert.rejects(page({ params: Promise.resolve({ unit: "999999" }) }), is404, "a college the dataset doesn't have");

  fresh();
  const client = store([doc(P, p.key, p)])() as unknown as import("../lib/admin/review-queue.ts").StoreClient;
  const review = await reads.readReviewRows(client, "231624", data);
  const mod = (await loadTsx("components/admin/steward/ReviewTable.tsx")) as { ReviewTable: (p: unknown) => import("react").ReactElement };
  const table = html(mod.ReviewTable({ groups: review.groups }));
  const school = data.getSchoolById("231624")!;
  const expected = nowAtField("admissions.applicants", school, data.citeField);
  const cell = new RegExp(`data-row="231624\\|2025-26\\|C\\.116"[\\s\\S]*?<td[^>]*data-now="[^"]*">([^<]*)</td>`).exec(table);
  assert.equal(cell?.[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&"), expected);
  const forms = stubsIn(table).filter((s) => s.name === "AdminForm").map((s) => s.props.trigger);
  for (const t of ["Approve", "Decline", "Accept the value", "Reject", "Leave"]) assert.ok(forms.includes(t), t);
  assert.match(table, /href="\/admin\/data\/proposals\/correct-c1-r1"/);
  assert.ok(stubsIn(table).some((s) => s.name === "Recommends" && s.props.recommends === "approve"));
});

test("Holds points at Issues only when the queue is over 500 items", async () => {
  const mod = (await loadTsx("components/admin/Holds.tsx")) as { IssuesPointer: (p: { open: number }) => import("react").ReactElement | null; ISSUES_POINTER_AT: number };
  assert.equal(mod.ISSUES_POINTER_AT, 500);
  assert.equal(mod.IssuesPointer({ open: 500 }), null);
  assert.match(html(mod.IssuesPointer({ open: 20990 })!), /20,990 items are open[\s\S]*href="\/admin\/data\/issues"/);
});

test("steward-view: links, a document at its page, and the URL parameters", () => {
  assert.equal(view.proposalHref("correct-a b-r1"), "/admin/data/proposals/correct-a%20b-r1");
  assert.equal(view.keyFromSegment("correct-a%20b-r1"), "correct-a b-r1");
  assert.equal(view.keyFromSegment("%E0%A4%A"), "%E0%A4%A");
  assert.equal(view.documentHref("https://x.edu/c.pdf#old", 4), "https://x.edu/c.pdf#page=4");
  assert.equal(view.documentHref("javascript:alert(1)", 4), null);
  assert.equal(view.pct(0.125), "12.5%");
  assert.deepEqual([view.pageParam("3"), view.pageParam("-1"), view.pageParam(undefined)], [3, 1, 1]);
});
