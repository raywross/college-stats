/**
 * lib/admin/inbox-reads.ts (specs/product/admin-speed.md "As built: U3"): the layout's badge and the Inbox's three
 * panels, rendering in one request, read each source once (React cache(), per request), the queue tile reads the
 * counts and never the whole queue, and a failed source leaves its rows out without failing the others. Every read the
 * module makes is a stand-in that counts its calls; `react`'s cache() is a stand-in with React's per-request contract
 * (one memo per request, cleared by `newRequest()`). No database, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });

/** A read stand-in: counts its call, then answers what the test set (or throws when the test said it fails). */
const read = (name: string, args = "") => `async function(${args}){ const w = globalThis.__inbox; w.calls.push(${JSON.stringify(name)}); if (w.fail.has(${JSON.stringify(name)})) throw new Error("down"); return w.answers[${JSON.stringify(name)}]; }`;

const STUBS: Record<string, string> = {
  "server-only": "export {}",
  // React's cache(): one memo per request (globalThis.__inbox.request), keyed by the function and its arguments.
  react: `export function cache(fn){ return (...args) => { const w = globalThis.__inbox; let m = w.memo.get(fn); if (!m) { m = new Map(); w.memo.set(fn, m); } const k = JSON.stringify(args); if (!m.has(k)) m.set(k, fn(...args)); return m.get(k); }; }`,
  "@/lib/admin/people": `export async function adminSupabase(){ const w = globalThis.__inbox; w.calls.push("adminSupabase"); return w.client; }`,
  "@/lib/admin/console-reads": `export const adminCounts = ${read("adminCounts")};`,
  "@/lib/admin/data-reads": `export const heldChangeSets = ${read("heldChangeSets")}; export const lastPublishAndWaiting = ${read("lastPublishAndWaiting")};`,
  "@/lib/admin/health": `export const healthOverview = ${read("healthOverview")};`,
  "@/lib/admin/document-reads": `export const readCollisionIssues = ${read("readCollisionIssues")};`,
  "@/lib/admin/review-queue": `export const readQueueCounts = ${read("readQueueCounts")}; export const readQueue = ${read("readQueue")};`,
  "@/lib/admin/steward-reads": ["readDecisions", "readProposals", "readRuns", "readTodo"].map((n) => `export const ${n} = ${read(n)};`).join("\n"),
  "@/lib/jobs/runs": `export const loadJobsOverview = ${read("loadJobsOverview")};`,
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

const NOW = new Date("2026-11-10T12:00:00Z");

/** The Supabase client's direct reads (deletions, invitations, organizations): each table counts as one call. */
function client() {
  const chain = (table: string) => {
    const w = world();
    w.calls.push(`table:${table}`);
    const answer = w.fail.has(`table:${table}`) ? { data: null, count: null, error: { message: "down" } } : { data: w.tables[table] ?? [], count: (w.tables[table] ?? []).length, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "not", "order", "limit", "is", "gt", "lt", "eq"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve(answer);
    return q;
  };
  return { from: chain };
}

interface World {
  calls: string[];
  fail: Set<string>;
  answers: Record<string, unknown>;
  tables: Record<string, unknown[]>;
  memo: Map<unknown, Map<string, unknown>>;
  client: unknown;
}
const world = () => (globalThis as unknown as { __inbox: World }).__inbox;

function newRequest(fail: string[] = []) {
  const run = { key: "r1", mode: "run", started: "2026-11-09T09:00:00Z", finished: "2026-11-09T09:10:00Z", budget_usd: 5, spent_usd: 1, clusters: 0, issues: 0, proposals: 0, todo: 0, decisions: 0, audits: 0, stopped: null, request_id: null };
  (globalThis as unknown as { __inbox: World }).__inbox = {
    calls: [],
    fail: new Set(fail),
    memo: new Map(),
    client: client(),
    tables: { profiles: [{ id: "p1", display_name: "Sam", deleted_at: "2026-11-08T00:00:00Z" }], invitations_admin: [], organizations: [{ id: "o1" }, { id: "o2" }] },
    answers: {
      readDecisions: [{ key: "d1", question: "Which file?", recommends: "the newer one", answer: null, created: "2026-11-09T00:00:00Z" }],
      readProposals: [],
      readRuns: [run],
      readTodo: [],
      heldChangeSets: [],
      readCollisionIssues: [],
      lastPublishAndWaiting: { lastPublished: { id: 7, created_at: "2026-11-09T08:00:00Z", manifest: { colleges: 1893 } }, waiting: { count: 0, oldestAt: null } },
      adminCounts: { people: 40, households: 12 },
      healthOverview: { counts: { overall: { fresh: 1800, watch: 50, stale: 30, failing: 13 } } },
      loadJobsOverview: { rows: [] },
      readQueueCounts: { open: 21_977, accepted: 10, rejected: 3, newWeek: 412, newest: "2026-11-10T00:00:00Z" },
    },
  };
}

const reads = await import("../lib/admin/inbox-reads.ts");
const count = (name: string) => world().calls.filter((c) => c === name).length;

test("one request: the badge and the three panels read each source once, and one client", async () => {
  newRequest();
  // The layout's badge and the page's panels start together, as they do in a render.
  const [badge, needs, did, how] = await Promise.all([reads.needsYouCount(NOW), reads.loadNeedsYou(NOW), reads.loadStewardDid(NOW), reads.loadHowThingsAre(NOW)]);
  for (const name of ["readDecisions", "readProposals", "heldChangeSets", "readCollisionIssues", "lastPublishAndWaiting", "table:profiles", "table:invitations_admin", "readRuns", "readTodo", "loadJobsOverview", "adminCounts", "table:organizations", "readQueueCounts", "healthOverview"]) {
    assert.equal(count(name), 1, name);
  }
  assert.equal(count("adminSupabase"), 1, "one client per request");
  assert.equal(count("readQueue"), 0, "the tile never reads the whole queue");
  assert.equal(badge, 2, "the decision and the deletion");
  assert.equal(needs.decisions?.length, 1);
  assert.equal(needs.runs?.length, 1, "Needs you has the runs for its empty line");
  assert.equal(did.runs?.[0].key, "r1");
  assert.deepEqual(how.queue, { open: 21_977, newThisWeek: 412 }, "the tile from the counts");
  assert.deepEqual(how.counts, { people: 40, households: 12, organizations: 2 });
  assert.deepEqual(how.lastPublished, { id: 7, created_at: "2026-11-09T08:00:00Z", colleges: 1893 });
  assert.deepEqual(how.health, { fresh: 1800, watch: 50, stale: 30, failing: 13 });
});

test("the badge alone reads only the cheap seven: never To do, the jobs, the runs, or the queue", async () => {
  newRequest();
  assert.equal(await reads.needsYouCount(NOW), 2);
  for (const name of ["readTodo", "loadJobsOverview", "readRuns", "readQueueCounts", "readQueue", "healthOverview", "adminCounts"]) assert.equal(count(name), 0, name);
  assert.deepEqual(
    world().calls.filter((c) => c !== "adminSupabase").sort(),
    ["heldChangeSets", "lastPublishAndWaiting", "readCollisionIssues", "readDecisions", "readProposals", "table:invitations_admin", "table:profiles"],
  );
});

test("a new request reads again (the memo is per request, never across requests)", async () => {
  newRequest();
  await reads.needsYouCount(NOW);
  newRequest();
  await reads.needsYouCount(NOW);
  assert.equal(count("readDecisions"), 1, "counted in the second request's own world");
});

test("a failed source is null for every reader in the request and is not asked twice; the others still answer", async () => {
  newRequest(["readDecisions", "readQueueCounts", "loadJobsOverview"]);
  const errors: string[] = [];
  const realError = console.error;
  console.error = (msg: string) => void errors.push(msg);
  try {
    const [badge, needs, how] = await Promise.all([reads.needsYouCount(NOW), reads.loadNeedsYou(NOW), reads.loadHowThingsAre(NOW)]);
    assert.equal(badge, 1, "the deletion still counts");
    assert.equal(needs.decisions, null);
    assert.equal(needs.jobs, null);
    assert.equal(how.jobs, null);
    assert.equal(how.queue, null, "the tile says Couldn't read");
    assert.equal(needs.deletions?.length, 1);
    assert.equal(count("readDecisions"), 1, "the failure is shared, not retried");
    assert.equal(count("loadJobsOverview"), 1);
  } finally {
    console.error = realError;
  }
  assert.ok(errors.some((e) => /reading decisions failed/.test(e)));
  assert.ok(errors.some((e) => /reading the review queue failed/.test(e)));
});

test("the queue tile: counts that couldn't be read (null, the read model missing) are a soft failure, not zero", async () => {
  newRequest();
  world().answers.readQueueCounts = null;
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal((await reads.loadHowThingsAre(NOW)).queue, null);
  } finally {
    console.error = realError;
  }
  assert.equal(count("readQueue"), 0);
});

test("the badge is null only when none of its sources could be read", async () => {
  newRequest(["readDecisions", "readProposals", "heldChangeSets", "table:profiles", "table:invitations_admin"]);
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal(await reads.needsYouCount(NOW), null);
  } finally {
    console.error = realError;
  }
});
