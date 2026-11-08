/**
 * The Steward's `review` mode (specs/product/admin-redesign.md "What the Steward reviews"): one job run read, compared
 * with its job's expectations by lib/steward/job-review.ts `reviewRun`, and written as a `steward.reviews` document.
 * For a flagged or failed run, one Haiku 4.5 call writes a sentence for a person (at most $0.10 a run, $3 a week in all
 * reviews, inside the week's $40), and a finding (`steward.issues`, kind `job`, `job|<job id>`) goes to the console.
 *
 * The repairs are fixed tools, and only these (`repairTools`):
 * - `dispatch_workflow`: start a restartable job's own workflow again (once in 24 hours, by the review's rule), or the
 *   publisher (`publish-snapshot.yml`). Anything else is refused. A restartable Vercel job is started again by calling
 *   its own route with the cron secret, when the workflow has `CRON_SECRET` and `SITE_URL`; without them the restart is
 *   recorded as wanted and not done.
 * - `leave_finding`: a finding on a held change (`change|<id>`, kind `job`), so the held change reaches the Inbox.
 * Each repair is noted `steward.repair: …` through the writer's notes, which go on the run's change set.
 *
 * Reads: a Vercel job's `job_runs` row, and the changes a workflow run wrote and the first publish after it, through the
 * data project's Supabase client; a workflow run and its steps through GitHub's API with the Actions token. All of it is
 * injectable (`ReviewSources`, `RepairTools`), and `--run-file` gives a recorded run for dry runs and tests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { JOBS, type JobDef } from "../../../lib/jobs/registry.ts";
import { expectationLines, githubStatus, githubTrigger, repairLine, reviewKey, type JobReview, type ReviewContext, type RunStepView, type RunView } from "../../../lib/steward/job-review.ts";
import type { Finding, IssueDoc, ReviewDoc } from "../../../lib/steward/types.ts";
import { COLLECTIONS } from "../data-platform/layers.mts";
import type { DataStore, Env } from "../data-platform/store.mts";
import { BudgetStop, tokensOf, type Budget } from "./budget.mts";
import { STEWARD_MODELS } from "./models.mts";
import type { StewardWriter } from "./writer.mts";

/** The model that writes a review's note (Haiku 4.5: one sentence from facts given, no documents). */
export const REVIEW_MODEL = STEWARD_MODELS.line;
export const REVIEW_MAX_TOKENS = 200;
/** A job finding keeps this many runs' findings, newest last. */
export const JOB_FINDINGS_KEPT = 20;

/** The workflow files `dispatch_workflow` may start: the restartable GitHub jobs' own, and the publisher. */
export const REPAIR_WORKFLOWS: ReadonlySet<string> = new Set([
  ...JOBS.filter((j) => j.runner === "github" && j.workflow && j.expects?.restartable).map((j) => j.workflow!),
  "publish-snapshot.yml",
]);
export const PUBLISHER_WORKFLOW = "publish-snapshot.yml";

/* ------------------------------------------------------------------ */
/* Reading the run                                                     */
/* ------------------------------------------------------------------ */

export interface ReviewSources {
  /** The run as the review reads it, or null when there is no such run of this job. */
  run(job: JobDef, ref: string): Promise<RunView | null>;
  /** The first publish at or after `after` (ISO): its time, null for none yet, undefined when it can't be read. */
  publishAfter(after: string): Promise<string | null | undefined>;
}

/** The parts of a Supabase client the sources use (tests pass a fake). */
export interface ReviewDb {
  from(table: string): {
    select(cols: string): ReviewQuery;
  };
}
interface ReviewQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(col: string, v: unknown): ReviewQuery;
  gte(col: string, v: unknown): ReviewQuery;
  order(col: string, o: { ascending: boolean }): ReviewQuery;
  limit(n: number): ReviewQuery;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export const GITHUB_API = "https://api.github.com";
export const DEFAULT_REPO = "raywross/college-stats";

function githubHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "quad-steward" };
}

interface RawGithubRun {
  id: number;
  path?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  run_started_at?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}
interface RawGithubJobs {
  jobs?: { name?: string; steps?: { name?: string; conclusion?: string | null }[] }[];
}

