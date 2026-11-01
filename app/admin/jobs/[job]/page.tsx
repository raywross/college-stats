import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { GithubRunsTable, StoredRunsTable } from "@/components/admin/jobs/JobRunsTable";
import { requireAdmin } from "@/lib/admin/auth";
import { timeLabel } from "@/lib/admin/ops-view";
import type { WorkflowRun } from "@/lib/github-app";
import { githubRepo } from "@/lib/github-app";
import { describeCron } from "@/lib/jobs/cron";
import { jobById, nextJobRun, nextScheduleRun, scheduleOfRun, type JobDef } from "@/lib/jobs/registry";
import { RUNS_PAGE, githubRuns, storedRuns, type StoredRuns } from "@/lib/jobs/runs";
import { JOBS_HREF, RUNNER_LABEL, relativeLabel } from "@/lib/jobs/view";

export const metadata: Metadata = { title: "Job", robots: { index: false, follow: false } };

const linkCls = "underline decoration-dotted underline-offset-2";

/** How many GitHub runs to read when housekeeping firings (the half-hourly collect) will be hidden from them. */
const WITH_HOUSEKEEPING = 100;

/**
 * `/admin/jobs/[job]` (specs/product/admin-jobs.md "A job"): what the job does, where it runs, each schedule in words
 * with its cron and its next firing, how to start it by hand, and its run history (the last 30), each run opening its
 * own page. A workflow with a housekeeping firing (the half-hourly collect) hides those runs unless `?all=1`.
 */
export default async function JobPage({ params, searchParams }: { params: Promise<{ job: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const job = jobById((await params).job);
  if (!job) notFound();
  const query = await searchParams;
  const showAll = (Array.isArray(query.all) ? query.all[0] : query.all) === "1";
  const now = new Date();
  const next = nextJobRun(job, now);
  const hasHousekeeping = job.schedules.some((s) => s.headline === false);
  const history = job.runner === "vercel" ? { kind: "stored" as const, runs: await storedRuns(job.id) } : { kind: "github" as const, runs: await githubRuns(job, hasHousekeeping && !showAll ? WITH_HOUSEKEEPING : RUNS_PAGE) };

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Runs on", value: job.runner === "vercel" ? `${RUNNER_LABEL.vercel} · ${job.path}` : `${RUNNER_LABEL.github} · ${job.workflow}` },
    { label: "Next run", value: next ? `${timeLabel(next.toISOString())} (${relativeLabel(next, now)})` : "By hand only" },
    {
      label: "Start it by hand",
      value: job.dispatch ? (
        <Link href="/admin/operations#start-a-run" className={linkCls}>
          Operations, Start a run
        </Link>
      ) : job.runner === "github" ? (
        <a href={`https://github.com/${githubRepo()}/actions/workflows/${job.workflow}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
          Run workflow on GitHub
        </a>
      ) : (
        <>
          <code className="rounded bg-muted px-1">POST {job.path}</code> with the cron secret
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
      <PageHeader
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
        <Panel title="About">
          <Fields items={facts} />
        </Panel>

        <Panel title="Schedule">
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

        <section aria-labelledby="history-title" className="space-y-3">
          <div>
            <h2 id="history-title" className="font-display text-xl font-bold tracking-tight">
              History
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">The last {RUNS_PAGE} runs, newest first. Open a run for what it did.</p>
          </div>
          {history.kind === "stored" ? <StoredHistory job={job} runs={history.runs} /> : <GithubHistory job={job} all={history.runs} showAll={showAll} hasHousekeeping={hasHousekeeping} />}
        </section>
      </div>
    </>
  );
}

function StoredHistory({ job, runs }: { job: JobDef; runs: StoredRuns }) {
  if (!runs.ok) {
    return (
      <p role="alert" className="rounded-2xl border border-destructive/50 p-4 text-sm text-destructive">
        Couldn&apos;t read this job&apos;s runs: {runs.reason}. The <code className="rounded bg-muted px-1">job_runs</code> migration may not be applied to this project.
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
