import Link from "next/link";
import { AdminForm } from "@/components/admin/AdminForm";
import { Empty } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { IssueStatusChip, KindChip } from "@/components/admin/steward/Bits";
import { leaveIssueAction } from "@/app/admin/steward/actions";
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

function Cause({ row: { cluster, issue } }: { row: ClusterRowView }) {
  return (
    <>
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
          <summary className="min-h-11 cursor-pointer text-muted-foreground">Examples</summary>
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
    </>
  );
}

function Leave({ row: { cluster, issue } }: { row: ClusterRowView }) {
  if (issue?.status === "left") return <span className="text-xs text-muted-foreground">Left</span>;
  return (
    <AdminForm
      action={leaveIssueAction}
      hidden={{ issue: cluster.key }}
      trigger="Leave"
      pendingLabel="Saving…"
      sheet
      fields={[{ name: "reason", label: "Why it stays queued", type: "textarea", maxLength: 500, required: true }]}
      description="The items stay queued and the Steward skips this cause."
    />
  );
}

const columns: readonly Column<ClusterRowView>[] = [
  { key: "cause", header: "Cause", role: "title", cell: (row) => <Cause row={row} /> },
  { key: "kind", header: "Kind", cell: ({ cluster, kind, issue }) => <KindChip kind={issue?.kind ?? kind} /> },
  { key: "items", header: "Items", align: "right", role: "detail", cell: ({ cluster }) => cluster.items.toLocaleString("en-US") },
  { key: "colleges", header: "Colleges", align: "right", cell: ({ cluster }) => cluster.colleges.toLocaleString("en-US") },
  { key: "published", header: "Published", align: "right", role: "detail", cell: ({ cluster }) => cluster.published.toLocaleString("en-US") },
  {
    key: "status",
    header: "Status",
    cell: ({ issue }) => (
      <>
        <IssueStatusChip status={issue?.status ?? "new"} />
        {issue?.status === "left" && issue.reason && <span className="mt-1 block text-xs text-muted-foreground">{issue.reason}</span>}
      </>
    ),
  },
  { key: "leave", header: "Leave", role: "actions", cell: (row) => <Leave row={row} /> },
];

/**
 * The Findings screen's clusters (specs/product/data-steward.md "The console: where it all shows"), through
 * `ResponsiveTable`: each cause with its kind, items, colleges, published values, the issue document's status and
 * hypothesis, the examples (folded) linking each college's Review page, and Leave with a reason.
 */
export function ClustersTable({ rows }: { rows: ClusterRowView[] }) {
  if (!rows.length) return <Empty>The review queue is empty.</Empty>;
  return <ResponsiveTable rows={rows} columns={columns} rowKey={(row) => row.cluster.key} caption="Open review items grouped by cause, largest first" empty="The review queue is empty." />;
}
