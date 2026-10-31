import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { loadOperations } from "@/lib/admin/ops";
import { DISPATCHABLE_RUNS, blockingRun } from "@/lib/admin/workflows";
import { parseOperationsParams, timeLabel } from "@/lib/admin/ops-view";
import { dispatchAction } from "@/app/admin/operations/actions";
import { RunForm } from "@/components/admin/ops/RunForm";
import { RunsTable } from "@/components/admin/ops/RunsTable";
import { PullList } from "@/components/admin/ops/PullList";

export const metadata: Metadata = { title: "Operations", robots: { index: false } };

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
 * Workflow runs and approvals of the pull requests still open (specs/product/admin.md "Operations: reruns and
 * approvals"). Everything here reads and writes GitHub as the console's App; each button logs to the admin log before it
 * sends. `?unit=` prefills the college run. The review queue moved to the Data console's Holds
 * (specs/data-platform/change-sets.md "Holds and review"), which this page links.
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

  const allRuns = ops.runs.map((r) => r.run);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Operations</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Start a run and approve or hold the pull requests still open. Connected as {ops.configured.mode === "app" ? "the Quad console GitHub App" : "a personal access token"}. Each action is logged before it is sent.
        </p>
        <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a href="#start-a-run" className="underline decoration-dotted underline-offset-2">Start a run</a>
          <a href="#runs" className="underline decoration-dotted underline-offset-2">Runs</a>
          <a href="#pulls" className="underline decoration-dotted underline-offset-2">Approvals ({ops.pulls.length})</a>
          <Link href="/admin/data/holds" className="underline decoration-dotted underline-offset-2">Holds</Link>
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

      <Section id="pulls" title="Approvals" hint="Open pull requests from data/ and review/ branches, for code changes that still go through one. The ones waiting for a person come first.">
        <PullList pulls={ops.pulls} />
      </Section>

      <Section id="review-queue" title="Review queue">
        <p className="rounded-2xl border border-border bg-card p-4 text-sm">
          Values the automatic checks held back are in the Data console now: Accept the value, Reject, and Re-run discovery act on the data directly.{" "}
          <Link href={params.unit ? `/admin/data/holds?unit=${params.unit}` : "/admin/data/holds"} className="font-semibold underline decoration-dotted underline-offset-2">
            Open Holds{params.unit ? ` for college ${params.unit}` : ""}
          </Link>
        </p>
      </Section>
    </div>
  );
}
