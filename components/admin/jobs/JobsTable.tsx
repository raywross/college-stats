import Link from "next/link";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { formatDuration, timeLabel } from "@/lib/admin/ops-view";
import { describeCron } from "@/lib/jobs/cron";
import type { JobOverviewRow } from "@/lib/jobs/runs";
import { RUNNER_LABEL, jobHref, lastOutcome, relativeLabel } from "@/lib/jobs/view";

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

function Title({ job }: { job: JobOverviewRow["job"] }) {
  return (
    <>
      <Link href={jobHref(job)} className={linkCls}>
        {job.name}
      </Link>
      <div className="text-xs font-normal text-muted-foreground">{RUNNER_LABEL[job.runner]}</div>
    </>
  );
}

function Schedule({ row }: { row: JobOverviewRow }) {
  const headline = row.job.schedules.filter((s) => s.headline !== false);
  return (
    <>
      {headline.length ? (
        <ul className="space-y-0.5">
          {headline.map((s) => (
            <li key={s.cron}>{describeCron(s.cron)}</li>
          ))}
        </ul>
      ) : (
        <span className="text-muted-foreground">By hand only</span>
      )}
      {row.job.gate && <div className="mt-0.5 text-xs text-muted-foreground">{row.job.gate}</div>}
    </>
  );
}

function Next({ row, now }: { row: JobOverviewRow; now: Date }) {
  return row.next ? (
    <>
      {timeLabel(row.next.toISOString())}
      <div className="text-xs text-muted-foreground">{relativeLabel(row.next, now)}</div>
    </>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

const columns = (now: Date): readonly Column<JobOverviewRow>[] => [
  { key: "job", header: "Job", role: "title", cell: (row) => <Title job={row.job} /> },
  { key: "schedule", header: "Schedule", cell: (row) => <Schedule row={row} /> },
  { key: "next", header: "Next run", cell: (row) => <Next row={row} now={now} /> },
  { key: "last", header: "Last run", cell: (row) => <LastRunCell last={row.last} now={now} /> },
];

/**
 * `/admin/steward/jobs` (specs/product/admin-jobs.md "The list"), through `ResponsiveTable`: jobs with where each
 * runs, its schedule in words, its next run, and its last run. Each name opens the job's page.
 */
export function JobsTable({ rows, now, caption }: { rows: JobOverviewRow[]; now: Date; caption: string }) {
  return <ResponsiveTable rows={rows} columns={columns(now)} rowKey={(row) => row.job.id} caption={caption} empty="No jobs here." />;
}
