import Link from "next/link";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import { formatDuration, timeLabel } from "@/lib/admin/ops-view";
import { describeCron } from "@/lib/jobs/cron";
import type { JobOverviewRow } from "@/lib/jobs/runs";
import { RUNNER_LABEL, jobHref, lastOutcome, relativeLabel } from "@/lib/jobs/view";
import { cn } from "@/lib/utils";

const linkCls = "underline decoration-dotted underline-offset-2";

/** A job's last run as a chip and a time, whichever runner recorded it. */
export function LastRunCell({ last, now }: { last: JobOverviewRow["last"]; now: Date }) {
  const outcome = lastOutcome(last);
  if (!last) return <RunChip label={outcome.label} tone={outcome.tone} className="text-muted-foreground" />;
  const at = last.kind === "stored" ? last.run.startedAt : (last.run.startedAt ?? last.run.createdAt);
  return (
    <>
      <RunChip label={outcome.label} tone={outcome.tone} />
      <div className="text-xs text-muted-foreground">
        {timeLabel(at)} · {relativeLabel(new Date(at), now)}
        {last.run.durationMs !== null && ` · ${formatDuration(last.run.durationMs)}`}
      </div>
    </>
  );
}

/**
 * `/admin/jobs` (specs/product/admin-jobs.md "The list"): jobs with where each runs, its schedule in words, its next
 * run, and its last run. A job whose last run failed is tinted so it stands out at a glance, in either view. Each
 * name opens the job's page.
 */
export function JobsTable({ rows, now, caption }: { rows: JobOverviewRow[]; now: Date; caption: string }) {
  if (!rows.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No jobs here.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Job
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Schedule
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Next run
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last run
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ job, next, last }) => {
            const headline = job.schedules.filter((s) => s.headline !== false);
            const failed = lastOutcome(last).key === "failed";
            return (
              <tr key={job.id} data-outcome={lastOutcome(last).key} className={cn("border-t border-border align-top", failed && "bg-destructive/5")}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <Link href={jobHref(job)} className={linkCls}>
                    {job.name}
                  </Link>
                  <div className="text-xs font-normal text-muted-foreground">{RUNNER_LABEL[job.runner]}</div>
                </th>
                <td className="px-3 py-2">
                  {headline.length ? (
                    <ul className="space-y-0.5">
                      {headline.map((s) => (
                        <li key={s.cron}>{describeCron(s.cron)}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">By hand only</span>
                  )}
                  {job.gate && <div className="mt-0.5 text-xs text-muted-foreground">{job.gate}</div>}
                </td>
                <td className="px-3 py-2">
                  {next ? (
                    <>
                      {timeLabel(next.toISOString())}
                      <div className="text-xs text-muted-foreground">{relativeLabel(next, now)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <LastRunCell last={last} now={now} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
