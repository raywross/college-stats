import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/admin/Panel";
import { JobsTable } from "@/components/admin/jobs/JobsTable";
import { JobsStatusStrip, JobsTabs } from "@/components/admin/jobs/JobsViews";
import { requireAdmin } from "@/lib/admin/auth";
import { loadJobsOverview } from "@/lib/jobs/runs";
import { parseJobsView, sortJobs, sortJobsByOutcome } from "@/lib/jobs/view";

export const metadata: Metadata = { title: "Jobs", robots: { index: false, follow: false } };

/**
 * `/admin/jobs` (specs/product/admin-jobs.md "The list"): every batch job the site runs, where it runs, its schedule
 * in words, when it runs next, and how its last run went. First a status line: which jobs failed their last run, and
 * the counts by state. Then one of two views: **By schedule** (the default) lists the scheduled jobs soonest first
 * and the hand-run ones apart; **All jobs** (`?view=all`) is one table of every job, failures first. A job's name
 * opens its page with the full history.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireAdmin();
  const view = parseJobsView((await searchParams).view);
  const now = new Date();
  const overview = await loadJobsOverview(now);
  const rows = sortJobs(overview.rows);
  const scheduled = rows.filter((r) => r.next !== null);
  const byHand = rows.filter((r) => r.next === null);

  return (
    <>
      <PageHeader title="Jobs" subtitle="Every scheduled job, when it runs next, and how its last run went. Times are UTC." />
      {!overview.githubConfigured && (
        <p role="note" className="mb-5 rounded-2xl border border-warning bg-warning/10 p-4 text-sm">
          GitHub credentials aren&apos;t set on this deployment, so the workflows&apos; runs can&apos;t be read here. The schedules still show; the Operations page says what to set.
        </p>
      )}
      <div className="space-y-6">
        <JobsStatusStrip rows={overview.rows} />
        <JobsTabs current={view} />
        {view === "all" ? (
          <section aria-labelledby="all-jobs-title" className="space-y-3">
            <div>
              <h2 id="all-jobs-title" className="font-display text-xl font-bold tracking-tight">
                All jobs
              </h2>
              <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">Every job in one table: failed last runs first, then running, never run, nothing to do, succeeded.</p>
            </div>
            <JobsTable rows={sortJobsByOutcome(overview.rows)} now={now} caption="Every job, failures first" />
          </section>
        ) : (
          <>
            <section aria-labelledby="scheduled-title" className="space-y-3">
              <h2 id="scheduled-title" className="font-display text-xl font-bold tracking-tight">
                Scheduled
              </h2>
              <JobsTable rows={scheduled} now={now} caption="Scheduled jobs, soonest next run first" />
            </section>
            <section aria-labelledby="by-hand-title" className="space-y-3">
              <div>
                <h2 id="by-hand-title" className="font-display text-xl font-bold tracking-tight">
                  Run by hand
                </h2>
                <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">Workflows with no schedule: a person starts them from Operations or on GitHub.</p>
              </div>
              <JobsTable rows={byHand} now={now} caption="Jobs run by hand only" />
            </section>
          </>
        )}
      </div>
    </>
  );
}
