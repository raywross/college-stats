import type { Metadata } from "next";
import Link from "next/link";
import { HelpTip } from "@/components/admin/HelpTip";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { GithubRunsTable, StoredRunsTable } from "@/components/admin/jobs/JobRunsTable";
import { RunForm } from "@/components/admin/ops/RunForm";
import { dispatchAction } from "@/app/admin/steward/jobs/actions";
import { loadRunNow, type RunNowData } from "@/lib/admin/ops";
import { blockingRun } from "@/lib/admin/workflows";
import { requireAdmin } from "@/lib/admin/auth";
import { timeLabel } from "@/lib/admin/ops-view";
import type { WorkflowRun } from "@/lib/github-app";
import { githubRepo } from "@/lib/github-app";
import { describeCron } from "@/lib/jobs/cron";
import { jobById, nextJobRun, nextScheduleRun, scheduleOfRun, type JobDef } from "@/lib/jobs/registry";
import { RUNS_PAGE, githubRuns, storedRuns, type StoredRuns } from "@/lib/jobs/runs";
import { JOBS_HREF, RUNNER_LABEL, relativeLabel } from "@/lib/jobs/view";
import { expectationLines } from "@/lib/steward/job-review";

export const metadata: Metadata = { title: "Job", robots: { index: false, follow: false } };

const linkCls = "underline decoration-dotted underline-offset-2";

/** How many GitHub runs to read when housekeeping firings (the half-hourly collect) will be hidden from them. */
const WITH_HOUSEKEEPING = 100;

/**
 * `/admin/steward/jobs/[job]` (specs/product/admin-jobs.md "A job"): what the job does, where it runs, each schedule in words
 * with its cron and its next firing, how to start it by hand, and its run history (the last 30), each run opening its
 * own page. A workflow with a housekeeping firing (the half-hourly collect) hides those runs unless `?all=1`.
 */
