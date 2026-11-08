import Link from "next/link";
import { Empty, Panel } from "@/components/admin/Panel";
import { fmtDateTime } from "@/lib/admin/console";
import { RUN_MODE_LABEL } from "@/lib/admin/inbox";
import { jobById } from "@/lib/jobs/registry";
import { JOBS_HREF } from "@/lib/jobs/view";
import type { AuditDoc } from "@/lib/steward/types";

const linkCls = "underline decoration-dotted underline-offset-2";
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The Sunday audit's week of jobs (specs/product/admin-redesign.md "What the Steward reviews": "It summarizes the
 * week"): runs reviewed, failed, flagged, repaired, by job; the Steward's spend by kind; the review queue's trend.
 */
export function JobsWeekPanel({ audit }: { audit: AuditDoc | null }) {
  const w = audit?.jobs;
  return (
    <Panel help="review" title="The week's jobs">
      {!audit || !w ? (
        <Empty>No weekly jobs summary yet. The Sunday audit writes one.</Empty>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            {w.reviewed} run{w.reviewed === 1 ? "" : "s"} reviewed from {fmtDateTime(w.from)} to {fmtDateTime(w.to)}: {w.failed} failed, {w.flagged} flagged, {w.repaired} repaired.
          </p>
          {w.byJob.length > 0 && (
            <ul className="space-y-1">
              {w.byJob.map((j) => {
                const job = jobById(j.job);
                return (
                  <li key={j.job}>
                    {job ? (
                      <Link href={`${JOBS_HREF}/${job.id}`} className={linkCls}>
                        {job.name}
                      </Link>
                    ) : (
                      j.job
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      · {j.fine} fine · {j.flagged} flagged · {j.failed} failed{j.repaired ? ` · ${j.repaired} repaired` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {Object.keys(w.spendByMode).length > 0 && (
            <p className="text-muted-foreground">
              Spend:{" "}
              {Object.entries(w.spendByMode)
                .map(([mode, n]) => `${RUN_MODE_LABEL[mode] ?? mode} ${usd(n)}`)
                .join(" · ")}
            </p>
          )}
          {w.queueOpen !== null && (
            <p className="text-muted-foreground">
              Review queue: {w.queueOpen.toLocaleString("en-US")} open
              {w.queueOpenBefore !== null ? `, ${w.queueOpen - w.queueOpenBefore >= 0 ? "up" : "down"} ${Math.abs(w.queueOpen - w.queueOpenBefore).toLocaleString("en-US")} from the week before` : ""}.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
