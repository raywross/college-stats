/**
 * GitHub off the response path (lib/jobs/github-memo.ts latestGithubRuns, wired in lib/jobs/runs.ts;
 * specs/product/admin-speed.md wave 1, fix 6): the newest run of each GitHub workflow, memoized per server instance
 * for a minute. The first call waits and concurrent
 * first calls share it; within the minute no GitHub call; after it the stale answer comes back at once and one refresh
 * runs after the response; a failed refresh keeps what the memo had; a dispatch drops the memo. Runs the real module
 * with a fake listRuns, a fake clock, and a fake scheduler. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const STUBS: Record<string, string> = {
  "server-only": "export {}",
  // Outside a request after() throws; the module then refreshes in the background. The tests pass their own scheduler.
  "next/server": "export function after(){throw new Error('outside a request')} export async function connection(){}",
  "@/lib/admin/people": "export async function adminSupabase(){throw new Error('no database in this test')}",
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

globalThis.fetch = (() => {
  throw new Error("network call in a test");
}) as typeof fetch;

const runs = await import("../lib/jobs/github-memo.ts");
type WorkflowRun = import("../lib/github-app.ts").WorkflowRun;

const WORKFLOWS = ["college-reported.yml", "publish.yml"];
const run = (id: number, workflow: string) => ({ id, workflow, status: "completed", conclusion: "success", createdAt: `2026-11-10T00:00:${String(id).padStart(2, "0")}Z` }) as unknown as WorkflowRun;

/** A fake GitHub: counts calls, answers each workflow's newest run from `latest`, optionally slowly or failing. */
function fakeGithub() {
  const state = { calls: 0, latest: new Map<string, WorkflowRun | null>(WORKFLOWS.map((w, i) => [w, run(i + 1, w)])), fail: false, gate: null as Promise<void> | null };
  const listRuns = async (opts: { workflows: string[] }) => {
    state.calls++;
    // What GitHub says is fixed when the call is made; the gate (if any) only delays the answer.
    const gate = state.gate;
    const fail = state.fail;
    const r = state.latest.get(opts.workflows[0]);
    if (gate) await gate;
    if (fail) return []; // lib/github-app.ts listRuns answers an empty list when GitHub fails; it never throws
    return r ? [r] : [];
  };
  return { state, listRuns };
}

function world() {
  runs.resetJobsMemo();
  const gh = fakeGithub();
  const clock = { now: 1_000_000 };
  const scheduled: (() => Promise<void>)[] = [];
  const deps = { listRuns: gh.listRuns, now: () => clock.now, schedule: (task: () => Promise<void>) => void scheduled.push(task) };
  return { gh, clock, scheduled, deps };
}

test("the first call waits for GitHub; a second within the minute makes no GitHub call", async () => {
  const { gh, clock, scheduled, deps } = world();
  const first = await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(gh.state.calls, WORKFLOWS.length, "one call per workflow on the first fill");
  assert.equal(first.get("publish.yml")?.id, 2);
  clock.now += runs.GITHUB_MEMO_MS - 1;
  const second = await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(gh.state.calls, WORKFLOWS.length, "no GitHub call within the minute");
  assert.equal(second.get("publish.yml")?.id, 2);
  assert.equal(scheduled.length, 0, "nothing to refresh yet");
});

test("concurrent first calls share one fill", async () => {
  const { gh, deps } = world();
  let open!: () => void;
  gh.state.gate = new Promise((r) => (open = r));
  const a = runs.latestGithubRuns(WORKFLOWS, deps);
  const b = runs.latestGithubRuns(WORKFLOWS, deps);
  open();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(gh.state.calls, WORKFLOWS.length, "the second caller awaited the first's fill");
  assert.equal(ra, rb);
});

