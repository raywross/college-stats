/**
 * After a Vercel job's run is recorded, ask the Steward to review it (specs/product/admin-redesign.md "What the Steward
 * reviews"): a `workflow_dispatch` of steward.yml with `mode: review`, the job's id, and the run's `job_runs` id,
 * through the console's GitHub client (lib/github-app.ts, the same App and allow-list Run now uses). lib/jobs/record.ts
 * `withJobRun` calls `requestReview` as its default after hook.
 *
 * Rules: never throws (a failure is logged and the job's answer is unchanged); does nothing without GitHub
 * credentials; collapsed: when another run of the same job finished in the last 10 minutes (its own dispatch went out
 * then), this one is not sent, so a burst of manual calls asks for one review. The GitHub client and the database are
 * loaded on first use; `deps` replaces them in tests.
 */
import type { FinishedRun } from "./record.ts";

/** A review for a job already asked for within this window is not asked for again. */
export const REVIEW_COLLAPSE_MS = 10 * 60_000;
export const STEWARD_WORKFLOW = "steward.yml";

export interface ReviewDispatchDeps {
  /** Whether GitHub credentials are set (lib/github-app.ts `githubConfigured`). */
  configured?: () => Promise<boolean>;
  /** How many other runs of the job finished at or after `since` (a `job_runs` read). */
  recentFinishes?: (job: string, since: Date, except: number) => Promise<number>;
  dispatch?: (file: string, inputs: Record<string, string>, requestId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  requestId?: () => string;
  log?: (line: string) => void;
}

/** The inputs the dispatch sends (steward.yml's `mode`, `job`, `run`). Exported for tests. */
export function reviewInputs(job: string, runId: number): Record<string, string> {
  return { mode: "review", job, run: String(runId) };
}

export type ReviewRequest = "sent" | "not-configured" | "collapsed" | "failed";

export async function requestReview(job: string, finish: FinishedRun, deps: ReviewDispatchDeps = {}): Promise<ReviewRequest> {
  const log = deps.log ?? ((line: string) => console.warn(line));
  try {
    const configured = deps.configured ?? (async () => (await import("../github-app.ts")).githubConfigured() !== null);
    if (!(await configured())) return "not-configured";
    const recent = deps.recentFinishes ?? recentFinishesFromDb;
    const since = new Date(finish.finishedAt.getTime() - REVIEW_COLLAPSE_MS);
    if ((await recent(job, since, finish.id)) > 0) {
      log(`steward review: ${job} run ${finish.id} not sent; a review of ${job} was asked for in the last 10 minutes`);
      return "collapsed";
    }
    const gh = deps.dispatch && deps.requestId ? null : await import("../github-app.ts");
    const dispatch = deps.dispatch ?? gh!.dispatchWorkflow;
    const requestId = (deps.requestId ?? gh!.newRequestId)();
    const res = await dispatch(STEWARD_WORKFLOW, reviewInputs(job, finish.id), requestId);
    if (!res.ok) {
      log(`steward review: dispatching the review of ${job} run ${finish.id} failed: ${res.reason}`);
      return "failed";
    }
    return "sent";
  } catch (e) {
    log(`steward review: asking for a review of ${job} run ${finish.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}

/** Other runs of the job that finished since `since` (the secret-key client the recorder uses). */
async function recentFinishesFromDb(job: string, since: Date, except: number): Promise<number> {
  const { supabaseClient } = await import("../supabase.ts");
  const { count, error } = await supabaseClient("publish")
    .from("job_runs")
    .select("id", { count: "exact", head: true })
    .eq("job", job)
    .neq("id", except)
    .gte("finished_at", since.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}
