import Link from "next/link";
import type { WorkflowRun } from "@/lib/github-app";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import { formatDuration, runOutcome, startedBy, timeLabel } from "@/lib/admin/ops-view";
import { describeCron } from "@/lib/jobs/cron";
import { scheduleOfRun, type JobDef } from "@/lib/jobs/registry";
import type { StoredRun } from "@/lib/jobs/runs";
import { TRIGGER_LABEL, runHref, storedOutcome, summaryLine } from "@/lib/jobs/view";

const linkCls = "underline decoration-dotted underline-offset-2";

function Table({ caption, headers, children, minWidth = "44rem" }: { caption: string; headers: string[]; children: React.ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A Vercel job's runs from `job_runs` (specs/product/admin-jobs.md "A job"): outcome, what started it, when, how
 * long, and the counts it answered with. Each run number opens the run's page.
 */
export function StoredRunsTable({ job, runs }: { job: JobDef; runs: StoredRun[] }) {
  if (!runs.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No run has been recorded yet.</p>;
  return (
    <Table caption={`The last ${runs.length} runs of ${job.name}, newest first`} headers={["Run", "Outcome", "Started", "Duration", "What it did"]}>
      {runs.map((run) => {
        const outcome = storedOutcome(run.status);
        const line = summaryLine(run.summary);
        return (
          <tr key={run.id} className="border-t border-border align-top">
            <th scope="row" className="px-3 py-2 text-left font-medium">
              <Link href={runHref(job, run.id)} className={linkCls}>
                Run {run.id}
              </Link>
            </th>
            <td className="px-3 py-2">
              <RunChip label={outcome.label} tone={outcome.tone} />
              {run.error && <div className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">{run.error}</div>}
            </td>
            <td className="px-3 py-2">
              {timeLabel(run.startedAt)}
              <div className="text-xs text-muted-foreground">{TRIGGER_LABEL[run.trigger]}</div>
            </td>
            <td className="px-3 py-2 tabular-nums">{formatDuration(run.durationMs)}</td>
            <td className="px-3 py-2">{line || <span className="text-muted-foreground">—</span>}</td>
          </tr>
        );
      })}
    </Table>
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
 * A GitHub job's runs (specs/product/admin-jobs.md "A job"): outcome, what started it (the schedule that fired, a
 * pipeline's request, the console, a person), when, and how long. Each run number opens the run's page.
 */
export function GithubRunsTable({ job, runs }: { job: JobDef; runs: WorkflowRun[] }) {
  if (!runs.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">GitHub lists no runs of this workflow, or they could not be read just now.</p>;
  return (
    <Table caption={`The last ${runs.length} runs of ${job.name}, newest first`} headers={["Run", "Outcome", "Started", "Duration"]}>
      {runs.map((run) => {
        const outcome = runOutcome(run);
        return (
          <tr key={run.id} className="border-t border-border align-top">
            <th scope="row" className="px-3 py-2 text-left font-medium">
              <Link href={runHref(job, run.id)} className={linkCls}>
                Run #{run.runNumber}
              </Link>
              {run.title && run.title !== run.name && <div className="max-w-72 truncate text-xs font-normal text-muted-foreground">{run.title}</div>}
            </th>
            <td className="px-3 py-2">
              <RunChip label={outcome.label} tone={outcome.tone} />
            </td>
            <td className="px-3 py-2">
              {timeLabel(run.startedAt ?? run.createdAt)}
              <div className="text-xs text-muted-foreground">{githubStartedBy(job, run)}</div>
            </td>
            <td className="px-3 py-2 tabular-nums">{formatDuration(run.durationMs)}</td>
          </tr>
        );
      })}
    </Table>
  );
}
