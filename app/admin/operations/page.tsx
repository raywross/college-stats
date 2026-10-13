import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { loadOperations } from "@/lib/admin/ops";
import { DISPATCHABLE_RUNS, blockingRun } from "@/lib/admin/workflows";
import { QUEUE_PAGE_SIZE, dayLabel, filterQueueRows, operationsQuery, parseOperationsParams, queueCodes, QUEUE_STATUSES, timeLabel } from "@/lib/admin/ops-view";
import { pageOf } from "@/lib/admin/health-view";
import { dispatchAction } from "@/app/admin/operations/actions";
import { RunForm } from "@/components/admin/ops/RunForm";
import { RunsTable } from "@/components/admin/ops/RunsTable";
import { PullList } from "@/components/admin/ops/PullList";
import { ReviewQueueTable } from "@/components/admin/ops/ReviewQueueTable";

export const metadata: Metadata = { title: "Operations", robots: { index: false } };

const selectCls = "mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <div>
        <h2 id={`${id}-title`} className="font-display text-xl font-bold tracking-tight">
          {title}
        </h2>
        {hint && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Shown when no GitHub credentials are set: no buttons, and what to set. */
function SetupNotice() {
  return (
    <div role="note" className="rounded-2xl border border-warning bg-warning/10 p-5">
      <h2 className="text-base font-semibold">Operations isn&apos;t set up yet</h2>
      <p className="mt-1 max-w-3xl text-sm">
        The console starts runs and merges data changes as the &ldquo;Quad console&rdquo; GitHub App, and none of its credentials are set on this deployment, so there are no buttons here. Set{" "}
        <code className="rounded bg-muted px-1">GITHUB_APP_ID</code>, <code className="rounded bg-muted px-1">GITHUB_APP_INSTALLATION_ID</code>, and <code className="rounded bg-muted px-1">GITHUB_APP_PRIVATE_KEY</code> (or a fine-grained token in{" "}
        <code className="rounded bg-muted px-1">GITHUB_TOKEN</code>), and <code className="rounded bg-muted px-1">GITHUB_REPO</code> if it isn&apos;t the default, then redeploy. The steps are in the admin console spec under &ldquo;The GitHub App&rdquo;.
      </p>
    </div>
  );
}

/**
 * Workflow runs, open data pull requests, and the review queue (specs/product/admin.md "Operations: reruns and
 * approvals"). Everything here reads and writes GitHub as the console's App; each button logs to the admin log before it
 * sends. `?unit=` prefills the college run and narrows the queue to that college.
 */
export default async function OperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = parseOperationsParams(await searchParams);
  const ops = await loadOperations();

  if (!ops.configured) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold tracking-tight">Operations</h1>
        <SetupNotice />
      </div>
    );
  }

  const queue = ops.queue;
  const queueRows = queue?.ok ? filterQueueRows(queue.rows, params) : [];
  const queuePage = pageOf(queueRows, params.page, QUEUE_PAGE_SIZE);
  const allRuns = ops.runs.map((r) => r.run);
  const queryWith = (change: Partial<typeof params>) => {
    const q = operationsQuery({ ...params, page: 1, ...change });
    return q ? `/admin/operations?${q}` : "/admin/operations";
  };

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Operations</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Start a run, approve or hold the data changes it opens, and settle the review queue. Connected as {ops.configured.mode === "app" ? "the Quad console GitHub App" : "a personal access token"}. Each action is logged before it is sent.
        </p>
        <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a href="#start-a-run" className="underline decoration-dotted underline-offset-2">Start a run</a>
          <a href="#runs" className="underline decoration-dotted underline-offset-2">Runs</a>
          <a href="#pulls" className="underline decoration-dotted underline-offset-2">Open data PRs ({ops.pulls.length})</a>
          <a href="#review-queue" className="underline decoration-dotted underline-offset-2">Review queue</a>
        </nav>
      </header>

      <Section id="start-a-run" title="Start a run" hint="Each form is the workflow's own inputs. A workflow that is already running shows that run instead of a button.">
        <div className="space-y-3">
          {DISPATCHABLE_RUNS.map((run) => {
            const running = blockingRun(run, allRuns);
            const open = run.id === "college" && params.unit !== null;
            return (
              <details key={run.id} open={open} className="rounded-2xl border border-border bg-card">
                <summary className="min-h-12 cursor-pointer px-4 py-3">
                  <span className="font-semibold">{run.label}</span>
                  <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{run.description}</span>
                </summary>
                <div className="border-t border-border px-4 py-4">
                  {running ? (
                    <p className="text-sm">
                      A run of {run.workflow} is already {running.status === "queued" ? "queued" : "in progress"}: started {timeLabel(running.startedAt ?? running.createdAt)}.{" "}
                      <a href={running.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                        Run #{running.runNumber} on GitHub
                      </a>
                    </p>
                  ) : (
                    <RunForm run={run} prefillUnit={params.unit} cost={ops.cost} action={dispatchAction} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </Section>

      <Section id="runs" title="Runs" hint="The last 30 runs of these workflows, newest first.">
        <RunsTable runs={ops.runs} />
      </Section>

      <Section id="pulls" title="Open data PRs" hint="Pull requests from the pipelines (data/) and from the review queue (review/). The ones waiting for a person come first.">
        <PullList pulls={ops.pulls} />
      </Section>

      <Section
        id="review-queue"
        title="Review queue"
        hint="Values the automatic checks held back. Accept writes an override with the document as its citation; Reject keeps the value off the site; Re-run discovery looks for the college's documents again. Each opens a pull request or a run."
      >
        {!queue ? null : !queue.ok ? (
          <p role="alert" className="rounded-2xl border border-destructive/50 p-4 text-sm text-destructive">
            Couldn&apos;t read the review queue from GitHub: {queue.reason}.
          </p>
        ) : (
          <>
            <form method="get" action="/admin/operations#review-queue" className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4">
              <label className="block text-sm font-semibold">
                College
                <input name="college" defaultValue={params.college ?? ""} placeholder="Name" className={selectCls} />
              </label>
              <label className="block text-sm font-semibold">
                Code
                <select name="code" defaultValue={params.code ?? ""} className={selectCls}>
                  <option value="">Any</option>
                  {queueCodes(queue.rows).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Status
                <select name="qstatus" defaultValue={params.queueStatus} className={selectCls}>
                  {QUEUE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-3">
                {params.unit && <input type="hidden" name="unit" value={params.unit} />}
                <button type="submit" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
                  Filter
                </button>
                <Link href="/admin/operations#review-queue" className="inline-flex min-h-10 items-center text-sm underline decoration-dotted underline-offset-2">
                  Clear
                </Link>
              </div>
            </form>
            <p className="text-sm text-muted-foreground" role="status">
              {queuePage.total.toLocaleString("en-US")} item{queuePage.total === 1 ? "" : "s"}
              {params.unit && (
                <>
                  {" "}for college {params.unit} ·{" "}
                  <Link href={queryWith({ unit: null })} className="underline decoration-dotted underline-offset-2">
                    show all colleges
                  </Link>
                </>
              )}
              {queue.updated && ` · queue updated ${dayLabel(queue.updated)}`}
              {queuePage.total > 0 && ` · showing ${queuePage.from.toLocaleString("en-US")} to ${queuePage.to.toLocaleString("en-US")}`}
            </p>
            <ReviewQueueTable rows={queuePage.rows} />
            {queuePage.pages > 1 && (
              <nav aria-label="Review queue pages" className="flex items-center justify-between gap-3 text-sm">
                {queuePage.page > 1 ? (
                  <Link href={`${queryWith({ page: queuePage.page - 1 })}#review-queue`} rel="prev" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                    Previous {QUEUE_PAGE_SIZE}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Page {queuePage.page} of {queuePage.pages}
                </span>
                {queuePage.page < queuePage.pages ? (
                  <Link href={`${queryWith({ page: queuePage.page + 1 })}#review-queue`} rel="next" className="inline-flex min-h-10 items-center underline decoration-dotted underline-offset-2">
                    Next {QUEUE_PAGE_SIZE}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