/** The raw route or workflow file, folded under Details (specs/product/admin-redesign.md "Words that change"). */
function RawDetails({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="inline-flex min-h-11 cursor-pointer items-center hover:text-foreground">Details</summary>
      <code className="rounded bg-muted px-1 break-all">{raw}</code>
    </details>
  );
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ job: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const job = jobById((await params).job);
  if (!job) notFound();
  const query = await searchParams;
  const showAll = (Array.isArray(query.all) ? query.all[0] : query.all) === "1";
  const unitParam = Array.isArray(query.unit) ? query.unit[0] : query.unit;
  const prefillUnit = unitParam && /^\d{6}$/.test(unitParam) ? unitParam : null;
  const now = new Date();
  const next = nextJobRun(job, now);
  const hasHousekeeping = job.schedules.some((s) => s.headline === false);
  const runNow = job.dispatch ? await loadRunNow(job.workflow) : null;
  const history = job.runner === "vercel" ? { kind: "stored" as const, runs: await storedRuns(job.id) } : { kind: "github" as const, runs: await githubRuns(job, hasHousekeeping && !showAll ? WITH_HOUSEKEEPING : RUNS_PAGE) };

  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: "Runs on",
      value: (
        <>
          {job.runner === "vercel" ? `${RUNNER_LABEL.vercel}, at its own web route` : `${RUNNER_LABEL.github}, as its own workflow`}
          <RawDetails raw={job.runner === "vercel" ? job.path : job.workflow} />
        </>
      ),
    },
    { label: "Next run", value: next ? `${timeLabel(next.toISOString())} (${relativeLabel(next, now)})` : "By hand only" },
    {
      label: "Start it by hand",
      value: job.dispatch ? (
        <a href="#run-now" className={linkCls}>
          Run now, below
        </a>
      ) : job.runner === "github" ? (
        <a href={`https://github.com/${githubRepo()}/actions/workflows/${job.workflow}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
          Run workflow on GitHub
        </a>
      ) : (
        <>
          Its own web route, called with the cron secret
          <RawDetails raw={`POST ${job.path}`} />
        </>
      ),
    },
    {
      label: "Spec",
      value: (
        <a href={`https://github.com/${githubRepo()}/blob/main/${job.spec}`} target="_blank" rel="noopener noreferrer" className={`${linkCls} break-all`}>
          {job.spec}
        </a>
      ),
    },
  ];

  return (
    <>
      <PageHeader help="job"
        title={job.name}
        chips={<StatusChip label={RUNNER_LABEL[job.runner]} tone="info" />}
        back={
          <Link href={JOBS_HREF} className={linkCls}>
            Jobs
          </Link>
        }
        subtitle={job.description}
      />
      <div className="space-y-5">
        <Panel help="job" title="About">
          <Fields items={facts} />
        </Panel>

        <Panel help="trigger" title="Schedule">
          {job.schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedule: this job runs only when a person starts it.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {job.schedules.map((s) => {
                const fires = nextScheduleRun(s, now);
                return (
                  <li key={s.cron} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {describeCron(s.cron)} <code className="ml-1 rounded bg-muted px-1 text-xs font-normal">{s.cron}</code>
                      </p>
                      {s.note && <p className="text-muted-foreground">{s.note}</p>}
                      {s.headline === false && <p className="text-xs text-muted-foreground">Housekeeping: not counted as the job&apos;s next run.</p>}
                    </div>
                    <p className="text-muted-foreground">{fires ? `Next: ${timeLabel(fires.toISOString())}, ${relativeLabel(fires, now)}` : "Never fires"}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {job.gate && <p className="mt-3 text-sm text-muted-foreground">{job.gate}</p>}
        </Panel>

        <Panel help="expectation" title="What the Steward expects">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {expectationLines(job).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">The Steward reads every run against these when it finishes; open a run for its reading.</p>
        </Panel>

        {runNow && <RunNow data={runNow} prefillUnit={prefillUnit} />}

        <section aria-labelledby="history-title" className="space-y-3">
          <div>
            <h2 id="history-title" className="inline-flex items-center gap-1.5 font-display text-xl font-bold tracking-tight">
              History <HelpTip help="job-history" />
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">The last {RUNS_PAGE} runs, newest first. Open a run for what it did.</p>
          </div>
          {history.kind === "stored" ? <StoredHistory job={job} runs={history.runs} /> : <GithubHistory job={job} all={history.runs} showAll={showAll} hasHousekeeping={hasHousekeeping} />}
        </section>
      </div>
    </>
  );
}

/**
 * Run now (specs/product/admin-redesign.md "The screens", Jobs; formerly Operations' Start a run): each run the console
 * can start for this workflow, as its own form with the workflow's inputs. The dispatch guard is the same as before: a
 * workflow already queued or running shows that run instead of a button. `?unit=` opens the college run prefilled.
 */
function RunNow({ data, prefillUnit }: { data: RunNowData; prefillUnit: string | null }) {
  return (
    <Panel title="Run now" id="run-now" help="run-now">
      {!data.configured ? (
        <p role="note" className="text-sm">
          GitHub credentials aren&apos;t set on this deployment, so the console can&apos;t start runs. Set <code className="rounded bg-muted px-1">GITHUB_APP_ID</code>,{" "}
          <code className="rounded bg-muted px-1">GITHUB_APP_INSTALLATION_ID</code>, and <code className="rounded bg-muted px-1">GITHUB_APP_PRIVATE_KEY</code> (or a fine-grained token in{" "}
          <code className="rounded bg-muted px-1">GITHUB_TOKEN</code>), and <code className="rounded bg-muted px-1">GITHUB_REPO</code> if it isn&apos;t the default, then redeploy. The steps are in the
          admin console spec under &ldquo;The GitHub App&rdquo;.
        </p>
      ) : data.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">This workflow is started by another screen with its own values, not from here.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connected as {data.configured.mode === "app" ? "the Quad console GitHub App" : "a personal access token"}. Each form is the workflow&apos;s own inputs; each start is logged before it is sent.
          </p>
          {data.runs.map((run) => {
            const running = blockingRun(run, data.recent);
            const open = data.runs.length === 1 || (run.id === "college" && prefillUnit !== null);
            return (
              <details key={run.id} open={open} className="rounded-2xl border border-border bg-background">
                <summary className="min-h-12 cursor-pointer px-4 py-3">
                  <span className="font-semibold">{run.label}</span>
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{run.description}</span>
                </summary>
                <div className="border-t border-border px-4 py-4">
                  {running ? (
                    <p className="text-sm">
                      A run of {run.workflow} is already {running.status === "queued" ? "queued" : "in progress"}: started {timeLabel(running.startedAt ?? running.createdAt)}.{" "}
                      <a href={running.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                        Run #{running.runNumber} on GitHub
                      </a>
                    </p>
                  ) : (
                    <RunForm run={run} prefillUnit={prefillUnit} cost={data.cost} action={dispatchAction} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function StoredHistory({ job, runs }: { job: JobDef; runs: StoredRuns }) {
  if (!runs.ok) {
    return (
      <p role="alert" className="rounded-2xl border border-destructive/50 p-4 text-sm text-destructive">
        Couldn&apos;t read this job&apos;s runs: {runs.reason}. <span title="public.job_runs">The migration that adds the jobs&apos; run history may not be applied to this project.</span>
      </p>
    );
  }
  return <StoredRunsTable job={job} runs={runs.rows} />;
}

/** The runs to list: every one, or with the housekeeping firings (the schedules marked `headline: false`) left out. */
export function visibleRuns(job: JobDef, all: readonly WorkflowRun[], showAll: boolean): WorkflowRun[] {
  if (showAll) return [...all];
  return all.filter((r) => !(r.event === "schedule" && scheduleOfRun(job, new Date(r.createdAt))?.headline === false));
}

function GithubHistory({ job, all, showAll, hasHousekeeping }: { job: JobDef; all: WorkflowRun[]; showAll: boolean; hasHousekeeping: boolean }) {
  const visible = visibleRuns(job, all, showAll);
  const hidden = all.length - visible.length;
  return (
    <>
      {hasHousekeeping && (
        <p className="text-sm text-muted-foreground" role="status">
          {showAll ? (
            <>
              Showing every firing, housekeeping ones included.{" "}
              <Link href={`${JOBS_HREF}/${job.id}`} className={linkCls}>
                Hide them
              </Link>
            </>
          ) : (
            <>
              {hidden > 0 ? `${hidden} housekeeping firing${hidden === 1 ? "" : "s"} hidden among the newest ${all.length}.` : "Housekeeping firings are hidden."}{" "}
              <Link href={`${JOBS_HREF}/${job.id}?all=1`} className={linkCls}>
                Show them
              </Link>
            </>
          )}
        </p>
      )}
      <GithubRunsTable job={job} runs={visible.slice(0, RUNS_PAGE)} />
    </>
  );
}