/** A workflow run and its jobs as a `RunView` (the changes are added by the caller). Exported for tests. */
export function githubRunView(run: RawGithubRun, jobs: RawGithubJobs): RunView {
  const steps: RunStepView[] = [];
  for (const j of jobs.jobs ?? []) for (const s of j.steps ?? []) steps.push({ job: j.name ?? undefined, name: s.name ?? "", conclusion: s.conclusion ?? null });
  const status = githubStatus(run.status ?? "", run.conclusion ?? null);
  return {
    ref: String(run.id),
    trigger: githubTrigger(run.event ?? ""),
    status,
    startedAt: run.run_started_at ?? run.created_at ?? "",
    finishedAt: status === "running" ? null : (run.updated_at ?? null),
    steps,
    url: run.html_url ?? null,
  };
}

interface RawStoredRun {
  id: number;
  job: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: unknown;
  error: string | null;
}

/** A `job_runs` row as a `RunView`. Exported for tests. */
export function storedRunView(r: RawStoredRun): RunView {
  const status = r.status === "ok" || r.status === "failed" || r.status === "skipped" ? r.status : "running";
  return {
    ref: String(r.id),
    trigger: r.trigger === "schedule" ? "schedule" : "manual",
    status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary && typeof r.summary === "object" && !Array.isArray(r.summary) ? (r.summary as Record<string, unknown>) : {},
    error: r.error,
  };
}

