/**
 * GitHub off the response path (specs/product/admin-speed.md wave 1, fix 6, "As built: U2"): the newest run of each
 * GitHub workflow, memoized per server instance, for the Jobs list and the Inbox's job rows (lib/jobs/runs.ts
 * loadJobsOverview). Kept free of Next and of the GitHub client (both come in as `deps`), so a Server Action module
 * can import resetJobsMemo() without loading either, and the tests drive it with a fake GitHub, clock, and scheduler.
 */
import type { WorkflowRun } from "@/lib/github-app";

/** How long the last GitHub runs are served without asking GitHub again; after it, served stale while one refresh runs. */
export const GITHUB_MEMO_MS = 60_000;

export interface GithubMemoDeps {
  /** lib/github-app.ts listRuns (never throws; an empty list when GitHub can't be read). */
  listRuns: (opts: { workflows: string[]; perPage?: number }) => Promise<WorkflowRun[]>;
  /** Runs a refresh once the response has gone (lib/jobs/runs.ts passes `after()` from next/server). */
  schedule: (task: () => Promise<void>) => void;
  now?: () => number;
}

interface GithubMemo {
  at: number;
  byWorkflow: Map<string, WorkflowRun | null>;
}

/** Per server instance: the last answer, the refresh in flight, and a generation that resetJobsMemo() moves on. */
let githubMemo: GithubMemo | null = null;
let githubInflight: Promise<GithubMemo> | null = null;
let githubGeneration = 0;

/** Forgets the memo (tests; and app/admin/steward/jobs/actions.ts after a dispatch, so the new run shows at once). */
export function resetJobsMemo(): void {
  githubMemo = null;
  githubInflight = null;
  githubGeneration += 1;
}

/**
 * One refresh at a time, shared by every caller: each workflow's newest run, asked of GitHub in parallel. A workflow
 * GitHub answered nothing for keeps the run the memo had (listRuns answers an empty list when GitHub fails, and a
 * workflow's last run never disappears), so a failed refresh keeps the old memo. Never rejects.
 */
function refreshGithubRuns(workflows: readonly string[], deps: GithubMemoDeps): Promise<GithubMemo> {
  if (githubInflight) return githubInflight;
  const generation = githubGeneration;
  const now = deps.now ?? Date.now;
  const p = (async (): Promise<GithubMemo> => {
    const before = githubMemo;
    const fresh = await Promise.all(
      workflows.map(async (file) => {
        try {
          return [file, (await deps.listRuns({ workflows: [file], perPage: 1 }))[0] ?? null] as const;
        } catch {
          return [file, null] as const;
        }
      }),
    );
    const byWorkflow = new Map<string, WorkflowRun | null>(fresh.map(([file, run]) => [file, run ?? before?.byWorkflow.get(file) ?? null]));
    const next: GithubMemo = { at: now(), byWorkflow };
    // A reset while this ran (a dispatch) means this answer may predate the new run: hand it to this caller, keep it out.
    if (generation === githubGeneration) githubMemo = next;
    return next;
  })().finally(() => {
    if (githubInflight === p) githubInflight = null;
  });
  githubInflight = p;
  return p;
}

/**
 * The newest run of each GitHub workflow, memoized per instance for GITHUB_MEMO_MS. The first call (a cold instance,
 * or after resetJobsMemo) waits for GitHub, and concurrent first calls share that one fill. Within the minute the memo
 * answers with no GitHub call. After it, the stale memo answers at once and one refresh is scheduled after the
 * response (stale-while-revalidate), so no page waits on GitHub once the instance has an answer. Never throws.
 */
export async function latestGithubRuns(workflows: readonly string[], deps: GithubMemoDeps): Promise<Map<string, WorkflowRun | null>> {
  const now = deps.now ?? Date.now;
  const memo = githubMemo;
  if (!memo || workflows.some((w) => !memo.byWorkflow.has(w))) return (await refreshGithubRuns(workflows, deps)).byWorkflow;
  if (now() - memo.at >= GITHUB_MEMO_MS && !githubInflight) {
    deps.schedule(async () => {
      await refreshGithubRuns(workflows, deps);
    });
  }
  return memo.byWorkflow;
}
