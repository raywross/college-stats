import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { IssueStatusChip, KindChip } from "@/components/admin/steward/Bits";
import { leaveIssueAction } from "@/app/admin/data/steward-actions";
import { linkCls, proposalHref, reviewHref } from "@/lib/admin/steward-view";
import type { Cluster, IssueDoc, IssueKind } from "@/lib/steward/types";

export interface ClusterRowView {
  cluster: Cluster;
  kind: IssueKind;
  issue: IssueDoc | null;
}

/** "unit|edition|code" → the parts a link needs. */
function exampleParts(key: string): { unit: string; label: string } {
  const [unit, edition, code] = key.split("|");
  return { unit, label: `${unit}${code ? ` · ${code}` : ""}${edition ? ` · ${edition}` : ""}` };
}

/**
 * The Issues screen's clusters (specs/product/data-steward.md "The console: where it all shows", Issues row): each
 * cause with its kind, items, colleges, published values, the issue document's status and hypothesis, the examples
 * (folded) linking each college's Review page, and Leave with a reason. Wide: scrolls in its own box on a phone.
 */
export function ClustersTable({ rows }: { rows: ClusterRowView[] }) {
  if (!rows.length) return <Empty>The review queue is empty.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">Open review items grouped by cause, largest first</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Cause
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Kind
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Items
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Colleges
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Published
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Leave
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ cluster, kind, issue }) => (
            <tr key={cluster.key} className="border-t border-border align-top" data-cluster={cluster.key}>
              <th scope="row" className="max-w-md px-3 py-2 text-left font-normal">
                <span className="font-mono text-xs font-semibold">{cluster.check}</span>
                {cluster.detail && <span className="block text-xs text-muted-foreground break-words">{cluster.detail}</span>}
                {issue?.hypothesis && <span className="mt-1 block text-xs">{issue.hypothesis}</span>}
                {issue && issue.proposals.length > 0 && (
                  <span className="mt-1 block text-xs">
                    {issue.proposals.map((p, i) => (
                      <span key={p}>
                        {i > 0 ? ", " : "Proposals: "}
                        <Link href={proposalHref(p)} className={linkCls}>
                          {p}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
                {cluster.examples.length > 0 && (
                  <details className="mt-1 text-xs">
                    <summary className="min-h-8 cursor-pointer text-muted-foreground">Examples</summary>
                    <p className="mt-1 text-muted-foreground">
                      Key for one cause: <code className="rounded bg-muted px-1 break-all">{cluster.key}</code>
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {cluster.examples.map((key) => {
                        const { unit, label } = exampleParts(key);
                        return (
                          <li key={key}>
                            <Link href={reviewHref(unit)} className={linkCls}>
                              {label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </th>
              <td className="px-3 py-2">
                <KindChip kind={issue?.kind ?? kind} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{cluster.items.toLocaleString("en-US")}</td>
              <td className="px-3 py-2 text-right tabular-nums">{cluster.colleges.toLocaleString("en-US")}</td>
              <td className="px-3 py-2 text-right tabular-nums">{cluster.published.toLocaleString("en-US")}</td>
              <td className="px-3 py-2">
                <IssueStatusChip status={issue?.status ?? "new"} />
                {issue?.status === "left" && issue.reason && <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{issue.reason}</span>}
              </td>
              <td className="px-3 py-2">
                {issue?.status === "left" ? (
                  <span className="text-xs text-muted-foreground">Left</span>
                ) : (
                  <AdminForm
                    action={leaveIssueAction}
                    hidden={{ issue: cluster.key }}
                    trigger="Leave"
                    pendingLabel="Saving…"
                    fields={[{ name: "reason", label: "Why it stays queued", type: "textarea", maxLength: 500, required: true }]}
                    description="The items stay queued and the Steward skips this cause."
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
