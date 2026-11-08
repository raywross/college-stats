import Link from "next/link";
import type { WorkflowRun } from "@/lib/github-app";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { formatDuration, runOutcome, startedBy, timeLabel } from "@/lib/admin/ops-view";
import { describeCron } from "@/lib/jobs/cron";
import { scheduleOfRun, type JobDef } from "@/lib/jobs/registry";
import type { StoredRun } from "@/lib/jobs/runs";
import { TRIGGER_LABEL, runHref, storedOutcome, summaryLine } from "@/lib/jobs/view";

const linkCls = "underline decoration-dotted underline-offset-2";

/**
 * A Vercel job's runs from `job_runs` (specs/product/admin-jobs.md "A job"), through `ResponsiveTable`: outcome,
 * what started it, when, how long, and the counts it answered with. Each run number opens the run's page.
 */
export function StoredRunsTable({ job, runs }: { job: JobDef; runs: StoredRun[] }) {
  const columns: readonly Column<StoredRun>[] = [
    {
      key: "run",
      header: "Run",
      role: "title",
      cell: (run) => (
        <Link href={runHref(job, run.id)} className={linkCls}>
          Run {run.id}
        </Link>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (run) => {
        const outcome = storedOutcome(run.status);
        return (
          <>
            <RunChip label={outcome.label} tone={outcome.tone} />
            {run.error && <div className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">{run.error}</div>}
          </>
        );
      },
    },
    {
      key: "started",
      header: "Started",
      cell: (run) => (
        <>
          {timeLabel(run.startedAt)}
          <div className="text-xs text-muted-foreground">{TRIGGER_LABEL[run.trigger]}</div>
        </>
      ),
    },
    { key: "duration", header: "Duration", cell: (run) => formatDuration(run.durationMs) },
    { key: "did", header: "What it did", cell: (run) => summaryLine(run.summary) || <span className="text-muted-foreground">—</span> },
  ];
  return (
    <ResponsiveTable rows={runs} columns={columns} rowKey={(run) => String(run.id)} caption={`The last ${runs.length} runs of ${job.name}, newest first`} empty="No run has been recorded yet." />
  );
}

/** Who or what started a GitHub run, naming the schedule when one fired it. */
export function githubStartedBy(job: JobDef, run: WorkflowRun): string {
  if (run.event === "schedule") {
    const s = scheduleOfRun(job, new Date(run.createdAt));
    return s ? `Schedule: ${describeCron(s.cron)}` : "Schedule";
  }
  if (run.event === "repository_dispatch") return "Asked by a pipeline";
  return startedBy(run, null);
}

/**
 * A GitHub job's runs (specs/product/admin-jobs.md "A job"), through `ResponsiveTable`: outcome, what started it
 * (the schedule that fired, a pipeline's request, the console, a person), when, and how long. Each run number opens
 * the run's page.
 */
export function GithubRunsTable({ job, runs }: { job: JobDef; runs: WorkflowRun[] }) {
  const columns: readonly Column<WorkflowRun>[] = [
    {
      key: "run",
      header: "Run",
      role: "title",
      cell: (run) => (
        <>
          <Link href={runHref(job, run.id)} className={linkCls}>
            Run #{run.runNumber}
          </Link>
          {run.title && run.title !== run.name && <div className="max-w-72 truncate text-xs font-normal text-muted-foreground">{run.title}</div>}
        </>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (run) => {
        const outcome = runOutcome(run);
        return <RunChip label={outcome.label} tone={outcome.tone} />;
      },
    },
    {
      key: "started",
      header: "Started",
      cell: (run) => (
        <>
          {timeLabel(run.startedAt ?? run.createdAt)}
          <div className="text-xs text-muted-foreground">{githubStartedBy(job, run)}</div>
        </>
      ),
    },
    { key: "duration", header: "Duration", cell: (run) => formatDuration(run.durationMs) },
  ];
  return (
    <ResponsiveTable
      rows={runs}
      columns={columns}
      rowKey={(run) => String(run.id)}
      caption={`The last ${runs.length} runs of ${job.name}, newest first`}
      empty="GitHub lists no runs of this workflow, or they could not be read just now."
    />
  );
}