/** The real sources: the data project's client and GitHub's API with the Actions token. */
export function liveSources(o: { db: () => Promise<ReviewDb>; env: Env; fetch?: FetchLike }): ReviewSources {
  const fetchFn: FetchLike = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const token = o.env.GH_TOKEN || o.env.GITHUB_TOKEN || "";
  const repo = o.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const gh = async <T,>(path: string): Promise<T | null> => {
    if (!token) throw new Error("reading a workflow run needs GH_TOKEN (the Actions token)");
    const res = await fetchFn(`${GITHUB_API}/repos/${repo}${path}`, { headers: githubHeaders(token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return (await res.json()) as T;
  };
  return {
    async run(job, ref) {
      if (!/^\d{1,20}$/.test(ref)) throw new Error(`--run ${ref}: a run id is digits`);
      const db = await o.db();
      if (job.runner === "vercel") {
        const { data, error } = await db.from("job_runs").select("id, job, trigger, status, started_at, finished_at, summary, error").eq("job", job.id).eq("id", Number(ref)).limit(1);
        if (error) throw new Error(`reading job_runs: ${error.message}`);
        const row = (data as RawStoredRun[] | null)?.[0];
        return row ? storedRunView(row) : null;
      }
      const run = await gh<RawGithubRun>(`/actions/runs/${ref}`);
      if (!run || !(run.path ?? "").endsWith(`/${job.workflow}`)) return null;
      const jobs = (await gh<RawGithubJobs>(`/actions/runs/${ref}/jobs?filter=latest&per_page=100`)) ?? {};
      const view = githubRunView(run, jobs);
      const { data, error } = await db.from("data_change_sets").select("id, source, status, held_reason").eq("run_ref", ref).order("id", { ascending: true }).limit(50);
      view.changeSets = error ? undefined : ((data ?? []) as RunView["changeSets"]);
      return view;
    },
    async publishAfter(after) {
      try {
        const db = await o.db();
        const { data, error } = await db.from("data_snapshots").select("created_at").eq("status", "published").gte("created_at", after).order("created_at", { ascending: true }).limit(1);
        if (error) return undefined;
        return ((data as { created_at: string }[] | null)?.[0]?.created_at as string | undefined) ?? null;
      } catch {
        return undefined;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* The fixed repair tools                                              */
/* ------------------------------------------------------------------ */

export type ToolResult = { ok: true } | { ok: false; reason: string };

/** How the repairs reach the world (tests pass fakes; a dry run sends nothing). */
export interface RepairTools {
  /** POST a workflow_dispatch on main. */
  dispatchWorkflow(file: string, inputs: Record<string, string>): Promise<ToolResult>;
  /** POST a Vercel job's own route with the cron secret. */
  callRoute(path: string): Promise<ToolResult>;
}

/** The live tools: GitHub with the Actions token (actions: write), the site with CRON_SECRET and SITE_URL. */
export function liveTools(o: { env: Env; fetch?: FetchLike }): RepairTools {
  const fetchFn: FetchLike = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
  return {
    async dispatchWorkflow(file, inputs) {
      const token = o.env.GH_TOKEN || o.env.GITHUB_TOKEN;
      if (!token) return { ok: false, reason: "no GH_TOKEN to dispatch with" };
      const repo = o.env.GITHUB_REPOSITORY || DEFAULT_REPO;
      try {
        const res = await fetchFn(`${GITHUB_API}/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
          method: "POST",
          headers: { ...githubHeaders(token), "content-type": "application/json" },
          body: JSON.stringify({ ref: "main", inputs }),
        });
        return res.status === 204 ? { ok: true } : { ok: false, reason: `GitHub answered ${res.status}` };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
    async callRoute(path) {
      const secret = o.env.CRON_SECRET;
      const site = o.env.SITE_URL;
      if (!secret || !site) return { ok: false, reason: "the workflow has no CRON_SECRET and SITE_URL to call a Vercel job with" };
      try {
        const res = await fetchFn(`${site.replace(/\/$/, "")}${path}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "user-agent": "quad-steward" } });
        return res.ok ? { ok: true } : { ok: false, reason: `the route answered ${res.status}` };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** A dry run's tools: nothing leaves the process. */
export const DRY_TOOLS: RepairTools = {
  dispatchWorkflow: async () => ({ ok: false, reason: "a dry run sends nothing" }),
  callRoute: async () => ({ ok: false, reason: "a dry run sends nothing" }),
};

/**
 * `dispatch_workflow`, restricted: a restart only of the job's own workflow when the job is restartable, the publisher
 * only for a publish. Returns the refusal, or null when allowed. Exported for tests.
 */
export function dispatchRefusal(job: JobDef, purpose: "restart" | "publish", file: string): string | null {
  if (!REPAIR_WORKFLOWS.has(file)) return `${file} is not a workflow the Steward may start`;
  if (purpose === "publish") return file === PUBLISHER_WORKFLOW ? null : "a publish starts only the publisher";
  if (!job.expects?.restartable) return `${job.name} isn't safe to start again on its own`;
  if (file !== job.workflow) return "a restart starts only the job's own workflow";
  return null;
}

/** Carries out a review's repair; returns whether it was done and the note line. */
export async function performRepair(
  o: { job: JobDef; run: RunView; review: JobReview; tools: RepairTools; writer: StewardWriter; store: DataStore },
): Promise<{ repaired: boolean; line: string | null }> {
  const { job, run, review, tools, writer } = o;
  if (!review.repair) return { repaired: false, line: null };
  let result: ToolResult;
  if (review.repair === "hold-finding") {
    const held = (run.changeSets ?? []).filter((c) => c.status === "held");
    for (const c of held) await leaveFinding(writer, job, run, c);
    result = held.length ? { ok: true } : { ok: false, reason: "no held change" };
  } else if (review.repair === "publish") {
    const refused = dispatchRefusal(job, "publish", PUBLISHER_WORKFLOW);
    result = refused ? { ok: false, reason: refused } : await tools.dispatchWorkflow(PUBLISHER_WORKFLOW, {});
  } else if (job.runner === "github") {
    const refused = dispatchRefusal(job, "restart", job.workflow ?? "");
    result = refused ? { ok: false, reason: refused } : await tools.dispatchWorkflow(job.workflow!, {});
  } else {
    result = job.expects?.restartable && job.path ? await tools.callRoute(job.path) : { ok: false, reason: `${job.name} isn't safe to start again on its own` };
  }
  const line = `steward.repair: ${review.repair} for ${job.id} run ${run.ref}: ${result.ok ? "done" : `not done (${result.reason})`}`;
  writer.note(line);
  return { repaired: result.ok, line };
}

/** `leave_finding`: a finding on a held change the run wrote, so it reaches the Inbox with the Steward's words. */
export async function leaveFinding(writer: StewardWriter, job: JobDef, run: RunView, change: { id: number; held_reason?: string | null; source: string }): Promise<IssueDoc> {
  return writer.writeIssue({
    key: `change|${change.id}`,
    kind: "job",
    family: job.id,
    hypothesis: `${job.name} wrote change #${change.id}, and it is held${change.held_reason?.trim() ? `: ${change.held_reason.trim().slice(0, 300)}` : "."} A held change stops every publish until a person publishes past it or undoes it.`,
    findings: [jobFinding(run, `Change #${change.id} (${change.source}) is held.`)],
    status: "new",
  });
}

function jobFinding(run: RunView, shows: string): Finding {
  return { unit_id: "", edition: null, sha256: null, url: run.url ?? null, page: null, line: null, shows: shows.slice(0, 500) };
}

/** The job's finding (`job|<job id>`): the latest note, with each flagged or failed run's line kept (the last 20). */
export async function writeJobIssue(store: DataStore, writer: StewardWriter, job: JobDef, run: RunView, review: JobReview, note: string | null): Promise<IssueDoc> {
  const key = `job|${job.id}`;
  const before = await store.readOne<IssueDoc>(COLLECTIONS.steward.issues, key);
  const line = `Run ${run.ref}, ${run.startedAt.slice(0, 16).replace("T", " ")} UTC: ${review.verdict}. ${review.reasons.join(" ")}`;
  return writer.writeIssue({
    key,
    kind: "job",
    family: job.id,
    hypothesis: note ?? review.reasons.join(" "),
    findings: [...(before?.findings ?? []), jobFinding(run, line)].slice(-JOB_FINDINGS_KEPT),
    status: "new",
  });
}

/* ------------------------------------------------------------------ */
/* The note                                                            */
/* ------------------------------------------------------------------ */

export const NOTE_SYSTEM =
  "You write one sentence for the admin of a college-data website about one run of a batch job that failed or that a review flagged. " +
  "Say what went wrong and what a person should look at first, in plain words, from the facts given only. " +
  "No code names, no markdown, no greeting; at most 40 words.";

/** The facts the note is written from. Exported for tests (the dry run's recorded answer is keyed by them). */
export function notePrompt(job: JobDef, run: RunView, review: JobReview): string {
  const took = run.finishedAt ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000) : null;
  const repair = repairLine({ repair: review.repair, repaired: false });
  return [
    `Job: ${job.name}. ${job.description}`,
    `Expected: ${expectationLines(job).join(" ")}`,
    `The run: ${run.status}; started ${run.startedAt} by ${run.trigger === "schedule" ? "its schedule" : run.trigger === "pipeline" ? "another workflow" : "a person or the console"}${took !== null ? `; took ${took} seconds` : ""}.`,
    `The review found: ${review.reasons.join(" ")}`,
    `The repair the Steward may make: ${repair ? repair.replace(/^Wanted to: /, "").replace(/ \(not done\)$/, "") : "none"}.`,
  ].join("\n");
}

/** One Haiku call for the note, inside the budget; null when the budget refuses it or no client is available. */
export async function writeNote(client: Anthropic | null, budget: Budget, job: JobDef, run: RunView, review: JobReview, log: (l: string) => void): Promise<string | null> {
  if (!client) {
    log("review: no model client (no ANTHROPIC_API_KEY); the review has no note");
    return null;
  }
  const prompt = notePrompt(job, run, review);
  try {
    budget.ensure(REVIEW_MODEL, tokensOf(NOTE_SYSTEM + prompt) + 50, REVIEW_MAX_TOKENS, "before the review's note");
  } catch (err) {
    if (err instanceof BudgetStop) {
      log(`review: ${err.message}; the review has no note`);
      return null;
    }
    throw err;
  }
  const message = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: REVIEW_MAX_TOKENS,
    system: NOTE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  budget.charge(message.usage, REVIEW_MODEL, "review note");
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 400) : null;
}

/* ------------------------------------------------------------------ */
/* The restart history                                                 */
/* ------------------------------------------------------------------ */

/** When the Steward last restarted this job (a carried-out restart in its reviews), or null. */
export async function lastRestart(store: DataStore, job: string): Promise<string | null> {
  const reviews = await store.read<ReviewDoc>(COLLECTIONS.steward.reviews, `${job}:`);
  let last: string | null = null;
  for (const r of reviews.values()) if (r.repair === "restart" && r.repaired && (!last || r.created > last)) last = r.created;
  return last;
}

/** The context `reviewRun` needs, read for one run. */
export async function reviewContext(store: DataStore, sources: ReviewSources | null, job: JobDef, run: RunView, now: Date): Promise<ReviewContext> {
  const applied = (run.changeSets ?? []).some((c) => c.status === "applied");
  return {
    now,
    lastRestartAt: await lastRestart(store, job.id),
    publishAfter: applied && run.finishedAt && sources ? await sources.publishAfter(run.finishedAt) : undefined,
  };
}

/** A recorded run for `--run-file`: `{ run: RunView, context?: { lastRestartAt?, publishAfter?, now? } }`. */
export interface RunFile {
  run: RunView;
  context?: { lastRestartAt?: string | null; publishAfter?: string | null; now?: string };
}

export { reviewKey };