test("after the minute: the stale memo answers at once, one refresh is scheduled after the response, and its answer serves the next call", async () => {
  const { gh, clock, scheduled, deps } = world();
  await runs.latestGithubRuns(WORKFLOWS, deps);
  gh.state.latest.set("publish.yml", run(9, "publish.yml"));
  clock.now += runs.GITHUB_MEMO_MS;
  let open!: () => void;
  gh.state.gate = new Promise((r) => (open = r)); // GitHub is slow: the page must not wait for it
  const stale = await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(stale.get("publish.yml")?.id, 2, "the stale answer, without waiting");
  assert.equal(scheduled.length, 1, "one refresh, after the response");
  assert.equal(gh.state.calls, WORKFLOWS.length, "not started on the response path");
  const refreshing = scheduled[0]();
  await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(scheduled.length, 1, "no second refresh while one runs");
  open();
  await refreshing;
  assert.equal(gh.state.calls, WORKFLOWS.length * 2);
  const fresh = await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(fresh.get("publish.yml")?.id, 9);
  assert.equal(scheduled.length, 1, "fresh again: nothing more to refresh");
});

test("a failed refresh keeps the old memo", async () => {
  const { gh, clock, scheduled, deps } = world();
  await runs.latestGithubRuns(WORKFLOWS, deps);
  gh.state.fail = true;
  clock.now += runs.GITHUB_MEMO_MS;
  await runs.latestGithubRuns(WORKFLOWS, deps);
  await scheduled[0]();
  const after = await runs.latestGithubRuns(WORKFLOWS, deps);
  assert.equal(after.get("college-reported.yml")?.id, 1, "GitHub answered nothing: the run the memo had stays");
  assert.equal(after.get("publish.yml")?.id, 2);
});

test("a listRuns that throws never reaches the page", async () => {
  const { deps } = world();
  const out = await runs.latestGithubRuns(WORKFLOWS, { ...deps, listRuns: async () => Promise.reject(new Error("boom")) });
  assert.equal(out.get("publish.yml"), null);
});

test("resetJobsMemo (after a dispatch) makes the next call ask GitHub, and a refresh that started before it doesn't overwrite the newer answer", async () => {
  const { gh, scheduled, clock, deps } = world();
  await runs.latestGithubRuns(WORKFLOWS, deps);
  clock.now += runs.GITHUB_MEMO_MS;
  let open!: () => void;
  gh.state.gate = new Promise((r) => (open = r));
  await runs.latestGithubRuns(WORKFLOWS, deps);
  const old = scheduled[0](); // a refresh in flight, from before the dispatch: it will answer the old run, late
  runs.resetJobsMemo();
  gh.state.gate = null;
  gh.state.latest.set("publish.yml", run(42, "publish.yml"));
  assert.equal((await runs.latestGithubRuns(WORKFLOWS, deps)).get("publish.yml")?.id, 42, "after a reset, the next call waits for GitHub");
  open();
  await old; // the late refresh answers run 2
  assert.equal(gh.state.calls, WORKFLOWS.length * 3);
  assert.equal((await runs.latestGithubRuns(WORKFLOWS, deps)).get("publish.yml")?.id, 42, "the older refresh didn't overwrite it");
});

test("static: the Jobs overview reads GitHub through the memo; the dispatch actions drop it; the run pages still ask GitHub", () => {
  const src = read("lib/jobs/runs.ts");
  const overview = src.slice(src.indexOf("export async function loadJobsOverview"), src.indexOf("async function attachReviews"));
  assert.match(overview, /latestGithubRuns\(githubWorkflows\(\)\)/);
  assert.doesNotMatch(overview, /gh\.listRuns\(/, "the overview never calls GitHub directly");
  assert.match(src, /after\(task\)/, "the refresh runs after the response");
  assert.match(src, /schedule: scheduleAfterResponse/);
  assert.match(read("lib/jobs/github-memo.ts"), /export const GITHUB_MEMO_MS = 60_000;/);
  assert.doesNotMatch(read("lib/jobs/github-memo.ts"), /from "next\/|^import \{[^}]*\} from "@\/lib\/github-app"/m, "the memo loads neither Next nor the GitHub client");
  const actions = read("app/admin/steward/jobs/actions.ts");
  const finish = actions.slice(actions.indexOf("function finish"), actions.indexOf("export async function dispatchAction"));
  assert.match(finish, /resetJobsMemo\(\);\s*refresh\(\);/);
  assert.match(actions, /import \{ resetJobsMemo \} from "@\/lib\/jobs\/github-memo";/);
  assert.match(src, /export async function githubRuns[\s\S]*gh\.listRuns\(/, "a job's page lists its runs from GitHub");
  assert.match(src, /export async function githubRunDetail[\s\S]*gh\.getRun\(/);
});
