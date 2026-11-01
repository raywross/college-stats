import "server-only";
/**
 * What the Jobs pages read (specs/product/admin-jobs.md "The pages"): the Vercel jobs' runs from `job_runs` through
 * the admin's own session (the "Admins read" policy), and the GitHub jobs' runs from GitHub as the console's App
 * (lib/github-app.ts). Nothing here throws into a page: a table or GitHub that can't be read gives an empty list and
 * the page says so. Server only.
 */
import * as gh from "@/lib/github-app";
import { adminSupabase } from "@/lib/admin/people";
import { JOBS, githubWorkflows, nextJobRun, type JobDef } from "@/lib/jobs/registry";
import type { RunTrigger, StoredRunStatus } from "@/lib/jobs/record";

export interface StoredRun {
  id: number;
  job: string;
  trigger: RunTrigger;
  status: StoredRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  httpStatus: number | null;
  summary: Record<string, unknown>;
  error: string | null;
}

const RUN_COLUMNS = "id, job, trigger, status, started_at, finished_at, duration_ms, http_status, summary, error";

interface RawStoredRun {
  id: number;
  job: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  http_status: number | null;
  summary: unknown;
  error: string | null;
}

/** A row as the page uses it; a malformed value (hand-edited) becomes a safe default rather than a crash. */
export function toStoredRun(r: RawStoredRun): StoredRun {
  return {
    id: r.id,
    job: r.job,
    trigger: r.trigger === "schedule" ? "schedule" : "manual",
    status: r.status === "ok" || r.status === "failed" || r.status === "skipped" ? r.status : "running",
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    httpStatus: r.http_status,
    summary: r.summary && typeof r.summary === "object" && !Array.isArray(r.summary) ? (r.summary as Record<string, unknown>) : {},
    error: r.error,
  };
}

/** `ok`: the table exists and was read (possibly empty); otherwise why not, for the page's note. */
export type StoredRuns = { ok: true; rows: StoredRun[] } | { ok: false; reason: string };

/** How many runs a job's page lists. */
export const RUNS_PAGE = 30;

/** One Vercel job's newest runs. */
export async function storedRuns(job: string, limit: number = RUNS_PAGE): Promise<StoredRuns> {
  try {
    const supabase = await adminSupabase();
    const { data, error } = await supabase.from("job_runs").select(RUN_COLUMNS).eq("job", job).order("started_at", { ascending: false }).limit(limit);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, rows: ((data ?? []) as RawStoredRun[]).map(toStoredRun) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "the table is unavailable" };
  }
}

/** One stored run of this job, or null. */
export async function storedRun(job: string, id: number): Promise<StoredRun | null> {
  try {
    const supabase = await adminSupabase();
    const { data, error } = await supabase.from("job_runs").select(RUN_COLUMNS).eq("job", job).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return toStoredRun(data as RawStoredRun);
  } catch {
    return null;
  }
}

/** The newest stored run of each Vercel job (one query: the newest rows, first per job). */
async function latestStoredRuns(jobs: readonly string[]): Promise<Map<string, StoredRun>> {
  const out = new Map<string, StoredRun>();
  if (!jobs.length) return out;
  try {
    const supabase = await adminSupabase();
    // Each job runs at most a few times a day, so the newest 60 rows hold every job's latest run.
    const { data } = await supabase.from("job_runs").select(RUN_COLUMNS).in("job", jobs).order("started_at", { ascending: false }).limit(60);
    for (const raw of (data ?? []) as RawStoredRun[]) if (!out.has(raw.job)) out.set(raw.job, toStoredRun(raw));
  } catch {
    // The list still renders; those jobs read "No run recorded".
  }
  return out;
}

/** The change sets a GitHub run wrote (data_change_sets.run_ref is the run id), for the run page's links. */
export interface RunChangeSet {
  id: number;
  source: string;
  status: string;
}

export async function changeSetsOfRun(runId: number): Promise<RunChangeSet[]> {
  try {
    const supabase = await adminSupabase();
    const { data } = await supabase.from("data_change_sets").select("id, source, status").eq("run_ref", String(runId)).order("id", { ascending: true });
    return ((data ?? []) as RunChangeSet[]).filter((r) => typeof r.id === "number");
  } catch {
    return [];
  }
}

/** The last run of a job, whichever runner it has. */
export type LastRun = { kind: "stored"; run: StoredRun } | { kind: "github"; run: gh.WorkflowRun } | null;

export interface JobOverviewRow {
  job: JobDef;
  next: Date | null;
  last: LastRun;
}

export interface JobsOverview {
  rows: JobOverviewRow[];
  /** Whether GitHub credentials are set (without them the GitHub jobs show no runs, and the page says why). */
  githubConfigured: boolean;
}

/** Every job with its next run and its last one, read in parallel. */
export async function loadJobsOverview(now: Date): Promise<JobsOverview> {
  const vercelJobs = JOBS.filter((j) => j.runner === "vercel").map((j) => j.id);
  const configured = gh.githubConfigured() !== null;
  const [stored, githubLatest] = await Promise.all([
    latestStoredRuns(vercelJobs),
    configured ? Promise.all(githubWorkflows().map(async (file) => [file, (await gh.listRuns({ workflows: [file], perPage: 1 }))[0] ?? null] as const)) : Promise.resolve([]),
  ]);
  const byWorkflow = new Map<string, gh.WorkflowRun | null>(githubLatest);
  return {
    githubConfigured: configured,
    rows: JOBS.map((job) => {
      const last: LastRun =
        job.runner === "vercel"
          ? stored.has(job.id)
            ? { kind: "stored", run: stored.get(job.id)! }
            : null
          : byWorkflow.get(job.workflow ?? "")
            ? { kind: "github", run: byWorkflow.get(job.workflow ?? "")! }
            : null;
      return { job, next: nextJobRun(job, now), last };
    }),
  };
}

/** A GitHub job's newest runs (empty without credentials or when GitHub can't be read). */
export async function githubRuns(job: JobDef, limit: number = RUNS_PAGE): Promise<gh.WorkflowRun[]> {
  if (!job.workflow || gh.githubConfigured() === null) return [];
  return gh.listRuns({ workflows: [job.workflow], perPage: limit });
}

/** One GitHub run of this job (null when it isn't this workflow's), with its jobs and change sets. */
export async function githubRunDetail(job: JobDef, runId: number): Promise<{ run: gh.WorkflowRun; jobs: gh.RunJob[]; changeSets: RunChangeSet[] } | null> {
  if (!job.workflow || gh.githubConfigured() === null) return null;
  const run = await gh.getRun(runId);
  if (!run || run.workflow !== job.workflow) return null;
  const [jobs, changeSets] = await Promise.all([gh.runJobs(runId), changeSetsOfRun(runId)]);
  return { run, jobs, changeSets };
}
