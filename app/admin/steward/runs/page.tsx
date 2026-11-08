import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { StewardBack } from "@/components/admin/steward/Bits";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { REVIEW_WEEKLY_CAP_USD, RUN_MODE_LABEL, STEWARD_WEEKLY_CAP_USD, runWrote, weeklyReviewSpend, weeklySpend } from "@/lib/admin/inbox";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readRuns } from "@/lib/admin/steward-reads";
import { linkCls } from "@/lib/admin/steward-view";
import { jobById } from "@/lib/jobs/registry";
import { JOBS_HREF } from "@/lib/jobs/view";
import type { RunDoc } from "@/lib/steward/types";

export const metadata: Metadata = { title: "Steward runs", robots: { index: false, follow: false } };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spend in the seven days by mode, largest first. */
function spendByMode(runs: readonly RunDoc[], now: Date): { mode: string; usd: number; runs: number }[] {
  const since = now.getTime() - 7 * 86_400_000;
  const by = new Map<string, { mode: string; usd: number; runs: number }>();
  for (const r of runs) {
    const t = Date.parse(r.started);
    if (!Number.isFinite(t) || t < since || t > now.getTime()) continue;
    const row = by.get(r.mode) ?? { mode: r.mode, usd: 0, runs: 0 };
    row.usd += Number(r.spent_usd) || 0;
    row.runs++;
    by.set(r.mode, row);
  }
  return [...by.values()].sort((a, b) => b.usd - a.usd || a.mode.localeCompare(b.mode));
}

/**
 * `/admin/steward/runs` (specs/product/admin-redesign.md "The screens", Runs): every run of the Steward (`steward.runs`),
 * newest first, with its kind, what it spent against its budget, what it wrote, and the repairs it made (a job
 * review's); the week's total against the $40 cap, the job reviews' own $3, and the spend by kind. A job review that
 * looked fine spends nothing and leaves no run here (its reading is on the job's run page). Starting a run is the Data
 * Steward job's Run now.
 */
export default async function StewardRunsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const runs = await readRuns(supabase as unknown as StoreClient, 100);
  const now = new Date();
  const spent = weeklySpend(runs, now);
  const reviews = weeklyReviewSpend(runs, now);
  const byMode = spendByMode(runs, now);

  return (
    <>
      <PageHeader
        title="Steward runs"
        help="steward-runs"
        back={<StewardBack />}
        subtitle={
          <>
            What the Steward did and what it cost. To start one, use{" "}
            <Link href="/admin/steward/jobs/data-steward#run-now" className={linkCls}>
              Run now on the Data Steward job
            </Link>
            .
          </>
        }
      />
      <div className="space-y-5">
        <Panel title="This week" help="steward-runs">
          <p className="text-sm">
            <span className="font-display text-2xl font-extrabold tabular-nums">{usd(spent)}</span> spent in the last 7 days, of the {usd(STEWARD_WEEKLY_CAP_USD)} weekly budget.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Job reviews: {usd(reviews)} of their own {usd(REVIEW_WEEKLY_CAP_USD)} a week, inside the {usd(STEWARD_WEEKLY_CAP_USD)}.
          </p>
          {byMode.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {byMode.map((m) => (
                <li key={m.mode}>
                  <span className="font-semibold">{RUN_MODE_LABEL[m.mode] ?? m.mode}</span>: {usd(m.usd)} in {m.runs} run{m.runs === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Every run" help="run" aside={<span className="text-sm text-muted-foreground">{runs.length} shown</span>}>
          {runs.length === 0 ? (
            <Empty>The Steward hasn&apos;t run yet.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {runs.map((r) => {
                const job = r.mode === "review" && r.job ? jobById(r.job) : null;
                return (
                  <li key={r.key} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <StatusChip label={RUN_MODE_LABEL[r.mode] ?? r.mode} tone="info" />
                      {fmtDateTime(r.started)}
                      {r.finished === null && <StatusChip label="Running or stopped" tone="warn" />}
                      {r.repairs ? <StatusChip label={`${r.repairs} repair${r.repairs === 1 ? "" : "s"}`} tone="neutral" help="repair" /> : null}
                    </p>
                    {job && r.run_ref && (
                      <p className="mt-0.5">
                        Reviewed{" "}
                        <Link href={`${JOBS_HREF}/${job.id}/runs/${r.run_ref}`} className={linkCls}>
                          a run of {job.name}
                        </Link>
                      </p>
                    )}
                    <p className="mt-0.5 text-muted-foreground">
                      {runWrote(r)}. Spent {usd(r.spent_usd)} of {usd(r.budget_usd)}.{r.stopped ? ` Stopped early: ${r.stopped}.` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
