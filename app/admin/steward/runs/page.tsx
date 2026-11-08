import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { StewardBack } from "@/components/admin/steward/Bits";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { RUN_MODE_LABEL, STEWARD_WEEKLY_CAP_USD, runWrote, weeklySpend } from "@/lib/admin/inbox";
import { adminSupabase } from "@/lib/admin/people";
import type { StoreClient } from "@/lib/admin/review-queue";
import { readRuns } from "@/lib/admin/steward-reads";
import { linkCls } from "@/lib/admin/steward-view";

export const metadata: Metadata = { title: "Steward runs", robots: { index: false, follow: false } };

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * `/admin/steward/runs` (specs/product/admin-redesign.md "The screens", Runs): every run of the Steward (`steward.runs`),
 * newest first, with its kind, what it spent against its budget, and what it wrote; the week's total against the $40
 * cap at the top. Starting a run is the Data Steward job's Run now.
 */
export default async function StewardRunsPage() {
  await connection();
  await requireAdmin();
  const supabase = await adminSupabase();
  const runs = await readRuns(supabase as unknown as StoreClient, 100);
  const spent = weeklySpend(runs, new Date());

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
        </Panel>
        <Panel title="Every run" help="run" aside={<span className="text-sm text-muted-foreground">{runs.length} shown</span>}>
          {runs.length === 0 ? (
            <Empty>The Steward hasn&apos;t run yet.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {runs.map((r) => (
                <li key={r.key} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <StatusChip label={RUN_MODE_LABEL[r.mode] ?? r.mode} tone="info" />
                    {fmtDateTime(r.started)}
                    {r.finished === null && <StatusChip label="Running or stopped" tone="warn" />}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {runWrote(r)}. Spent {usd(r.spent_usd)} of {usd(r.budget_usd)}.{r.stopped ? ` Stopped early: ${r.stopped}.` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
