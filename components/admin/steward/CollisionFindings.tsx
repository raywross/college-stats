import Link from "next/link";
import { Empty, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { StewardWords } from "@/components/admin/steward/Bits";
import { fmtDateTime } from "@/lib/admin/console";
import { CHOOSE_THE_FILE } from "@/lib/admin/document-compare";
import { ISSUE_STATUS_LABEL, type IssueDoc } from "@/lib/steward/types";

/**
 * Collision findings (kind Two files; specs/product/document-collisions.md "The Steward side"): one per college and
 * edition where the Steward found a refile would move a file into an edition that already has one. Each links the
 * college page's comparison with "Choose the file"; a settled one says how it was settled. Open ones first, then newest.
 */
export function CollisionFindings({ issues }: { issues: readonly IssueDoc[] }) {
  const rows = [...issues].sort((a, b) => Number(a.status === "left") - Number(b.status === "left") || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return (
    <Panel help="document-collision" title="Two files, one edition" id="collisions">
      {rows.length === 0 ? (
        <Empty>The Steward hasn&apos;t found two files claiming one edition.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((i) => (
            <li key={i.key} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <StatusChip label={ISSUE_STATUS_LABEL[i.status] ?? i.status} tone={i.status === "left" ? "neutral" : "warn"} />
                <span className="text-muted-foreground">{fmtDateTime(i.updated)}</span>
              </p>
              <p>
                <StewardWords text={i.hypothesis} />
              </p>
              {i.status === "left" && i.reason && <p className="text-muted-foreground">{i.reason}</p>}
              {i.status !== "left" && i.href && (
                <Link href={i.href} className="inline-flex h-11 items-center rounded-full bg-primary px-4 font-semibold text-primary-foreground">
                  {i.action ?? CHOOSE_THE_FILE}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
