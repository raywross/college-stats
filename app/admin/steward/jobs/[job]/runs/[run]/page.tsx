import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, Fields, KeyValues, PageHeader, Panel } from "@/components/admin/Panel";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import { githubStartedBy } from "@/components/admin/jobs/JobRunsTable";
import { requireAdmin } from "@/lib/admin/auth";
import { formatDuration, runOutcome, timeLabel } from "@/lib/admin/ops-view";
import type { RunJob, RunStep, WorkflowRun } from "@/lib/github-app";
import { jobById, type JobDef } from "@/lib/jobs/registry";
import { githubRunDetail, storedRun, type RunChangeSet, type StoredRun } from "@/lib/jobs/runs";
import { TRIGGER_LABEL, jobHref, parseRunId, storedOutcome } from "@/lib/jobs/view";

export const metadata: Metadata = { title: "Run", robots: { index: false, follow: false } };

const linkCls = "underline decoration-dotted underline-offset-2";

/**
 * `/admin/jobs/[job]/runs/[run]` (specs/product/admin-jobs.md "A run"): one run in full. A Vercel job's run is its
 * `job_runs` row: outcome, trigger, timing, and the counts it answered with. A GitHub run is read from GitHub: its
 * jobs and steps with each one's outcome and time, the change sets it wrote (linked to the Data console), and the
 * link to GitHub's own log. A run id that isn't this job's is a 404.
 */
export default async function RunPage({ params }: { params: Promise<{ job: string; run: string }> }) {
  await connection();
  await requireAdmin();
  const { job: jobId, run: rawRun } = await params;
  const job = jobById(jobId);
  const runId = parseRunId(rawRun);
  if (!job || runId === null) notFound();
  if (job.runner === "vercel") {
    const run = await storedRun(job.id, runId);
    if (!run) notFound();
    return <StoredRunView job={job} run={run} />;
  }
  const detail = await githubRunDetail(job, runId);
  if (!detail) notFound();
  return <GithubRunView job={job} {...detail} />;
}

function Back({ job }: { job: JobDef }) {
  return (
    <Link href={jobHref(job)} className={linkCls}>
      {job.name}
    </Link>
  );
}

function StoredRunView({ job, run }: { job: JobDef; run: StoredRun }) {
  const outcome = storedOutcome(run.status);
  return (
    <>
      <PageHeader title={`${job.name}: run ${run.id}`} chips={<RunChip label={outcome.label} tone={outcome.tone} />} back={<Back job={job} />} subtitle={`${TRIGGER_LABEL[run.trigger]} · ${timeLabel(run.startedAt)}`} />
      <div className="space-y-5">
        <Panel title="Run">
          <Fields
            items={[
              { label: "Outcome", value: outcome.label },
              { label: "Started by", value: run.trigger === "schedule" ? "Vercel Cron, on the schedule" : "A person, with the cron secret" },
              { label: "Started", value: timeLabel(run.startedAt) },
              { label: "Finished", value: run.finishedAt ? timeLabel(run.finishedAt) : "Still running" },
              { label: "Duration", value: formatDuration(run.durationMs) },
              { label: "HTTP status", value: run.httpStatus ?? "—" },
            ]}
          />
        </Panel>
        {run.error && (
          <Panel title="Error">
            <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs whitespace-pre-wrap">{run.error}</pre>
          </Panel>
        )}
        <Panel title="What it did">
          {Object.keys(run.summary).length ? <KeyValues data={run.summary} /> : <Empty>{run.status === "running" ? "Nothing recorded yet: the run is still going." : "The run answered with nothing to show."}</Empty>}
        </Panel>
      </div>
    </>
  );
}

function stepDuration(s: Pick<RunStep, "startedAt" | "completedAt">): string {
  if (!s.startedAt || !s.completedAt) return "—";
  return formatDuration(Date.parse(s.completedAt) - Date.parse(s.startedAt));
}

function JobSteps({ job }: { job: RunJob }) {
  const outcome = runOutcome(job);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-semibold">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
            {job.name}
          </a>
        </h3>
        <span className="flex items-center gap-3 text-sm">
          <RunChip label={outcome.label} tone={outcome.tone} />
          <span className="text-muted-foreground tabular-nums">{stepDuration(job)}</span>
        </span>
      </div>
      {job.steps.length > 0 && (
        <ol className="mt-2 space-y-1 text-sm">
          {job.steps.map((s) => {
            const o = runOutcome(s);
            return (
              <li key={s.number} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg px-2 py-1 odd:bg-muted/40">
                <span className="min-w-0 break-words">
                  <span className="mr-2 text-muted-foreground tabular-nums">{s.number}.</span>
                  {s.name}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <RunChip label={o.label} tone={o.tone} className="text-xs" />
                  <span className="text-xs text-muted-foreground tabular-nums">{stepDuration(s)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function GithubRunView({ job, run, jobs, changeSets }: { job: JobDef; run: WorkflowRun; jobs: RunJob[]; changeSets: RunChangeSet[] }) {
  const outcome = runOutcome(run);
  return (
    <>
      <PageHeader title={`${job.name}: run #${run.runNumber}`} chips={<RunChip label={outcome.label} tone={outcome.tone} />} back={<Back job={job} />} subtitle={run.title && run.title !== run.name ? run.title : undefined} />
      <div className="space-y-5">
        <Panel
          title="Run"
          aside={
            <a href={run.url} target="_blank" rel="noopener noreferrer" className={`text-sm ${linkCls}`}>
              Open on GitHub
            </a>
          }
        >
          <Fields
            items={[
              { label: "Outcome", value: outcome.label },
              { label: "Started by", value: githubStartedBy(job, run) },
              { label: "Started", value: timeLabel(run.startedAt ?? run.createdAt) },
              { label: "Finished", value: run.status === "completed" ? timeLabel(run.updatedAt) : "Still running" },
              { label: "Duration", value: formatDuration(run.durationMs) },
              { label: "Branch", value: run.headBranch ?? "—" },
            ]}
          />
        </Panel>
        <Panel title="Steps">{jobs.length ? <ul className="divide-y divide-border">{jobs.map((j) => <JobSteps key={j.id} job={j} />)}</ul> : <Empty>GitHub lists no jobs for this run yet, or they couldn&apos;t be read.</Empty>}</Panel>
        <Panel title="Change sets written">
          {changeSets.length ? (
            <ul className="space-y-1 text-sm">
              {changeSets.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/data/change-sets/${c.id}`} className={linkCls}>
                    Change set #{c.id}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    · {c.source} · {c.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None: this run wrote nothing to the data store (or it isn&apos;t a data run).</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
