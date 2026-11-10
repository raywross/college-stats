/**
 * The Jobs pages rendered (specs/product/admin-jobs.md "The pages"): the list with a Vercel job's stored run and a
 * GitHub job's run, the job page's schedules and history (housekeeping firings hidden unless asked), and both kinds
 * of run page; a non-admin is a 404 before anything is read; an unknown job or a run of another job is a 404. The
 * loaders, the admin check, and Next's pieces are stood in for, the way tests/admin-ops.test.mts does; everything
 * under lib/jobs that is pure runs for real. No network, no database. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "jobs-pages-"));

type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format: string; source: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult;
    load(url: string, context: unknown, next: (u: string, c: unknown) => LoadResult): LoadResult;
  }): void;
};
const stub = (code: string): ResolveResult => ({ url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true });
const NOT_FOUND = "const e=new Error('NEXT_HTTP_ERROR_FALLBACK;404');e.digest='NEXT_HTTP_ERROR_FALLBACK;404';throw e";
const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve("react")).href;
writeFileSync(join(tmp, "link.mjs"), `import React from ${JSON.stringify(reactUrl)};\nexport default ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);`);

interface World {
  admin: boolean;
  calls: string[];
  overview: () => unknown;
  storedRuns: (job: string) => unknown;
  storedRun: (job: string, id: number) => unknown;
  githubRuns: (job: { id: string }, limit: number) => unknown;
  githubRunDetail: (job: { id: string }, id: number) => unknown;
  /** What lib/admin/ops.ts loadRunNow returns (no credentials unless a test says otherwise). */
  runNow?: (workflow: string | undefined) => unknown;
  /** The Steward's reviews of a job's runs, by ref (lib/jobs/runs.ts reviewsOfRuns); none unless a test says so. */
  reviews?: (job: { id: string }, refs: readonly string[]) => Map<string, unknown>;
}
declare global {
  var __world: World;
}

