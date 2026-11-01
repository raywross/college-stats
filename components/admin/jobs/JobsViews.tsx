import Link from "next/link";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";
import type { JobOverviewRow } from "@/lib/jobs/runs";
import { JOBS_VIEWS, OUTCOME_KEYS, OUTCOME_LABEL, jobHref, jobsViewHref, lastOutcome, outcomeCounts, type JobsView } from "@/lib/jobs/view";
import { cn } from "@/lib/utils";

const VIEW_LABEL: Readonly<Record<JobsView, { label: string; hint: string }>> = {
  schedule: { label: "By schedule", hint: "Scheduled jobs by next run, then the ones run by hand" },
  all: { label: "All jobs", hint: "Every job in one table, failures first" },
};

/** The list's two views (specs/product/admin-jobs.md "The list"), as links so each is its own URL. */
export function JobsTabs({ current }: { current: JobsView }) {
  return (
    <nav aria-label="Jobs views" className="flex flex-wrap gap-2 border-b border-border">
      {JOBS_VIEWS.map((v) => (
        <Link
          key={v}
          href={jobsViewHref(v)}
          title={VIEW_LABEL[v].hint}
          aria-current={v === current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold",
            v === current ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {VIEW_LABEL[v].label}
        </Link>
      ))}
    </nav>
  );
}

const TONE: Record<(typeof OUTCOME_KEYS)[number], Parameters<typeof RunChip>[0]["tone"]> = { failed: "failed", running: "running", none: "other", other: "other", ok: "ok" };

/**
 * One line that answers "has anything failed?" before the tables: the failed jobs by name (each a link), or "No job
 * failed its last run", then the counts of the other states. The failed line is red and first so it is seen first.
 */
export function JobsStatusStrip({ rows }: { rows: JobOverviewRow[] }) {
  const counts = outcomeCounts(rows);
  const failed = rows.filter((r) => lastOutcome(r.last).key === "failed").sort((a, b) => a.job.name.localeCompare(b.job.name));
  return (
    <section aria-labelledby="jobs-status-title" className={cn("rounded-2xl border p-4", failed.length ? "border-destructive bg-destructive/5" : "border-border bg-card")}>
      <h2 id="jobs-status-title" className="sr-only">
        Status of the last runs
      </h2>
      <p role="status" className={cn("text-sm font-semibold", failed.length && "text-destructive")}>
        {failed.length === 0 ? (
          "No job failed its last run."
        ) : (
          <>
            {failed.length === 1 ? "1 job failed its last run: " : `${failed.length} jobs failed their last run: `}
            {failed.map((r, i) => (
              <span key={r.job.id}>
                {i > 0 && ", "}
                <Link href={jobHref(r.job)} className="underline decoration-dotted underline-offset-2">
                  {r.job.name}
                </Link>
              </span>
            ))}
            .
          </>
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {OUTCOME_KEYS.map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <RunChip label={OUTCOME_LABEL[k]} tone={TONE[k]} />
            <span className="font-semibold tabular-nums">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
