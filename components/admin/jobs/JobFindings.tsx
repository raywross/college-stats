import Link from "next/link";
import { Empty, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { fmtDateTime } from "@/lib/admin/console";
import { jobById } from "@/lib/jobs/registry";
import { JOBS_HREF } from "@/lib/jobs/view";
import { ISSUE_STATUS_LABEL, type IssueDoc } from "@/lib/steward/types";

const linkCls = "underline decoration-dotted underline-offset-2";

/** A held change's id from a `change|<id>` finding's key, or null. */
function changeId(key: string): string | null {
  const m = /^change\|(\d+)$/.exec(key);
  return m ? m[1] : null;
}

/**
 * Findings from the Steward's job review (kind Job; specs/product/admin-redesign.md "What the Steward reviews"): one per
 * job whose runs it flagged or that failed, with its latest note and the last runs it read, and one per held change a
 * job wrote. Newest first.
 */
export function JobFindings({ issues }: { issues: readonly IssueDoc[] }) {
  const rows = [...issues].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return (
    <Panel help="review" title="Job findings" id="jobs">
      {rows.length === 0 ? (
        <Empty>No job run has looked wrong to the Steward.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((i) => {
            const job = i.family ? jobById(i.family) : null;
            const change = changeId(i.key);
            const last = i.findings[i.findings.length - 1];
            return (
              <li key={i.key} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {job ? (
                    <Link href={`${JOBS_HREF}/${job.id}`} className={linkCls}>
                      {job.name}
                    </Link>
                  ) : (
                    "A job"
                  )}
                  {change && (
                    <Link href={`/admin/data/changes/${change}`} className={linkCls}>
                      Change #{change}
                    </Link>
                  )}
                  <StatusChip label={ISSUE_STATUS_LABEL[i.status] ?? i.status} tone={i.status === "left" ? "neutral" : "warn"} />
                  <span className="font-normal text-muted-foreground">{fmtDateTime(i.updated)}</span>
                </p>
                <p>{i.hypothesis}</p>
                {last && <p className="text-muted-foreground">{last.shows}</p>}
                {i.findings.length > 1 && <p className="text-xs text-muted-foreground">{i.findings.length} runs read.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