const STUBS: Record<string, string> = {
  "server-only": "export {}",
  "next/navigation": `export function notFound(){${NOT_FOUND}}`,
  "next/server": "export async function connection(){}",
  // Request timing (lib/timing-server.ts): off in tests, so withTiming is the page's own work.
  "@/lib/timing-server": "export async function withTiming(label, fn){return fn()} export async function afterResponse(name, fn){return fn()}",
  "@/lib/admin/auth": "export async function requireAdmin(){globalThis.__world.calls.push('requireAdmin'); if(!globalThis.__world.admin){" + NOT_FOUND + "} return {userId:'admin-1'}}",
  "@/lib/jobs/runs":
    "const w=()=>globalThis.__world; export const RUNS_PAGE=30;" +
    "export async function loadJobsOverview(){w().calls.push('loadJobsOverview'); return w().overview()}" +
    "export async function storedRuns(job){w().calls.push('storedRuns'); return w().storedRuns(job)}" +
    "export async function storedRun(job,id){w().calls.push('storedRun'); return w().storedRun(job,id)}" +
    "export async function githubRuns(job,limit){w().calls.push('githubRuns'); return w().githubRuns(job,limit)}" +
    "export async function githubRunDetail(job,id){w().calls.push('githubRunDetail'); return w().githubRunDetail(job,id)}" +
    "export async function reviewsOfRuns(job,refs){return w().reviews ? w().reviews(job,refs) : new Map()}",
  // Run now (specs/product/admin-redesign.md: Operations folded into each job's page): no credentials here.
  "@/lib/admin/ops": "export async function loadRunNow(wf){const w=globalThis.__world; w.calls.push('loadRunNow'); return w.runNow ? w.runNow(wf) : {configured:null,runs:[],recent:[],cost:null}}",
  "@/app/admin/steward/jobs/actions": "export async function dispatchAction(){return {status:'idle'}}",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return stub(STUBS[specifier]);
    if (specifier === "next/link") return { url: pathToFileURL(join(tmp, "link.mjs")).href, shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
  // Node strips types from .ts itself; the pages and components are .tsx, so their JSX is compiled here (the real
  // components render, not stand-ins: the tests read the markup they produce).
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

const { JOBS, jobById } = await import("../lib/jobs/registry.ts");
const listPage = (await import("../app/admin/steward/jobs/page.tsx")).default as (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
const list = (query: Record<string, string> = {}) => listPage({ searchParams: Promise.resolve(query) });
const jobPage = (await import("../app/admin/steward/jobs/[job]/page.tsx")).default as (p: { params: Promise<{ job: string }>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
const runPage = (await import("../app/admin/steward/jobs/[job]/runs/[run]/page.tsx")).default as (p: { params: Promise<{ job: string; run: string }> }) => Promise<React.ReactElement>;

const NOW = Date.now();
const storedRow = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  job: "digests",
  trigger: "schedule",
  status: "ok",
  startedAt: "2026-11-01T13:00:03Z",
  finishedAt: "2026-11-01T13:00:45Z",
  durationMs: 42_000,
  httpStatus: 200,
  summary: { configured: true, publishes: [{ publish_id: 1, sent: 2 }] },
  error: null,
  ...extra,
});
const ghRun = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  workflow: "college-reported.yml",
  name: "College-reported data",
  title: "College-reported data",
  requestId: null,
  runNumber: id,
  event: "schedule",
  status: "completed",
  conclusion: "success",
  createdAt: "2026-11-02T13:02:00Z",
  startedAt: "2026-11-02T13:02:10Z",
  updatedAt: "2026-11-02T14:30:00Z",
  durationMs: 88 * 60_000,
  url: `https://github.com/raywross/college-stats/actions/runs/${id}`,
  actor: null,
  headBranch: "main",
  ...extra,
});

function world(over: Partial<World> = {}): World {
  const w: World = {
    admin: true,
    calls: [],
    overview: () => ({
      githubConfigured: true,
      rows: JOBS.map((job) => ({
        job,
        next: job.schedules.length ? new Date(NOW + 3_600_000) : null,
        last: job.id === "digests" ? { kind: "stored", run: storedRow(12) } : job.id === "college-reported" ? { kind: "github", run: ghRun(900) } : null,
      })),
    }),
    storedRuns: () => ({ ok: true, rows: [storedRow(12), storedRow(11, { status: "failed", error: "Reading publishes failed: timeout", httpStatus: 500 })] }),
    storedRun: (job, id) => (job === "digests" && id === 12 ? storedRow(12) : null),
    githubRuns: () => [
      ghRun(900), // the Monday 13:00 firing
      ghRun(901, { createdAt: "2026-11-02T13:31:00Z", startedAt: "2026-11-02T13:31:05Z", durationMs: 20_000 }), // a collect firing
      ghRun(902, { createdAt: "2026-11-02T14:01:00Z", startedAt: "2026-11-02T14:01:05Z", durationMs: 20_000 }), // a collect firing
      ghRun(903, { event: "workflow_dispatch", actor: "raywross", createdAt: "2026-11-01T10:00:00Z" }),
    ],
    githubRunDetail: (job, id) =>
      job.id === "college-reported" && id === 900
        ? {
            run: ghRun(900),
            jobs: [
              {
                id: 1,
                name: "run",
                status: "completed",
                conclusion: "success",
                startedAt: "2026-11-02T13:02:10Z",
                completedAt: "2026-11-02T14:30:00Z",
                url: "https://github.com/raywross/college-stats/actions/runs/900/job/1",
                steps: [
                  { number: 1, name: "Set up job", status: "completed", conclusion: "success", startedAt: "2026-11-02T13:02:10Z", completedAt: "2026-11-02T13:02:14Z" },
                  { number: 2, name: "Run the ingestion pipeline", status: "completed", conclusion: "success", startedAt: "2026-11-02T13:02:14Z", completedAt: "2026-11-02T14:29:00Z" },
                ],
              },
            ],
            changeSets: [{ id: 44, source: "college-reported", status: "applied" }],
          }
        : null,
    ...over,
  };
  globalThis.__world = w;
  return w;
}

const render = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const notFound = (p: Promise<unknown>) => assert.rejects(p, (e: Error & { digest?: string }) => e.digest === "NEXT_HTTP_ERROR_FALLBACK;404");

test("the list: scheduled jobs with their schedule in words, next run, and last run; hand-run jobs apart; names link to the job", async () => {
  const w = world();
  const html = await render(list({}));
  assert.deepEqual(w.calls, ["requireAdmin", "loadJobsOverview"]);
  assert.match(html, /Every day at 13:00 UTC/);
  assert.match(html, /Monday to Saturday at 23:00 UTC/);
  assert.match(html, /Sundays at 23:00 UTC/);
  assert.match(html, /The 3rd of every month at 09:00 UTC/);
  assert.doesNotMatch(html, /Every 30 minutes/); // the collect firing isn't a headline schedule
  assert.match(html, /href="\/admin\/steward\/jobs\/digests"/);
  assert.match(html, /href="\/admin\/steward\/jobs\/college-reported"/);
  assert.match(html, /Succeeded/);
  assert.match(html, /No run recorded/);
  assert.match(html, /in 1 h/);
  assert.match(html, /By hand only/);
  assert.match(html, /Run by hand/);
  assert.doesNotMatch(html, /GitHub credentials aren/);
  // The status line: nothing failed in this world; the tabs offer the all-jobs view.
  assert.match(html, /No job failed its last run\./);
  assert.match(html, /href="\/admin\/steward\/jobs\?view=all"/);
  assert.doesNotMatch(html, /bg-destructive\/5/);
});

const failedWorld = () =>
  world({
    overview: () => ({
      githubConfigured: true,
      rows: JOBS.map((job) => ({
        job,
        next: job.schedules.length ? new Date(NOW + 3_600_000) : null,
        last:
          job.id === "weekly"
            ? { kind: "stored", run: storedRow(30, { job: "weekly", status: "failed", error: "Reading students failed", httpStatus: 500 }) }
            : job.id === "identity-refresh"
              ? { kind: "github", run: ghRun(700, { workflow: "identity-refresh.yml", name: "Identity refresh", conclusion: "failure" }) }
              : job.id === "digests"
                ? { kind: "stored", run: storedRow(12) }
                : job.id === "visit-events"
                  ? { kind: "github", run: ghRun(701, { workflow: "visit-events.yml", name: "Visit events", status: "in_progress", conclusion: null, durationMs: null }) }
                  : null,
      })),
    }),
  });

test("the status line names each job whose last run failed, linking it, with the counts by state; failed rows are tinted in the schedule view", async () => {
  failedWorld();
  const html = await render(list());
  assert.match(html, /2 jobs failed their last run: /);
  assert.match(html, /<a href="\/admin\/steward\/jobs\/identity-refresh"[^>]*>Identity refresh<\/a><\/span><span>, <a href="\/admin\/steward\/jobs\/weekly"[^>]*>Weekly emails and texts<\/a><\/span>\./);
  assert.match(html, /text-destructive/);
  // Counts: 2 failed, 1 running, 1 ok, the rest never recorded.
  const counts = [...html.matchAll(/<span class="font-semibold tabular-nums">(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(counts, [2, 1, JOBS.length - 4, 0, 1]);
  assert.equal((html.match(/bg-destructive\/5/g) ?? []).length, 5); // the strip, and the two failed rows in the table and in the phone cards
  assert.match(html, /data-outcome="failed"/);
});

test("the all-jobs view: one table of every job, failed first, then running, never run, nothing to do, succeeded", async () => {
  failedWorld();
  const html = await render(list({ view: "all" }));
  assert.match(html, /aria-current="page"[^>]*>All jobs</);
  assert.doesNotMatch(html, /Run by hand<\/h2>/);
  assert.match(html, /Every job, failures first/);
  const order = [...html.matchAll(/<tr data-outcome="(\w+)"/g)].map((m) => m[1]);
  assert.equal(order.length, JOBS.length);
  assert.deepEqual(order.slice(0, 3), ["failed", "failed", "running"]);
  assert.equal(order.at(-1), "ok");
  const names = [...html.matchAll(/<th scope="row"[^>]*><a href="\/admin\/steward\/jobs\/([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.slice(0, 3), ["identity-refresh", "weekly", "visit-events"]); // failed by name, then running
  assert.equal(names.at(-1), "digests");
});

test("the list without GitHub credentials says so and still shows every schedule", async () => {
  world({ overview: () => ({ githubConfigured: false, rows: JOBS.map((job) => ({ job, next: job.schedules.length ? new Date(NOW + 60_000) : null, last: null })) }) });
  const html = await render(list());
  assert.match(html, /GitHub credentials aren/);
  assert.match(html, /Every day at 06:00 UTC/);
});

test("a Vercel job's page: the route, next run, how to start it, each schedule with its cron, and the stored runs with their counts", async () => {
  const w = world();
  const html = await render(jobPage({ params: Promise.resolve({ job: "digests" }), searchParams: Promise.resolve({}) }));
  assert.deepEqual(w.calls, ["requireAdmin", "storedRuns"]);
  assert.match(html, /Vercel Cron, at its own web route/);
  assert.match(html, /Its own web route, called with the cron secret/);
  assert.match(html, /<summary[^>]*>Details<\/summary><code[^>]*>\/api\/cron\/digests<\/code>/, "the route sits under Details");
  assert.match(html, /<summary[^>]*>Details<\/summary><code[^>]*>POST \/api\/cron\/digests<\/code>/);
  assert.match(html, /0 13 \* \* \*/);
  assert.match(html, /Does nothing until email sending is configured/);
  assert.match(html, /href="\/admin\/steward\/jobs\/digests\/runs\/12"/);
  assert.match(html, /publishes 1/);
  assert.match(html, /Failed/);
  assert.match(html, /Reading publishes failed/);
  assert.match(html, /Schedule/); // the trigger
});

test("a Vercel job's page when the table can't be read says why instead of crashing", async () => {
  world({ storedRuns: () => ({ ok: false, reason: 'relation "public.job_runs" does not exist' }) });
  const html = await render(jobPage({ params: Promise.resolve({ job: "weekly" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /role="alert"/);
  assert.match(html, /does not exist/);
  assert.match(html, /migration that adds the jobs(?:&#x27;|')? run history may not be applied/);
});

test("a GitHub job's page: the workflow, Run now as the way to start it, every schedule with its note, housekeeping firings hidden unless ?all=1", async () => {
  const w = world();
  const html = await render(jobPage({ params: Promise.resolve({ job: "college-reported" }), searchParams: Promise.resolve({}) }));
  assert.deepEqual(w.calls, ["requireAdmin", "loadRunNow", "githubRuns"]);
  assert.match(html, /GitHub Actions, as its own workflow/);
  assert.match(html, /<summary[^>]*>Details<\/summary><code[^>]*>college-reported\.yml<\/code>/);
  assert.match(html, /href="#run-now"/);
  assert.match(html, /id="run-now"/);
  assert.match(html, /GitHub credentials aren&#x27;t set on this deployment/, "no credentials: Run now says what to set, and offers no form");
  assert.match(html, /Mondays at 13:00 UTC/);
  assert.match(html, /The 1st of every month at 13:00 UTC/);
  assert.match(html, /Every 30 minutes/);
  assert.match(html, /Housekeeping: not counted/);
  assert.match(html, /August to November/);
  // History: the Monday run and the hand-started run show; the two collect firings are hidden and counted.
  assert.match(html, /href="\/admin\/steward\/jobs\/college-reported\/runs\/900"/);
  assert.match(html, /href="\/admin\/steward\/jobs\/college-reported\/runs\/903"/);
  assert.doesNotMatch(html, /runs\/901"/);
  assert.doesNotMatch(html, /runs\/902"/);
  assert.match(html, /2 housekeeping firings hidden among the newest 4/);
  assert.match(html, /Schedule: Mondays at 13:00 UTC/);
  assert.match(html, /GitHub, raywross/);

  const all = await render(jobPage({ params: Promise.resolve({ job: "college-reported" }), searchParams: Promise.resolve({ all: "1" }) }));
  assert.match(all, /runs\/901"/);
  assert.match(all, /Schedule: Every 30 minutes/);
  assert.match(all, /Hide them/);
});

test("Run now on a job's page (formerly Operations): a form per run of its workflow, the running one shown instead of its button, ?unit= prefilled", async () => {
  const { DISPATCHABLE_RUNS } = await import("../lib/admin/workflows.ts");
  const runs = DISPATCHABLE_RUNS.filter((r) => !r.hidden && r.workflow === "college-reported.yml");
  const running = ghRun(950, { status: "in_progress", conclusion: null, runNumber: 51, url: "https://github.com/raywross/college-stats/actions/runs/950" });
  world({ runNow: (wf) => (wf === "college-reported.yml" ? { configured: { mode: "app" }, runs, recent: [running], cost: null } : null) });
  const html = await render(jobPage({ params: Promise.resolve({ job: "college-reported" }), searchParams: Promise.resolve({ unit: "999001" }) }));
  const guarded = runs.filter((r) => r.guards.oneAtATime);
  assert.ok(runs.length > 1, "college-reported has several runs: one college, the pilot, all, collect");
  assert.equal((html.match(/is already in progress/g) ?? []).length, guarded.length, "a guarded run shows the running run instead of its form");
  assert.match(html, /Run #51 on GitHub/);
  assert.match(html, /the Quad console GitHub App/);
  for (const r of runs) assert.match(html, new RegExp(r.label.replace(/'/g, "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${r.label} is listed`);

  world({ runNow: () => ({ configured: { mode: "pat" }, runs, recent: [], cost: null }) });
  const free = await render(jobPage({ params: Promise.resolve({ job: "college-reported" }), searchParams: Promise.resolve({ unit: "999001" }) }));
  assert.doesNotMatch(free, /is already in progress/);
  assert.match(free, /<details open=""[^>]*>[\s\S]*?Re-read one college/, "?unit= opens the college run");
  assert.match(free, /value="999001"/, "and fills the unit in");
});

test("a hand-run workflow's page has no schedule and links GitHub's Run workflow", async () => {
  world({ githubRuns: () => [] });
  const html = await render(jobPage({ params: Promise.resolve({ job: "eval-reviewer" }), searchParams: Promise.resolve({}) }));
  assert.match(html, /No schedule: this job runs only when a person starts it/);
  assert.match(html, /actions\/workflows\/eval-reviewer.yml/);
  assert.match(html, /GitHub lists no runs of this workflow/);
});

test("a stored run's page: outcome, who started it, timing, and the summary's keys; an error is shown in full", async () => {
  const w = world();
  const html = await render(runPage({ params: Promise.resolve({ job: "digests", run: "12" }) }));
  assert.deepEqual(w.calls, ["requireAdmin", "storedRun"]);
  assert.match(html, /Update digest: run 12/);
  assert.match(html, /Vercel Cron, on the schedule/);
  assert.match(html, /42 s/);
  assert.match(html, /publishes/);
  assert.match(html, /publish_id/); // nested values shown as stored
  assert.doesNotMatch(html, /<pre/); // no error block

  world({ storedRun: () => storedRow(11, { status: "failed", error: "Reading publishes failed: timeout", httpStatus: 500, trigger: "manual" }) });
  const failed = await render(runPage({ params: Promise.resolve({ job: "digests", run: "11" }) }));
  assert.match(failed, /<pre[^>]*>Reading publishes failed: timeout<\/pre>/);
  assert.match(failed, /A person, with the cron secret/);
});

test("a GitHub run's page: the schedule that fired it, each job's steps with outcome and duration, the change set it wrote, the GitHub link", async () => {
  const w = world();
  const html = await render(runPage({ params: Promise.resolve({ job: "college-reported", run: "900" }) }));
  assert.deepEqual(w.calls, ["requireAdmin", "githubRunDetail"]);
  assert.match(html, /College-reported data: run #900/);
  assert.match(html, /Schedule: Mondays at 13:00 UTC/);
  assert.match(html, /Run the ingestion pipeline/);
  assert.match(html, /1 h 27 min/);
  assert.match(html, /href="\/admin\/data\/changes\/44"/);
  assert.match(html, /actions\/runs\/900"/);
  assert.match(html, /Open on GitHub/);
});

test("404s: a non-admin before anything is read; an unknown job; a malformed or foreign run id; a run the loader doesn't know", async () => {
  const w = world({ admin: false });
  await notFound(list());
  await notFound(jobPage({ params: Promise.resolve({ job: "digests" }), searchParams: Promise.resolve({}) }));
  await notFound(runPage({ params: Promise.resolve({ job: "digests", run: "12" }) }));
  assert.deepEqual(w.calls, ["requireAdmin", "requireAdmin", "requireAdmin"]);

  const ok = world();
  await notFound(jobPage({ params: Promise.resolve({ job: "nope" }), searchParams: Promise.resolve({}) }));
  await notFound(jobPage({ params: Promise.resolve({ job: "../etc" }), searchParams: Promise.resolve({}) }));
  await notFound(runPage({ params: Promise.resolve({ job: "digests", run: "12abc" }) }));
  await notFound(runPage({ params: Promise.resolve({ job: "digests", run: "13" }) })); // not this job's
  await notFound(runPage({ params: Promise.resolve({ job: "college-reported", run: "12" }) })); // not this workflow's
  assert.ok(!ok.calls.includes("loadJobsOverview"));
  assert.ok(jobById("digests"));
});

/* The Steward's job review (specs/product/admin-redesign.md "What the Steward reviews"). */
const flaggedReview = { key: "digests:12", job: "digests", run_ref: "12", verdict: "flagged", reasons: ["It did nothing on a scheduled run: its counts (publishes) were all zero."], repair: null, repaired: false, note: "No digest went out though two publishes changed followed colleges.", created: "2026-11-01T13:05:00Z", run_started: "2026-11-01T13:00:03Z" };

test("the Jobs list's Steward column: the verdict in words with its help, the note, and Not reviewed yet for the rest", async () => {
  const base = world();
  const overview = base.overview() as { githubConfigured: boolean; rows: { job: { id: string }; review?: unknown }[] };
  for (const row of overview.rows) if (row.job.id === "digests") row.review = { review: flaggedReview, ofLastRun: true };
  world({ overview: () => overview });
  const html = await render(list());
  assert.match(html, />Steward</);
  assert.match(html, />Flagged</);
  assert.match(html, /No digest went out though two publishes changed followed colleges\./);
  assert.match(html, /Not reviewed yet/);
  assert.match(html, /aria-label="What is The Steward&#x27;s reading\?"/, "the verdict chip carries its help");
});

test("a run's page shows the Steward's reading: the verdict, the note, every reason, and the repair; none says it wasn't reviewed", async () => {
  world({ reviews: (job, refs) => new Map(job.id === "digests" && refs.includes("12") ? [["digests:12", { ...flaggedReview, repair: "restart", repaired: true }]] : []) });
  const html = await render(runPage({ params: Promise.resolve({ job: "digests", run: "12" }) }));
  assert.match(html, /The Steward&#x27;s reading/);
  assert.match(html, />Flagged</);
  assert.match(html, /No digest went out/);
  assert.match(html, /its counts \(publishes\) were all zero/);
  assert.match(html, /Started it again/);
  world();
  const none = await render(runPage({ params: Promise.resolve({ job: "digests", run: "12" }) }));
  assert.match(none, /The Steward hasn&#x27;t reviewed this run/);
});
